import { defineStore } from 'pinia'
import { useUiStore } from './ui'
import type { TimelineEvent, TimelineEventPatch } from '../../../shared/types'

// Compteur de séquence par événement — même garde-fou que useEntitiesStore
// (voir stores/entities.ts) : deux update()/setLinks() rapprochés sur le
// même événement peuvent voir leurs réponses IPC revenir dans le désordre.
// On ne réconcilie que la réponse de la DERNIÈRE requête émise pour cet id ;
// une réponse plus ancienne arrivée en retard est silencieusement ignorée.
const updateSeq = new Map<number, number>()

export const useTimelineStore = defineStore('timeline', {
  state: () => ({
    events: [] as TimelineEvent[],
    // Retenu à load() pour que reorder(orderedIds) — signature imposée par
    // le brief, sans bookId — sache où persister sans que l'appelant ait à
    // le refournir à chaque glisser-déposer.
    bookId: null as number | null
  }),
  actions: {
    async load(bookId: number) {
      this.bookId = bookId
      try {
        this.events = await window.encre.timeline.listByBook(bookId)
      } catch (err) {
        console.error('Échec du chargement de la chronologie', err)
        useUiStore().toast('Impossible de charger la chronologie.')
      }
    },
    async create(bookId: number, title: string): Promise<TimelineEvent | null> {
      try {
        const event = await window.encre.timeline.create(bookId, title)
        this.events.push(event)
        return event
      } catch (err) {
        console.error("Échec de la création de l'événement", err)
        useUiStore().toast("Impossible de créer l'événement.")
        return null
      }
    },
    // Optimiste : le champ édité est déjà visible à l'écran avant l'appel
    // (TimelineEventCard lit/écrit directement l'objet réactif du store).
    // On ne réconcilie ici que les clés du patch envoyé, jamais l'événement
    // entier renvoyé par le serveur — chaque champ a son propre debounce
    // (600 ms, côté composant), un patch "title" qui aboutit ne doit pas
    // écraser une frappe en cours, pas encore débouncée, dans "description".
    async update(id: number, patch: TimelineEventPatch) {
      const seq = (updateSeq.get(id) ?? 0) + 1
      updateSeq.set(id, seq)
      const local = this.events.find((e) => e.id === id)
      try {
        const updated = await window.encre.timeline.update(id, patch)
        if (local && updateSeq.get(id) === seq) {
          for (const key of Object.keys(patch) as (keyof TimelineEventPatch)[]) {
            ;(local as Record<string, unknown>)[key] = updated[key]
          }
        }
      } catch (err) {
        console.error("Échec de la sauvegarde de l'événement", err)
        useUiStore().toast("Échec de l'enregistrement de l'événement.")
      }
    },
    // Immédiat (pas de debounce : des cases à cocher, pas une frappe), mais
    // toujours protégé par le même garde de séquence — deux (dé)cochages
    // rapprochés sur le même événement ne doivent pas se doubler.
    //
    // Clonage défensif à LA FRONTIÈRE IPC : `ipcRenderer.invoke` sérialise ses
    // arguments avec l'algorithme de clonage structuré, qui échoue sur un
    // Proxy (« could not be cloned ») — or TimelineEventCard.toggleXLink
    // construit le tableau modifié en clair (filter/spread) mais transmet
    // l'AUTRE tableau tel quel (`event.value.chapterIds`/`entityIds`), une
    // référence directe vers un tableau réactif Pinia, donc un Proxy. D'où
    // l'échec systématique observé en pratique (toast à chaque coche) alors
    // que la logique de liaison elle-même était correcte. On clone ICI, à la
    // frontière du store, plutôt que côté appelant : aucun futur appelant de
    // setLinks (ou de reorder ci-dessous) ne peut réintroduire ce bug.
    async setLinks(id: number, chapterIds: number[], entityIds: number[]) {
      const seq = (updateSeq.get(id) ?? 0) + 1
      updateSeq.set(id, seq)
      const local = this.events.find((e) => e.id === id)
      try {
        const updated = await window.encre.timeline.setLinks(id, [...chapterIds], [...entityIds])
        if (local && updateSeq.get(id) === seq) {
          local.chapterIds = updated.chapterIds
          local.entityIds = updated.entityIds
        }
      } catch (err) {
        console.error('Échec de la sauvegarde des liens', err)
        useUiStore().toast("Échec de l'enregistrement des liens.")
      }
    },
    // L'appelant (TimelineSection : glisser-déposer ou boutons ↑/↓) a déjà
    // réordonné `events` localement avant d'appeler reorder — cette action
    // ne fait que persister l'ordre côté IPC, elle ne mute pas la liste en cas
    // de succès. En cas d'échec, l'ordre local ne reflète plus l'ordre
    // persisté : on resynchronise depuis le serveur (load) plutôt que de
    // tenter un rollback manuel (plus simple et plus sûr — le serveur reste
    // la source de vérité).
    async reorder(orderedIds: number[]) {
      if (this.bookId == null) return
      try {
        // Même clonage défensif que setLinks ci-dessus : tous les appelants
        // actuels (TimelineSection, TimelineEventCard) construisent déjà
        // `orderedIds` via `.map()` (donc un tableau déjà plain), mais rien
        // n'empêche un futur appelant de transmettre directement un tableau
        // réactif — cloner ici plutôt que de compter sur chaque appelant.
        await window.encre.timeline.reorder(this.bookId, [...orderedIds])
      } catch (err) {
        console.error('Échec du réordonnancement de la chronologie', err)
        useUiStore().toast('Échec du réordonnancement.')
        await this.load(this.bookId)
      }
    },
    // Confirmation déplacée au niveau du composant appelant (audit UI/UX,
    // proposition #13) : TimelineEventCard affiche désormais ConfirmDialog
    // (thémé) avant d'appeler cette action, qui ne fait plus que la
    // suppression elle-même — un store Pinia n'a pas de template pour monter
    // une boîte de dialogue.
    async remove(id: number) {
      try {
        await window.encre.timeline.remove(id)
        this.events = this.events.filter((e) => e.id !== id)
      } catch (err) {
        console.error("Échec de la suppression de l'événement", err)
        useUiStore().toast("Échec de la suppression de l'événement.")
      }
    }
  }
})
