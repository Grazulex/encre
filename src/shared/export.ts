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
  if (Array.isArray(node.content)) return joinInline(node.content)
  return { md: '', xhtml: '' }
}

function joinInline(nodes: any[]): Inline {
  const parts = nodes.map(renderInline)
  return { md: parts.map((p) => p.md).join(''), xhtml: parts.map((p) => p.xhtml).join('') }
}

function renderBlocks(doc: any): { md: string[]; xhtml: string[] } {
  const md: string[] = []
  const xhtml: string[] = []
  for (const node of doc.content ?? []) {
    const inline = joinInline(node.content ?? [])
    if (node.type === 'heading') {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6)
      md.push(`${'#'.repeat(level)} ${inline.md}`)
      xhtml.push(`<h${level}>${inline.xhtml}</h${level}>`)
    } else {
      md.push(inline.md)
      xhtml.push(`<p>${inline.xhtml}</p>`)
    }
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
