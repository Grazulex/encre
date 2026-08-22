// Migration douce des chapitres existants qui contiendraient encore des
// blocs de code / marques `code` (Task publication 1) : l'éditeur n'offre
// plus ces extensions (StarterKit.configure({ codeBlock: false, code: false })
// dans EditorPane.vue), mais du contenu déjà enregistré peut encore en
// porter. Appliqué au chargement d'un chapitre, avant setContent — jamais de
// save déclenché ici, la prochaine frappe persistera la conversion.
export function stripCodeBlocks(contentJson: string): { json: string; changed: boolean } {
  let changed = false
  const walk = (node: any): any => {
    if (!node || typeof node !== 'object') return node
    let out = node
    if (node.type === 'codeBlock') {
      changed = true
      out = { type: 'paragraph', ...(node.content ? { content: node.content } : {}) }
    }
    if (Array.isArray(out.content)) out = { ...out, content: out.content.map(walk) }
    if (Array.isArray(out.marks)) {
      const marks = out.marks.filter((m: any) => m?.type !== 'code')
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
