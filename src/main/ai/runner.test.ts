import { describe, it, expect } from 'vitest'
import { resultFromMessage } from './runner'

// Importer `runner.ts` ne charge PAS le SDK réel : `createSdkRunner` fait un import
// dynamique du SDK à l'intérieur de `run()`, jamais exécuté ici puisqu'on ne teste que
// la fonction pure `resultFromMessage`.

describe('resultFromMessage', () => {
  it('renvoie le texte final sur un vrai succès (subtype success, is_error false)', () => {
    expect(resultFromMessage({ subtype: 'success', is_error: false, result: 'Il était une fois.' })).toBe(
      'Il était une fois.'
    )
  })

  it("lève quand subtype est 'success' mais is_error est true (result contient le texte d'erreur, pas de la prose)", () => {
    expect(() => resultFromMessage({ subtype: 'success', is_error: true, result: 'boom' })).toThrow('boom')
  })

  it("lève avec un message par défaut si subtype 'success' + is_error true sans texte", () => {
    expect(() => resultFromMessage({ subtype: 'success', is_error: true })).toThrow('Erreur de génération Claude.')
  })

  it("lève avec le détail de errors pour un subtype d'échec (ex. error_during_execution)", () => {
    expect(() =>
      resultFromMessage({ subtype: 'error_during_execution', is_error: true, errors: ['panne réseau', 'retry épuisé'] })
    ).toThrow('panne réseau; retry épuisé')
  })

  it("lève avec le message par défaut pour un subtype d'échec sans errors", () => {
    expect(() => resultFromMessage({ subtype: 'error_max_turns', is_error: true })).toThrow('Erreur de génération Claude.')
  })
})
