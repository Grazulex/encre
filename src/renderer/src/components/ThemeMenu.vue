<script setup lang="ts">
import { ref } from 'vue'
import { useThemeStore } from '../stores/theme'
import {
  ACCENT_LABELS,
  THEME_LABELS,
  accentPour,
  type AccentScope,
  type ThemeScope
} from '../../../shared/palettes'

// Sélecteur global de thème (saveurs Catppuccin incl. la bascule clair/sombre)
// et d'accent, mémorisés durablement par le store. Suffit à l'utilisateur qui
// passe ses journées dans l'app : posé dans la bibliothèque et dans l'espace
// livre, toujours à portée (thème = préférence globale, pas par livre — pas de
// persistence côté base, volontairement).
const store = useThemeStore()
const open = ref(false)

// Côté d'ouverture du popover : dans la bibliothèque le bouton est à droite
// de la fenêtre (ouvert à droite) ; dans l'aside de l'espace livre il est au
// bord gauche — on l'ouvre alors au-dessus de la zone d'édition plutôt que
// hors fenêtre.
defineProps<{ align?: 'right' | 'left' }>()

const THEMES = Object.keys(THEME_LABELS) as ThemeScope[]
const ACCENTS = Object.keys(ACCENT_LABELS) as AccentScope[]

function preview(accent: AccentScope): string {
  // L'aperçu suit la saveur active (les accents sombres diffèrent de Latte).
  return accentPour(store.saveurActive(), accent).brut
}

function pickTheme(theme: ThemeScope): void {
  store.setTheme(theme)
  open.value = false
}

function pickAccent(accent: AccentScope): void {
  store.setAccent(accent)
  open.value = false
}
</script>

<template>
  <div class="theme-menu" :class="{ 'open-left': align === 'left' }">
    <button
      type="button"
      class="trigger"
      :class="{ active: open }"
      title="Thème et couleur d'accent"
      aria-label="Thème et couleur d'accent"
      aria-haspopup="true"
      :aria-expanded="open"
      @click="open = !open"
    >
      <svg
        viewBox="0 0 20 20"
        width="17"
        height="17"
        fill="none"
        stroke="var(--border)"
        stroke-width="1"
        aria-hidden="true"
      >
        <circle cx="10" cy="10" r="8.5" fill="var(--bg)" />
        <path
          d="M10 1.5 a8.5 8.5 0 0 0 0 17 a4.25 4.25 0 0 1 0 -8.5 z"
          fill="var(--accent)"
          stroke="var(--border)"
        />
      </svg>
    </button>

    <Transition name="pop">
      <div v-if="open">
        <div class="backdrop" @click="open = false"></div>
        <div class="popover dialog-card" role="menu" aria-label="Thème et accent">
          <div class="panel">
            <div class="group">
              <p class="field-label">Thème</p>
              <div class="row" role="group">
                <button
                  v-for="theme in THEMES"
                  :key="theme"
                  type="button"
                  class="choice"
                  :class="{ selected: store.theme === theme }"
                  role="menuitemradio"
                  :aria-checked="store.theme === theme"
                  @click="pickTheme(theme)"
                >
                  {{ THEME_LABELS[theme] }}
                </button>
              </div>
            </div>
            <div class="group">
              <p class="field-label">Accent</p>
              <div class="row accent-row" role="group">
                <button
                  v-for="accent in ACCENTS"
                  :key="accent"
                  type="button"
                  class="choice accent"
                  :class="{ selected: store.accent === accent }"
                  role="menuitemradio"
                  :aria-checked="store.accent === accent"
                  :title="ACCENT_LABELS[accent]"
                  :aria-label="ACCENT_LABELS[accent]"
                  @click="pickAccent(accent)"
                >
                  <span class="dot" :style="{ background: preview(accent) }"></span>
                  {{ ACCENT_LABELS[accent] }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.trigger {
  border: 1px solid var(--border);
  border-radius: var(--radius-s);
  width: 30px;
  height: 30px;
  padding: 0;
  display: grid;
  place-items: center;
  background: var(--bg-panel);
}
.trigger.active {
  border-color: var(--accent);
  color: var(--accent);
}
.theme-menu {
  position: relative;
  -webkit-app-region: no-drag;
}

/* Clic hors menu : un fond transparent plein écran sous le popover, plutôt
   qu'un écouteur document — rien à désabonner, la vue est éphémère. */
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 290;
}
.popover {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 300;
  width: 236px;
  padding: 12px;
}
/* Mode aside de l'espace livre : ouvert côté gauche-soulevant au lieu de
   filer hors fenêtre. */
.open-left .popover {
  right: auto;
  left: 0;
}
.panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.choice {
  border: 1px solid var(--border);
  border-radius: var(--radius-s);
  padding: 4px 9px;
  font-size: 12px;
  color: var(--fg-muted);
}
.choice:hover {
  color: var(--fg);
  border-color: var(--fg-muted);
}
.choice.selected {
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}
.accent {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.pop-enter-active,
.pop-leave-active {
  transition: opacity 0.12s ease;
}
.pop-enter-active .popover,
.pop-leave-active .popover {
  transition:
    opacity 0.12s ease,
    transform 0.12s ease;
}
.pop-enter-from .popover,
.pop-leave-to .popover {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}
</style>
