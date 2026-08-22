<script setup lang="ts">
import { watch, onMounted, onBeforeUnmount, nextTick, ref } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { useBookStore } from '../stores/book'
import { useUiStore } from '../stores/ui'
import { useEntitiesStore } from '../stores/entities'
import { EntityMention } from '../editor/mention'
import AutolinkDialog, { type AutolinkMatch } from './AutolinkDialog.vue'
import { findNameMatches, type AutolinkTarget } from '../../../shared/autolink'
import { stripCodeBlocks } from '../../../shared/stripCodeBlocks'
import { CHAPTER_STATUS_LABELS } from '../../../shared/labels'
import type { ChapterStatus, Entity, OutlineNote } from '../../../shared/types'

const store = useBookStore()
const ui = useUiStore()
const entitiesStore = useEntitiesStore()

let saveTimer: ReturnType<typeof setTimeout> | null = null
let pendingChapterId: number | null = null
// Id du chapitre dont le contenu est réellement chargé dans l'éditeur : posé
// uniquement là où setContent s'exécute (chargement initial et watch
// ci-dessous), jamais lu depuis store.currentChapter. Pendant une transition
// de chapitre, store.currentChapter pointe déjà vers le nouveau alors que
// l'éditeur affiche encore l'ancien document (le temps que flush() puis
// setContent se terminent) ; taguer une frappe survenant dans cette fenêtre
// avec l'id du nouveau chapitre écraserait son contenu au prochain flush.
let editorChapterId: number | null = null

const editor = useEditor({
  extensions: [StarterKit.configure({ codeBlock: false, code: false }), EntityMention],
  content: '',
  onUpdate: () => {
    if (editorChapterId === null) return
    pendingChapterId = editorChapterId
    if (editorChapterId === store.currentChapter?.id) store.markDirty()
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(flush, 800)
  },
  // Clic sur une mention → ouvre le tiroir de la fiche visée (Task 11).
  // `direct` distingue un clic pile sur le nœud d'un clic qui ne fait que le
  // traverser (mention imbriquée dans un nœud parent plus large) ; la
  // mention étant un nœud atomique sans enfant, ça correspond exactement au
  // clic sur la mention elle-même.
  editorProps: {
    handleClickOn(_view, _pos, node, _nodePos, _event, direct) {
      if (!direct || node.type.name !== 'mention') return false
      const id = node.attrs.id
      if (typeof id === 'number') entitiesStore.openDrawer(id)
      return true
    }
  }
})

// Sauvegarde par id explicite : on capture le contenu de l'éditeur pour le
// chapitre qui avait la frappe en attente (pendingChapterId), jamais en le
// comparant à store.currentChapter — au moment du flush déclenché par un
// changement de chapitre, currentChapter pointe déjà vers le nouveau, et
// cette comparaison perdrait les dernières frappes du chapitre quitté.
async function flush(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  const ed = editor.value
  if (!ed || pendingChapterId === null) return
  const id = pendingChapterId
  const json = JSON.stringify(ed.getJSON())
  const text = ed.getText()
  pendingChapterId = null
  await store.saveContentFor(id, json, text)
}

// Jeton de génération : Vue n'attend pas qu'une invocation async du watcher
// se termine avant de lancer la suivante. Si l'utilisateur bascule A → B → A
// assez vite, l'invocation pour B peut encore être en attente sur son
// `await flush()` quand celle pour le retour vers A démarre ; sans garde,
// l'invocation B, une fois son flush résolu, écraserait le contenu déjà posé
// par l'invocation A avec un setContent obsolète. Chaque invocation capture
// son propre numéro de génération et abandonne avant setContent/focus si une
// invocation plus récente a démarré entre-temps.
let watchGeneration = 0

