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
  it('sérialise en Markdown avec la syntaxe de liste réelle (Fix 2 : ex-défaut, aplatissait en paragraphes)', () => {
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
    expect(tiptapToMarkdown(docWithList)).toBe('- Item 1\n- Item 2\n')
    // XHTML inchangé (non régressé) : un <p> par item, sans balisage <ul>/<li> dédié.
    expect(tiptapToXhtml(docWithList)).toBe('<p>Item 1</p>\n<p>Item 2</p>\n')
  })

  it('item multi-paragraphes : continuation indentée de deux espaces', () => {
    const docWithList = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Premier paragraphe' }] },
                { type: 'paragraph', content: [{ type: 'text', text: 'Second paragraphe' }] }
              ]
            }
          ]
        }
      ]
    })
    expect(tiptapToMarkdown(docWithList)).toBe('- Premier paragraphe\n  Second paragraphe\n')
  })
})

describe('orderedList (conteneur de blocs)', () => {
  it('sérialise en Markdown numéroté 1. 2. …', () => {
    const docWithList = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'orderedList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Un' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Deux' }] }] }
          ]
        }
      ]
    })
    expect(tiptapToMarkdown(docWithList)).toBe('1. Un\n2. Deux\n')
  })

  it('respecte l\'attribut start', () => {
    const docWithList = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'orderedList',
          attrs: { start: 5 },
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cinq' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Six' }] }] }
          ]
        }
      ]
    })
    expect(tiptapToMarkdown(docWithList)).toBe('5. Cinq\n6. Six\n')
  })
})

describe('blockquote (conteneur de blocs)', () => {
  it('sérialise en Markdown avec la syntaxe de citation "> "', () => {
    const docWithQuote = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Une citation.' }] }]
        }
      ]
    })
    expect(tiptapToMarkdown(docWithQuote)).toBe('> Une citation.\n')
  })

  it('citation multi-paragraphes : chaque ligne préfixée, ligne vide entre blocs = ">"', () => {
    const docWithQuote = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Premier.' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'Second.' }] }
          ]
        }
      ]
    })
    expect(tiptapToMarkdown(docWithQuote)).toBe('> Premier.\n>\n> Second.\n')
  })
})

describe('horizontalRule (nœud hérité, Fix 1)', () => {
  const docWithRule = JSON.stringify({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Avant' }] },
      { type: 'horizontalRule' },
      { type: 'paragraph', content: [{ type: 'text', text: 'Après' }] }
    ]
  })
  it('sérialise en MD comme un sceneBreak (***)', () => {
    expect(tiptapToMarkdown(docWithRule)).toBe('Avant\n\n***\n\nAprès\n')
  })
  it('sérialise en XHTML comme un sceneBreak', () => {
    expect(tiptapToXhtml(docWithRule)).toBe(
      '<p>Avant</p>\n<div class="scene-break">⁂</div>\n<p>Après</p>\n'
    )
  })
})

describe('sceneBreak', () => {
  const docWithSceneBreak = JSON.stringify({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Avant' }] },
      { type: 'sceneBreak' },
      { type: 'paragraph', content: [{ type: 'text', text: 'Après' }] }
    ]
  })
  it('sérialise en MD comme un bloc *** séparé par des lignes vides', () => {
    expect(tiptapToMarkdown(docWithSceneBreak)).toBe('Avant\n\n***\n\nAprès\n')
  })
  it('sérialise en XHTML comme <div class="scene-break">⁂</div>', () => {
    expect(tiptapToXhtml(docWithSceneBreak)).toBe(
      '<p>Avant</p>\n<div class="scene-break">⁂</div>\n<p>Après</p>\n'
    )
  })
})

describe('pageBreak', () => {
  const docWithPageBreak = JSON.stringify({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Avant' }] },
      { type: 'pageBreak' },
      { type: 'paragraph', content: [{ type: 'text', text: 'Après' }] }
    ]
  })
  it('sérialise en MD comme un commentaire <!-- page-break --> séparé par des lignes vides', () => {
    expect(tiptapToMarkdown(docWithPageBreak)).toBe('Avant\n\n<!-- page-break -->\n\nAprès\n')
  })
  it('sérialise en XHTML comme <hr class="page-break"/>', () => {
    expect(tiptapToXhtml(docWithPageBreak)).toBe(
      '<p>Avant</p>\n<hr class="page-break"/>\n<p>Après</p>\n'
    )
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
    // Saut de ligne dur Markdown standard (Fix 2) : deux espaces avant le \n,
    // sans quoi ProseMirror le réimporte comme un simple espace.
    expect(tiptapToMarkdown(docWithBreak)).toBe('ligne un  \nligne deux\n')
    expect(tiptapToXhtml(docWithBreak)).toBe('<p>ligne un<br/>ligne deux</p>\n')
  })
})

describe('nœud illustration', () => {
  const doc = JSON.stringify({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Avant.' }] },
      { type: 'illustration', attrs: { fileName: 'ill-1-9-0.png', displayName: 'La maison' } },
      { type: 'paragraph', content: [{ type: 'text', text: 'Après.' }] },
      { type: 'illustration', attrs: { fileName: 'ill-1-9-0.png', displayName: 'La maison' } },
      { type: 'illustration', attrs: { fileName: 'ill-1-9-1.jpg', displayName: 'Le café' } }
    ]
  })

  it('est rendu via le callback du consommateur', () => {
    const opts = {
      illustration: ({ fileName, displayName }: { fileName: string; displayName: string }) => ({
        md: `![${displayName}](Illustrations/${fileName})`,
        xhtml: `<div class="illustration"><img src="images/${fileName}" alt="${displayName}"/></div>`
      })
    }
    expect(tiptapToMarkdown(doc, opts)).toContain('![La maison](Illustrations/ill-1-9-0.png)')
    expect(tiptapToXhtml(doc, opts)).toContain('<img src="images/ill-1-9-0.png" alt="La maison"/>')
  })

  it('est omis quand le callback retourne null ou est absent', () => {
    const withNull = { illustration: () => null }
    expect(tiptapToMarkdown(doc, withNull)).not.toContain('ill-1-9-0.png')
    expect(tiptapToMarkdown(doc)).not.toContain('ill-1-9-0.png')
    expect(tiptapToXhtml(doc)).not.toContain('ill-1-9-0.png')
    // les paragraphes autour restent rendus
    expect(tiptapToMarkdown(doc)).toContain('Avant.')
    expect(tiptapToMarkdown(doc)).toContain('Après.')
  })
})
