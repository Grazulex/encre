export interface IllustrationAttrs { fileName: string; displayName: string }
export interface ExportOptions {
  // Rendu d'un nœud illustration par le consommateur ; retourner null l'omet.
  // Option absente => tous les nœuds illustration sont omis (défaut sûr : pas
  // de lien mort dans un export qui n'a pas prévu les images).
  illustration?: (attrs: IllustrationAttrs) => { md: string; xhtml: string } | null
}

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
    // Saut de ligne dur Markdown standard : deux espaces en fin de ligne puis
    // un retour à la ligne. Un simple '\n' (ex-comportement) est un saut
    // « mou » que ProseMirror réimporte comme un simple espace, perdant le
    // hardBreak au round-trip d'harmonisation (Fix 2, correctif review).
    return { md: '  \n', xhtml: '<br/>' }
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

// Rendu Markdown d'un listItem : son premier bloc (généralement un paragraphe)
// suit le marqueur (`- ` ou `1. `) sur la même ligne ; les blocs suivants du
// même item (paragraphes additionnels, sous-liste) sont indentés de deux
// espaces (Fix 2, correctif review — un seul niveau d'imbrication géré
// simplement, comme demandé par la revue).
function renderListItemMarkdown(item: any, marker: string, opts: ExportOptions): string {
  const children = item.content ?? []
  const blocks: { md: string; isNestedList: boolean }[] = []
  for (const child of children) {
    if (child?.type === 'bulletList' || child?.type === 'orderedList') {
      blocks.push({ md: renderListMarkdown(child, opts), isNestedList: true })
    } else {
      const rendered = renderBlockNode(child, opts)
      if (rendered.md !== '') blocks.push({ md: rendered.md, isNestedList: false })
    }
  }
  if (blocks.length === 0) return marker.trimEnd()
  const [first, ...rest] = blocks
  const firstLine = first.isNestedList
    ? [marker.trimEnd(), ...first.md.split('\n').map((l) => `  ${l}`)].join('\n')
    : `${marker}${first.md}`
  const restLines = rest.flatMap((b) =>
    b.isNestedList ? b.md.split('\n').map((l) => `  ${l}`) : [`  ${b.md}`]
  )
  return [firstLine, ...restLines].join('\n')
}

function renderListMarkdown(node: any, opts: ExportOptions): string {
  const ordered = node.type === 'orderedList'
  const start = ordered ? Number(node.attrs?.start ?? node.attrs?.order ?? 1) : 1
  const items = node.content ?? []
  return items
    .map((item: any, idx: number) => renderListItemMarkdown(item, ordered ? `${start + idx}. ` : '- ', opts))
    .join('\n')
}

// Rendu Markdown d'un blockquote : chaque ligne (y compris les lignes vides
// entre blocs internes) préfixée par `> ` (`>` seul si vide) — syntaxe
// Markdown standard de citation multi-paragraphes.
function renderBlockquoteMarkdown(node: any, opts: ExportOptions): string {
  const children = node.content ?? []
  const rendered = children.map((c: any) => renderBlockNode(c, opts).md).filter((md: string) => md !== '')
  return rendered
    .join('\n\n')
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n')
}

function renderBlockNode(node: any, opts: ExportOptions): { md: string; xhtml: string } {
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
  if (node.type === 'illustration') {
    const fileName = String(node.attrs?.fileName ?? '')
    const displayName = String(node.attrs?.displayName ?? '')
    // Le rendu appartient au consommateur (Markdown copie les fichiers, EPUB
    // les embarque, PDF les référence en file://) : sans callback, ou si le
    // callback répond null (fichier manquant), le nœud est omis — un export
    // ne doit jamais contenir de lien mort (spec §5).
    const rendered = fileName && opts.illustration ? opts.illustration({ fileName, displayName }) : null
    return rendered ?? { md: '', xhtml: '' }
  }
  if (node.type === 'heading') {
    const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6)
    const inline = joinInline(children)
    return { md: `${'#'.repeat(level)} ${inline.md}`, xhtml: `<h${level}>${inline.xhtml}</h${level}>` }
  }
  const isInline = children.every((c: any) => INLINE_TYPES.has(c?.type))
  if (BLOCK_CONTAINER_TYPES.has(node.type) && !isInline) {
    const nested = children.map((c: any) => renderBlockNode(c, opts))
    // XHTML : un <li>/<blockquote> n'a pas besoin d'un balisage sémantique
    // dédié ici : ses paragraphes internes en <p> séparés suffisent à ne pas
    // les coller (rendu XHTML inchangé par le Fix 2, cf. revue).
    const xhtml = nested.map((b: { xhtml: string }) => b.xhtml).join('\n')
    // Markdown : bulletList/orderedList/blockquote ont une syntaxe dédiée
    // (Fix 2, correctif review) — listItem (rencontré seul, cas de repli)
    // garde l'ancien aplatissement générique par paragraphes séparés.
    let md: string
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      md = renderListMarkdown(node, opts)
    } else if (node.type === 'blockquote') {
      md = renderBlockquoteMarkdown(node, opts)
    } else {
      md = nested.map((b: { md: string }) => b.md).join('\n\n')
    }
    return { md, xhtml }
  }
  const inline = joinInline(children)
  return { md: inline.md, xhtml: `<p>${inline.xhtml}</p>` }
}

function renderBlocks(doc: any, opts: ExportOptions): { md: string[]; xhtml: string[] } {
  const md: string[] = []
  const xhtml: string[] = []
  for (const node of doc.content ?? []) {
    const block = renderBlockNode(node, opts)
    md.push(block.md)
    xhtml.push(block.xhtml)
  }
  return { md, xhtml }
}

export function tiptapToMarkdown(contentJson: string, opts: ExportOptions = {}): string {
  try {
    const { md } = renderBlocks(JSON.parse(contentJson), opts)
    return md.length ? md.join('\n\n') + '\n' : ''
  } catch {
    return ''
  }
}

export function tiptapToXhtml(contentJson: string, opts: ExportOptions = {}): string {
  try {
    const { xhtml } = renderBlocks(JSON.parse(contentJson), opts)
    return xhtml.length ? xhtml.join('\n') + '\n' : ''
  } catch {
    return ''
  }
}
