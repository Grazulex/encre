import { constants, copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import Database from 'better-sqlite3'
import type { Db } from '../db/connection'
import type { BackupDiff, BackupStatus } from '../../shared/types'
import { backupDatabase } from './local'
import { buildManifest, diffManifests, type Manifest } from './manifest'
import { cloneRepo, commitAll, hasRepo, pushRepo, runGit, GIT_BIN } from './git'
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

/**
 * Manifeste de la dernière sauvegarde **commitée**, ou null si le dépôt n'en a
 * pas encore.
 *
 * Lu dans HEAD et non sur le disque : le fichier posé dans le dossier de
 * travail est écrit par la *tentative* de sauvegarde, pas par sa réussite. Un
 * commit échoué (index.lock resté, disque plein, hook qui refuse) laisserait
 * donc un manifeste à jour en face d'un dépôt inchangé, et « en attente »
 * tomberait à zéro alors que rien n'est protégé. En lisant HEAD, « en attente »
 * signifie « pas encore dans un commit » par construction.
 *
 * `git show` est local : la garantie « status() ne touche jamais au réseau »
 * tient toujours. Un HEAD non né (dépôt fraîchement cloné, aucun commit) fait
 * échouer la commande, donc rend null : tout est en attente, ce qui est exact.
 */
async function repoManifest(repoDir: string): Promise<Manifest | null> {
  const shown = await runGit(['show', 'HEAD:manifest.json'], { cwd: repoDir })
  if (!shown.ok) return null
  try {
    return JSON.parse(shown.stdout) as Manifest
  } catch {
    return null
  }
}

/** Deux manifestes disent-ils la même chose, `generatedAt` mis à part ? */
function sameContent(a: Manifest, b: Manifest): boolean {
  return JSON.stringify({ ...a, generatedAt: '' }) === JSON.stringify({ ...b, generatedAt: '' })
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

  const buildStatus = async (state: BackupState, now: Date): Promise<BackupStatus> => ({
    configured: hasRepo(paths.repoDir) && existsSync(paths.keyPath),
    running,
    missingBinary: missingBinary(),
    lastCommitAt: state.lastCommitAt,
    lastPushAt: state.lastPushAt,
    lastError: state.lastError,
    // Manifeste commité contre base **vivante** : c'est bien l'état courant
    // qu'on mesure ici, pas l'instantané d'un run.
    pending: diffManifests(await repoManifest(paths.repoDir), currentManifest(now)),
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

        const previous = await repoManifest(paths.repoDir)

        // Manifeste construit sur l'instantané figé, et non sur la base
        // vivante : le dump vient de cet instantané, et un chapitre enregistré
        // entre les deux (quelques centaines de millisecondes) figurerait au
        // manifeste sans être dans `library.sql`. Le run suivant ne verrait
        // alors plus aucun changement pour lui — son hash est déjà à jour dans
        // `prev` — et le déclarerait sauvegardé alors que le dépôt contient
        // l'ancien texte. Manifeste et dump doivent décrire le même instant.
        const snapshotDb = new Database(snapshot, { readonly: true })
        let next: Manifest
        try {
          next = buildManifest(snapshotDb, paths.mediaDir, now)
        } finally {
          snapshotDb.close()
        }

        const diff = diffManifests(previous, next)

        // `generatedAt` change à chaque run : réécrit tel quel, le manifeste
        // ferait un commit par sauvegarde même quand rien n'a bougé — la
        // branche « arbre propre » de commitAll serait du code mort et
        // « Sauvegardé aujourd'hui » ne dirait plus rien. Quand le manifeste ne
        // dit rien de neuf, on réécrit celui de HEAD à l'octet près : l'arbre
        // reste propre, aucun commit n'est fabriqué, et le champ reste au
        // format de la spec §5.
        const toWrite = previous && sameContent(previous, next) ? previous : next
        writeFileSync(join(paths.repoDir, 'manifest.json'), JSON.stringify(toWrite, null, 2))

        const { committed, result } = await commitAll(paths.repoDir, commitMessage(now, diff))
        if (committed) {
          state.lastCommitAt = now.toISOString()
          state.lastDiff = diff
        } else if (!result.ok) {
          // `committed: false` recouvre trois cas : `add` échoué, arbre propre,
          // `commit` échoué. Seul l'arbre propre (result.ok) est un non-événement
          // légitime. Confondre les trois pousserait un HEAD inchangé et
          // annoncerait « sauvegardé » alors que rien n'a été enregistré.
          throw new Error(`Commit impossible : ${result.stderr.trim().split('\n').pop() ?? 'erreur inconnue'}`)
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
        // L'état est un confort, pas la sauvegarde : perdre la date du dernier
        // backup est acceptable, perdre la capacité à en refaire un ne l'est
        // pas. Une erreur d'écriture ici (disque plein, permissions) ne doit
        // donc jamais empêcher de relâcher le verrou.
        try {
          writeState(paths.statePath, state)
        } catch (err) {
          console.error(err)
        }
        running = false
      }

      return buildStatus(state, new Date())
    }
  }
}
