import type { Db } from './db/connection'
import type { EncreApi } from '../shared/ipc-contract'
import * as books from './db/books'
import * as chapters from './db/chapters'

export function createApi(db: Db): EncreApi {
  return {
    books: {
      list: async () => books.listBooks(db),
      get: async (id) => books.getBook(db, id),
      create: async (input) => books.createBook(db, input),
      update: async (id, patch) => books.updateBook(db, id, patch),
      remove: async (id) => books.deleteBook(db, id)
    },
    chapters: {
      listByBook: async (bookId) => chapters.listChapters(db, bookId),
      get: async (id) => chapters.getChapter(db, id),
      create: async (bookId, title) => chapters.createChapter(db, bookId, title),
      saveContent: async (id, json, text) => chapters.saveChapterContent(db, id, json, text),
      rename: async (id, title) => chapters.renameChapter(db, id, title),
      setStatus: async (id, status) => chapters.setChapterStatus(db, id, status),
      reorder: async (bookId, ids) => chapters.reorderChapters(db, bookId, ids),
      remove: async (id) => chapters.deleteChapter(db, id)
    }
  }
}
