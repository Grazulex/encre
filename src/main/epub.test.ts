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
})
