<script setup lang="ts">
// Liste des snapshots du chapitre affiché (Task 7) : section repliée par
// défaut dans ClaudePanel, sous les actions du brouillon. Toute l'écriture
// (snapshot du contenu actuel + application du contenu restauré + sauvegarde)
// vit dans EditorPane, jamais ici — ce composant ne fait que lister/demander
// confirmation/déclencher via ai.restoreSnapshot (voir stores/ai.ts).
import { ref, watch } from 'vue'
import { useAiStore } from '../stores/ai'
import { useBookStore } from '../stores/book'
import { useUiStore } from '../stores/ui'
import type { Snapshot } from '../../../shared/types'

const ai = useAiStore()
const store = useBookStore()
const ui = useUiStore()

const open = ref(false)
const loading = ref(false)
const snapshots = ref<Snapshot[]>([])
// Id du snapshot en cours de restauration (au plus un à la fois) : distinct
// du chargement de la liste, désactive uniquement le bouton « Restaurer »
// concerné plutôt que toute la section.
const restoringId = ref<number | null>(null)

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

// Rafraîchi à l'ouverture du panneau (montage) et à chaque changement de
// chapitre tant qu'il reste ouvert — même schéma que ClaudePanel pour
// ai.prepare().
watch(() => store.currentChapter?.id, refresh, { immediate: true })

function toggle(): void {
  open.value = !open.value
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })
}

async function restore(snapshot: Snapshot): Promise<void> {
  if (restoringId.value != null) return
  if (
    !confirm(
      'Restaurer ce snapshot ? Le contenu actuel du chapitre sera remplacé (un point de restauration sera créé avant, pour pouvoir revenir en arrière).'
    )
  ) {
    return
  }
  restoringId.value = snapshot.id
  try {
    const ok = await ai.restoreSnapshot(snapshot.id)
    if (!ok) ui.toast('Restauration impossible pour ce chapitre.')
    await refresh()
  } catch (err) {
    console.error('Échec de la restauration du snapshot', err)
    ui.toast('Impossible de restaurer ce snapshot.')
  } finally {
    restoringId.value = null
  }
}

defineExpose({ refresh })
</script>

<template>
  <div class="snap-section">
    <button type="button" class="snap-toggle" :aria-expanded="open" @click="toggle">
      <span class="chevron" :class="{ open }">▸</span>
      Snapshots
    </button>
    <div v-if="open" class="snap-body">
      <p v-if="loading" class="snap-status">Chargement…</p>
      <p v-else-if="snapshots.length === 0" class="snap-status">
        Aucun snapshot pour ce chapitre.
      </p>
      <ul v-else class="snap-list">
        <li v-for="snapshot in snapshots" :key="snapshot.id" class="snap-item">
          <div class="snap-meta">
            <span class="snap-date">{{ formatDate(snapshot.createdAt) }}</span>
            <span class="snap-reason">{{ snapshot.reason }}</span>
          </div>
          <button
            type="button"
            class="snap-restore"
            :disabled="restoringId != null"
            @click="restore(snapshot)"
          >
            {{ restoringId === snapshot.id ? 'Restauration…' : 'Restaurer' }}
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.snap-section {
  border-top: 1px solid var(--border);
  margin-top: 4px;
  padding-top: 12px;
}

.snap-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  padding: 3px 4px 3px 0;
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--fg-muted);
}
.snap-toggle:hover {
  color: var(--accent);
}
.chevron {
  display: inline-block;
  font-size: 9px;
  transition: transform 0.15s ease;
}
.chevron.open {
  transform: rotate(90deg);
}

.snap-body {
  margin-top: 8px;
}

.snap-status {
  font-size: 12px;
  color: var(--fg-muted);
}

.snap-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.snap-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.snap-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.snap-date {
  font-size: 12px;
  color: var(--fg);
}
.snap-reason {
  font-size: 11px;
  color: var(--fg-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.snap-restore {
  flex-shrink: 0;
  font-size: 11px;
  padding: 4px 10px;
  color: var(--fg-muted);
}
.snap-restore:hover:not(:disabled) {
  color: var(--accent);
  border-color: var(--accent);
}
.snap-restore:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
