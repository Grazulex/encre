import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Db } from '../db/connection'
import type { BackupDiff, BackupStatus } from '../../shared/types'
import { backupDatabase } from './local'
import { buildManifest, diffManifests, type Manifest } from './manifest'
import { cloneRepo, commitAll, hasRepo, pushRepo, GIT_BIN } from './git'
import { dumpDatabase, SQLITE_BIN } from './dump'
import { readState, writeState, type BackupState } from './state'

export interface BackupPaths {
  repoDir: string
  mediaDir: string
  backupsDir: string
  keyPath: string
  statePath: string
  remoteUrl: string
}

export interface BackupService {
  status(): Promise<BackupStatus>
  runNow(): Promise<BackupStatus>
}

const nf = new Intl.NumberFormat('fr-FR')

// Selon la version d'ICU, le séparateur de milliers fr-FR est une espace
// insécable fine (U+202F) plutôt qu'une espace normale : illisible dans un
// terminal ou un `git log` qui ne la rend pas. On la ramène à une espace ASCII.
function formatWords(n: number): string {
  return nf.format(n).replace(/[  ]/g, ' ')
}

export function commitMessage(now: Date, diff: BackupDiff): string {
  const stamp = now.toISOString().slice(0, 16).replace('T', ' ')
  const parts: string[] = []
  const chapters = diff.chaptersChanged + diff.chaptersAdded + diff.chaptersRemoved
  if (chapters > 0) parts.push(`${chapters} chapitre${chapters > 1 ? 's' : ''}`)
  if (diff.wordsDelta !== 0) {
    parts.push(`${diff.wordsDelta > 0 ? '+' : '−'}${formatWords(Math.abs(diff.wordsDelta))} mots`)
  }
  if (diff.mediaAdded > 0) parts.push(`${diff.mediaAdded} image${diff.mediaAdded > 1 ? 's' : ''}`)
  return parts.length > 0 ? `sauvegarde ${stamp} — ${parts.join(', ')}` : `sauvegarde ${stamp}`
}

/** Manifeste de la dernière sauvegarde, ou null si le dépôt n'en a pas encore. */
function repoManifest(repoDir: string): Manifest | null {
  try {
    return JSON.parse(readFileSync(join(repoDir, 'manifest.json'), 'utf8')) as Manifest
  } catch {
    return null
  }
}

/**
 * Copie les fichiers absents du dépôt, en clone APFS : `COPYFILE_FICLONE`
 * partage les blocs au lieu de les dupliquer, donc la copie de travail ne
 * coûte quasiment aucun octet. Retombe sur une copie normale si le système de
 * fichiers ne sait pas cloner.
 *
 * N'efface jamais : un média retiré de la bibliothèque reste dans la
 * sauvegarde, c'est tout l'intérêt d'une sauvegarde.
 */
function syncMedia(mediaDir: string, repoMediaDir: string): void {
  mkdirSync(repoMediaDir, { recursive: true })
  let files: string[] = []
  try {
    files = readdirSync(mediaDir)
  } catch {
    return
  }
  for (const f of files) {
    const dest = join(repoMediaDir, f)
    if (existsSync(dest)) continue
    copyFileSync(join(mediaDir, f), dest, constants.COPYFILE_FICLONE)
  }
}

export function createBackupService(db: Db, paths: BackupPaths): BackupService {
  let running = false

  const currentManifest = (now: Date): Manifest => buildManifest(db, paths.mediaDir, now)

  // Spec §4 : git et sqlite3 vivent dans /usr/bin, présent dans le PATH minimal
  // d'une app lancée depuis le Finder. On vérifie quand même : un message clair
  // vaut mieux qu'un échec de spawn incompréhensible pour l'utilisateur.
  const missingBinary = (): string | null => {
    if (!existsSync(GIT_BIN)) return GIT_BIN
    if (!existsSync(SQLITE_BIN)) return SQLITE_BIN
    return null
  }

  const buildStatus = (state: BackupState, now: Date): BackupStatus => ({
    configured: hasRepo(paths.repoDir) && existsSync(paths.keyPath),
    running,
    missingBinary: missingBinary(),
    lastCommitAt: state.lastCommitAt,
    lastPushAt: state.lastPushAt,
    lastError: state.lastError,
    pending: diffManifests(repoManifest(paths.repoDir), currentManifest(now)),
    lastDiff: state.lastDiff
  })

  return {
    async status() {
      return buildStatus(readState(paths.statePath), new Date())
    },

    async runNow() {
      // Verrou et non file d'attente : deux sauvegardes simultanées se
      // marcheraient dessus dans le même dossier de travail.
      if (running) throw new Error('Une sauvegarde est déjà en cours.')
      running = true
      const now = new Date()
      const state = readState(paths.statePath)

      try {
        const missing = missingBinary()
        if (missing) throw new Error(`Binaire introuvable : ${missing}`)

        if (!hasRepo(paths.repoDir)) {
          mkdirSync(join(paths.repoDir, '..'), { recursive: true })
          const cloned = await cloneRepo(paths.remoteUrl, paths.repoDir, paths.keyPath)
          if (!cloned.ok) throw new Error(`Clone impossible : ${cloned.stderr.trim()}`)
        }

        // Instantané frais, jamais le fichier de la veille : sans ça un
        // « Sauvegarder maintenant » enverrait l'état d'hier.
        const snapshot = await backupDatabase(db, paths.backupsDir, now)
        await dumpDatabase(snapshot, join(paths.repoDir, 'library.sql'))

        syncMedia(paths.mediaDir, join(paths.repoDir, 'media'))

        const previous = repoManifest(paths.repoDir)
        const next = currentManifest(now)
        const diff = diffManifests(previous, next)
        writeFileSync(join(paths.repoDir, 'manifest.json'), JSON.stringify(next, null, 2))

        const { committed } = await commitAll(paths.repoDir, commitMessage(now, diff))
        if (committed) {
          state.lastCommitAt = now.toISOString()
          state.lastDiff = diff
        }

        const pushed = await pushRepo(paths.repoDir, paths.keyPath)
        if (pushed.ok) {
          state.lastPushAt = now.toISOString()
          state.lastError = null
        } else {
          // Demi-victoire : le commit local tient, le travail est figé. On le
          // dit sans effacer lastCommitAt ni faire reculer lastPushAt.
          state.lastError = `Envoi impossible : ${pushed.stderr.trim().split('\n').pop() ?? 'erreur inconnue'}`
        }
      } catch (err) {
        state.lastError = err instanceof Error ? err.message : String(err)
      } finally {
        writeState(paths.statePath, state)
        running = false
      }

      return buildStatus(state, new Date())
    }
  }
}
