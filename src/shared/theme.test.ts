import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { contrastRatio, AA_TEXTE_NORMAL } from './contrast'

/**
 * Garde-fou d'accessibilité sur la palette.
 *
 * La bascule vers Catppuccin a failli livrer un `--accent` à 2,81:1 — les
 * accents Catppuccin sont calibrés pour du remplissage, alors qu'ici --accent
 * est d'abord une couleur de texte. Ce test relit les valeurs réelles du
 * fichier de thème plutôt que des constantes recopiées : une palette future
 * qui repasserait sous le seuil échouera ici, pas chez l'utilisateur.
 */
const CSS = readFileSync(join(__dirname, '../renderer/src/styles/theme.css'), 'utf8')

/** Extrait les variables de couleur d'un bloc `:root` (clair) ou du bloc sombre. */
function palette(sombre: boolean): Record<string, string> {
  const debut = sombre ? CSS.indexOf('prefers-color-scheme: dark') : 0
  const fin = sombre ? CSS.length : CSS.indexOf('prefers-color-scheme: dark')
  const bloc = CSS.slice(debut, fin)
  const vars: Record<string, string> = {}
  for (const m of bloc.matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    vars[m[1]] = m[2]
  }
  return vars
}

// Chaque paire est un usage réel : du texte de cette couleur sur ce fond.
const PAIRES: [string, string][] = [
  ['fg', 'bg'],
  ['fg', 'bg-panel'],
  ['fg-muted', 'bg'],
  ['fg-muted', 'bg-panel'],
  ['accent', 'bg'],
  ['accent', 'bg-panel'],
  ['danger', 'bg'],
  ['danger', 'bg-panel']
]

describe.each([
  ['clair (Latte)', false],
  ['sombre (Frappé)', true]
])('palette %s', (_nom, sombre) => {
  const p = palette(sombre)

  it('définit toutes les couleurs attendues', () => {
    for (const nom of ['bg', 'bg-panel', 'fg', 'fg-muted', 'accent', 'border', 'danger']) {
      expect(p[nom], `--${nom} manquante`).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })

  it.each(PAIRES)('--%s sur --%s atteint le seuil AA', (texte, fond) => {
    const r = contrastRatio(p[texte], p[fond])
    expect(
      r,
      `--${texte} (${p[texte]}) sur --${fond} (${p[fond]}) ne rend que ${r.toFixed(2)}:1`
    ).toBeGreaterThanOrEqual(AA_TEXTE_NORMAL)
  })
})
