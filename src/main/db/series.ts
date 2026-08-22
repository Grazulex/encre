import type { Db } from './connection'
import type { Series } from '../../shared/types'

export function listSeries(db: Db): Series[] {
  return db
    .prepare('SELECT id, name FROM series ORDER BY name')
    .all()
    .map((row: any) => ({ id: row.id, name: row.name }))
}

export function getOrCreateSeries(db: Db, name: string): Series {
  const trimmed = name.trim()
  // Chercher une série existante avec ce nom exact (case-sensitive)
  const existing = db
    .prepare('SELECT id, name FROM series WHERE name = ?')
    .get(trimmed) as any
  if (existing) {
    return { id: existing.id, name: existing.name }
  }
  // Créer une nouvelle série
  const result = db.prepare('INSERT INTO series (name) VALUES (?)').run(trimmed)
  return { id: Number(result.lastInsertRowid), name: trimmed }
}

export function deleteSeries(db: Db, id: number): void {
  db.prepare('DELETE FROM series WHERE id = ?').run(id)
}
