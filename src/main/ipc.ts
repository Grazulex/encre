import { ipcMain } from 'electron'
import type { EncreApi } from '../shared/ipc-contract'

export function registerIpc(api: Omit<EncreApi, 'app'>): void {
  for (const [domain, methods] of Object.entries(api)) {
    if (domain === 'app') continue
    for (const [method, fn] of Object.entries(methods as Record<string, Function>)) {
      ipcMain.handle(`${domain}:${method}`, (_event, ...args) => fn(...args))
    }
  }
}
