import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { scanChapterFiles, mdToTiptapJson } from './importer'

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
})
