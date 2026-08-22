import type { Db } from './connection'
import type { Entity, EntityCreate, EntityKind, EntityPatch } from '../../shared/types'

export function entityRowToEntity(row: any): Entity {
  return {
    id: row.id,
    bookId: row.book_id,
    kind: row.kind,
    name: row.name,
    aliases: JSON.parse(row.aliases),
    description: row.description,
    attributes: JSON.parse(row.attributes),
    notes: row.notes,
    imagePath: row.image_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function listEntities(db: Db, bookId: number, kind?: EntityKind): Entity[] {
  const rows = kind
    ? db.prepare('SELECT * FROM entities WHERE book_id = ? AND kind = ? ORDER BY name').all(bookId, kind)
    : db.prepare('SELECT * FROM entities WHERE book_id = ? ORDER BY kind, name').all(bookId)
  return rows.map(entityRowToEntity)
}

export function getEntity(db: Db, id: number): Entity {
  const row = db.prepare('SELECT * FROM entities WHERE id = ?').get(id)
  if (!row) throw new Error(`Entité introuvable: ${id}`)
  return entityRowToEntity(row)
}

export function createEntity(db: Db, input: EntityCreate): Entity {
  const result = db
    .prepare('INSERT INTO entities (book_id, kind, name) VALUES (?, ?, ?)')
    .run(input.bookId, input.kind, input.name)
  return getEntity(db, Number(result.lastInsertRowid))
}

const COLS: Record<string, { col: string; json?: boolean }> = {
  name: { col: 'name' },
  aliases: { col: 'aliases', json: true },
  description: { col: 'description' },
  attributes: { col: 'attributes', json: true },
  notes: { col: 'notes' },
  imagePath: { col: 'image_path' }
}

export function updateEntity(db: Db, id: number, patch: EntityPatch): Entity {
  const entries = Object.entries(patch).filter(([k]) => Object.hasOwn(COLS, k))
  if (entries.length > 0) {
    const sets = entries.map(([k]) => `${COLS[k].col} = @${k}`).join(', ')
    const params: Record<string, unknown> = { id }
    for (const [k, v] of entries) params[k] = COLS[k].json ? JSON.stringify(v) : v
    db.prepare(`UPDATE entities SET ${sets}, updated_at = datetime('now') WHERE id = @id`).run(params)
  }
  return getEntity(db, id)
}

export function deleteEntity(db: Db, id: number): void {
  db.prepare('DELETE FROM entities WHERE id = ?').run(id)
}
