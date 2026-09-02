<script setup lang="ts">
import { watch, onMounted, onBeforeUnmount, nextTick, ref, computed } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import type { JSONContent } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { useBookStore } from '../stores/book'
import { useUiStore } from '../stores/ui'
import { useEntitiesStore } from '../stores/entities'
import { useAiStore } from '../stores/ai'
import { useSettingsStore } from '../stores/settings'
import { EntityMention } from '../editor/mention'
import { SceneBreak, PageBreak } from '../editor/formatNodes'
import { Illustration } from '../editor/illustration'
import {
  ChapterOpening,
  PartOpening,
  TableOfContents,
  FrontMatterPage
} from '../editor/layoutNodes'
import AutolinkDialog, { type AutolinkMatch } from './AutolinkDialog.vue'
import SnapshotManager from './SnapshotManager.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import IllustrationsPanel from './IllustrationsPanel.vue'
import { findNameMatches, type AutolinkTarget } from '../../../shared/autolink'
import { stripCodeBlocks } from '../../../shared/stripCodeBlocks'
import { locateQuote, type DocNode } from '../../../shared/quoteLocator'
import { CHAPTER_STATUS_LABELS } from '../../../shared/labels'
import type {
  ChapterStatus,
  Entity,
  Illustration as IllustrationRecord,
  OutlineNote
} from '../../../shared/types'
import { autoGrowClamped } from '../utils/autoGrow'

const store = useBookStore()
const ui = useUiStore()
const entitiesStore = useEntitiesStore()
const ai = useAiStore()
const settings = useSettingsStore()

// Confort d'écriture (réglage du texte de l'éditeur) : popover léger "Àa"
// modelé sur les autres popovers de l'en-tête (fermeture clic extérieur).
const confortWrapEl = ref<HTMLElement | null>(null)
const confortOpen = ref(false)
const FONT_SIZE_RANGE = { min: 14, max: 22, step: 1 }
const LINE_HEIGHT_RANGE = { min: 1.4, max: 2.2, step: 0.05 }
const COL_WIDTH_RANGE = { min: 30, max: 48, step: 2 }

function toggleConfort(): void {
  confortOpen.value = !confortOpen.value
}
function onWindowMousedownForConfort(event: MouseEvent): void {
  if (confortWrapEl.value?.contains(event.target as Node)) return
  confortOpen.value = false
}
watch(confortOpen, (open) => {
  if (open) window.addEventListener('mousedown', onWindowMousedownForConfort)
  else window.removeEventListener('mousedown', onWindowMousedownForConfort)
})
onBeforeUnmount(() => window.removeEventListener('mousedown', onWindowMousedownForConfort))

// Ouverture de la recherche plein texte (⌘F) : même mécanisme CustomEvent que
// 'palette:…' — EditorPane n'a pas de référence vers BookView (frères), et
// c'est BookView qui monte le panneau de recherche (BookSearch.vue).
function openSearch(): void {
  window.dispatchEvent(new CustomEvent('book:open-search'))
}

// Reprise de lecture : la div qui défile (wrapper de l'éditeur), pour
// sauvegarder/restaurer sa position de scroll (voir watch de chargement et
// sauverReprise plus bas).
const pageScrollEl = ref<HTMLElement | null>(null)

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

// Édition en place des quatre nœuds de mise en page (Task 7) : layoutDraft
// pilote un unique popover pour l'insertion (menu ¶+, pos: null — voir plus
// bas) ET l'édition d'un nœud déjà posé (clic dessus dans l'éditeur, pos: sa
// position — voir editorProps.handleClickOn ci-dessous). Déclaré ici, avant
// useEditor, car handleClickOn l'écrit directement.
type LayoutDraft =
  | { kind: 'chapterOpening'; enseigne: string; titre: string; sousTitre: string; recto: boolean }
  | { kind: 'partOpening'; label: string; recto: boolean }
  | { kind: 'tableOfContents'; titre: string }
  | { kind: 'frontMatterPage'; genre: 'titre' | 'colophon' | 'dedicace' }
  | { kind: 'illustration'; taille: 'pleine' | 'vignette' }

const layoutDraft = ref<{ draft: LayoutDraft; pos: number | null } | null>(null)

// Reconstruit un LayoutDraft à partir des attrs bruts d'un nœud existant (clic
// dans l'éditeur) : ces attrs sont un Record<string, any> côté ProseMirror,
// jamais fait confiance à leur type — chaque champ retombe sur le défaut du
// nœud correspondant (voir layoutNodes.ts) s'il est absent/invalide, comme
// parseRecto y traite déjà toute valeur autre que 'false' comme vraie.
function draftFromLayoutNode(name: string, attrs: Record<string, unknown>): LayoutDraft | null {
  switch (name) {
    case 'chapterOpening':
      return {
        kind: 'chapterOpening',
        enseigne: typeof attrs.enseigne === 'string' ? attrs.enseigne : '',
        titre: typeof attrs.titre === 'string' ? attrs.titre : '',
        sousTitre: typeof attrs.sousTitre === 'string' ? attrs.sousTitre : '',
        recto: attrs.recto !== false
      }
    case 'partOpening':
      return {
        kind: 'partOpening',
        label: typeof attrs.label === 'string' ? attrs.label : '',
        recto: attrs.recto !== false
      }
    case 'tableOfContents':
      return {
        kind: 'tableOfContents',
        titre: typeof attrs.titre === 'string' ? attrs.titre : 'SOMMAIRE'
      }
    case 'frontMatterPage':
      return {
        kind: 'frontMatterPage',
        genre: attrs.genre === 'colophon' || attrs.genre === 'dedicace' ? attrs.genre : 'titre'
      }
    case 'illustration':
      return { kind: 'illustration', taille: attrs.taille === 'vignette' ? 'vignette' : 'pleine' }
    default:
      return null
  }
}

