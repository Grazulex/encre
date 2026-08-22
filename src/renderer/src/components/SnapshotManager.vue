<script setup lang="ts">
// Gestionnaire de snapshots (Task 2) : absorbe l'ancien SnapshotList (section
// repliable dans ClaudePanel) en un popover ouvrable depuis deux endroits —
// le bouton 📸 « Snapshot » de l'en-tête d'EditorPane (qui monte ce composant,
// v-if="ai.snapshotManagerOpen") et le lien « Gérer les snapshots » de
// ClaudePanel (qui se contente d'appeler ai.openSnapshotManager()).
// EditorPane et ClaudePanel sont deux enfants FRÈRES de BookView, jamais l'un
// dans l'arbre de l'autre : l'état d'ouverture est donc porté par le store ai
// (voir ai.snapshotManagerOpen), pas par un ref local à l'un des deux. Toute
// l'écriture (snapshot de l'état courant avant restauration + application du
// contenu restauré + sauvegarde) reste dans EditorPane, jamais ici — ce
// composant ne fait que lister/confirmer/déclencher via ai.restoreSnapshot et
// window.encre.snapshots.remove, exactement comme SnapshotList avant lui pour
// la restauration.
//
// Popover LÉGER plutôt qu'une vraie boîte modale bloquante (choix explicite,
// le brief laissait les deux options ouvertes) : fermeture par Échap ou clic
// extérieur, sans piège de focus complet façon AutolinkDialog/CommandPalette
// (Tab peut atteindre les éléments du fond) — une liste de deux actions
// simples (Restaurer/Supprimer) ne justifie pas de bloquer tout le reste de
// l'interface le temps qu'elle reste ouverte.
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useAiStore } from '../stores/ai'
import { useBookStore } from '../stores/book'
import { useUiStore } from '../stores/ui'
import ConfirmDialog from './ConfirmDialog.vue'
import type { Snapshot } from '../../../shared/types'

const ai = useAiStore()
const store = useBookStore()
const ui = useUiStore()

const cardEl = ref<HTMLElement | null>(null)
const loading = ref(false)
const snapshots = ref<Snapshot[]>([])
// Id du snapshot dont une action (restauration OU suppression) est en cours —
// au plus une à la fois, désactive les deux actions sur TOUTES les lignes
// (comme l'ancien SnapshotList) mais n'affiche le libellé « … » que sur la
// ligne concernée.
const busyId = ref<number | null>(null)

// Badge « IA » (brief) : reason commençant par l'un de ces préfixes vient
// d'une action automatique de l'assistant (insertion, restauration,
// harmonisation T6), pas d'un snapshot manuel pris via le bouton 📸.
const AI_REASON_PREFIXES = ['avant insertion IA', 'avant restauration', 'avant harmonisation']
function isAiSnapshot(reason: string): boolean {
  return AI_REASON_PREFIXES.some((prefix) => reason.startsWith(prefix))
}

async function refresh(): Promise<void> {
  const id = store.currentChapter?.id
  if (id == null) {
    snapshots.value = []
    return
  }
  loading.value = true
  try {
    snapshots.value = await window.encre.snapshots.listByChapter(id)
  } catch (err) {
    console.error('Échec du chargement des snapshots', err)
  } finally {
    loading.value = false
  }
}

// Rafraîchi au montage (à chaque ouverture, puisque v-if démonte/remonte le
// composant — voir EditorPane) et à chaque changement de chapitre tant que le
// popover reste ouvert.
watch(() => store.currentChapter?.id, refresh, { immediate: true })

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
}

function close(): void {
  ai.closeSnapshotManager()
}

// Confirmation thémée (audit UI/UX, sweep D3) : les deux window.confirm()
// natifs (restauration, suppression) sont remplacés par un unique
// ConfirmDialog piloté par `pendingAction` — un seul état à la fois (le
// bouton disabled="busyId != null" empêche déjà d'en armer un second pendant
// qu'une action est en cours), le type distingue le message et l'action à
// exécuter sur confirmation.
const pendingAction = ref<{ type: 'restore' | 'remove'; snapshot: Snapshot } | null>(null)

