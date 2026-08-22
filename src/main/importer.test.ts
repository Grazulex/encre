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
