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
    async create(bookId: number, title: string): Promise<TimelineEvent> {
      const event = await window.encre.timeline.create(bookId, title)
      this.events.push(event)
      return event
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
    async setLinks(id: number, chapterIds: number[], entityIds: number[]) {
      const seq = (updateSeq.get(id) ?? 0) + 1
      updateSeq.set(id, seq)
      const local = this.events.find((e) => e.id === id)
      try {
        const updated = await window.encre.timeline.setLinks(id, chapterIds, entityIds)
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
    // ne fait que persister l'ordre côté IPC, elle ne mute pas la liste.
    async reorder(orderedIds: number[]) {
      if (this.bookId == null) return
      try {
        await window.encre.timeline.reorder(this.bookId, orderedIds)
      } catch (err) {
        console.error('Échec du réordonnancement de la chronologie', err)
        useUiStore().toast('Échec du réordonnancement.')
      }
    },
    async remove(id: number) {
      const event = this.events.find((e) => e.id === id)
      const label = event?.title ? `« ${event.title} »` : 'cet événement'
      if (!confirm(`Supprimer ${label} ?`)) return
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