watch(
  () => store.currentChapter?.id,
  async (_newId, _oldId) => {
    const generation = ++watchGeneration
    // Le flush du chapitre précédent doit partir avant de charger le nouveau,
    // sans quoi setContent écraserait un éditeur qui a encore des frappes
    // non enregistrées.
    await flush()
    if (generation !== watchGeneration) return
    const ed = editor.value
    if (!ed || !store.currentChapter) return
    editorChapterId = store.currentChapter.id
    // Migration douce (Task publication 1) : d'anciens chapitres peuvent
    // encore contenir des blocs de code / marques `code`, retirés de
    // l'éditeur. `changed` ne sert qu'à documenter l'intention ; le contrat
    // de stripCodeBlocks garantit json === contentJson quand !changed, donc
    // `json` seul suffit ici. Pas de save déclenché (emitUpdate: false), la
    // prochaine frappe persistera la conversion naturellement.
    const { json } = stripCodeBlocks(store.currentChapter.contentJson)
    ed.commands.setContent(JSON.parse(json), { emitUpdate: false })
    ed.commands.focus('start')
  },
  { immediate: true }
)

// Chips « entités de ce chapitre » (Task 11) : entièrement séparé du cycle
// flush/generation-token ci-dessus, pour ne pas y toucher. Rafraîchi (a) au
// changement de chapitre — même signal que le watch de chargement, mais un
// effet Vue distinct — et (b) à chaque transition de store.saveState vers
// 'saved', qui suit la fin d'un saveContentFor réussi (voir stores/book.ts).
// Une sauvegarde en échec repasse par 'dirty', jamais par 'saved' : pas de
// rafraîchissement sur échec, et aucune boucle possible puisque ce watcher
// ne modifie jamais saveState lui-même.
const chapterEntities = ref<Entity[]>([])

async function refreshChapterEntities(): Promise<void> {
  const id = store.currentChapter?.id
  if (id == null) {
    chapterEntities.value = []
    return
  }
  try {
    chapterEntities.value = await window.encre.entities.inChapter(id)
  } catch (err) {
    console.error('Échec du chargement des entités du chapitre', err)
  }
}

watch(() => store.currentChapter?.id, refreshChapterEntities, { immediate: true })
watch(
  () => store.saveState,
  (state, previous) => {
    if (state === 'saved' && previous !== 'saved') refreshChapterEntities()
  }
)

// Liaison automatique des entités (Task 12) : entièrement séparée du cycle
// flush/generation-token — seule l'application de la transaction choisie par
// le dialogue rejoint le circuit normal (dispatch → onUpdate → save
// débouncée), sans jamais appeler flush() directement.
const autolinkOpen = ref(false)
const autolinkMatches = ref<AutolinkMatch[]>([])

function openAutolink(): void {
  const ed = editor.value
  if (!ed) return
  const targets: AutolinkTarget[] = entitiesStore.entities.map((entity) => ({
    id: entity.id,
    kind: entity.kind,
    names: [entity.name, ...entity.aliases]
  }))
  const matches: AutolinkMatch[] = []
  // Les nœuds mention sont des nœuds inline atomiques (pas de contenu) : un
  // nœud texte n'est donc jamais un descendant d'une mention, `node.isText`
  // suffit à exclure les mentions existantes sans filtrage supplémentaire.
  ed.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return
    for (const m of findNameMatches(node.text, targets)) {
      matches.push({
        from: pos + m.start,
        to: pos + m.end,
        entityId: m.entityId,
        kind: m.kind,
        matched: m.matched
      })
    }
  })
  if (matches.length === 0) {
    ui.toast('Aucune entité à lier dans ce chapitre.')
    return
  }
  autolinkMatches.value = matches
  autolinkOpen.value = true
}

