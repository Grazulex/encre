import { describe, it, expect } from 'vitest'
import { normalizeForSearch } from './textNormalize'

describe('normalizeForSearch', () => {
  it('retire les accents et met en minuscules', () => {
    expect(normalizeForSearch('Éléonore')).toBe('eleonore')
    expect(normalizeForSearch('brest')).toBe('brest')
  })
})
