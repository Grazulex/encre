<script setup lang="ts">
// Corps de la section personnages/lieux (Task 15, motif maître-détail ; Task
// D3, retour utilisateur) : affiche la fiche sélectionnée dans EntityList
// (aside) en PLEINE PAGE via EntityPage, ou un état vide si aucune sélection.
// EntityCard (l'ancienne carte de grille) reste utilisée ailleurs (tiroir de
// quick-peek, EntityDrawer) mais plus ici — elle ne remplissait qu'une petite
// portion de l'espace disponible à droite, héritage de l'époque où la liste
// vivait dans ce même volet (avant son déplacement à gauche).
//
// :key="selected.id" (contrairement à l'ancien <EntityCard> sans clé) : une
// instance d'EntityPage par fiche, démontée/remontée au changement de
// sélection plutôt que réutilisée — voir le commentaire d'en-tête de
// useEntityFieldEditor pour ce que cette clé simplifie côté logique de champ.
import { computed } from 'vue'
import { useEntitiesStore } from '../stores/entities'
import type { EntityKind } from '../../../shared/types'
import EntityPage from './EntityPage.vue'

const props = defineProps<{ kind: EntityKind }>()

const store = useEntitiesStore()

// Ne montre la fiche que si elle correspond bien à la nature de la section
// active : en changeant de section (personnages → lieux), une sélection
// faite dans l'autre liste ne doit jamais s'afficher ici — l'utilisateur
// retrouve l'état vide tant qu'il n'a pas choisi ou créé une fiche du bon
// type dans la nouvelle liste.
const selected = computed(() => {
  const entity = store.entities.find((e) => e.id === store.selectedId)
  return entity && entity.kind === props.kind ? entity : null
})
</script>

<template>
  <div class="section">
    <EntityPage v-if="selected" :key="selected.id" :entity-id="selected.id" />
    <p v-else class="empty">Sélectionnez ou créez une fiche.</p>
  </div>
</template>

<style scoped>
.section {
  height: 100vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.empty {
  margin: auto;
  color: var(--fg-muted);
  font-size: 13px;
  text-align: center;
}
</style>
