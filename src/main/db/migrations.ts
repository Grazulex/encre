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
  `
]
