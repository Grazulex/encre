import { defineStore } from 'pinia'
import {
  SAVEURS,
  accentPour,
  statutPour,
  type AccentScope,
  type StatusScope,
  type ThemeSaveur,
  type ThemeScope
} from '../../../shared/palettes'

// Préférences DURABLES (localStorage), contrairement au filtre de la
// bibliothèque qui est mémorisé en sessionStorage : un thème qu'on a choisi
// n'a pas à être re-choisi à chaque lancement. Même idiome de secours que
// ClaudePanel (lecture une seule fois au démarrage, localStorage peut lever
// en contexte restreint — les défauts couvrent le cas et l'absence de clé).
const THEME_KEY = 'encre.theme'
const ACCENT_KEY = 'encre.accent'

function lirePref<T extends string>(key: string, défaut: T, valeurs: readonly T[]): T {
  try {
    const value = localStorage.getItem(key)
    return value && (valeurs as readonly string[]).includes(value) ? (value as T) : défaut
  } catch {
    return défaut
  }
}

const THEMES: readonly ThemeScope[] = ['system', 'latte', 'frappe', 'macchiato', 'mocha']
const ACCENTS: readonly AccentScope[] = ['lavender', 'blue', 'teal', 'mauve', 'peach', 'green']

export const useThemeStore = defineStore('theme', {
  state: () => ({
    theme: lirePref<ThemeScope>(THEME_KEY, 'system', THEMES),
    accent: lirePref<AccentScope>(ACCENT_KEY, 'lavender', ACCENTS)
  }),
  actions: {
    // Résout la saveur effective : « system » suit macOS (Latte en clair,
    // Frappé en sombre — le comportement historique avant le sélecteur).
    saveurActive(): ThemeSaveur {
      if (this.theme !== 'system') return this.theme
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'frappe' : 'latte'
    },
    // Pose les variables CSS une bonne fois, depuis palettes.ts (la source de
    // vérité du runtime ; theme.css ne sert plus que de fallback). data-theme/
    // data-accent pour le debugging et d'éventuels styles CSS ciblés.
    apply(): void {
      const saveur = this.saveurActive()
      const base = SAVEURS[saveur]
      const root = document.documentElement
      root.dataset.theme = saveur
      root.dataset.accent = this.accent
      const css: Record<string, string> = {
        '--bg': base.bg,
        '--bg-panel': base.bgPanel,
        '--fg': base.fg,
        '--fg-muted': base.fgMuted,
        '--accent': accentPour(saveur, this.accent).texte,
        '--border': base.border,
        '--danger': base.danger
      }
      for (const statut of ['reserve', 'en_cours', 'termine', 'archive'] as const) {
        css[`--status-${statut}`] = statutPour(saveur, statut as StatusScope)
      }
      for (const [variable, valeur] of Object.entries(css)) {
        root.style.setProperty(variable, valeur)
      }
    },
    // À appeler une seule fois au boot (main.ts), avant le montage : pose le
    // thème puis suit les changements de préférence système tant que le mode
    // « system » est actif.
    init(): () => void {
      this.apply()
      const mql = window.matchMedia('(prefers-color-scheme: dark)')
      const onSystemChange = (): void => {
        if (this.theme === 'system') this.apply()
      }
      mql.addEventListener('change', onSystemChange)
      return () => mql.removeEventListener('change', onSystemChange)
    },
    setTheme(theme: ThemeScope): void {
      this.theme = theme
      try {
        localStorage.setItem(THEME_KEY, theme)
      } catch {
        // préférence durable indisponible : le thème reste actif pour la
        // session en mémoire.
      }
      this.apply()
    },
    setAccent(accent: AccentScope): void {
      this.accent = accent
      try {
        localStorage.setItem(ACCENT_KEY, accent)
      } catch {
        // idem
      }
      this.apply()
    }
  }
})
