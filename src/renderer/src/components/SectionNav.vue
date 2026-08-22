<script setup lang="ts">
import { useBookStore } from '../stores/book'
import { SECTION_LABELS } from '../../../shared/labels'
import type { BookSection } from '../../../shared/types'

const store = useBookStore()

const SECTIONS: BookSection[] = ['chapitres', 'personnages', 'lieux', 'chronologie', 'plan']
</script>

<template>
  <nav class="section-nav" aria-label="Sections de l'espace livre">
    <button
      v-for="key in SECTIONS"
      :key="key"
      type="button"
      class="section"
      :class="{ active: store.section === key }"
      :aria-current="store.section === key ? 'page' : undefined"
      @click="store.setSection(key)"
    >
      {{ SECTION_LABELS[key] }}
    </button>
  </nav>
</template>

<style scoped>
.section-nav {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 10px 10px 8px;
  border-bottom: 1px solid var(--border);
}

/* Même geste visuel que la ligne de chapitre active (ChapterList) : un
   trait d'encre à gauche marque « où l'on est », répété ici au niveau
   des sections pour que l'aside se lise comme un seul système. */
.section {
  border: none;
  border-left: 2px solid transparent;
  border-radius: 0 6px 6px 0;
  text-align: left;
  padding: 6px 10px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--fg-muted);
  transition:
    background-color 0.12s ease,
    border-color 0.15s ease,
    color 0.12s ease;
}
.section:hover {
  color: var(--fg);
  background: color-mix(in srgb, var(--fg) 5%, transparent);
  border-left-color: transparent;
}
.section.active {
  color: var(--accent);
  font-weight: 600;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border-left-color: var(--accent);
}
.section.active:hover {
  border-left-color: var(--accent);
}
</style>
