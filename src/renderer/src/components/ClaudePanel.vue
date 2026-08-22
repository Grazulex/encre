<script setup lang="ts">
// Panneau Claude (Task 6) : colonne droite de BookView, section chapitres
// uniquement. Le brouillon streamé ne touche JAMAIS l'éditeur tant que
// l'auteur n'a pas cliqué sur Insérer. Insérer (Task 7) délègue tout le
// travail d'édition à EditorPane via le pont du store ai (registerEditor —
// EditorPane et ce panneau sont frères dans BookView, jamais l'un dans
// l'arbre de l'autre) : ce composant ne connaît ni l'éditeur ni ProseMirror.
import { computed, nextTick, ref, watch } from 'vue'
import { useAiStore } from '../stores/ai'
import { useBookStore } from '../stores/book'
import { useUiStore } from '../stores/ui'
import SnapshotList from './SnapshotList.vue'

const ai = useAiStore()
const store = useBookStore()
const ui = useUiStore()

// prepare() re-déclenché à chaque ouverture du panneau (montage — v-if côté
// BookView) ET à chaque changement de chapitre tant qu'il reste ouvert
// (même watcher, { immediate: true } couvrant les deux cas). prepare()
// lui-même décide, en comparant chapterId, s'il s'agit d'un rafraîchissement
// de métadonnées (panneau rouvert sur le même chapitre) ou d'une vraie
// nouvelle session (voir stores/ai.ts).
watch(
  () => store.currentChapter?.id,
  (id) => {
    if (id != null) ai.prepare(id)
  },
  { immediate: true }
)

const busy = computed(() => ai.phase === 'preparing' || ai.phase === 'streaming')
const hasContent = computed(() => !!store.currentChapter?.contentText.trim())

const SUMMARY_PREVIEW_MAX = 220
const summaryPreview = computed(() => {
  const summary = store.currentChapter?.summary.trim() ?? ''
  if (summary.length <= SUMMARY_PREVIEW_MAX) return summary
  return `${summary.slice(0, SUMMARY_PREVIEW_MAX)} …`
})

// Mode de la dernière génération lancée (corps neuf ou suite du texte
// existant) : Régénérer reprend exactement ce mode, sans que l'auteur ait à
// re-choisir entre les deux boutons de lancement.
const lastContinue = ref(false)

function launch(continueFromText: boolean): void {
  const chapter = store.currentChapter
  if (!chapter || !ai.hasSummary) return
  lastContinue.value = continueFromText
  ai.start(chapter.id, continueFromText)
}

function regenerate(): void {
  const chapter = store.currentChapter
  if (!chapter) return
  ai.start(chapter.id, lastContinue.value)
}

// Garde locale contre le double-clic : le bouton disparaît dès que
// ai.insertDraft() rappelle reset() (phase quitte 'done'), mais entre le clic
// et cette bascule il y a deux aller-retours IPC (snapshot, éventuellement
// sauvegarde) pendant lesquels un second clic resterait possible sans ce ref.
const inserting = ref(false)
// Ref directe vers SnapshotList (enfant réel de ce composant, pas un frère —
// rien à voir avec le pont EditorPane du store ai) : seul moyen de lui faire
// prendre en compte le nouveau snapshot 'avant insertion IA' créé par
// insertDraftIntoEditor sans que SnapshotList ait à deviner l'événement via un
// état partagé plus indirect.
const snapshotList = ref<InstanceType<typeof SnapshotList> | null>(null)

async function insertDraft(): Promise<void> {
  if (inserting.value) return
  inserting.value = true
  try {
    const ok = await ai.insertDraft()
    if (ok) await snapshotList.value?.refresh()
  } finally {
    inserting.value = false
  }
}

async function copyDraft(): Promise<void> {
  try {
    await navigator.clipboard.writeText(ai.draft)
    ui.toast('Brouillon copié.')
  } catch (err) {
    console.error('Échec de la copie du brouillon', err)
    ui.toast('Impossible de copier le brouillon.')
  }
}

// Auto-scroll de la zone de stream : suit la fin du texte à chaque chunk,
// tant que le générateur n'a pas fini (une fois 'done', l'auteur peut relire
// tranquillement sans être ramené en bas à chaque re-rendu).
const streamEl = ref<HTMLElement | null>(null)
watch(
  () => ai.draft,
  async () => {
    if (ai.phase !== 'streaming') return
    await nextTick()
    const el = streamEl.value
    if (el) el.scrollTop = el.scrollHeight
  }
)
</script>

