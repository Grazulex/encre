import type { Db } from './connection'
import type { AiRole } from '../../shared/types'

export function createAiSession(
  db: Db,
  bookId: number,
  chapterId: number | null,
  task: string,
  model: string
): number {
  const result = db
    .prepare(
      `INSERT INTO ai_sessions (book_id, chapter_id, task, model)
       VALUES (?, ?, ?, ?)`
    )
    .run(bookId, chapterId, task, model)

  return Number(result.lastInsertRowid)
}

export function addAiMessage(db: Db, sessionId: number, role: AiRole, content: string): void {
  db.prepare(
    `INSERT INTO ai_messages (session_id, role, content)
     VALUES (?, ?, ?)`
  ).run(sessionId, role, content)
}
