<script setup lang="ts">
// Panneau de suggestions de relecture (Task 3, plan 3c) : monté par
// ClaudePanel sous la section « Relecture » dès que
// ai.task === 'review' && ai.phase === 'done' (voir son template) — entièrement
// piloté par le store ai (pas de props/emit), même idiome que FormatDialog.
// Contrairement à FormatDialog, ce n'est PAS une boîte modale : la liste de
// suggestions s'affiche inline, appliquée une à une, le panneau restant
// ouvert et navigable pendant l'opération (brief : « appliquées une à une »).
//
// Le STATUT par suggestion (pending/applied/dismissed/notFound) est un pur
// détail d'affichage porté ICI, jamais par le store (ai.reviewSuggestions
// reste la donnée brute reçue de l'IA, voir stores/ai.ts) — se réinitialise
// à chaque nouveau lot de suggestions (watch ci-dessous, même référence de
// tableau que EditorPane.vue utilise pour réarmer son propre compteur de
// snapshot, voir son commentaire).
import { computed, ref, watch } from 'vue'
import { useAiStore } from '../stores/ai'
import { useUiStore } from '../stores/ui'

const TYPE_LABELS: Record<string, string> = {
  repetition: 'Répétition',
  incoherence: 'Incohérence',
  style: 'Style',
  orthographe: 'Orthographe'
}

type SuggestionStatus = 'pending' | 'applied' | 'dismissed' | 'notFound'

const ai = useAiStore()
const ui = useUiStore()

const statuses = ref<SuggestionStatus[]>([])

watch(
  () => ai.reviewSuggestions,
  (list) => {
    statuses.value = list.map(() => 'pending')
  },
  { immediate: true }
)

// Bandeau « Snapshot pris avant la première application » (brief) : affiché
// dès qu'AU MOINS une suggestion de ce lot a été appliquée avec succès — pas
// avant, un snapshot n'existe alors pas encore (voir
// EditorPane.applySuggestionIntoEditor, qui le prend réellement).
const anyApplied = computed(() => statuses.value.some((status) => status === 'applied'))

// Garde locale contre le double-clic / double-application concurrente :
// une seule suggestion à la fois peut être en cours d'application (l'index
// en cours, ou null). Les autres boutons « Appliquer »/« Ignorer » restent
// désactivés tant qu'une application est en vol.
const applyingIndex = ref<number | null>(null)

async function apply(index: number): Promise<void> {
  if (applyingIndex.value !== null || statuses.value[index] !== 'pending') return
  applyingIndex.value = index
  try {
    const result = await ai.applySuggestion(index)
    if (result === 'applied') {
      statuses.value[index] = 'applied'
    } else if (result === 'not-found') {
      // Non bloquant (brief) : la citation ne correspond plus au texte
      // actuel (modifié entre-temps) — ligne marquée, pas de toast d'erreur.
      statuses.value[index] = 'notFound'
    } else {
      ui.toast('Impossible d’appliquer cette suggestion — chapitre indisponible.')
    }
  } catch (err) {
    console.error('Échec de l’application de la suggestion de relecture', err)
    ui.toast('Impossible d’appliquer cette suggestion.')
  } finally {
    applyingIndex.value = null
  }
}

function dismiss(index: number): void {
  if (statuses.value[index] !== 'pending') return
  statuses.value[index] = 'dismissed'
}
</script>

<template>
  <div class="review-panel">
    <p v-if="ai.reviewParseError" class="error-text">
      Réponse de relecture illisible — {{ ai.reviewParseError }}
    </p>
    <template v-else>
      <p v-if="ai.reviewMalformedCount > 0" class="hint">
        {{ ai.reviewMalformedCount }}
        suggestion{{ ai.reviewMalformedCount > 1 ? 's' : '' }} malformée{{
          ai.reviewMalformedCount > 1 ? 's' : ''
        }}
        ignorée{{ ai.reviewMalformedCount > 1 ? 's' : '' }}.
      </p>
      <p v-if="ai.reviewSuggestions.length === 0" class="hint">
        Aucune suggestion pour ce chapitre.
      </p>
    </template>
    <template v-if="!ai.reviewParseError && ai.reviewSuggestions.length > 0">
      <p v-if="anyApplied" class="review-banner">Snapshot pris avant la première application.</p>
      <ul class="review-list">
        <li
          v-for="(suggestion, index) in ai.reviewSuggestions"
          :key="index"
          class="review-item"
          :class="`status-${statuses[index]}`"
        >
          <div class="review-item-head">
            <span class="review-badge">{{ TYPE_LABELS[suggestion.type] ?? suggestion.type }}</span>
            <span v-if="statuses[index] === 'notFound'" class="review-status status-notfound">
              Introuvable (texte modifié)
            </span>
            <span v-else-if="statuses[index] === 'applied'" class="review-status status-applied">
              Appliqué
            </span>
            <span v-else-if="statuses[index] === 'dismissed'" class="review-status">Ignoré</span>
          </div>

          <p class="review-text">
            <span class="review-quote">{{ suggestion.quote }}</span>
            <span class="review-arrow">→</span>
            <span v-if="suggestion.replacement" class="review-replacement">
              {{ suggestion.replacement }}
            </span>
            <span v-else class="review-replacement review-deleted">(supprimé)</span>
          </p>
          <p class="review-reason">{{ suggestion.reason }}</p>

          <div v-if="statuses[index] === 'pending'" class="review-actions">
            <button
              type="button"
              class="primary"
              :disabled="applyingIndex !== null"
              @click="apply(index)"
            >
              {{ applyingIndex === index ? 'Application…' : 'Appliquer' }}
            </button>
            <button type="button" :disabled="applyingIndex !== null" @click="dismiss(index)">
              Ignorer
            </button>
          </div>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.review-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.review-banner {
  font-size: 12px;
  line-height: 1.5;
  color: var(--fg-muted);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
  border-radius: 8px;
  padding: 7px 10px;
}

.review-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.review-item {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 9px 10px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.review-item.status-applied {
  opacity: 0.6;
}
.review-item.status-dismissed {
  opacity: 0.45;
}

.review-item-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.review-badge {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border-radius: 100px;
  padding: 2px 8px;
}
.review-status {
  font-size: 11px;
  color: var(--fg-muted);
}
.review-status.status-applied {
  color: var(--accent);
  font-weight: 600;
}
.review-status.status-notfound {
  color: var(--danger);
}

.review-text {
  font-size: 13px;
  line-height: 1.5;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 5px;
}
.review-quote {
  color: var(--fg-muted);
  text-decoration: line-through;
}
.review-arrow {
  color: var(--fg-muted);
  font-size: 11px;
}
.review-replacement {
  color: var(--accent);
  font-weight: 600;
}
.review-deleted {
  font-style: italic;
  font-weight: 400;
}

.review-reason {
  font-size: 12px;
  line-height: 1.5;
  color: var(--fg-muted);
}

.review-actions {
  display: flex;
  gap: 6px;
  margin-top: 2px;
}
.review-actions button {
  font-size: 11.5px;
  padding: 5px 10px;
}
</style>
