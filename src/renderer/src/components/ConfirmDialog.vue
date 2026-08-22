<script setup lang="ts">
// Dialogue de confirmation thémé (audit UI/UX, proposition #13) : remplace
// les window.confirm() natifs (boîte système grise, libellés anglais, aucune
// transition) par la même coquille que les autres dialogues de l'app (overlay
// + .dialog-card, Transition name="dialog", piège de Tab façon
// FormatDialog/AutolinkDialog). Entièrement piloté par props/emit, sans état
// interne ni logique métier : l'appelant décide du message et de ce qui se
// passe sur confirm/cancel.
//
// Focus par défaut sur ANNULER, jamais sur le bouton destructif : ces cinq
// call sites remplacent des suppressions (chapitre, note, livre, snapshot…) —
// une pression réflexe sur Entrée juste après l'ouverture ne doit jamais
// déclencher la destruction. Entrée ne confirme que si le focus a été
// délibérément déplacé sur le bouton destructif (Tab, ou clic).
import { nextTick, onMounted, ref } from 'vue'

withDefaults(
  defineProps<{
    message: string
    confirmLabel?: string
    cancelLabel?: string
  }>(),
  {
    confirmLabel: 'Supprimer',
    cancelLabel: 'Annuler'
  }
)

const emit = defineEmits<{ confirm: []; cancel: [] }>()

const cardEl = ref<HTMLElement | null>(null)
const cancelBtn = ref<HTMLButtonElement | null>(null)

// Piège de focus identique à FormatDialog/AutolinkDialog : deux boutons de
// pied de page seulement ici, mais le principe (Tab ne doit jamais s'échapper
// vers la vue en arrière-plan) reste le même.
function trapTab(event: KeyboardEvent): void {
  const card = cardEl.value
  if (!card) return
  const focusables = Array.from(
    card.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex]:not([tabindex="-1"])')
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
    emit('cancel')
  } else if (event.key === 'Enter') {
    // Le focus par défaut est sur Annuler (voir onMounted) : Entrée y active
    // donc naturellement l'annulation tant que l'auteur n'a pas déplacé le
    // focus lui-même — aucune logique spéciale à écrire ici, le comportement
    // natif du <button> focusé suffit. On laisse donc l'événement suivre son
    // cours (pas de preventDefault/emit direct), contrairement aux autres
    // dialogues de l'app dont Entrée valide toujours la même action unique.
    return
  } else if (event.key === 'Tab') {
    trapTab(event)
  }
}

// Autofocus sur Annuler à l'ouverture — jamais sur le bouton destructif (voir
// commentaire d'en-tête).
onMounted(async () => {
  await nextTick()
  cancelBtn.value?.focus()
})
</script>

<template>
  <Transition name="dialog" appear>
    <div class="overlay" @click.self="emit('cancel')">
      <div
        ref="cardEl"
        class="confirm-card dialog-card"
        role="alertdialog"
        aria-modal="true"
        :aria-label="message"
        tabindex="-1"
        @keydown="onKeydown"
      >
        <p class="confirm-message">{{ message }}</p>
        <footer>
          <button ref="cancelBtn" type="button" class="ghost" @click="emit('cancel')">
            {{ cancelLabel }}
          </button>
          <button type="button" class="danger" @click="emit('confirm')">
            {{ confirmLabel }}
          </button>
        </footer>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.confirm-card {
  width: 380px;
  max-width: 100%;
  padding: 20px 20px 16px;
  gap: 16px;
}

.confirm-message {
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--fg);
}

footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.ghost {
  color: var(--fg-muted);
}

.danger {
  background: var(--danger);
  border-color: var(--danger);
  color: var(--bg);
}
.danger:hover:not(:disabled) {
  color: var(--bg);
  opacity: 0.9;
}
</style>