const editor = useEditor({
  // horizontalRule désactivé (Task 3) : sceneBreak possède sa propre règle de
  // saisie (***/---/* * * + Entrée) et son propre rendu — les deux extensions
  // ne doivent jamais cohabiter, sans quoi la règle d'entrée de StarterKit
  // (déclenchée à la frappe, pas à Entrée) entrerait en concurrence avec la
  // nôtre sur les mêmes marqueurs. Les documents déjà enregistrés avec un
  // horizontalRule restent lisibles : stripCodeBlocks() les convertit en
  // sceneBreak au chargement (voir le watch plus bas).
  extensions: [
    StarterKit.configure({ codeBlock: false, code: false, horizontalRule: false }),
    EntityMention,
    SceneBreak,
    PageBreak,
    Illustration,
    ChapterOpening,
    PartOpening,
    TableOfContents,
    FrontMatterPage
  ],
  content: '',
  onUpdate: () => {
    if (editorChapterId === null) return
    pendingChapterId = editorChapterId
    if (editorChapterId === store.currentChapter?.id) store.markDirty()
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(flush, 800)
  },
  // Clic sur une mention → ouvre le tiroir de la fiche visée (Task 11).
  // Clic sur un des quatre nœuds de mise en page (Task 7) → rouvre le
  // popover d'édition en place, pré-rempli depuis ses attrs actuels (voir
  // draftFromLayoutNode ci-dessus). `direct` distingue un clic pile sur le
  // nœud d'un clic qui ne fait que le traverser (nœud parent plus large) ;
  // les cinq nœuds concernés sont tous atomiques ou selectable, ça correspond
  // exactement au clic sur le nœud lui-même.
  editorProps: {
    handleClickOn(_view, _pos, node, nodePos, _event, direct) {
      if (!direct) return false
      if (node.type.name === 'mention') {
        const id = node.attrs.id
        if (typeof id === 'number') entitiesStore.openDrawer(id)
        return true
      }
      const draft = draftFromLayoutNode(node.type.name, node.attrs)
      if (draft) {
        // Les deux panneaux (menu ¶+ et popover d'édition) partagent le même
        // point d'ancrage (formatWrapEl) : un seul doit rester visible à la
        // fois, sans quoi le popover, plus tardif dans le DOM, recouvrirait
        // silencieusement le menu.
        formatMenuOpen.value = false
        layoutDraft.value = { draft, pos: nodePos }
        return true
      }
      return false
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
  async (_newId, oldId) => {
    const generation = ++watchGeneration
    // Un changement de chapitre via la palette ⌘K ne déclenche aucun
    // mousedown extérieur (voir onWindowMousedownForLayoutDraft) : sans ce
    // reset, le popover garderait une `pos` qui vise le document quitté.
    layoutDraft.value = null
    // Reprise : mémorise le scroll du chapitre QUITTÉ avant de charger le
    // suivant (la div qui défile contient encore l'ancien document jusqu'à
    // setContent plus bas) — oldId est le chapitre quitté (currentChapter
    // pointe déjà vers le nouveau ici), et le premier chargement (oldId
    // null, immediate) n'a rien à sauvegarder.
    if (oldId != null) store.sauverReprise(oldId, pageScrollEl.value?.scrollTop ?? 0)
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
    // Reprise de lecture : au premier chargement après une ouverture du livre,
    // store.open a posé repriseScrollTop (ou null) — le restaurant au lieu de
    // partir du sommet, curseur posé en début sans défilement (scrollIntoView:
    // false), puis la garde est consommée.
    const scrollTop = store.repriseScrollTop
    if (scrollTop != null && pageScrollEl.value) {
      pageScrollEl.value.scrollTop = scrollTop
      store.clearRepriseScroll()
      ed.commands.focus('start', { scrollIntoView: false })
    } else {
      ed.commands.focus('start')
    }
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

// Renvoie la promesse de store.saveSummary (au lieu d'un simple fire-and-
// forget) : c'est ce qui permet au flusher enregistré auprès du store ui
// (onMounted plus bas) d'être réellement attendu par runQuitFlush() avant que
// la fenêtre ne se ferme. Les appels existants (débounce, changement de
// chapitre) ignorent toujours la valeur de retour, sans changement de
// comportement pour eux.
function flushSummary(): Promise<void> {
  if (summaryTimer) {
    clearTimeout(summaryTimer)
    summaryTimer = null
  }
  if (!pendingSummary) return Promise.resolve()
  const { id, text } = pendingSummary
  pendingSummary = null
  return store.saveSummary(id, text)
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

// Plafonné à 40vh (voir utils/autoGrow.ts) : une note de chapitre très longue
// arrête de grandir et défile en interne (max-height + overflow-y: auto sur
// .note-text ci-dessous) plutôt que de pousser .summary-body au-delà de la
// hauteur disponible — sans quoi la zone devenait illisible/inaccessible
// (bug utilisateur), main ayant overflow: hidden et .summary-zone étant hors
// de la zone de scroll .page.
function autoGrowNote(el: HTMLTextAreaElement): void {
  autoGrowClamped(el)
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

// Commit d'une note de chapitre : jamais rejeté (catch interne + toast
// français), pour que ni le setTimeout ci-dessous ni flushChapterNotesQuit
// (quit-flusher, voir plus bas) n'aient à gérer un rejet.
function commitChapterNote(note: OutlineNote): Promise<void> {
  return window.encre.outline.update(note.id, note.content).catch((err) => {
    console.error('Échec de la sauvegarde de la note', err)
    ui.toast('Échec de la sauvegarde de la note.')
  })
}

function onChapterNoteInput(note: OutlineNote, event: Event): void {
  autoGrowNote(event.target as HTMLTextAreaElement)
  clearTimeout(noteTimers.get(note.id))
  noteTimers.set(
    note.id,
    setTimeout(() => {
      noteTimers.delete(note.id)
      commitChapterNote(note)
    }, 600)
  )
}

// Flusher de fermeture (voir onMounted plus bas) : force l'envoi immédiat de
// tout commit de note de chapitre encore derrière son debounce 600 ms, pour
// fermer la fenêtre de perte identifiée dans le plan (quit juste après la
// dernière frappe). commitChapterNote ne rejette jamais (catch interne
// ci-dessus), donc Promise.all ici ne peut pas provoquer d'échec en cascade.
function flushChapterNotesQuit(): Promise<void> {
  const pendingIds = Array.from(noteTimers.keys())
  const commits = pendingIds.map((id) => {
    clearTimeout(noteTimers.get(id))
    noteTimers.delete(id)
    const note = chapterNotes.value.find((n) => n.id === id)
    return note ? commitChapterNote(note) : Promise.resolve()
  })
  return Promise.all(commits).then(() => undefined)
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

// Suppression thémée (audit UI/UX, proposition #13) : window.confirm() natif
// remplacé par ConfirmDialog, montée plus bas dans le template — même
// sémantique (confirmer supprime, annuler/Échap ne fait rien).
const pendingNoteRemoval = ref<OutlineNote | null>(null)

function removeChapterNote(note: OutlineNote): void {
  pendingNoteRemoval.value = note
}

async function confirmNoteRemoval(): Promise<void> {
  const note = pendingNoteRemoval.value
  pendingNoteRemoval.value = null
  if (!note) return
  // Idem OutlineSection.removeNote : purge le debounce en attente pour cette
  // note avant suppression, sinon il se déclencherait après coup sur un id
  // qui n'existe plus (le .catch du commit couvre aussi ce cas).
  clearTimeout(noteTimers.get(note.id))
  noteTimers.delete(note.id)
  await window.encre.outline.remove(note.id)
  chapterNotes.value = chapterNotes.value.filter((n) => n.id !== note.id)
}

function cancelNoteRemoval(): void {
  pendingNoteRemoval.value = null
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

// Trois flushers distincts (corps, résumé, notes de chapitre) plutôt qu'un
// seul agrégat : chacun garde sa propre logique de purge (voir plus haut/bas),
// et runQuitFlush() du store ui les exécute tous via Promise.allSettled — un
// échec de l'un n'empêche jamais les autres de partir.
let unsubscribeBodyFlusher: (() => void) | null = null
let unsubscribeSummaryFlusher: (() => void) | null = null
let unsubscribeNotesFlusher: (() => void) | null = null
let unsubscribeRepriseFlusher: (() => void) | null = null

onMounted(() => {
  unsubscribeBodyFlusher = ui.addQuitFlusher(() => flush())
  unsubscribeSummaryFlusher = ui.addQuitFlusher(() => flushSummary())
  unsubscribeNotesFlusher = ui.addQuitFlusher(() => flushChapterNotesQuit())
  // Reprise de lecture : avant de laisser la fenêtre se fermer, on mémorise
  // le chapitre courant et sa position de scroll (store.sauverReprise) pour
  // rouvrir pile où on s'était arrêté.
  unsubscribeRepriseFlusher = ui.addQuitFlusher(() => {
    const chapterId = store.currentChapter?.id
    if (chapterId != null) store.sauverReprise(chapterId, pageScrollEl.value?.scrollTop ?? 0)
    return Promise.resolve()
  })
})

// Le flush ici est fire-and-forget (onBeforeUnmount ne peut pas attendre une
// promesse) : historiquement une frappe juste avant démontage pouvait donc se
// perdre si la fermeture de l'app survenait au même instant. Ce n'est plus le
// cas depuis Task 7 — la fermeture passe désormais par la poignée de main
// IPC (onFlushRequest / flushDone), qui, elle, attend réellement les
// flushers enregistrés via ui.addQuitFlusher avant de laisser la fenêtre se
// fermer.
onBeforeUnmount(() => {
  flush()
  unsubscribeBodyFlusher?.()
})
// Hook séparé (pas fusionné au précédent) pour ne pas toucher au flush du
// corps ci-dessus : démontage du composant (fermeture du livre, navigation
// hors de BookView) déclenche aussi la sauvegarde d'un résumé en attente
// (fire-and-forget ici, comme flushSummary() partout ailleurs — une simple
// navigation n'a pas besoin d'attendre). Le cas qui comptait vraiment (quit
// de l'app dans les 600 ms suivant la dernière frappe) est désormais couvert
// par le flusher enregistré auprès du store ui (onMounted ci-dessus), que
// runQuitFlush() attend réellement avant de laisser la fenêtre se fermer.
onBeforeUnmount(() => {
  flushSummary()
  unsubscribeSummaryFlusher?.()
  unsubscribeNotesFlusher?.()
  unsubscribeRepriseFlusher?.()
})

// Insertion contrôlée du brouillon IA + restauration de snapshot (Task 7) :
// zone entièrement ADDITIVE — ne lit editorChapterId que pour vérifier que
// l'éditeur affiche bien le chapitre visé (garde de péremption, même principe
// que loadChapterNotes/refreshChapterEntities), ne l'écrit jamais et ne touche
// ni pendingChapterId ni watchGeneration. Les deux fonctions sont exposées au
// store ai (registerEditor) plutôt qu'à ClaudePanel/SnapshotList directement :
// EditorPane et ClaudePanel sont frères dans BookView, aucun ref direct
// possible sans faire transiter BookView (voir stores/ai.ts, commentaire
// EditorBridge).

// Construit un nœud paragraphe TipTap à partir d'un segment de texte brut :
// les retours à la ligne SIMPLES à l'intérieur d'un paragraphe (entre deux
// `\n\n`) deviennent des sauts de ligne durs (hardBreak), pas de nouveaux
// paragraphes — seul `\n\n` sépare les paragraphes (contrat de la tâche).
function buildParagraphNode(text: string): Record<string, unknown> {
  const lines = text.split('\n')
  const content: Record<string, unknown>[] = []
  lines.forEach((line, index) => {
    if (index > 0) content.push({ type: 'hardBreak' })
    if (line.length > 0) content.push({ type: 'text', text: line })
  })
  return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' }
}

// Insère le brouillon en fin de document : (1) snapshot du contenu ACTUEL
// (avant toute modification) via IPC, raison fixe 'avant insertion IA' — un
// échec ici (IPC indisponible) annule l'insertion plutôt que de modifier
// l'éditeur sans filet de restauration ; (2) découpage du brouillon en
// paragraphes réels sur `\n\n` (jamais du texte brut avec des `\n` — un seul
// nœud texte avec des retours à la ligne littéraux ne serait PAS des
// paragraphes pour TipTap/ProseMirror) puis insertion via
// focus('end') + insertContent ; l'onUpdate existant se déclenche normalement
// (docChanged) et programme le flush débouncé habituel — aucun appel manuel à
// flush() ici. Retourne false sans rien modifier si l'éditeur n'affiche plus
// le chapitre visé (panneau resté ouvert pendant une bascule de chapitre) ou
// si le brouillon est vide après nettoyage.
async function insertDraftIntoEditor(chapterId: number, draft: string): Promise<boolean> {
  const ed = editor.value
  // Garde initiale (panneau resté ouvert alors que le chapitre a déjà changé
  // avant même l'appel) + garde symétrique reprise après l'`await` plus bas
  // (voir son commentaire) : ensemble, elles rendent la navigation entre
  // chapitres — jamais désactivée pendant une insertion — sans risque.
  if (!ed || editorChapterId !== chapterId || store.currentChapter?.id !== chapterId) return false
  try {
    await window.encre.snapshots.create(
      chapterId,
      JSON.stringify(ed.getJSON()),
      'avant insertion IA'
    )
  } catch (err) {
    console.error('Échec du snapshot avant insertion IA', err)
    ui.toast('Impossible de créer un point de restauration — insertion annulée.')
    return false
  }
  // Re-vérifié après l'`await` ci-dessus : la liste des chapitres n'est pas
  // désactivée pendant ce snapshot, l'utilisateur a pu changer de chapitre
  // entre-temps (le watch de chargement a alors déjà remplacé le contenu de
  // l'éditeur) — sans cette garde, le brouillon du chapitre A serait inséré
  // (et autosauvegardé) dans le chapitre B désormais affiché, alors que le
  // snapshot protège A, pas B.
  if (editorChapterId !== chapterId || store.currentChapter?.id !== chapterId) {
    ui.toast('Chapitre changé — insertion annulée.')
    return false
  }
  const paragraphs = draft
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  if (paragraphs.length === 0) return false
  ed.chain().focus('end').insertContent(paragraphs.map(buildParagraphNode)).run()
  ui.toast('Brouillon inséré — snapshot créé.')
  return true
}

// Restaure un snapshot : (1) snapshot du contenu ACTUEL d'abord (raison
// 'avant restauration', même logique de filet que l'insertion — on ne perd
// jamais le texte qu'on écrase), (2) remplace le contenu de l'éditeur
// (`setContent`, `emitUpdate: false` — onUpdate ne doit pas se déclencher ici,
// la persistance suit une voie explicite, pas le cycle frappe/debounce), (3)
// sauvegarde immédiate via store.saveContentFor avec le JSON restauré ET le
// texte recalculé sur l'éditeur à jour — le chemin normal de sauvegarde,
// pas un contournement : mêmes effets qu'un flush() (wordCount recalculé,
// currentChapter.contentJson/contentText mis à jour, saveState géré), sans
// passer par pendingChapterId/le minuteur de 800 ms (aucune frappe en cours à
// regrouper ici). Guard chapterId identique à insertDraftIntoEditor.
async function restoreSnapshotIntoEditor(chapterId: number, contentJson: string): Promise<boolean> {
  const ed = editor.value
  if (!ed || editorChapterId !== chapterId || store.currentChapter?.id !== chapterId) return false
  try {
    await window.encre.snapshots.create(
      chapterId,
      JSON.stringify(ed.getJSON()),
      'avant restauration'
    )
  } catch (err) {
    console.error('Échec du snapshot avant restauration', err)
    ui.toast('Impossible de créer un point de restauration — restauration annulée.')
    return false
  }
  // Normalisation (Task 3, correctif review) : un snapshot peut avoir été pris
  // avant que horizontalRule ne soit retiré du schéma de l'éditeur — sans ce
  // passage par stripCodeBlocks(), setContent tomberait sur un type de nœud
  // inconnu et TipTap y répond par un document VIDE plutôt qu'une erreur
  // visible, laissant l'éditeur blanc sous un toast « Contenu restauré ». Le
  // JSON persisté ensuite doit être le NORMALISÉ, pas l'original : sinon le
  // contenu réellement affiché (et donc ed.getText()) diverge de ce qui est
  // enregistré en base, un chargement ultérieur du chapitre revalidant depuis
  // ce JSON obsolète reproduirait le même blanc.
  const { json: normalizedJson } = stripCodeBlocks(contentJson)
  let parsed: JSONContent
  try {
    parsed = JSON.parse(normalizedJson)
  } catch (err) {
    console.error('Contenu de snapshot illisible', err)
    ui.toast('Ce point de restauration est illisible.')
    return false
  }
  // Re-vérifié après les deux `await` ci-dessus : le panneau a pu rester
  // ouvert pendant que l'utilisateur changeait de chapitre entre-temps.
  if (editorChapterId !== chapterId || store.currentChapter?.id !== chapterId) return false
  ed.commands.setContent(parsed, { emitUpdate: false })
  await store.saveContentFor(chapterId, normalizedJson, ed.getText())
  ui.toast('Contenu restauré — snapshot créé.')
  return true
}

// Applique le résultat d'une harmonisation de mise en forme (Task 6) : mêmes
// mécanique et gardes que restoreSnapshotIntoEditor ci-dessus (snapshot du
// contenu ACTUEL d'abord, setContent avec emitUpdate: false, saveContentFor
// avec le JSON normalisé ET le texte recalculé sur l'éditeur à jour), avec
// deux différences volontaires : (1) raison de snapshot 'avant harmonisation'
// plutôt que 'avant restauration' — l'auteur doit pouvoir distinguer les deux
// dans le gestionnaire de snapshots ; (2) le JSON reçu vient de
// mdToTiptapJson (IPC ai.formatToJson, store.applyFormat) et non d'un
// snapshot existant, mais on le fait quand même passer par stripCodeBlocks
// ci-dessous — ceinture + bretelles, même défense qu'à la restauration,
// négligeable en coût et sans risque de double-normalisation (idempotent).
async function applyFormatIntoEditor(chapterId: number, contentJson: string): Promise<boolean> {
  const ed = editor.value
  if (!ed || editorChapterId !== chapterId || store.currentChapter?.id !== chapterId) return false
  try {
    await window.encre.snapshots.create(
      chapterId,
      JSON.stringify(ed.getJSON()),
      'avant harmonisation'
    )
  } catch (err) {
    console.error('Échec du snapshot avant harmonisation', err)
    ui.toast('Impossible de créer un point de restauration — application annulée.')
    return false
  }
  const { json: normalizedJson } = stripCodeBlocks(contentJson)
  let parsed: JSONContent
  try {
    parsed = JSON.parse(normalizedJson)
  } catch (err) {
    console.error('Résultat de mise en forme illisible', err)
    ui.toast('Résultat de mise en forme illisible — application annulée.')
    return false
  }
  // Re-vérifié après les deux `await` ci-dessus, même raison que restoreSnapshotIntoEditor.
  if (editorChapterId !== chapterId || store.currentChapter?.id !== chapterId) return false
  ed.commands.setContent(parsed, { emitUpdate: false })
  await store.saveContentFor(chapterId, normalizedJson, ed.getText())
  ui.toast('Mise en forme appliquée — snapshot créé.')
  return true
}

// Applique UNE suggestion de relecture (Task 3, plan 3c) : contrairement à
// applyFormatIntoEditor/restoreSnapshotIntoEditor ci-dessus, ne remplace PAS
// tout le document — localise la première occurrence exacte de `quote` (via
// locateQuote, shared/quoteLocator.ts — pur/testable, voir son fichier) et la
// remplace par une transaction ProseMirror ciblée. `not-found` (citation
// caduque : texte modifié depuis la génération de la suggestion) n'est
// jamais une erreur, juste un statut affiché par ReviewPanel — vérifié AVANT
// tout snapshot, pour ne jamais prendre de snapshot pour une suggestion qui
// ne sera finalement pas appliquée.
let reviewSnapshotTaken = false
// Réinitialisé à chaque NOUVEAU lot de suggestions (ai.reviewSuggestions
// change de référence à chaque parsing réussi dans le store, voir
// stores/ai.ts apply()) : un snapshot 'avant relecture' doit être repris
// avant la première application d'une relecture RELANCÉE, pas seulement de
// la toute première de la session app. Watcher posé une seule fois pour la
// durée de vie du composant, comme les autres écouteurs de ce fichier.
watch(
  () => ai.reviewSuggestions,
  () => {
    reviewSnapshotTaken = false
  }
)

async function applySuggestionIntoEditor(
  chapterId: number,
  quote: string,
  replacement: string
): Promise<'applied' | 'not-found' | 'stale'> {
  const ed = editor.value
  if (!ed || editorChapterId !== chapterId || store.currentChapter?.id !== chapterId) return 'stale'
  if (!locateQuote(ed.getJSON() as DocNode, quote).found) return 'not-found'
  if (!reviewSnapshotTaken) {
    try {
      await window.encre.snapshots.create(
        chapterId,
        JSON.stringify(ed.getJSON()),
        'avant relecture'
      )
      reviewSnapshotTaken = true
    } catch (err) {
      console.error('Échec du snapshot avant relecture', err)
      ui.toast('Impossible de créer un point de restauration — application annulée.')
      return 'stale'
    }
    // Re-vérifié après l'`await` ci-dessus, même garde que les autres ponts.
    if (editorChapterId !== chapterId || store.currentChapter?.id !== chapterId) return 'stale'
  }
  // Relocalisé sur le document ACTUEL plutôt que de réutiliser le résultat du
  // premier appel ci-dessus (avant le snapshot) : aucune autre source
  // n'écrit dans l'éditeur pendant ce court aller-retour IPC, mais recalculer
  // ici coûte peu et évite de dépendre de cette hypothèse.
  const result = locateQuote(ed.getJSON() as DocNode, quote)
  if (!result.found) return 'not-found'
  const tr = ed.state.tr
  if (replacement.length > 0) tr.insertText(replacement, result.from, result.to)
  else tr.delete(result.from, result.to)
  ed.view.dispatch(tr)
  await store.saveContentFor(chapterId, JSON.stringify(ed.getJSON()), ed.getText())
  ui.toast('Suggestion appliquée.')
  return 'applied'
}

onMounted(() => {
  ai.registerEditor({
    insertDraft: insertDraftIntoEditor,
    restoreSnapshot: restoreSnapshotIntoEditor,
    applyFormat: applyFormatIntoEditor,
    applySuggestion: applySuggestionIntoEditor
  })
})
onBeforeUnmount(() => ai.unregisterEditor())

// Snapshot manuel à la demande (Task 2) : bouton 📸 de l'en-tête → petit
// popover inline (libellé facultatif, défaut « manuel ») → snapshots.create
// avec le contenu ACTUEL de l'éditeur → toast. Entièrement séparé du chemin
// insertion/restauration ci-dessus (aucune garde de péremption chapterId
// nécessaire : la création se fait dans le même tick que la lecture de
// store.currentChapter/ed.getJSON(), pas après un await qui laisserait le
// temps de changer de chapitre).
const snapshotPromptOpen = ref(false)
const snapshotLabel = ref('manuel')
const snapshotLabelEl = ref<HTMLInputElement | null>(null)
const snapshotWrapEl = ref<HTMLElement | null>(null)
const takingSnapshot = ref(false)

function openSnapshotPrompt(): void {
  snapshotLabel.value = 'manuel'
  snapshotPromptOpen.value = true
}

function closeSnapshotPrompt(): void {
  snapshotPromptOpen.value = false
}

async function confirmSnapshot(): Promise<void> {
  const chapter = store.currentChapter
  const ed = editor.value
  if (!chapter || !ed || takingSnapshot.value) return
  const reason = snapshotLabel.value.trim() || 'manuel'
  takingSnapshot.value = true
  try {
    await window.encre.snapshots.create(chapter.id, JSON.stringify(ed.getJSON()), reason)
    ui.toast('Snapshot créé.')
    snapshotPromptOpen.value = false
  } catch (err) {
    console.error('Échec de la création du snapshot', err)
    ui.toast('Impossible de créer le snapshot.')
  } finally {
    takingSnapshot.value = false
  }
}

// Échap gérée ICI (comme les autres boîtes de ce fichier/de l'app), propagation
// stoppée dès ce nœud pour ne jamais atteindre le listener global de mode
// focus tant que le popover est ouvert. Entrée valide directement le libellé
// tapé, sans avoir à cliquer sur « Créer ».
function onSnapshotPromptKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeSnapshotPrompt()
  } else if (event.key === 'Enter') {
    event.preventDefault()
    event.stopPropagation()
    confirmSnapshot()
  }
}

// Fermeture au clic extérieur : popover léger anchoré au bouton, pas de
// backdrop plein écran comme AutolinkDialog — un simple listener sur window,
// posé/retiré à l'ouverture/fermeture plutôt que pour toute la durée de vie du
// composant (évite d'écouter chaque clic de l'app quand le popover est fermé,
// l'état de repos le plus fréquent).
function onWindowMousedownForSnapshot(event: MouseEvent): void {
  if (snapshotWrapEl.value?.contains(event.target as Node)) return
  closeSnapshotPrompt()
}

watch(snapshotPromptOpen, async (open) => {
  if (open) {
    window.addEventListener('mousedown', onWindowMousedownForSnapshot)
    await nextTick()
    snapshotLabelEl.value?.focus()
    snapshotLabelEl.value?.select()
  } else {
    window.removeEventListener('mousedown', onWindowMousedownForSnapshot)
  }
})

onBeforeUnmount(() => window.removeEventListener('mousedown', onWindowMousedownForSnapshot))

// Menu d'insertion « ¶+ » (Task 3) : même popover léger que le snapshot
// ci-dessus (anchoré au bouton, fermeture au clic extérieur/Échap), pour
// insérer un séparateur de scène ou un saut de page forcé au curseur. Les
// deux commandes viennent de formatNodes.ts (setSceneBreak/setPageBreak) ;
// aucune n'a besoin d'`await` ni de garde de péremption chapterId (opération
// synchrone sur l'éditeur déjà affiché, contrairement à insertDraftIntoEditor
// qui traverse un `await` IPC).
const formatMenuOpen = ref(false)
const formatWrapEl = ref<HTMLElement | null>(null)

function insertFormatNode(kind: 'sceneBreak' | 'pageBreak'): boolean {
  const ed = editor.value
  if (!ed) return false
  const chain = ed.chain().focus()
  return kind === 'sceneBreak' ? chain.setSceneBreak().run() : chain.setPageBreak().run()
}

function chooseFormatNode(kind: 'sceneBreak' | 'pageBreak'): void {
  insertFormatNode(kind)
  formatMenuOpen.value = false
}

function toggleFormatMenu(): void {
  formatMenuOpen.value = !formatMenuOpen.value
  // Même exclusion mutuelle que côté handleClickOn (voir son commentaire) :
  // le menu et le popover d'édition partagent le même ancrage, donc ouvrir
  // l'un doit fermer l'autre plutôt que de les empiler au même endroit.
  if (formatMenuOpen.value) layoutDraft.value = null
}

function onWindowMousedownForFormatMenu(event: MouseEvent): void {
  if (formatWrapEl.value?.contains(event.target as Node)) return
  formatMenuOpen.value = false
}

watch(formatMenuOpen, (open) => {
  if (open) window.addEventListener('mousedown', onWindowMousedownForFormatMenu)
  else window.removeEventListener('mousedown', onWindowMousedownForFormatMenu)
})

onBeforeUnmount(() => window.removeEventListener('mousedown', onWindowMousedownForFormatMenu))

// Popover d'insertion/édition des quatre nœuds de mise en page (Task 7) :
// layoutDraft (déclaré plus haut, avant useEditor) pilote un unique popover,
// modelé sur celui du snapshot ci-dessus (fermeture au clic extérieur/Échap).
// pos === null → insertion (une des quatre entrées ajoutées au menu ¶+ ci-
// dessous) ; pos = position d'un nœud existant → édition, posée par
// editorProps.handleClickOn plus haut au clic sur le nœud dans l'éditeur.
// Le popover reste ancré au bouton ¶+ (même formatWrapEl) dans les deux cas,
// plutôt qu'au point de clic dans le corps du texte — plus simple, cohérent
// avec les autres popovers de cet en-tête, et le nœud édité reste visible à
// l'écran (sélection posée dessus) pendant l'édition.
const chapterOpeningDraft = computed(() => {
  const d = layoutDraft.value?.draft
  return d?.kind === 'chapterOpening' ? d : null
})
const partOpeningDraft = computed(() => {
  const d = layoutDraft.value?.draft
  return d?.kind === 'partOpening' ? d : null
})
const tableOfContentsDraft = computed(() => {
  const d = layoutDraft.value?.draft
  return d?.kind === 'tableOfContents' ? d : null
})
const frontMatterDraft = computed(() => {
  const d = layoutDraft.value?.draft
  return d?.kind === 'frontMatterPage' ? d : null
})
const illustrationDraft = computed(() => {
  const d = layoutDraft.value?.draft
  return d?.kind === 'illustration' ? d : null
})

function openLayoutInsert(kind: LayoutDraft['kind']): void {
  formatMenuOpen.value = false
  if (kind === 'chapterOpening') {
    // Pré-remplissage : le rang vient de store.currentChapter.position, une
    // simple commodité de saisie — la base ne « sait » pas qu'un chapitre
    // « Liminaires » posé en tête décale d'une unité le rang réel du premier
    // vrai chapitre ; à l'auteur de corriger l'enseigne proposée si besoin.
    layoutDraft.value = {
      draft: {
        kind: 'chapterOpening',
        enseigne: `CHAPITRE ${store.currentChapter?.position ?? 0}`,
        titre: store.currentChapter?.title ?? '',
        sousTitre: '',
        recto: true
      },
      pos: null
    }
  } else if (kind === 'partOpening') {
    layoutDraft.value = { draft: { kind: 'partOpening', label: '', recto: true }, pos: null }
  } else if (kind === 'tableOfContents') {
    layoutDraft.value = { draft: { kind: 'tableOfContents', titre: 'SOMMAIRE' }, pos: null }
  } else {
    layoutDraft.value = { draft: { kind: 'frontMatterPage', genre: 'titre' }, pos: null }
  }
}

function closeLayoutDraft(): void {
  layoutDraft.value = null
}

function confirmLayoutDraft(): void {
  const state = layoutDraft.value
  const ed = editor.value
  if (!state || !ed) return
  const { draft, pos } = state
  if (pos === null) {
    const chain = ed.chain().focus()
    switch (draft.kind) {
      case 'chapterOpening':
        chain
          .insertChapterOpening({
            enseigne: draft.enseigne,
            titre: draft.titre,
            sousTitre: draft.sousTitre,
            recto: draft.recto
          })
          .run()
        break
      case 'partOpening':
        chain.insertPartOpening({ label: draft.label, recto: draft.recto }).run()
        break
      case 'tableOfContents':
        chain.insertTableOfContents({ titre: draft.titre }).run()
        break
      case 'frontMatterPage':
        chain.insertFrontMatterPage({ genre: draft.genre }).run()
        break
    }
  } else {
    const { kind, ...attrs } = draft
    ed.chain().focus().setNodeSelection(pos).updateAttributes(kind, attrs).run()
  }
  layoutDraft.value = null
}

// Échap ferme sans valider (même geste que onSnapshotPromptKeydown) ; pas de
// validation sur Entrée ici, contrairement au snapshot — ce popover porte
// plusieurs champs (case à cocher, select) où Entrée n'a pas la même
// évidence sémantique que sur un unique champ texte.
function onLayoutDraftKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    closeLayoutDraft()
  }
}

function onWindowMousedownForLayoutDraft(event: MouseEvent): void {
  if (formatWrapEl.value?.contains(event.target as Node)) return
  closeLayoutDraft()
}

const layoutPopoverEl = ref<HTMLElement | null>(null)

watch(
  () => layoutDraft.value,
  async (state) => {
    if (state) {
      window.addEventListener('mousedown', onWindowMousedownForLayoutDraft)
      // Même geste que snapshotLabelEl ci-dessus : focus le premier champ du
      // popover, quel que soit le kind affiché (pas de ref dédiée par champ).
      await nextTick()
      layoutPopoverEl.value?.querySelector<HTMLElement>('input, select')?.focus()
    } else {
      window.removeEventListener('mousedown', onWindowMousedownForLayoutDraft)
    }
  }
)

onBeforeUnmount(() => window.removeEventListener('mousedown', onWindowMousedownForLayoutDraft))

// Équivalent palette ⌘K (brief) : CommandPalette ne connaît pas l'éditeur
// (monté par App.vue, hors de l'arbre de BookView/EditorPane) — même
// situation que 'palette:focus-toggle' pour le mode focus (voir BookView),
// un CustomEvent sur window plutôt qu'un pont dédié comme EditorBridge
// (ai.ts), réservé à l'assistant Claude. EditorPane est le seul auditeur : si
// aucun chapitre n'est affiché, le composant n'est pas monté et l'événement
// est un no-op silencieux.
function onPaletteInsertFormatNode(event: Event): void {
  const kind = (event as CustomEvent<'sceneBreak' | 'pageBreak'>).detail
  insertFormatNode(kind)
}
onMounted(() => window.addEventListener('palette:insert-format-node', onPaletteInsertFormatNode))
onBeforeUnmount(() =>
  window.removeEventListener('palette:insert-format-node', onPaletteInsertFormatNode)
)

function rename(event: Event): void {
  const title = (event.target as HTMLInputElement).value.trim()
  if (title && store.currentChapter) store.renameChapter(store.currentChapter.id, title)
}

// Panneau Illustrations (Task 7) : ref locale (contrairement à
// ai.snapshotManagerOpen, ce panneau n'a qu'un seul point d'ouverture — le
// bouton ci-dessous — pas besoin d'un état partagé côté store). L'insertion
// est une opération synchrone sur l'éditeur déjà affiché, même famille
// qu'insertFormatNode ci-dessus : pas d'await IPC entre le clic sur
// « Insérer » et l'appel à la commande, donc aucune garde de péremption
// chapterId nécessaire.
const illustrationsPanelOpen = ref(false)

function insertIllustrationFromPanel(ill: IllustrationRecord): void {
  editor.value
    ?.chain()
    .focus()
    .insertIllustration({ fileName: ill.fileName, displayName: ill.displayName })
    .run()
}

const STATUSES: { value: ChapterStatus; label: string }[] = (
  Object.keys(CHAPTER_STATUS_LABELS) as ChapterStatus[]
).map((value) => ({ value, label: CHAPTER_STATUS_LABELS[value] }))
</script>

<template>
  <div
    v-if="store.currentChapter"
    class="editor-pane"
    :style="{
      '--editor-font-size': settings.editorFontSize + 'px',
      '--editor-line-height': String(settings.editorLineHeight),
      '--editor-col-width': settings.editorColWidth + 'rem'
    }"
  >
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
        title="Lier les entités — convertit les noms de fiches écrits sans @ en mentions liées"
        aria-label="Lier les entités"
        @click="openAutolink"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M9 17H7a5 5 0 0 1 0-10h2" />
          <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
          <line x1="8" y1="12" x2="16" y2="12" />
        </svg>
      </button>
      <button
        type="button"
        class="claude-btn"
        :class="{ active: ai.open }"
        title="Assistant Claude (⌘⇧K)"
        aria-label="Assistant Claude"
        :aria-pressed="ai.open"
        @click="ai.toggle()"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" />
          <line x1="16" y1="8" x2="2" y2="22" />
          <line x1="17.5" y1="15" x2="9" y2="15" />
        </svg>
      </button>
      <button
        type="button"
        class="illustrations-btn"
        title="Illustrations du livre"
        aria-label="Illustrations du livre"
        :aria-expanded="illustrationsPanelOpen"
        @click="illustrationsPanelOpen = !illustrationsPanelOpen"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="m21 15-5-5L5 21" />
        </svg>
      </button>
      <button
        type="button"
        class="search-btn"
        title="Rechercher dans le livre (⌘F)"
        aria-label="Rechercher dans le livre"
        @click="openSearch"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="7" />
          <line x1="21" y1="21" x2="16.5" y2="16.5" />
        </svg>
      </button>
      <div ref="confortWrapEl" class="confort-wrap">
        <button
          type="button"
          class="confort-btn"
          :class="{ active: confortOpen }"
          title="Confort d'écriture — taille, interligne, largeur"
          aria-label="Confort d'écriture"
          :aria-expanded="confortOpen"
          @click="toggleConfort"
        >
          Aa
        </button>
        <div
          v-if="confortOpen"
          class="confort-popover"
          role="dialog"
          aria-label="Confort d'écriture"
        >
          <p class="field-label">Confort d'écriture</p>
          <label class="field">
            <span class="range-row">
              <span class="field-label">Taille</span>
              <output>{{ settings.editorFontSize }} px</output>
            </span>
            <input
              v-model.number="settings.editorFontSize"
              type="range"
              :min="FONT_SIZE_RANGE.min"
              :max="FONT_SIZE_RANGE.max"
              :step="FONT_SIZE_RANGE.step"
              @input="settings.setFontSize(settings.editorFontSize)"
            />
          </label>
          <label class="field">
            <span class="range-row">
              <span class="field-label">Interligne</span>
              <output>{{ settings.editorLineHeight.toFixed(2) }}</output>
            </span>
            <input
              v-model.number="settings.editorLineHeight"
              type="range"
              :min="LINE_HEIGHT_RANGE.min"
              :max="LINE_HEIGHT_RANGE.max"
              :step="LINE_HEIGHT_RANGE.step"
              @input="settings.setLineHeight(settings.editorLineHeight)"
            />
          </label>
          <label class="field">
            <span class="range-row">
              <span class="field-label">Largeur</span>
              <output>{{ settings.editorColWidth }} rem</output>
            </span>
            <input
              v-model.number="settings.editorColWidth"
              type="range"
              :min="COL_WIDTH_RANGE.min"
              :max="COL_WIDTH_RANGE.max"
              :step="COL_WIDTH_RANGE.step"
              @input="settings.setColWidth(settings.editorColWidth)"
            />
          </label>
          <button type="button" class="reset" @click="settings.reset()">Rétablir</button>
        </div>
      </div>
      <div ref="formatWrapEl" class="format-wrap">
        <button
          type="button"
          class="format-btn"
          title="Insérer un élément"
          aria-label="Insérer un élément"
          :aria-expanded="formatMenuOpen"
          @click="toggleFormatMenu"
        >
          ¶+
        </button>
        <div
          v-if="formatMenuOpen"
          class="format-menu"
          role="menu"
          aria-label="Insérer un élément"
          @keydown.escape.stop.prevent="formatMenuOpen = false"
        >
          <button type="button" role="menuitem" @click="chooseFormatNode('sceneBreak')">
            Séparateur de scène ⁂
          </button>
          <button type="button" role="menuitem" @click="chooseFormatNode('pageBreak')">
            Saut de page forcé
          </button>
          <div class="format-menu-sep"></div>
          <button type="button" role="menuitem" @click="openLayoutInsert('chapterOpening')">
            Ouverture de chapitre
          </button>
          <button type="button" role="menuitem" @click="openLayoutInsert('partOpening')">
            Page de partie
          </button>
          <button type="button" role="menuitem" @click="openLayoutInsert('tableOfContents')">
            Sommaire
          </button>
          <button type="button" role="menuitem" @click="openLayoutInsert('frontMatterPage')">
            Page liminaire
          </button>
        </div>
        <div
          v-if="layoutDraft"
          ref="layoutPopoverEl"
          class="layout-popover"
          role="dialog"
          aria-label="Nœud de mise en page"
          @keydown="onLayoutDraftKeydown"
        >
          <template v-if="chapterOpeningDraft">
            <label class="field">
              <span class="field-label">Enseigne</span>
              <input v-model="chapterOpeningDraft.enseigne" type="text" spellcheck="false" />
            </label>
            <label class="field">
              <span class="field-label">Titre du chapitre</span>
              <input v-model="chapterOpeningDraft.titre" type="text" spellcheck="false" />
            </label>
            <label class="field">
              <span class="field-label">Sous-titre</span>
              <input v-model="chapterOpeningDraft.sousTitre" type="text" spellcheck="false" />
            </label>
            <label class="layout-checkbox">
              <input v-model="chapterOpeningDraft.recto" type="checkbox" />
              Commencer en page de droite
            </label>
          </template>
          <template v-else-if="partOpeningDraft">
            <label class="field">
              <span class="field-label">Nom de la partie</span>
              <input v-model="partOpeningDraft.label" type="text" spellcheck="false" />
            </label>
            <label class="layout-checkbox">
              <input v-model="partOpeningDraft.recto" type="checkbox" />
              Commencer en page de droite
            </label>
          </template>
          <template v-else-if="tableOfContentsDraft">
            <label class="field">
              <span class="field-label">Titre du sommaire</span>
              <input v-model="tableOfContentsDraft.titre" type="text" spellcheck="false" />
            </label>
          </template>
          <template v-else-if="frontMatterDraft">
            <label class="field">
              <span class="field-label">Genre</span>
              <select v-model="frontMatterDraft.genre">
                <option value="titre">Page de titre</option>
                <option value="colophon">Colophon</option>
                <option value="dedicace">Dédicace</option>
              </select>
            </label>
          </template>
          <template v-else-if="illustrationDraft">
            <label class="field">
              <span class="field-label">Taille</span>
              <select v-model="illustrationDraft.taille">
                <option value="pleine">Pleine page</option>
                <option value="vignette">Vignette (30 mm)</option>
              </select>
            </label>
          </template>
          <div class="layout-popover-actions">
            <button type="button" @click="closeLayoutDraft">Annuler</button>
            <button type="button" class="primary" @click="confirmLayoutDraft">Valider</button>
          </div>
        </div>
      </div>
      <div ref="snapshotWrapEl" class="snapshot-wrap">
        <button
          type="button"
          class="snapshot-btn"
          title="Prendre un snapshot du chapitre"
          aria-label="Prendre un snapshot du chapitre"
          @click="openSnapshotPrompt"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path
              d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"
            />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </button>
        <div
          v-if="snapshotPromptOpen"
          class="snapshot-popover"
          role="dialog"
          aria-label="Prendre un snapshot"
          @keydown="onSnapshotPromptKeydown"
        >
          <span class="field-label">Libellé du snapshot</span>
          <input
            ref="snapshotLabelEl"
            v-model="snapshotLabel"
            type="text"
            class="snapshot-label-input"
            spellcheck="false"
          />
          <div class="snapshot-popover-actions">
            <button type="button" @click="closeSnapshotPrompt">Annuler</button>
            <button
              type="button"
              class="primary"
              :disabled="takingSnapshot"
              @click="confirmSnapshot"
            >
              {{ takingSnapshot ? 'Création…' : 'Créer' }}
            </button>
          </div>
        </div>
      </div>
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
                  aria-label="Monter cette note"
                  @click="moveChapterNote(index, -1)"
                >
                  ↑
                </button>
                <button
                  :disabled="index === chapterNotes.length - 1"
                  type="button"
                  title="Descendre"
                  aria-label="Descendre cette note"
                  @click="moveChapterNote(index, 1)"
                >
                  ↓
                </button>
                <button
                  type="button"
                  title="Supprimer"
                  aria-label="Supprimer cette note"
                  @click="removeChapterNote(note)"
                >
                  ×
                </button>
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
    <div ref="pageScrollEl" class="page">
      <EditorContent :editor="editor" />
    </div>
    <AutolinkDialog
      v-if="autolinkOpen"
      :matches="autolinkMatches"
      @close="autolinkOpen = false"
      @apply="applyAutolink"
    />
    <SnapshotManager v-if="ai.snapshotManagerOpen" />
    <IllustrationsPanel
      v-if="illustrationsPanelOpen && store.book"
      :book-id="store.book.id"
      @close="illustrationsPanelOpen = false"
      @insert="insertIllustrationFromPanel"
    />
    <ConfirmDialog
      v-if="pendingNoteRemoval"
      message="Supprimer cette note ?"
      @confirm="confirmNoteRemoval"
      @cancel="cancelNoteRemoval"
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
  max-width: var(--editor-col-width, 40rem);
  width: 100%;
  margin: 0 auto;
  flex-shrink: 0;
}

.chapter-title {
  flex: 1;
  min-width: 0;
  /* Redesign en-tête (retour utilisateur : titre tronqué à quelques lettres) :
     le titre garde la priorité flex sur toute la rangée — désormais peu
     disputée, les deux boutons texte voisins étant devenus des icônes
     compactes ci-dessous. overflow/text-overflow ne changent rien tant que le
     titre tient dans l'espace disponible ; ils n'entrent en jeu que pour un
     titre VRAIMENT long (ellipse plutôt qu'un défilement interne à l'input,
     qui masquerait le DÉBUT du titre une fois le focus perdu ailleurs qu'au
     début du champ). */
  overflow: hidden;
  text-overflow: ellipsis;
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

/* Redesign en-tête (Task 6, retour utilisateur) : « Lier les entités » et
   « Assistant Claude » étaient des boutons pleine largeur avec libellé texte —
   à eux deux, ils réduisaient l'espace disponible pour le titre au point de le
   tronquer à quelques lettres dans une fenêtre de largeur normale. Convertis
   en icônes compactes 30×30, même gabarit que .format-btn/.snapshot-btn
   ci-dessous (déjà ce langage visuel) plutôt qu'un menu « ⋯ » qui masquerait
   ces deux actions derrière un clic supplémentaire : elles restent d'usage
   courant (Assistant Claude a même un raccourci clavier dédié) et un menu de
   dépôt n'aurait récupéré qu'une icône de large pour une perte de
   découvrabilité — le tooltip (title) porte désormais tout le texte
   explicatif. */
.autolink-btn,
.claude-btn,
.illustrations-btn,
.search-btn,
.confort-btn {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  padding: 0;
  display: grid;
  place-items: center;
  font-size: 14px;
  line-height: 1;
  color: var(--fg-muted);
}
.autolink-btn:hover,
.claude-btn:hover,
.illustrations-btn:hover,
.search-btn:hover,
.confort-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
}
.claude-btn.active,
.confort-btn.active {
  color: var(--accent);
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.confort-wrap {
  position: relative;
  flex-shrink: 0;
}
.confort-btn {
  font-size: 12.5px;
  font-weight: 700;
  font-family: var(--font-manuscript);
}
.confort-popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 40;
  width: 240px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 16px 36px -14px color-mix(in srgb, var(--fg) 40%, transparent);
}
.confort-popover .field > span.range-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
.confort-popover output {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--fg-muted);
}
.confort-popover input[type='range'] {
  width: 100%;
  accent-color: var(--accent);
  padding: 0;
  border: none;
  background: none;
}
.confort-popover .reset {
  align-self: flex-end;
  font-size: 11.5px;
  padding: 4px 10px;
  color: var(--fg-muted);
}
.confort-popover .reset:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.format-wrap {
  position: relative;
  flex-shrink: 0;
}
.format-btn {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  padding: 0;
  display: grid;
  place-items: center;
  font-size: 12.5px;
  font-weight: 600;
  line-height: 1;
  color: var(--fg-muted);
}
.format-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.format-menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 40;
  width: 210px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 16px 36px -14px color-mix(in srgb, var(--fg) 40%, transparent);
}
.format-menu button {
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 13px;
  color: var(--fg);
  background: none;
}
.format-menu button:hover {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}
.format-menu-sep {
  border-top: 1px solid var(--border);
  margin: 0.35em 0;
}

.layout-popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 40;
  width: 260px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 16px 36px -14px color-mix(in srgb, var(--fg) 40%, transparent);
}
.layout-popover input[type='text'],
.layout-popover select {
  width: 100%;
  border: 1px solid var(--border);
  background: var(--bg);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 13px;
}
.layout-popover input[type='text']:focus,
.layout-popover select:focus {
  outline: none;
  border-color: var(--accent);
}
.layout-checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--fg);
}
/* Pied d'actions commun aux popovers légers (snapshot ci-dessous et
   édition/insertion de mise en page ci-dessus) : même sélecteur groupé plutôt
   que deux copies identiques (voir 711df64, qui avait retiré ce genre de
   duplication locale). */
