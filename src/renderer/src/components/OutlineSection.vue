<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { useBookStore } from '../stores/book'
import { useUiStore } from '../stores/ui'
import type { OutlineNote } from '../../../shared/types'
import { autoGrowClamped } from '../utils/autoGrow'
import ConfirmDialog from './ConfirmDialog.vue'

const store = useBookStore()
const ui = useUiStore()

// Notes globales du livre uniquement (chapterId === null) : les notes de
// plan par chapitre vivent dans la zone repliable de l'éditeur (EditorPane),
// avec leur propre chargement/portée — cette section ne les affiche jamais.
const notes = ref<OutlineNote[]>([])

async function load(): Promise<void> {
  if (!store.book) return
  try {
    const all = await window.encre.outline.listByBook(store.book.id)
    notes.value = all.filter((n) => n.chapterId === null).sort((a, b) => a.position - b.position)
    // Les données arrivent après le rendu initial (await ci-dessus) : le
    // ref-callback des textareas (setTextareaRef) tourne bien à leur
    // création, mais on force ici un second passage une fois le DOM à jour
    // (nextTick) — filet de sécurité pour ne jamais retomber sur une
    // textarea coupée à 1 ligne au retour dans la section.
    await nextTick()
    for (const note of notes.value) {
      const el = textareaRefs.get(note.id)
      if (el) autoGrow(el)
    }
  } catch (err) {
    console.error('Échec du chargement du plan', err)
  }
}
onMounted(load)
watch(() => store.book?.id, load)

// Sauvegarde debouncée par note : chaque textarea a son propre minuteur, une
// note ne doit jamais retarder ni écraser la sauvegarde d'une autre.
const timers = new Map<number, ReturnType<typeof setTimeout>>()
function commitNote(note: OutlineNote): void {
  clearTimeout(timers.get(note.id))
  timers.set(
    note.id,
    setTimeout(() => {
      timers.delete(note.id)
      window.encre.outline.update(note.id, note.content).catch((err) => {
        console.error('Échec de la sauvegarde de la note', err)
        ui.toast('Échec de la sauvegarde de la note.')
      })
    }, 600)
  )
}

// Auto-grow : la hauteur suit le contenu plutôt qu'une poignée de
// redimensionnement manuelle, pour rester cohérent avec l'esprit fiche/carte
// du reste de l'app (EntityCard, ChapterList) où le texte libre reste court.
// Plafonné à 40vh (voir utils/autoGrow.ts) : une note globale très longue
// arrête de grandir et défile en interne (max-height + overflow-y: auto sur
// .note-text ci-dessous) plutôt que de pousser le reste de la liste hors
// champ.
const textareaRefs = new Map<number, HTMLTextAreaElement>()
function autoGrow(el: HTMLTextAreaElement): void {
  autoGrowClamped(el)
}
function setTextareaRef(note: OutlineNote, el: Element | null): void {
  if (!(el instanceof HTMLTextAreaElement)) return
  textareaRefs.set(note.id, el)
  autoGrow(el)
}
function onNoteInput(note: OutlineNote, event: Event): void {
  autoGrow(event.target as HTMLTextAreaElement)
  commitNote(note)
}

async function addNote(): Promise<void> {
  if (!store.book) return
  try {
    const note = await window.encre.outline.create(store.book.id, null)
    notes.value.push(note)
    await nextTick()
    textareaRefs.get(note.id)?.focus()
  } catch (err) {
    console.error('Échec de la création de la note', err)
    ui.toast('Impossible de créer la note.')
  }
}

async function moveNote(index: number, direction: -1 | 1): Promise<void> {
  const j = index + direction
  if (!store.book || j < 0 || j >= notes.value.length) return
  ;[notes.value[index], notes.value[j]] = [notes.value[j], notes.value[index]]
  await window.encre.outline.reorder(
    store.book.id,
    null,
    notes.value.map((n) => n.id)
  )
}

// Suppression thémée (audit UI/UX, proposition #13) : window.confirm() natif
// remplacé par ConfirmDialog — même sémantique (confirmer supprime, annuler/
// Échap ne fait rien).
const pendingRemoval = ref<OutlineNote | null>(null)

function removeNote(note: OutlineNote): void {
  pendingRemoval.value = note
}

async function confirmRemoval(): Promise<void> {
  const note = pendingRemoval.value
  pendingRemoval.value = null
  if (!note) return
  // Sans ce clearTimeout, un debounce encore en attente (note éditée puis
  // supprimée dans les 600 ms) se déclencherait après coup avec l'id d'une
  // note qui n'existe plus côté renderer — d'où le .catch ci-dessus en
  // complément, pour ce cas comme pour tout autre échec IPC.
  clearTimeout(timers.get(note.id))
  timers.delete(note.id)
  await window.encre.outline.remove(note.id)
  notes.value = notes.value.filter((n) => n.id !== note.id)
}

