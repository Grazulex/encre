<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useLibraryStore } from '../stores/library'
import { useBookStore } from '../stores/book'
import { SECTION_LABELS } from '../../../shared/labels'
import type { BookSection } from '../../../shared/types'

const emit = defineEmits<{ close: [] }>()

const router = useRouter()
const library = useLibraryStore()
const book = useBookStore()

const query = ref('')
const selectedIndex = ref(0)
const inputEl = ref<HTMLInputElement | null>(null)

onMounted(async () => {
  await nextTick()
  inputEl.value?.focus()
  if (!library.loaded) library.load()
})

function normalize(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

function matches(label: string): boolean {
  const q = normalize(query.value.trim())
  if (!q) return true
  return normalize(label).includes(q)
}

function close(): void {
  emit('close')
}

interface CommandItem {
  id: string
  group: 'Livres' | 'Sections' | 'Chapitres' | 'Actions'
  label: string
  action: () => void
}

const SECTIONS: BookSection[] = ['chapitres', 'personnages', 'lieux', 'chronologie', 'plan']

const bookItems = computed<CommandItem[]>(() =>
  library.books.map((b) => ({
    id: `book-${b.id}`,
    group: 'Livres',
    label: b.title,
    action: () => {
      router.push(`/book/${b.id}`)
      close()
    }
  }))
)

// Sections/Chapitres du livre ouvert : seulement pertinents quand un livre
// est chargé (LibraryView n'a pas de book.book, ces groupes restent vides).
const sectionItems = computed<CommandItem[]>(() =>
  book.book
    ? SECTIONS.map((key) => ({
        id: `section-${key}`,
        group: 'Sections',
        label: SECTION_LABELS[key],
        action: () => {
          book.setSection(key)
          close()
        }
      }))
    : []
)

const chapterItems = computed<CommandItem[]>(() =>
  book.book
    ? book.chapters.map((c) => ({
        id: `chapter-${c.id}`,
        group: 'Chapitres',
        label: c.title,
        action: () => {
          book.openChapter(c.id)
          book.setSection('chapitres')
          close()
        }
      }))
    : []
)

const actionItems = computed<CommandItem[]>(() => {
  const items: CommandItem[] = []
  if (book.book) {
    items.push({
      id: 'action-new-chapter',
      group: 'Actions',
      label: 'Nouveau chapitre',
      action: () => {
        book.createChapter(`Chapitre ${book.chapters.length + 1}`)
        close()
      }
    })
    // Le toggle est envoyé inconditionnellement ; c'est BookView (l'unique
    // auditeur de cet événement) qui garde la même garde de section que son
    // raccourci ⌘⇧F ("n'a de sens qu'en section chapitres").
    items.push({
      id: 'action-focus',
      group: 'Actions',
      label: 'Basculer le mode focus',
      action: () => {
        window.dispatchEvent(new CustomEvent('palette:focus-toggle'))
        close()
      }
    })
  }
  items.push({
    id: 'action-library',
    group: 'Actions',
    label: 'Retour à la bibliothèque',
    action: () => {
      router.push('/')
      close()
    }
  })
  return items
})

// Ordre imposé par le brief : Livres / Sections / Chapitres / Actions.
const flatItems = computed<CommandItem[]>(() =>
  [...bookItems.value, ...sectionItems.value, ...chapterItems.value, ...actionItems.value].filter(
    (item) => matches(item.label)
  )
)

interface Row {
  type: 'header' | 'item'
  key: string
  label?: string
  item?: CommandItem
  index?: number
}

// Rendu à plat (un seul v-for) : un en-tête est inséré chaque fois que le
// groupe change, en suivant l'ordre déjà garanti par flatItems.
const rows = computed<Row[]>(() => {
  const result: Row[] = []
  let lastGroup: string | null = null
  flatItems.value.forEach((item, index) => {
    if (item.group !== lastGroup) {
      result.push({ type: 'header', key: `h-${item.group}`, label: item.group })
      lastGroup = item.group
    }
    result.push({ type: 'item', key: item.id, item, index })
  })
  return result
})

watch(flatItems, (items) => {
  if (selectedIndex.value >= items.length) selectedIndex.value = Math.max(items.length - 1, 0)
})

function moveSelection(delta: number): void {
  if (flatItems.value.length === 0) return
  const next = selectedIndex.value + delta
  selectedIndex.value = Math.min(Math.max(next, 0), flatItems.value.length - 1)
  nextTick(() => {
    document
      .querySelector(`[data-row-index="${selectedIndex.value}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  })
}

function activateSelected(): void {
  flatItems.value[selectedIndex.value]?.action()
}

// Échap est géré ICI, par le keydown local de l'input — jamais via
// useShortcuts. useShortcuts pose son listener sur window en phase bulle ;
// BookView y branche déjà une combinaison 'escape' pour son mode focus. En
// arrêtant la propagation dès l'input (qui est la cible de l'événement),
// on empêche Échap de jamais atteindre ce listener global tant que la
// palette est ouverte, sans dépendre de l'ordre d'enregistrement des
// listeners ni d'une phase de capture.
function onKeydown(event: KeyboardEvent): void {
  switch (event.key) {
    case 'Escape':
      event.preventDefault()
      event.stopPropagation()
      close()
      break
    case 'ArrowDown':
      event.preventDefault()
      event.stopPropagation()
      moveSelection(1)
      break
    case 'ArrowUp':
      event.preventDefault()
      event.stopPropagation()
      moveSelection(-1)
      break
    case 'Enter':
      event.preventDefault()
      event.stopPropagation()
      activateSelected()
      break
  }
}
</script>

<template>
  <div class="palette-overlay" @click.self="close">
    <div class="palette-card" role="dialog" aria-modal="true" aria-label="Palette de commandes">
      <div class="input-row">
        <input
          ref="inputEl"
          v-model="query"
          type="text"
          placeholder="Rechercher un livre, une section, un chapitre, une action…"
          autocomplete="off"
          spellcheck="false"
          @keydown="onKeydown"
        />
        <span class="kbd">Échap</span>
      </div>
      <div class="results" role="listbox">
        <template v-if="rows.length > 0">
          <template v-for="row in rows" :key="row.key">
            <div v-if="row.type === 'header'" class="group-label">{{ row.label }}</div>
            <button
              v-else
              type="button"
              class="item"
              :class="{ selected: row.index === selectedIndex }"
              role="option"
              :aria-selected="row.index === selectedIndex"
              :data-row-index="row.index"
              @click="row.item?.action()"
              @mouseenter="selectedIndex = row.index ?? selectedIndex"
            >
              {{ row.item?.label }}
            </button>
          </template>
        </template>
        <p v-else class="empty">Aucun résultat.</p>
      </div>
      <div class="footer-hints">
        <span><span class="kbd">↑</span><span class="kbd">↓</span> naviguer</span>
        <span><span class="kbd">Entrée</span> choisir</span>
        <span><span class="kbd">Échap</span> fermer</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.palette-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: color-mix(in srgb, var(--fg) 25%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.palette-card {
  width: 520px;
  max-width: 100%;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 24px 60px -20px color-mix(in srgb, var(--fg) 45%, transparent);
  overflow: hidden;
}

.input-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.input-row input {
  flex: 1;
  border: none;
  border-radius: 0;
  background: transparent;
  padding: 2px 0;
  font-size: 15px;
}
.input-row input:focus {
  outline: none;
  border-color: transparent;
}

.results {
  overflow-y: auto;
  padding: 6px;
  flex: 1;
  min-height: 0;
}

.group-label {
  padding: 10px 10px 4px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--fg-muted);
}

.item {
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  border-left: 2px solid transparent;
  border-radius: 7px;
  padding: 8px 10px;
  font-size: 13px;
  color: var(--fg);
  background: none;
  cursor: pointer;
  transition:
    background-color 0.12s ease,
    border-color 0.12s ease;
}
.item:hover {
  background: color-mix(in srgb, var(--fg) 5%, transparent);
}
.item.selected {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border-left-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}

.empty {
  padding: 24px 12px;
  text-align: center;
  color: var(--fg-muted);
  font-size: 13px;
}

.footer-hints {
  display: flex;
  gap: 16px;
  padding: 8px 14px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
  font-size: 11px;
  color: var(--fg-muted);
}

.kbd {
  display: inline-block;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 5px;
  margin-right: 2px;
  font-size: 10.5px;
  color: var(--fg-muted);
  background: var(--bg);
}
</style>
