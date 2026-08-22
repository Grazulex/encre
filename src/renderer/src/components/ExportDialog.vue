<script setup lang="ts">
// Dialogue d'export (Task 9) : ouvert depuis le bouton « Exporter… » de
// l'aside (BookView), près du bouton d'édition du livre (⚙). Même langage
// modal que BookSettingsPanel/ImportWizard (overlay + carte, Échap intercepté
// ici, focus programmatique à l'ouverture, piège de Tab façon ImportWizard —
// plusieurs contrôles par carte, donc Tab doit continuer à circuler entre eux
// plutôt qu'être entièrement bloqué comme CommandPalette).
//
// EPUB et PDF acceptent une sélection de chapitres (tous cochés par défaut,
// dans l'ordre du livre — store.chapters est déjà trié par position) ;
// Markdown exporte toujours l'intégralité du livre (un fichier par chapitre,
// pas de sélection à proposer). Les trois formats renvoient soit un chemin
// (succès), soit null (dialogue système annulé — silencieux, on reste
// ouvert), soit lèvent (échec réel — toast dédié, on reste ouvert aussi : un
// échec d'export ne doit pas faire perdre la sélection déjà faite).
import { computed, nextTick, onMounted, ref } from 'vue'
import { useBookStore } from '../stores/book'
import { useUiStore } from '../stores/ui'

const emit = defineEmits<{ close: [] }>()

const store = useBookStore()
const ui = useUiStore()

const cardEl = ref<HTMLElement | null>(null)

type Format = 'epub' | 'pdf' | 'markdown'
const FORMATS: { value: Format; badge: string; label: string; hint: string }[] = [
  { value: 'epub', badge: 'EPUB', label: 'EPUB', hint: 'Pour liseuses' },
  { value: 'pdf', badge: 'PDF', label: 'PDF', hint: 'Prêt à imprimer' },
  { value: 'markdown', badge: 'MD', label: 'Markdown', hint: 'Un fichier par chapitre' }
]

const format = ref<Format>('epub')
const busy = ref(false)

interface Row {
  id: number
  title: string
  checked: boolean
}
// Instantané pris à l'ouverture (comme items dans ImportWizard) : la carte
// est montée avec v-if depuis BookView, donc une réouverture recrée
// l'instance et resynchronise cette liste sur store.chapters sans code dédié.
const rows = ref<Row[]>(store.chapters.map((c) => ({ id: c.id, title: c.title, checked: true })))

const needsChapters = computed(() => format.value !== 'markdown')
const checkedCount = computed(() => rows.value.filter((r) => r.checked).length)
// Livre sans chapitre : bloqué pour TOUS les formats (y compris Markdown, qui
// n'a pas de sélection mais écrirait sinon zéro fichier en toastant un succès).
const canExport = computed(
  () => rows.value.length > 0 && (!needsChapters.value || checkedCount.value > 0)
)

function checkAll(value: boolean): void {
  for (const r of rows.value) r.checked = value
}

async function runExport(): Promise<void> {
  if (busy.value || !store.book || !canExport.value) return
  const book = store.book
  busy.value = true

  try {
    let path: string | null
    if (format.value === 'markdown') {
      path = await window.encre.exporter.markdown(book.id)
    } else {
      // Spread : jamais le proxy réactif de rows à travers la frontière IPC
      // (même règle que orderedFiles dans ImportWizard).
      const chapterIds = [...rows.value.filter((r) => r.checked).map((r) => r.id)]
      path =
        format.value === 'epub'
          ? await window.encre.exporter.epub(book.id, chapterIds)
          : await window.encre.exporter.pdf(book.id, chapterIds)
    }
    if (!path) return // dialogue système annulé : silencieux, on reste ouvert

    const label = format.value === 'epub' ? 'EPUB' : format.value === 'pdf' ? 'PDF' : 'Markdown'
    ui.toast(`Export ${label} terminé : ${path}`)
    close()
  } catch (err) {
    console.error(`Échec de l'export ${format.value}`, err)
    ui.toast("Échec de l'export. Réessayez.")
  } finally {
    // busy reste vrai jusqu'ici, y compris pendant l'appel à close() ci-dessus
    // (mêmes raisons que importing dans ImportWizard) : tant que l'export est
    // en cours, Échap/Annuler/clic hors carte ne doivent jamais sembler
    // annuler une opération déjà lancée côté main process.
    busy.value = false
  }
}

function close(): void {
  emit('close')
}

function requestClose(): void {
  if (busy.value) return
  close()
}

