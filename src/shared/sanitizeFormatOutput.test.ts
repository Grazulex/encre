import { describe, it, expect } from 'vitest'
import { sanitizeFormatOutput, stripMarkdownFences } from './sanitizeFormatOutput'

describe('stripMarkdownFences', () => {
  it('retire une paire de fences enveloppant tout le texte', () => {
    expect(stripMarkdownFences('```markdown\nBonjour.\n```')).toBe('Bonjour.')
    expect(stripMarkdownFences('```\nBonjour.\n```')).toBe('Bonjour.')
  })

  it('laisse intact un texte sans fences', () => {
    expect(stripMarkdownFences('Bonjour.')).toBe('Bonjour.')
  })
})

describe('sanitizeFormatOutput', () => {
  it("retire une phrase d'annonce en tête suivie d'une ligne vide", () => {
    const input = 'Voici le texte harmonisé :\n\nBonjour, dit-elle.\n\nElle avança.'
    expect(sanitizeFormatOutput(input)).toBe('Bonjour, dit-elle.\n\nElle avança.')
  })

  it('retire un écho du titre "## CHAPITRE (Markdown)" en tête', () => {
    const input = '## CHAPITRE (Markdown)\n\nBonjour, dit-elle.'
    expect(sanitizeFormatOutput(input)).toBe('Bonjour, dit-elle.')
  })

  it('retire l’annonce puis le titre recopié, dans cet ordre', () => {
    const input = 'Voici le chapitre harmonisé :\n\n## CHAPITRE (Markdown)\n\nBonjour, dit-elle.'
    expect(sanitizeFormatOutput(input)).toBe('Bonjour, dit-elle.')
  })

  it('laisse intact un texte qui commence directement par le récit', () => {
    const input = 'Bonjour, dit-elle. Elle avança.\n\nUn peu plus tard.'
    expect(sanitizeFormatOutput(input)).toBe(input)
  })

  it("ne retire pas une première ligne finissant par ':' sans ligne vide ensuite (incipit légitime)", () => {
    const input = 'Résumé :\nSuite immédiate du récit, sans coupure.'
    expect(sanitizeFormatOutput(input)).toBe(input)
  })

  it('combine fences et préambule', () => {
    const input = '```markdown\nVoici le texte harmonisé :\n\nBonjour, dit-elle.\n```'
    expect(sanitizeFormatOutput(input)).toBe('Bonjour, dit-elle.')
  })

  it("ne retire pas une ligne d'annonce trop longue (pas un vrai préambule)", () => {
    const longLine = 'a'.repeat(101) + ':'
    const input = `${longLine}\n\nBonjour, dit-elle.`
    expect(sanitizeFormatOutput(input)).toBe(input)
  })

  it("ne retire pas un vrai titre de chapitre de l'auteur (\"## Chapitre 12\") — garde-fou faux positif", () => {
    const input = '## Chapitre 12\n\nBonjour, dit-elle.'
    expect(sanitizeFormatOutput(input)).toBe(input)
  })

  it('ne retire pas un vrai titre de chapitre de l\'auteur ("## Chapitre III : Le Retour")', () => {
    const input = '## Chapitre III : Le Retour\n\nBonjour, dit-elle.'
    expect(sanitizeFormatOutput(input)).toBe(input)
  })
})
