export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

type Inline = { md: string; xhtml: string }

function renderInline(node: any): Inline {
  if (node.type === 'mention') {
    const label = String(node.attrs?.label ?? '')
    return { md: label, xhtml: escapeXml(label) }
  }
  if (node.type === 'text') {
    let md = String(node.text ?? '')
    let xhtml = escapeXml(md)
    const marks = (node.marks ?? []).map((m: any) => m.type)
    if (marks.includes('bold')) { md = `**${md}**`; xhtml = `<strong>${xhtml}</strong>` }
    if (marks.includes('italic')) { md = `*${md}*`; xhtml = `<em>${xhtml}</em>` }
    return { md, xhtml }
  }
  if (node.type === 'hardBreak') {
    return { md: '\n', xhtml: '<br/>' }
  }
  if (typeof node.text === 'string') {
    return { md: node.text, xhtml: escapeXml(node.text) }
  }
  if (Array.isArray(node.content)) return joinInline(node.content)
  return { md: '', xhtml: '' }
}

function joinInline(nodes: any[]): Inline {
  const parts = nodes.map(renderInline)
  return { md: parts.map((p) => p.md).join(''), xhtml: parts.map((p) => p.xhtml).join('') }
}

// Mêmes types « feuille inline » que src/main/importer.ts (INLINE_TYPES) : le
// reste (paragraphes, autres listItem, …) est du contenu de bloc et ne doit
// jamais être concaténé sans séparateur.
const INLINE_TYPES = new Set(['text', 'mention', 'hardBreak'])
// Conteneurs de blocs : leurs enfants ne sont pas de l'inline à aplatir mais
// des blocs (souvent des paragraphes) à rendre et séparer séparément — sans
// quoi bulletList/orderedList/listItem/blockquote collent leurs items
// (ex. "Item 1Item 2").
const BLOCK_CONTAINER_TYPES = new Set(['bulletList', 'orderedList', 'listItem', 'blockquote'])

function renderBlockNode(node: any): { md: string; xhtml: string } {
  const children = node.content ?? []
  // Atomes de bloc (Task 3) : pas d'enfants à aplatir, un rendu fixe par
  // format. Traités avant le repli paragraphe générique.
  // `horizontalRule` : nœud hérité (StarterKit, désactivé dans l'éditeur au
  // profit de sceneBreak, cf. stripCodeBlocks.ts). La normalisation vers
  // sceneBreak n'est appliquée qu'au prochain chargement/édition dans
  // l'éditeur — elle n'est pas persistée en base à l'ouverture. Un chapitre
  // jamais rouvert depuis cette bascule peut donc encore stocker un
  // horizontalRule : le rendre comme un sceneBreak (même séparateur de scène)
  // plutôt que de le laisser tomber dans le repli paragraphe vide ci-dessous.
  if (node.type === 'sceneBreak' || node.type === 'horizontalRule') {
    return { md: '***', xhtml: '<div class="scene-break">⁂</div>' }
  }
  if (node.type === 'pageBreak') {
    return { md: '<!-- page-break -->', xhtml: '<hr class="page-break"/>' }
  }
  if (node.type === 'heading') {
    const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6)
    const inline = joinInline(children)
    return { md: `${'#'.repeat(level)} ${inline.md}`, xhtml: `<h${level}>${inline.xhtml}</h${level}>` }
  }
  const isInline = children.every((c: any) => INLINE_TYPES.has(c?.type))
  if (BLOCK_CONTAINER_TYPES.has(node.type) && !isInline) {
    const nested = children.map(renderBlockNode)
    // Un <li>/<blockquote> n'a pas besoin d'un balisage sémantique dédié ici :
    // ses paragraphes internes en <p> séparés suffisent à ne pas les coller.
    return {
      md: nested.map((b: { md: string }) => b.md).join('\n\n'),
      xhtml: nested.map((b: { xhtml: string }) => b.xhtml).join('\n')
    }
  }
  const inline = joinInline(children)
  return { md: inline.md, xhtml: `<p>${inline.xhtml}</p>` }
}

function renderBlocks(doc: any): { md: string[]; xhtml: string[] } {
  const md: string[] = []
  const xhtml: string[] = []
  for (const node of doc.content ?? []) {
    const block = renderBlockNode(node)
    md.push(block.md)
    xhtml.push(block.xhtml)
  }
  return { md, xhtml }
}

export function tiptapToMarkdown(contentJson: string): string {
  try {
    const { md } = renderBlocks(JSON.parse(contentJson))
    return md.length ? md.join('\n\n') + '\n' : ''
  } catch {
    return ''
  }
}

export function tiptapToXhtml(contentJson: string): string {
  try {
    const { xhtml } = renderBlocks(JSON.parse(contentJson))
    return xhtml.length ? xhtml.join('\n') + '\n' : ''
  } catch {
    return ''
  }
}
