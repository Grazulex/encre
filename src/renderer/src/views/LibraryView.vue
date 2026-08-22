<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useLibraryStore } from '../stores/library'
import BookCard from '../components/BookCard.vue'
import ImportWizard from '../components/ImportWizard.vue'
import ConfirmDialog from '../components/ConfirmDialog.vue'

const store = useLibraryStore()
const router = useRouter()
const creating = ref(false)
const newTitle = ref('')
const newAuthor = ref('')
const titleInput = ref<HTMLInputElement | null>(null)
const importing = ref(false)

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

// Suppression thémée (audit UI/UX, proposition #13) : window.confirm() natif
// remplacé par ConfirmDialog — même sémantique (confirmer supprime, annuler/
// Échap ne fait rien).
const pendingRemoval = ref<{ id: number; title: string } | null>(null)

function removeBook(id: number, title: string): void {
  pendingRemoval.value = { id, title }
}

async function confirmRemoval(): Promise<void> {
  const target = pendingRemoval.value
  pendingRemoval.value = null
  if (target) await store.remove(target.id)
}

function cancelRemoval(): void {
  pendingRemoval.value = null
}
</script>

<template>
  <main class="library">
    <header>
      <div>
        <h1>Bibliothèque</h1>
        <p v-if="bookCountLabel" class="count">{{ bookCountLabel }}</p>
      </div>
      <div class="header-actions">
        <button type="button" @click="importing = true">Importer un livre</button>
        <button class="primary" type="button" @click="openCreateForm">
          <span class="plus">+</span> Nouveau livre
        </button>
      </div>
    </header>

    <ImportWizard v-if="importing" @close="importing = false" />

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

    <ConfirmDialog
      v-if="pendingRemoval"
      :message="`Supprimer « ${pendingRemoval.title} » et tous ses chapitres ?`"
      @confirm="confirmRemoval"
      @cancel="cancelRemoval"
    />
  </main>
</template>

<style scoped>
.library {
  padding: 32px 40px 48px;
  height: 100vh;
  overflow-y: auto;
}

/* Bande de fenêtre (audit UI/UX, proposition #5) : titleBarStyle
   'hiddenInset' (src/main/index.ts) fond les feux tricolores dans le
   contenu — padding-top réservé au-dessus du titre, bande draggable avec
   no-drag sur les boutons (.header-actions) pour qu'ils restent cliquables. */
header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 28px;
  padding-top: 36px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--border);
  -webkit-app-region: drag;
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

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  -webkit-app-region: no-drag;
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
