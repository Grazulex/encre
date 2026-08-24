import { describe, it, expect } from 'vitest'
import { buildEpubCss } from './style'

describe('buildEpubCss', () => {
  it('porte la typographie de la maquette PDF', () => {
    const css = buildEpubCss()
    expect(css).toContain('font-family: "EB Garamond", Baskerville, Charter, Georgia, serif')
    expect(css).toContain('text-align: justify')
    expect(css).toContain('hyphens: auto')
    expect(css).toContain('color: #16130f')
    expect(css).toContain('line-height: 1.5')
  })

  it("donne de l'air au texte, l'EPUB n'ayant pas de boîte de page", () => {
    // Le PDF pose body { margin: 0 } parce que @page fournit les marges ; ici
    // c'est la feuille qui doit les donner, sinon le texte touche le bord.
    expect(buildEpubCss()).toMatch(/body \{[^}]*margin: 0 5%;/s)
  })

  it("porte l'alinéa et ses deux exceptions", () => {
    const css = buildEpubCss()
    expect(css).toMatch(/\bp \{[^}]*margin: 0;[^}]*text-indent: 1\.3em;/s)
    expect(css).toContain('p.premier')
    expect(css).toContain('p.premier::first-line')
    expect(css).toContain('font-variant: small-caps')
    expect(css).toContain('p.apres-scene')
    // Sélecteurs positionnels bannis, comme en PDF : le corps d'un chapitre peut
    // être réparti sur plusieurs documents XHTML.
    expect(css).not.toContain(':first-of-type')
    expect(css).not.toContain('scene-break + p')
  })

  it('rend le séparateur de scène en trois astérisques', () => {
    const css = buildEpubCss()
    // Le sérialiseur partagé émet toujours <div class="scene-break">⁂</div> :
    // le ⁂ est masqué par font-size: 0 et la CSS restitue la taille au ::after.
    expect(css).toMatch(/\.scene-break \{[^}]*font-size: 0;/s)
    expect(css).toContain('.scene-break::after')
    expect(css).toMatch(/\.scene-break::after \{[^}]*content: "\* {3}\* {3}\*";/s)
    expect(css).toMatch(/\.scene-break::after \{[^}]*font-size: 1rem;/s)
  })

  it('garde les deux propriétés de coupure sur hr.page-break', () => {
    // Les liseuses anciennes ne connaissent que page-break-after.
    const css = buildEpubCss()
    expect(css).toMatch(/hr\.page-break \{[^}]*break-after: page;/s)
    expect(css).toMatch(/hr\.page-break \{[^}]*page-break-after: always;/s)
  })

  it("porte le vocabulaire de classes de l'ouverture et de la page de partie", () => {
    const css = buildEpubCss()
    expect(css).toContain('.ouverture .enseigne')
    expect(css).toContain('.ouverture .titre-chapitre')
    expect(css).toContain('.ouverture .sous-titre')
    expect(css).toContain('.filet')
    expect(css).toContain('.page-partie')
    expect(css).toContain('.page-partie .partie-label')
    // Titre de repli d'un chapitre sans nœud d'ouverture.
    expect(css).toContain('h1.titre-chapitre')
  })

  it('réserve deux lignes sur le titre de chapitre', () => {
    expect(buildEpubCss()).toMatch(/h1\.titre-chapitre \{[^}]*min-height: 2\.8em;/s)
  })

  it('le sous-titre de chapitre est en italique', () => {
    expect(buildEpubCss()).toMatch(/\.ouverture \.sous-titre \{[^}]*font-style: italic;/s)
  })

  it('démaquille les titres de page liminaire (non gras, centrés)', () => {
    const css = buildEpubCss()
    expect(css).toContain('.liminaire h1')
    expect(css).toContain('.liminaire h2')
    expect(css).toContain('.liminaire p')
    expect(css).toMatch(/\.liminaire h1,\s*\.liminaire h2 \{[^}]*font-weight: normal;/s)
    expect(css).toMatch(/\.liminaire \{[^}]*text-align: center;/s)
  })

  it('cale les liminaires par une marge haute en pourcentage, distincte par genre', () => {
    // Sans boîte de page, le calage flex du PDF n'a rien sur quoi s'appuyer et
    // 100vh n'est pas fiable d'une liseuse à l'autre.
    const css = buildEpubCss()
    expect(css).toMatch(/\.liminaire-titre \{[^}]*margin-top: 30%;/s)
    expect(css).toMatch(/\.liminaire-colophon \{[^}]*margin-top: 55%;/s)
    expect(css).toMatch(/\.liminaire-colophon \{[^}]*font-size: \.85em;/s)
    expect(css).toMatch(/\.liminaire-dedicace \{[^}]*margin-top: 40%;/s)
    expect(css).toMatch(/\.liminaire-dedicace \{[^}]*font-style: italic;/s)
    expect(css).not.toContain('100vh')
  })

  it('contient les planches et les citations produites par le sérialiseur', () => {
    const css = buildEpubCss()
    expect(css).toMatch(/\.illustration \{[^}]*text-align: center;/s)
    expect(css).toMatch(/\.illustration img \{[^}]*max-width: 100%;[^}]*height: auto;/s)
    expect(css).toContain('blockquote')
    expect(css).toMatch(/blockquote p \{[^}]*text-indent: 0;/s)
  })

  it('ne contient aucune règle de boîte de page ni de pagination paginée', () => {
    const css = buildEpubCss()
    expect(css).not.toContain('@page')
    expect(css).not.toContain('target-counter')
    expect(css).not.toContain('string-set')
    expect(css).not.toContain('break-before: right')
    expect(css).not.toContain('page: nue')
    expect(css).not.toContain('counter(page)')
    expect(css).not.toContain('data-align-last-split-element')
  })

  it('ne contient pas les classes du sommaire, omis en EPUB', () => {
    // Le nœud tableOfContents n'est pas sérialisé : la navigation vient de
    // nav.xhtml et de toc.ncx.
    const css = buildEpubCss()
    expect(css).not.toContain('.sommaire')
    expect(css).not.toContain('toc-partie')
    expect(css).not.toContain('toc-titre')
    expect(css).not.toContain('toc-enseigne')
    expect(css).not.toContain('toc-fill')
  })

  it('ne prend aucun paramètre et rend toujours la même feuille', () => {
    expect(buildEpubCss.length).toBe(0)
    expect(buildEpubCss()).toBe(buildEpubCss())
  })
})