.layout-popover-actions,
.snapshot-popover-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
.layout-popover-actions button,
.snapshot-popover-actions button {
  font-size: 11.5px;
  padding: 5px 10px;
}

.snapshot-wrap {
  position: relative;
  flex-shrink: 0;
}
.snapshot-btn {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  padding: 0;
  display: grid;
  place-items: center;
  font-size: 14px;
  line-height: 1;
  color: var(--fg-muted);
}
.snapshot-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
}

.snapshot-popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 40;
  width: 220px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 16px 36px -14px color-mix(in srgb, var(--fg) 40%, transparent);
}
.snapshot-label-input {
  width: 100%;
  border: 1px solid var(--border);
  background: var(--bg);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 13px;
}
.snapshot-label-input:focus {
  border-color: var(--accent);
}

.summary-zone {
  max-width: var(--editor-col-width, 40rem);
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
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
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
  /* Filet de sécurité au niveau du CONTENEUR, pas seulement des textareas
     qu'il porte : .summary-zone est un frère de .page (flex-shrink: 0), pas
     un descendant de la zone qui défile (contrairement à ce qu'on pourrait
     supposer en lisant le template) — et main (BookView) a overflow: hidden.
     Sans ce plafond, un résumé + de nombreuses notes, chacun capé à 40vh,
     peuvent quand même s'additionner à une hauteur totale qui dépasse
     l'espace disponible, et l'excédent serait alors purement rogné par main,
     invisible et inaccessible, sans aucune scrollbar. */
  max-height: 50vh;
  overflow-y: auto;
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

/* Résumé et notes : texte de travail, pas manuscrit — hérite de --font-ui
   (posé sur <body>, theme.css) plutôt que --font-manuscript, comme les
   champs description/notes des fiches personnages/lieux (EntityCard).
   Bordure + fond explicites (--bg sur le panneau --bg-panel) : visible avant
   la frappe, pas seulement au focus (retour utilisateur). */
.summary-text {
  width: 100%;
  resize: vertical;
  max-height: 40vh;
  overflow-y: auto;
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
  /* Plafonné (Task 4b) : au-delà de 40vh, la textarea défile en interne au
     lieu de continuer à grandir (voir autoGrowClamped dans utils/autoGrow.ts,
     qui clampe la hauteur JS à ce même seuil) — overflow-y: auto (pas hidden)
     est nécessaire pour que ce défilement soit possible une fois le plafond
     atteint. */
  max-height: 40vh;
  overflow-y: auto;
  /* Filet de sécurité (Task 15 bis) : si autoGrowNote se déclenche jamais
     (scrollHeight mesuré sur un élément pas encore connecté au DOM, cas
     historique du bug « notes illisibles ») ou renvoie 0, min-height garantit
     quand même ~2 lignes lisibles plutôt qu'une bande de quelques pixels. */
  min-height: 54px;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--fg) 4%, var(--bg));
  border-radius: var(--radius-s);
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

