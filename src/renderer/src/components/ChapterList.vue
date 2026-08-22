<script setup lang="ts">
import { nextTick, ref } from 'vue'
import { useBookStore } from '../stores/book'

const store = useBookStore()
const adding = ref(false)
const newTitle = ref('')
const newTitleInput = ref<HTMLInputElement | null>(null)

const STATUS_DOTS: Record<string, string> = {
  brouillon: '○',
  premier_jet: '◔',
  relu: '◑',
  final: '●'
}

const STATUS_LABELS: Record<string, string> = {
  brouillon: 'Brouillon',
  premier_jet: 'Premier jet',
  relu: 'Relu',
  final: 'Final'
}

async function openAddForm(): Promise<void> {
  adding.value = true
  await nextTick()
  newTitleInput.value?.focus()
}

async function addChapter(): Promise<void> {
  const title = newTitle.value.trim() || `Chapitre ${store.chapters.length + 1}`
  await store.createChapter(title)
  newTitle.value = ''
  adding.value = false
}

function cancelAdd(): void {
  adding.value = false
  newTitle.value = ''
}

async function removeChapter(id: number, title: string): Promise<void> {
  if (confirm(`Supprimer « ${title} » ?`)) await store.removeChapter(id)
}
</script>

<template>
  <nav class="chapters">
    <div class="head">
      <h2>Chapitres</h2>
      <button class="add" type="button" title="Nouveau chapitre" @click="openAddForm">+</button>
    </div>

    <Transition name="unfold">
      <form v-if="adding" class="add-form" @submit.prevent="addChapter">
        <input
          ref="newTitleInput"
          v-model="newTitle"
          placeholder="Titre du chapitre"
          @keyup.esc="cancelAdd"
          @blur="!newTitle.trim() && cancelAdd()"
        />
      </form>
    </Transition>

    <p v-if="store.chapters.length === 0 && !adding" class="empty">
      Aucun chapitre. Cliquez sur <span class="plus-ref">+</span> pour commencer.
    </p>

    <TransitionGroup v-else name="row" tag="ul">
      <li
        v-for="(chapter, index) in store.chapters"
        :key="chapter.id"
        :class="{ active: chapter.id === store.currentChapter?.id }"
        @click="store.openChapter(chapter.id)"
      >
        <span class="dot" :class="chapter.status" :title="STATUS_LABELS[chapter.status]">{{
          STATUS_DOTS[chapter.status]
        }}</span>
        <span class="title">{{ chapter.title }}</span>
        <span class="words">{{ chapter.wordCount.toLocaleString('fr-FR') }}</span>
        <span class="actions">
          <button
            :disabled="index === 0"
            title="Monter"
            type="button"
            @click.stop="store.moveChapter(chapter.id, -1)"
          >
            ↑
          </button>
          <button
            :disabled="index === store.chapters.length - 1"
            title="Descendre"
            type="button"
            @click.stop="store.moveChapter(chapter.id, 1)"
          >
            ↓
          </button>
          <button
            title="Supprimer"
            type="button"
            @click.stop="removeChapter(chapter.id, chapter.title)"
          >
            ×
          </button>
        </span>
      </li>
    </TransitionGroup>
  </nav>
</template>

<style scoped>
.chapters {
  padding: 6px 10px 16px;
  overflow-y: auto;
  flex: 1;
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 8px 8px;
}
h2 {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--fg-muted);
}
.add {
  width: 22px;
  height: 22px;
  padding: 0;
  display: grid;
  place-items: center;
  border-radius: 50%;
  font-size: 15px;
  line-height: 1;
  border-color: transparent;
  color: var(--fg-muted);
}
.add:hover {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.add-form {
  padding: 0 8px 8px;
  overflow: hidden;
}
.add-form input {
  width: 100%;
  font-size: 13px;
}

.empty {
  padding: 10px 12px 4px;
  color: var(--fg-muted);
  font-size: 12.5px;
  line-height: 1.5;
}
.plus-ref {
  color: var(--accent);
  font-weight: 600;
}

ul {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

li {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px 7px 12px;
  border-radius: 7px;
  cursor: pointer;
  font-size: 13px;
  border-left: 2px solid transparent;
  transition:
    background-color 0.12s ease,
    border-color 0.12s ease;
}
li:hover {
  background: color-mix(in srgb, var(--fg) 5%, transparent);
}
li.active {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border-left-color: var(--accent);
}
li.active .title {
  color: var(--accent);
  font-weight: 600;
}

.dot {
  color: var(--fg-muted);
  font-size: 11px;
  width: 12px;
  text-align: center;
  flex-shrink: 0;
}
.dot.relu,
.dot.final {
  color: var(--accent);
}

.title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.words {
  color: var(--fg-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.actions {
  display: none;
  gap: 1px;
  flex-shrink: 0;
}
li:hover .actions,
li:focus-within .actions {
  display: inline-flex;
}
.actions button {
  border: none;
  padding: 2px 5px;
  font-size: 12px;
  border-radius: 4px;
  color: var(--fg-muted);
}
.actions button:hover:not(:disabled) {
  color: var(--fg);
  background: color-mix(in srgb, var(--fg) 8%, transparent);
}
.actions button:disabled {
  opacity: 0.25;
  cursor: default;
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
  transform: translateY(-4px);
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
  transform: translateX(-4px);
}
.row-leave-active {
  position: absolute;
  width: 100%;
}
.row-move {
  transition: transform 0.15s ease;
}
</style>
