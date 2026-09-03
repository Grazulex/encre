import { describe, it, expect } from 'vitest'
import { isValidReviewSuggestion } from './reviewSuggestion'

const VALID = {
  type: 'style',
  quote: 'il marcha lentement',
  replacement: 'il avança lentement',
  reason: 'Répétition du verbe marcher.'
}

describe('isValidReviewSuggestion', () => {
  it('accepte une suggestion complète et bien formée', () => {
    expect(isValidReviewSuggestion(VALID)).toBe(true)
  })

  it('accepte replacement vide (suppression)', () => {
    expect(isValidReviewSuggestion({ ...VALID, replacement: '' })).toBe(true)
  })

  it.each(['repetition', 'incoherence', 'style', 'orthographe'])(
    'accepte chacune des 4 valeurs de type (%s)',
    (type) => {
      expect(isValidReviewSuggestion({ ...VALID, type })).toBe(true)
    }
  )

  it('rejette une valeur de type hors énumération', () => {
    expect(isValidReviewSuggestion({ ...VALID, type: 'grammaire' })).toBe(false)
  })

  it('rejette un champ manquant', () => {
    const sansChamp = (champ: string): unknown => {
      const copie: Record<string, unknown> = { ...VALID }
      delete copie[champ]
      return copie
    }
    expect(isValidReviewSuggestion(sansChamp('quote'))).toBe(false)
    expect(isValidReviewSuggestion(sansChamp('replacement'))).toBe(false)
    expect(isValidReviewSuggestion(sansChamp('reason'))).toBe(false)
    expect(isValidReviewSuggestion(sansChamp('type'))).toBe(false)
  })

  it('rejette une citation vide', () => {
    expect(isValidReviewSuggestion({ ...VALID, quote: '' })).toBe(false)
  })

  it('rejette une citation composée uniquement d’espaces (correctif M2)', () => {
    expect(isValidReviewSuggestion({ ...VALID, quote: ' ' })).toBe(false)
  })

  it('rejette un champ du mauvais type', () => {
    expect(isValidReviewSuggestion({ ...VALID, quote: 42 })).toBe(false)
    expect(isValidReviewSuggestion({ ...VALID, replacement: null })).toBe(false)
  })

  it('rejette les non-objets', () => {
    expect(isValidReviewSuggestion(null)).toBe(false)
    expect(isValidReviewSuggestion(undefined)).toBe(false)
    expect(isValidReviewSuggestion('une chaîne')).toBe(false)
    expect(isValidReviewSuggestion(42)).toBe(false)
    expect(isValidReviewSuggestion([])).toBe(false)
  })
})