.chapter-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-width: var(--editor-col-width, 40rem);
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
  max-width: var(--editor-col-width, 40rem);
  margin: 0 auto;
  padding: 12px 0 45vh;
  font-family: var(--font-manuscript);
  /* Confort d'écriture : piloté par le popover Aa (store settings), posées
     via :style sur .editor-pane — valeurs historiques en fallback. */
  font-size: var(--editor-font-size, 18px);
  line-height: var(--editor-line-height, 1.75);
  color: var(--fg);
  caret-color: var(--accent);
  outline: none;
  /* Confort typographique du manuscrit (audit UI/UX, proposition #12) :
     `lang="fr"` sur <html> (index.html) donne au moteur de césure le bon
     dictionnaire — sans lui, `hyphens: auto` resterait un no-op silencieux.
     `common-ligatures` profite à Iowan Old Style (fi/fl notamment). */
  hyphens: auto;
  font-variant-ligatures: common-ligatures;
}
.page :deep(.tiptap p) {
  margin-bottom: 0.9em;
  /* text-wrap: pretty (Chromium ≥ 117) : élimine les mots orphelins en fin de
     paragraphe — pas de repli nécessaire, ignoré silencieusement sinon. */
  text-wrap: pretty;
}
.page :deep(.tiptap strong) {
  font-weight: 700;
}
.page :deep(.tiptap em) {
  font-style: italic;
}
</style>
