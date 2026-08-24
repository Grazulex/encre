<script setup lang="ts">
// Panneau « Médias du livre » : le magasin des livrables qui ENTOURENT le
// texte (couverture EPUB, couverture brochée, quatrième de couverture,
// bannières, portrait d'auteur…). À ne pas confondre avec les illustrations
// (IllustrationsPanel) : une illustration est une planche insérable DANS un
// chapitre, un média n'entre jamais dans le manuscrit — il est juste rangé à
// côté du livre. C'est pourquoi ce panneau s'ouvre depuis l'aside de BookView
// (à côté du ⚙), jamais depuis l'éditeur de texte, et qu'il n'offre aucune
// action « Insérer ».
//
// Coquille modale reprise de BookSettingsPanel (overlay + carte, Échap
// intercepté, focus programmatique à l'ouverture, débounce de 600 ms par
// champ texte avec flush à la fermeture) ; langage visuel des lignes repris
// d'IllustrationsPanel (vignette + méta + colonne d'actions).
//
// Pas de store Pinia : la liste est chargée à l'ouverture et rechargée après
// chaque mutation structurelle (ajout, changement de rôle, suppression),
// exactement comme le fait IllustrationsPanel.
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useUiStore } from '../stores/ui'
import { BOOK_MEDIA_ROLE_LABELS } from '../../../shared/labels'
import type { BookMedia, BookMediaRole } from '../../../shared/types'
import { mediaUrl } from '../utils/media'
import ConfirmDialog from './ConfirmDialog.vue'

const props = defineProps<{ bookId: number }>()
const emit = defineEmits<{ close: [] }>()

const ui = useUiStore()
const dialogEl = ref<HTMLElement | null>(null)

// Ordre d'affichage des groupes = ordre de déclaration de
// BOOK_MEDIA_ROLE_LABELS (shared/labels.ts), qui fait foi.
const ROLES = Object.keys(BOOK_MEDIA_ROLE_LABELS) as BookMediaRole[]

// Mentions discrètes attachées à un rôle : le seul rôle réellement branché
// sur un export est la couverture EPUB, et la couverture brochée est la
// question que l'auteur se posera juste après (elle est rangée ici, mais
// l'export PDF ne l'intègre pas).
const ROLE_HINTS: Partial<Record<BookMediaRole, string>> = {
  'couverture-epub': "Reprise par l'export EPUB — le seul export qui lise un média.",
  'couverture-broche': "Rangée ici seulement : l'export PDF ne l'intègre pas."
}

const media = ref<BookMedia[]>([])
const loading = ref(false)
const adding = ref(false)
const addRole = ref<BookMediaRole>(ROLES[0])

// Groupes non vides uniquement : un rôle sans média n'affiche pas de section
// vide (le sélecteur de l'en-tête suffit à en créer un premier).
const groups = computed(() =>
  ROLES.map((role) => ({
    role,
    label: BOOK_MEDIA_ROLE_LABELS[role],
    hint: ROLE_HINTS[role],
    items: media.value
      .filter((m) => m.role === role)
      .sort((a, b) => a.position - b.position || a.id - b.id)
  })).filter((group) => group.items.length > 0)
)

async function reload(): Promise<void> {
  loading.value = true
  try {
    media.value = await window.encre.bookMedia.listByBook(props.bookId)
  } catch (err) {
    console.error('Échec du chargement des médias du livre', err)
    ui.toast('Impossible de charger les médias de ce livre.')
  } finally {
    loading.value = false
  }
}

// --- Vignettes ---------------------------------------------------------
// Un PDF (couverture brochée, épreuve d'imprimeur) n'a pas de vignette : on
// affiche une pastille portant son extension en toutes lettres plutôt qu'une
// image cassée — encre-media:// ne sert que des images au renderer.
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'svg'])

function extension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase()
}
function isImage(fileName: string): boolean {
  return IMAGE_EXTENSIONS.has(extension(fileName))
}
function extensionLabel(fileName: string): string {
  return extension(fileName).toUpperCase() || 'FICHIER'
}

// --- Débounce par champ (motif BookSettingsPanel/EntityCard) -----------
// Clé = `${champ}:${id}` pour que deux médias édités à la suite ne se volent
// pas leur minuteur. À la fermeture, flushAll() exécute immédiatement tout
// commit en attente plutôt que de l'annuler.
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

async function commit(
  id: number,
  patch: { role?: BookMediaRole; displayName?: string; note?: string }
): Promise<void> {
  try {
    await window.encre.bookMedia.update(id, patch)
  } catch (err) {
    console.error('Échec de la mise à jour du média', err)
    ui.toast("Échec de l'enregistrement du média.")
  }
}

function onNameInput(m: BookMedia): void {
  debounced(`displayName:${m.id}`, () => commit(m.id, { displayName: m.displayName }))
}
function onNoteInput(m: BookMedia): void {
  debounced(`note:${m.id}`, () => commit(m.id, { note: m.note }))
}