function requestRestore(snapshot: Snapshot): void {
  if (busyId.value != null) return
  pendingAction.value = { type: 'restore', snapshot }
}
function requestRemove(snapshot: Snapshot): void {
  if (busyId.value != null) return
  pendingAction.value = { type: 'remove', snapshot }
}
function cancelPendingAction(): void {
  pendingAction.value = null
}
// Idempotent (même garde que TimelineEventCard.confirmRemoval) : pendingAction
// est capturé puis remis à null AVANT l'action elle-même — un second appel
// (double clic sur « Supprimer ») après le premier trouve `action` nul et ne
// redéclenche rien.
async function confirmPendingAction(): Promise<void> {
  const action = pendingAction.value
  pendingAction.value = null
  if (!action) return
  if (action.type === 'restore') await restore(action.snapshot)
  else await remove(action.snapshot)
}
const pendingMessage = computed(() => {
  if (!pendingAction.value) return ''
  return pendingAction.value.type === 'restore'
    ? 'Restaurer ce snapshot ? Le contenu actuel du chapitre sera remplacé (un point de restauration sera créé avant, pour pouvoir revenir en arrière).'
    : 'Supprimer ce snapshot ? Cette action est définitive.'
})

async function restore(snapshot: Snapshot): Promise<void> {
  if (busyId.value != null) return
  busyId.value = snapshot.id
  try {
    // Fix 3 (correctif review) : cible le chapitre DU SNAPSHOT, pas
    // ai.chapterId (obsolète si le panneau IA n'est pas monté ou si l'auteur a
    // changé de chapitre depuis) — voir stores/ai.ts.restoreSnapshot.
    const ok = await ai.restoreSnapshot(snapshot.id, snapshot.chapterId)
    if (!ok) ui.toast('Restauration impossible pour ce chapitre.')
    await refresh()
  } catch (err) {
    console.error('Échec de la restauration du snapshot', err)
    ui.toast('Impossible de restaurer ce snapshot.')
  } finally {
    busyId.value = null
  }
}

async function remove(snapshot: Snapshot): Promise<void> {
  if (busyId.value != null) return
  busyId.value = snapshot.id
  try {
    await window.encre.snapshots.remove(snapshot.id)
    await refresh()
  } catch (err) {
    console.error('Échec de la suppression du snapshot', err)
    ui.toast('Impossible de supprimer ce snapshot.')
  } finally {
    busyId.value = null
  }
}

// Autofocus à l'ouverture, même geste que AutolinkDialog/EntityDrawer : pas
// de champ texte ici, on focus donc directement la carte (tabindex="-1") pour
// que le prochain Échap l'atteigne sans clic préalable dans le popover.
onMounted(async () => {
  await nextTick()
  cardEl.value?.focus()
})

// Échap interceptée ICI, propagation stoppée dès ce nœud — même principe que
// CommandPalette/AutolinkDialog/EntityDrawer, pour ne jamais laisser Échap
// atteindre le listener global de mode focus tant que le popover est ouvert.
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close()
  }
}
</script>

