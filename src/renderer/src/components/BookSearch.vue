<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useBookStore } from '../stores/book'
import type { SearchHit } from '../../../shared/types'

const emit = defineEmits<{ close: [] }>()
const store = useBookStore()

const bookId = computed(() => store.book?.id ?? null)

const query = ref('')
const hits = ref<SearchHit[]>([])
const searching = ref(false)
const searched = ref(false)
const inputEl = ref<HTMLInputElement | null>(null)

onMounted(async () => {
  await nextTick()
  inputEl.value?.focus()
})

let timer: ReturnType<typeof setTimeout> | null = null

watch(query, (value) => {
  if (timer) clearTimeout(timer)
  const needle = value.trim()
  if (!needle || bookId.value == null) {
    hits.value = []
    searched.value = false
    return
  }
  searching.value = true
  timer = setTimeout(async () => {
    try {
      hits.value = await window.encre.chapters.search(bookId.value!, needle)
    } catch (err) {
      console.error('Échec de la recherche', err)
      hits.value = []
    } finally {
      searching.value = false
      searched.value = true
    }
  }, 250)
})

async function select(hit: SearchHit): Promise<void> {
  emit('close')
  await store.openChapter(hit.chapterId)
  store.setSection('chapitres')
}

async function onKeydown(event: KeyboardEvent): Promise<void> {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    emit('close')
  } else if (event.key === 'Enter') {
    const hit = hits.value[0]
    if (hit) {
      event.preventDefault()
      event.stopPropagation()
      await select(hit)
    }
  }
}

function close(): void {
  emit('close')
}
</script>

<template>
  <Transition name="dialog" appear>
    <div class="overlay" @click.self="close">
      <div
        class="search-card dialog-card"
        role="dialog"
        aria-modal="true"
        aria-label="Rechercher dans le livre"
      >
        <div class="input-row">
          <input
            ref="inputEl"
            v-model="query"
            type="text"
            placeholder="Chercher un mot ou une phrase dans le livre…"
            autocomplete="off"
            spellcheck="false"
            @keydown="onKeydown"
          />
          <span class="kbd">Échap</span>
        </div>
        <div class="results" role="listbox">
          <template v-if="searched && !searching && hits.length > 0">
            <button
              v-for="hit in hits"
              :key="hit.chapterId"
              type="button"
              role="option"
              class="item"
              :aria-label="`Ouvrir « ${hit.chapterTitle} »`"
              @click="select(hit)"
            >
              <span class="heading">
                <span class="chapter-title">{{ hit.chapterTitle }}</span>
                <span class="pos">Ch. {{ hit.chapterPosition }}</span>
              </span>
              <span class="snippet">
                {{ hit.snippet.before }}<mark>{{ hit.snippet.match }}</mark
                >{{ hit.snippet.after }}
              </span>
            </button>
          </template>
          <p v-else-if="query.trim() && searching" class="empty">Recherche…</p>
          <p v-else-if="searched && !searching && hits.length === 0" class="empty">
            Aucune occurrence.
          </p>
          <p v-else class="empty">Tapez pour chercher dans tout le livre.</p>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.search-card {
  width: 560px;
  max-width: 100%;
  max-height: 72vh;
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
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-height: 0;
}

.item {
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  border-left: 2px solid transparent;
  border-radius: var(--radius-s);
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
  border-left-color: var(--accent);
}
.heading {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 2px;
}
.chapter-title {
  font-weight: 600;
}
.pos {
  margin-left: auto;
  color: var(--fg-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.snippet {
  display: block;
  color: var(--fg-muted);
  font-size: 12.5px;
  line-height: 1.5;
}
.snippet mark {
  background: color-mix(in srgb, var(--accent) 22%, var(--bg));
  color: var(--fg);
  border-radius: 3px;
  padding: 0 2px;
}
.empty {
  padding: 24px 12px;
  text-align: center;
  color: var(--fg-muted);
  font-size: 13px;
}

.kbd {
  margin-right: 2px;
}
</style>
