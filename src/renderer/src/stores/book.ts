import { defineStore } from 'pinia'
import type { Book, Chapter, ChapterMeta, ChapterStatus } from '../../../shared/types'

export const useBookStore = defineStore('book', {
  state: () => ({
    book: null as Book | null,
    chapters: [] as ChapterMeta[],
    currentChapter: null as Chapter | null,
    saveState: 'saved' as 'saved' | 'saving'
  }),
  actions: {
    async open(bookId: number) {
      this.book = await window.encre.books.get(bookId)
      this.chapters = await window.encre.chapters.listByBook(bookId)
      this.currentChapter = null
      if (this.chapters.length > 0) await this.openChapter(this.chapters[0].id)
    },
    async refreshChapters() {
      if (!this.book) return
      this.chapters = await window.encre.chapters.listByBook(this.book.id)
    },
    async openChapter(id: number) {
      this.currentChapter = await window.encre.chapters.get(id)
    },
    async createChapter(title: string) {
      if (!this.book) return
      const meta = await window.encre.chapters.create(this.book.id, title)
      await this.refreshChapters()
      await this.openChapter(meta.id)
    },
    async renameChapter(id: number, title: string) {
      await window.encre.chapters.rename(id, title)
      await this.refreshChapters()
      if (this.currentChapter?.id === id) this.currentChapter.title = title
    },
    async setChapterStatus(id: number, status: ChapterStatus) {
      await window.encre.chapters.setStatus(id, status)
      await this.refreshChapters()
      if (this.currentChapter?.id === id) this.currentChapter.status = status
    },
    async moveChapter(id: number, direction: -1 | 1) {
      if (!this.book) return
      const ids = this.chapters.map((c) => c.id)
      const i = ids.indexOf(id)
      const j = i + direction
      if (i < 0 || j < 0 || j >= ids.length) return
      ;[ids[i], ids[j]] = [ids[j], ids[i]]
      await window.encre.chapters.reorder(this.book.id, ids)
      await this.refreshChapters()
    },
    async removeChapter(id: number) {
      await window.encre.chapters.remove(id)
      if (this.currentChapter?.id === id) this.currentChapter = null
      await this.refreshChapters()
      if (!this.currentChapter && this.chapters.length > 0) {
        await this.openChapter(this.chapters[0].id)
      }
    },
    // Ecrit sur un chapitre précis, même s'il ne s'agit plus du chapitre actif
    // (nécessaire pour que Task 9 puisse purger l'éditeur après un changement
    // de chapitre sans perdre la dernière frappe en attente).
    async saveContentFor(id: number, contentJson: string, contentText: string) {
      this.saveState = 'saving'
      const { wordCount } = await window.encre.chapters.saveContent(id, contentJson, contentText)
      const meta = this.chapters.find((c) => c.id === id)
      if (meta) meta.wordCount = wordCount
      if (this.currentChapter?.id === id) this.currentChapter.wordCount = wordCount
      this.saveState = 'saved'
    },
    async saveContent(contentJson: string, contentText: string) {
      if (this.currentChapter)
        await this.saveContentFor(this.currentChapter.id, contentJson, contentText)
    }
  }
})
