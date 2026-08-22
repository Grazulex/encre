<script setup lang="ts">
// Fiche du livre éditable (Task 15) : panneau modal ouvert depuis le bouton
// discret ⚙ de l'aside (BookView). Même langage visuel que AutolinkDialog
// (overlay + carte, Échap intercepté ici, focus programmatique à
// l'ouverture). Chaque champ texte a son propre débounce de 600 ms (même
// motif que EntityCard) ; à la fermeture, tout minuteur encore en attente est
// flushé immédiatement plutôt que simplement annulé, pour ne jamais perdre
// une frappe des 600 dernières ms.
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useBookStore } from '../stores/book'
import { useUiStore } from '../stores/ui'
import { BOOK_STATUS_LABELS } from '../../../shared/labels'
import { normalizeForSearch } from '../../../shared/textNormalize'
import { mediaUrl } from '../utils/media'
import type { BookStatus, Series } from '../../../shared/types'

const emit = defineEmits<{ close: [] }>()

const store = useBookStore()
const ui = useUiStore()
const dialogEl = ref<HTMLElement | null>(null)

const STATUSES: { value: BookStatus; label: string }[] = (
  Object.keys(BOOK_STATUS_LABELS) as BookStatus[]
).map((value) => ({ value, label: BOOK_STATUS_LABELS[value] }))

const timers: Partial<Record<string, ReturnType<typeof setTimeout>>> = {}
const pendingCommits: Partial<Record<string, () => void>> = {}
function debounced(field: string, run: () => void): void {
  clearTimeout(timers[field])
  pendingCommits[field] = run
  timers[field] = setTimeout(() => {
    delete pendingCommits[field]
    run()
  }, 600)
}
function flushAll(): void {
  for (const field of Object.keys(pendingCommits)) {
    clearTimeout(timers[field])
    pendingCommits[field]?.()
    delete pendingCommits[field]
  }
}

function onTitleInput(): void {
  debounced('title', () => {
    if (store.book) store.update({ title: store.book.title })
  })
}
function onAuthorInput(): void {
  debounced('author', () => {
    if (store.book) store.update({ author: store.book.author })
  })
}
function onGenreInput(): void {
  debounced('genre', () => {
    if (store.book) store.update({ genre: store.book.genre })
  })
}
function onSynopsisInput(): void {
  debounced('synopsis', () => {
    if (store.book) store.update({ synopsis: store.book.synopsis })
  })
}
function onWordGoalInput(event: Event): void {
  const raw = (event.target as HTMLInputElement).value.trim()
  const value = raw === '' ? null : Number(raw)
  if (!store.book) return
  store.book.wordGoal = raw === '' || !Number.isFinite(value) ? null : value
  debounced('wordGoal', () => {
    if (store.book) store.update({ wordGoal: store.book.wordGoal })
  })
}
function onStatusChange(event: Event): void {
  const status = (event.target as HTMLSelectElement).value as BookStatus
  if (store.book) store.book.status = status
  store.update({ status })
}

// --- Série (combobox : champ texte + suggestions, Task 7b) --------------
// Liste chargée une seule fois à l'ouverture du panneau (pas un store — un
// simple ref local, comme les patterns d'écran existants) : jamais tenue en
// synchro live avec la base, juste assez fraîche pour peupler les
// suggestions et retrouver l'id d'une série déjà tapée sans repasser par
// getOrCreate.
const seriesList = ref<Series[]>([])
const seriesInput = ref('')
const showSeriesSuggestions = ref(false)

const filteredSeries = computed<Series[]>(() => {
  const q = normalizeForSearch(seriesInput.value.trim())
  if (!q) return seriesList.value
  return seriesList.value.filter((s) => normalizeForSearch(s.name).includes(q))
})

async function loadSeries(): Promise<void> {
  try {
    seriesList.value = await window.encre.series.list()
  } catch (err) {
    console.error('Échec du chargement des séries', err)
    ui.toast('Impossible de charger les séries.')
  }
}

function selectSeries(s: Series): void {
  seriesInput.value = s.name
  showSeriesSuggestions.value = false
  if (store.book) store.update({ seriesId: s.id })
}

