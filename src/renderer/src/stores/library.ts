import { defineStore } from 'pinia'
import { useUiStore } from './ui'
import type { Book, BookCreate } from '../../../shared/types'

export const useLibraryStore = defineStore('library', {
  state: () => ({ books: [] as Book[], loaded: false }),
  actions: {
    async load() {
      try {
        this.books = await window.encre.books.list()
        this.loaded = true
      } catch (err) {
        console.error('Échec du chargement de la bibliothèque', err)
        useUiStore().toast('Impossible de charger — élément introuvable.')
      }
    },
    async create(input: BookCreate): Promise<Book> {
      try {
        const book = await window.encre.books.create(input)
        await this.load()
        return book
      } catch (err) {
        console.error('Échec de la création du livre', err)
        useUiStore().toast('Impossible de charger — élément introuvable.')
        throw err
      }
    },
    async remove(id: number) {
      await window.encre.books.remove(id)
      await this.load()
    }
  }
})
