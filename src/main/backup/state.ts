import { readFileSync, writeFileSync } from 'fs'
import type { BackupDiff } from '../../shared/types'

export interface BackupState {
  lastCommitAt: string | null
  lastPushAt: string | null
  lastError: string | null
  lastDiff: BackupDiff | null
}

export const EMPTY_STATE: BackupState = {
  lastCommitAt: null,
  lastPushAt: null,
  lastError: null,
  lastDiff: null
}

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

export function writeState(path: string, state: BackupState): void {
  writeFileSync(path, JSON.stringify(state, null, 2))
}
