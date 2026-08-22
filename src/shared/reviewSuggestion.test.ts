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
    const { quote: _quote, ...withoutQuote } = VALID
    expect(isValidReviewSuggestion(withoutQuote)).toBe(false)
    const { replacement: _replacement, ...withoutReplacement } = VALID
    expect(isValidReviewSuggestion(withoutReplacement)).toBe(false)
    const { reason: _reason, ...withoutReason } = VALID
    expect(isValidReviewSuggestion(withoutReason)).toBe(false)
    const { type: _type, ...withoutType } = VALID
    expect(isValidReviewSuggestion(withoutType)).toBe(false)
  })

  it('rejette une citation vide', () => {
    expect(isValidReviewSuggestion({ ...VALID, quote: '' })).toBe(false)
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