function applyAutolink(selected: AutolinkMatch[]): void {
  const ed = editor.value
  if (!ed) return
  autolinkOpen.value = false
  if (selected.length === 0) return
  const mentionType = ed.schema.nodes.mention
  const tr = ed.state.tr
  // De la fin vers le début, dans UNE seule transaction : chaque
  // replaceWith en amont décale les positions de tout ce qui suit dans le
  // document, jamais celles qui précèdent — appliquer en ordre décroissant
  // laisse donc les positions `from`/`to` des occurrences restantes valides
  // sans avoir à les recalculer.
  // label: texte ORIGINAL apparié (m.matched), jamais le nom canonique de la
  // fiche — sans quoi la liaison réécrirait la prose de l'auteur (bug
  // utilisateur : « Nieves » écrit seul se retrouvait affiché avec le nom
  // complet de la fiche). Voir mention.ts pour la règle d'affichage
  // correspondante (alias tel quel vs nom courant propagé).
  for (const m of [...selected].sort((a, b) => b.from - a.from)) {
    tr.replaceWith(
      m.from,
      m.to,
      mentionType.create({ id: m.entityId, label: m.matched, kind: m.kind })
    )
  }
  // Dispatch direct (pas de editor.commands) : passe par le même
  // dispatchTransaction interne de TipTap que n'importe quelle commande, qui
  // émet 'update' dès que docChanged — onUpdate ci-dessus se déclenche donc
  // normalement et programme le flush débouncé (800 ms), sans appel manuel.
  ed.view.dispatch(tr)
}

// Résumé & notes de plan du chapitre (Task 13) : zone entièrement séparée du
// cycle flush/generation-token du corps ci-dessus — minuteur propre, état de
// repli propre, liste de notes propre. Rien ici n'écrit dans saveTimer,
// pendingChapterId ni editorChapterId, et rien ci-dessus ne lit cette
// section.

// Repli/dépli mémorisé par chapitre, en session seulement : une Map hors
// réactivité suffit (pas de persistance disque voulue), seule la valeur du
// chapitre affiché a besoin d'être réactive pour le template.
const summaryOpenByChapter = new Map<number, boolean>()
const summaryOpen = ref(false)

let summaryTimer: ReturnType<typeof setTimeout> | null = null
// Capture le chapitre concerné par la frappe en attente, jamais relu depuis
// store.currentChapter au moment du flush : au changement de chapitre,
// currentChapter pointe déjà vers le nouveau avant que ce minuteur n'ait eu
// l'occasion de se déclencher (même raison que pendingChapterId plus haut).
let pendingSummary: { id: number; text: string } | null = null

function flushSummary(): void {
  if (summaryTimer) {
    clearTimeout(summaryTimer)
    summaryTimer = null
  }
  if (!pendingSummary) return
  const { id, text } = pendingSummary
  pendingSummary = null
  store.saveSummary(id, text)
}

function onSummaryInput(event: Event): void {
  const chapter = store.currentChapter
  if (!chapter) return
  pendingSummary = { id: chapter.id, text: (event.target as HTMLTextAreaElement).value }
  if (summaryTimer) clearTimeout(summaryTimer)
  summaryTimer = setTimeout(flushSummary, 600)
}

function toggleSummary(): void {
  const id = store.currentChapter?.id
  summaryOpen.value = !summaryOpen.value
  if (id != null) summaryOpenByChapter.set(id, summaryOpen.value)
}
// Recalcule la hauteur des notes dès que la zone s'ouvre : si les notes sont
// arrivées pendant qu'elle était repliée (cas le plus courant — repliée par
// défaut à chaque changement de chapitre), le filet de sécurité de
// loadChapterNotes n'a rien pu corriger (voir regrowAllNotes). nextTick est
// nécessaire même ici : v-if="summaryOpen" ne monte .summary-body qu'au
// prochain rendu, les textareas n'existent pas encore dans noteRefs au
// moment où ce watcher se déclenche.
watch(summaryOpen, async (open) => {
  if (!open) return
  await nextTick()
  regrowAllNotes()
})

// Notes de plan portant sur ce chapitre précis (outline.chapterId === id),
// distinctes des notes globales du livre affichées par OutlineSection.
const chapterNotes = ref<OutlineNote[]>([])
const noteRefs = new Map<number, HTMLTextAreaElement>()
const noteTimers = new Map<number, ReturnType<typeof setTimeout>>()

