import type { BackupDiff, BackupStatus } from './types'

/**
 * Vocabulaire visuel de la pastille, le même que l'état d'enregistrement
 * voisin dans la barre d'état (spec §9).
 */
export type BackupTone = 'ok' | 'pending' | 'warn' | 'off'

export interface BackupIndicator {
  label: string
  tone: BackupTone
}

/** « 2 chapitres, 1 image en attente ». Vide quand il n'y a rien à envoyer. */
function pendingParts(p: BackupDiff): string[] {
  const parts: string[] = []
  const ch = p.chaptersChanged + p.chaptersAdded + p.chaptersRemoved
  // Chaque grandeur est nommée et aucune n'en masque une autre : « 3 en
  // attente » ne dit pas 3 quoi, et un `ch || mediaAdded` cache le nombre de
  // chapitres dès qu'une image attend aussi.
  if (ch > 0) parts.push(`${ch} chapitre${ch > 1 ? 's' : ''}`)
  if (p.booksAdded > 0) parts.push(`${p.booksAdded} livre${p.booksAdded > 1 ? 's' : ''}`)
  if (p.mediaAdded > 0) parts.push(`${p.mediaAdded} image${p.mediaAdded > 1 ? 's' : ''}`)
  return parts
}

/**
 * Le libellé du voyant de la barre d'état, calculé depuis le `BackupStatus`
 * **complet**.
 *
 * C'est le seul indicateur visible pendant l'écriture : le bloc qui détaille
 * les états dégradés ne vit que sur la route Bibliothèque. Ne lire que
 * `pending` laissait donc afficher « Sauvegardé » après un mois de pushes
 * refusés — le manifeste étant commité, le diff en attente est vide, et rien
 * n'atteignait plus GitHub depuis que le réseau était tombé.
 *
 * Ordre de priorité : l'empêchement structurel d'abord, puis l'échec, puis le
 * retard d'envoi, puis l'incertitude, puis seulement l'issue heureuse.
 *
 * @param stale `true` quand le dernier rafraîchissement a échoué : ce qui est
 *   affiché n'est alors plus l'état courant mais le dernier état connu.
 */
export function backupIndicator(
  status: BackupStatus | null,
  stale: boolean = false
): BackupIndicator | null {
  // Aucun état connu : au tout premier chargement il n'y a rien à dire, mais
  // si le rafraîchissement a échoué, l'absence d'affichage se lirait comme
  // « rien à signaler ».
  if (!status) return stale ? { label: 'Sauvegarde : état inconnu', tone: 'warn' } : null

  if (status.missingBinary || !status.configured)
    return { label: 'Sauvegarde inactive', tone: 'off' }

  if (status.lastError) return { label: 'Sauvegarde en échec', tone: 'warn' }

  // Un commit non poussé se reconnaît au retard de lastPushAt sur
  // lastCommitAt. Tester `lastCommitAt != null` ne marche pas : sync.ts
  // n'avance pas lastCommitAt quand le commit échoue.
  if (
    status.lastCommitAt != null &&
    (status.lastPushAt == null || status.lastPushAt < status.lastCommitAt)
  ) {
    return { label: 'Non envoyé', tone: 'warn' }
  }

  // Après les signaux concrets : ceux-là restent vrais même lus sur un état
  // vieux d'une minute, alors que le diff en attente, lui, ne l'est plus.
  if (stale) return { label: 'Sauvegarde non vérifiée', tone: 'warn' }

  const parts = pendingParts(status.pending)
  if (parts.length === 0) return { label: 'Sauvegardé', tone: 'ok' }
  return { label: `${parts.join(', ')} en attente`, tone: 'pending' }
}
