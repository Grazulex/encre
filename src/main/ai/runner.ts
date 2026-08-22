import type { AiRunner } from './service'

/**
 * Runner IA basé sur `@anthropic-ai/claude-agent-sdk`. L'import du SDK est fait à
 * l'intérieur de `run()` (jamais au niveau module) pour que ce fichier reste
 * importable par vitest sans jamais charger le SDK réel — les tests de `AiService`
 * utilisent un `AiRunner` factice et n'importent jamais ce module.
 *
 * Génération sans outils, en un seul tour : `allowedTools: []`, `maxTurns: 1`.
 * L'authentification passe par le login Claude Code de la machine (aucun secret ici).
 */
export function createSdkRunner(): AiRunner {
  return {
    async run(params, onChunk, signal) {
      if (signal.aborted) {
        throw new DOMException('Génération annulée.', 'AbortError')
      }

      const { query } = await import('@anthropic-ai/claude-agent-sdk')

      // `query()` prend un AbortController (pas juste un signal) : on en crée un dédié
      // à cet appel et on le relie au signal externe fourni par AiService.
      const queryAbortController = new AbortController()
      const forwardAbort = (): void => queryAbortController.abort()
      signal.addEventListener('abort', forwardAbort)

      let full = ''

      try {
        const stream = query({
          prompt: params.prompt,
          options: {
            systemPrompt: params.system,
            model: params.model,
            allowedTools: [],
            maxTurns: 1,
            includePartialMessages: true,
            abortController: queryAbortController
          }
        })

        for await (const message of stream) {
          // Deltas de texte en streaming : `stream_event` porte un événement brut de
          // l'API Messages (message_start / content_block_delta / ... / message_stop).
          if (message.type === 'stream_event') {
            const event = message.event
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              onChunk(event.delta.text)
            }
            continue
          }

          // Un seul message 'result' par tour : porte le texte final (succès) ou
          // signale l'échec du tour (erreur API, max_turns, etc.).
          if (message.type === 'result') {
            if (message.subtype === 'success') {
              full = message.result
            } else {
              throw new Error(message.errors.join('; ') || 'Erreur de génération Claude.')
            }
          }
        }
      } catch (error) {
        // Le SDK ne garantit pas que l'erreur d'abandon porte `name === 'AbortError'` ;
        // on normalise nous-mêmes dès que le signal externe a été déclenché, pour que
        // AiService distingue toujours annulation vs vraie erreur.
        if (signal.aborted) {
          throw new DOMException('Génération annulée.', 'AbortError')
        }
        throw error
      } finally {
        signal.removeEventListener('abort', forwardAbort)
      }

      if (signal.aborted) {
        throw new DOMException('Génération annulée.', 'AbortError')
      }

      return full
    }
  }
}
