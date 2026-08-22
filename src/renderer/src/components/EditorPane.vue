<script setup lang="ts">
import { watch, onMounted, onBeforeUnmount, ref } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { useBookStore } from '../stores/book'
import { useUiStore } from '../stores/ui'
import { useEntitiesStore } from '../stores/entities'
import { EntityMention } from '../editor/mention'
import AutolinkDialog, { type AutolinkMatch } from './AutolinkDialog.vue'
import { findNameMatches, type AutolinkTarget } from '../../../shared/autolink'
import { CHAPTER_STATUS_LABELS } from '../../../shared/labels'
import type { ChapterStatus, Entity } from '../../../shared/types'

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
  extensions: [StarterKit, EntityMention],
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
    ed.commands.setContent(JSON.parse(store.currentChapter.contentJson), { emitUpdate: false })
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
  for (const m of [...selected].sort((a, b) => b.from - a.from)) {
    const entity = entitiesStore.entities.find((e) => e.id === m.entityId)
    tr.replaceWith(
      m.from,
      m.to,
      mentionType.create({ id: m.entityId, label: entity?.name ?? m.matched, kind: m.kind })
    )
  }
  // Dispatch direct (pas de editor.commands) : passe par le même
  // dispatchTransaction interne de TipTap que n'importe quelle commande, qui
  // émet 'update' dès que docChanged — onUpdate ci-dessus se déclenche donc
  // normalement et programme le flush débouncé (800 ms), sans appel manuel.
  ed.view.dispatch(tr)
}

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
      <button type="button" class="autolink-btn" @click="openAutolink">Lier les entités</button>
    </header>
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
  padding: 28px 0 10px;
  max-width: 42rem;
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

.chapter-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-width: 42rem;
  width: 100%;
  margin: 0 auto;
  padding: 0 0 12px;
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
}
.page :deep(.tiptap) {
  max-width: 42rem;
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
