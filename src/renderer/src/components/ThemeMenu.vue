<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
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
// bord gauche — on l'ouvre alors vers la droite, au-dessus de la zone d'édition.
const props = defineProps<{ align?: 'right' | 'left' }>()

// Le popover est TÉLÉPORTÉ dans <body> et positionné en `fixed`. En `absolute`
// dans le flux du composant, il était rogné net par l'`overflow: hidden` de
// l'aside de l'espace livre (BookView.vue) : aucun z-index n'y peut rien, un
// ancêtre qui rogne rogne. Le téléport le sort de cet ancêtre ; les variables
// de thème vivant sur `:root`, la carte garde ses couleurs.
const LARGEUR = 236
const trigger = ref<HTMLButtonElement | null>(null)
const popover = ref<HTMLElement | null>(null)
const pos = ref({ top: 0, left: 0 })

function placer(): void {
  const t = trigger.value?.getBoundingClientRect()
  if (!t) return
  const marge = 8
  const hauteur = popover.value?.offsetHeight ?? 0
  const vise = props.align === 'left' ? t.left : t.right - LARGEUR
  // Rabattu dans la fenêtre : l'aside de l'espace livre est redimensionnable,
  // le bouton peut donc tomber n'importe où — le popover ne doit jamais sortir
  // de l'écran, ni à gauche ni à droite.
  const left = Math.min(Math.max(marge, vise), window.innerWidth - LARGEUR - marge)
  let top = t.bottom + marge
  if (hauteur > 0 && top + hauteur > window.innerHeight - marge) {
    // Pas la place dessous : on bascule au-dessus du bouton.
    top = Math.max(marge, t.top - hauteur - marge)
  }
  pos.value = { top, left }
}

async function basculer(): Promise<void> {
  if (open.value) {
    open.value = false
    return
  }
  placer() // première passe : évite un affichage à (0,0) le temps d'une frame
  open.value = true
  await nextTick()
  placer() // seconde passe : la hauteur réelle est connue, on peut rabattre
}

function surRedimensionnement(): void {
  if (open.value) placer()
}
onMounted(() => window.addEventListener('resize', surRedimensionnement))
onBeforeUnmount(() => window.removeEventListener('resize', surRedimensionnement))

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
  <div class="theme-menu">
    <button
      ref="trigger"
      type="button"
      class="trigger"
      :class="{ active: open }"
      title="Thème et couleur d'accent"
      aria-label="Thème et couleur d'accent"
      aria-haspopup="true"
      :aria-expanded="open"
      @click="basculer"
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

    <Teleport to="body">
      <Transition name="pop">
        <div v-if="open">
          <div class="backdrop" @click="open = false"></div>
          <div
            ref="popover"
            class="popover dialog-card"
            role="menu"
            aria-label="Thème et accent"
            :style="{ top: `${pos.top}px`, left: `${pos.left}px` }"
          >
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
    </Teleport>
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
/* `fixed` et non `absolute` : le popover est téléporté dans <body>, ses
   coordonnées sont calculées depuis le bouton (voir placer()). C'est ce qui le
   met hors de portée de l'`overflow: hidden` de l'aside, qui le tronquait. La
   largeur doit rester d'accord avec LARGEUR dans le script. */
.popover {
  position: fixed;
  z-index: 300;
  width: 236px;
  padding: 12px;
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
