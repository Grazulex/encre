import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { openDb } from './db/connection'
import { createApi } from './api'
import { buildEpub } from './epub'

describe('buildEpub', () => {
  it('produit une archive EPUB structurée avec les chapitres choisis', async () => {
    const db = openDb(':memory:')
    const api = createApi(db)
    const book = await api.books.create({ title: 'Mon EPUB', author: 'JMS' })
    const c1 = await api.chapters.create(book.id, 'Un')
    await api.chapters.saveContent(c1.id, JSON.stringify({
      type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Contenu & test.' }] }]
    }), 'Contenu & test.')
    await api.chapters.create(book.id, 'Deux')

    const buffer = await buildEpub(db, book.id, [])
    const zip = await JSZip.loadAsync(buffer)
    expect(await zip.file('mimetype')!.async('string')).toBe('application/epub+zip')
    expect(zip.file('META-INF/container.xml')).toBeTruthy()
    const opf = await zip.file('OEBPS/content.opf')!.async('string')
    expect(opf).toContain('<dc:title>Mon EPUB</dc:title>')
    expect(opf).toContain('<dc:creator>JMS</dc:creator>')
    const ch1 = await zip.file('OEBPS/chapter-1.xhtml')!.async('string')
    expect(ch1).toContain('<h1>Un</h1>')
    expect(ch1).toContain('Contenu &amp; test.')
    expect(zip.file('OEBPS/chapter-2.xhtml')).toBeTruthy()
    expect(zip.file('OEBPS/nav.xhtml')).toBeTruthy()
  })

  it('style.css définit .scene-break et .page-break, rendus dans les chapitres', async () => {
    const db = openDb(':memory:')
    const api = createApi(db)
    const book = await api.books.create({ title: 'EPUB', author: 'JMS' })
    const c1 = await api.chapters.create(book.id, 'Un')
    await api.chapters.saveContent(c1.id, JSON.stringify({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Avant.' }] },
        { type: 'sceneBreak' },
        { type: 'paragraph', content: [{ type: 'text', text: 'Milieu.' }] },
        { type: 'pageBreak' },
        { type: 'paragraph', content: [{ type: 'text', text: 'Fin.' }] }
      ]
    }), 'Avant. Milieu. Fin.')

    const buffer = await buildEpub(db, book.id, [])
    const zip = await JSZip.loadAsync(buffer)
    const css = await zip.file('OEBPS/style.css')!.async('string')
    expect(css).toContain('.scene-break')
    expect(css).toContain('.page-break')
    expect(css).toContain('page-break-after: always')
    const ch1 = await zip.file('OEBPS/chapter-1.xhtml')!.async('string')
    expect(ch1).toContain('<div class="scene-break">⁂</div>')
    expect(ch1).toContain('<hr class="page-break"/>')
  })

  it('embarque les illustrations référencées et les déclare au manifest', async () => {
    const { mkdtempSync, writeFileSync } = await import('fs')
    const { tmpdir } = await import('os')
    const { join } = await import('path')
    const db = openDb(':memory:')
    const api = createApi(db)
    const book = await api.books.create({ title: 'EPUB illustré' })
    const c1 = await api.chapters.create(book.id, 'Un')
    const mediaDir = mkdtempSync(join(tmpdir(), 'encre-epub-media-'))
    writeFileSync(join(mediaDir, 'ill-1-9-0.png'), 'png-bytes')
    await api.chapters.saveContent(c1.id, JSON.stringify({
      type: 'doc',
      content: [
        { type: 'illustration', attrs: { fileName: 'ill-1-9-0.png', displayName: 'La maison' } },
        { type: 'illustration', attrs: { fileName: 'absente.png', displayName: 'Fantôme' } }
      ]
    }), '')

    const buffer = await buildEpub(db, book.id, [], mediaDir)
    const zip = await JSZip.loadAsync(buffer)
    expect(await zip.file('OEBPS/images/ill-1-9-0.png')!.async('string')).toBe('png-bytes')
    const opf = await zip.file('OEBPS/content.opf')!.async('string')
    expect(opf).toContain('href="images/ill-1-9-0.png" media-type="image/png"')
    const ch1 = await zip.file('OEBPS/chapter-1.xhtml')!.async('string')
    expect(ch1).toContain('<img src="images/ill-1-9-0.png" alt="La maison"/>')
    expect(ch1).not.toContain('absente.png')
    const css = await zip.file('OEBPS/style.css')!.async('string')
    expect(css).toContain('.illustration')
  })

  it('style.css définit les blocs de mise en page', async () => {
    const db = openDb(':memory:')
    const api = createApi(db)
    const book = await api.books.create({ title: 'EPUB liminaires' })
    await api.chapters.create(book.id, 'Un')
    const zip = await JSZip.loadAsync(await buildEpub(db, book.id, []))
    const css = await zip.file('OEBPS/style.css')!.async('string')
    expect(css).toContain('.liminaire')
    expect(css).toContain('.ouverture')
  })
})
