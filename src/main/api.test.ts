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
})
