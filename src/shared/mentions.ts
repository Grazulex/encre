export function extractMentionIds(contentJson: string): number[] {
  const seen = new Set<number>()
  const walk = (node: any): void => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'mention' && node.attrs && Number.isInteger(node.attrs.id)) {
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
