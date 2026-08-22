import { describe, it, expect, beforeEach } from 'vitest'
import { openDb, type Db } from './connection'
import { listSeries, getOrCreateSeries, deleteSeries } from './series'

let db: Db
beforeEach(() => {
  db = openDb(':memory:')
})

describe('repository series', () => {
  it('crée une série et la retrouve', () => {
    const series = getOrCreateSeries(db, 'Fantasy Épique')
    expect(series.id).toBeGreaterThan(0)
    expect(series.name).toBe('Fantasy Épique')

    const all = listSeries(db)
    expect(all).toHaveLength(1)
    expect(all[0].name).toBe('Fantasy Épique')
  })

  it('getOrCreateSeries est idempotent (exact match case-sensitive)', () => {
    const s1 = getOrCreateSeries(db, 'Saga')
    const s2 = getOrCreateSeries(db, 'Saga')
    expect(s2.id).toBe(s1.id)
    expect(listSeries(db)).toHaveLength(1)
  })

  it('getOrCreateSeries distingue la casse sur un nom exact', () => {
    const s1 = getOrCreateSeries(db, 'Saga')
    const s2 = getOrCreateSeries(db, 'saga')
    // case-sensitive, donc 2 séries différentes
    expect(s2.id).not.toBe(s1.id)
    expect(listSeries(db)).toHaveLength(2)
  })

  it('getOrCreateSeries trims le nom', () => {
    const series = getOrCreateSeries(db, '  Aventures  ')
    expect(series.name).toBe('Aventures')
  })

  it('listSeries retourne les séries ordonnées par nom', () => {
    getOrCreateSeries(db, 'Zombies')
    getOrCreateSeries(db, 'Aventures')
    getOrCreateSeries(db, 'Mystère')

    const all = listSeries(db)
    expect(all.map((s) => s.name)).toEqual(['Aventures', 'Mystère', 'Zombies'])
  })

  it('deleteSeries nullifie les series_id des livres', () => {
    const series = getOrCreateSeries(db, 'Épopée')
    db.prepare('INSERT INTO books (title, series_id) VALUES (?, ?)').run('Livre 1', series.id)
    db.prepare('INSERT INTO books (title, series_id) VALUES (?, ?)').run('Livre 2', series.id)

    deleteSeries(db, series.id)

    const books = db.prepare('SELECT series_id FROM books ORDER BY id').all() as any[]
    expect(books[0].series_id).toBeNull()
    expect(books[1].series_id).toBeNull()
  })
})