function cancelRemoval(): void {
  pendingRemoval.value = null
}
</script>

<template>
  <div class="section">
    <header>
      <h2>Plan</h2>
      <button class="primary" type="button" @click="addNote">
        <span class="plus">+</span> Nouvelle note
      </button>
    </header>

    <p v-if="notes.length === 0" class="empty">
      Aucune note de plan pour l’instant. Cliquez sur <span class="plus-ref">+</span> pour
      commencer.
    </p>

    <TransitionGroup v-else name="row" tag="ol" class="notes">
      <li v-for="(note, index) in notes" :key="note.id" class="note">
        <span class="index">{{ index + 1 }}</span>
        <textarea
          :ref="(el) => setTextareaRef(note, el as Element | null)"
          v-model="note.content"
          class="note-text"
          rows="1"
          placeholder="Nouvelle note…"
          @input="onNoteInput(note, $event)"
        ></textarea>
        <span class="note-controls">
          <button
            :disabled="index === 0"
            type="button"
            title="Monter"
            aria-label="Monter cette note"
            @click="moveNote(index, -1)"
          >
            ↑
          </button>
          <button
            :disabled="index === notes.length - 1"
            type="button"
            title="Descendre"
            aria-label="Descendre cette note"
            @click="moveNote(index, 1)"
          >
            ↓
          </button>
          <button
            type="button"
            title="Supprimer"
            aria-label="Supprimer cette note"
            @click="removeNote(note)"
          >
            ×
          </button>
        </span>
      </li>
    </TransitionGroup>

    <ConfirmDialog
      v-if="pendingRemoval"
      message="Supprimer cette note ?"
      @confirm="confirmRemoval"
      @cancel="cancelRemoval"
    />
  </div>
</template>

<style scoped>
.section {
  padding: 28px 36px 48px;
  height: 100vh;
  overflow-y: auto;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
}
h2 {
  font-family: var(--font-manuscript);
  font-size: 22px;
  font-weight: 600;
}
.plus {
  display: inline-block;
  margin-right: 2px;
}

.empty {
  color: var(--fg-muted);
  font-size: 13px;
  padding: 12px 2px;
}
.plus-ref {
  color: var(--accent);
  font-weight: 600;
}

.notes {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 42rem;
}

.note {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 10px;
}

/* La numérotation reflète l'ordre réel du plan (réordonnançable via ↑/↓) :
   contrairement à un badge décoratif, elle porte une information — la place
   de cette note dans la séquence — donc justifiée ici. */
.index {
  flex-shrink: 0;
  width: 20px;
  padding-top: 7px;
  text-align: right;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--fg-muted);
}

/* Texte de travail (notes/plan), pas manuscrit : hérite de --font-ui (défini
   sur <body>, cf. theme.css) plutôt que --font-manuscript, comme les champs
   description/notes des fiches personnages/lieux (EntityCard). */
/* Visible avant la frappe (retour utilisateur) : bordure + fond distinct de
   la carte qui la porte (--bg-panel), plutôt qu'un champ transparent qu'on ne
   perçoit qu'au focus. */
.note-text {
  flex: 1;
  min-width: 0;
  resize: none;
  /* Plafonné (Task 4b) : au-delà de 40vh, la textarea défile en interne au
     lieu de continuer à grandir (voir autoGrowClamped, utils/autoGrow.ts) —
     overflow-y: auto (pas hidden) rend ce défilement possible une fois le
     plafond atteint. Le conteneur .section défile déjà lui-même (overflow-y:
     auto, height: 100vh) : ce plafond évite juste qu'une note démesurée ne
     domine visuellement toute la liste. */
  max-height: 40vh;
  overflow-y: auto;
  border: 1px solid var(--border);
  background: var(--bg);
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 13.5px;
  line-height: 1.6;
}
.note-text:focus {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 5%, var(--bg));
}

.note-controls {
  flex-shrink: 0;
  display: flex;
  gap: 1px;
  padding-top: 3px;
}
.note-controls button {
  border: none;
  padding: 2px 6px;
  font-size: 12px;
  border-radius: 4px;
  color: var(--fg-muted);
}
.note-controls button:hover:not(:disabled) {
  color: var(--fg);
  background: color-mix(in srgb, var(--fg) 8%, transparent);
}

.row-enter-active,
.row-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}
.row-enter-from,
.row-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
.row-move {
  transition: transform 0.15s ease;
}
</style>
