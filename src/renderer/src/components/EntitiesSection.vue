<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useEntitiesStore } from '../stores/entities'
import { useBookStore } from '../stores/book'
import type { EntityKind } from '../../../shared/types'
import EntityCard from './EntityCard.vue'

const props = defineProps<{ kind: EntityKind }>()

const store = useEntitiesStore()
const bookStore = useBookStore()

const LABELS: Record<EntityKind, { title: string; empty: string; placeholder: string }> = {
  character: {
    title: 'Personnages',
    empty: 'Aucun personnage pour l’instant.',
    placeholder: 'Nom du personnage'
  },
  place: {
    title: 'Lieux',
    empty: 'Aucun lieu pour l’instant.',
    placeholder: 'Nom du lieu'
  }
}
const labels = computed(() => LABELS[props.kind])

const filtered = computed(() => store.entities.filter((e) => e.kind === props.kind))

const creating = ref(false)
const newName = ref('')
const nameInput = ref<HTMLInputElement | null>(null)

async function openCreateForm(): Promise<void> {
  creating.value = true
  await nextTick()
  nameInput.value?.focus()
}
function cancelCreate(): void {
  creating.value = false
  newName.value = ''
}
async function createEntity(): Promise<void> {
  const name = newName.value.trim()
  if (!name || !bookStore.book) return
  await store.create(bookStore.book.id, props.kind, name)
  creating.value = false
  newName.value = ''
}
</script>

<template>
  <div class="section">
    <header>
      <h2>{{ labels.title }}</h2>
      <button class="primary" type="button" @click="openCreateForm">
        <span class="plus">+</span> Nouveau
      </button>
    </header>

    <Transition name="unfold">
      <form v-if="creating" class="create-form" @submit.prevent="createEntity">
        <input
          ref="nameInput"
          v-model="newName"
          :placeholder="labels.placeholder"
          @keyup.esc="cancelCreate"
          @blur="!newName.trim() && cancelCreate()"
        />
        <button class="primary" type="submit" :disabled="!newName.trim()">Créer</button>
      </form>
    </Transition>

    <p v-if="filtered.length === 0 && !creating" class="empty">
      {{ labels.empty }} Cliquez sur <span class="plus-ref">+</span> pour commencer.
    </p>

    <TransitionGroup v-else name="card" tag="div" class="grid">
      <EntityCard v-for="entity in filtered" :key="entity.id" :entity-id="entity.id" />
    </TransitionGroup>
  </div>
</template>

<style scoped>
.section {
  padding: 28px 36px 48px;
  height: 100vh;
  overflow-y: auto;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
}
h2 {
  font-family: var(--font-manuscript);
  font-size: 22px;
  font-weight: 600;
}
.plus {
  display: inline-block;
  margin-right: 2px;
}

.create-form {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
  padding: 14px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
}
.create-form input {
  flex: 1;
}

.empty {
  color: var(--fg-muted);
  font-size: 13px;
  padding: 12px 2px;
}
.plus-ref {
  color: var(--accent);
  font-weight: 600;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 18px;
  align-items: start;
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
