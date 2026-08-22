import { describe, it, expect } from 'vitest'
import { openDb } from './db/connection'
import { createApi } from './api'

describe('createApi', () => {
  it('expose le cycle complet livre → chapitre → contenu', async () => {
    const api = createApi(openDb(':memory:'))
    const book = await api.books.create({ title: 'Via API' })
    const chapter = await api.chapters.create(book.id, 'Chapitre 1')
    await api.chapters.saveContent(chapter.id, '{"type":"doc","content":[]}', 'un deux trois')
    const metas = await api.chapters.listByBook(book.id)
    expect(metas[0].wordCount).toBe(3)
    const refreshed = await api.books.get(book.id)
    expect(refreshed.wordCount).toBe(3)
    expect(refreshed.chapterCount).toBe(1)
  })

  it('expose entités, plan, chronologie et résumé', async () => {
    const api = createApi(openDb(':memory:'))
    const book = await api.books.create({ title: 'Via API v2' })
    const mara = await api.entities.create({ bookId: book.id, kind: 'character', name: 'Mara' })
    const ch = await api.chapters.create(book.id, 'Ch. 1')
    await api.chapters.saveSummary(ch.id, 'Résumé.')
    expect((await api.chapters.get(ch.id)).summary).toBe('Résumé.')
    const note = await api.outline.create(book.id, ch.id)
    await api.outline.update(note.id, 'Plan du chapitre')
    const ev = await api.timeline.create(book.id, 'Incendie')
    await api.timeline.setLinks(ev.id, [ch.id], [mara.id])
    expect((await api.timeline.listByBook(book.id))[0].entityIds).toEqual([mara.id])
    expect(await api.entities.listByBook(book.id, 'character')).toHaveLength(1)
  })
})
