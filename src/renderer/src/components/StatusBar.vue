<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useBookStore } from '../stores/book'
import { useBackupStore } from '../stores/backup'
import { backupIndicator } from '../../../shared/backupIndicator'
import { parseWordGoal } from '../../../shared/wordGoal'
import { useRouter } from 'vue-router'

const store = useBookStore()
const backup = useBackupStore()
const router = useRouter()
const sessionStart = ref<Map<number, number>>(new Map())

const SAVE_LABELS: Record<'dirty' | 'saving' | 'saved', string> = {
  dirty: 'Modifié',
  saving: 'Enregistrement…',
  saved: 'Enregistré'
}

watch(
  () => store.currentChapter?.id,
  (id) => {
    if (id != null && store.currentChapter && !sessionStart.value.has(id)) {
      sessionStart.value.set(id, store.currentChapter.wordCount)
    }
  },
  { immediate: true }
)

const sessionWords = computed(() => {
  let total = 0
  for (const [id, start] of sessionStart.value) {
    const meta = store.chapters.find((c) => c.id === id)
    if (meta) total += meta.wordCount - start
  }
  return total
})

onMounted(() => backup.startPolling())
onUnmounted(() => backup.stopPolling())

// Depuis le BackupStatus complet, et pas seulement `pending` : c'est le seul
// indicateur visible pendant l'écriture, le bloc qui détaille les états
// dégradés ne vivant que sur la route Bibliothèque. `refreshFailed` y entre
// aussi, pour ne pas faire passer un état périmé pour l'état courant.
const backupState = computed(() => backupIndicator(backup.status, backup.refreshFailed))

// Objectif de mots du chapitre courant : une cible modifiable INLINE dans la
// barre (retour au plus simple après le popover « Enregistrer » qui perdait
// son clic — édition inline = aucun élément flottant à intercepter : on clique
// le %, on tape, Entrée ou perte de focus valide, Échap annule).
const currentChapterId = computed(() => store.currentChapter?.id ?? null)
const goal = computed(() => store.currentChapter?.wordGoal ?? null)
const goalLabel = computed(() => {
  if (goal.value == null || goal.value <= 0) return 'objectif'
  const pct = Math.round((store.currentChapter!.wordCount / goal.value) * 100)
  return `${pct} %`
})
const editingGoal = ref(false)
// string | number : Vue caste le v-model en nombre sur un input type=number,
// et le repasse à la chaîne vide quand le champ est vidé.
const goalDraft = ref<string | number>('')
const goalInputEl = ref<HTMLInputElement | null>(null)

function startEditGoal(): void {
  goalDraft.value = goal.value == null ? '' : String(goal.value)
  editingGoal.value = true
  nextTick(() => {
    goalInputEl.value?.focus()
    goalInputEl.value?.select()
  })
}

function commitGoal(): void {
  const id = currentChapterId.value
  editingGoal.value = false
  if (id == null) return
  store.setChapterGoal(id, parseWordGoal(goalDraft.value))
}

function cancelGoal(): void {
  editingGoal.value = false
}

function onGoalKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    cancelGoal()
  } else if (event.key === 'Enter') {
    event.preventDefault()
    event.stopPropagation()
    commitGoal()
  }
}

// Perte de focus = validation. La double exécution Entrée+blur est inoffensive
// (editingGoal est déjà reporté à false par commitGoal).
function onGoalBlur(): void {
  if (editingGoal.value) commitGoal()
}
</script>

<template>
  <footer class="status-bar">
    <span v-if="store.currentChapter" class="words">
      {{ store.currentChapter.wordCount.toLocaleString('fr-FR') }}
      <template v-if="goal"> / {{ goal.toLocaleString('fr-FR') }}</template>
      mots
    </span>
    <span v-if="store.currentChapter" class="goal-wrap">
      <button
        v-if="!editingGoal"
        type="button"
        class="goal-btn"
        :title="
          goal != null
            ? 'Objectif du chapitre — modifier'
            : 'Fixer un objectif de mots pour ce chapitre'
        "
        :aria-label="goal != null ? 'Objectif du chapitre' : 'Fixer un objectif de mots'"
        @click="startEditGoal"
      >
        {{ goalLabel }}
      </button>
      <input
        v-else
        ref="goalInputEl"
        v-model="goalDraft"
        type="number"
        min="1"
        step="100"
        class="goal-input"
        placeholder="ex. 5000"
        @keydown="onGoalKeydown"
        @blur="onGoalBlur"
      />
    </span>
    <span class="dot">·</span>
    <span class="session" :class="{ positive: sessionWords > 0 }">
      {{ sessionWords >= 0 ? '+' : '' }}{{ sessionWords.toLocaleString('fr-FR') }} cette session
    </span>
    <template v-if="backupState">
      <span class="dot">·</span>
      <button type="button" class="backup-link" @click="router.push('/')">
        <span class="pulse" :class="backupState.tone" />
        {{ backupState.label }}
      </button>
    </template>
    <span class="spacer" />
    <span class="save-state" :class="store.saveState">
      <span class="pulse" />
      {{ store.saveError ?? SAVE_LABELS[store.saveState] }}
    </span>
  </footer>
</template>

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 18px;
  border-top: 1px solid var(--border);
  background: var(--bg-panel);
  color: var(--fg-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}
.dot {
  opacity: 0.6;
}
.session.positive {
  color: var(--accent);
}
.spacer {
  flex: 1;
}
.backup-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  color: var(--fg-muted);
  cursor: pointer;
}
.save-state {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.pulse {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--fg-muted);
  flex-shrink: 0;
  transition: background-color 0.2s ease;
}
/* Même vocabulaire visuel que l'état d'enregistrement voisin (spec §9) :
   pastille + texte court. Uniquement des variables du thème — aucune couleur
   en dur, pour que le thème puisse basculer sans toucher aux composants. */
.pulse.ok {
  background: var(--accent);
}
.pulse.pending {
  background: var(--fg-muted);
}
.pulse.warn {
  background: var(--danger);
}
.pulse.off {
  background: var(--fg-muted);
  opacity: 0.5;
}

.save-state.dirty .pulse {
  background: var(--accent);
}
.save-state.saving .pulse {
  background: var(--accent);
  animation: breathe 1s ease-in-out infinite;
}

.goal-wrap {
  position: relative;
}
.goal-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: none;
  border: 1px solid transparent;
  border-radius: var(--radius-s);
  padding: 1px 7px;
  font: inherit;
  font-size: 11px;
  color: var(--fg-muted);
  cursor: pointer;
  transition:
    border-color 0.12s ease,
    color 0.12s ease;
}
.goal-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
}
.goal-input {
  width: 78px;
  flex-shrink: 0;
  padding: 1px 7px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
  border-color: var(--accent);
}

@keyframes breathe {
  0%,
  100% {
    opacity: 0.35;
    transform: scale(0.85);
  }
  50% {
    opacity: 1;
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .save-state.saving .pulse {
    animation: none;
  }
}
</style>
