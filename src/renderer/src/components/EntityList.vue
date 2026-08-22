<script setup lang="ts">
// Liste maître de l'aside pour les sections personnages/lieux (Task 15) :
// même motif que ChapterList (liste + bouton +, form inline de création,
// élément actif surligné), la fiche sélectionnée s'affichant dans le corps
// via EntitiesSection. La suppression reste portée par la fiche elle-même
// (EntityCard.removeEntity) — pas dupliquée ici — pour ne pas multiplier les
// actions destructrices sur le même objet.
import { computed, nextTick, ref } from 'vue'
import { useEntitiesStore } from '../stores/entities'
import { useBookStore } from '../stores/book'
import { mediaUrl } from '../utils/media'
import type { EntityKind } from '../../../shared/types'

const props = defineProps<{ kind: EntityKind }>()

const store = useEntitiesStore()
const bookStore = useBookStore()

const LABELS: Record<EntityKind, { title: string; empty: string; placeholder: string }> = {
  character: {
    title: 'Personnages',
    empty: 'Aucun personnage.',
    placeholder: 'Nom du personnage'
  },
  place: {
    title: 'Lieux',
    empty: 'Aucun lieu.',
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
  const entity = await store.create(bookStore.book.id, props.kind, name)
  creating.value = false
  newName.value = ''
  store.select(entity.id)
}

function initials(name: string): string {
  return (name.trim().slice(0, 1) || '?').toUpperCase()
}
</script>

<template>
  <nav class="entities">
    <div class="head">
      <h2>{{ labels.title }}</h2>
      <button class="add" type="button" :title="`Nouveau : ${labels.placeholder}`" @click="openCreateForm">
        +
      </button>
    </div>

    <Transition name="unfold">
      <form v-if="creating" class="add-form" @submit.prevent="createEntity">
        <input
          ref="nameInput"
          v-model="newName"
          :placeholder="labels.placeholder"
          @keyup.esc="cancelCreate"
          @blur="!newName.trim() && cancelCreate()"
        />
      </form>
    </Transition>

    <p v-if="filtered.length === 0 && !creating" class="empty">
      {{ labels.empty }} Cliquez sur <span class="plus-ref">+</span> pour commencer.
    </p>

    <TransitionGroup v-else name="row" tag="ul">
      <li
        v-for="entity in filtered"
        :key="entity.id"
        :class="{ active: entity.id === store.selectedId }"
        @click="store.select(entity.id)"
      >
        <span class="avatar">
          <img v-if="entity.imagePath" :src="mediaUrl(entity.imagePath) ?? undefined" alt="" />
          <span v-else>{{ initials(entity.name) }}</span>
        </span>
        <span class="name">{{ entity.name || '(sans nom)' }}</span>
      </li>
    </TransitionGroup>
  </nav>
</template>

<style scoped>
.entities {
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
  gap: 9px;
  padding: 6px 10px 6px 12px;
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
li.active .name {
  color: var(--accent);
  font-weight: 600;
}

.avatar {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: linear-gradient(
    155deg,
    var(--accent) 0%,
    color-mix(in srgb, var(--accent) 42%, var(--bg)) 100%
  );
}
.avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.avatar span {
  font-family: var(--font-manuscript);
  font-size: 11px;
  font-weight: 600;
  color: var(--bg);
}

.name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
