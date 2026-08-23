import { existsSync, readFileSync } from 'fs'
import { extname, join, basename } from 'path'
import JSZip from 'jszip'
import type { Db } from './db/connection'
import { getBook } from './db/books'
import { listChapters, getChapter } from './db/chapters'
import { tiptapToXhtml, escapeXml } from '../shared/export'
import type { ExportOptions } from '../shared/export'

// Exportée : réutilisée par pdf.ts pour vérifier l'extension d'une
// illustration sans dupliquer cette table (même famille d'images partout).
export const IMAGE_MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
}

const xhtml = (title: string, body: string): string => `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="fr" xml:lang="fr">
<head><meta charset="utf-8"/><title>${escapeXml(title)}</title><link rel="stylesheet" href="style.css"/></head>
<body><h1>${escapeXml(title)}</h1>
${body}</body>
</html>`

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`

const STYLE_CSS = `body {
  font-family: Georgia, "Times New Roman", serif;
  line-height: 1.6;
  margin: 5%;
}
h1 {
  font-size: 1.5em;
  margin-bottom: 1em;
}
p {
  margin: 0 0 1em 0;
  text-indent: 1.5em;
}
.scene-break {
  text-align: center;
  margin: 1.5em 0;
  border: none;
}
.page-break {
  page-break-after: always;
  break-after: page;
  border: none;
  margin: 0;
}
.illustration {
  text-align: center;
  margin: 1.5em 0;
  text-indent: 0;
}
.illustration img {
  max-width: 100%;
}
`

export async function buildEpub(db: Db, bookId: number, chapterIds: number[], mediaDir?: string): Promise<Buffer> {
  const book = getBook(db, bookId)
  const allChapters = listChapters(db, bookId)
  const selected = chapterIds.length === 0
    ? allChapters
    : allChapters.filter((c) => chapterIds.includes(c.id))

  const zip = new JSZip()
  // mimetype DOIT être le premier fichier de l'archive, sans compression :
  // c'est ce qui permet à un lecteur EPUB de détecter le format dès les
  // premiers octets (avant même de parser le zip central directory).
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })

  zip.file('META-INF/container.xml', CONTAINER_XML)
  zip.file('OEBPS/style.css', STYLE_CSS)

  const hasCover = !!book.coverPath && existsSync(book.coverPath)
  const coverExt = hasCover ? extname(book.coverPath as string).toLowerCase() : ''
  const coverMediaType = IMAGE_MEDIA_TYPES[coverExt] ?? 'application/octet-stream'
  if (hasCover) {
    zip.file(`OEBPS/cover${coverExt}`, readFileSync(book.coverPath as string))
  }

  const manifestItems: string[] = [
    '<item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>',
    '<item id="style" href="style.css" media-type="text/css"/>'
  ]
  const spineItems: string[] = []
  const navItems: string[] = []

  const embeddedImages = new Set<string>()
  const illustrationManifest: string[] = []
  const opts: ExportOptions = {
    illustration: ({ fileName, displayName }) => {
      if (fileName !== basename(fileName)) return null
      if (!mediaDir) return null
      const src = join(mediaDir, fileName)
      if (!existsSync(src)) return null
      if (!embeddedImages.has(fileName)) {
        zip.file(`OEBPS/images/${fileName}`, readFileSync(src))
        const mediaType = IMAGE_MEDIA_TYPES[extname(fileName).toLowerCase()] ?? 'application/octet-stream'
        illustrationManifest.push(
          `<item id="illustration-${illustrationManifest.length + 1}" href="images/${fileName}" media-type="${mediaType}"/>`
        )
        embeddedImages.add(fileName)
      }
      return {
        md: '',
        xhtml: `<div class="illustration"><img src="images/${fileName}" alt="${escapeXml(displayName)}"/></div>`
      }
    }
  }

  for (const meta of selected) {
    const full = getChapter(db, meta.id)
    const body = tiptapToXhtml(full.contentJson, opts)
    zip.file(`OEBPS/chapter-${meta.position}.xhtml`, xhtml(meta.title, body))
    manifestItems.push(
      `<item id="chapter-${meta.position}" href="chapter-${meta.position}.xhtml" media-type="application/xhtml+xml"/>`
    )
    spineItems.push(`<itemref idref="chapter-${meta.position}"/>`)
    navItems.push(
      `<li><a href="chapter-${meta.position}.xhtml">${escapeXml(meta.title)}</a></li>`
    )
  }

  if (hasCover) {
    manifestItems.push(
      `<item id="cover-image" href="cover${coverExt}" properties="cover-image" media-type="${coverMediaType}"/>`
    )
  }
  manifestItems.push(...illustrationManifest)

  const navXhtml = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="fr" xml:lang="fr">
<head><meta charset="utf-8"/><title>Table des matières</title><link rel="stylesheet" href="style.css"/></head>
<body>
<nav epub:type="toc" id="toc">
<h1>Table des matières</h1>
<ol>
${navItems.join('\n')}
</ol>
</nav>
</body>
</html>`
  zip.file('OEBPS/nav.xhtml', navXhtml)

  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id" xml:lang="${escapeXml(book.language)}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:encre:${bookId}</dc:identifier>
    <dc:title>${escapeXml(book.title)}</dc:title>
    <dc:creator>${escapeXml(book.author)}</dc:creator>
    <dc:language>${escapeXml(book.language)}</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
${hasCover ? '    <meta name="cover" content="cover-image"/>\n' : ''}  </metadata>
  <manifest>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine>
    ${spineItems.join('\n    ')}
  </spine>
</package>
`
  zip.file('OEBPS/content.opf', opf)

  return zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' })
}
