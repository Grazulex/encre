// Migration douce des chapitres existants qui contiendraient encore des
// blocs de code / marques `code` (Task publication 1), ou un nœud
// `horizontalRule` hérité (Task 3 — le `---` de StarterKit, désactivé dans
// l'éditeur au profit de `sceneBreak`, qui possède désormais ses propres
// règles de saisie et son propre rendu). L'éditeur n'offre plus ces
// extensions, mais du contenu déjà enregistré peut encore en porter. Appliqué
// au chargement d'un chapitre, avant setContent — jamais de save déclenché
// ici, la prochaine frappe persistera la conversion.
// Nœud TipTap migré : codeBlock→paragraph, horizontalRule→sceneBreak,
// marques `code` retirées.
interface TipTapMigrateNode {
  type?: string
  content?: TipTapMigrateNode[]
  marks?: { type: string }[]
  [key: string]: unknown
}

export function stripCodeBlocks(contentJson: string): { json: string; changed: boolean } {
  let changed = false
  const walk = (node: TipTapMigrateNode): TipTapMigrateNode => {
    if (!node || typeof node !== 'object') return node
    let out = node
    if (node.type === 'codeBlock') {
      changed = true
      out = { type: 'paragraph', ...(node.content ? { content: node.content } : {}) }
    }
    if (out.type === 'horizontalRule') {
      changed = true
      out = { type: 'sceneBreak' }
    }
    if (Array.isArray(out.content)) out = { ...out, content: out.content.map(walk) }
    if (Array.isArray(out.marks)) {
      const marks = out.marks.filter((m: { type: string }) => m?.type !== 'code')
      if (marks.length !== out.marks.length) {
        changed = true
        out = { ...out, ...(marks.length ? { marks } : {}) }
        if (marks.length === 0) delete out.marks
      }
    }
    return out
  }
  try {
    const doc = walk(JSON.parse(contentJson))
    return changed ? { json: JSON.stringify(doc), changed } : { json: contentJson, changed: false }
  } catch {
    return { json: contentJson, changed: false }
  }
}
