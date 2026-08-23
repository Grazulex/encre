import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync } from 'fs'
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
})
