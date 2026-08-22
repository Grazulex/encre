<script setup lang="ts">
// Assistant d'import Markdown (3 étapes) : dossier → ordre/titres → import.
// Même langage visuel que BookSettingsPanel/CommandPalette (overlay + carte,
// Échap intercepté ici, focus programmatique à l'ouverture). Le composant est
// monté avec v-if depuis LibraryView (comme CommandPalette depuis App.vue) :
// une réouverture recrée l'instance et réinitialise donc tout l'état ci-dessous
// sans code dédié.
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useLibraryStore } from '../stores/library'
import { useUiStore } from '../stores/ui'

const emit = defineEmits<{ close: [] }>()

const router = useRouter()
const library = useLibraryStore()
const ui = useUiStore()

const cardEl = ref<HTMLElement | null>(null)
const bookTitleEl = ref<HTMLInputElement | null>(null)

type Step = 1 | 2 | 3
const step = ref<Step>(1)

const scanning = ref(false)
const importing = ref(false)

const folder = ref<string | null>(null)
interface Item {
  file: string
  title: string
  originalTitle: string
}
const items = ref<Item[]>([])
const bookTitle = ref('')

const folderBaseName = computed(() => {
  if (!folder.value) return ''
  const parts = folder.value.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] ?? ''
})

const canProceedStep1 = computed(() => items.value.length > 0)
const canProceedStep2 = computed(() => bookTitle.value.trim().length > 0)

async function chooseFolder(): Promise<void> {
  scanning.value = true
  try {
    const res = await window.encre.importer.scanFolder()
    if (!res) return // dialogue annulé : on reste à l'étape 1
    folder.value = res.folder
    items.value = res.files.map((f) => ({ file: f.file, title: f.title, originalTitle: f.title }))
    bookTitle.value = folderBaseName.value
  } catch (err) {
    console.error('Échec de la lecture du dossier', err)
    ui.toast('Impossible de lire ce dossier.')
  } finally {
    scanning.value = false
  }
}

function moveItem(index: number, direction: -1 | 1): void {
  const j = index + direction
  if (j < 0 || j >= items.value.length) return
  ;[items.value[index], items.value[j]] = [items.value[j], items.value[index]]
}

function goNext(): void {
  if (step.value === 1 && canProceedStep1.value) step.value = 2
  else if (step.value === 2 && canProceedStep2.value) step.value = 3
}
function goBack(): void {
  if (step.value > 1) step.value = (step.value - 1) as Step
}

watch(step, async (s) => {
  if (s === 2) {
    await nextTick()
    bookTitleEl.value?.focus()
  }
})

async function runImport(): Promise<void> {
  if (!folder.value || importing.value) return
  importing.value = true

  // orderedFiles vient de .map() puis d'un spread : un tableau natif, jamais
  // le proxy réactif de items — nécessaire pour passer la frontière IPC.
  const orderedFiles = [...items.value.map((it) => it.file)]
  const title = bookTitle.value.trim()

  // Premier bloc : la création du livre elle-même. Une erreur ici veut dire
  // qu'aucun livre n'existe encore côté base — l'assistant reste ouvert et un
  // nouvel essai relance un importBook propre (comportement inchangé).
  let book
  try {
    book = await window.encre.importer.importBook(folder.value, orderedFiles, title)
  } catch (err) {
    console.error("Échec de l'import du livre", err)
    ui.toast("Échec de l'import. Vérifiez les fichiers et réessayez.")
    importing.value = false
    return
  }

  // Second bloc, volontairement séparé : à partir d'ici, le livre existe déjà
  // en base. importBook réutilise les titres détectés au scan (titre markdown
  // ou nom de fichier) — sa signature ne prend pas de titres personnalisés —
  // les éventuelles éditions de l'étape 2 sont donc appliquées après coup par
  // chapitre. L'ordre de création (transaction importBook) suit orderedFiles,
  // et listByBook est trié par position : même ordre des deux côtés, on peut
  // donc réconcilier par index. Si un renommage échoue, ce n'est PAS un échec
  // d'import : fusionner les deux erreurs sous le même toast pousserait
  // l'utilisateur à « réessayer » et créerait un second livre en doublon. On
  // continue donc le chemin de succès (toast dédié, load, close, navigation).
  let renameFailed = false
  try {
    const metas = await window.encre.chapters.listByBook(book.id)
    for (let i = 0; i < items.value.length; i++) {
      const edited = items.value[i].title.trim()
      const meta = metas[i]
      if (meta && edited && edited !== items.value[i].originalTitle) {
        await window.encre.chapters.rename(meta.id, edited)
      }
    }
  } catch (err) {
    console.error('Échec du renommage de certains chapitres importés', err)
    renameFailed = true
  }

  const n = items.value.length
  ui.toast(
    renameFailed
      ? "Livre importé, mais certains titres n'ont pas pu être renommés."
      : `« ${book.title} » importé (${n} chapitre${n > 1 ? 's' : ''}).`
  )
  // importing.value reste `true` jusqu'après router.push : library.load()
  // est un autre await, donc encore un instant où requestClose() (Échap,
  // Annuler, clic hors carte) pourrait sinon repasser à travers et fermer
  // l'assistant avant la fin de la chaîne — la même fenêtre de "fermeture
  // perçue puis navigation surprise" que la garde ci-dessous vise à éliminer.
  await library.load()
  close()
  router.push(`/book/${book.id}`)
  importing.value = false
}

