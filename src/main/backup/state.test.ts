import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, readdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readState, writeState, EMPTY_STATE } from './state'

let path: string
beforeEach(() => {
  path = join(mkdtempSync(join(tmpdir(), 'encre-state-')), 'backup-state.json')
})

describe('EMPTY_STATE', () => {
  it('est gelé', () => {
    // Défense permanente contre le bug d'aliasing qui a déjà frappé ici : les
    // appelants mutent l'état reçu en place. Une fuite de la constante
    // corromprait ce singleton pour tous les appels suivants — en silence.
    expect(Object.isFrozen(EMPTY_STATE)).toBe(true)
  })
})

describe('readState / writeState', () => {
  it('ne laisse pas de fichier temporaire derrière une écriture réussie', () => {
    writeState(path, { ...EMPTY_STATE, lastCommitAt: '2026-08-23T20:00:00.000Z' })
    const dir = path.slice(0, path.lastIndexOf('/'))
    expect(readdirSync(dir)).toEqual(['backup-state.json'])
  })

  it('rend un état vide quand le fichier n\'existe pas', () => {
    expect(readState(path)).toEqual(EMPTY_STATE)
  })

  it('rend un état vide plutôt que de lever sur un fichier corrompu', () => {
    // Un état illisible ne doit jamais empêcher l'app de démarrer : au pire on
    // reperd la date du dernier backup, jamais des données.
    writeFileSync(path, '{ pas du json')
    expect(readState(path)).toEqual(EMPTY_STATE)
  })

  it('relit ce qui a été écrit', () => {
    const state = {
      lastCommitAt: '2026-08-23T20:00:00.000Z',
      lastPushAt: null,
      lastError: 'réseau injoignable',
      lastDiff: {
        chaptersChanged: 2, chaptersAdded: 0, chaptersRemoved: 0,
        wordsDelta: 340, mediaAdded: 1, booksAdded: 0, changedTitles: ['A', 'B']
      }
    }
    writeState(path, state)
    expect(readState(path)).toEqual(state)
  })
})