// Piège de focus identique à ImportWizard : plusieurs contrôles par carte
// (cartes de format, cases de chapitres, boutons Tous/Aucun, footer), Tab
// doit donc continuer à circuler entre eux — on se contente de boucler aux
// bornes de la carte pour qu'il ne s'échappe jamais vers la vue en arrière-plan.
function trapTab(event: KeyboardEvent): void {
  const card = cardEl.value
  if (!card) return
  const focusables = Array.from(
    card.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])'
    )
  )
  if (focusables.length === 0) return
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    requestClose()
  } else if (event.key === 'Tab') {
    trapTab(event)
  }
}

onMounted(async () => {
  await nextTick()
  cardEl.value?.focus()
})
</script>

<template>
  <div class="export-overlay" @click.self="requestClose">
    <div
      ref="cardEl"
      class="export-card"
      role="dialog"
      aria-modal="true"
      aria-label="Exporter le livre"
      tabindex="-1"
      @keydown="onKeydown"
    >
      <header>
        <h2>Exporter le livre</h2>
        <span class="kbd">Échap</span>
      </header>

      <div class="body">
        <div class="formats" role="radiogroup" aria-label="Format d'export">
          <label
            v-for="f in FORMATS"
            :key="f.value"
            class="format-card"
            :class="{ active: format === f.value }"
          >
            <input
              v-model="format"
              type="radio"
              name="export-format"
              :value="f.value"
              :disabled="busy"
            />
            <span class="format-badge">{{ f.badge }}</span>
            <span class="format-label">{{ f.label }}</span>
            <span class="format-hint">{{ f.hint }}</span>
          </label>
        </div>

        <section v-if="needsChapters || rows.length === 0" class="chapters-pane">
          <div v-if="needsChapters" class="chapters-head">
            <span class="field-label">Chapitres à inclure</span>
            <div class="chapters-toggle">
              <button type="button" class="link" :disabled="busy" @click="checkAll(true)">
                Tous
              </button>
              <button type="button" class="link" :disabled="busy" @click="checkAll(false)">
                Aucun
              </button>
            </div>
          </div>
          <p v-if="rows.length === 0" class="empty-warning">
            Ce livre n'a aucun chapitre à exporter.
          </p>
          <ul v-else class="chapter-list">
            <li v-for="r in rows" :key="r.id">
              <label class="row">
                <input v-model="r.checked" type="checkbox" :disabled="busy" />
                <span>{{ r.title }}</span>
              </label>
            </li>
          </ul>
        </section>
      </div>

      <footer>
        <button type="button" class="ghost" :disabled="busy" @click="requestClose">Annuler</button>
        <button type="button" class="primary" :disabled="busy || !canExport" @click="runExport">
          <span v-if="busy" class="spinner" aria-hidden="true"></span>
          {{ busy ? 'Export…' : 'Exporter' }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.export-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: color-mix(in srgb, var(--fg) 25%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.export-card {
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
.export-card:focus,
.export-card:focus-visible {
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
  gap: 16px;
}

.formats {
  display: flex;
  gap: 10px;
}
.format-card {
  position: relative;
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  padding: 11px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease;
}
.format-card:hover {
  border-color: var(--accent);
}
.format-card:has(input:checked) {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}
.format-card:has(input:focus-visible) {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.format-card input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.format-badge {
  font-family: var(--font-ui);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--accent);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 6px;
}
.format-card:has(input:checked) .format-badge {
  border-color: var(--accent);
}
.format-label {
  font-family: var(--font-manuscript);
  font-size: 14.5px;
  font-weight: 600;
  margin-top: 2px;
}
.format-hint {
  font-size: 11.5px;
  color: var(--fg-muted);
}

.chapters-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.chapters-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.field-label {
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--fg-muted);
}
.chapters-toggle {
  display: flex;
  gap: 8px;
}
.link {
  border: none;
  padding: 0;
  background: none;
  font-size: 11.5px;
  color: var(--fg-muted);
}
.link:hover {
  color: var(--accent);
}

.empty-warning {
  font-size: 12.5px;
  color: var(--accent);
}

.chapter-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 260px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 4px;
}
.row {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}
.row:hover {
  background: color-mix(in srgb, var(--fg) 5%, transparent);
}
.row input[type='checkbox'] {
  accent-color: var(--accent);
}

footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}
.ghost {
  color: var(--fg-muted);
}

.spinner {
  display: inline-block;
  width: 11px;
  height: 11px;
  margin-right: 6px;
  vertical-align: -1px;
  border: 2px solid color-mix(in srgb, var(--bg) 40%, transparent);
  border-top-color: var(--bg);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation-duration: 1.8s;
  }
}
</style>
