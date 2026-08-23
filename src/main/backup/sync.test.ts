import { describe, it, expect, beforeEach } from 'vitest'
import { execFileSync } from 'child_process'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  existsSync,
  unlinkSync,
  utimesSync
} from 'fs'
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

describe('createBackupService — instantané et manifeste', () => {
  it('décrit le même instant que le dump, pas la base quelques ms plus tard', async () => {
    // On simule le chapitre enregistré dans la fenêtre entre l'instantané et
    // la construction du manifeste, en écrivant dans la base vivante juste
    // après que `db.backup()` a rendu la main.
    const realBackup = db.backup.bind(db)
    let dejaFait = false
    ;(db as unknown as { backup: (dest: string) => Promise<unknown> }).backup = async (dest) => {
      const r = await realBackup(dest)
      if (!dejaFait) {
        dejaFait = true
        createChapter(db, 1, 'Écrit pendant la sauvegarde')
      }
      return r
    }

    const svc = createBackupService(db, paths)
    await svc.runNow()

    // Le dump vient de l'instantané : il ignore ce chapitre.
    expect(readFileSync(join(paths.repoDir, 'library.sql'), 'utf8'))
      .not.toContain('Écrit pendant la sauvegarde')

    // Le manifeste doit dire la même chose que le dump. S'il le mentionne, le
    // run suivant ne verra plus aucun changement pour lui et le déclarera
    // sauvegardé alors que le dépôt contient l'ancien texte.
    const manifest = JSON.parse(readFileSync(join(paths.repoDir, 'manifest.json'), 'utf8'))
    expect(manifest.chapters.map((c: { title: string }) => c.title))
      .not.toContain('Écrit pendant la sauvegarde')

    // Et il reste donc en attente, ce qui est la vérité.
    const status = await svc.status()
    expect(status.pending.chaptersAdded).toBe(1)
    expect(status.pending.changedTitles).toEqual(['Écrit pendant la sauvegarde'])
  })
})

describe('createBackupService — instantanés locaux', () => {
  it('prend un instantané frais à chaque run', async () => {
    // Spec §2, étape 1 : jamais le fichier de la veille, sinon un
    // « Sauvegarder maintenant » enverrait l'état d'hier.
    const svc = createBackupService(db, paths)
    await svc.runNow()
    const apresUn = readdirSync(paths.backupsDir).filter((f) => f.endsWith('.db'))
    expect(apresUn).toHaveLength(1)

    createChapter(db, 1, 'Ch. 2')
    await svc.runNow()
    const apresDeux = readdirSync(paths.backupsDir).filter((f) => f.endsWith('.db'))
    expect(apresDeux).toHaveLength(2)
    expect(apresDeux[1]).not.toBe(apresUn[0])
  })

  it('élague les vieux instantanés, y compris ceux d\'un run manuel', async () => {
    mkdirSync(paths.backupsDir, { recursive: true })
    const vieux = join(paths.backupsDir, 'library-2020-01-01T00-00-00-000Z.db')
    const vieuxWal = `${vieux}-wal`
    const jadis = new Date('2020-01-01T00:00:00Z')
    for (const f of [vieux, vieuxWal]) {
      writeFileSync(f, '')
      utimesSync(f, jadis, jadis)
    }

    const svc = createBackupService(db, paths)
    await svc.runNow()

    // pruneBackups ne tournait que dans performBackup, une fois par jour et
    // avant que l'instantané du run distant n'existe : chaque « Sauvegarder
    // maintenant » coûtait 11 Mo pendant 30 jours.
    expect(existsSync(vieux)).toBe(false)
    expect(existsSync(vieuxWal)).toBe(false)
  })
})

describe('createBackupService — runs sans changement', () => {
  it('n\'ajoute pas de commit quand rien n\'a changé', async () => {
    const svc = createBackupService(db, paths)
    const first = await svc.runNow()
    const avant = await runGit(['rev-list', '--count', 'HEAD'], { cwd: paths.repoDir })

    const second = await svc.runNow()
    const apres = await runGit(['rev-list', '--count', 'HEAD'], { cwd: paths.repoDir })

    // Sans ça, trois runs à vide font trois commits qui ne diffèrent que par
    // `generatedAt` : la branche « arbre propre » est du code mort, et
    // « Sauvegardé aujourd'hui » ne porte plus aucune information.
    expect(apres.stdout.trim()).toBe(avant.stdout.trim())
    expect(second.lastCommitAt).toBe(first.lastCommitAt)
  })

  it('commite bien dès qu\'un chapitre change', async () => {
    const svc = createBackupService(db, paths)
    await svc.runNow()
    const avant = await runGit(['rev-list', '--count', 'HEAD'], { cwd: paths.repoDir })

    createChapter(db, 1, 'Ch. 2')
    await svc.runNow()
    const apres = await runGit(['rev-list', '--count', 'HEAD'], { cwd: paths.repoDir })

    expect(Number(apres.stdout.trim())).toBe(Number(avant.stdout.trim()) + 1)
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

  it('mesure le diff en attente sur ce qui est commité, pas sur ce qui est écrit', async () => {
    const svc = createBackupService(db, paths)
    await svc.runNow()

    // `index.lock` resté d'un processus tué : `git add -A` échouera, donc rien
    // ne sera commité — mais le manifeste, lui, sera écrit sur le disque.
    writeFileSync(join(paths.repoDir, '.git', 'index.lock'), '')

    const ch = createChapter(db, 1, 'Ch. 2')
    db.prepare('UPDATE chapters SET content_json = ?, word_count = ? WHERE id = ?')
      .run('{"cinq mille mots":1}', 5000, ch.id)

    const second = await svc.runNow()
    expect(second.lastError).not.toBeNull()

    // Le chapitre n'est dans aucun commit : annoncer « tout est sauvegardé »
    // ici, c'est perdre 5 000 mots en silence et définitivement.
    expect(second.pending.chaptersAdded).toBe(1)
    expect(second.pending.wordsDelta).toBe(5000)

    const later = await svc.status()
    expect(later.pending.chaptersAdded).toBe(1)
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
