import { describe, it, expect } from 'vitest'
import { findNameMatches } from './autolink'

const targets = [
  { id: 1, kind: 'character', names: ['Mara', 'La Louve'] },
  { id: 2, kind: 'place', names: ['Brest'] },
  { id: 3, kind: 'character', names: ['Maracana'] }
]

describe('findNameMatches', () => {
  it('trouve avec frontières de mots et insensibilité accents/casse', () => {
    const text = 'mara arrive à BREST. Amarante reste.'
    const found = findNameMatches(text, targets)
    expect(found.map((m) => [m.entityId, m.matched])).toEqual([
      [1, 'mara'],
      [2, 'BREST']
    ])
  })

  it('préfère le nom le plus long sans chevauchement', () => {
    const found = findNameMatches('Maracana joue.', targets)
    expect(found).toHaveLength(1)
    expect(found[0].entityId).toBe(3)
  })

  it('matche les alias multi-mots', () => {
    const found = findNameMatches('On appelle la louve.', targets)
    expect(found.map((m) => m.entityId)).toEqual([1])
  })
})
