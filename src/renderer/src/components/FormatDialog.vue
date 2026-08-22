<script setup lang="ts">
// Dialogue avant/après de l'harmonisation de mise en forme (Task 6) : monté
// par ClaudePanel dès que `ai.phase === 'done' && ai.task === 'format'` (voir
// son template) — se referme de lui-même dès que phase quitte 'done' (nouvel
// harmonisation lancée, chapitre changé — prepare() reset la phase, ou
// abandon/application ci-dessous). Même langage modal qu'ExportDialog
// (overlay + carte, Échap intercepté, focus programmatique à l'ouverture,
// piège de Tab), mais deux colonnes scrollées en PARALLÈLE plutôt qu'un
// formulaire : PAS un diff mot à mot en v1 (brief) — deux panneaux
// comparables suffisent pour que l'auteur vérifie que seul le formatage a
// changé, jamais le texte.
//
// Entièrement pilotée par le store ai (pas de props/emit) : « Abandonner »
// appelle ai.reset() (aucune écriture, phase revient à 'idle' — le bouton
// « Harmoniser ce chapitre » redevient disponible) ; « Appliquer » délègue à
// ai.applyFormat() (sanitisation défensive, conversion IPC, snapshot 'avant
// harmonisation' + setContent + saveContentFor via EditorPane — voir
// stores/ai.ts et EditorPane.applyFormatIntoEditor), qui reset() lui-même la
// session en cas de succès (referme donc ce dialogue).
import { computed, nextTick, onMounted, ref } from 'vue'
import { useAiStore, sanitizeFormatOutput } from '../stores/ai'
import { useBookStore } from '../stores/book'
import { useUiStore } from '../stores/ui'

const ai = useAiStore()
const store = useBookStore()
const ui = useUiStore()

const cardEl = ref<HTMLElement | null>(null)
const applying = ref(false)

// « Avant » : le texte ACTUEL du chapitre tel qu'affiché/enregistré (pas le
// JSON TipTap — une comparaison texte contre texte est plus lisible que texte
// contre Markdown pour vérifier qu'aucun mot n'a changé).
const current = computed(() => store.currentChapter?.contentText ?? '')
// « Après » : le Markdown renvoyé par le modèle, MÊME sanitisation
// (sanitizeFormatOutput : fences + préambule/écho de titre) qu'à l'application
// réelle (ai.applyFormat, sur le même ai.draft) — l'auteur doit relire
// EXACTEMENT ce qui sera converti et appliqué, jamais un texte encore
// enveloppé de ``` ou précédé d'une phrase d'annonce que l'application, elle,
// aurait retirée (preview et résultat ne doivent jamais diverger).
const proposed = computed(() => sanitizeFormatOutput(ai.draft))

async function apply(): Promise<void> {
  if (applying.value) return
  applying.value = true
  try {
    const ok = await ai.applyFormat()
    if (!ok) ui.toast('Application impossible pour ce chapitre.')
  } catch (err) {
    console.error('Échec de l’application de la mise en forme', err)
    ui.toast('Impossible d’appliquer la mise en forme.')
  } finally {
    applying.value = false
  }
}

function abandon(): void {
  if (applying.value) return
  ai.reset()
}

// Piège de focus identique à ExportDialog : plusieurs contrôles par carte
// (deux boutons de pied de page ici), Tab doit continuer à circuler entre eux
// sans jamais s'échapper vers la vue en arrière-plan.
function trapTab(event: KeyboardEvent): void {
  const card = cardEl.value
  if (!card) return
  const focusables = Array.from(
    card.querySelectorAll<HTMLElement>(
      'button:not(:disabled), [tabindex]:not([tabindex="-1"])'
    )
  )
  if (focusables.length === 0) return
  const first = focusables[0]
  const last = focusables[focusables.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    abandon()
  } else if (event.key === 'Tab') {
    trapTab(event)
  }
}

onMounted(async () => {
  await nextTick()
  cardEl.value?.focus()
})
</script>

<template>
  <Transition name="dialog" appear>
  <div class="overlay" @click.self="abandon">
    <div
      ref="cardEl"
      class="format-card dialog-card"
      role="dialog"
      aria-modal="true"
      aria-label="Harmonisation de mise en forme"
      tabindex="-1"
      @keydown="onKeydown"
    >
      <header>
        <h2>Harmonisation de mise en forme</h2>
        <span class="kbd">Échap</span>
      </header>

      <p class="format-guard">
        Vérifiez que le texte n'a pas été modifié — seul le formatage doit changer.
      </p>

      <div class="format-columns">
        <section class="format-col">
          <span class="field-label">Avant</span>
          <div class="format-text">{{ current }}</div>
        </section>
        <section class="format-col">
          <span class="field-label">Après (proposé)</span>
          <div class="format-text">{{ proposed }}</div>
        </section>
      </div>

      <footer>
        <button type="button" class="ghost" :disabled="applying" @click="abandon">
          Abandonner
        </button>
        <button type="button" class="primary" :disabled="applying" @click="apply">
          <span v-if="applying" class="spinner" aria-hidden="true"></span>
          {{ applying ? 'Application…' : 'Appliquer' }}
        </button>
      </footer>
    </div>
  </div>
  </Transition>
</template>

<style scoped>
.format-card {
  width: 900px;
  max-width: 100%;
  max-height: 85vh;
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
header h2 {
  font-size: 14px;
  font-weight: 600;
}

.format-guard {
  flex-shrink: 0;
  margin: 12px 16px 0;
  padding: 8px 10px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--danger) 30%, transparent);
  border-radius: 8px;
}

.format-columns {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 14px;
  padding: 14px 16px;
  overflow: hidden;
}
.format-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.field-label {
  flex-shrink: 0;
}
.format-text {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 14px;
  font-family: var(--font-manuscript);
  font-size: 13.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}
.ghost {
  color: var(--fg-muted);
}

@media (max-width: 640px) {
  .format-columns {
    flex-direction: column;
    overflow-y: auto;
  }
  .format-text {
    min-height: 160px;
  }
}
</style>
