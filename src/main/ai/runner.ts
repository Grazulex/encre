import type { AiRunner } from './service'

/**
 * Forme structurelle du message `type: 'result'` du SDK (sans en dépendre au niveau
 * type import — les deux membres réels de l'union `SDKResultMessage` sont assignables
 * à ce sous-ensemble de champs). Exportée + `resultFromMessage` testable en isolation,
 * sans jamais importer le SDK réel.
 */
export interface SdkResultMessage {
  subtype: string
  is_error: boolean
  result?: string
  errors?: string[]
}

/**
 * Extrait le texte final d'un message `type: 'result'`, ou lève si le tour a échoué.
 *
 * `subtype === 'success'` ne suffit PAS à lui seul : le SDK peut renvoyer un succès de
 * tour (`subtype: 'success'`) avec `is_error: true`, auquel cas `result` contient le
 * texte de l'ERREUR et non du texte généré (cf. sdk.d.ts, `SDKResultSuccess.is_error`).
 * Sans ce garde, ce texte d'erreur serait renvoyé comme si c'était de la prose générée.
 */
export function resultFromMessage(message: SdkResultMessage): string {
  if (message.subtype === 'success' && !message.is_error) {
    return message.result ?? ''
  }
  const detail = message.subtype === 'success' ? message.result : message.errors?.join('; ')
  throw new Error(detail || 'Erreur de génération Claude.')
}

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

          // Un seul message 'result' par tour : porte le texte final (succès réel) ou
          // signale l'échec du tour (erreur API, max_turns, succès marqué is_error, etc.).
          if (message.type === 'result') {
            full = resultFromMessage(message)
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
