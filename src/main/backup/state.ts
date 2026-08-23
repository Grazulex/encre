import { readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import type { BackupDiff } from '../../shared/types'

export interface BackupState {
  lastCommitAt: string | null
  lastPushAt: string | null
  lastError: string | null
  lastDiff: BackupDiff | null
}

/**
 * Gelé : les appelants (dont `sync.ts`) mutent l'état reçu en place. Si la
 * constante venait à fuir au lieu d'une copie, ce singleton serait corrompu
 * pour tous les appels suivants, en silence. Le gel transforme cette classe de
 * bug — qui a déjà frappé ici — en erreur immédiate.
 */
export const EMPTY_STATE: BackupState = Object.freeze({
  lastCommitAt: null,
  lastPushAt: null,
  lastError: null,
  lastDiff: null
})

/**
 * Ne lève jamais. Un fichier d'état corrompu doit coûter la date du dernier
 * backup, jamais le démarrage de l'app.
 *
 * Rend toujours une copie fraîche, jamais la constante `EMPTY_STATE` elle-même :
 * les appelants (dont `sync.ts`) mutent l'objet reçu en place, ce qui
 * corromprait ce singleton partagé pour tous les appels suivants.
 */
export function readState(path: string): BackupState {
  try {
    return { ...EMPTY_STATE, ...JSON.parse(readFileSync(path, 'utf8')) }
  } catch {
    return { ...EMPTY_STATE }
  }
}

/**
 * Écrit-puis-renomme : `writeFileSync` n'est pas atomique, et un plantage en
 * cours d'écriture laisserait du JSON tronqué — donc un état illisible. Le
 * fichier temporaire est voisin du définitif, sur le même système de fichiers,
 * pour que le `rename` soit bien atomique.
 */
export function writeState(path: string, state: BackupState): void {
  const tmp = `${path}.tmp`
  try {
    writeFileSync(tmp, JSON.stringify(state, null, 2))
    renameSync(tmp, path)
  } catch (err) {
    rmSync(tmp, { force: true })
    throw err
  }
}
