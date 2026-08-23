import { describe, it, expect, beforeEach } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync, utimesSync, existsSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3'
import { openDb } from '../db/connection'
import { backupDatabase, pruneBackups, shouldBackup } from './local'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'encre-backup-'))
})

describe('backupDatabase', () => {
  it('produit une copie ouvrable contenant les données', async () => {
    const src = join(dir, 'library.db')
    const db = openDb(src)
    db.prepare("INSERT INTO books (title) VALUES ('Sauvé')").run()
    const path = await backupDatabase(db, join(dir, 'backups'), new Date('2026-08-22T10:00:00Z'))
    expect(existsSync(path)).toBe(true)
    const copy = new Database(path, { readonly: true })
    expect((copy.prepare('SELECT title FROM books').get() as any).title).toBe('Sauvé')
    copy.close()
    db.close()
  })
})

describe('shouldBackup / pruneBackups', () => {
  it('shouldBackup vrai sans backup récent, faux sinon', () => {
    const backups = join(dir, 'backups')
    expect(shouldBackup(backups, new Date())).toBe(true)
    // un backup « récent »
    const f = join(dir, 'backups')
    mkdirSync(f, { recursive: true })
    writeFileSync(join(f, 'library-recent.db'), '')
    expect(shouldBackup(backups, new Date())).toBe(false)
  })

  it('pruneBackups emporte les fichiers -wal et -shm avec leur instantané', () => {
    const backups = join(dir, 'backups')
    mkdirSync(backups, { recursive: true })
    // Chaque db.backup() laisse trois fichiers. Sans eux, les -wal et -shm
    // survivent à l'élagage pour toujours.
    const freres = ['library-old.db', 'library-old.db-wal', 'library-old.db-shm']
    const old = new Date('2026-06-01T00:00:00Z')
    for (const f of freres) {
      writeFileSync(join(backups, f), '')
      utimesSync(join(backups, f), old, old)
    }
    writeFileSync(join(backups, 'library-new.db'), '')

    pruneBackups(backups, new Date('2026-08-22T00:00:00Z'), 30)
    expect(readdirSync(backups)).toEqual(['library-new.db'])
  })

  it('pruneBackups supprime les fichiers plus vieux que 30 jours', () => {
    const backups = join(dir, 'backups')
    mkdirSync(backups, { recursive: true })
    const oldFile = join(backups, 'library-old.db')
    const newFile = join(backups, 'library-new.db')
    writeFileSync(oldFile, '')
    writeFileSync(newFile, '')
    const old = new Date('2026-06-01T00:00:00Z')
    utimesSync(oldFile, old, old)
    const removed = pruneBackups(backups, new Date('2026-08-22T00:00:00Z'), 30)
    expect(removed).toEqual([oldFile])
    expect(readdirSync(backups)).toEqual(['library-new.db'])
  })
})
