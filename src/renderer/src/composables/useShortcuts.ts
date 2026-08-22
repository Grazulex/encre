import { onMounted, onBeforeUnmount } from 'vue'

export interface Shortcut {
  combo: string // ex. 'meta+shift+f', 'meta+alt+arrowdown'
  handler: () => void
}

function comboOf(event: KeyboardEvent): string {
  const parts: string[] = []
  if (event.metaKey) parts.push('meta')
  if (event.ctrlKey) parts.push('ctrl')
  if (event.altKey) parts.push('alt')
  if (event.shiftKey) parts.push('shift')
  parts.push(event.key.toLowerCase())
  return parts.join('+')
}

export function useShortcuts(bindings: Shortcut[]): void {
  const onKeydown = (event: KeyboardEvent): void => {
    const combo = comboOf(event)
    const match = bindings.find((b) => b.combo === combo)
    if (match) {
      event.preventDefault()
      match.handler()
    }
  }
  onMounted(() => window.addEventListener('keydown', onKeydown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
}