function autoGrowNote(el: HTMLTextAreaElement): void {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}
function setNoteRef(note: OutlineNote, el: Element | null): void {
  if (!(el instanceof HTMLTextAreaElement)) return
  noteRefs.set(note.id, el)
  autoGrowNote(el)
}
// Recalcule la hauteur de toutes les notes déjà montées : appelé après le
// chargement des notes ET à l'ouverture de la zone repliable (voir les deux
// call sites ci-dessous). Nécessaire dans les deux cas séparément — les notes
// peuvent arriver alors que la zone « Résumé & notes » est encore repliée
// (par défaut à chaque changement de chapitre), auquel cas .summary-body
// n'existe pas dans le DOM : setNoteRef ne s'exécute jamais pour ces
// textareas (aucune ref posée), et le filet de sécurité de loadChapterNotes
// ne trouve donc rien à corriger dans noteRefs. La hauteur ne peut être
// calculée correctement qu'une fois la zone dépliée et les textareas
// réellement montées avec leur contenu.
function regrowAllNotes(): void {
  for (const note of chapterNotes.value) {
    const el = noteRefs.get(note.id)
    if (el) autoGrowNote(el)
  }
}

async function loadChapterNotes(): Promise<void> {
  const chapter = store.currentChapter
  if (!chapter) {
    chapterNotes.value = []
    return
  }
  // Garde de péremption : si l'utilisateur a déjà changé de chapitre pendant
  // cet appel IPC (chapter.id capturé ci-dessus, comparé à la valeur actuelle
  // après l'await), la réponse est pour un chapitre qui n'est plus affiché —
  // on l'ignore plutôt que d'écraser chapterNotes avec des notes obsolètes.
  const requestedId = chapter.id
  try {
    const all = await window.encre.outline.listByBook(chapter.bookId)
    if (store.currentChapter?.id !== requestedId) return
    chapterNotes.value = all
      .filter((n) => n.chapterId === requestedId)
      .sort((a, b) => a.position - b.position)
    // Filet de sécurité (comme OutlineSection.load) : recalcule la hauteur une
    // fois les données arrivées et le DOM à jour, pas seulement au ref-callback
    // de création — sans quoi une textarea peut rester coupée à 1 ligne au
    // retour sur ce chapitre si la zone résumé/notes était déjà dépliée.
    await nextTick()
    regrowAllNotes()
  } catch (err) {
    console.error('Échec du chargement des notes du chapitre', err)
  }
}

function onChapterNoteInput(note: OutlineNote, event: Event): void {
  autoGrowNote(event.target as HTMLTextAreaElement)
  clearTimeout(noteTimers.get(note.id))
  noteTimers.set(
    note.id,
    setTimeout(() => {
      noteTimers.delete(note.id)
      window.encre.outline
        .update(note.id, note.content)
        .catch((err) => console.error('Échec de la sauvegarde de la note', err))
    }, 600)
  )
}

async function addChapterNote(): Promise<void> {
  const chapter = store.currentChapter
  if (!chapter) return
  try {
    const note = await window.encre.outline.create(chapter.bookId, chapter.id)
    chapterNotes.value.push(note)
    await nextTick()
    noteRefs.get(note.id)?.focus()
  } catch (err) {
    console.error('Échec de la création de la note', err)
    ui.toast('Impossible de créer la note.')
  }
}

async function moveChapterNote(index: number, direction: -1 | 1): Promise<void> {
  const chapter = store.currentChapter
  const j = index + direction
  if (!chapter || j < 0 || j >= chapterNotes.value.length) return
  ;[chapterNotes.value[index], chapterNotes.value[j]] = [
    chapterNotes.value[j],
    chapterNotes.value[index]
  ]
  await window.encre.outline.reorder(
    chapter.bookId,
    chapter.id,
    chapterNotes.value.map((n) => n.id)
  )
}

async function removeChapterNote(note: OutlineNote): Promise<void> {
  if (!confirm('Supprimer cette note ?')) return
  // Idem OutlineSection.removeNote : purge le debounce en attente pour cette
  // note avant suppression, sinon il se déclencherait après coup sur un id
  // qui n'existe plus (le .catch ci-dessus couvre aussi ce cas).
  clearTimeout(noteTimers.get(note.id))
  noteTimers.delete(note.id)
  await window.encre.outline.remove(note.id)
  chapterNotes.value = chapterNotes.value.filter((n) => n.id !== note.id)
}

