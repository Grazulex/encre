<script setup lang="ts">
// Rapport de vérification de chronologie NIVEAU LIVRE (Task 6, plan 3c) :
// monté par ClaudePanel sous la section « Chronologie » dès que
// ai.task === 'chrono' && ai.phase === 'done' — entièrement piloté par le
// store ai (pas de props/emit), même idiome que ReviewPanel. Contrairement à
// ReviewPanel, aucune action « Appliquer » (rapport en lecture seule — aucune
// mutation du manuscrit dans cette tâche) : seules les puces « Chap. N » et
// « Événement : titre » sont interactives, et se contentent de NAVIGUER
// (chapitre courant du livre, ou section Chronologie), jamais de modifier
// quoi que ce soit.
import { useAiStore } from '../stores/ai'
import { useBookStore } from '../stores/book'
import { useTimelineStore } from '../stores/timeline'

const ai = useAiStore()
const bookStore = useBookStore()
const timelineStore = useTimelineStore()

// Numéro affiché sur la puce « Chap. N » : la POSITION du chapitre dans le
// livre (1, 2, 3…), pas son id — c'est le repère que l'autrice/l'auteur
// reconnaît, l'id n'étant qu'un détail d'implémentation. Un id qui ne
// correspond plus à aucun chapitre courant (voir filterChronoIssueIds,
// stores/ai.ts) a déjà été retiré de issue.chapterIds avant d'arriver ici,
// donc chapterLabel ne devrait jamais rencontrer d'id inconnu — le repli sur
// l'id lui-même n'est qu'un filet de sécurité défensif.
function chapterLabel(chapterId: number): string {
  const chapter = bookStore.chapters.find((c) => c.id === chapterId)
  return chapter ? `Chap. ${chapter.position}` : `Chap. ${chapterId}`
}

function eventLabel(eventId: number): string {
  const event = timelineStore.events.find((e) => e.id === eventId)
  return event ? `Événement : ${event.title}` : 'Événement'
}

// Navigue vers le chapitre visé par la puce : section chapitres + ouverture
// du chapitre, même mécanique que ChapterList (store.setSection +
// store.openChapter). Un id caduc (filtré côté store, voir plus haut) ne
// devrait jamais atteindre ce point ; no-op silencieux si jamais le chapitre
// a disparu entre-temps (supprimé pendant que le rapport était affiché).
function goToChapter(chapterId: number): void {
  if (!bookStore.chapters.some((c) => c.id === chapterId)) return
  bookStore.setSection('chapitres')
  bookStore.openChapter(chapterId)
}

// « Ouvre la vue chronologie » (brief) : bascule simplement vers la section
// Chronologie de l'espace livre — aucun mécanisme de défilement vers un
// événement précis n'existe ailleurs dans l'app (TimelineSection affiche
// toute la liste), donc rien de plus à faire ici pour rester cohérent avec
// le reste de l'interface.
function goToTimeline(): void {
  bookStore.setSection('chronologie')
}
</script>

<template>
  <div class="chrono-report">
    <p v-if="ai.chronoParseError" class="cp-error">
      Réponse de vérification illisible — {{ ai.chronoParseError }}
    </p>
    <template v-else>
      <p v-if="ai.chronoMalformedCount > 0" class="cp-hint">
        {{ ai.chronoMalformedCount }}
        incohérence{{ ai.chronoMalformedCount > 1 ? 's' : '' }} malformée{{
          ai.chronoMalformedCount > 1 ? 's' : ''
        }}
        ignorée{{ ai.chronoMalformedCount > 1 ? 's' : '' }}.
      </p>
      <p v-if="ai.chronoUnknownIdCount > 0" class="cp-hint">
        {{ ai.chronoUnknownIdCount }} référence{{ ai.chronoUnknownIdCount > 1 ? 's' : '' }} à un
        chapitre ou événement introuvable ignorée{{ ai.chronoUnknownIdCount > 1 ? 's' : '' }}.
      </p>
      <p v-if="ai.chronoIssues.length === 0" class="cp-hint">Aucune incohérence détectée.</p>
    </template>

    <ul v-if="!ai.chronoParseError && ai.chronoIssues.length > 0" class="chrono-list">
      <li v-for="(issue, index) in ai.chronoIssues" :key="index" class="chrono-item">
        <span class="chrono-badge" :class="`severity-${issue.severity}`">
          {{ issue.severity === 'incoherence' ? 'Incohérence' : 'Doute' }}
        </span>
        <p class="chrono-description">{{ issue.description }}</p>
        <div v-if="issue.chapterIds.length > 0 || issue.eventIds.length > 0" class="chrono-chips">
          <button
            v-for="chapterId in issue.chapterIds"
            :key="`ch-${chapterId}`"
            type="button"
            class="chrono-chip"
            @click="goToChapter(chapterId)"
          >
            {{ chapterLabel(chapterId) }}
          </button>
          <button
            v-for="eventId in issue.eventIds"
            :key="`ev-${eventId}`"
            type="button"
            class="chrono-chip"
            @click="goToTimeline"
          >
            {{ eventLabel(eventId) }}
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.chrono-report {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cp-hint {
  font-size: 12px;
  color: var(--fg-muted);
}
.cp-error {
  font-size: 12px;
  color: var(--danger);
}

.chrono-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.chrono-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 9px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
}

.chrono-badge {
  align-self: flex-start;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  border-radius: 100px;
  padding: 2px 8px;
}
.chrono-badge.severity-incoherence {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}
.chrono-badge.severity-doute {
  color: var(--fg-muted);
  background: color-mix(in srgb, var(--fg-muted) 14%, transparent);
}

.chrono-description {
  font-size: 13px;
  line-height: 1.5;
  color: var(--fg);
}

.chrono-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chrono-chip {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 9px;
  border-radius: 100px;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
}
.chrono-chip:hover {
  background: color-mix(in srgb, var(--accent) 18%, transparent);
}
</style>
