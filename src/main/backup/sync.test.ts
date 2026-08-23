import { describe, it, expect, beforeEach } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { openDb, type Db } from '../db/connection'
import { createBook } from '../db/books'
import { createChapter } from '../db/chapters'
import { GIT_BIN, runGit } from './git'
import { createBackupService, commitMessage, type BackupPaths } from './sync'

let dir: string
let db: Db
let dbPath: string
let paths: BackupPaths

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'encre-sync-'))
  const remote = join(dir, 'remote.git')
  execFileSync(GIT_BIN, ['init', '--bare', '-q', '-b', 'main', remote])

  dbPath = join(dir, 'library.db')
  db = openDb(dbPath)
  const book = createBook(db, { title: 'Livre' })
  createChapter(db, book.id, 'Ch. 1')

  const mediaDir = join(dir, 'media')
  mkdirSync(mediaDir)
  writeFileSync(join(mediaDir, 'photo.png'), 'octets')

  paths = {
    repoDir: join(dir, 'backup-repo'),
    mediaDir,
    backupsDir: join(dir, 'backups'),
    keyPath: join(dir, 'pas-de-cle'),
    statePath: join(dir, 'backup-state.json'),
    remoteUrl: remote
  }
})

describe('commitMessage', () => {
  it('résume le diff dans le message', () => {
    const msg = commitMessage(new Date('2026-08-23T20:15:00Z'), {
      chaptersChanged: 3, chaptersAdded: 0, chaptersRemoved: 0,
      wordsDelta: 1240, mediaAdded: 0, booksAdded: 0, changedTitles: []
    })
    expect(msg).toContain('3 chapitres')
    expect(msg).toContain('+1 240 mots')
  })

  it('mentionne les images quand il y en a', () => {
    const msg = commitMessage(new Date('2026-08-23T20:15:00Z'), {
      chaptersChanged: 0, chaptersAdded: 0, chaptersRemoved: 0,
      wordsDelta: 0, mediaAdded: 2, booksAdded: 0, changedTitles: []
    })
    expect(msg).toContain('2 images')
  })
})

describe('createBackupService — séquence nominale', () => {
  it('clone, dumpe, copie les médias, commite et pousse', async () => {
    const svc = createBackupService(db, paths)
    const status = await svc.runNow()

    expect(status.lastCommitAt).not.toBeNull()
    expect(status.lastPushAt).not.toBeNull()
    expect(status.lastError).toBeNull()

    expect(existsSync(join(paths.repoDir, 'library.sql'))).toBe(true)
    expect(existsSync(join(paths.repoDir, 'media', 'photo.png'))).toBe(true)

    const manifest = JSON.parse(readFileSync(join(paths.repoDir, 'manifest.json'), 'utf8'))
    expect(manifest.counts.chapters).toBe(1)
    expect(manifest.media).toEqual(['photo.png'])

    // Le commit est bien arrivé sur le remote.
    const log = await runGit(['log', '-1', '--format=%s'], { cwd: paths.remoteUrl })
    expect(log.stdout).toContain('sauvegarde')
  })

  it('après une sauvegarde, le diff en attente est vide', async () => {
    const svc = createBackupService(db, paths)
    await svc.runNow()
    const status = await svc.status()
    expect(status.pending.chaptersChanged).toBe(0)
    expect(status.pending.chaptersAdded).toBe(0)
    expect(status.pending.mediaAdded).toBe(0)
  })

  it('signale le travail fait depuis la dernière sauvegarde', async () => {
    const svc = createBackupService(db, paths)
    await svc.runNow()

    const ch = createChapter(db, 1, 'Ch. 2')
    db.prepare('UPDATE chapters SET content_json = ?, word_count = ? WHERE id = ?')
      .run('{"nouveau":1}', 300, ch.id)
    writeFileSync(join(paths.mediaDir, 'autre.png'), 'octets')

    const status = await svc.status()
    expect(status.pending.chaptersAdded).toBe(1)
    expect(status.pending.wordsDelta).toBe(300)
    expect(status.pending.mediaAdded).toBe(1)
    expect(status.pending.changedTitles).toEqual(['Ch. 2'])
  })

  it('ne copie pas deux fois un média déjà présent', async () => {
    const svc = createBackupService(db, paths)
    await svc.runNow()
    const before = readFileSync(join(paths.repoDir, 'media', 'photo.png'), 'utf8')
    await svc.runNow()
    expect(readFileSync(join(paths.repoDir, 'media', 'photo.png'), 'utf8')).toBe(before)
  })

  it('garde dans le dépôt un média supprimé de la bibliothèque', async () => {
    const svc = createBackupService(db, paths)
    await svc.runNow()
    const { unlinkSync } = await import('fs')
    unlinkSync(join(paths.mediaDir, 'photo.png'))
    await svc.runNow()
    // Délibéré : une sauvegarde qui réplique les suppressions ne protège pas
    // d'une suppression accidentelle.
    expect(existsSync(join(paths.repoDir, 'media', 'photo.png'))).toBe(true)
  })
})

