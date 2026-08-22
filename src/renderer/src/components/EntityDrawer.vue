<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useEntitiesStore } from '../stores/entities'
import EntityCard from './EntityCard.vue'
import ConfirmDialog from './ConfirmDialog.vue'

const store = useEntitiesStore()

// Confirmation thémée avant suppression (sweep D3) : stores/entities.ts
// remove() est désormais une suppression pure (plus de window.confirm()
// interne) — chaque appelant, dont ce bouton d'en-tête, doit désormais gater
// lui-même l'appel avec ConfirmDialog.
const pendingRemoval = ref(false)

function removeCurrent(): void {
  if (store.drawerEntityId != null) pendingRemoval.value = true
}

// Idempotent (comme TimelineEventCard.confirmRemoval) : un second appel après
// le premier ne redéclenche pas store.remove, le drapeau étant déjà retombé.
function confirmRemoval(): void {
  if (!pendingRemoval.value) return
  pendingRemoval.value = false
  if (store.drawerEntityId != null) store.remove(store.drawerEntityId)
}

function cancelRemoval(): void {
  pendingRemoval.value = false
}

const removalMessage = computed(() => {
  const name = store.drawerEntity?.name?.trim()
  return `Supprimer ${name ? `« ${name} »` : 'cette fiche'} ?`
})

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

// Le stopPropagation() ci-dessus ne protège que les frappes qui traversent
// CE noeud. À l'ouverture, rien n'a encore le focus à l'intérieur du tiroir
// (le bouton qui l'a ouvert, dans la grille ou une mention, l'a toujours à
// l'extérieur) : une touche Échap pressée juste après l'ouverture partirait
// donc de l'extérieur du tiroir et irait directement à window, sans jamais
// passer par onKeydown. On focus explicitement le tiroir (tabindex="-1" :
// focusable par script, hors du parcours Tab) dès qu'il s'ouvre, pour que ce
// noeud reçoive bien le prochain keydown — même principe que le champ de
// CommandPalette qui s'autofocus à l'ouverture.
const drawerEl = ref<HTMLElement | null>(null)
watch(
  () => store.drawerEntityId,
  async (id) => {
    if (id == null) return
    await nextTick()
    drawerEl.value?.focus()
  }
)
</script>

<template>
  <Transition name="slide">
    <aside
      v-if="store.drawerEntityId != null"
      ref="drawerEl"
      class="drawer"
      role="dialog"
      aria-label="Fiche"
      tabindex="-1"
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
        :occurrences-override="store.occurrences"
      />
      <ConfirmDialog
        v-if="pendingRemoval"
        :message="removalMessage"
        @confirm="confirmRemoval"
        @cancel="cancelRemoval"
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
/* Cible de focus purement programmatique (voir le watch sur drawerEntityId
   dans le script) : pas de bague de focus visible autour de tout le panneau. */
.drawer:focus,
.drawer:focus-visible {
  outline: none;
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
