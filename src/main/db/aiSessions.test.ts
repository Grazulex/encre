import { describe, it, expect, beforeEach } from 'vitest'
import { openDb, type Db } from './connection'
import { createAiSession, addAiMessage } from './aiSessions'

let db: Db
beforeEach(() => {
  db = openDb(':memory:')
})

describe('repository aiSessions', () => {
  it('crée une session IA et retourne son id', () => {
    db.prepare('INSERT INTO books (title) VALUES (?)').run('Livre')
    db.prepare('INSERT INTO chapters (book_id, position, title) VALUES (1, 1, ?)').run('Ch. 1')

    const sessionId = createAiSession(db, 1, 1, 'improve-prose', 'claude-3.5-sonnet')
    expect(sessionId).toBeGreaterThan(0)

    const session = db.prepare('SELECT * FROM ai_sessions WHERE id = ?').get(sessionId) as any
    expect(session.book_id).toBe(1)
    expect(session.chapter_id).toBe(1)
    expect(session.task).toBe('improve-prose')
    expect(session.model).toBe('claude-3.5-sonnet')
  })

  it('addAiMessage ajoute un message à une session', () => {
    db.prepare('INSERT INTO books (title) VALUES (?)').run('Livre')
    db.prepare('INSERT INTO chapters (book_id, position, title) VALUES (1, 1, ?)').run('Ch. 1')

    const sessionId = createAiSession(db, 1, 1, 'improve-prose', 'claude-3.5-sonnet')
    addAiMessage(db, sessionId, 'user', 'Améliore ce paragraphe')
    addAiMessage(db, sessionId, 'assistant', 'Voici ma suggestion...')

    const messages = db.prepare('SELECT role, content FROM ai_messages WHERE session_id = ? ORDER BY id').all(sessionId) as any[]
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toBe('Améliore ce paragraphe')
    expect(messages[1].role).toBe('assistant')
    expect(messages[1].content).toBe('Voici ma suggestion...')
  })

  it('createAiSession accepte chapterId optionnel (null)', () => {
    db.prepare('INSERT INTO books (title) VALUES (?)').run('Livre')

    const sessionId = createAiSession(db, 1, null, 'brainstorm', 'claude-3.5-sonnet')
    const session = db.prepare('SELECT chapter_id FROM ai_sessions WHERE id = ?').get(sessionId) as any
    expect(session.chapter_id).toBeNull()
  })
})
