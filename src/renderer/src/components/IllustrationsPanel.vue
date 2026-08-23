<script setup lang="ts">
// Panneau « Illustrations » (Task 7) : bibliothèque d'images du livre,
// ouverte depuis le bouton de l'en-tête d'EditorPane. Modelé sur
// SnapshotManager.vue (même famille visuelle : popover léger ancré en haut à
// droite, fermeture par Échap ou clic extérieur, pas de fond assombri) plutôt
// que sur une boîte modale bloquante façon ConfirmDialog — cohérent avec le
// choix déjà fait pour les snapshots, et pour la même raison : consulter/
// insérer une illustration ne doit pas empêcher de continuer à lire le
// chapitre affiché derrière.
//
// « Insérer » n'émet qu'un événement vers EditorPane (seul détenteur de
// l'instance d'éditeur TipTap) et NE ferme PAS le panneau — le brief prévoit
// explicitement d'insérer plusieurs planches à la suite sans avoir à rouvrir.
import { computed, nextTick, ref, onMounted } from 'vue'
import type { Illustration } from '../../../shared/types'
import { mediaUrl } from '../utils/media'
import ConfirmDialog from './ConfirmDialog.vue'

const props = defineProps<{ bookId: number }>()
const emit = defineEmits<{ close: []; insert: [ill: Illustration] }>()

const cardEl = ref<HTMLElement | null>(null)
const illustrations = ref<Illustration[]>([])
const loading = ref(false)
const adding = ref(false)
// Id de la ligne dont une action asynchrone (vérification d'usage avant
// suppression) est en cours — désactive le bouton Supprimer de cette ligne
// uniquement, même esprit que busyId dans SnapshotManager mais sans bloquer
// les autres lignes (rename/insert restent utilisables pendant ce temps).
const checkingUsageId = ref<number | null>(null)

async function reload(): Promise<void> {
  loading.value = true
  try {
    illustrations.value = await window.encre.illustrations.listByBook(props.bookId)
  } finally {
    loading.value = false
  }
}
onMounted(reload)

async function add(): Promise<void> {
  if (adding.value) return
  adding.value = true
  try {
    await window.encre.illustrations.add(props.bookId)
    await reload()
  } finally {
    adding.value = false
  }
}

async function rename(ill: Illustration, event: Event): Promise<void> {
  const displayName = (event.target as HTMLInputElement).value.trim()
  if (!displayName || displayName === ill.displayName) return
  await window.encre.illustrations.rename(ill.id, displayName)
  await reload()
}

function insert(ill: Illustration): void {
  emit('insert', ill)
}

// Suppression : usage() d'abord (nb de chapitres où le fichier est déjà
// inséré), puis ConfirmDialog dont le message s'enrichit de ce compte —
// jamais de suppression directe sans cette vérification, un fichier retiré de
// la bibliothèque laisse les nœuds déjà insérés orphelins (cadre vide, voir
// illustration.ts).
const pendingRemoval = ref<{ ill: Illustration; usage: number } | null>(null)

async function requestRemove(ill: Illustration): Promise<void> {
  if (checkingUsageId.value != null) return
  checkingUsageId.value = ill.id
  try {
    const usage = await window.encre.illustrations.usage(ill.id)
    pendingRemoval.value = { ill, usage }
  } finally {
    checkingUsageId.value = null
  }
}

function cancelRemoval(): void {
  pendingRemoval.value = null
}

async function confirmRemoval(): Promise<void> {
  const pending = pendingRemoval.value
  pendingRemoval.value = null
  if (!pending) return
  await window.encre.illustrations.remove(pending.ill.id)
  await reload()
}

const removalMessage = computed(() => {
  if (!pendingRemoval.value) return ''
  const { ill, usage } = pendingRemoval.value
  let message = `Supprimer « ${ill.displayName} » ?`
  if (usage > 0) {
    message += ` Utilisée dans ${usage} chapitre${usage > 1 ? 's' : ''} : les images déjà insérées afficheront un cadre vide.`
  }
  return message
})

function close(): void {
  emit('close')
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close()
  }
}

onMounted(async () => {
  await nextTick()
  cardEl.value?.focus()
})
</script>

