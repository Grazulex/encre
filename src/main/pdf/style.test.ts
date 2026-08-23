import { describe, it, expect } from 'vitest'
import { buildPrintCss } from './style'

describe('buildPrintCss', () => {
  it('porte les valeurs du broché', () => {
    const css = buildPrintCss('broche', 'LA MAISON')
    expect(css).toContain('size: 139.7mm 215.9mm')
    expect(css).toContain('margin-top: 17mm')
    expect(css).toContain('font-size: 11.5pt')
    expect(css).toContain('line-height: 1.45')
    // marges alternées : intérieure 18mm, extérieure 14mm
    expect(css).toMatch(/@page :left \{[^}]*margin-left: 14mm;[^}]*margin-right: 18mm;/s)
    expect(css).toMatch(/@page :right \{[^}]*margin-left: 18mm;[^}]*margin-right: 14mm;/s)
  })

  it('porte les valeurs du relié', () => {
    const css = buildPrintCss('relie', 'X')
    expect(css).toContain('size: 6.14in 9.21in')
    expect(css).toContain('margin-top: 21mm')
    expect(css).toContain('font-size: 12pt')
    expect(css).toMatch(/@page :left \{[^}]*margin-left: 17mm;[^}]*margin-right: 20mm;/s)
  })

  it('inscrit le titre du livre dans le titre courant des versos, échappé', () => {
    expect(buildPrintCss('broche', 'LA MAISON')).toContain('content: "LA MAISON"')
    const css = buildPrintCss('broche', 'Guillemet " et \\ antislash')
    expect(css).toContain('content: "Guillemet \\" et \\\\ antislash"')
  })

  it('contient les trois éléments obligatoires et jamais leader()', () => {
    const css = buildPrintCss('broche', 'X')
    expect(css).toContain("[data-align-last-split-element='justify']")
    expect(css).toContain('text-align-last: auto !important')
    expect(css).toContain('@page :blank')
    expect(css).toContain('.toc-fill')
    expect(css).not.toContain('leader(')
  })

  it("pose le titre courant depuis l'ouverture ET depuis le titre de repli", () => {
    const css = buildPrintCss('broche', 'X')
    expect(css).toContain('.ouverture .titre-chapitre')
    expect(css).toContain('.chapitre h1.titre-chapitre')
    expect(css).toContain('string-set: entete content(text)')
  })
})