// Enter ou blur : confirme la saisie. Un nom vide est un no-op (ne crée
// jamais de série vide) — seul le bouton « Aucune » explicite efface la
// série ; un nom inchangé n'appelle pas l'IPC pour rien.
async function commitSeriesInput(): Promise<void> {
  showSeriesSuggestions.value = false
  if (!store.book) return
  const name = seriesInput.value.trim()
  if (!name) {
    seriesInput.value = store.book.seriesName ?? ''
    return
  }
  if (name === store.book.seriesName) {
    seriesInput.value = name
    return
  }
  try {
    const existing = seriesList.value.find((s) => s.name === name)
    const s = existing ?? (await window.encre.series.getOrCreate(name))
    if (!seriesList.value.some((existingSeries) => existingSeries.id === s.id)) {
      seriesList.value.push(s)
    }
    seriesInput.value = s.name
    await store.update({ seriesId: s.id })
  } catch (err) {
    console.error('Échec de la récupération/création de la série', err)
    ui.toast("Échec de l'enregistrement de la série.")
  }
}

function onSeriesKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter') {
    event.preventDefault()
    commitSeriesInput()
  } else if (event.key === 'Escape' && showSeriesSuggestions.value) {
    // Un premier Échap referme juste les suggestions ; un second (dropdown
    // déjà fermé) doit atteindre le onKeydown du dialogue pour fermer le
    // panneau — d'où le stopPropagation seulement dans ce cas-ci.
    event.stopPropagation()
    showSeriesSuggestions.value = false
  }
}

function clearSeries(): void {
  seriesInput.value = ''
  showSeriesSuggestions.value = false
  if (store.book) store.update({ seriesId: null })
}

async function chooseCover(): Promise<void> {
  await store.pickCover()
}

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
  seriesInput.value = store.book?.seriesName ?? ''
  loadSeries()
  await nextTick()
  dialogEl.value?.focus()
})
onBeforeUnmount(flushAll)
</script>

<template>
  <Transition name="dialog" appear>
  <div v-if="store.book" class="settings-overlay" @click.self="close">
    <div
      ref="dialogEl"
      class="settings-card"
      role="dialog"
      aria-modal="true"
      aria-label="Modifier le livre"
      tabindex="-1"
      @keydown="onKeydown"
    >
      <header>
        <h2>Modifier le livre</h2>
        <span class="kbd">Échap</span>
      </header>

      <div class="body">
        <div class="cover-row">
          <div class="cover-preview">
            <img v-if="store.book.coverPath" :src="mediaUrl(store.book.coverPath) ?? undefined" alt="" />
            <span v-else>{{ (store.book.title.trim().slice(0, 1) || '?').toUpperCase() }}</span>
          </div>
          <button type="button" class="pick-cover" @click="chooseCover">Choisir une couverture</button>
        </div>

        <label class="field">
          <span class="field-label">Titre</span>
          <input v-model="store.book.title" type="text" @input="onTitleInput" />
        </label>

        <div class="field-pair">
          <label class="field">
            <span class="field-label">Auteur</span>
            <input v-model="store.book.author" type="text" @input="onAuthorInput" />
          </label>
          <label class="field">
            <span class="field-label">Genre</span>
            <input v-model="store.book.genre" type="text" @input="onGenreInput" />
          </label>
        </div>

        <label class="field series-field">
          <span class="field-label">Série</span>
          <div class="series-combobox">
            <input
              v-model="seriesInput"
              type="text"
              placeholder="Aucune série"
              autocomplete="off"
              spellcheck="false"
              @focus="showSeriesSuggestions = true"
              @input="showSeriesSuggestions = true"
              @keydown="onSeriesKeydown"
              @blur="commitSeriesInput"
            />
            <button
              v-if="seriesInput"
              type="button"
              class="clear-series"
              title="Aucune série"
              aria-label="Retirer la série"
              @mousedown.prevent
              @click="clearSeries"
            >
              ×
            </button>
            <ul v-if="showSeriesSuggestions && filteredSeries.length" class="series-suggestions">
              <li v-for="s in filteredSeries" :key="s.id">
                <button type="button" @mousedown.prevent @click="selectSeries(s)">{{ s.name }}</button>
              </li>
            </ul>
          </div>
        </label>

        <label class="field">
          <span class="field-label">Synopsis</span>
          <textarea
            v-model="store.book.synopsis"
            rows="3"
            placeholder="Résumé de l'histoire…"
            @input="onSynopsisInput"
          ></textarea>
        </label>

        <div class="field-pair">
          <label class="field">
            <span class="field-label">Objectif de mots</span>
            <input
              :value="store.book.wordGoal ?? ''"
              type="number"
              min="0"
              placeholder="Optionnel"
              @input="onWordGoalInput"
            />
          </label>
          <label class="field">
            <span class="field-label">Statut</span>
            <select :value="store.book.status" @change="onStatusChange">
              <option v-for="s in STATUSES" :key="s.value" :value="s.value">{{ s.label }}</option>
            </select>
          </label>
        </div>
      </div>

      <footer>
        <button type="button" class="primary" @click="close">Fermer</button>
      </footer>
    </div>
  </div>
  </Transition>
