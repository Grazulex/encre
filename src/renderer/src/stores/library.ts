import { defineStore } from 'pinia'
import type { Book, BookCreate } from '../../../shared/types'

export const useLibraryStore = defineStore('library', {
  state: () => ({ books: [] as Book[], loaded: false }),
  actions: {
    async load() {
      this.books = await window.encre.books.list()
      this.loaded = true
    },
    async create(input: BookCreate): Promise<Book> {
      const book = await window.encre.books.create(input)
      await this.load()
      return book
    },
    async remove(id: number) {
      await window.encre.books.remove(id)
      await this.load()
    }
  }
})
