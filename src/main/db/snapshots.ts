import type { Db } from './connection'
import type { Snapshot } from '../../shared/types'

export function createSnapshot(db: Db, chapterId: number, contentJson: string, reason: string): Snapshot {
  const result = db
    .prepare(
      `INSERT INTO snapshots (chapter_id, content_json, reason)
       VALUES (?, ?, ?)`
    )
    .run(chapterId, contentJson, reason)

  const id = Number(result.lastInsertRowid)

  // Prune: garder les 20 plus récents pour ce chapitre
  const toDelete = db
    .prepare(
      `SELECT id FROM snapshots
       WHERE chapter_id = ?
       ORDER BY created_at DESC
       LIMIT -1 OFFSET 20`
    )
    .all(chapterId) as any[]

  for (const row of toDelete) {
    db.prepare('DELETE FROM snapshots WHERE id = ?').run(row.id)
  }

  return getSnapshot(db, id)
}

function getSnapshot(db: Db, id: number): Snapshot {
  const row = db
    .prepare('SELECT id, chapter_id, reason, created_at FROM snapshots WHERE id = ?')
    .get(id) as any
  if (!row) throw new Error(`Snapshot introuvable: ${id}`)
  return {
    id: row.id,
    chapterId: row.chapter_id,
    reason: row.reason,
    createdAt: row.created_at
  }
}

export function listSnapshots(db: Db, chapterId: number): Snapshot[] {
  return db
    .prepare(
      `SELECT id, chapter_id, reason, created_at FROM snapshots
       WHERE chapter_id = ?
       ORDER BY created_at DESC`
    )
    .all(chapterId)
    .map((row: any) => ({
      id: row.id,
      chapterId: row.chapter_id,
      reason: row.reason,
      createdAt: row.created_at
    }))
}

export function getSnapshotContent(db: Db, id: number): string {
  const row = db.prepare('SELECT content_json FROM snapshots WHERE id = ?').get(id) as any
  if (!row) throw new Error(`Snapshot introuvable: ${id}`)
  return row.content_json
}
