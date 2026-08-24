// Assemblage de l'archive EPUB 3 : squelette XHTML de chaque document, navigation
// (nav.xhtml + toc.ncx), métadonnées OPF, zip. Le découpage du manuscrit en
// documents appartient à documents.ts, la maquette à style.ts — ce module ne
// décide de rien du contenu, il l'emballe.
import { existsSync, readFileSync } from 'fs'
import { extname, join } from 'path'
import { createHash } from 'crypto'
import JSZip from 'jszip'
import type { Db } from '../db/connection'
import { getBook } from '../db/books'
import { escapeXml } from '../../shared/export'
import { IMAGE_MEDIA_TYPES } from '../media'
import { buildEpubCss } from './style'
import { buildEpubDocuments } from './documents'
import { textesEpub } from './textes'

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`

// Squelette commun à tous les documents du livre. Le corps arrive déjà bien formé
// de documents.ts, section epub:type incluse.
function page(titre: string, corps: string, langue: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(langue)}" lang="${escapeXml(langue)}">
<head>
<meta charset="utf-8"/>
<title>${escapeXml(titre)}</title>
<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
${corps}
</body>
</html>
`
}

// Espace de noms URL de la RFC 4122, celui qu'utilise uuid5(NAMESPACE_URL, …).
const NAMESPACE_URL = '6ba7b811-9dad-11d1-80b4-00c04fd430c8'

// UUID v5 (SHA-1) déterministe. Vingt lignes de node:crypto plutôt qu'une
// dépendance : l'identifiant d'une œuvre doit être stable d'une machine et d'une
// base à l'autre, ce qu'un `urn:encre:<rowid>` ne pouvait pas garantir — deux
// exports du même livre depuis deux installations désignaient deux œuvres.
export function uuidV5(nom: string): string {
  const espace = Buffer.from(NAMESPACE_URL.replace(/-/g, ''), 'hex')
  const empreinte = createHash('sha1')
    .update(Buffer.concat([espace, Buffer.from(nom, 'utf8')]))
    .digest()
  const octets = Buffer.from(empreinte.subarray(0, 16))
  octets[6] = (octets[6] & 0x0f) | 0x50 // version 5
  octets[8] = (octets[8] & 0x3f) | 0x80 // variante RFC 4122
  const hex = octets.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

// `datetime('now')` de SQLite donne "2026-08-24 10:11:12" en UTC, que
// dcterms:modified veut en "2026-08-24T10:11:12Z". Cette date vient de
// book.updatedAt et non de l'horloge : deux exports d'un livre qu'on n'a pas
// touché doivent produire la même archive.
function horodatageUtc(valeur: string): string {
  const date = new Date(`${String(valeur).trim().replace(' ', 'T').replace(/Z$/, '')}Z`)
  if (Number.isNaN(date.getTime())) return '1970-01-01T00:00:00Z'
  return date.toISOString().replace(/\.\d+Z$/, 'Z')
}

function annee(valeur: string): string {
  const correspondance = /^(\d{4})/.exec(String(valeur).trim())
  return correspondance ? correspondance[1] : '1970'
}

export async function buildEpub(
  db: Db,
  bookId: number,
  chapterIds: number[],
  mediaDir?: string
): Promise<Buffer> {
  const book = getBook(db, bookId)
  const langue = book.language || 'fr'
  const textes = textesEpub(langue)
  const { documents, images } = buildEpubDocuments(db, bookId, chapterIds, mediaDir)

  const zip = new JSZip()
  // mimetype DOIT être le premier fichier de l'archive, sans compression : c'est
  // ce qui permet à un lecteur EPUB de détecter le format dès les premiers octets,
  // avant même de parser le central directory du zip.
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file('META-INF/container.xml', CONTAINER_XML)
  zip.file('OEBPS/style.css', buildEpubCss())

  const manifest: string[] = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
    '<item id="css" href="style.css" media-type="text/css"/>'
  ]
  const spine: string[] = []

  // Couverture : jusqu'ici l'image entrait au manifest mais aucun document ne la
  // portait, donc elle n'apparaissait pas dans le fil de lecture de la plupart
  // des liseuses. cover.xhtml la remet dans la spine, en tête.
  const aCouverture = !!book.coverPath && existsSync(book.coverPath)
  let couvertureXhtml = ''
  if (aCouverture) {
    const ext = extname(book.coverPath as string).toLowerCase()
    const typeMime = IMAGE_MEDIA_TYPES[ext] ?? 'application/octet-stream'
    zip.file(`OEBPS/images/couverture${ext}`, readFileSync(book.coverPath as string))
    manifest.push(
      `<item id="img-couverture" href="images/couverture${ext}" media-type="${typeMime}" properties="cover-image"/>`
    )
    couvertureXhtml = page(
      book.title,
      `<section epub:type="cover">` +
        `<img class="couverture" src="images/couverture${ext}" alt="${escapeXml(book.title)} — ${escapeXml(textes.couverture.toLowerCase())}"/>` +
        `</section>`,
      langue
    )
    zip.file('OEBPS/cover.xhtml', couvertureXhtml)
    manifest.push('<item id="doc-cover" href="cover.xhtml" media-type="application/xhtml+xml"/>')
    spine.push('<itemref idref="doc-cover"/>')
  }

  // documents.ts a déjà vérifié l'existence et l'extension de chaque nom retenu
  // (mêmes gardes qu'avant : anti-traversée, fichier absent, extension inconnue),
  // il ne reste ici qu'à embarquer les octets.
  images.forEach((nom, rang) => {
    const typeMime = IMAGE_MEDIA_TYPES[extname(nom).toLowerCase()] ?? 'application/octet-stream'
    if (mediaDir) zip.file(`OEBPS/images/${nom}`, readFileSync(join(mediaDir, nom)))
    // Le chemin écrit dans le zip reste LITTÉRAL (c'est un chemin d'archive, pas
    // une URI) ; le href, lui, est encodé — comme le src produit par documents.ts.
    manifest.push(
      `<item id="img-ill${rang}" href="images/${encodeURIComponent(nom)}" media-type="${typeMime}"/>`
    )
  })

  documents.forEach((doc, rang) => {
    zip.file(`OEBPS/${doc.nom}`, page(doc.titre, doc.corps, langue))
    manifest.push(`<item id="doc${rang}" href="${doc.nom}" media-type="application/xhtml+xml"/>`)
    spine.push(`<itemref idref="doc${rang}"/>`)
  })

  // Le repère « toc » des landmarks pointe vers nav.xhtml, et EPUBCheck refuse en
  // RSC-011 toute cible de repère absente de la spine. linear="no" l'y déclare
  // sans l'insérer dans le fil de lecture.
  spine.push('<itemref idref="nav" linear="no"/>')

  const entreesNav = documents
    .filter((d) => d.nav)
    .map((d) => `<li><a href="${d.nom}">${escapeXml(d.nav as string)}</a></li>`)
    .join('\n')

  const premierChapitre = documents.find((d) => d.kind === 'chapitre') ?? documents[0]
  const repereDebut = premierChapitre
    ? `<li><a epub:type="bodymatter" href="${premierChapitre.nom}">${escapeXml(textes.debutLecture)}</a></li>`
    : ''
  const repereCouverture = aCouverture
    ? `<li><a epub:type="cover" href="cover.xhtml">${escapeXml(textes.couverture)}</a></li>`
    : ''

  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(langue)}" lang="${escapeXml(langue)}">
