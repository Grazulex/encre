import { defineStore } from 'pinia'
import { useUiStore } from './ui'
import type { Book, BookSection, Chapter, ChapterMeta, ChapterStatus } from '../../../shared/types'

export const useBookStore = defineStore('book', {
  state: () => ({
    book: null as Book | null,
    chapters: [] as ChapterMeta[],
    currentChapter: null as Chapter | null,
    // Section active de l'espace livre (nav de gauche). Les raccourcis de
    // focus/navigation de chapitre (BookView) ne s'appliquent qu'en
    // 'chapitres' : les autres sections sont des placeholders sans éditeur.
    section: 'chapitres' as BookSection,
    // 'dirty' : frappe en attente, minuteur de sauvegarde armé mais pas encore
    // déclenché (l'éditeur seul sait quand une frappe survient : voir
    // EditorPane.markDirty). 'saving' : requête IPC en vol. 'saved' : à jour.
    saveState: 'saved' as 'saved' | 'dirty' | 'saving',
    // Message d'échec de la dernière tentative de sauvegarde, affiché dans la
    // StatusBar tant qu'aucune sauvegarde n'a réussi depuis. null si la
    // dernière tentative (ou aucune tentative) n'a pas échoué.
    saveError: null as string | null
  }),
  actions: {
    markDirty() {
      this.saveState = 'dirty'
    },
    setSection(section: BookSection) {
      this.section = section
    },
    async open(bookId: number) {
      try {
        this.book = await window.encre.books.get(bookId)
        this.chapters = await window.encre.chapters.listByBook(bookId)
        this.currentChapter = null
        this.section = 'chapitres'
        if (this.chapters.length > 0) await this.openChapter(this.chapters[0].id)
      } catch (err) {
        console.error('Échec du chargement du livre', err)
        useUiStore().toast('Impossible de charger — élément introuvable.')
      }
    },
    async refreshChapters() {
      if (!this.book) return
      this.chapters = await window.encre.chapters.listByBook(this.book.id)
    },
    async openChapter(id: number) {
      try {
        this.currentChapter = await window.encre.chapters.get(id)
      } catch (err) {
        console.error('Échec du chargement du chapitre', err)
        useUiStore().toast('Impossible de charger — élément introuvable.')
      }
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
      let wordCount: number
      try {
        ;({ wordCount } = await window.encre.chapters.saveContent(id, contentJson, contentText))
      } catch (err) {
        // On revient à 'dirty' (plutôt que de rester bloqué sur 'saving') pour
        // que la frappe suivante réarme normalement le minuteur de sauvegarde ;
        // saveError reste affiché tant qu'aucune sauvegarde n'a réussi depuis.
        this.saveState = 'dirty'
        this.saveError = "Échec de l'enregistrement — nouvelle tentative…"
        console.error('Échec de sauvegarde', err)
        return
      }
      const meta = this.chapters.find((c) => c.id === id)
      if (meta) meta.wordCount = wordCount
      if (this.currentChapter?.id === id) this.currentChapter.wordCount = wordCount
      this.saveState = 'saved'
      this.saveError = null
    },
    async saveContent(contentJson: string, contentText: string) {
      if (this.currentChapter)
        await this.saveContentFor(this.currentChapter.id, contentJson, contentText)
    }
  }
})