// Changement de rôle : pas de débounce (action discrète, pas une frappe) et
// rechargement derrière, puisque le média change de groupe.
async function onRoleChange(m: BookMedia, event: Event): Promise<void> {
  const role = (event.target as HTMLSelectElement).value as BookMediaRole
  m.role = role
  await commit(m.id, { role })
  await reload()
}

// --- Ajout -------------------------------------------------------------
// Un bouton global + sélecteur de rôle, plutôt qu'un « Ajouter » par groupe :
// les groupes vides n'étant pas affichés, un bouton par groupe ne permettrait
// jamais de déposer le PREMIER média d'un rôle. Le rôle reste par ailleurs
// modifiable après coup sur chaque ligne.
async function add(): Promise<void> {
  if (adding.value) return
  adding.value = true
  try {
    await window.encre.bookMedia.add(props.bookId, addRole.value)
    await reload()
  } catch (err) {
    console.error("Échec de l'ajout d'un média", err)
    ui.toast("Échec de l'ajout du média.")
  } finally {
    adding.value = false
  }
}

async function reveal(m: BookMedia): Promise<void> {
  try {
    await window.encre.bookMedia.reveal(m.id)
  } catch (err) {
    console.error('Échec de la révélation du média dans le Finder', err)
    ui.toast('Impossible de montrer ce fichier dans le Finder.')
  }
}

async function saveAs(m: BookMedia): Promise<void> {
  try {
    const target = await window.encre.bookMedia.saveAs(m.id)
    if (target) ui.toast('Copie enregistrée.')
  } catch (err) {
    console.error("Échec de l'enregistrement d'une copie du média", err)
    ui.toast("Échec de l'enregistrement de la copie.")
  }
}

// --- Suppression -------------------------------------------------------
// Toujours via ConfirmDialog (jamais de suppression directe) : contrairement
// à une illustration, un média n'est référencé nulle part dans le texte, donc
// aucun comptage d'usage préalable — mais la suppression emporte le fichier,
// ce que le message dit explicitement.
const pendingRemoval = ref<BookMedia | null>(null)

const removalMessage = computed(() =>
  pendingRemoval.value
    ? `Supprimer « ${pendingRemoval.value.displayName} » ? Le fichier rangé avec le livre sera lui aussi effacé, définitivement.`
    : ''
)

function requestRemove(m: BookMedia): void {
  pendingRemoval.value = m
}
function cancelRemoval(): void {
  pendingRemoval.value = null
}
async function confirmRemoval(): Promise<void> {
  const pending = pendingRemoval.value
  pendingRemoval.value = null
  if (!pending) return
  try {
    await window.encre.bookMedia.remove(pending.id)
  } catch (err) {
    console.error('Échec de la suppression du média', err)
    ui.toast('Échec de la suppression du média.')
  }
  await reload()
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
  reload()
  await nextTick()
  dialogEl.value?.focus()
})
onBeforeUnmount(flushAll)
</script>

