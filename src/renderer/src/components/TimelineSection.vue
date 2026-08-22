<script setup lang="ts">
// Chronologie (Task 14) : rail vertical d'événements, réordonnables par
// glisser-déposer HTML5 natif ou par les boutons ↑/↓ de chaque carte (voir
// TimelineEventCard). Chargement paresseux à l'entrée de la section, comme
// OutlineSection (Task 8) — la chronologie n'est pas nécessaire ailleurs
// dans BookView, contrairement aux entités (mentions/autolink).
import { nextTick, onMounted, ref, watch } from 'vue'
import type { ComponentPublicInstance } from 'vue'
import { useBookStore } from '../stores/book'
import { useTimelineStore } from '../stores/timeline'
import TimelineEventCard from './TimelineEventCard.vue'

const bookStore = useBookStore()
const store = useTimelineStore()

async function load(): Promise<void> {
  if (!bookStore.book) return
  await store.load(bookStore.book.id)
}
onMounted(load)
watch(() => bookStore.book?.id, load)

// --- Création --------------------------------------------------------
// Titre par défaut (comme ChapterList.addChapter) : create(bookId, title)
// exige un titre non vide côté IPC, l'utilisateur le personnalise ensuite
// directement dans le champ (autofocus via focusTitle exposé par la carte).
type CardInstance = ComponentPublicInstance<{ focusTitle: () => void }>
const cardRefs = new Map<number, CardInstance>()
function setCardRef(id: number, el: Element | ComponentPublicInstance | null): void {
  if (el) cardRefs.set(id, el as CardInstance)
  else cardRefs.delete(id)
}

async function addEvent(): Promise<void> {
  if (!bookStore.book) return
  const title = `Événement ${store.events.length + 1}`
  const event = await store.create(bookStore.book.id, title)
  if (!event) return
  await nextTick()
  cardRefs.get(event.id)?.focusTitle()
}

// --- Glisser-déposer ---------------------------------------------------
// Réordonnancement "en direct" pendant le survol (comme la plupart des
// listes triables) : à chaque dragover sur une autre carte, l'élément
// déplacé est extrait de sa position courante puis réinséré à la position
// de la carte survolée. Puisque `events` (état du store) est déjà dans son
// ordre final à ce moment-là, `drop` n'a plus qu'à persister via l'IPC —
// aucun calcul d'index supplémentaire n'y est nécessaire, ce qui évite tout
// décalage d'un cran (off-by-one) qu'un calcul a posteriori sur les
// positions DOM pourrait introduire, notamment en glissant vers le bas.
const draggingId = ref<number | null>(null)

function onDragStart(id: number, event: DragEvent): void {
  draggingId.value = id
  event.dataTransfer?.setData('text/plain', String(id))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
function onDragOver(overId: number): void {
  if (draggingId.value === null || draggingId.value === overId) return
  const list = store.events
  const from = list.findIndex((e) => e.id === draggingId.value)
  const to = list.findIndex((e) => e.id === overId)
  if (from === -1 || to === -1) return
  const [moved] = list.splice(from, 1)
  list.splice(to, 0, moved)
}
function onDrop(): void {
  if (draggingId.value === null) return
  store.reorder(store.events.map((e) => e.id))
  draggingId.value = null
}
// dragend se déclenche toujours après drop (draggingId déjà remis à null par
// onDrop dans ce cas). S'il est encore non-null ici, c'est qu'aucun drop
// n'a eu lieu (relâché hors des cartes, ou glisser annulé via Échap) :
// l'ordre affiché (déjà réordonné en direct par onDragOver) diverge alors de
// l'ordre persisté. On le rattrape en persistant l'ordre visible — résolution
// la plus simple et cohérente pour l'utilisateur, qui a déjà vu ce nouvel
// ordre pendant le survol.
function onDragEnd(): void {
  if (draggingId.value !== null) {
    store.reorder(store.events.map((e) => e.id))
  }
  draggingId.value = null
}
</script>

<template>
  <div class="section">
    <header>
      <h2>Chronologie</h2>
      <button class="primary" type="button" @click="addEvent">
        <span class="plus">+</span> Nouvel événement
      </button>
    </header>
    <p class="hint">
      Ordonnez les événements de l’histoire ; liez-les aux chapitres où ils sont racontés et aux
      personnages impliqués.
    </p>

    <p v-if="store.events.length === 0" class="empty">
      Aucun événement pour l’instant. Ordonnez les grandes étapes de l’histoire, puis liez chaque
      événement aux chapitres où il est raconté et aux personnages impliqués. Cliquez sur
      <span class="plus-ref">+</span> pour commencer.
    </p>

    <TransitionGroup v-else tag="ol" name="row" class="rail">
      <li
        v-for="(event, index) in store.events"
        :key="event.id"
        class="rail-item"
        :class="{ dragging: draggingId === event.id }"
        draggable="true"
        @dragstart="onDragStart(event.id, $event)"
        @dragover.prevent="onDragOver(event.id)"
        @drop.prevent="onDrop"
        @dragend="onDragEnd"
      >
        <div class="gutter">
          <span class="dot"></span>
          <span v-if="index < store.events.length - 1" class="connector"></span>
        </div>
        <TimelineEventCard :ref="(el) => setCardRef(event.id, el)" :event-id="event.id" />
      </li>
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

.hint {
  color: var(--fg-muted);
  font-size: 12.5px;
  line-height: 1.5;
  max-width: 46rem;
  margin: 10px 0 20px;
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

.rail {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 22px;
  max-width: 46rem;
}

.rail-item {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  cursor: grab;
}
.rail-item:active {
  cursor: grabbing;
}
.rail-item.dragging {
  opacity: 0.4;
}

.gutter {
  position: relative;
  flex-shrink: 0;
  width: 12px;
  display: flex;
  justify-content: center;
  padding-top: 18px;
  align-self: stretch;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent);
  flex-shrink: 0;
  z-index: 1;
}
.connector {
  position: absolute;
  top: 22px;
  bottom: -22px;
  left: 50%;
  width: 2px;
  transform: translateX(-50%);
  background: var(--border);
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
  transform: translateY(-4px);
}
.row-move {
  transition: transform 0.2s ease;
}
</style>
