import { defineStore } from 'pinia'
import { useUiStore } from './ui'
import type { Entity, EntityKind, EntityOccurrence, EntityPatch } from '../../../shared/types'

// Compteur de séquence par entité (hors état réactif : c'est un garde-fou
// interne, pas une donnée d'affichage). Deux update() rapprochés sur la même
// fiche — p. ex. ajout d'alias puis suppression d'un attribut, ni l'un ni
// l'autre débouncé — peuvent voir leurs réponses IPC revenir dans le
// désordre. On ne réconcilie que la réponse de la DERNIÈRE requête émise
// pour cette fiche ; une réponse plus ancienne arrivée en retard est
// silencieusement ignorée plutôt que d'écraser un état local plus récent.
const updateSeq = new Map<number, number>()

export const useEntitiesStore = defineStore('entities', {
  state: () => ({
    entities: [] as Entity[],
    // Fiche affichée dans le tiroir droit (Task 11 : ouverte depuis une
    // mention dans l'éditeur ; aussi ouverte depuis une carte de la grille).
    drawerEntityId: null as number | null,
    occurrences: [] as EntityOccurrence[],
    // Fiche affichée dans le corps de la section personnages/lieux (Task 15,
    // motif maître-détail : la liste vit dans l'aside — EntityList —, la
    // fiche sélectionnée dans le corps — EntitiesSection). Indépendant de
    // drawerEntityId : le tiroir reste réservé aux ouvertures contextuelles
    // depuis l'éditeur (mentions/chips), jamais synchronisé avec cette
    // sélection.
    selectedId: null as number | null
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
      // Réinitialisé par livre : une fiche sélectionnée dans le livre
      // précédent n'a aucun sens une fois basculé sur un autre livre (load()
      // n'est appelé qu'une fois par ouverture de livre, voir BookView).
      this.selectedId = null
      try {
        this.entities = await window.encre.entities.listByBook(bookId)
      } catch (err) {
        console.error('Échec du chargement des fiches', err)
        useUiStore().toast('Impossible de charger les fiches.')
      }
    },
    select(id: number | null) {
      this.selectedId = id
    },
    async create(bookId: number, kind: EntityKind, name: string): Promise<Entity | null> {
      try {
        const entity = await window.encre.entities.create({ bookId, kind, name })
        this.entities.push(entity)
        return entity
      } catch (err) {
        console.error('Échec de la création de la fiche', err)
        useUiStore().toast('Impossible de créer la fiche.')
        return null
      }
    },
    // Optimiste : le champ édité est déjà visible à l'écran avant même l'appel
    // (EntityCard lit/écrit directement l'objet réactif du store). On ne
    // réconcilie ici que les clés du patch envoyé, jamais l'entité entière
    // renvoyée par le serveur : chaque champ a son propre debounce (600 ms,
    // côté composant) et un patch "name" qui aboutit ne doit pas écraser des
    // frappes en cours, pas encore débouncées, dans "notes" ou "attributes"
    // du même instant.
    async update(id: number, patch: EntityPatch) {
      const seq = (updateSeq.get(id) ?? 0) + 1
      updateSeq.set(id, seq)
      const local = this.entities.find((e) => e.id === id)
      try {
        const updated = await window.encre.entities.update(id, patch)
        // N'applique la réconciliation que si aucune requête plus récente
        // n'a été émise entre-temps pour cette même fiche (sinon, réponse
        // périmée : on la laisse tomber).
        if (local && updateSeq.get(id) === seq) {
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
      if (this.selectedId === id) this.selectedId = null
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
