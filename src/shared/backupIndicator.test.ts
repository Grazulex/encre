import { describe, it, expect } from 'vitest'
import { backupIndicator } from './backupIndicator'
import type { BackupDiff, BackupStatus } from './types'

const RIEN: BackupDiff = {
  chaptersChanged: 0,
  chaptersAdded: 0,
  chaptersRemoved: 0,
  wordsDelta: 0,
  mediaAdded: 0,
  booksAdded: 0,
  changedTitles: []
}

function statut(patch: Partial<BackupStatus> = {}): BackupStatus {
  return {
    configured: true,
    running: false,
    missingBinary: null,
    lastCommitAt: '2026-08-23T18:00:00.000Z',
    lastPushAt: '2026-08-23T18:00:00.000Z',
    lastError: null,
    pending: RIEN,
    lastDiff: null,
    ...patch
  }
}

describe('backupIndicator — états dégradés (spec §9)', () => {
  it('dit « inactive » quand un binaire manque', () => {
    expect(backupIndicator(statut({ missingBinary: '/usr/bin/git' }))).toEqual({
      label: 'Sauvegarde inactive',
      tone: 'off'
    })
  })

  it("dit « inactive » quand la sauvegarde n'est pas configurée", () => {
    expect(backupIndicator(statut({ configured: false }))?.label).toBe('Sauvegarde inactive')
  })

  it('dit « en échec » quand une erreur est enregistrée', () => {
    expect(backupIndicator(statut({ lastError: 'Envoi impossible : réseau' }))).toEqual({
      label: 'Sauvegarde en échec',
      tone: 'warn'
    })
  })

  it('dit « non envoyé » quand le push est en retard sur le commit', () => {
    // Le scénario qui a motivé la correction : un mois de pushes refusés
    // laisse le manifeste commité, donc rien en attente, donc « Sauvegardé ».
    const s = statut({
      lastCommitAt: '2026-08-23T18:00:00.000Z',
      lastPushAt: '2026-07-23T18:00:00.000Z'
    })
    expect(backupIndicator(s)).toEqual({ label: 'Non envoyé', tone: 'warn' })
  })

  it("dit « non envoyé » quand rien n'a jamais été poussé", () => {
    expect(backupIndicator(statut({ lastPushAt: null }))?.label).toBe('Non envoyé')
  })

  it('ne crie pas « non envoyé » avant la toute première sauvegarde', () => {
    // lastCommitAt null : rien n'a jamais été commité, il n'y a donc aucun
    // commit en retard d'envoi.
    const s = statut({ lastCommitAt: null, lastPushAt: null })
    expect(backupIndicator(s)?.label).toBe('Sauvegardé')
  })

  it("l'empêchement structurel prime sur l'erreur, qui prime sur le retard", () => {
    const tout = statut({
      configured: false,
      missingBinary: '/usr/bin/sqlite3',
      lastError: 'boum',
      lastPushAt: null,
      pending: { ...RIEN, chaptersAdded: 3 }
    })
    expect(backupIndicator(tout)?.label).toBe('Sauvegarde inactive')
    expect(backupIndicator({ ...tout, configured: true, missingBinary: null })?.label).toBe(
      'Sauvegarde en échec'
    )
    expect(
      backupIndicator({ ...tout, configured: true, missingBinary: null, lastError: null })?.label
    ).toBe('Non envoyé')
  })
})

describe('backupIndicator — état périmé', () => {
  it("signale un rafraîchissement en échec plutôt que de faire passer l'ancien état pour courant", () => {
    expect(backupIndicator(statut(), true)).toEqual({
      label: 'Sauvegarde non vérifiée',
      tone: 'warn'
    })
  })

  it("n'affiche rien tant qu'aucun état n'est chargé", () => {
    expect(backupIndicator(null)).toBeNull()
  })

  it('mais le dit quand le tout premier rafraîchissement a échoué', () => {
    expect(backupIndicator(null, true)).toEqual({
      label: 'Sauvegarde : état inconnu',
      tone: 'warn'
    })
  })

  it("laisse les signaux concrets passer devant l'incertitude", () => {
    expect(backupIndicator(statut({ lastError: 'boum' }), true)?.label).toBe('Sauvegarde en échec')
  })
})

describe('backupIndicator — diff en attente', () => {
  it("dit « Sauvegardé » quand il n'y a rien à envoyer", () => {
    expect(backupIndicator(statut())).toEqual({ label: 'Sauvegardé', tone: 'ok' })
  })

  it('nomme ce qui attend, sans en masquer une partie', () => {
    // `${ch || p.mediaAdded} en attente` cachait le nombre de chapitres dès
    // qu'une image attendait aussi — et ne disait pas de quoi il s'agissait.
    const s = statut({
      pending: { ...RIEN, chaptersChanged: 2, chaptersAdded: 1, mediaAdded: 4 }
    })
    expect(backupIndicator(s)).toEqual({
      label: '3 chapitres, 4 images en attente',
      tone: 'pending'
    })
  })

  it('accorde le singulier', () => {
    expect(backupIndicator(statut({ pending: { ...RIEN, chaptersAdded: 1 } }))?.label).toBe(
      '1 chapitre en attente'
    )
    expect(backupIndicator(statut({ pending: { ...RIEN, mediaAdded: 1 } }))?.label).toBe(
      '1 image en attente'
    )
  })

  it('compte aussi les chapitres supprimés', () => {
    expect(backupIndicator(statut({ pending: { ...RIEN, chaptersRemoved: 2 } }))?.label).toBe(
      '2 chapitres en attente'
    )
  })

  it('ne dit pas « Sauvegardé » sur un livre neuf encore vide', () => {
    expect(backupIndicator(statut({ pending: { ...RIEN, booksAdded: 1 } }))?.label).toBe(
      '1 livre en attente'
    )
  })
})
