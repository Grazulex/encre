import { describe, it, expect, beforeEach } from 'vitest'
import { openDb, type Db } from './connection'
import { createBook } from './books'
import { listEntities, getEntity, createEntity, updateEntity, deleteEntity } from './entities'

let db: Db
let bookId: number
beforeEach(() => {
  db = openDb(':memory:')
  bookId = createBook(db, { title: 'Livre' }).id
})

describe('repository entities', () => {
  it('crée et liste par type', () => {
    createEntity(db, { bookId, kind: 'character', name: 'Mara' })
    createEntity(db, { bookId, kind: 'place', name: 'Brest' })
    expect(listEntities(db, bookId)).toHaveLength(2)
    expect(listEntities(db, bookId, 'character').map((e) => e.name)).toEqual(['Mara'])
  })

  it('sérialise alias et attributs en JSON', () => {
    const e = createEntity(db, { bookId, kind: 'character', name: 'Mara' })
    const up = updateEntity(db, e.id, {
      aliases: ['La Louve'],
      attributes: { yeux: 'verts', âge: '31' },
      description: 'Héroïne'
    })
    expect(up.aliases).toEqual(['La Louve'])
    expect(up.attributes.yeux).toBe('verts')
    const again = getEntity(db, e.id)
    expect(again.attributes['âge']).toBe('31')
  })

  it('supprime', () => {
    const e = createEntity(db, { bookId, kind: 'place', name: 'Brest' })
    deleteEntity(db, e.id)
    expect(listEntities(db, bookId)).toHaveLength(0)
    expect(() => getEntity(db, e.id)).toThrow()
  })
})
