import { describe, it, expect } from 'vitest'
import {
  isValidExtractCreation,
  isValidExtractEnrichissement,
  filterExtractProposal,
  pairEnrichissementsWithEntities
} from './extractProposal'

const VALID_CREATION = {
  kind: 'character',
  name: 'Aldric',
  aliases: ['le vieux forgeron'],
  description: 'Forgeron du village, apparu au chapitre 3.'
}

const VALID_ENRICHISSEMENT = {
  entityId: 12,
  aliases: ['la reine'],
  description: 'A quitté le château après la trahison.',
  notes: 'Vérifier la cohérence avec le chapitre 1.'
}

describe('isValidExtractCreation', () => {
  it('accepte une création complète et bien formée', () => {
    expect(isValidExtractCreation(VALID_CREATION)).toBe(true)
  })

  it.each(['character', 'place'])('accepte chacune des 2 valeurs de kind (%s)', (kind) => {
    expect(isValidExtractCreation({ ...VALID_CREATION, kind })).toBe(true)
  })

  it('accepte aliases vide', () => {
    expect(isValidExtractCreation({ ...VALID_CREATION, aliases: [] })).toBe(true)
  })

  it('accepte description vide', () => {
    expect(isValidExtractCreation({ ...VALID_CREATION, description: '' })).toBe(true)
  })

  it('rejette une valeur de kind hors énumération', () => {
    expect(isValidExtractCreation({ ...VALID_CREATION, kind: 'objet' })).toBe(false)
  })

  it('rejette un nom vide ou blanc', () => {
    expect(isValidExtractCreation({ ...VALID_CREATION, name: '' })).toBe(false)
    expect(isValidExtractCreation({ ...VALID_CREATION, name: '   ' })).toBe(false)
  })

  it('rejette un champ manquant', () => {
    const { kind: _kind, ...withoutKind } = VALID_CREATION
    expect(isValidExtractCreation(withoutKind)).toBe(false)
    const { name: _name, ...withoutName } = VALID_CREATION
    expect(isValidExtractCreation(withoutName)).toBe(false)
    const { aliases: _aliases, ...withoutAliases } = VALID_CREATION
    expect(isValidExtractCreation(withoutAliases)).toBe(false)
    const { description: _description, ...withoutDescription } = VALID_CREATION
    expect(isValidExtractCreation(withoutDescription)).toBe(false)
  })

  it('rejette aliases avec un élément non-chaîne', () => {
    expect(isValidExtractCreation({ ...VALID_CREATION, aliases: ['ok', 42] })).toBe(false)
  })

  it('rejette aliases qui ne serait pas un tableau', () => {
    expect(isValidExtractCreation({ ...VALID_CREATION, aliases: 'le vieux forgeron' })).toBe(false)
  })

  it('rejette les non-objets', () => {
    expect(isValidExtractCreation(null)).toBe(false)
    expect(isValidExtractCreation(undefined)).toBe(false)
    expect(isValidExtractCreation('une chaîne')).toBe(false)
    expect(isValidExtractCreation(42)).toBe(false)
    expect(isValidExtractCreation([])).toBe(false)
  })
})

describe('isValidExtractEnrichissement', () => {
  it('accepte un enrichissement complet et bien formé', () => {
    expect(isValidExtractEnrichissement(VALID_ENRICHISSEMENT)).toBe(true)
  })

  it('accepte un enrichissement sans aucun champ facultatif', () => {
    expect(isValidExtractEnrichissement({ entityId: 1 })).toBe(true)
  })

  it.each(['aliases', 'description', 'notes'] as const)(
    'accepte un enrichissement avec seulement %s présent',
    (field) => {
      expect(isValidExtractEnrichissement({ entityId: 1, [field]: VALID_ENRICHISSEMENT[field] })).toBe(
        true
      )
    }
  )

  it('rejette entityId manquant ou du mauvais type', () => {
    expect(isValidExtractEnrichissement({ aliases: ['x'] })).toBe(false)
    expect(isValidExtractEnrichissement({ ...VALID_ENRICHISSEMENT, entityId: '12' })).toBe(false)
    expect(isValidExtractEnrichissement({ ...VALID_ENRICHISSEMENT, entityId: NaN })).toBe(false)
  })

  it('rejette aliases du mauvais type', () => {
    expect(isValidExtractEnrichissement({ ...VALID_ENRICHISSEMENT, aliases: 'la reine' })).toBe(false)
    expect(isValidExtractEnrichissement({ ...VALID_ENRICHISSEMENT, aliases: ['ok', 1] })).toBe(false)
  })

  it('rejette description/notes du mauvais type', () => {
    expect(isValidExtractEnrichissement({ ...VALID_ENRICHISSEMENT, description: 42 })).toBe(false)
    expect(isValidExtractEnrichissement({ ...VALID_ENRICHISSEMENT, notes: null })).toBe(false)
  })

  it('rejette les non-objets', () => {
    expect(isValidExtractEnrichissement(null)).toBe(false)
    expect(isValidExtractEnrichissement(undefined)).toBe(false)
    expect(isValidExtractEnrichissement('une chaîne')).toBe(false)
    expect(isValidExtractEnrichissement(42)).toBe(false)
    expect(isValidExtractEnrichissement([])).toBe(false)
  })
})