</template>

<style scoped>
.settings-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: color-mix(in srgb, var(--fg) 25%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.settings-card {
  width: 460px;
  max-width: 100%;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 24px 60px -20px color-mix(in srgb, var(--fg) 45%, transparent);
  overflow: hidden;
}
.settings-card:focus,
.settings-card:focus-visible {
  outline: none;
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
header h2 {
  font-size: 14px;
  font-weight: 600;
}
.kbd {
  display: inline-block;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 10.5px;
  color: var(--fg-muted);
  background: var(--bg);
}

.body {
  overflow-y: auto;
  padding: 16px;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.cover-row {
  display: flex;
  align-items: center;
  gap: 14px;
}
.cover-preview {
  flex-shrink: 0;
  width: 48px;
  aspect-ratio: 2 / 3;
  border-radius: 5px 8px 8px 5px;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: linear-gradient(
    155deg,
    var(--accent) 0%,
    color-mix(in srgb, var(--accent) 42%, var(--bg)) 100%
  );
  box-shadow: 0 1px 3px color-mix(in srgb, var(--fg) 20%, transparent);
}
.cover-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cover-preview span {
  font-family: var(--font-manuscript);
  font-size: 1.3rem;
  font-weight: 600;
  color: var(--bg);
}
.pick-cover {
  font-size: 12px;
  padding: 5px 12px;
  color: var(--fg-muted);
}
.pick-cover:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.field-pair {
  display: flex;
  gap: 12px;
}
.field-pair .field {
  flex: 1;
  min-width: 0;
}
.field-label {
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--fg-muted);
}
.field textarea {
  resize: vertical;
  font-size: 13px;
  line-height: 1.5;
}

.series-field {
  position: relative;
}
.series-combobox {
  position: relative;
  display: flex;
  align-items: center;
}
.series-combobox input {
  width: 100%;
  padding-right: 26px;
}
.clear-series {
  position: absolute;
  right: 6px;
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border: none;
  padding: 0;
  border-radius: 50%;
  color: var(--fg-muted);
  font-size: 13px;
  line-height: 1;
}
.clear-series:hover {
  color: var(--fg);
  background: color-mix(in srgb, var(--fg) 8%, transparent);
}
.series-suggestions {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  z-index: 1;
  max-height: 160px;
  overflow-y: auto;
  list-style: none;
  padding: 4px;
  margin: 0;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 10px 24px -12px color-mix(in srgb, var(--fg) 35%, transparent);
}
.series-suggestions button {
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  padding: 6px 8px;
  border-radius: 5px;
  font-size: 12.5px;
  color: var(--fg);
  background: none;
}
.series-suggestions button:hover {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: var(--accent);
}
/* Même recette que .status-select (EditorPane, statut de chapitre) :
   appearance: none retire le rendu natif (flèche + cadre blanc du système),
   remplacé par un chevron CSS en dégradés — mais avec le gabarit bordure/fond
   des autres champs de ce panneau (input/textarea, theme.css) plutôt que le
   style pilule compacte de l'en-tête d'éditeur, pour rester cohérent avec
   Titre/Auteur/Genre/Synopsis juste au-dessus. */
.field select {
  -webkit-appearance: none;
  appearance: none;
  font: inherit;
  color: var(--fg);
  background-color: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 30px 6px 10px;
  cursor: pointer;
  background-image:
    linear-gradient(45deg, transparent 50%, var(--fg-muted) 50%),
    linear-gradient(135deg, var(--fg-muted) 50%, transparent 50%);
  background-position:
    calc(100% - 16px) center,
    calc(100% - 11px) center;
  background-size:
    5px 5px,
    5px 5px;
  background-repeat: no-repeat;
  transition: border-color 0.15s ease;
}
.field select:focus {
  outline: none;
  border-color: var(--accent);
}

footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}
</style>
