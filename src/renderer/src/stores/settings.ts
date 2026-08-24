import { defineStore } from 'pinia'

// Confort d'écriture de l'éditeur (taille du texte, interligne, largeur de
// colonne) : mémorisé durablement comme le thème (localStorage) — un confort
// qu'on règle une fois n'a pas à être réglé à chaque lancement. Même idiome
// de secours que theme.ts (lecture une seule fois au démarrage, localStorage
// peut lever en contexte restreint).
const KEYS = {
  fontSize: 'encre.editor.fontSize',
  lineHeight: 'encre.editor.lineHeight',
  colWidth: 'encre.editor.colWidth'
} as const

function lireNombre(key: string, defaut: number, min: number, max: number): number {
  try {
    const raw = localStorage.getItem(key)
    const valeur = raw === null ? NaN : Number.parseFloat(raw)
    return Number.isFinite(valeur) ? Math.min(max, Math.max(min, valeur)) : defaut
  } catch {
    return defaut
  }
}

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    editorFontSize: lireNombre(KEYS.fontSize, 18, 14, 22),
    editorLineHeight: lireNombre(KEYS.lineHeight, 1.75, 1.4, 2.2),
    editorColWidth: lireNombre(KEYS.colWidth, 40, 30, 48)
  }),
  actions: {
    setFontSize(px: number) {
      this.editorFontSize = px
      try {
        localStorage.setItem(KEYS.fontSize, String(px))
      } catch {
        // préférence durable indisponible : active pour la session en mémoire
      }
    },
    setLineHeight(value: number) {
      this.editorLineHeight = value
      try {
        localStorage.setItem(KEYS.lineHeight, String(value))
      } catch {
        // idem
      }
    },
    setColWidth(rem: number) {
      this.editorColWidth = rem
      try {
        localStorage.setItem(KEYS.colWidth, String(rem))
      } catch {
        // idem
      }
    },
    reset() {
      this.setFontSize(18)
      this.setLineHeight(1.75)
      this.setColWidth(40)
    }
  }
})
