export const MIGRATIONS: string[] = [
  `
  CREATE TABLE books (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    author      TEXT NOT NULL DEFAULT '',
    genre       TEXT NOT NULL DEFAULT '',
    language    TEXT NOT NULL DEFAULT 'fr',
    synopsis    TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'en_cours',
    cover_path  TEXT,
    word_goal   INTEGER,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE chapters (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id      INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    position     INTEGER NOT NULL,
    title        TEXT NOT NULL DEFAULT '',
    content_json TEXT NOT NULL DEFAULT '{"type":"doc","content":[]}',
    content_text TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'brouillon',
    word_count   INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX idx_chapters_book ON chapters(book_id, position);
  `,
  `
  ALTER TABLE chapters ADD COLUMN summary TEXT NOT NULL DEFAULT '';

  CREATE TABLE entities (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id     INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,
    name        TEXT NOT NULL,
    aliases     TEXT NOT NULL DEFAULT '[]',
    description TEXT NOT NULL DEFAULT '',
    attributes  TEXT NOT NULL DEFAULT '{}',
    notes       TEXT NOT NULL DEFAULT '',
    image_path  TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_entities_book ON entities(book_id, kind, name);

  CREATE TABLE outline_notes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id    INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    chapter_id INTEGER REFERENCES chapters(id) ON DELETE CASCADE,
    position   INTEGER NOT NULL,
    content    TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_outline_book ON outline_notes(book_id, chapter_id, position);

  CREATE TABLE timeline_events (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id     INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    date_label  TEXT NOT NULL DEFAULT '',
    title       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_timeline_book ON timeline_events(book_id, position);

  CREATE TABLE event_chapters (
    event_id   INTEGER NOT NULL REFERENCES timeline_events(id) ON DELETE CASCADE,
    chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, chapter_id)
  );

  CREATE TABLE event_entities (
    event_id  INTEGER NOT NULL REFERENCES timeline_events(id) ON DELETE CASCADE,
    entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, entity_id)
  );

  CREATE TABLE mentions (
    chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    entity_id  INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    PRIMARY KEY (chapter_id, entity_id)
  );
  `,
  `
  CREATE TABLE series (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  ALTER TABLE books ADD COLUMN series_id INTEGER REFERENCES series(id) ON DELETE SET NULL;

  CREATE TABLE snapshots (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    content_json TEXT NOT NULL,
    reason     TEXT NOT NULL DEFAULT 'ia',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_snapshots_chapter ON snapshots(chapter_id, created_at);

  CREATE TABLE ai_sessions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id    INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
    task       TEXT NOT NULL,
    model      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE ai_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES ai_sessions(id) ON DELETE CASCADE,
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `,
  `
  CREATE TABLE illustrations (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id      INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    file_name    TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    position     INTEGER NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_illustrations_book ON illustrations(book_id, position);
  `
]
