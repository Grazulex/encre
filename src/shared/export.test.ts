import { describe, it, expect } from 'vitest'
import { tiptapToMarkdown, tiptapToXhtml } from './export'

const doc = JSON.stringify({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Chapitre un' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Il pleuvait sur ' },
        { type: 'mention', attrs: { id: 3, label: 'Brest', kind: 'place' } },
        { type: 'text', text: ' & ailleurs, ', marks: [] },
        { type: 'text', text: 'fort', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' et ' },
        { type: 'text', text: 'doux', marks: [{ type: 'italic' }] },
        { type: 'text', text: '.' }
      ]
    },
    { type: 'paragraph', content: [{ type: 'text', text: 'Fin.' }] }
  ]
})

describe('tiptapToMarkdown', () => {
  it('sérialise titres, gras, italique, mentions', () => {
    expect(tiptapToMarkdown(doc)).toBe(
      '## Chapitre un\n\nIl pleuvait sur Brest & ailleurs, **fort** et *doux*.\n\nFin.\n'
    )
  })
  it('doc vide → chaîne vide', () => {
    expect(tiptapToMarkdown('{"type":"doc","content":[]}')).toBe('')
  })
})

describe('tiptapToXhtml', () => {
  it('sérialise en XHTML échappé', () => {
    expect(tiptapToXhtml(doc)).toBe(
      '<h2>Chapitre un</h2>\n<p>Il pleuvait sur Brest &amp; ailleurs, <strong>fort</strong> et <em>doux</em>.</p>\n<p>Fin.</p>\n'
    )
  })
})
