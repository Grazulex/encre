import type { Db } from './connection'
import type { TimelineEvent, TimelineEventPatch } from '../../shared/types'

interface TimelineEventRow {
  id: number
  book_id: number
  position: number
  date_label: string
  title: string
  description: string
  updated_at: string
}

function rowToEvent(db: Db, row: TimelineEventRow): TimelineEvent {
  const chapterIds = (
    db
      .prepare('SELECT chapter_id FROM event_chapters WHERE event_id = ? ORDER BY chapter_id')
      .all(row.id) as Array<{ chapter_id: number }>
  ).map((r) => r.chapter_id)
  const entityIds = (
    db
      .prepare('SELECT entity_id FROM event_entities WHERE event_id = ? ORDER BY entity_id')
      .all(row.id) as Array<{ entity_id: number }>
  ).map((r) => r.entity_id)
  return {
    id: row.id,
    bookId: row.book_id,
    position: row.position,
    dateLabel: row.date_label,
    title: row.title,
    description: row.description,
    chapterIds,
    entityIds,
    updatedAt: row.updated_at
  }
}

export function listTimeline(db: Db, bookId: number): TimelineEvent[] {
  const rows = db
    .prepare('SELECT * FROM timeline_events WHERE book_id = ? ORDER BY position')
    .all(bookId) as TimelineEventRow[]
  return rows.map((row) => rowToEvent(db, row))
}

export function getTimelineEvent(db: Db, id: number): TimelineEvent {
  const row = db.prepare('SELECT * FROM timeline_events WHERE id = ?').get(id) as
    TimelineEventRow | undefined
  if (!row) throw new Error(`Événement introuvable: ${id}`)
  return rowToEvent(db, row)
}

export function createTimelineEvent(db: Db, bookId: number, title: string): TimelineEvent {
  const result = db
    .prepare(
      `INSERT INTO timeline_events (book_id, position, title)
       VALUES (?, (SELECT COALESCE(MAX(position), 0) + 1 FROM timeline_events WHERE book_id = ?), ?)`
    )
    .run(bookId, bookId, title)
  return getTimelineEvent(db, Number(result.lastInsertRowid))
}

const EVENT_COLS: Record<string, string> = {
  dateLabel: 'date_label',
  title: 'title',
  description: 'description'
}

export function updateTimelineEvent(db: Db, id: number, patch: TimelineEventPatch): TimelineEvent {
  const entries = Object.entries(patch).filter(([k]) => Object.hasOwn(EVENT_COLS, k))
  if (entries.length > 0) {
    const sets = entries.map(([k]) => `${EVENT_COLS[k]} = @${k}`).join(', ')
    db.prepare(
      `UPDATE timeline_events SET ${sets}, updated_at = datetime('now') WHERE id = @id`
    ).run({
      ...Object.fromEntries(entries),
      id
    })
  }
  return getTimelineEvent(db, id)
}

export function setTimelineLinks(
  db: Db,
  id: number,
  chapterIds: number[],
  entityIds: number[]
): TimelineEvent {
  db.transaction(() => {
    db.prepare('DELETE FROM event_chapters WHERE event_id = ?').run(id)
    db.prepare('DELETE FROM event_entities WHERE event_id = ?').run(id)
    const insCh = db.prepare(
      'INSERT OR IGNORE INTO event_chapters (event_id, chapter_id) SELECT ?, id FROM chapters WHERE id = ?'
    )
    for (const cid of chapterIds) insCh.run(id, cid)
    const insEn = db.prepare(
      'INSERT OR IGNORE INTO event_entities (event_id, entity_id) SELECT ?, id FROM entities WHERE id = ?'
    )
    for (const eid of entityIds) insEn.run(id, eid)
    db.prepare("UPDATE timeline_events SET updated_at = datetime('now') WHERE id = ?").run(id)
  })()
  return getTimelineEvent(db, id)
}

export function reorderTimeline(db: Db, bookId: number, orderedIds: number[]): void {
  const stmt = db.prepare('UPDATE timeline_events SET position = ? WHERE id = ? AND book_id = ?')
  db.transaction(() => {
    orderedIds.forEach((id, i) => stmt.run(i + 1, id, bookId))
  })()
}

export function deleteTimelineEvent(db: Db, id: number): void {
  db.prepare('DELETE FROM timeline_events WHERE id = ?').run(id)
}