// Changement de chapitre : (a) force la sauvegarde d'un résumé en attente
// pour le chapitre QUITTÉ avant de perdre sa référence (pendingSummary porte
// déjà son propre id, donc rien à lire sur store.currentChapter ici), (b)
// reflète l'état replié/déplié mémorisé pour le nouveau chapitre, (c)
// recharge ses notes. Watcher entièrement étranger à celui du corps
// ci-dessus, même s'il observe la même source.
watch(
  () => store.currentChapter?.id,
  (id) => {
    flushSummary()
    summaryOpen.value = id != null ? (summaryOpenByChapter.get(id) ?? false) : false
    loadChapterNotes()
  },
  { immediate: true }
)

onMounted(() => {
  ui.registerQuitFlusher(() => flush())
})

// Le flush ici est fire-and-forget (onBeforeUnmount ne peut pas attendre une
// promesse) : historiquement une frappe juste avant démontage pouvait donc se
// perdre si la fermeture de l'app survenait au même instant. Ce n'est plus le
// cas depuis Task 7 — la fermeture passe désormais par la poignée de main
// IPC (onFlushRequest / flushDone), qui, elle, attend réellement le flusher
// enregistré via ui.registerQuitFlusher avant de laisser la fenêtre se
// fermer.
onBeforeUnmount(() => {
  flush()
  ui.registerQuitFlusher(null)
})

// Hook séparé (pas fusionné au précédent) pour ne pas toucher au flush du
// corps ci-dessus : démontage du composant (fermeture du livre, navigation
// hors de BookView) déclenche aussi la sauvegarde d'un résumé en attente.
// Comme flushSummary(), fire-and-forget — même limite assumée que le reste
// des champs debouncés de l'app (EntityCard) : un quit très rapide dans les
// 600 ms suivant la dernière frappe n'est pas couvert par la poignée de main
// IPC de fermeture (celle-ci n'attend que le flusher du corps).
onBeforeUnmount(() => {
  flushSummary()
})

function rename(event: Event): void {
  const title = (event.target as HTMLInputElement).value.trim()
  if (title && store.currentChapter) store.renameChapter(store.currentChapter.id, title)
}

const STATUSES: { value: ChapterStatus; label: string }[] = (
  Object.keys(CHAPTER_STATUS_LABELS) as ChapterStatus[]
).map((value) => ({ value, label: CHAPTER_STATUS_LABELS[value] }))
</script>

<template>
  <div v-if="store.currentChapter" class="editor-pane">
    <header>
      <input
        class="chapter-title"
        :value="store.currentChapter.title"
        spellcheck="false"
        @change="rename"
      />
      <select
        class="status-select"
        :value="store.currentChapter.status"
        @change="
          store.setChapterStatus(
            store.currentChapter!.id,
            ($event.target as HTMLSelectElement).value as ChapterStatus
          )
        "
      >
        <option v-for="s in STATUSES" :key="s.value" :value="s.value">{{ s.label }}</option>
      </select>
      <button
        type="button"
        class="autolink-btn"
        title="Convertit les noms de fiches écrits sans @ en mentions liées"
        @click="openAutolink"
      >
        Lier les entités
      </button>
    </header>

    <div class="summary-zone">
      <button
        type="button"
        class="summary-toggle"
        :aria-expanded="summaryOpen"
        @click="toggleSummary"
      >
        <span class="chevron" :class="{ open: summaryOpen }">▸</span>
        Résumé &amp; notes
      </button>
      <div v-if="summaryOpen" class="summary-body">
        <div class="field">
          <span class="field-label">Résumé</span>
          <textarea
            v-model="store.currentChapter.summary"
            class="summary-text"
            rows="2"
            placeholder="Résumé manuel de ce chapitre — prioritaire pour le contexte donné à l'IA."
            @input="onSummaryInput"
          ></textarea>
        </div>

        <div class="field">
          <div class="field-head">
            <span class="field-label">Notes de plan de ce chapitre</span>
            <button type="button" class="add-note" @click="addChapterNote">+ Note</button>
          </div>
          <p v-if="chapterNotes.length === 0" class="empty-notes">
            Aucune note de plan pour ce chapitre.
          </p>
          <ol v-else class="notes-list">
            <li v-for="(note, index) in chapterNotes" :key="note.id" class="note">
              <textarea
                :ref="(el) => setNoteRef(note, el as Element | null)"
                v-model="note.content"
                class="note-text"
                rows="1"
                placeholder="Nouvelle note…"
                @input="onChapterNoteInput(note, $event)"
              ></textarea>
              <span class="note-controls">
                <button
                  :disabled="index === 0"
                  type="button"
                  title="Monter"
                  @click="moveChapterNote(index, -1)"
                >
                  ↑
                </button>
                <button
                  :disabled="index === chapterNotes.length - 1"
                  type="button"
                  title="Descendre"
                  @click="moveChapterNote(index, 1)"
                >
                  ↓
                </button>
                <button type="button" title="Supprimer" @click="removeChapterNote(note)">×</button>
              </span>
            </li>
          </ol>
        </div>
      </div>
    </div>

    <div v-if="chapterEntities.length" class="chapter-chips">
      <button
        v-for="entity in chapterEntities"
        :key="entity.id"
        type="button"
        class="chip"
        :class="{ 'chip-place': entity.kind === 'place' }"
        @click="entitiesStore.openDrawer(entity.id)"
      >
        <span class="chip-badge">{{ entity.kind === 'character' ? '◆' : '●' }}</span>
        {{ entity.name }}
      </button>
    </div>
    <EditorContent :editor="editor" class="page" />
    <AutolinkDialog
      v-if="autolinkOpen"
      :matches="autolinkMatches"
      @close="autolinkOpen = false"
      @apply="applyAutolink"
    />
  </div>
