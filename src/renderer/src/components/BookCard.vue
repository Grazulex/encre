<script setup lang="ts">
import { ref, watch } from 'vue'
import type { Book } from '../../../shared/types'
import { BOOK_STATUS_LABELS } from '../../../shared/labels'
import { mediaUrl } from '../utils/media'

const props = defineProps<{ book: Book }>()
defineEmits<{ open: []; remove: [] }>()

const STATUS_LABELS = BOOK_STATUS_LABELS

function progress(): string {
  const words = props.book.wordCount.toLocaleString('fr-FR')
  if (!props.book.wordGoal) return `${words} mots`
  return `${words} / ${props.book.wordGoal.toLocaleString('fr-FR')} mots`
}

// Même garde que EntityCard : bascule sur le monogramme dégradé si l'image
// échoue à charger (fichier déplacé/supprimé hors de l'app).
const coverFailed = ref(false)
watch(
  () => props.book.coverPath,
  () => (coverFailed.value = false)
)
</script>

<template>
  <article
    class="card"
    tabindex="0"
    role="button"
    :aria-label="`Ouvrir « ${book.title} »`"
    @click="$emit('open')"
    @keydown.enter="$emit('open')"
    @keydown.space.prevent="$emit('open')"
  >
    <div class="cover">
      <img
        v-if="book.coverPath && !coverFailed"
        :src="mediaUrl(book.coverPath) ?? undefined"
        alt=""
        @error="coverFailed = true"
      />
      <span v-else>{{ book.title.slice(0, 1).toUpperCase() }}</span>
    </div>
    <h3>{{ book.title }}</h3>
    <span v-if="book.seriesName" class="series-badge">{{ book.seriesName }}</span>
    <p class="meta">
      <span class="status" :class="book.status">{{ STATUS_LABELS[book.status] }}</span>
      <span class="dot">·</span>{{ book.chapterCount }} chap. <span class="dot">·</span
      >{{ progress() }}
    </p>
    <button
      class="delete"
      type="button"
      title="Supprimer"
      aria-label="Supprimer ce livre"
      @click.stop="$emit('remove')"
    >
      ×
    </button>
  </article>
</template>

<style scoped>
.card {
  position: relative;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 14px;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    transform 0.15s ease,
    box-shadow 0.15s ease;
}
.card:hover,
.card:focus-visible {
  border-color: var(--accent);
  transform: translateY(-3px);
  box-shadow: 0 10px 20px -12px color-mix(in srgb, var(--fg) 35%, transparent);
}
.card:active {
  transform: translateY(-1px);
}

.cover {
  position: relative;
  aspect-ratio: 2 / 3;
  border-radius: 5px 8px 8px 5px;
  overflow: hidden;
  background: linear-gradient(
    155deg,
    var(--accent) 0%,
    color-mix(in srgb, var(--accent) 42%, var(--bg)) 100%
  );
  display: grid;
  place-items: center;
  margin-bottom: 10px;
  box-shadow: 0 1px 3px color-mix(in srgb, var(--fg) 20%, transparent);
}
.cover::before {
  /* la reliure : une amorce de dos de livre sur le bord gauche */
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 5px;
  background: color-mix(in srgb, black 20%, transparent);
}
.cover::after {
  /* un reflet discret, comme la lumière sur une couverture toilée */
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    120deg,
    color-mix(in srgb, white 20%, transparent) 0%,
    transparent 40%
  );
  mix-blend-mode: overlay;
}
.cover span {
  position: relative;
  font-family: var(--font-manuscript);
  font-size: 2.75rem;
  font-weight: 600;
  color: var(--bg);
}
.cover img {
  position: relative;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

h3 {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.series-badge {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10.5px;
  font-weight: 500;
  color: var(--fg-muted);
  border: 1px solid var(--border);
  border-radius: 100px;
  padding: 1px 8px;
  margin-bottom: 4px;
}

.meta {
  color: var(--fg-muted);
  font-size: 12px;
}
.status {
  font-weight: 600;
  color: var(--fg);
}
.status.archive {
  color: var(--fg-muted);
  font-weight: 500;
}
.dot {
  margin: 0 4px;
}

.delete {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: var(--bg-panel);
  color: var(--fg-muted);
  padding: 0;
  font-size: 14px;
  line-height: 1;
  opacity: 0;
  transition:
    opacity 0.15s ease,
    color 0.15s ease,
    border-color 0.15s ease;
}
.card:hover .delete,
.card:focus-within .delete {
  opacity: 1;
}
.delete:hover {
  color: var(--fg);
  border-color: var(--fg-muted);
}
</style>
