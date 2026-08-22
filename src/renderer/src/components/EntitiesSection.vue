<script setup lang="ts">
// Corps de la section personnages/lieux (Task 15, motif maître-détail) :
// affiche la fiche sélectionnée dans EntityList (aside), ou un état vide si
// aucune sélection. La liste et la création vivent désormais dans EntityList
// — cette section ne fait plus que présenter le détail.
import { computed } from 'vue'
import { useEntitiesStore } from '../stores/entities'
import type { EntityKind } from '../../../shared/types'
import EntityCard from './EntityCard.vue'

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
    <div v-if="selected" class="detail">
      <EntityCard :entity-id="selected.id" />
    </div>
    <p v-else class="empty">Sélectionnez ou créez une fiche.</p>
  </div>
</template>

<style scoped>
.section {
  padding: 28px 36px 48px;
  height: 100vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.detail {
  width: 100%;
  max-width: 44rem;
}

.empty {
  margin: auto;
  color: var(--fg-muted);
  font-size: 13px;
  text-align: center;
}
</style>
