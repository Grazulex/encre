// Feuille de style de la maquette EPUB. Elle porte les mêmes choix typographiques
// et exactement le même vocabulaire de classes que la maquette PDF
// (`src/main/pdf/style.ts`), adaptés à un support reflowable — voir
// docs/superpowers/specs/2026-08-24-maquette-epub-design.md, section 5.
//
// Ce qui tombe par rapport au PDF, faute de boîte de page : tout `@page` et ses
// boîtes de marge (titre courant, folio), les mécanismes de pagination qui en
// dépendent (`string-set`, `target-counter`, `break-before: right`, `page: nue`)
// et le correctif de fragmentation de paged.js — ici c'est la liseuse qui pagine,
// paged.js n'intervient jamais. Les classes du sommaire (`.sommaire`, `.toc-*`)
// tombent aussi : le nœud `tableOfContents` n'est pas sérialisé en EPUB, la table
// des matières vient de `nav.xhtml` et de `toc.ncx`.
//
// Ce qui se traduit : les unités absolues du PDF (`mm`, `pt`) n'ont pas de sens
// sans page ni corps imposé ; elles passent en `em` (proportions typographiques)
// et en pourcentages (réserves verticales).

// Aucun paramètre, contrairement à `buildPrintCss(format, bookTitle)` : un EPUB est
// reflowable, `book.pageFormat` n'y décrit rien (c'est la liseuse qui fabrique la
// page), et aucun titre n'est interpolé dans la feuille puisqu'il n'y a pas de
// titre courant à composer. La feuille est donc une constante, servie par une
// fonction pour rester symétrique de l'export PDF.
export function buildEpubCss(): string {
  return `
html {
  /* Même pile que le PDF. Aucune fonte n'est embarquée dans l'archive : une
     liseuse sans EB Garamond retombe sur la suite, qui garde une allure de livre. */
  font-family: "EB Garamond", Baskerville, Charter, Georgia, serif;
  /* Pas de font-size ici, là où le PDF fixe 11.5pt ou 12pt : le corps du texte
     appartient au lecteur et à son réglage de liseuse. Toutes les tailles de la
     maquette sont donc exprimées relativement à ce corps. */
  line-height: 1.5;
  color: #16130f;
  /* Les moteurs des liseuses sont en retard sur la césure : WebKit (Apple Books,
     Kobo) veut le préfixe -webkit-, et EPUB 3 normalise -epub-. On pose les trois. */
  hyphens: auto;
  -webkit-hyphens: auto;
  -epub-hyphens: auto;
  text-align: justify;
  orphans: 2;
  widows: 2;
}
/* Le PDF pose \`body { margin: 0 }\` parce que la boîte de page fournit déjà les
   marges du bloc de texte. Un EPUB n'a pas de boîte de page : sans marge ici, le
   texte toucherait le bord de l'écran sur les liseuses qui n'en ajoutent aucune.
   5 % de la largeur plutôt qu'une valeur absolue — la réserve suit l'écran, du
   téléphone à la liseuse de dix pouces. */
body { margin: 0 5%; }

/* Corps de chapitre. Mêmes valeurs qu'en PDF, mais sans le préfixe \`.chapitre\` :
   en EPUB chaque chapitre est son propre document XHTML, le corps du texte n'a
   donc rien dont il faille le distinguer. */
p { margin: 0; text-indent: 1.3em; }
/* Classes posées à l'assemblage, comme en PDF, jamais de sélecteur positionnel
   (par première position dans le parent, ou par adjacence avec le séparateur de
   scène) : le corps d'un chapitre peut être réparti sur plusieurs documents, et
   les moteurs de liseuse gèrent mal ces sélecteurs sur un flux recomposé. */
p.premier { text-indent: 0; }
p.premier::first-line { font-variant: small-caps; letter-spacing: .04em; }
p.apres-scene { text-indent: 0; }

/* Séparateur de scène. Le sérialiseur partagé émet toujours
   \`<div class="scene-break">⁂</div>\` (src/shared/export.ts reste intact) : on
   masque le ⁂ avec font-size: 0 et on restitue trois astérisques dans le ::after,
   exactement comme le PDF. La taille rendue est en rem et non en em : le parent
   étant à 0, un em vaudrait 0 lui aussi — et rem retombe sur le corps choisi par
   le lecteur, là où le PDF pouvait inscrire une valeur en points. */
.scene-break { text-align: center; text-indent: 0; margin: 1.6em 0; border: none; font-size: 0; }
.scene-break::after { content: "*   *   *"; font-size: 1rem; letter-spacing: .1em; }
/* Coupure de page explicite du texte. Les deux propriétés sont maintenues : les
   liseuses anciennes (et les moteurs Kindle issus d'une conversion) ne connaissent
   que page-break-after, les récentes lisent break-after. */
hr.page-break { break-after: page; page-break-after: always; border: none; margin: 0; height: 0; }

/* Ouverture de chapitre. Pas de \`break-after: page\` comme en PDF : l'ouverture
   est en tête de son propre document XHTML, la coupure est déjà faite par la
   structure de l'archive, et la redemander fait insérer une page blanche sur
   certaines liseuses. L'air au-dessus passe des 42mm du PDF à 4.5em : sans hauteur
   de page connue, seule une réserve relative au corps garde la même proportion
   d'un écran à l'autre. */
.ouverture { padding-top: 4.5em; text-align: center; text-indent: 0; margin: 0 0 2.4em; }
.ouverture .enseigne { font-variant: small-caps; font-size: .82em; letter-spacing: .18em; text-indent: 0; margin: 0 0 2.2em; }
/* Le titre de repli (chapitre sans nœud d'ouverture) porte la même apparence que
   le titre d'une ouverture — en PDF ces deux sélecteurs partageaient déjà la règle
   qui pose le titre courant ; ici ils partagent tout, il n'y a plus de titre
   courant à composer. */
.ouverture .titre-chapitre,
h1.titre-chapitre {
  font-size: 1.9em;
  font-weight: normal;
  letter-spacing: .1em;
  line-height: 1.2;
  /* Réserve deux lignes pour que le filet tombe au même endroit d'un chapitre à
     l'autre. 2.8em plutôt que les 2.4em du PDF : la fonte par défaut d'une liseuse
     est souvent plus large qu'EB Garamond, un titre long y passe à la ligne plus tôt. */
  min-height: 2.8em;
  margin: 0;
  text-align: center;
  text-indent: 0;
}
/* Sous-titre optionnel : la devise du chapitre. Italique, à peine plus petit que
   le corps, avec un peu d'air au-dessus pour ne pas coller au titre. */
.ouverture .sous-titre { font-size: 1em; font-style: italic; text-indent: 0; margin: 1.2em 0 0; }

/* Page de partie. Même remarque que pour l'ouverture : la coupure vient du
   document XHTML, pas de la CSS. Les 90mm de réserve haute du PDF deviennent un
   pourcentage — un pourcentage de marge se calcule sur la largeur du bloc, seule
   dimension connue d'avance en reflowable, et c'est la technique éprouvée des
   pages d'apparat en EPUB. */
.page-partie { margin-top: 35%; text-align: center; text-indent: 0; }
.page-partie .partie-label { font-variant: small-caps; font-size: 1.3em; letter-spacing: .12em; margin: 0; text-indent: 0; }

/* Filet sous le titre. Largeur en em (28mm du PDF) et trait à 1px : les .4pt du
   PDF sont sous le pixel d'un écran de liseuse, où ils disparaîtraient. */
.filet { width: 6em; height: 0; border-top: 1px solid #16130f; margin: 1.4em auto 0; }

/* Pages liminaires. Le PDF les cale verticalement avec \`display: flex\` +
   \`min-height\` sur la hauteur de la boîte de page ; sans boîte de page ce calage
   n'a rien sur quoi s'appuyer, et les unités de hauteur de fenêtre ne sont pas
   fiables d'une liseuse à l'autre (les unes les rapportent sur la colonne
   courante, les autres sur le document entier). On
   retombe sur une marge haute en pourcentage, avec une valeur par genre qui
   reproduit approximativement le calage du PDF. C'est le seul endroit où la
   maquette EPUB s'écarte mécaniquement de la maquette PDF ; le vocabulaire de
   classes, lui, reste identique. */
.liminaire { text-align: center; text-indent: 0; }
.liminaire p { text-indent: 0; margin: 0 0 .6em; }
/* Une page liminaire est du contenu libre : sa hiérarchie vient des titres que
   l'auteur y place, que la maquette veut non gras et espacés, pas au gras par
   défaut du moteur de rendu. */
.liminaire h1,
.liminaire h2 {
  font-weight: normal;
  letter-spacing: .08em;
  margin: 0 0 1.2em;
  text-align: center;
  text-indent: 0;
}
.liminaire h1 { font-size: 1.75em; }
.liminaire h2 { font-size: 1.2em; }
/* Page de titre : centrée dans le PDF (justify-content: center). */
.liminaire-titre { margin-top: 30%; }
/* Colophon : en pied de page dans le PDF (justify-content: flex-end), d'où la
   réserve la plus haute des trois. */
.liminaire-colophon { margin-top: 55%; font-size: .85em; }
/* Dédicace : haut de page + 60mm dans le PDF (flex-start + padding-top). */
.liminaire-dedicace { margin-top: 40%; font-style: italic; }

/* Planches. Le PDF force une coupure avant et après et plafonne la hauteur sur la
   boîte de page ; en EPUB l'illustration reste dans le flux et la seule contrainte
   utile est de ne jamais déborder de la largeur de l'écran — \`height: auto\` pour
   que le rapport soit conservé quand la largeur est ramenée. */
.illustration { text-align: center; text-indent: 0; margin: 1.6em 0; }
.illustration img { max-width: 100%; height: auto; }

/* Première de couverture (cover.xhtml). Le PDF n'a pas d'équivalent : sa couverture
   est un fichier séparé confié à l'imprimeur. Ici elle est une page du livre, et
   doit occuper la largeur de l'écran sans jamais la dépasser. */
img.couverture { width: 100%; height: auto; }

/* Citations : le sérialiseur partagé produit des blockquote. Le retrait des deux
   côtés remplace l'alinéa, qui ferait doublon ici. */
blockquote { margin: 1.2em 2em; font-size: .95em; }
blockquote p { text-indent: 0; }
`
}
