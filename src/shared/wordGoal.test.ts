import { describe, it, expect } from 'vitest'
import { parseWordGoal } from './wordGoal'

describe('parseWordGoal', () => {
  it('accepte une saisie clavier sous forme de chaîne', () => {
    expect(parseWordGoal('5000')).toBe(5000)
    expect(parseWordGoal('  5000  ')).toBe(5000)
  })

  // Régression : sur un <input type="number">, Vue caste le v-model en NOMBRE.
  // L'ancien code appelait .trim() sur cette valeur, ce qui levait un
  // TypeError interrompant commitGoal AVANT l'appel IPC : l'objectif n'était
  // jamais écrit en base, et l'UI se refermait comme si tout allait bien.
  it('accepte un nombre, tel que le fournit v-model sur type=number', () => {
    expect(parseWordGoal(5000)).toBe(5000)
  })

  it('rend null sur une saisie vide, ce qui efface l’objectif', () => {
    expect(parseWordGoal('')).toBeNull()
    expect(parseWordGoal('   ')).toBeNull()
    expect(parseWordGoal(null)).toBeNull()
    expect(parseWordGoal(undefined)).toBeNull()
  })

  it('refuse zéro, le négatif et le non-numérique', () => {
    expect(parseWordGoal('0')).toBeNull()
    expect(parseWordGoal(0)).toBeNull()
    expect(parseWordGoal(-3)).toBeNull()
    expect(parseWordGoal('abc')).toBeNull()
    expect(parseWordGoal(Number.NaN)).toBeNull()
  })

  it('tronque un décimal vers l’entier inférieur', () => {
    expect(parseWordGoal('5000.9')).toBe(5000)
    expect(parseWordGoal(5000.9)).toBe(5000)
  })
})
