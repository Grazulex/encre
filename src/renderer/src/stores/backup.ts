import { defineStore } from 'pinia'
import type { BackupStatus } from '../../../shared/types'

/** Un seul store pour les deux vues : la Bibliothèque et la barre d'état. */
export const useBackupStore = defineStore('backup', {
  state: () => ({
    status: null as BackupStatus | null,
    busy: false,
    error: null as string | null,
    timer: null as ReturnType<typeof setInterval> | null,
    // Compteur de vues abonnées au polling (BackupPanel dans la Bibliothèque,
    // le voyant dans la barre d'état). stopPolling() ne coupe la minuterie
    // qu'au retour à zéro : sinon, sur une transition de route où le
    // composant entrant se monte avant que le sortant ne se démonte, le
    // stopPolling() du sortant tuerait le rafraîchissement de l'entrant, qui
    // se retrouverait figé sans aucun signe visible du problème.
    pollingRefs: 0
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
      this.pollingRefs++
      if (this.timer) return
      void this.refresh()
      // 60 s : le calcul coûte un SHA-1 sur ~5 Mo, invisible à ce rythme.
      this.timer = setInterval(() => void this.refresh(), 60_000)
    },
    stopPolling() {
      // Ne jamais descendre sous zéro : un stopPolling() sans startPolling()
      // préalable (ou un double appel) ne doit pas rendre le compteur négatif,
      // ce qui empêcherait tout futur startPolling() de relancer la minuterie.
      this.pollingRefs = Math.max(0, this.pollingRefs - 1)
      if (this.pollingRefs > 0) return
      if (this.timer) clearInterval(this.timer)
      this.timer = null
    }
  }
})
