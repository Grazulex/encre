// Feuille d'impression de la maquette PDF. Les valeurs (page, marges, corps,
// interligne) reprennent celles de la chaîne atelier/WeasyPrint qui compose les
// livres de l'auteur ; les mécanismes (pages nommées, string-set, target-counter,
// break-before: right) ont été vérifiés dans Electron — voir
// docs/superpowers/notes/2026-08-23-sonde-pagedjs.md.
import type { BookPageFormat } from '../../shared/types'

interface Maquette {
  page: string          // valeur de `size`
  margeBloc: string     // marges haut et bas
  margeInterieure: string
  margeExterieure: string
  corps: string
  interligne: string
  hauteurPlanche: string // hauteur maximale d'une planche pleine page
}

const MAQUETTES: Record<BookPageFormat, Maquette> = {
  // Broché 5,5 × 8,5 in — format de poche des tomes de L'ENVERS.
  broche: {
    page: '139.7mm 215.9mm',
    margeBloc: '17mm',
    margeInterieure: '18mm',
    margeExterieure: '14mm',
    corps: '11.5pt',
    interligne: '1.45',
    hauteurPlanche: '178mm'
  },
  // Relié 6,14 × 9,21 in — marges et corps plus généreux.
  relie: {
    page: '6.14in 9.21in',
    margeBloc: '21mm',
    margeInterieure: '20mm',
    margeExterieure: '17mm',
    corps: '12pt',
    interligne: '1.5',
    hauteurPlanche: '188mm'
  }
}

