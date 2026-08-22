import { describe, it, expect, vi } from 'vitest'
import { AiService, type AiRunner } from './service'

function makeStreamingRunner(chunks: string[]): AiRunner {
  return {
    run: async (_params, onChunk, signal) => {
      for (const chunk of chunks) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
        onChunk(chunk)
      }
      return chunks.join('')
    }
  }
}

function makeRejectingRunner(error: unknown): AiRunner {
  return {
    run: async () => {
      throw error
    }
  }
}

function makeAbortableRunner(): AiRunner {
  return {
    run: (_params, _onChunk, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
  }
}

const params = { system: 'system', prompt: 'prompt', model: 'claude-x' }

describe('AiService', () => {
  it('accumule les chunks émis par le runner et appelle onDone avec le texte complet', async () => {
    const runner = makeStreamingRunner(['Il était ', 'une fois ', 'un chapitre.'])
    const service = new AiService(runner)
    const chunks: string[] = []
    let done: string | undefined
    let error: string | undefined

    await new Promise<void>((resolve) => {
      service.start(params, {
        onChunk: (text) => chunks.push(text),
        onDone: (full) => {
          done = full
          resolve()
        },
        onError: (message) => {
          error = message
          resolve()
        }
      })
    })

    expect(chunks).toEqual(['Il était ', 'une fois ', 'un chapitre.'])
    expect(done).toBe('Il était une fois un chapitre.')
    expect(error).toBeUndefined()
  })

  it('retourne un requestId à chaque appel de start', () => {
    const service = new AiService(makeStreamingRunner(['a']))
    const id1 = service.start(params, { onChunk: () => {}, onDone: () => {}, onError: () => {} })
    const id2 = service.start(params, { onChunk: () => {}, onDone: () => {}, onError: () => {} })
    expect(id1).toBeTypeOf('string')
    expect(id1).not.toBe(id2)
  })

  it("traduit une erreur du runner en message français lisible via onError", async () => {
    const runner = makeRejectingRunner(new Error('network boom'))
    const service = new AiService(runner)
    let error: string | undefined

    await new Promise<void>((resolve) => {
      service.start(params, {
        onChunk: () => {},
        onDone: () => resolve(),
        onError: (message) => {
          error = message
          resolve()
        }
      })
    })

    expect(error).toBe('Claude est indisponible — réessayez.')
  })

  it('cancel() abandonne la génération en cours et déclenche onError avec le message d\'annulation', async () => {
    const runner = makeAbortableRunner()
    const service = new AiService(runner)
    let error: string | undefined
    let done = false

    const promise = new Promise<void>((resolve) => {
      const requestId = service.start(params, {
        onChunk: () => {},
        onDone: () => {
          done = true
          resolve()
        },
        onError: (message) => {
          error = message
          resolve()
        }
      })
      service.cancel(requestId)
    })

    await promise

    expect(error).toBe('Génération annulée.')
    expect(done).toBe(false)
  })

  it('cancel() sur un requestId inconnu ne lève pas', () => {
    const service = new AiService(makeStreamingRunner(['a']))
    expect(() => service.cancel('inconnu')).not.toThrow()
  })

  it('nettoie le registre après la fin de la génération (cancel post-hoc ne fait rien)', async () => {
    const runner = makeStreamingRunner(['a', 'b'])
    const service = new AiService(runner)
    const abortSpy = vi.fn()

    let requestId = ''
    await new Promise<void>((resolve) => {
      requestId = service.start(params, {
        onChunk: () => {},
        onDone: () => resolve(),
        onError: () => resolve()
      })
    })

    // Le requestId ne doit plus être dans le registre : cancel() est un no-op silencieux.
    expect(() => service.cancel(requestId)).not.toThrow()
    expect(abortSpy).not.toHaveBeenCalled()
  })

  it("une exception dans onDone est isolée : onError n'est pas appelé et rien ne fuit en rejet non intercepté", async () => {
    const runner = makeStreamingRunner(['a'])
    const service = new AiService(runner)
    const onError = vi.fn()
    const unhandled: unknown[] = []
    const onUnhandledRejection = (reason: unknown): void => {
      unhandled.push(reason)
    }
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    process.on('unhandledRejection', onUnhandledRejection)

    try {
      service.start(params, {
        onChunk: () => {},
        onDone: () => {
          throw new Error('onDone boom')
        },
        onError
      })
      // start() est fire-and-forget : laisser la chaîne de promesses internes se
      // dérouler complètement (y compris le tour d'event-loop où Node signalerait un
      // rejet non intercepté) avant d'observer les assertions.
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(onError).not.toHaveBeenCalled()
      expect(unhandled).toEqual([])
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('onDone'), expect.any(Error))
    } finally {
      // Les assertions doivent s'exécuter AVANT mockRestore() : restaurer un spy efface
      // son historique d'appels (mock.calls), donc l'inverse ferait passer le test à tort.
      process.off('unhandledRejection', onUnhandledRejection)
      consoleErrorSpy.mockRestore()
    }
  })

  it("une exception dans onError (après une erreur du runner) est isolée : rien ne fuit en rejet non intercepté", async () => {
    const runner = makeRejectingRunner(new Error('network boom'))
    const service = new AiService(runner)
    const unhandled: unknown[] = []
    const onUnhandledRejection = (reason: unknown): void => {
      unhandled.push(reason)
    }
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    process.on('unhandledRejection', onUnhandledRejection)

    try {
      service.start(params, {
        onChunk: () => {},
        onDone: () => {},
        onError: () => {
          throw new Error('onError boom')
        }
      })
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(unhandled).toEqual([])
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('onError'), expect.any(Error))
    } finally {
      process.off('unhandledRejection', onUnhandledRejection)
      consoleErrorSpy.mockRestore()
    }
  })
})
