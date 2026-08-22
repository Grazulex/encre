<script setup lang="ts">
import { useEntitiesStore } from '../stores/entities'
import EntityCard from './EntityCard.vue'

const store = useEntitiesStore()

function removeCurrent(): void {
  if (store.drawerEntityId != null) store.remove(store.drawerEntityId)
}

// Échap est intercepté ICI, sur le conteneur du tiroir, en phase bulle (donc
// avant window) : quelle que soit la frappe qui déclenche l'événement (un
// champ de EntityCard ou le tiroir lui-même), il traverse ce noeud avant
// d'atteindre le listener global de useShortcuts (BookView, mode focus).
// stopPropagation() ici l'empêche d'y arriver tant que le tiroir est ouvert —
// même geste que CommandPalette.onKeydown pour Échap.
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    store.closeDrawer()
  }
}
</script>

<template>
  <Transition name="slide">
    <aside
      v-if="store.drawerEntityId != null"
      class="drawer"
      role="dialog"
      aria-label="Fiche"
      @keydown="onKeydown"
    >
      <div class="drawer-head">
        <button class="remove" type="button" @click="removeCurrent">Supprimer la fiche</button>
        <button
          class="close"
          type="button"
          title="Fermer"
          aria-label="Fermer le tiroir"
          @click="store.closeDrawer()"
        >
          ×
        </button>
      </div>
      <EntityCard
        :key="store.drawerEntityId"
        :entity-id="store.drawerEntityId"
        compact
        :occurrences-override="store.occurrences"
      />
    </aside>
  </Transition>
</template>

<style scoped>
.drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 340px;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border-left: 1px solid var(--border);
  box-shadow: -12px 0 32px -20px color-mix(in srgb, var(--fg) 45%, transparent);
  overflow-y: auto;
  z-index: 150;
}

.drawer-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.remove {
  border-color: transparent;
  color: var(--fg-muted);
  font-size: 12px;
  padding: 4px 8px;
}
.remove:hover {
  color: var(--accent);
  border-color: var(--accent);
}
.close {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  padding: 0;
  font-size: 15px;
  line-height: 1;
  color: var(--fg-muted);
  flex-shrink: 0;
}
.close:hover {
  color: var(--fg);
  border-color: var(--fg-muted);
}

.slide-enter-active,
.slide-leave-active {
  transition: transform 0.2s ease;
}
.slide-enter-from,
.slide-leave-to {
  transform: translateX(100%);
}
</style>
