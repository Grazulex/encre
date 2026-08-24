import { describe, it, expect } from 'vitest'
import { contrastRatio, AA_TEXTE_NORMAL } from './contrast'
import {
  SAVEURS,
  ACCENT_LABELS,
  THEME_LABELS,
  accentPour,
  statutPour,
  type AccentScope,
  type StatusScope,
  type ThemeSaveur
} from './palettes'

/**
 * Même garde-fou que theme.test.ts, étendu à la palette RUNTIME (les 4 saveurs
 * + chaque accent + les pastilles de statut). theme.test.ts relit le CSS de
 * fallback (Latte/Frappé) ; celui-ci teste les mêmes paires sur le module de
 * vérité utilisé par le store de thème — une valeur qui repasserait sous le
 * seuil chez l'utilisateur échouera ici, quel que soit le thème choisi.
 *
 * Les corollaires sont en fait identiques à la vérification du CSS : sur les
 * saveurs sombres les accents bruts Catppuccin passent AA ; sur Latte ils ont
 * été assombris à teinte constante (voir les commentaires de palettes.ts).
 */
const SAVEUR_NAMES = Object.keys(SAVEURS) as ThemeSaveur[]
const ACCENT_NAMES = Object.keys(ACCENT_LABELS) as AccentScope[]

describe('palettes Catppuccin (runtime)', () => {
  it('expose les 5 choix de saveur et 6 accents', () => {
    expect(Object.keys(THEME_LABELS)).toEqual(['system', 'latte', 'frappe', 'macchiato', 'mocha'])
    expect(ACCENT_NAMES).toHaveLength(6)
  })

  it.each(SAVEUR_NAMES)('textes de base AA sur %s', (saveur) => {
    const p = SAVEURS[saveur]
    const paires: [string, string][] = [
      [p.fg, p.bg],
      [p.fg, p.bgPanel],
      [p.fgMuted, p.bg],
      [p.fgMuted, p.bgPanel],
      [p.danger, p.bg],
      [p.danger, p.bgPanel]
    ]
    for (const [texte, fond] of paires) {
      const r = contrastRatio(texte, fond)
      expect(r, `${texte} sur ${fond} ne rend que ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        AA_TEXTE_NORMAL
      )
    }
  })

  it.each(SAVEUR_NAMES)('accent AA sur %s pour chaque accent choisi', (saveur) => {
    for (const accent of ACCENT_NAMES) {
      const texte = accentPour(saveur, accent).texte
      for (const fond of [SAVEURS[saveur].bg, SAVEURS[saveur].bgPanel]) {
        const r = contrastRatio(texte, fond)
        expect(
          r,
          `${accent} (${texte}) sur ${fond} ne rend que ${r.toFixed(2)}:1`
        ).toBeGreaterThanOrEqual(AA_TEXTE_NORMAL)
      }
    }
  })

  it.each(SAVEUR_NAMES)('pastilles de statut AA sur %s', (saveur) => {
    const statuts = ['reserve', 'en_cours', 'termine', 'archive'] as StatusScope[]
    for (const statut of statuts) {
      const texte = statutPour(saveur, statut)
      for (const fond of [SAVEURS[saveur].bg, SAVEURS[saveur].bgPanel]) {
        const r = contrastRatio(texte, fond)
        expect(
          r,
          `${statut} (${texte}) sur ${fond} ne rend que ${r.toFixed(2)}:1`
        ).toBeGreaterThanOrEqual(AA_TEXTE_NORMAL)
      }
    }
  })
})
