import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, chmodSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3'
import { openDb } from '../db/connection'
import { createBook } from '../db/books'
import { dumpDatabase } from './dump'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'encre-dump-'))
})

afterEach(() => {
  // Restaurer les permissions pour que le nettoyage du dossier temporaire ne échoue pas
  try {
    chmodSync(dir, 0o755)
  } catch {
    // Ignorer si le répertoire n'existe pas ou si on n'a pas les permissions
  }
})

describe('dumpDatabase', () => {
  it('produit un SQL qui reconstruit la base à l\'identique', async () => {
    const dbPath = join(dir, 'library.db')
    const db = openDb(dbPath)
    createBook(db, { title: 'Le Livre' })
    db.close()

    const out = join(dir, 'library.sql')
    await dumpDatabase(dbPath, out)

    const sql = readFileSync(out, 'utf8')
    expect(sql).toContain('CREATE TABLE')
    expect(sql).toContain('Le Livre')

    // Preuve de l'aller-retour : sqlite3 crée lui-même la base en rejouant le
    // dump. Surtout ne pas la pré-créer avec openDb — les migrations auraient
    // déjà posé les tables, et le CREATE TABLE du dump échouerait.
    const restored = join(dir, 'restored.db')
    const { execFileSync } = await import('child_process')
    execFileSync('/usr/bin/sqlite3', [restored], { input: sql })
    const check = new Database(restored, { readonly: true })
    expect((check.prepare('SELECT title FROM books').get() as { title: string }).title).toBe('Le Livre')
    check.close()
  })

  it('lève si la base source n\'existe pas', async () => {
    await expect(dumpDatabase(join(dir, 'nexistepas.db'), join(dir, 'o.sql'))).rejects.toThrow()
  })

  it('lève si la base est corrompue (pages de données écrasées)', async () => {
    // Créer une base valide d'abord
    const okPath = join(dir, 'valid.db')
    const db = openDb(okPath)
    createBook(db, { title: 'Test' })
    db.close()

    // Maintenant corrompre la base en écrasant les pages de données avec 0xFF
    // tout en gardant intact l'en-tête SQLite (100 premiers octets)
    const raw = Buffer.from(readFileSync(okPath))
    for (let i = 100; i < Math.min(raw.length, 4096); i++) {
      raw[i] = 0xff
    }

    const corruptedPath = join(dir, 'corrupted.db')
    writeFileSync(corruptedPath, raw)

    // Le dump d'une base corrompue devrait rejeter (stderr contient l'erreur)
    const out = join(dir, 'corrupted.sql')
    await expect(dumpDatabase(corruptedPath, out)).rejects.toThrow(/malformed/)
  })

  it('lève si la base est illisible (permissions refusées)', async () => {
    const dbPath = join(dir, 'unreadable.db')
    const db = openDb(dbPath)
    createBook(db, { title: 'Secret' })
    db.close()

    // Retirer les permissions de lecture
    chmodSync(dbPath, 0o000)

    const out = join(dir, 'unreadable.sql')
    try {
      await expect(dumpDatabase(dbPath, out)).rejects.toThrow()
    } finally {
      // Restaurer les permissions pour le nettoyage
      chmodSync(dbPath, 0o644)
    }
  })
})
