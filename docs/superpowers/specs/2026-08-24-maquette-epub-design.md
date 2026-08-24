# Maquette EPUB — design

Date : 2026-08-24
Statut : validé (design approuvé en session).
Référence unique : **l'export PDF d'Encre** (`src/main/pdf/`), jugé abouti. La
chaîne `atelier` n'intervient pas : ni ses fichiers TOML, ni ses scripts, ni son
vocabulaire de classes. Tout ce que l'EPUB compose vient de la base d'Encre et des
nœuds de mise en page de l'éditeur.
Design PDF dont celui-ci hérite : `docs/superpowers/specs/2026-08-23-maquette-pdf-design.md`.

## Objectif

Amener l'export EPUB d'Encre au niveau de son export PDF : mêmes nœuds de mise en
page compris, même vocabulaire de classes, même typographie — adaptés à un support
reflowable, et emballés dans une archive EPUB 3 que les liseuses et EPUBCheck
acceptent.

## Le problème que ça résout

`src/main/epub.ts` date d'avant la maquette PDF. Il n'a jamais appris les nœuds de
mise en page, et trois défauts en découlent :

1. **Double titre sur chaque chapitre.** L'EPUB ne passe aucun callback `layout` à
   `tiptapToXhtml`, donc les nœuds retombent sur `defaultLayoutRender`
   (`src/shared/export.ts`). Une ouverture de chapitre sort en
   `<div class="ouverture">…<h1>Titre</h1>…</div>` _en plus_ du `<h1>${meta.title}</h1>`
   que `xhtml()` impose en tête de chaque document. Le lecteur voit le titre deux fois.
2. **Les pages liminaires ne sont pas des pages.** Un `frontMatterPage` (titre,
   colophon, dédicace) sort en `<div class="liminaire liminaire-…">` noyé dans le flux
   du chapitre qui le contient, au lieu d'être un document XHTML à part comme le PDF
   en fait une page à part.
3. **Les ouvertures de partie disparaissent dans le texte.** `partOpening` sort en
   `<h1 class="partie">` inline, sans coupure, sans entrée de navigation.

