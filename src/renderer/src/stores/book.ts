import { defineStore } from 'pinia'
import { useUiStore } from './ui'
import type {
  Book,
  BookPatch,
  BookSection,
  Chapter,
  ChapterMeta,
  ChapterStatus
} from '../../../shared/types'

// Garde de séquence par livre (même principe que entities.ts) : deux champs
// du panneau d'édition du livre (BookSettingsPanel) sauvegardés à des
// instants différents ne doivent jamais voir la réponse la plus ancienne
// écraser un état local plus récent posé par l'autre champ entre-temps.
const bookUpdateSeq = new Map<number, number>()

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
    // Fiche du livre (Task 15, BookSettingsPanel) : chaque champ a son propre
    // minuteur de débounce côté composant, comme EntityCard.onXInput. Ici, on
    // ne réconcilie que les clés du patch envoyé — jamais le livre entier
    // renvoyé par le serveur — pour ne pas écraser un autre champ en cours de
    // frappe (voir entities.update pour le même raisonnement).
    async update(patch: BookPatch) {
      if (!this.book) return
      const id = this.book.id
      const seq = (bookUpdateSeq.get(id) ?? 0) + 1
      bookUpdateSeq.set(id, seq)
      try {
        const updated = await window.encre.books.update(id, patch)
        if (this.book && this.book.id === id && bookUpdateSeq.get(id) === seq) {
          for (const key of Object.keys(patch) as (keyof BookPatch)[]) {
            ;(this.book as Record<string, unknown>)[key] = updated[key]
          }
          // seriesId n'est qu'une clé étrangère : le nom affiché (seriesName,
          // recalculé côté serveur via jointure) n'est jamais une clé du
          // patch envoyé, donc la boucle ci-dessus ne le touche pas — sans
          // ce cas spécial, changer/effacer la série laisserait l'ancien nom
          // affiché (aside, badge de carte) jusqu'au prochain rechargement.
          if ('seriesId' in patch) this.book.seriesName = updated.seriesName
        }
      } catch (err) {
        console.error('Échec de la sauvegarde du livre', err)
        useUiStore().toast("Échec de l'enregistrement du livre.")
      }
    },
    async pickCover() {
      if (!this.book) return
      try {
        const updated = await window.encre.books.pickCover(this.book.id)
        this.book.coverPath = updated.coverPath
      } catch (err) {
        console.error('Échec de la sélection de la couverture', err)
        useUiStore().toast("Impossible de charger l'image.")
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
    // Import d'un fichier .md isolé comme nouveau chapitre (Task 8b) — le
    // dialog peut être annulé (retour null, silencieux) ; un échec de lecture
    // ou de conversion remonte un toast dédié, distinct de l'échec générique
    // de chargement utilisé ailleurs dans ce store.
    async importChapter() {
      if (!this.book) return
      try {
        const meta = await window.encre.importer.importChapter(this.book.id)
        if (!meta) return
        await this.refreshChapters()
        await this.openChapter(meta.id)
        useUiStore().toast(`« ${meta.title} » importé.`)
      } catch (err) {
        console.error("Échec de l'import du chapitre", err)
        useUiStore().toast("Échec de l'import du fichier Markdown.")
      }
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
      if (this.currentChapter?.id === id) {
        this.currentChapter.wordCount = wordCount
        this.currentChapter.contentJson = contentJson
        this.currentChapter.contentText = contentText
      }
      this.saveState = 'saved'
      this.saveError = null
    },
    async saveContent(contentJson: string, contentText: string) {
      if (this.currentChapter)
        await this.saveContentFor(this.currentChapter.id, contentJson, contentText)
    },
    // Résumé manuel (Task 13) : prioritaire sur un résumé auto pour le plan 3.
    // Écrit sur un id précis (comme saveContentFor) car l'appelant (zone
    // repliable de l'éditeur) peut viser le chapitre qui vient d'être quitté ;
    // on ne réconcilie currentChapter que si c'est encore le même id.
    async saveSummary(id: number, summary: string) {
      try {
        await window.encre.chapters.saveSummary(id, summary)
        if (this.currentChapter?.id === id) this.currentChapter.summary = summary
      } catch (err) {
        console.error('Échec de la sauvegarde du résumé', err)
        useUiStore().toast("Échec de l'enregistrement du résumé.")
      }
    }
  }
})