<template>
  <Transition name="dialog" appear>
    <div class="illus-overlay" @click.self="close">
      <div
        ref="cardEl"
        class="illus-card"
        role="dialog"
        aria-label="Illustrations du livre"
        tabindex="-1"
        @keydown="onKeydown"
      >
        <header>
          <h2>Illustrations</h2>
          <button type="button" :disabled="adding" @click="add">
            {{ adding ? 'Ajout…' : 'Ajouter…' }}
          </button>
          <button
            type="button"
            class="illus-close"
            title="Fermer"
            aria-label="Fermer le panneau des illustrations"
            @click="close"
          >
            ×
          </button>
        </header>
        <div class="body">
          <p v-if="loading" class="status">Chargement…</p>
          <p v-else-if="illustrations.length === 0" class="status">
            Aucune illustration. Ajoutez des fichiers PNG, JPG ou WebP à la bibliothèque de ce
            livre.
          </p>
          <ul v-else class="list">
            <li v-for="ill in illustrations" :key="ill.id" class="item">
              <img
                class="thumb"
                :src="mediaUrl(ill.fileName) ?? undefined"
                :alt="ill.displayName"
              />
              <div class="meta">
                <input
                  class="name-input"
                  :value="ill.displayName"
                  spellcheck="false"
                  @change="rename(ill, $event)"
                />
              </div>
              <div class="actions">
                <button type="button" class="primary" @click="insert(ill)">Insérer</button>
                <button
                  type="button"
                  class="danger"
                  :disabled="checkingUsageId === ill.id"
                  @click="requestRemove(ill)"
                >
                  {{ checkingUsageId === ill.id ? '…' : 'Supprimer' }}
                </button>
              </div>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </Transition>
  <div v-if="pendingRemoval" class="confirm-lift">
    <ConfirmDialog
      :message="removalMessage"
      confirm-label="Supprimer"
      @confirm="confirmRemoval"
      @cancel="cancelRemoval"
    />
  </div>
</template>

<style scoped>
/* Isole ConfirmDialog dans son propre contexte d'empilement, au-dessus de
   .illus-overlay (z-index 220) quelle que soit sa propre valeur de z-index
   (200, partagée avec les autres dialogues) — même correctif que
   SnapshotManager (voir son commentaire). */
.confirm-lift {
  position: relative;
  z-index: 300;
}

.illus-overlay {
  position: fixed;
  inset: 0;
  z-index: 220;
  background: transparent;
}

.illus-card {
  position: absolute;
  top: 60px;
  right: 24px;
  width: 420px;
  max-width: calc(100vw - 48px);
  max-height: min(75vh, 620px);
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 20px 48px -16px color-mix(in srgb, var(--fg) 40%, transparent);
  overflow: hidden;
}
.illus-card:focus,
.illus-card:focus-visible {
  outline: none;
}

header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
header h2 {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
}
header button:not(.illus-close) {
  font-size: 12px;
  padding: 5px 10px;
}
.illus-close {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  padding: 0;
  display: grid;
  place-items: center;
  border-radius: 50%;
  border-color: transparent;
  font-size: 14px;
  line-height: 1;
  color: var(--fg-muted);
}
.illus-close:hover {
  border-color: var(--fg-muted);
  color: var(--fg);
}

.body {
  overflow-y: auto;
  padding: 10px;
  flex: 1;
  min-height: 0;
}

.status {
  padding: 10px 4px;
  font-size: 12.5px;
  color: var(--fg-muted);
}

.list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.thumb {
  flex-shrink: 0;
  width: 72px;
  height: 72px;
  object-fit: cover;
  border-radius: 6px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
}

.meta {
  flex: 1;
  min-width: 0;
}
.name-input {
  width: 100%;
  font-size: 12.5px;
  padding: 5px 7px;
}

.actions {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.actions button {
  font-size: 11px;
  padding: 4px 8px;
  white-space: nowrap;
}
.actions button.danger {
  color: var(--fg-muted);
}
.actions button.danger:hover:not(:disabled) {
  color: var(--danger);
  border-color: var(--danger);
}
</style>