<head>
<meta charset="utf-8"/>
<title>${escapeXml(textes.sommaire)}</title>
<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
<nav epub:type="toc" id="toc"><h2>${escapeXml(textes.sommaire)}</h2>
<ol>
${entreesNav}
</ol></nav>
<nav epub:type="landmarks" hidden="hidden"><h2>${escapeXml(textes.reperes)}</h2>
<ol>
${repereCouverture}
<li><a epub:type="toc" href="nav.xhtml">${escapeXml(textes.sommaire)}</a></li>
${repereDebut}
</ol></nav>
</body>
</html>
`
  )

  const identifiant = `urn:uuid:${uuidV5(`${book.author}/${book.title}`)}`

  // toc.ncx : la navigation EPUB 2. Redondante avec nav.xhtml pour un lecteur
  // moderne, mais c'est la seule que voient les liseuses anciennes et les Kindle
  // convertis — sans elle, ces appareils n'ont aucune table des matières.
  const pointsNcx = documents
    .filter((d) => d.nav)
    .map(
      (d, rang) =>
        `<navPoint id="np${rang}" playOrder="${rang + 1}">` +
        `<navLabel><text>${escapeXml(d.nav as string)}</text></navLabel>` +
        `<content src="${d.nom}"/></navPoint>`
    )
    .join('\n')

  zip.file(
    'OEBPS/toc.ncx',
    `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${escapeXml(langue)}">
<head>
<meta name="dtb:uid" content="${identifiant}"/>
<meta name="dtb:depth" content="1"/>
<meta name="dtb:totalPageCount" content="0"/>
<meta name="dtb:maxPageNumber" content="0"/>
</head>
<docTitle><text>${escapeXml(book.title)}</text></docTitle>
<docAuthor><text>${escapeXml(book.author)}</text></docAuthor>
<navMap>
${pointsNcx}
</navMap>
</ncx>
`
  )

  const serie = book.seriesName
    ? `<meta property="belongs-to-collection" id="serie">${escapeXml(book.seriesName)}</meta>\n` +
      `<meta refines="#serie" property="collection-type">series</meta>\n`
    : ''

  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="${escapeXml(langue)}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="pub-id">${identifiant}</dc:identifier>
<dc:title>${escapeXml(book.title)}</dc:title>
<dc:creator id="auteur">${escapeXml(book.author)}</dc:creator>
<meta refines="#auteur" property="role" scheme="marc:relators">aut</meta>
<dc:language>${escapeXml(langue)}</dc:language>
<dc:date>${annee(book.createdAt)}-01-01</dc:date>
<meta property="dcterms:modified">${horodatageUtc(book.updatedAt)}</meta>
${serie}${aCouverture ? '<meta name="cover" content="img-couverture"/>\n' : ''}</metadata>
<manifest>
${manifest.join('\n')}
</manifest>
<spine toc="ncx">
${spine.join('\n')}
</spine>
</package>
`
  )

  return zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' })
}