<template>
  <Transition name="dialog" appear>
    <div class="media-overlay" @click.self="close">
      <div
        ref="dialogEl"
        class="media-card"
        role="dialog"
        aria-modal="true"
        aria-label="Médias du livre"
        tabindex="-1"
        @keydown="onKeydown"
      >
        <header>
          <h2>Médias du livre</h2>
          <span class="kbd">Échap</span>
        </header>

        <div class="add-row">
          <label class="add-label" for="book-media-role">Rôle</label>
          <select id="book-media-role" v-model="addRole" class="role-select">
            <option v-for="role in ROLES" :key="role" :value="role">
              {{ BOOK_MEDIA_ROLE_LABELS[role] }}
            </option>
          </select>
          <button type="button" class="add-button" :disabled="adding" @click="add">
            {{ adding ? 'Ajout…' : 'Ajouter…' }}
          </button>
        </div>

        <div class="body">
          <p v-if="loading" class="status">Chargement…</p>
          <p v-else-if="groups.length === 0" class="status">
            Aucun média. Ce magasin range les fichiers qui entourent le livre — couvertures,
            quatrième de couverture, bannières, portrait d'auteur. Rien de ce qui est rangé ici
            n'entre dans le manuscrit : les images à insérer dans un chapitre sont les
            illustrations, gérées depuis l'éditeur.
          </p>
          <template v-else>
            <section v-for="group in groups" :key="group.role" class="group">
              <h3>{{ group.label }}</h3>
              <p v-if="group.hint" class="group-hint">{{ group.hint }}</p>
              <ul class="list">
                <li v-for="m in group.items" :key="m.id" class="item">
                  <img
                    v-if="isImage(m.fileName)"
                    class="thumb"
                    :src="mediaUrl(m.fileName) ?? undefined"
                    :alt="m.displayName"
                  />
                  <span v-else class="thumb badge" aria-hidden="true">
                    {{ extensionLabel(m.fileName) }}
                  </span>
                  <div class="meta">
                    <input
                      v-model="m.displayName"
                      class="name-input"
                      type="text"
                      spellcheck="false"
                      aria-label="Nom du média"
                      @input="onNameInput(m)"
                    />
                    <input
                      v-model="m.note"
                      class="note-input"
                      type="text"
                      placeholder="dimensions, où c'est publié…"
                      aria-label="Mémo du média"
                      @input="onNoteInput(m)"
                    />
                    <select
                      class="role-select item-role"
                      :value="m.role"
                      aria-label="Rôle du média"
                      @change="onRoleChange(m, $event)"
                    >
                      <option v-for="role in ROLES" :key="role" :value="role">
                        {{ BOOK_MEDIA_ROLE_LABELS[role] }}
                      </option>
                    </select>
                  </div>
                  <div class="actions">
                    <button
                      type="button"
                      class="icon-button"
                      title="Montrer dans le Finder"
                      aria-label="Montrer ce média dans le Finder"
                      @click="reveal(m)"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.75"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                      >
                        <path
                          d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      class="icon-button"
                      title="Enregistrer une copie…"
                      aria-label="Enregistrer une copie de ce média"
                      @click="saveAs(m)"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.75"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M12 3v12" />
                        <path d="m7 10 5 5 5-5" />
                        <path d="M4 20h16" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      class="icon-button danger"
                      title="Supprimer"
                      aria-label="Supprimer ce média"
                      @click="requestRemove(m)"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.75"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M4 7h16" />
                        <path d="M10 7V5h4v2" />
                        <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
                      </svg>
                    </button>
                  </div>
                </li>
              </ul>
            </section>
          </template>
        </div>

        <footer>
          <button type="button" class="primary" @click="close">Fermer</button>
        </footer>
      </div>
    </div>
  </Transition>
  <!-- Même correctif d'empilement que dans IllustrationsPanel : ConfirmDialog
       (z-index 200, partagé avec les autres dialogues) doit passer AU-DESSUS
       de .media-overlay, d'où ce contexte d'empilement dédié. -->
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
.confirm-lift {
  position: relative;
  z-index: 300;
}

.media-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: color-mix(in srgb, var(--fg) 25%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.media-card {
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
.media-card:focus,
.media-card:focus-visible {
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

.add-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.add-label {
  font-size: 12px;
  color: var(--fg-muted);
}
.add-row .role-select {
  flex: 1;
  min-width: 0;
}
.add-button {
  flex-shrink: 0;
  font-size: 12px;
  padding: 5px 12px;
  color: var(--fg-muted);
}
.add-button:hover:not(:disabled) {
  color: var(--accent);
  border-color: var(--accent);
}

/* Même recette que .field select (BookSettingsPanel) : appearance: none
   retire le rendu natif (flèche + cadre blanc du système), remplacé par un
   chevron CSS en dégradés qui suit les variables du thème. */
.role-select {
  -webkit-appearance: none;
  appearance: none;
  font: inherit;
  font-size: 12px;
  color: var(--fg);
  background-color: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 5px 26px 5px 8px;
  cursor: pointer;
  background-image:
    linear-gradient(45deg, transparent 50%, var(--fg-muted) 50%),
    linear-gradient(135deg, var(--fg-muted) 50%, transparent 50%);
  background-position:
    calc(100% - 14px) center,
    calc(100% - 9px) center;
  background-size:
    5px 5px,
    5px 5px;
  background-repeat: no-repeat;
  transition: border-color 0.15s ease;
}
.role-select:focus {
  outline: none;
  border-color: var(--accent);
}

.body {
  overflow-y: auto;
  padding: 12px 16px 16px;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.status {
  padding: 10px 2px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--fg-muted);
}

.group h3 {
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--fg-muted);
}
.group-hint {
  margin-top: 2px;
  font-size: 11.5px;
  line-height: 1.45;
  color: var(--fg-muted);
  opacity: 0.85;
}

.list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}

.item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.thumb {
  flex-shrink: 0;
  width: 64px;
  height: 64px;
  object-fit: cover;
  border-radius: 6px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
}
.thumb.badge {
  display: grid;
  place-items: center;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--fg-muted);
}

.meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.name-input,
.note-input {
  width: 100%;
  font-size: 12.5px;
  padding: 5px 7px;
}
.note-input {
  font-size: 12px;
  color: var(--fg-muted);
}
.item-role {
  align-self: flex-start;
  max-width: 100%;
}

.actions {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.icon-button {
  width: 24px;
  height: 24px;
  padding: 0;
  display: grid;
  place-items: center;
  border-radius: 6px;
  border-color: transparent;
  color: var(--fg-muted);
  transition:
    color 0.15s ease,
    border-color 0.15s ease;
}
.icon-button:hover:not(:disabled) {
  color: var(--accent);
  border-color: var(--accent);
}
.icon-button.danger:hover:not(:disabled) {
  color: var(--danger);
  border-color: var(--danger);
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