describe('createBackupService — chemins d\'échec', () => {
  it('garde le commit local quand le push échoue', async () => {
    const svc = createBackupService(db, paths)
    const first = await svc.runNow()
    await runGit(['remote', 'set-url', 'origin', join(dir, 'disparu.git')], { cwd: paths.repoDir })

    createChapter(db, 1, 'Ch. 2')
    const second = await svc.runNow()

    expect(second.lastCommitAt).not.toBe(first.lastCommitAt) // le run 2 a bien commité
    expect(second.lastPushAt).toBe(first.lastPushAt) // et lastPushAt n'a pas bougé
    expect(second.lastError).not.toBeNull()
    // Deux commits, pas un : la sauvegarde du run 2 a bien été enregistrée
    // localement même si l'envoi a échoué.
    const count = await runGit(['rev-list', '--count', 'HEAD'], { cwd: paths.repoDir })
    expect(count.stdout.trim()).toBe('2')
  })

  it('un `git add` en échec n\'est pas rapporté comme une sauvegarde réussie', async () => {
    const svc = createBackupService(db, paths)
    const first = await svc.runNow()

    // Un `index.lock` resté d'un processus tué (ou ENOSPC/EACCES/un hook qui
    // refuse) fait échouer `git add -A` sans toucher HEAD.
    writeFileSync(join(paths.repoDir, '.git', 'index.lock'), '')

    createChapter(db, 1, 'Ch. 2')
    const second = await svc.runNow()

    expect(second.lastError).not.toBeNull()
    // Rien n'a été commité : pousser un HEAD inchangé ne doit pas faire
    // avancer lastPushAt ni être confondu avec une sauvegarde réussie.
    expect(second.lastPushAt).toBe(first.lastPushAt)
  })

  it('refuse d\'élaguer le dépôt distant depuis un dossier de travail amputé', async () => {
    const svc = createBackupService(db, paths)
    await svc.runNow()

    // L'image est retirée de la bibliothèque : le dépôt doit la garder.
    unlinkSync(join(paths.mediaDir, 'photo.png'))
    // Puis le dossier de travail est amputé — clone interrompu, ou espace
    // disque récupéré à la main. `git add -A` mettrait la suppression en scène
    // et la pousserait, élaguant le dépôt distant en silence.
    unlinkSync(join(paths.repoDir, 'media', 'photo.png'))
    createChapter(db, 1, 'Ch. 2')

    const status = await svc.runNow()
    expect(status.lastError).toMatch(/[Ss]uppression/)

    // Le dépôt distant n'a rien perdu.
    const ls = await runGit(['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: paths.remoteUrl })
    expect(ls.stdout).toContain('media/photo.png')
  })

  it('libère le verrou même si l\'écriture de l\'état échoue', async () => {
    // Le chemin d'état est un dossier plutôt qu'un fichier : writeFileSync y
    // échoue systématiquement (EISDIR).
    mkdirSync(paths.statePath)
    const svc = createBackupService(db, paths)

    await svc.runNow().catch(() => {}) // peu importe l'issue de ce premier appel
    // Ce qui compte : le verrou `running` doit être relâché malgré l'échec
    // d'écriture, sinon plus aucune sauvegarde n'est possible avant redémarrage.
    await expect(svc.runNow()).resolves.toBeDefined()
  })

  it('rejette un second runNow pendant qu\'une sauvegarde tourne', async () => {
    const svc = createBackupService(db, paths)
    const first = svc.runNow()
    await expect(svc.runNow()).rejects.toThrow(/en cours/)
    await first
  })

  it('status() sans dépôt ni sauvegarde rend configured=false sans lever', async () => {
    const svc = createBackupService(db, paths)
    const status = await svc.status()
    expect(status.configured).toBe(false)
    expect(status.lastCommitAt).toBeNull()
    // Le diff en attente est calculable même sans dépôt : tout est « à sauvegarder ».
    expect(status.pending.chaptersAdded).toBe(1)
    // git et sqlite3 sont présents sur la machine de test comme en production.
    expect(status.missingBinary).toBeNull()
  })
})