S'y ajoutent des manques d'archive : pas de `cover.xhtml` (l'image de couverture est
au manifest mais absente de la spine, donc invisible dans le fil de lecture de la
plupart des liseuses), pas de `toc.ncx` (les liseuses anciennes et les Kindle
convertis n'ont alors aucune table des matières), pas de `<nav epub:type="landmarks">`,
aucun `epub:type` sémantique, un `dc:identifier` (`urn:encre:3`) qui n'identifie rien
hors de la base locale, un `dcterms:modified` recalculé à chaque export (deux exports
d'un livre inchangé donnent deux fichiers différents), et des `src` d'illustration non
encodés en URI — un nom de fichier accentué ou espacé viole RSC-020 d'EPUBCheck.

## Périmètre

Inclus :

- Découpage du manuscrit en documents XHTML selon les nœuds de mise en page, sur le
  modèle de `src/main/pdf/html.ts`.
- Feuille de style EPUB portant les choix typographiques de `src/main/pdf/style.ts`.
- Archive EPUB 3 complète : `cover.xhtml`, `nav.xhtml` (toc + landmarks), `toc.ncx`,
  `epub:type` sémantiques, métadonnées OPF sérieuses, export déterministe.
- Encodage URI des chemins d'images.

Exclus :

- Réduction de la taille des illustrations à l'embarquement : Encre n'a pas de
  bibliothèque de traitement d'image et n'en gagnera pas une pour ça.
- Sommaire paginé : un EPUB n'a pas de pages. Le nœud `tableOfContents` est omis, la
  navigation native (`nav.xhtml` / `toc.ncx`) le remplace.
- Variantes broché/relié : un EPUB est reflowable, `book.pageFormat` n'y a pas de sens.
- Validation EPUBCheck automatisée en CI : `epubcheck` est présent sur la machine de
  développement, il sert à la vérification manuelle des lots produits, pas au test unitaire.
- Toute modification de `src/shared/export.ts` : le sérialiseur partagé reste tel quel.

## 1. Architecture

`src/main/epub.ts` (206 lignes mêlant CSS, XHTML, OPF et zip) se scinde en miroir
exact de `src/main/pdf/` :

| Fichier                      | Responsabilité                                                                                                                                                  | Miroir PDF                 |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `src/main/media.ts`          | `IMAGE_MEDIA_TYPES` seul. Extrait pour que `pdf/html.ts` cesse d'importer tout le moteur EPUB pour une table de cinq entrées.                                   | —                          |
| `src/main/epub/style.ts`     | `buildEpubCss(): string` — la feuille de style de l'ebook.                                                                                                      | `pdf/style.ts`             |
| `src/main/epub/documents.ts` | `buildEpubDocuments(db, bookId, chapterIds, mediaDir?)` — assemble la liste des documents XHTML et l'inventaire des images. Pur, testable sans Electron ni zip. | `pdf/html.ts`              |
| `src/main/epub/index.ts`     | `buildEpub(db, bookId, chapterIds, mediaDir?): Promise<Buffer>` — OPF, nav, NCX, archive zip.                                                                   | `pdf/render.ts` + `pdf.ts` |
| `src/main/paragraphes.ts`    | `poserPremier` / `poserApresScene`, extraits de `pdf/html.ts` et partagés.                                                                                      | —                          |

La signature de `buildEpub` ne bouge pas : `src/main/api.ts:326` l'appelle
inchangée, et `import { buildEpub } from './epub'` résout désormais
`./epub/index.ts` sans modification de l'import.

### `src/main/paragraphes.ts`

`poserPremier` et `poserApresScene` sont aujourd'hui privées dans `pdf/html.ts`.
L'EPUB en a exactement le même besoin, avec la même contrainte d'ordre
(`poserApresScene` **avant** `poserPremier`, sans quoi un chapitre qui s'ouvre sur un
séparateur de scène voit son premier paragraphe classé `premier` au lieu de
`apres-scene`). Les dupliquer laisserait cette subtilité à deux endroits ; elles
déménagent dans un module partagé, avec leurs commentaires, et `pdf/html.ts` les
importe. Aucun changement de comportement côté PDF — c'est un déplacement pur, que la
suite de tests existante de `pdf/html.test.ts` garde sous contrôle.

## 2. Découpage en documents

`epub/documents.ts` reprend la stratégie de `pdf/html.ts` : un callback `layout`
passé à `tiptapToXhtml`, et un jeton de coupure inséré autour de chaque nœud de mise
en page pour découper la chaîne rendue. Deux différences avec le PDF :

- **Le résultat est une liste de documents, pas un HTML unique.** Chaque tronçon
  devient soit un document XHTML à part entière, soit le corps d'un document ouvert.
- **Le jeton porte un index, pas du HTML.** Là où `pdf/html.ts` renifle le préfixe
  `<section` du tronçon pour savoir s'il est déjà sectionné, le renderer EPUB pousse
  chaque nœud de mise en page dans un tableau typé et n'émet que
  `%%ENCRE-BLOC%%<index>%%ENCRE-BLOC%%`. Le découpeur résout l'index en un objet
  `{ kind, … }` au lieu de deviner à partir d'une chaîne. Plus robuste, et ça évite de
  refaire l'analyse du HTML qu'on vient de produire.

Correspondance des nœuds :

| Nœud                               | Document produit                           | `epub:type`      | Entrée de navigation                |
| ---------------------------------- | ------------------------------------------ | ---------------- | ----------------------------------- |
| `frontMatterPage` genre `titre`    | `titre.xhtml`                              | `titlepage`      | « Page de titre »                   |
| `frontMatterPage` genre `colophon` | `colophon.xhtml`                           | `copyright-page` | —                                   |
| `frontMatterPage` genre `dedicace` | `dedicace.xhtml`                           | `dedication`     | —                                   |
| `partOpening`                      | `partie-NN.xhtml`                          | `part`           | le libellé de la partie             |
| `chapterOpening`                   | ouvre `chapitre-NN.xhtml`                  | `chapter`        | `enseigne — titre`, ou `titre` seul |
| corps de chapitre                  | rejoint le `chapitre-NN.xhtml` courant     | `chapter`        | (celle de son ouverture)            |
| `tableOfContents`                  | omis                                       | —                | —                                   |
| `illustration`                     | **reste dans le flux** du document courant | —                | —                                   |

Le nommage est zéro-paddé sur deux chiffres et suit le rang dans l'export, pas
`meta.position` : l'actuel `chapter-${position}.xhtml` produit `chapter-1`,
`chapter-2`, `chapter-10` — ordre alphabétique faux dans l'archive, et trous si des
positions manquent. Un genre de liminaire qui revient plusieurs fois reçoit un
suffixe (`titre.xhtml`, `titre-2.xhtml`).

Un chapitre sans nœud `chapterOpening` reçoit un titre de repli
`<h1 class="titre-chapitre">${meta.title}</h1>` en tête de son premier segment de
corps — même règle et même condition que `segmenter()` dans `pdf/html.ts`. Le
`<h1>${meta.title}</h1>` systématique de l'actuel `xhtml()` disparaît : c'est lui qui
causait le double titre.

Une illustration n'est **pas** une page à part en EPUB, contrairement au PDF où
`makeIllustrationRenderer` l'encadre du marqueur de coupure pour en faire une page
muette. Un support reflowable n'a pas de page à réserver : la planche s'insère dans
le flux, en `<div class="illustration">`, et la CSS la centre. Son `src` est encodé
(`encodeURIComponent` sur le nom de fichier seul) alors que le chemin écrit dans le
zip reste littéral — un chemin d'archive n'est pas une URI, mais un `src` en est une.
Les gardes existantes sont conservées telles quelles : rejet d'un `fileName` qui n'est
pas un simple nom de base (anti-traversée), rejet d'un fichier absent de `mediaDir`,
extension inconnue omise.

## 3. Contenu de l'archive

```
mimetype                       STORE, premier fichier — inchangé
META-INF/container.xml         inchangé
OEBPS/content.opf
OEBPS/nav.xhtml                <nav epub:type="toc"> + <nav epub:type="landmarks">
OEBPS/toc.ncx                  nouveau
OEBPS/style.css
OEBPS/cover.xhtml              nouveau — entre dans la spine
OEBPS/images/couverture.<ext>
OEBPS/images/<illustrations>
OEBPS/titre.xhtml · colophon.xhtml · dedicace.xhtml
OEBPS/partie-NN.xhtml · chapitre-NN.xhtml
```

Ordre de la spine : `cover.xhtml` s'il y a une couverture, puis les documents dans
l'ordre du manuscrit, puis `<itemref idref="nav" linear="no"/>`. Ce dernier n'est pas
décoratif : le repère `toc` des landmarks pointe vers `nav.xhtml`, et EPUBCheck refuse
en RSC-011 toute cible de repère absente de la spine. `linear="no"` l'y déclare sans
l'insérer dans le fil de lecture.

Les libellés fixes de la maquette (« Page de titre », « Sommaire », « Repères »,
« Couverture », « Début de la lecture ») suivent `book.language` : français par
défaut, anglais si la langue du livre est `en`. Encre porte déjà ce champ ; aucune
autre langue n'est prévue, une valeur inconnue retombe sur le français.

## 4. Métadonnées OPF

| Métadonnée         | Aujourd'hui   | Après                                                                                       |
| ------------------ | ------------- | ------------------------------------------------------------------------------------------- |
| `dc:identifier`    | `urn:encre:3` | `urn:uuid:` + UUID v5 déterministe sur `${author}/${title}`                                 |
| `dc:creator`       | nu            | `id="auteur"` + `<meta refines="#auteur" property="role" scheme="marc:relators">aut</meta>` |
| `dc:date`          | absent        | année de `book.createdAt`                                                                   |
| `dcterms:modified` | `new Date()`  | `book.updatedAt`, arrondi à la seconde                                                      |
| série              | absente       | `belongs-to-collection` + `collection-type` si `book.seriesName`                            |
| couverture         | item seul     | + `cover.xhtml` dans la spine, `<meta name="cover">` conservé                               |
| `<spine>`          | nu            | `toc="ncx"`                                                                                 |

L'UUID v5 est calculé avec `node:crypto` (SHA‑1 du namespace URL concaténé au nom,
puis pose des bits de version et de variante) : une vingtaine de lignes, aucune
dépendance ajoutée. Il rend l'identifiant stable d'une machine à l'autre et d'une
base à l'autre — deux exports du même livre désignent bien la même œuvre, ce que
`urn:encre:<rowid>` ne pouvait pas garantir.

`dcterms:modified` tiré de `book.updatedAt` rend l'export **déterministe** : exporter
deux fois un livre qu'on n'a pas touché produit deux archives identiques. C'est
vérifiable en test, et ça évite qu'un ré-export gonfle inutilement une sauvegarde.

## 5. Feuille de style

`buildEpubCss()` porte les choix de `pdf/style.ts` sur un support reflowable. Ce qui
traverse tel quel :

- La pile de fontes `"EB Garamond", Baskerville, Charter, Georgia, serif`, la
  justification, `hyphens: auto`, la couleur `#16130f`.
- `p { margin: 0; text-indent: 1.3em }` — l'alinéa, pas l'interligne blanche.
- `p.premier { text-indent: 0 }` avec ses petites capitales en `::first-line`, et
  `p.apres-scene { text-indent: 0 }`.
- `.scene-break` rendu en `* * *` par `::after` : le sérialiseur partagé continue
  d'émettre `<div class="scene-break">⁂</div>`, la CSS s'en charge — même technique
  que le PDF, et `src/shared/export.ts` reste intact.
- `.ouverture` / `.enseigne` / `.titre-chapitre` / `.sous-titre` / `.filet`,
  `.page-partie` / `.partie-label`, `.liminaire` et ses trois genres, `.illustration`.

Ce qui tombe, faute de boîte de page : `@page` et ses boîtes de marge, les titres
courants (`string-set`), les folios, `target-counter`, `break-before: right`, les
pages muettes, le correctif de fragmentation paged.js. Les coupures de page
explicites deviennent inutiles là où le document XHTML fait déjà la coupure
(ouvertures, parties, liminaires) ; `hr.page-break`, lui, garde son `break-after: page`,
que les liseuses honorent.

Ce qui doit être **traduit** : les unités absolues (`mm`, `pt`) passent en `em` et en
pourcentages, et le placement vertical des liminaires change de technique. Le PDF les
centre avec `display: flex` + `min-height` sur la hauteur de la boîte de page ; sans
boîte de page, ce calage n'a rien sur quoi s'appuyer et `100vh` n'est pas fiable d'une
liseuse à l'autre. Les liminaires prennent donc une marge haute en pourcentage
(`.liminaire-titre`, `.liminaire-colophon`, `.liminaire-dedicace` avec des valeurs
distinctes), technique éprouvée sur les EPUB de la bibliothèque. C'est le seul point
où la maquette EPUB s'écarte mécaniquement de la maquette PDF ; le vocabulaire de
classes, lui, reste identique.

## 6. Tests

TDD, conventions de `pdf/html.test.ts` et `pdf/style.test.ts`.

`epub/documents.test.ts` — sans zip ni Electron :

- une ouverture de chapitre produit un document dont l'en-tête porte enseigne, titre,
  filet et sous-titre, et **ne contient pas deux fois le titre** ;
- un chapitre sans ouverture reçoit le titre de repli, un chapitre avec ouverture ne
  le reçoit pas ;
- chaque `frontMatterPage` sort en document distinct, avec l'`epub:type` de son genre ;
- un `partOpening` sort en `partie-NN.xhtml` distinct, présent dans les entrées de nav ;
- `tableOfContents` ne produit aucun document ;
- une illustration reste dans le flux, `src` encodé, et un nom de fichier accentué ou
  espacé produit une URI valide ;
- `p.premier` et `p.apres-scene` sont posés, et un chapitre s'ouvrant sur un
  séparateur de scène ne reçoit pas les deux classes sur le même paragraphe ;
- les gardes (traversée de chemin, fichier absent, extension inconnue) omettent le nœud.

`epub/index.test.ts` — sur l'archive :

- `mimetype` en premier et non compressé (régression protégée) ;
- présence de `toc.ncx`, `cover.xhtml`, des deux `<nav>` ;
- OPF : `urn:uuid:` stable pour un même couple auteur/titre, `dc:date`, `marc:relators`,
  `belongs-to-collection` quand le livre est dans une série et son absence sinon,
  `spine toc="ncx"`, `nav` en `linear="no"` ;
- **déterminisme** : deux appels successifs sur un livre inchangé donnent des OPF
  identiques ;
- les libellés basculent en anglais quand `book.language` vaut `en`.

`epub/style.test.ts` : la feuille contient les sélecteurs du vocabulaire PDF et ne
contient aucune règle `@page`.

Les assertions de l'actuel `src/main/epub.test.ts` changent nécessairement
(`chapter-1.xhtml` → `chapitre-00.xhtml`, disparition de `<h1>Un</h1>`) ; le fichier
est réécrit et réparti entre les deux nouveaux fichiers de test.

Vérification manuelle en fin d'implémentation : export d'un livre réel de la
bibliothèque, passage à `epubcheck`, zéro erreur attendue.

## 7. Ce qui ne change pas

- La signature de `buildEpub` et son appel depuis `src/main/api.ts`.
- `src/shared/export.ts` : le sérialiseur et `defaultLayoutRender` restent tels quels.
  Ce dernier continue de servir l'export Markdown, qui n'a pas de pages.
- Le comportement du PDF : le déplacement de `poserPremier` / `poserApresScene` et de
  `IMAGE_MEDIA_TYPES` est un déménagement pur, sans changement de logique.
- Les gardes de sécurité sur les chemins d'illustration.
