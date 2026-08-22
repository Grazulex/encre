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

    this.runner
      .run(params, callbacks.onChunk, controller.signal)
      .then((full) => {
        this.controllers.delete(requestId)
        callbacks.onDone(full)
      })
      .catch((error: unknown) => {
        this.controllers.delete(requestId)
        callbacks.onError(isAbortError(error) ? ABORT_ERROR_MESSAGE : GENERIC_ERROR_MESSAGE)
      })

    return requestId
  }

  cancel(requestId: string): void {
    const controller = this.controllers.get(requestId)
    if (!controller) return
    controller.abort()
  }
}
