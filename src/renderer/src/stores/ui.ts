import { defineStore } from 'pinia'

let nextToastId = 1

export const useUiStore = defineStore('ui', {
  state: () => ({
    toasts: [] as { id: number; message: string }[],
    quitFlusher: null as (() => Promise<void>) | null
  }),
  actions: {
    toast(message: string) {
      const id = nextToastId++
      this.toasts.push({ id, message })
      setTimeout(() => {
        this.toasts = this.toasts.filter((t) => t.id !== id)
      }, 5000)
    },
    registerQuitFlusher(fn: (() => Promise<void>) | null) {
      this.quitFlusher = fn
    },
    async runQuitFlush() {
      try {
        await this.quitFlusher?.()
      } catch (err) {
        console.error('Flush de fermeture échoué', err)
      }
    }
  }
})
