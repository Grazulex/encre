<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useBookStore } from '../stores/book'
import { useBackupStore } from '../stores/backup'
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

const backupLabel = computed(() => {
  const p = backup.status?.pending
  if (!p) return null
  const ch = p.chaptersChanged + p.chaptersAdded + p.chaptersRemoved
  if (ch === 0 && p.mediaAdded === 0) return 'Sauvegardé'
  return `${ch || p.mediaAdded} en attente`
})
</script>

<template>
  <footer class="status-bar">
    <span v-if="store.currentChapter" class="words">
      {{ store.currentChapter.wordCount.toLocaleString('fr-FR') }} mots
    </span>
    <span class="dot">·</span>
    <span class="session" :class="{ positive: sessionWords > 0 }">
      {{ sessionWords >= 0 ? '+' : '' }}{{ sessionWords.toLocaleString('fr-FR') }} cette session
    </span>
    <span class="dot">·</span>
    <button v-if="backupLabel" type="button" class="backup-link" @click="router.push('/')">
      {{ backupLabel }}
    </button>
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
  transition: background-color 0.2s ease;
}
.save-state.dirty .pulse {
  background: var(--accent);
}
.save-state.saving .pulse {
  background: var(--accent);
  animation: breathe 1s ease-in-out infinite;
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
