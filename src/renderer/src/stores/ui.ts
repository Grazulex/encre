import { defineStore } from 'pinia'

let nextToastId = 1
let nextFlusherId = 1

export const useUiStore = defineStore('ui', {
  state: () => ({
    toasts: [] as { id: number; message: string }[],
    // Plusieurs composants à commits debouncés (EditorPane : corps + résumé +
    // notes ; EntityCard ; TimelineEventCard) doivent chacun pouvoir garantir
    // que leur dernier commit en attente (< 600 ms) part avant que l'app ne
    // se ferme réellement — d'où une Map de flushers indexée par un id
    // d'abonnement plutôt qu'un flusher unique remplacé à chaque montage.
    quitFlushers: new Map<number, () => Promise<void> | void>()
  }),
  actions: {
    toast(message: string) {
      const id = nextToastId++
      this.toasts.push({ id, message })
      setTimeout(() => {
        this.toasts = this.toasts.filter((t) => t.id !== id)
      }, 5000)
    },
    // Retourne le désabonnement : chaque composant appelle addQuitFlusher au
    // montage et le désabonnement au démontage, pour ne jamais laisser un
    // flusher appeler une instance démontée (plusieurs instances du même
    // composant peuvent coexister — EntityCard réutilisé, TimelineEventCard
    // par carte — chacune avec son propre abonnement).
    addQuitFlusher(fn: () => Promise<void> | void): () => void {
      const id = nextFlusherId++
      this.quitFlushers.set(id, fn)
      return () => {
        this.quitFlushers.delete(id)
      }
    },
    async runQuitFlush() {
      const results = await Promise.allSettled(
        Array.from(this.quitFlushers.values()).map((fn) => fn())
      )
      for (const result of results) {
        if (result.status === 'rejected') {
          console.error('Flush de fermeture échoué', result.reason)
        }
      }
    }
  }
})