<template>
  <Transition name="dialog" appear>
  <div class="snap-overlay" @click.self="close">
    <div
      ref="cardEl"
      class="snap-card"
      role="dialog"
      aria-label="Gérer les snapshots"
      tabindex="-1"
      @keydown="onKeydown"
    >
      <header>
        <h2>Snapshots du chapitre</h2>
        <button
          type="button"
          class="snap-close"
          title="Fermer"
          aria-label="Fermer le gestionnaire de snapshots"
          @click="close"
        >
          ×
        </button>
      </header>
      <div class="body">
        <p v-if="loading" class="status">Chargement…</p>
        <p v-else-if="snapshots.length === 0" class="status">Aucun snapshot pour ce chapitre.</p>
        <ul v-else class="list">
          <li v-for="snapshot in snapshots" :key="snapshot.id" class="item">
            <div class="meta">
              <div class="meta-top">
                <span class="date">{{ formatDate(snapshot.createdAt) }}</span>
                <span v-if="isAiSnapshot(snapshot.reason)" class="badge-ia">IA</span>
              </div>
              <span class="reason">{{ snapshot.reason }}</span>
            </div>
            <div class="actions">
              <button type="button" :disabled="busyId != null" @click="requestRestore(snapshot)">
                {{ busyId === snapshot.id ? '…' : 'Restaurer' }}
              </button>
              <button
                type="button"
                class="danger"
                :disabled="busyId != null"
                @click="requestRemove(snapshot)"
              >
                {{ busyId === snapshot.id ? '…' : 'Supprimer' }}
              </button>
            </div>
          </li>
        </ul>
      </div>
    </div>
  </div>
  </Transition>
  <!-- .confirm-lift : .snap-overlay ci-dessus a un z-index de 220, au-dessus
       du z-index 200 partagé par ConfirmDialog (theme.css .overlay) — sans ce
       wrapper, les deux calques `position: fixed` sont peints selon leur
       z-index (220 > 200), pas selon l'ordre DOM, et le popover masquerait
       visuellement la confirmation bien qu'elle reste « après » lui dans le
       template. Ce wrapper ouvre son propre contexte d'empilement local
       au-dessus des deux, sans toucher au z-index partagé (qui resterait
       inchangé pour tous les autres dialogues de l'app). -->
  <div v-if="pendingAction" class="confirm-lift">
    <ConfirmDialog
      :message="pendingMessage"
      :confirm-label="pendingAction.type === 'restore' ? 'Restaurer' : 'Supprimer'"
      @confirm="confirmPendingAction"
      @cancel="cancelPendingAction"
    />
  </div>
</template>

<style scoped>
/* Voir le commentaire dans le template : isole ConfirmDialog dans son propre
   contexte d'empilement, au-dessus de .snap-overlay (z-index 220) quelle que
   soit sa propre valeur de z-index (200, partagée avec les autres
   dialogues). */
.confirm-lift {
  position: relative;
  z-index: 300;
}

.snap-overlay {
  position: fixed;
  inset: 0;
  z-index: 220;
  /* Popover léger : pas de fond assombri façon AutolinkDialog/CommandPalette
     (voir commentaire du script) — ce calque transparent ne sert qu'à
     détecter le clic extérieur via @click.self. */
  background: transparent;
}

.snap-card {
  position: absolute;
  top: 60px;
  right: 24px;
  width: 360px;
  max-width: calc(100vw - 48px);
  max-height: min(70vh, 520px);
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 20px 48px -16px color-mix(in srgb, var(--fg) 40%, transparent);
  overflow: hidden;
}
.snap-card:focus,
.snap-card:focus-visible {
  outline: none;
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
header h2 {
  font-size: 13px;
  font-weight: 600;
}
.snap-close {
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
.snap-close:hover {
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
  padding: 8px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.meta-top {
  display: flex;
  align-items: center;
  gap: 6px;
}
.date {
  font-size: 12px;
  color: var(--fg);
}
.badge-ia {
  flex-shrink: 0;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 15%, transparent);
  border-radius: 4px;
  padding: 1px 5px;
}
.reason {
  font-size: 11px;
  color: var(--fg-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions {
  flex-shrink: 0;
  display: flex;
  gap: 4px;
}
.actions button {
  font-size: 11px;
  padding: 4px 8px;
  color: var(--fg-muted);
}
.actions button:hover:not(:disabled) {
  color: var(--accent);
  border-color: var(--accent);
}
.actions button.danger:hover:not(:disabled) {
  color: var(--danger);
  border-color: var(--danger);
}
</style>
