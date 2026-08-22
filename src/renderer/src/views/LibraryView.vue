<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useLibraryStore } from '../stores/library'
import BookCard from '../components/BookCard.vue'

const store = useLibraryStore()
const router = useRouter()
const creating = ref(false)
const newTitle = ref('')
const newAuthor = ref('')
const titleInput = ref<HTMLInputElement | null>(null)

onMounted(() => store.load())

const bookCountLabel = computed(() => {
  const n = store.books.length
  return n === 0 ? '' : n === 1 ? '1 livre' : `${n} livres`
})

async function openCreateForm(): Promise<void> {
  creating.value = true
  await nextTick()
  titleInput.value?.focus()
}

function cancelCreate(): void {
  creating.value = false
  newTitle.value = ''
  newAuthor.value = ''
}

async function createBook(): Promise<void> {
  const title = newTitle.value.trim()
  if (!title) return
  const book = await store.create({ title, author: newAuthor.value.trim() })
  creating.value = false
  newTitle.value = ''
  newAuthor.value = ''
  router.push(`/book/${book.id}`)
}

async function removeBook(id: number, title: string): Promise<void> {
  if (confirm(`Supprimer « ${title} » et tous ses chapitres ?`)) await store.remove(id)
}
</script>

<template>
  <main class="library">
    <header>
      <div>
        <h1>Bibliothèque</h1>
        <p v-if="bookCountLabel" class="count">{{ bookCountLabel }}</p>
      </div>
      <button class="primary" type="button" @click="openCreateForm">
        <span class="plus">+</span> Nouveau livre
      </button>
    </header>

    <Transition name="unfold">
      <form v-if="creating" class="create-form" @submit.prevent="createBook">
        <input ref="titleInput" v-model="newTitle" placeholder="Titre" />
        <input v-model="newAuthor" placeholder="Auteur (optionnel)" />
        <div class="create-actions">
          <button class="primary" type="submit" :disabled="!newTitle.trim()">Créer</button>
          <button type="button" @click="cancelCreate">Annuler</button>
        </div>
      </form>
    </Transition>

    <div v-if="store.loaded && store.books.length === 0" class="empty">
      <svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true">
        <path
          d="M24 6c-7 3-14 3-18 1v30c4 2 11 2 18-1 7 3 14 3 18-1V7c-4 2-11 2-18-1Z"
          fill="none"
          stroke="var(--fg-muted)"
          stroke-width="1.6"
          stroke-linejoin="round"
        />
        <path d="M24 6v29" fill="none" stroke="var(--fg-muted)" stroke-width="1.6" />
      </svg>
      <p>Aucun livre pour l'instant.</p>
      <button class="primary" type="button" @click="openCreateForm">Créer le premier</button>
    </div>

    <TransitionGroup v-else name="card" tag="div" class="grid">
      <BookCard
        v-for="book in store.books"
        :key="book.id"
        :book="book"
        @open="router.push(`/book/${book.id}`)"
        @remove="removeBook(book.id, book.title)"
      />
    </TransitionGroup>
  </main>
</template>

<style scoped>
.library {
  padding: 32px 40px 48px;
  height: 100vh;
  overflow-y: auto;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 28px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--border);
}
h1 {
  font-family: var(--font-manuscript);
  font-size: 30px;
  font-weight: 600;
}
.count {
  color: var(--fg-muted);
  font-size: 13px;
  margin-top: 2px;
}
.plus {
  display: inline-block;
  margin-right: 2px;
}

.create-form {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 24px;
  padding: 16px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}
.create-form input:first-child {
  flex: 1;
}
.create-form input:nth-child(2) {
  flex: 1;
}
.create-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.unfold-enter-active,
.unfold-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}
.unfold-enter-from,
.unfold-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  color: var(--fg-muted);
  text-align: center;
  padding: 80px 20px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 18px;
}

.card-enter-active {
  transition:
    opacity 0.2s ease,
    transform 0.2s ease;
}
.card-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}
.card-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.card-leave-to {
  opacity: 0;
  transform: scale(0.96);
}
.card-move {
  transition: transform 0.2s ease;
}
</style>