</template>

<style scoped>
.editor-pane {
  display: flex;
  flex-direction: column;
  /* .editor-pane est un enfant flex de <main> (BookView, flex-direction: column)
     au même niveau que <StatusBar>. `height: 100%` le forcerait à occuper toute
     la hauteur de main et pousserait la barre d'état hors champ dès que le
     contenu dépasse ~4 lignes (min-height auto par défaut empêche l'enfant de
     rétrécir). flex: 1 + min-height: 0 le laisse partager l'espace avec
     StatusBar et rétrécir sous sa taille de contenu, pour que .page défile en
     interne pendant que la barre reste ancrée en bas. */
  flex: 1;
  min-height: 0;
}

header {
  display: flex;
  gap: 14px;
  align-items: center;
  /* Gouttière horizontale réelle (padding, pas seulement margin: auto) :
     restaurée ici et sur .summary-zone/.chapter-chips/.page ci-dessous — sans
     elle, dès que la fenêtre est plus étroite que max-width, la marge auto se
     réduit à 0 et titre/statut/bouton viennent buter sur les bords (retour
     utilisateur : colonne rognée à gauche, en-tête écrasé à droite). */
  padding: 28px 24px 10px;
  max-width: 44rem;
  width: 100%;
  margin: 0 auto;
  flex-shrink: 0;
}

.chapter-title {
  flex: 1;
  min-width: 0;
  border: none;
  border-radius: 4px;
  background: none;
  padding: 2px 4px;
  margin: 0 -4px;
  font-family: var(--font-manuscript);
  font-weight: 600;
  font-size: 25px;
  letter-spacing: -0.005em;
  color: var(--fg);
  transition: background-color 0.12s ease;
}
.chapter-title:hover {
  background: color-mix(in srgb, var(--fg) 5%, transparent);
}
.chapter-title:focus {
  outline: none;
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}

.status-select {
  flex-shrink: 0;
  -webkit-appearance: none;
  appearance: none;
  font-family: var(--font-ui);
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--fg-muted);
  background: none;
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 5px 24px 5px 12px;
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
  transition:
    border-color 0.12s ease,
    color 0.12s ease;
}
.status-select:hover,
.status-select:focus {
  outline: none;
  border-color: var(--accent);
  color: var(--accent);
}

.autolink-btn {
  flex-shrink: 0;
  font-size: 11.5px;
  padding: 5px 12px;
  color: var(--fg-muted);
}
.autolink-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.summary-zone {
  max-width: 44rem;
  width: 100%;
  margin: 0 auto;
  padding: 0 24px 10px;
  flex-shrink: 0;
}