<template>
  <!-- div plutôt que aside : BookView.vue a un sélecteur `aside { ... }`
       générique (pour son propre nav de gauche) — les styles scoped d'un
       parent s'appliquent aussi à la racine d'un composant enfant en Vue,
       un vrai <aside> ici recevrait donc ces règles par ricochet
       (border-right, transitions) en plus des siennes. -->
  <div class="claude-panel" role="complementary" aria-label="Assistant Claude">
    <header class="cp-head">
      <h2>Assistant Claude</h2>
      <button
        class="cp-close"
        type="button"
        title="Fermer"
        aria-label="Fermer le panneau"
        @click="ai.open = false"
      >
        ×
      </button>
    </header>

    <div class="cp-body">
      <section class="cp-section">
        <p v-if="ai.phase === 'preparing'" class="cp-loading">Préparation…</p>
        <template v-else>
          <div v-if="ai.hasSummary" class="cp-summary">
            <span class="field-label">Résumé du chapitre</span>
            <p class="cp-summary-text">{{ summaryPreview }}</p>
          </div>
          <p v-else class="cp-warning">Écrivez d'abord un résumé dans « Résumé &amp; notes ».</p>
        </template>
      </section>

      <section v-if="ai.entityChoices.length > 0" class="cp-section">
        <span class="field-label">Fiches à inclure</span>
        <ul class="cp-entities">
          <li v-for="choice in ai.entityChoices" :key="choice.entity.id">
            <label class="cp-entity" :class="{ disabled: busy }">
              <input v-model="choice.checked" type="checkbox" :disabled="busy" />
              <span class="cp-entity-badge" :class="{ place: choice.entity.kind === 'place' }">
                {{ choice.entity.kind === 'character' ? '◆' : '●' }}
              </span>
              {{ choice.entity.name }}
            </label>
          </li>
        </ul>
      </section>

      <section class="cp-section">
        <span class="field-label">Consigne (facultatif)</span>
        <textarea
          v-model="ai.instructions"
          class="cp-instructions"
          rows="3"
          placeholder="Une intention pour ce brouillon…"
          :disabled="busy"
        ></textarea>
      </section>

      <div class="cp-model-row">
        <span class="field-label">Modèle</span>
        <select v-model="ai.model" class="cp-model-select" :disabled="busy">
          <option value="sonnet">Sonnet — rapide</option>
          <option value="opus">Opus — soigné</option>
          <option value="fable">Fable — le plus littéraire</option>
        </select>
      </div>

      <div v-if="ai.phase === 'idle' || ai.phase === 'error'" class="cp-launch">
        <p v-if="ai.errorMessage" class="cp-error">{{ ai.errorMessage }}</p>
        <button type="button" class="primary" :disabled="!ai.hasSummary" @click="launch(false)">
          Rédiger le brouillon
        </button>
        <button v-if="hasContent" type="button" :disabled="!ai.hasSummary" @click="launch(true)">
          Continuer le texte
        </button>
      </div>

      <div v-if="ai.phase === 'streaming' || ai.phase === 'done'" class="cp-stream">
        <span class="field-label">Brouillon</span>
        <div ref="streamEl" class="cp-stream-text">
          {{ ai.draft }}<span v-if="ai.phase === 'streaming'" class="cp-cursor">▍</span>
        </div>
        <div class="cp-stream-actions">
          <button v-if="ai.phase === 'streaming'" type="button" @click="ai.cancel()">
            Annuler
          </button>
          <template v-else>
            <button type="button" class="primary" :disabled="inserting" @click="insertDraft">
              {{ inserting ? 'Insertion…' : 'Insérer' }}
            </button>
            <button type="button" :disabled="inserting" @click="regenerate">Régénérer</button>
            <button type="button" :disabled="inserting" @click="copyDraft">Copier</button>
          </template>
        </div>
      </div>

      <SnapshotList ref="snapshotList" />
    </div>
  </div>
</template>

<style scoped>
.claude-panel {
  background: var(--bg-panel);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

.cp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.cp-head h2 {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
}
.cp-close {
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
.cp-close:hover {
  border-color: var(--fg-muted);
  color: var(--fg);
}

.cp-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 14px;
}

.cp-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field-label {
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--fg-muted);
}

.cp-loading {
  font-size: 12.5px;
  color: var(--fg-muted);
}

.cp-summary-text {
  font-size: 13px;
  line-height: 1.55;
  color: var(--fg);
}

.cp-warning {
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
  border-radius: 8px;
  padding: 8px 10px;
}

.cp-entities {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 160px;
  overflow-y: auto;
}
.cp-entity {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 2px;
  font-size: 12.5px;
  cursor: pointer;
}
.cp-entity.disabled {
  cursor: default;
  opacity: 0.6;
}
.cp-entity input {
  padding: 0;
  accent-color: var(--accent);
}
.cp-entity-badge {
  font-size: 8px;
  color: var(--accent);
}
.cp-entity-badge.place {
  color: color-mix(in srgb, var(--accent) 60%, transparent);
}

.cp-instructions {
  width: 100%;
  resize: vertical;
  font-size: 12.5px;
  line-height: 1.5;
}

.cp-model-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.cp-model-select {
  -webkit-appearance: none;
  appearance: none;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--fg-muted);
  background: none;
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 4px 22px 4px 10px;
  cursor: pointer;
  background-image:
    linear-gradient(45deg, transparent 50%, var(--fg-muted) 50%),
    linear-gradient(135deg, var(--fg-muted) 50%, transparent 50%);
  background-position:
    calc(100% - 12px) center,
    calc(100% - 7px) center;
  background-size:
    5px 5px,
    5px 5px;
  background-repeat: no-repeat;
}
.cp-model-select:hover,
.cp-model-select:focus {
  outline: none;
  border-color: var(--accent);
  color: var(--accent);
}

.cp-launch {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cp-launch button {
  width: 100%;
}
.cp-error {
  font-size: 12px;
  color: var(--danger);
}

.cp-stream {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-height: 160px;
}
.cp-stream-text {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  font-family: var(--font-manuscript);
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}
.cp-cursor {
  display: inline-block;
  color: var(--accent);
  animation: cp-blink 1s step-start infinite;
}
@keyframes cp-blink {
  50% {
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .cp-cursor {
    animation: none;
  }
}

.cp-stream-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}
.cp-stream-actions button {
  flex: 1;
}
</style>
