import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { scanChapterFiles, mdToTiptapJson } from './importer'
import { tiptapToMarkdown } from '../shared/export'

describe('scanChapterFiles', () => {
  it('trie par préfixe numérique et déduit les titres', () => {
    const dir = mkdtempSync(join(tmpdir(), 'encre-import-'))
    writeFileSync(join(dir, '02-la-fuite.md'), 'Texte.')
    writeFileSync(join(dir, '01-incendie.md'), '# L\'incendie\n\nTexte.')
    writeFileSync(join(dir, 'notes.txt'), 'ignoré')
    const files = scanChapterFiles(dir)
    expect(files.map((f) => f.title)).toEqual(["L'incendie", 'la fuite'])
  })
})

describe('mdToTiptapJson', () => {
  it('convertit gras/italique/paragraphes et retire le titre de tête', () => {
    const { contentJson, contentText } = mdToTiptapJson('# Titre\n\nIl **pleuvait** sur *Brest*.\n\nFin.')
    const doc = JSON.parse(contentJson)
    expect(doc.type).toBe('doc')
    expect(JSON.stringify(doc)).not.toContain('"heading"')
    expect(JSON.stringify(doc)).toContain('"bold"')
    expect(contentText).toContain('Il pleuvait sur Brest.')
    expect(contentText).toContain('Fin.')
  })

  it('un bloc de code markdown devient un paragraphe (pas de codeBlock)', () => {
    const { contentJson } = mdToTiptapJson('```\nindenté\n```\n')
    expect(contentJson).not.toContain('codeBlock')
  })

  it("sépare le texte des blocs imbriqués (listItem) par des sauts de ligne", () => {
    const { contentText } = mdToTiptapJson('- Item 1\n- Item 2\n')
    expect(contentText).toContain('Item 1\nItem 2')
  })

  it('tolère les lignes vides avant le titre de tête', () => {
    const { contentJson, contentText } = mdToTiptapJson('\n# Titre\n\nCorps.')
    expect(contentJson).not.toContain('"heading"')
    expect(contentText.startsWith('Corps.')).toBe(true)
  })

  // Correctif review (Task 6) : ai.formatToJson (round-trip harmonisation)
  // appelle mdToTiptapJson avec stripLeadingH1: false — un `# …` en tête du
  // Markdown envoyé par tiptapToMarkdown pour CE chemin est un vrai titre H1
  // écrit par l'auteur dans le corps du chapitre, jamais un titre de fichier
  // à retirer (contrairement à l'import, testé juste au-dessus). Sans ce
  // garde, ce paragraphe disparaissait silencieusement à l'application, alors
  // que FormatDialog l'affichait encore intact côté « Après ».
  it('stripLeadingH1: false conserve le heading de tête (round-trip harmonisation)', () => {
    const { contentJson, contentText } = mdToTiptapJson('# Un titre\n\nParagraphe…', {
      stripLeadingH1: false
    })
    const doc = JSON.parse(contentJson)
    expect(JSON.stringify(doc)).toContain('"heading"')
    expect(contentText).toContain('Un titre')
    expect(contentText).toContain('Paragraphe…')
  })

  it('stripLeadingH1 par défaut (import) retire toujours le titre de tête', () => {
    const { contentJson, contentText } = mdToTiptapJson('# Un titre\n\nParagraphe…')
    expect(JSON.stringify(JSON.parse(contentJson))).not.toContain('"heading"')
    expect(contentText).not.toContain('Un titre')
  })

  it('convertit *** (hr) en sceneBreak (via stripCodeBlocks, Task 3)', () => {
    const { contentJson } = mdToTiptapJson('Avant.\n\n***\n\nAprès.')
    const doc = JSON.parse(contentJson)
    expect(doc.content).toContainEqual({ type: 'sceneBreak' })
    expect(contentJson).not.toContain('horizontalRule')
  })

  it('convertit --- (hr) en sceneBreak', () => {
    const { contentJson } = mdToTiptapJson('Avant.\n\n---\n\nAprès.')
    const doc = JSON.parse(contentJson)
    expect(doc.content).toContainEqual({ type: 'sceneBreak' })
  })

  it('convertit <!-- page-break --> en pageBreak (placeholder)', () => {
    const { contentJson, contentText } = mdToTiptapJson('Avant.\n\n<!-- page-break -->\n\nAprès.')
    const doc = JSON.parse(contentJson)
    expect(doc.content).toContainEqual({ type: 'pageBreak' })
    expect(contentJson).not.toContain('ENCRE-PAGE-BREAK')
    expect(contentText).not.toContain('ENCRE-PAGE-BREAK')
  })

  // Fix 4 (correctif review) : sans ligne vide autour du commentaire, le
  // jeton placeholder finissait au milieu d'un unique paragraphe fusionné
  // (espaces de collapse DOM compris) et fuyait tel quel dans le contenu.
  it('convertit <!-- page-break --> collé au texte (sans ligne vide) en pageBreak, sans fuite du jeton', () => {
    const { contentJson, contentText } = mdToTiptapJson('Avant.\n<!-- page-break -->\nAprès.')
    const doc = JSON.parse(contentJson)
    expect(doc.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Avant.' }] },
      { type: 'pageBreak' },
      { type: 'paragraph', content: [{ type: 'text', text: 'Après.' }] }
    ])
    expect(contentJson).not.toContain('ENCRE-PAGE-BREAK')
    expect(contentText).not.toContain('ENCRE-PAGE-BREAK')
  })
})