.summary-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  padding: 3px 4px 3px 0;
  font-size: 11.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--fg-muted);
}
.summary-toggle:hover {
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

.summary-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 8px;
  padding: 14px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 10px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.field-label {
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--fg-muted);
}

/* Résumé et notes : texte de travail, pas manuscrit — hérite de --font-ui
   (posé sur <body>, theme.css) plutôt que --font-manuscript, comme les
   champs description/notes des fiches personnages/lieux (EntityCard).
   Bordure + fond explicites (--bg sur le panneau --bg-panel) : visible avant
   la frappe, pas seulement au focus (retour utilisateur). */
.summary-text {
  width: 100%;
  resize: vertical;
  border: 1px solid var(--border);
  background: var(--bg);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 13px;
  line-height: 1.55;
}

.add-note {
  font-size: 11px;
  padding: 3px 9px;
  color: var(--fg-muted);
}
.add-note:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.empty-notes {
  font-size: 12px;
  color: var(--fg-muted);
}

.notes-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.note {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 8px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
}
/* Visible avant la frappe (retour utilisateur) : le parent .note est déjà en
   --bg (distinct du --bg-panel du panneau résumé/notes), donc un fond --bg
   identique serait invisible ici — color-mix creuse un léger écart au lieu. */
.note-text {
  flex: 1;
  min-width: 0;
  resize: none;
  overflow: hidden;
  /* Filet de sécurité (Task 15 bis) : si autoGrowNote se déclenche jamais
     (scrollHeight mesuré sur un élément pas encore connecté au DOM, cas
     historique du bug « notes illisibles ») ou renvoie 0, min-height garantit
     quand même ~2 lignes lisibles plutôt qu'une bande de quelques pixels. */
  min-height: 54px;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--fg) 4%, var(--bg));
  border-radius: 5px;
  padding: 6px 8px;
  font-size: 13px;
  line-height: 1.55;
}
.note-text:focus {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 6%, var(--bg));
}
.note-controls {
  flex-shrink: 0;
  display: flex;
  gap: 1px;
  padding-top: 2px;
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
.note-controls button:disabled {
  opacity: 0.25;
  cursor: default;
}

.chapter-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-width: 44rem;
  width: 100%;
  margin: 0 auto;
  padding: 0 24px 12px;
  flex-shrink: 0;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  color: var(--accent);
  border: none;
  border-radius: 100px;
  padding: 3px 10px 3px 8px;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
}
.chip:hover {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
}
.chip-badge {
  font-size: 9px;
}
.chip.chip-place .chip-badge {
  color: color-mix(in srgb, var(--accent) 60%, transparent);
}

.page {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  /* Gouttière portée par le conteneur scrollable lui-même, pas par la colonne
     centrée (:deep(.tiptap) ci-dessous) : ainsi le texte garde une marge
     minimale des deux côtés même quand la fenêtre est plus étroite que
     max-width (voir header, même raisonnement). */
  padding: 0 24px;
  /* Réserve la place de la scrollbar verticale AVANT qu'elle n'apparaisse :
     sans ça, la scrollbar (quand le contenu dépasse la hauteur visible)
     grignote la moitié droite de ce padding, ce qui décale visuellement
     :deep(.tiptap) de quelques pixels vers la gauche par rapport à
     header/.summary-zone/.chapter-chips (eux jamais rétrécis par une
     scrollbar). stable garde une marge symétrique que la scrollbar soit
     visible ou non, cohérent avec les autres gouttières de la colonne. */
  scrollbar-gutter: stable;
}
.page :deep(.tiptap) {
  width: 100%;
  max-width: 44rem;
  margin: 0 auto;
  padding: 12px 0 45vh;
  font-family: var(--font-manuscript);
  font-size: 18px;
  line-height: 1.75;
  color: var(--fg);
  caret-color: var(--accent);
  outline: none;
}
.page :deep(.tiptap p) {
  margin-bottom: 0.9em;
}
.page :deep(.tiptap strong) {
  font-weight: 700;
}
.page :deep(.tiptap em) {
  font-style: italic;
}
</style>
