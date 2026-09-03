// Nœud TipTap minimal : seul le repérage des mentions est lu ici.
interface TipTapMentionNode {
  type?: string
  attrs?: { id?: number }
  content?: TipTapMentionNode[]
}

export function extractMentionIds(contentJson: string): number[] {
  const seen = new Set<number>()
  const walk = (node: TipTapMentionNode): void => {
    if (!node || typeof node !== 'object') return
    if (
      node.type === 'mention' &&
      node.attrs &&
      typeof node.attrs.id === 'number' &&
      Number.isInteger(node.attrs.id)
    ) {
      seen.add(node.attrs.id)
    }
    if (Array.isArray(node.content)) node.content.forEach(walk)
  }
  try {
    walk(JSON.parse(contentJson))
  } catch {
    return []
  }
  return [...seen]
}
