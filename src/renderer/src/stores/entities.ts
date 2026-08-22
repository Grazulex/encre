import { defineStore } from 'pinia'
import { useUiStore } from './ui'
import type { Entity, EntityKind, EntityOccurrence, EntityPatch } from '../../../shared/types'

export const useEntitiesStore = defineStore('entities', {
  state: () => ({
    entities: [] as Entity[],
    // Fiche affichée dans le tiroir droit (Task 11 : ouverte depuis une
    // mention dans l'éditeur ; aussi ouverte depuis une carte de la grille).
    drawerEntityId: null as number | null,
    occurrences: [] as EntityOccurrence[]
  }),
  getters: {
    drawerEntity: (state): Entity | null =>
      state.entities.find((e) => e.id === state.drawerEntityId) ?? null
  },
  actions: {
    // Charge les deux natures (personnages + lieux) d'un coup : appelé une
    // seule fois par BookView.open, pas paresseusement à l'entrée de section
    // (Task 11/12 en ont besoin dès que l'éditeur est visible).
    async load(bookId: number) {
      try {
        this.entities = await window.encre.entities.listByBook(bookId)
      } catch (err) {
        console.error('Échec du chargement des fiches', err)
        useUiStore().toast('Impossible de charger les fiches.')
      }
    },
    async create(bookId: number, kind: EntityKind, name: string): Promise<Entity> {
      const entity = await window.encre.entities.create({ bookId, kind, name })
      this.entities.push(entity)
      return entity
    },
    // Optimiste : le champ édité est déjà visible à l'écran avant même l'appel
    // (EntityCard lit/écrit directement l'objet réactif du store). On ne
    // réconcilie ici que les clés du patch envoyé, jamais l'entité entière
    // renvoyée par le serveur : chaque champ a son propre debounce (600 ms,
    // côté composant) et un patch "name" qui aboutit ne doit pas écraser des
    // frappes en cours, pas encore débouncées, dans "notes" ou "attributes"
    // du même instant.
    async update(id: number, patch: EntityPatch) {
      const local = this.entities.find((e) => e.id === id)
      try {
        const updated = await window.encre.entities.update(id, patch)
        if (local) {
          for (const key of Object.keys(patch) as (keyof EntityPatch)[]) {
            ;(local as Record<string, unknown>)[key] = updated[key]
          }
        }
      } catch (err) {
        console.error('Échec de la sauvegarde de la fiche', err)
        useUiStore().toast("Échec de l'enregistrement de la fiche.")
      }
    },
    async remove(id: number) {
      const entity = this.entities.find((e) => e.id === id)
      const label = entity ? `« ${entity.name} »` : 'cette fiche'
      if (!confirm(`Supprimer ${label} ?`)) return
      await window.encre.entities.remove(id)
      this.entities = this.entities.filter((e) => e.id !== id)
      if (this.drawerEntityId === id) this.closeDrawer()
    },
    async openDrawer(id: number) {
      this.drawerEntityId = id
      try {
        this.occurrences = await window.encre.entities.occurrences(id)
      } catch (err) {
        console.error('Échec du chargement des occurrences', err)
        this.occurrences = []
      }
    },
    closeDrawer() {
      this.drawerEntityId = null
      this.occurrences = []
    },
    async pickImage(id: number) {
      try {
        const updated = await window.encre.entities.pickImage(id)
        const local = this.entities.find((e) => e.id === id)
        if (local) local.imagePath = updated.imagePath
      } catch (err) {
        console.error("Échec de la sélection de l'image", err)
        useUiStore().toast("Impossible de charger l'image.")
      }
    }
  }
})
