import type { EncreApi } from '../shared/ipc-contract'

declare global {
  interface Window {
    encre: EncreApi
  }
}
