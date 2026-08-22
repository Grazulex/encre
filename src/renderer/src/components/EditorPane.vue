<script setup lang="ts">
import { watch, onBeforeUnmount } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { useBookStore } from '../stores/book'
import type { ChapterStatus } from '../../../shared/types'

const store = useBookStore()

let saveTimer: ReturnType<typeof setTimeout> | null = null
let pendingChapterId: number | null = null

const editor = useEditor({
  extensions: [StarterKit],
  content: '',
  onUpdate: () => {
    if (!store.currentChapter) return
    pendingChapterId = store.currentChapter.id
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(flush, 800)
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
    ed.commands.setContent(JSON.parse(store.currentChapter.contentJson), { emitUpdate: false })
    ed.commands.focus('start')
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  flush()
})

function rename(event: Event): void {
  const title = (event.target as HTMLInputElement).value.trim()
  if (title && store.currentChapter) store.renameChapter(store.currentChapter.id, title)
}

const STATUSES: { value: ChapterStatus; label: string }[] = [
  { value: 'brouillon', label: 'Brouillon' },
  { value: 'premier_jet', label: 'Premier jet' },
  { value: 'relu', label: 'Relu' },
  { value: 'final', label: 'Final' }
]
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
    </header>
    <EditorContent :editor="editor" class="page" />
  </div>
</template>

<style scoped>
.editor-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
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
  background-image: linear-gradient(
      45deg,
      transparent 50%,
      var(--fg-muted) 50%
    ),
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

.page {
  flex: 1;
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
