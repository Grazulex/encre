export interface AiRunParams {
  system: string
  prompt: string
  model: string
}

/**
 * Abstraction sur la génération IA : une implémentation factice suffit pour tester
 * `AiService` sans jamais toucher au SDK réel (voir `createSdkRunner` dans `runner.ts`).
 */
export interface AiRunner {
  /** Résout avec le texte complet ; rejette sur abandon (signal) ou erreur. */
  run(params: AiRunParams, onChunk: (text: string) => void, signal: AbortSignal): Promise<string>
}

export interface AiStartCallbacks {
  onChunk(text: string): void
  onDone(full: string): void
  onError(message: string): void
}

const GENERIC_ERROR_MESSAGE = 'Claude est indisponible — réessayez.'
const ABORT_ERROR_MESSAGE = 'Génération annulée.'

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError'
}

/**
 * Isole l'appel d'un callback fourni par l'appelant : si `onChunk`/`onDone`/`onError`
 * lève, l'exception ne doit jamais se propager dans la chaîne de promesses interne
 * (elle ferait alors basculer un `.then` réussi vers le `.catch` d'erreur, ou produire
 * un rejet non intercepté depuis le `.catch` lui-même). On journalise et on continue.
 */
function safeInvoke(name: string, fn: () => void): void {
  try {
    fn()
  } catch (error) {
    console.error(`AiService: le callback "${name}" a levé une exception`, error)
  }
}

/**
 * Registre requestId → AbortController + traduction des erreurs du runner en messages
 * français lisibles par l'utilisateur.
 */
export class AiService {
  private readonly controllers = new Map<string, AbortController>()

  constructor(private readonly runner: AiRunner) {}

  start(params: AiRunParams, callbacks: AiStartCallbacks): string {
    const requestId = crypto.randomUUID()
    const controller = new AbortController()
    this.controllers.set(requestId, controller)

    const onChunk = (text: string): void => safeInvoke('onChunk', () => callbacks.onChunk(text))

    this.runner
      .run(params, onChunk, controller.signal)
      .then((full) => {
        this.controllers.delete(requestId)
        safeInvoke('onDone', () => callbacks.onDone(full))
      })
      .catch((error: unknown) => {
        this.controllers.delete(requestId)
        const message = isAbortError(error) ? ABORT_ERROR_MESSAGE : GENERIC_ERROR_MESSAGE
        safeInvoke('onError', () => callbacks.onError(message))
      })

    return requestId
  }

  cancel(requestId: string): void {
    const controller = this.controllers.get(requestId)
    if (!controller) return
    controller.abort()
  }
}
