import { ipcMain } from 'electron'
import type { createApi } from './api'

// Typé sur le retour effectif de createApi (Omit<EncreApi, 'app' | 'ai'> & { ai: MainAi })
// plutôt que sur EncreApi directement : `ai` n'y contient plus onChunk/onDone/onError
// (préload-only), donc la boucle ci-dessous n'a rien de spécial à ignorer pour ce
// domaine — seules ses méthodes invoke (prepareWrite/startWrite/cancel) y figurent.
type MainApi = ReturnType<typeof createApi>

type InvokeMethod = (...args: unknown[]) => unknown
type DomainMethods = MainApi[keyof MainApi] & Record<string, InvokeMethod>

export function registerIpc(api: MainApi): void {
  for (const [domain, methods] of Object.entries(api)) {
    if (domain === 'app') continue
    const domainMethods = methods as DomainMethods
    for (const method of Object.keys(domainMethods)) {
      const fn = domainMethods[method]
      ipcMain.handle(`${domain}:${method}`, (_event, ...args) => fn(...args))
    }
  }
}
