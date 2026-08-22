<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useBookStore } from '../stores/book'
import ChapterList from '../components/ChapterList.vue'
import EditorPane from '../components/EditorPane.vue'
import StatusBar from '../components/StatusBar.vue'

const props = defineProps<{ bookId: number }>()
const store = useBookStore()
const router = useRouter()

onMounted(() => store.open(props.bookId))

const progress = computed(() => {
  const book = store.book
  if (!book) return ''
  const words = book.wordCount.toLocaleString('fr-FR')
  return book.wordGoal
    ? `${words} / ${book.wordGoal.toLocaleString('fr-FR')} mots`
    : `${words} mots`
})
</script>

<template>
  <div class="book-space">
    <aside>
      <button class="back" type="button" @click="router.push('/')">
        <span class="chevron">←</span> Bibliothèque
      </button>
      <div v-if="store.book" class="header">
        <h1>{{ store.book.title }}</h1>
        <p class="meta">
          <span v-if="store.book.author">{{ store.book.author }}</span>
          <span v-if="store.book.author && store.book.genre" class="dot">·</span>
          <span v-if="store.book.genre">{{ store.book.genre }}</span>
        </p>
        <p class="progress">{{ progress }}</p>
      </div>
      <ChapterList />
    </aside>
    <main>
      <p v-if="!store.currentChapter" class="empty">
        Créez un chapitre pour commencer à écrire.
      </p>
      <template v-else>
        <EditorPane />
        <StatusBar />
      </template>
    </main>
  </div>
</template>

<style scoped>
.book-space {
  display: grid;
  grid-template-columns: 260px 1fr;
  height: 100vh;
}

aside {
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.back {
  align-self: flex-start;
  border: none;
  padding: 14px 16px 0;
  color: var(--fg-muted);
  font-size: 12px;
}
.back:hover {
  color: var(--accent);
}
.chevron {
  display: inline-block;
  transition: transform 0.15s ease;
}
.back:hover .chevron {
  transform: translateX(-2px);
}

.header {
  padding: 10px 18px 14px;
  border-bottom: 1px solid var(--border);
}
.header h1 {
  font-family: var(--font-manuscript);
  font-size: 19px;
  font-weight: 600;
  line-height: 1.25;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.header .meta {
  color: var(--fg-muted);
  font-size: 12px;
  margin-top: 4px;
}
.header .meta .dot {
  margin: 0 4px;
}
.header .progress {
  color: var(--fg-muted);
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  margin-top: 6px;
}

main {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.empty {
  margin: auto;
  color: var(--fg-muted);
  text-align: center;
  font-size: 13px;
}
</style>
