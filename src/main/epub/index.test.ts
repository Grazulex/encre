import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import JSZip from 'jszip'
import { openDb } from '../db/connection'
import { createApi } from '../api'
import { buildEpub, uuidV5 } from './index'

const doc = (...content: unknown[]): string => JSON.stringify({ type: 'doc', content })
const para = (texte: string): unknown => ({
  type: 'paragraph',
  content: [{ type: 'text', text: texte }]
})

async function livreSimple(titre = 'Mon EPUB', auteur = 'JMS') {
  const db = openDb(':memory:')
  const api = createApi(db)
  const book = await api.books.create({ title: titre, author: auteur })
  const c1 = await api.chapters.create(book.id, 'Un')
  await api.chapters.saveContent(c1.id, doc(para('Contenu & test.')), 'Contenu & test.')
  return { db, api, book }
}

describe('buildEpub — archive', () => {
  it('écrit mimetype en premier, non compressé', async () => {
    const { db, book } = await livreSimple()
    const buffer = await buildEpub(db, book.id, [])
    // Un lecteur EPUB détecte le format en lisant les premiers octets du zip,
    // avant tout parcours du central directory : le nom puis le contenu doivent
    // s'y lire en clair, à leur offset fixe d'entrée non compressée.
    expect(buffer.subarray(30, 38).toString('utf8')).toBe('mimetype')
    expect(buffer.subarray(38, 58).toString('utf8')).toBe('application/epub+zip')
  })

  it('produit les pièces d’un EPUB 3 complet', async () => {
    const { db, book } = await livreSimple()
    const zip = await JSZip.loadAsync(await buildEpub(db, book.id, []))
    for (const nom of [
      'META-INF/container.xml',
      'OEBPS/content.opf',
      'OEBPS/nav.xhtml',
      'OEBPS/toc.ncx',
      'OEBPS/style.css'
    ]) {
      expect(zip.file(nom), nom).toBeTruthy()
    }
  })

  it('nav.xhtml porte la table des matières ET les repères', async () => {
    const { db, book } = await livreSimple()
    const zip = await JSZip.loadAsync(await buildEpub(db, book.id, []))
    const nav = await zip.file('OEBPS/nav.xhtml')!.async('string')
    expect(nav).toContain('<nav epub:type="toc"')
    expect(nav).toContain('<nav epub:type="landmarks"')
    expect(nav).toContain('epub:type="toc" href="nav.xhtml"')
    expect(nav).toContain('epub:type="bodymatter"')
    expect(nav).toContain('Début de la lecture')
  })

  it('toc.ncx reprend les entrées de navigation', async () => {
    const { db, book } = await livreSimple()
    const zip = await JSZip.loadAsync(await buildEpub(db, book.id, []))
    const ncx = await zip.file('OEBPS/toc.ncx')!.async('string')
    expect(ncx).toContain('<docTitle><text>Mon EPUB</text></docTitle>')
    expect(ncx).toContain('<docAuthor><text>JMS</text></docAuthor>')
    expect(ncx).toContain('<navPoint id="np0" playOrder="1">')
    expect(ncx).toContain('<text>Un</text>')
  })

  it('l’OPF porte un identifiant urn:uuid stable pour un même auteur/titre', async () => {
    const a = await livreSimple('Le Livre', 'Jean-Marc Strauven')
    const b = await livreSimple('Le Livre', 'Jean-Marc Strauven')
    const opfA = await (
      await JSZip.loadAsync(await buildEpub(a.db, a.book.id, []))
    )
      .file('OEBPS/content.opf')!
      .async('string')
    const opfB = await (
      await JSZip.loadAsync(await buildEpub(b.db, b.book.id, []))
    )
      .file('OEBPS/content.opf')!
      .async('string')
    const attendu = `urn:uuid:${uuidV5('Jean-Marc Strauven/Le Livre')}`
    expect(opfA).toContain(`<dc:identifier id="pub-id">${attendu}</dc:identifier>`)
    // Deux bases différentes, donc deux rowid différents : l'ancien
    // `urn:encre:<id>` désignait deux œuvres, l'UUID v5 n'en désigne qu'une.
    expect(opfB).toContain(attendu)
  })

  it('l’OPF porte date, rôle marc et spine ncx', async () => {
    const { db, book } = await livreSimple()
    const opf = await (
      await JSZip.loadAsync(await buildEpub(db, book.id, []))
    )
      .file('OEBPS/content.opf')!
      .async('string')
    expect(opf).toMatch(/<dc:date>\d{4}-01-01<\/dc:date>/)
    expect(opf).toMatch(
      /<meta property="dcterms:modified">\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z<\/meta>/
    )
    expect(opf).toContain('<dc:creator id="auteur">JMS</dc:creator>')
    expect(opf).toContain(
      '<meta refines="#auteur" property="role" scheme="marc:relators">aut</meta>'
    )
    expect(opf).toContain('<spine toc="ncx">')
    // Le repère « toc » des landmarks pointe vers nav.xhtml : EPUBCheck refuse en
    // RSC-011 une cible de repère absente de la spine.
    expect(opf).toContain('<itemref idref="nav" linear="no"/>')
  })

  it('déclare la série quand le livre en a une, rien sinon', async () => {
    const { db, api, book } = await livreSimple()
    const sansSerie = await (
      await JSZip.loadAsync(await buildEpub(db, book.id, []))
    )
      .file('OEBPS/content.opf')!
      .async('string')
    expect(sansSerie).not.toContain('belongs-to-collection')

    const serie = await api.series.getOrCreate('L’ENVERS')
    await api.books.update(book.id, { seriesId: serie.id })
    const avecSerie = await (
      await JSZip.loadAsync(await buildEpub(db, book.id, []))
    )
      .file('OEBPS/content.opf')!
      .async('string')
    expect(avecSerie).toContain('<meta property="belongs-to-collection" id="serie">L’ENVERS</meta>')
    expect(avecSerie).toContain('<meta refines="#serie" property="collection-type">series</meta>')
  })

  it('exporter deux fois un livre inchangé donne le même OPF', async () => {
    const { db, book } = await livreSimple()
    const lire = async (): Promise<string> =>
      (await JSZip.loadAsync(await buildEpub(db, book.id, [])))
        .file('OEBPS/content.opf')!
        .async('string')
    expect(await lire()).toBe(await lire())
  })

  it('embarque la couverture et la place dans le fil de lecture', async () => {
    const { db, api, book } = await livreSimple()
    const dir = mkdtempSync(join(tmpdir(), 'encre-epub-cover-'))
    const cover = join(dir, 'couv.jpg')
    writeFileSync(cover, 'jpeg-bytes')
    await api.books.update(book.id, { coverPath: cover })

    const zip = await JSZip.loadAsync(await buildEpub(db, book.id, []))
    expect(await zip.file('OEBPS/images/couverture.jpg')!.async('string')).toBe('jpeg-bytes')
    const opf = await zip.file('OEBPS/content.opf')!.async('string')
    expect(opf).toContain('properties="cover-image"')
    expect(opf).toContain('<meta name="cover" content="img-couverture"/>')
    // La régression que ça corrige : l'image entrait au manifest mais aucun
    // document ne la portait, donc elle n'apparaissait pas à la lecture.
    expect(opf).toContain('<itemref idref="doc-cover"/>')
    const cxhtml = await zip.file('OEBPS/cover.xhtml')!.async('string')
    expect(cxhtml).toContain('<img class="couverture" src="images/couverture.jpg"')
    const nav = await zip.file('OEBPS/nav.xhtml')!.async('string')
    expect(nav).toContain('epub:type="cover" href="cover.xhtml"')
  })

  it('embarque les illustrations et les déclare au manifest', async () => {
    const db = openDb(':memory:')
    const api = createApi(db)
    const book = await api.books.create({ title: 'EPUB illustré' })
    const c1 = await api.chapters.create(book.id, 'Un')
    const mediaDir = mkdtempSync(join(tmpdir(), 'encre-epub-media-'))
    writeFileSync(join(mediaDir, 'ill-1-9-0.png'), 'png-bytes')
    await api.chapters.saveContent(
      c1.id,
      doc(
        { type: 'illustration', attrs: { fileName: 'ill-1-9-0.png', displayName: 'La maison' } },
        { type: 'illustration', attrs: { fileName: 'absente.png', displayName: 'Fantôme' } }
      ),
      ''
    )

    const zip = await JSZip.loadAsync(await buildEpub(db, book.id, [], mediaDir))
    expect(await zip.file('OEBPS/images/ill-1-9-0.png')!.async('string')).toBe('png-bytes')
    const opf = await zip.file('OEBPS/content.opf')!.async('string')
    expect(opf).toContain('href="images/ill-1-9-0.png" media-type="image/png"')
    expect(opf).not.toContain('absente.png')
  })

  it('bascule les libellés fixes en anglais quand la langue du livre est en', async () => {
    const db = openDb(':memory:')
    const api = createApi(db)
    const book = await api.books.create({ title: 'Deemed', author: 'JMS', language: 'en' })
    const c1 = await api.chapters.create(book.id, 'One')
    await api.chapters.saveContent(c1.id, doc(para('Text.')), 'Text.')
    const zip = await JSZip.loadAsync(await buildEpub(db, book.id, []))
    const nav = await zip.file('OEBPS/nav.xhtml')!.async('string')
    expect(nav).toContain('Contents')
    expect(nav).toContain('Landmarks')
    expect(nav).toContain('Start reading')
    expect(nav).not.toContain('Sommaire')
    const opf = await zip.file('OEBPS/content.opf')!.async('string')
    expect(opf).toContain('<dc:language>en</dc:language>')
  })
})