describe('pairEnrichissementsWithEntities', () => {
  const ENTITIES = [
    { id: 1, name: 'Vide' },
    { id: 2, name: 'Pleine' }
  ]
  // buildFields minimal : un champ exploitable ssi `description` est présent
  // (suffisant pour distinguer un enrichissement "vide" d'un enrichissement
  // "plein" sans dépendre de la vraie logique d'affichage d'ExtractDialog).
  const buildFields = (e: { description?: string }): string[] => (e.description ? ['description'] : [])

  it('associe le SEUL enrichissement exploitable à SA propre entité, même précédé d’un enrichissement sans champ exploitable (régression)', () => {
    const enrichissements = [
      { entityId: 1 }, // aucun champ exploitable (buildFields → [])
      { entityId: 2, description: 'Texte.' }
    ]
    const result = pairEnrichissementsWithEntities(enrichissements, ENTITIES, buildFields)
    expect(result).toHaveLength(1)
    expect(result[0].entity).toEqual(ENTITIES[1])
    expect(result[0].enrichissement).toEqual(enrichissements[1])
  })

  it('écarte un enrichissement dont l’entité n’existe pas dans le catalogue fourni', () => {
    const enrichissements = [{ entityId: 99, description: 'x' }]
    expect(pairEnrichissementsWithEntities(enrichissements, ENTITIES, buildFields)).toEqual([])
  })

  it('écarte un enrichissement sans aucun champ exploitable, même avec une entité connue', () => {
    const enrichissements = [{ entityId: 1 }]
    expect(pairEnrichissementsWithEntities(enrichissements, ENTITIES, buildFields)).toEqual([])
  })

  it('préserve l’ordre des enrichissements pairés et associe chacun à SA propre entité', () => {
    const enrichissements = [
      { entityId: 2, description: 'a' },
      { entityId: 1, description: 'b' }
    ]
    const result = pairEnrichissementsWithEntities(enrichissements, ENTITIES, buildFields)
    expect(result.map((r) => r.entity.id)).toEqual([2, 1])
    expect(result.map((r) => r.enrichissement.description)).toEqual(['a', 'b'])
  })
})

describe('filterExtractProposal', () => {
  it('accepte un objet valide et ne filtre rien', () => {
    const result = filterExtractProposal({
      creations: [VALID_CREATION],
      enrichissements: [VALID_ENRICHISSEMENT]
    })
    expect(result).not.toBeNull()
    expect(result?.proposal.creations).toEqual([VALID_CREATION])
    expect(result?.proposal.enrichissements).toEqual([VALID_ENRICHISSEMENT])
    expect(result?.malformedCount).toBe(0)
  })

  it('accepte des tableaux vides (aucune proposition)', () => {
    const result = filterExtractProposal({ creations: [], enrichissements: [] })
    expect(result).toEqual({ proposal: { creations: [], enrichissements: [] }, malformedCount: 0 })
  })

  it('filtre les créations et enrichissements malformés et les compte', () => {
    const result = filterExtractProposal({
      creations: [VALID_CREATION, { kind: 'objet', name: 'x', aliases: [], description: '' }],
      enrichissements: [VALID_ENRICHISSEMENT, { entityId: 'douze' }]
    })
    expect(result?.proposal.creations).toEqual([VALID_CREATION])
    expect(result?.proposal.enrichissements).toEqual([VALID_ENRICHISSEMENT])
    expect(result?.malformedCount).toBe(2)
  })

  it('retourne null si creations/enrichissements ne sont pas des tableaux', () => {
    expect(filterExtractProposal({ creations: 'x', enrichissements: [] })).toBeNull()
    expect(filterExtractProposal({ creations: [] })).toBeNull()
  })

  it('retourne null pour les non-objets et les tableaux au niveau racine', () => {
    expect(filterExtractProposal(null)).toBeNull()
    expect(filterExtractProposal(undefined)).toBeNull()
    expect(filterExtractProposal('une chaîne')).toBeNull()
    expect(filterExtractProposal([])).toBeNull()
  })
})
