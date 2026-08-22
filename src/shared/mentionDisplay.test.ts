import { describe, it, expect } from 'vitest'
import { kindLabelFr, mentionDisplayText, mentionTooltip } from './mentionDisplay'
import type { Entity } from './types'

const entity = (overrides: Partial<Entity> = {}): Entity => ({
  id: 1,
  bookId: 1,
  kind: 'place',
  name: 'calle Predicadors',
  aliases: [],
  ...overrides
}) as Entity

describe('mentionDisplayText', () => {
  it("affiche le label stocké verbatim, même s'il ne correspond à aucun alias", () => {
    // Cas du bug rapporté : « L'appartement » n'est pas un alias de l'entité
    // mais reste le texte du manuscrit à afficher tel quel.
    expect(mentionDisplayText({ label: "L'appartement" })).toBe("L'appartement")
  })

  it('rend une chaîne vide si le label est absent ou vide (repli côté appelant)', () => {
    expect(mentionDisplayText({ label: undefined })).toBe('')
    expect(mentionDisplayText({ label: null })).toBe('')
    expect(mentionDisplayText({ label: '' })).toBe('')
  })
})

describe('mentionTooltip', () => {
  it("donne le nom courant et le type en français pour une entité existante", () => {
    expect(mentionTooltip(entity({ name: 'calle Predicadors', kind: 'place' }))).toBe(
      'calle Predicadors — lieu'
    )
    expect(mentionTooltip(entity({ name: 'Mara', kind: 'character' }))).toBe('Mara — personnage')
  })

  it('rend une chaîne vide si l’entité est introuvable (supprimée)', () => {
    expect(mentionTooltip(undefined)).toBe('')
    expect(mentionTooltip(null)).toBe('')
  })
})

describe('kindLabelFr', () => {
  it('mappe les types connus vers leur libellé français', () => {
    expect(kindLabelFr('character')).toBe('personnage')
    expect(kindLabelFr('place')).toBe('lieu')
  })

  it('replie sur "entité" pour un type inconnu/absent', () => {
    expect(kindLabelFr(null)).toBe('entité')
    expect(kindLabelFr(undefined)).toBe('entité')
  })
})
