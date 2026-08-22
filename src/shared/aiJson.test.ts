import { describe, it, expect } from 'vitest'
import { parseAiJson } from './aiJson'

describe('parseAiJson', () => {
  it('parse du JSON nu', () => {
    const result = parseAiJson<string[]>('["item1", "item2"]')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual(['item1', 'item2'])
    }
  })

  it('parse du JSON sous fences ```json', () => {
    const result = parseAiJson<string[]>('```json\n["item1", "item2"]\n```')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual(['item1', 'item2'])
    }
  })

  it('parse un préambule « Voici les suggestions : » + tableau', () => {
    const result = parseAiJson<string[]>('Voici les suggestions :\n\n["item1", "item2"]')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual(['item1', 'item2'])
    }
  })

  it('accepte un objet JSON', () => {
    const result = parseAiJson<{ key: string }>('{"key": "value"}')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({ key: 'value' })
    }
  })

  it('accepte un objet avec préambule', () => {
    const result = parseAiJson<{ key: string }>('Voici le résultat :\n\n{"key": "value"}')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({ key: 'value' })
    }
  })

  it('retourne {ok:false} quand il n\'y a pas de JSON', () => {
    const result = parseAiJson<unknown>('Ceci est du texte sans JSON')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeTruthy()
      expect(typeof result.error).toBe('string')
    }
  })

  it('retourne {ok:false} pour du JSON invalide (virgule traînante)', () => {
    const result = parseAiJson<unknown>('["item1", "item2",]')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeTruthy()
      expect(typeof result.error).toBe('string')
    }
  })

  it('tolère du JSON invalide enrobé de fences et retourne {ok:false}', () => {
    const result = parseAiJson<unknown>('```json\n{"key": "value",}\n```')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeTruthy()
    }
  })

  it('handle nested arrays correctly', () => {
    const result = parseAiJson<unknown>('Preamble [[1, 2], [3, 4]]')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual([[1, 2], [3, 4]])
    }
  })

  it('handle nested objects correctly', () => {
    const result = parseAiJson<unknown>('Preamble {"a": {"b": 1}}')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({ a: { b: 1 } })
    }
  })

  it('ne jette jamais une exception (défense contre throw)', () => {
    expect(() => {
      parseAiJson<unknown>('invalid json {]')
    }).not.toThrow()

    expect(() => {
      parseAiJson<unknown>('')
    }).not.toThrow()

    expect(() => {
      parseAiJson<unknown>(null as any)
    }).not.toThrow()
  })

  it('gère un JSON avec fences markdown et préambule', () => {
    const result = parseAiJson<string[]>('Voici les suggestions :\n\n```json\n["suggestion1", "suggestion2"]\n```')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual(['suggestion1', 'suggestion2'])
    }
  })

  it('retourne un message d\'erreur en français', () => {
    const result = parseAiJson<unknown>('pas de json ici')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/json|JSON|caractère/i)
    }
  })
})
