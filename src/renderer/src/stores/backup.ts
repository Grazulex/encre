import { defineStore } from 'pinia'
import type { BackupStatus } from '../../../shared/types'

/** Un seul store pour les deux vues : la Bibliothèque et la barre d'état. */
export const useBackupStore = defineStore('backup', {
  state: () => ({
    status: null as BackupStatus | null,
    busy: false,
    error: null as string | null,
    timer: null as ReturnType<typeof setInterval> | null
  }),
  actions: {
    async refresh() {
      try {
        this.status = await window.encre.backup.status()
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err)
      }
    },
    async runNow() {
      if (this.busy) return
      this.busy = true
      this.error = null
      try {
        this.status = await window.encre.backup.runNow()
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err)
      } finally {
        this.busy = false
      }
    },
    startPolling() {
      if (this.timer) return
      void this.refresh()
      // 60 s : le calcul coûte un SHA-1 sur ~5 Mo, invisible à ce rythme.
      this.timer = setInterval(() => void this.refresh(), 60_000)
    },
    stopPolling() {
      if (this.timer) clearInterval(this.timer)
      this.timer = null
    }
  }
})
