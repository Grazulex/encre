import { describe, it, expect } from 'vitest'
import { isValidChronoIssue, filterChronoIssueIds } from './chronoIssue'

const VALID = {
  severity: 'incoherence',
  description: 'Le chapitre 3 se déroule avant l’événement qu’il raconte.',
  chapterIds: [3],
  eventIds: [7]
}

describe('isValidChronoIssue', () => {
  it('accepte une incohérence complète et bien formée', () => {
    expect(isValidChronoIssue(VALID)).toBe(true)
  })

  it.each(['incoherence', 'doute'])('accepte chacune des 2 valeurs de severity (%s)', (severity) => {
    expect(isValidChronoIssue({ ...VALID, severity })).toBe(true)
  })

  it('accepte des tableaux d’ids vides (incohérence ne portant que sur des chapitres, ou que sur des événements)', () => {
    expect(isValidChronoIssue({ ...VALID, chapterIds: [] })).toBe(true)
    expect(isValidChronoIssue({ ...VALID, eventIds: [] })).toBe(true)
    expect(isValidChronoIssue({ ...VALID, chapterIds: [], eventIds: [] })).toBe(true)
  })

  it('rejette une valeur de severity hors énumération', () => {
    expect(isValidChronoIssue({ ...VALID, severity: 'erreur' })).toBe(false)
  })

  it('rejette un champ manquant', () => {
    const { severity: _severity, ...withoutSeverity } = VALID
    expect(isValidChronoIssue(withoutSeverity)).toBe(false)
    const { description: _description, ...withoutDescription } = VALID
    expect(isValidChronoIssue(withoutDescription)).toBe(false)
    const { chapterIds: _chapterIds, ...withoutChapterIds } = VALID
    expect(isValidChronoIssue(withoutChapterIds)).toBe(false)
    const { eventIds: _eventIds, ...withoutEventIds } = VALID
    expect(isValidChronoIssue(withoutEventIds)).toBe(false)
  })

  it('rejette une description vide', () => {
    expect(isValidChronoIssue({ ...VALID, description: '   ' })).toBe(false)
  })

  it('rejette un champ du mauvais type', () => {
    expect(isValidChronoIssue({ ...VALID, chapterIds: ['3'] })).toBe(false)
    expect(isValidChronoIssue({ ...VALID, eventIds: 7 })).toBe(false)
    expect(isValidChronoIssue({ ...VALID, description: 42 })).toBe(false)
  })

  it('rejette les non-objets', () => {
    expect(isValidChronoIssue(null)).toBe(false)
    expect(isValidChronoIssue(undefined)).toBe(false)
    expect(isValidChronoIssue('une chaîne')).toBe(false)
    expect(isValidChronoIssue(42)).toBe(false)
    expect(isValidChronoIssue([])).toBe(false)
  })
})

describe('filterChronoIssueIds', () => {
  const issue = { severity: 'incoherence' as const, description: 'Test.', chapterIds: [1, 2, 3], eventIds: [10, 11] }

  it('conserve tous les ids connus, ne retire rien', () => {
    const known = new Set([1, 2, 3])
    const knownEvents = new Set([10, 11])
    const { issue: filtered, removedIdCount } = filterChronoIssueIds(issue, known, knownEvents)
    expect(filtered.chapterIds).toEqual([1, 2, 3])
    expect(filtered.eventIds).toEqual([10, 11])
    expect(removedIdCount).toBe(0)
  })

  it('retire les chapterIds/eventIds inconnus et les compte', () => {
    const known = new Set([1, 3])
    const knownEvents = new Set([11])
    const { issue: filtered, removedIdCount } = filterChronoIssueIds(issue, known, knownEvents)
    expect(filtered.chapterIds).toEqual([1, 3])
    expect(filtered.eventIds).toEqual([11])
    expect(removedIdCount).toBe(2)
  })

  it('conserve la description et la severity inchangées', () => {
    const { issue: filtered } = filterChronoIssueIds(issue, new Set(), new Set())
    expect(filtered.description).toBe('Test.')
    expect(filtered.severity).toBe('incoherence')
    expect(filtered.chapterIds).toEqual([])
    expect(filtered.eventIds).toEqual([])
  })
})
