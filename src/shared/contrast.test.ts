import { describe, it, expect } from 'vitest'
import { contrastRatio, relativeLuminance } from './contrast'

describe('contrastRatio', () => {
  it('rend 21:1 entre noir et blanc, le maximum possible', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
  })

  it('rend 1:1 pour une couleur contre elle-même', () => {
    expect(contrastRatio('#4c5ec9', '#4c5ec9')).toBeCloseTo(1, 5)
  })

  it("est symétrique : l'ordre des arguments ne change rien", () => {
    expect(contrastRatio('#eff1f5', '#4c4f69')).toBeCloseTo(contrastRatio('#4c4f69', '#eff1f5'), 10)
  })

  it('applique bien la correction gamma (le vert pèse plus que le bleu)', () => {
    expect(relativeLuminance('#00ff00')).toBeGreaterThan(relativeLuminance('#0000ff'))
  })
})
