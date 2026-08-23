import { defineStore } from 'pinia'
import type { BackupStatus } from '../../../shared/types'

/** Un seul store pour les deux vues : la Bibliothèque et la barre d'état. */
export const useBackupStore = defineStore('backup', {
  state: () => ({
    status: null as BackupStatus | null,
    busy: false,
    error: null as string | null,
    /** Date du dernier rafraîchissement **réussi**, ISO. */
    lastRefreshAt: null as string | null,
    /**
     * Le dernier rafraîchissement a échoué : ce que porte `status` n'est plus
     * l'état courant mais le dernier état connu. Sans ce drapeau, l'interface
     * continue d'afficher le dernier bon état comme s'il était courant — y
     * compris quand un dossier media illisible fait lever `buildManifest`,
     * cas où l'échec bruyant a été délibérément préféré à un faux « tout est
     * sauvegardé ». Le store le reconvertirait sinon en échec silencieux.
     */
    refreshFailed: false,
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
        // Remis à null : sans ça, une panne passagère épingle une ligne rouge
        // indéfiniment alors que tout est rentré dans l'ordre.
        this.error = null
        this.refreshFailed = false
        this.lastRefreshAt = new Date().toISOString()
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err)
        this.refreshFailed = true
      }
    },
    async runNow() {
      if (this.busy) return
      this.busy = true
      this.error = null
      try {
        this.status = await window.encre.backup.runNow()
        this.refreshFailed = false
        this.lastRefreshAt = new Date().toISOString()
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err)
        this.refreshFailed = true
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
