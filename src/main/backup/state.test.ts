import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdtempSync, readdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readState, writeState, EMPTY_STATE } from './state'

// `vi.spyOn` ne peut pas redéfinir l'export d'un module natif ESM (« Module
// namespace is not configurable »). Seule échappatoire pour interrompre un
// appel interne à `renameSync` sans changer `state.ts` : remplacer le module
// 'fs' entier, en ne substituant que `renameSync` (par défaut la vraie
// fonction, pour ne pas casser tout ce qui écrit réellement sur disque) et en
// laissant tout le reste intact. `vi.hoisted` est nécessaire car `vi.mock`
// est remonté avant les imports : la variable doit l'être aussi pour être
// capturée par sa factory.
const { renameSync } = vi.hoisted(() => ({ renameSync: vi.fn() }))
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  renameSync.mockImplementation(actual.renameSync)
  return { ...actual, renameSync }
})

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
  it("ne laisse pas de fichier temporaire derrière une écriture réussie, et garde l'état existant intact quand l'écriture est interrompue", () => {
    // Vise l'atomicité elle-même, pas un effet de bord contingent (l'absence
    // de .tmp après un succès isolé) : un `writeFileSync` nu par-dessus le
    // fichier définitif laisserait cette seule vérification passer aussi bien
    // qu'un vrai écrire-puis-renommer, ce qui prouverait tout sauf ce qu'on
    // veut certifier. On interrompt donc en plus précisément l'étape qui
    // bascule le fichier temporaire vers le définitif (`renameSync`), et on
    // vérifie que le fichier définitif — jamais touché tant que le rename n'a
    // pas eu lieu — reste lisible et intact. Une implémentation qui écrirait
    // directement sur le définitif échouerait cette seconde partie : elle
    // n'appelle jamais `renameSync`, donc rien ne lève, et l'assertion
    // `toThrow()` échoue.
    const original = { ...EMPTY_STATE, lastCommitAt: '2026-08-23T20:00:00.000Z' }
    writeState(path, original)
    const dir = path.slice(0, path.lastIndexOf('/'))
    expect(readdirSync(dir)).toEqual(['backup-state.json'])

    renameSync.mockImplementationOnce(() => {
      throw new Error('interruption simulée')
    })
    expect(() =>
      writeState(path, { ...EMPTY_STATE, lastCommitAt: '2026-08-23T21:00:00.000Z' })
    ).toThrow()

    expect(readdirSync(dir)).toEqual(['backup-state.json'])
    expect(readState(path)).toEqual(original)
  })

  it("rend un état vide quand le fichier n'existe pas", () => {
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
        chaptersChanged: 2,
        chaptersAdded: 0,
        chaptersRemoved: 0,
        wordsDelta: 340,
        mediaAdded: 1,
        booksAdded: 0,
        changedTitles: ['A', 'B']
      }
    }
    writeState(path, state)
    expect(readState(path)).toEqual(state)
  })
})