// close() ferme sans condition — utilisé en interne à la fin d'un import
// réussi, où importing.value est encore true (il n'est remis à false
// qu'après router.push, voir runImport). requestClose() est la voie
// utilisateur (Échap, Annuler, clic hors carte) : tant qu'un import est en
// cours, Escape/Annuler sont avalés plutôt que d'unmonter l'assistant, pour
// ne jamais laisser l'utilisateur croire qu'il a annulé alors que la chaîne
// async (toast, library.load, navigation) continue en arrière-plan après
// coup — y compris pendant l'instant qui sépare ce close() interne du
// router.push qui le suit.
function close(): void {
  emit('close')
}

function requestClose(): void {
  if (importing.value) return
  close()
}

// Piège de focus : contrairement à CommandPalette (un seul élément
// focusable, Tab entièrement bloqué), cet assistant a plusieurs contrôles
// par étape (dossier, ↑/↓, titres, navigation) — Tab doit donc continuer à
// circuler entre eux. On se contente de faire boucler le focus aux bornes de
// la carte pour qu'il ne s'échappe jamais vers la bibliothèque en arrière-plan.
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
  <div class="wizard-overlay" @click.self="requestClose">
    <div
      ref="cardEl"
      class="wizard-card"
      role="dialog"
      aria-modal="true"
      aria-label="Importer un livre"
      tabindex="-1"
      @keydown="onKeydown"
    >
      <header>
        <div>
          <h2>Importer un livre</h2>
          <p class="reassurance">Vos fichiers ne seront ni modifiés ni déplacés.</p>
        </div>
        <span class="kbd">Échap</span>
      </header>

      <div class="steps">
        <div class="step-dot" :class="{ active: step === 1, done: step > 1 }">1</div>
        <div class="step-line" :class="{ done: step > 1 }"></div>
        <div class="step-dot" :class="{ active: step === 2, done: step > 2 }">2</div>
        <div class="step-line" :class="{ done: step > 2 }"></div>
        <div class="step-dot" :class="{ active: step === 3 }">3</div>
      </div>

      <div class="body">
        <!-- Étape 1 : choix du dossier -->
        <section v-if="step === 1" class="pane">
          <p class="hint">
            Choisissez un dossier contenant un fichier Markdown (.md) par chapitre.
          </p>
          <button type="button" class="primary" :disabled="scanning" @click="chooseFolder">
            {{ scanning ? 'Lecture…' : 'Choisir un dossier…' }}
          </button>

          <template v-if="folder">
            <div class="folder-row">
              <span class="folder-label">Dossier</span>
              <span class="folder-path" :title="folder">{{ folder }}</span>
            </div>

            <p v-if="items.length === 0" class="empty-warning">
              Aucun fichier .md trouvé dans ce dossier. Choisissez-en un autre.
            </p>
            <template v-else>
              <p class="count">
                {{ items.length }} chapitre{{ items.length > 1 ? 's' : '' }} détecté{{
                  items.length > 1 ? 's' : ''
                }}
              </p>
              <ol class="preview-list">
                <li v-for="it in items" :key="it.file">
                  <span class="preview-title">{{ it.title }}</span>
                  <span class="preview-file">{{ it.file }}</span>
                </li>
              </ol>
            </template>
          </template>
        </section>

        <!-- Étape 2 : ordre et titres -->
        <section v-else-if="step === 2" class="pane">
          <label class="field">
            <span class="field-label">Titre du livre</span>
            <input ref="bookTitleEl" v-model="bookTitle" type="text" placeholder="Titre du livre" />
          </label>

          <p class="hint">Ajustez l'ordre des chapitres et leurs titres si besoin.</p>

          <ol class="order-list">
            <li v-for="(it, index) in items" :key="it.file">
              <div class="order-controls">
                <button
                  type="button"
                  class="order-btn"
                  aria-label="Monter"
                  :disabled="index === 0"
                  @click="moveItem(index, -1)"
                >
                  ↑
                </button>
                <button
                  type="button"
                  class="order-btn"
                  aria-label="Descendre"
                  :disabled="index === items.length - 1"
                  @click="moveItem(index, 1)"
                >
                  ↓
                </button>
              </div>
              <div class="order-fields">
                <input v-model="it.title" type="text" class="order-title" />
                <span class="order-file">{{ it.file }}</span>
              </div>
            </li>
          </ol>
        </section>

        <!-- Étape 3 : confirmation et import -->
        <section v-else class="pane">
          <dl class="summary">
            <dt>Titre</dt>
            <dd>{{ bookTitle.trim() }}</dd>
            <dt>Dossier</dt>
            <dd :title="folder ?? ''">{{ folder }}</dd>
            <dt>Chapitres</dt>
            <dd>{{ items.length }}</dd>
          </dl>
          <p class="hint">
            L'import crée un nouveau livre dans Encre à partir de ces fichiers, sans toucher au
            dossier d'origine.
          </p>
        </section>
      </div>

      <footer>
        <button type="button" class="ghost" :disabled="importing" @click="requestClose">
          Annuler
        </button>
        <div class="footer-nav">
          <button v-if="step > 1" type="button" :disabled="importing" @click="goBack">
            Précédent
          </button>
          <button
            v-if="step < 3"
            type="button"
            class="primary"
            :disabled="(step === 1 && !canProceedStep1) || (step === 2 && !canProceedStep2)"
            @click="goNext"
          >
            Suivant
          </button>
          <button v-else type="button" class="primary" :disabled="importing" @click="runImport">
            {{ importing ? 'Import…' : 'Importer' }}
          </button>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.wizard-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: color-mix(in srgb, var(--fg) 25%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.wizard-card {
  width: 520px;
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
.wizard-card:focus,
.wizard-card:focus-visible {
  outline: none;
}

header {
  display: flex;
  align-items: flex-start;
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
.reassurance {
  margin-top: 3px;
  font-size: 11.5px;
  font-style: italic;
  color: var(--fg-muted);
}
/* .kbd : classe globale (theme.css) pour tout le reste — seul flex-shrink
   diffère ici (correctif M4, vague finale 3c) : le header de ce composant a
   un <div> sibling (titre + .reassurance) qui peut grandir sur deux lignes,
   et sans flex-shrink: 0 la puce « Échap » se ferait compresser par ce
   voisin dans la rangée flex du header — les autres header/kbd de l'app
   (BookSettingsPanel, ExtractDialog…) n'ont qu'un <h2> à côté, jamais ce cas. */
.kbd {
  flex-shrink: 0;
}

.steps {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 14px 20px 0;
  flex-shrink: 0;
}
.step-dot {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid var(--border);
  color: var(--fg-muted);
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}
.step-dot.active {
  border-color: var(--accent);
  color: var(--accent);
}
.step-dot.done {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--bg);
}
.step-line {
  flex: 1;
  height: 1px;
  background: var(--border);
}
.step-line.done {
  background: var(--accent);
}

.body {
  overflow-y: auto;
  padding: 16px 20px 20px;
  flex: 1;
  min-height: 0;
}

.pane {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.folder-row {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.folder-label {
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--fg-muted);
}
.folder-path {
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.count {
  font-size: 12px;
  color: var(--fg-muted);
}

.empty-warning {
  font-size: 12.5px;
  color: var(--accent);
}

.preview-list,
.order-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 320px;
  overflow-y: auto;
}
.preview-list li {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
}
.preview-title {
  font-size: 13px;
}
.preview-file {
  font-size: 10.5px;
  color: var(--fg-muted);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.order-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 7px;
}
.order-controls {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex-shrink: 0;
}
.order-btn {
  width: 22px;
  height: 20px;
  padding: 0;
  font-size: 11px;
  line-height: 1;
  display: grid;
  place-items: center;
}
.order-fields {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.order-title {
  font-size: 13px;
  padding: 4px 8px;
}
.order-file {
  font-size: 10.5px;
  color: var(--fg-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.summary {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  font-size: 13px;
}
.summary dt {
  color: var(--fg-muted);
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  align-self: center;
}
.summary dd {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}
.footer-nav {
  display: flex;
  gap: 8px;
}
.ghost {
  color: var(--fg-muted);
}
</style>
