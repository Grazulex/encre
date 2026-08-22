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

describe('bulletList (conteneur de blocs)', () => {
  it('ne colle pas les listItem entre eux', () => {
    const docWithList = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item 1' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item 2' }] }] }
          ]
        }
      ]
    })
    expect(tiptapToMarkdown(docWithList)).toBe('Item 1\n\nItem 2\n')
    expect(tiptapToXhtml(docWithList)).toBe('<p>Item 1</p>\n<p>Item 2</p>\n')
  })
})

describe('hardBreak et nœuds inconnus', () => {
  it('hardBreak et texte des nœuds inconnus', () => {
    const docWithBreak = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'ligne un' },
            { type: 'hardBreak' },
            { type: 'text', text: 'ligne deux' }
          ]
        }
      ]
    })
    expect(tiptapToMarkdown(docWithBreak)).toBe('ligne un\nligne deux\n')
    expect(tiptapToXhtml(docWithBreak)).toBe('<p>ligne un<br/>ligne deux</p>\n')
  })
})