// Le titre du livre entre dans une déclaration `content: "…"` : les guillemets et
// les antislashs doivent être échappés, sinon un titre contenant l'un des deux
// casse la règle et le titre courant disparaît.
function echapperChaineCss(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function buildPrintCss(format: BookPageFormat, bookTitle: string): string {
  const m = MAQUETTES[format]
  const titre = echapperChaineCss(bookTitle)
  return `
@page {
  size: ${m.page};
  margin-top: ${m.margeBloc};
  margin-bottom: ${m.margeBloc};
  @bottom-center { content: counter(page); font-size: 9.5pt; }
}
/* Marges alternées : la plus large tombe toujours du côté de la couture. */
@page :left {
  margin-left: ${m.margeExterieure};
  margin-right: ${m.margeInterieure};
  @top-left { content: "${titre}"; font-variant: small-caps; font-size: 9pt; letter-spacing: .06em; }
}
@page :right {
  margin-left: ${m.margeInterieure};
  margin-right: ${m.margeExterieure};
  @top-right { content: string(entete); font-variant: small-caps; font-size: 9pt; letter-spacing: .06em; }
}
/* Pages muettes : liminaires, sommaire, parties, ouvertures et planches. */
@page nue {
  @top-left { content: none; }
  @top-right { content: none; }
  @bottom-center { content: none; }
}
/* Indispensable : sans cette règle, la page blanche insérée par break-before:right
   porte titre courant et folio (vérifié par contre-essai dans la sonde). */
@page :blank {
  @top-left { content: none; }
  @top-right { content: none; }
  @bottom-center { content: none; }
}

html {
  font-family: "EB Garamond", Baskerville, Charter, Georgia, serif;
  font-size: ${m.corps};
  line-height: ${m.interligne};
  color: #16130f;
  hyphens: auto;
  text-align: justify;
  orphans: 2;
  widows: 2;
}
body { margin: 0; }

/* Correctif paged.js — obligatoire. À chaque coupure de page, paged.js pose
   data-align-last-split-element='justify' sur l'élément scindé le plus profond ;
   quand la coupure tombe entre deux paragraphes c'est la <section> du chapitre, et
   text-align-last étant hérité, toutes les dernières lignes du chapitre restant
   sont justifiées de force. On ne neutralise PAS sur <p> : un paragraphe réellement
   coupé en bas de page doit garder ce comportement. */
section[data-align-last-split-element='justify'],
header[data-align-last-split-element='justify'],
div[data-align-last-split-element='justify'] {
  text-align-last: auto !important;
}

.liminaire, .sommaire, .page-partie, .ouverture, .illustration { page: nue; }

/* Corps de chapitre */
.chapitre p { margin: 0; text-indent: 1.3em; }
/* Classes posées à l'assemblage (html.ts), pas de sélecteur positionnel : la
   fragmentation de paged.js recompose le DOM à chaque coupure de page et casse
   les sélecteurs qui reposent sur la position (premier enfant, adjacence),
   comme mesuré sur un export réel de 340 pages (le premier paragraphe restait
   indenté, l'après-scène aussi). */
.chapitre p.premier { text-indent: 0; }
.chapitre p.premier::first-line { font-variant: small-caps; letter-spacing: .04em; }
.chapitre p.apres-scene { text-indent: 0; }
.chapitre h1 { font-size: 1.4em; font-weight: normal; text-align: center; text-indent: 0; margin: 0 0 1.4em; }
/* Repli de titre (chapitre sans nœud d'ouverture) : lui seul a besoin de sa
   propre coupure de page — une ouverture porte déjà break-after: page sur
   elle-même, la reproduire ici romprait la page qu'elle vient de composer. */
.chapitre[data-debut='true'] { break-before: right; }

/* Séparateur de scène : rendu en trois astérisques comme la chaîne atelier, sans
   toucher au ⁂ que l'éditeur et l'EPUB continuent d'afficher. */
.scene-break { text-align: center; text-indent: 0; margin: 1.6em 0; border: none; font-size: 0; }
.scene-break::after { content: "*   *   *"; font-size: ${m.corps}; letter-spacing: .1em; }
hr.page-break { break-after: page; border: none; margin: 0; height: 0; }

/* Ouverture de chapitre */
.ouverture { break-after: page; padding-top: 42mm; text-align: center; text-indent: 0; }
.ouverture .enseigne { font-variant: small-caps; font-size: 9.5pt; letter-spacing: .18em; text-indent: 0; margin: 0 0 2.2em; }
.ouverture .titre-chapitre {
  font-size: 22pt;
  font-weight: normal;
  letter-spacing: .1em;
  line-height: 1.2;
  min-height: 2.4em;   /* réserve deux lignes : le filet tombe au même endroit d'un chapitre à l'autre */
  margin: 0;
}
/* La chaîne du titre courant des rectos est prise ici et court jusqu'au chapitre
   suivant. Le titre de repli (chapitre sans nœud d'ouverture) la pose de la même
   façon, sinon ses pages n'auraient pas de titre courant. */
.ouverture .titre-chapitre,
.chapitre h1.titre-chapitre { string-set: entete content(text); }
.ouverture[data-recto='true'], .page-partie[data-recto='true'], .sommaire { break-before: right; }
.ouverture[data-recto='false'], .page-partie[data-recto='false'] { break-before: page; }

/* Page de partie */
.page-partie { break-after: page; padding-top: 90mm; text-align: center; text-indent: 0; }
.page-partie .partie-label { font-variant: small-caps; font-size: 15pt; letter-spacing: .12em; margin: 0; text-indent: 0; }

.filet { width: 28mm; height: 0; border-top: .4pt solid #16130f; margin: 1.4em auto 0; }

/* Pages liminaires : le genre pilote l'alignement vertical dans la boîte de page. */
.liminaire { display: flex; flex-direction: column; min-height: ${m.hauteurPlanche}; text-align: center; text-indent: 0; break-after: page; }
.liminaire p { text-indent: 0; margin: 0 0 .6em; }
.liminaire-titre { justify-content: center; }
.liminaire-colophon { justify-content: flex-end; font-size: .85em; }
.liminaire-dedicace { justify-content: flex-start; padding-top: 60mm; font-style: italic; }

/* Sommaire — points de conduite en repli flex : la fonction leader n'existe pas dans
   paged.js et sa présence invalide toute la déclaration content, faisant
   disparaître le numéro de page avec les points. */
.sommaire { break-after: page; text-indent: 0; }
.sommaire h2 { font-variant: small-caps; font-size: 13pt; font-weight: normal; letter-spacing: .16em; text-align: center; margin: 0 0 2.4em; }
.sommaire ol { list-style: none; margin: 0; padding: 0; font-size: 10.5pt; }
.sommaire li { margin: 0 0 .75em; text-indent: 0; }
.sommaire li.toc-partie { font-variant: small-caps; letter-spacing: .1em; margin: 1.6em 0 .9em; }
.sommaire a { display: flex; align-items: baseline; text-decoration: none; color: inherit; }
.sommaire .toc-titre { flex: 0 1 auto; }
.sommaire .toc-enseigne { font-variant: small-caps; letter-spacing: .08em; }
.sommaire .toc-fill { flex: 1 1 0; min-width: 1.5em; overflow: hidden; white-space: nowrap; margin: 0 .35em; text-align: right; color: #6b6459; }
.sommaire .toc-fill::after { content: ". . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . ."; }
.sommaire a::after { content: target-counter(attr(href), page); flex: none; color: #6b6459; }

/* Planches pleine page */
.illustration { break-before: page; break-after: page; text-align: center; }
.illustration img { max-width: 100%; max-height: ${m.hauteurPlanche}; width: auto; height: auto; }
`
}