// Fix 2 (correctif review) : le round-trip d'harmonisation (tiptapToMarkdown
// → Claude → mdToTiptapJson) ne doit plus aplatir listes/blockquote/hardBreak
// en paragraphes/espaces bruts — sans quoi la structure disparaît
// silencieusement à l'application.
describe('round-trip export → import : listes, citation, hardBreak (Fix 2)', () => {
  it('bulletList survit au round-trip (les deux items retrouvés)', () => {
    const original = JSON.stringify({
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
    const md = tiptapToMarkdown(original)
    const { contentJson } = mdToTiptapJson(md)
    expect(contentJson).toContain('"bulletList"')
    expect(contentJson).toContain('Item 1')
    expect(contentJson).toContain('Item 2')
  })

  it('orderedList survit au round-trip (les deux items retrouvés)', () => {
    const original = JSON.stringify({
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
    const md = tiptapToMarkdown(original)
    const { contentJson } = mdToTiptapJson(md)
    expect(contentJson).toContain('"orderedList"')
    expect(contentJson).toContain('Un')
    expect(contentJson).toContain('Deux')
  })

  it('blockquote survit au round-trip', () => {
    const original = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Une citation.' }] }]
        }
      ]
    })
    const md = tiptapToMarkdown(original)
    const { contentJson } = mdToTiptapJson(md)
    expect(contentJson).toContain('"blockquote"')
    expect(contentJson).toContain('Une citation.')
  })

  // Le pipeline (marked → HTML → generateJSON/linkedom) collapse les espaces
  // du DOM : deux runs de texte distincts autour du hardBreak sont préservés
  // au minimum (aucune fusion en un seul mot), même si la ré-obtention d'un
  // nœud hardBreak strict dépend de marked — documenté ici plutôt que supposé.
  it('hardBreak : au moins deux segments de texte distincts survivent au round-trip', () => {
    const original = JSON.stringify({
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
    const md = tiptapToMarkdown(original)
    expect(md).toBe('ligne un  \nligne deux\n')
    const { contentJson, contentText } = mdToTiptapJson(md)
    const doc = JSON.parse(contentJson)
    expect(doc.content).toContainEqual({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'ligne un' },
        { type: 'hardBreak' },
        { type: 'text', text: 'ligne deux' }
      ]
    })
    expect(contentText).toContain('ligne un')
    expect(contentText).toContain('ligne deux')
  })
})

describe('round-trip export → import', () => {
  it('sceneBreak + pageBreak survivent à tiptapToMarkdown puis mdToTiptapJson', () => {
    const original = JSON.stringify({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Chapitre.' }] },
        { type: 'sceneBreak' },
        { type: 'paragraph', content: [{ type: 'text', text: 'Milieu.' }] },
        { type: 'pageBreak' },
        { type: 'paragraph', content: [{ type: 'text', text: 'Fin.' }] }
      ]
    })
    const md = tiptapToMarkdown(original)
    const { contentJson } = mdToTiptapJson(md)
    const doc = JSON.parse(contentJson)
    expect(doc.content.map((n: any) => n.type)).toEqual([
      'paragraph',
      'sceneBreak',
      'paragraph',
      'pageBreak',
      'paragraph'
    ])
  })
})
