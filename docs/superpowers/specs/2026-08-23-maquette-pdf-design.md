# Maquette PDF — design

Date : 2026-08-23
Statut : validé (design approuvé en session : moteur paged.js embarqué, ouvertures
de chapitre en nœuds posés à la main, liminaires et sommaire en nœuds insérables,
maquette reproduisant celle d'`atelier`).
Sonde de faisabilité : `docs/superpowers/notes/2026-08-23-sonde-pagedjs.md` — elle
contient la CSS et le JS exacts qui ont été prouvés ; l'implémentation s'y réfère
plutôt que de les redécouvrir.

## Objectif

Amener l'export PDF d'Encre au niveau de la chaîne `atelier`/WeasyPrint qui produit
aujourd'hui les tomes de L'ENVERS : pages d'ouverture de chapitre, titres courants,
folios, sommaire paginé, pages muettes, chapitres en recto forcé — l'auteur plaçant
lui-même les éléments de mise en page depuis l'éditeur.

## Le problème que ça résout

L'export actuel (`src/main/pdf.ts`) construit un HTML simple et appelle
`webContents.printToPDF`. Chromium n'implémente aucune des fonctions CSS Paged Media
dont dépend une maquette de livre : pas de boîtes de marge (`@top-left`,
`@bottom-center`), pas de `string-set` (titre courant qui suit le chapitre), pas de
`target-counter` (numéros de page du sommaire), pas de `break-before: right` (page
blanche insérée pour tomber en recto). Aucun réglage CSS ne rattrape ça : il faut un
moteur de pagination.

Deux défauts visibles de l'export actuel disparaissent mécaniquement avec la nouvelle
chaîne : la page blanche parasite après la page de titre (`.title-page { height: 100vh }`
déborde de la boîte de page, qui a 20 mm de marges) et le titre de chapitre laissé seul
sur une page quand une illustration le suit.

## Périmètre

Inclus :
- Chaîne de composition PDF fondée sur paged.js exécuté dans la fenêtre cachée.
- Maquette broché/relié reprenant les valeurs d'`atelier`.
- Quatre nœuds d'éditeur posés à la main depuis le menu « ¶+ ».
- Sommaire résolu à l'export (numéros de page réels).
- Réglage broché/relié par livre.

Exclus (itérations futures possibles) :
- Signets PDF (outline) — `atelier` les génère via `bookmark-level`, hors périmètre ici.
- Calage sur un nombre de pages pair (`calage_pair` d'`atelier`).
- Notes de bas de page, lettrines, dédicace en page dédiée distincte du nœud liminaire.
- Réglages typographiques exposés (police, corps, interligne) : valeurs figées.
- Refonte des exports EPUB et Markdown : ils apprennent les nouveaux nœuds, rien de plus.

## 1. Architecture de la chaîne

`src/main/pdf.ts` (aujourd'hui 200 lignes mêlant CSS, HTML et rendu, et qui triplerait)
se scinde en trois modules à responsabilité unique, plus le point d'entrée :

| Fichier | Responsabilité |
|---|---|
| `src/main/pdf/style.ts` | La feuille de style d'impression : `PRINT_CSS(format)` renvoie la CSS complète pour `'broche' \| 'relie'`. Aucune connaissance du livre. |
| `src/main/pdf/html.ts` | `buildBookHtml(db, bookId, chapterIds, mediaDir)` : assemble le document (liminaires, ouvertures, chapitres, planches), attribue les `id` d'ancrage et développe le sommaire. Pur, testable sans Electron. |
| `src/main/pdf/render.ts` | `renderHtmlToPdf(html): Promise<Buffer>` : fichier temporaire, fenêtre cachée, injection de paged.js, attente de fin de pagination, `printToPDF`. Seul module qui touche Electron. |
| `src/main/pdf.ts` | `buildPdf(db, bookId, chapterIds, mediaDir?)` inchangé en signature : orchestre les trois. |

Séquence de rendu (paramètres prouvés par la sonde, §« Détection de fin de pagination »
et §« Options printToPDF validées » du rapport) :

1. Écriture du HTML dans un dossier temporaire, `win.loadFile(...)`.
2. Injection du polyfill paged.js **après** `loadFile`, avec `PagedConfig.auto = false`
   (ne jamais se fier à `did-finish-load` seul).
3. Attente de la résolution de `previewer.preview()`, puis `document.fonts.ready` et
   deux `requestAnimationFrame`.
4. `printToPDF({ preferCSSPageSize: true, printBackground: true, margins: 0 })`.

Le polyfill est lu sur disque depuis le paquet npm et injecté par `executeJavaScript`.
En application empaquetée, le fichier vit dans `app.asar` : la résolution se fait par
`createRequire(import.meta.url).resolve('pagedjs/dist/paged.polyfill.js')` et
`pagedjs` est déclaré externe dans `electron.vite.config.ts` pour que le bundler du
process main ne tente pas de l'absorber. La lecture d'un fichier d'`app.asar` par
`readFileSync` est supportée nativement par Electron.

Nouvelle dépendance : `pagedjs` ^0.4.3 (MIT). C'est la seule.

Budget de temps mesuré : ~0,4 s de pagination pour 42 pages, soit ~4 s attendues pour
les 415 pages d'un tome complet. L'export reste synchrone du point de vue de
l'utilisateur, sans indicateur de progression dédié.

## 2. La maquette

Valeurs reprises d'`atelier` (`atelier/build/pdf.py`), sélectionnées par le format du
livre :

| | broché | relié |
|---|---|---|
| Page | 139,7 × 215,9 mm | 6,14 × 9,21 in |
| Marges haut / bas | 17 mm | 21 mm |
| Marge intérieure (couture) | 18 mm | 20 mm |
| Marge extérieure | 14 mm | 17 mm |
| Corps | 11,5 pt | 12 pt |
| Interligne | 1,45 | 1,5 |

Police : `"EB Garamond", Baskerville, Charter, Georgia, serif` — la même chaîne de repli
qu'`atelier`. EB Garamond n'est pas embarquée : elle est utilisée si elle est installée
sur la machine (c'est le cas ici), sinon le repli s'applique, exactement comme pour
WeasyPrint aujourd'hui.

Corps de texte : justifié, `hyphens: auto`, `orphans: 2`, `widows: 2`, retrait d'alinéa
1,3 em. Le retrait est supprimé sur le premier paragraphe du chapitre et sur le
paragraphe qui suit un séparateur de scène (sélecteur d'adjacence, pas de classe posée
à l'assemblage). La **première ligne** du premier paragraphe du chapitre est en petites
capitales (`::first-line { font-variant: small-caps }`).

Titres courants : titre du livre en petites capitales en haut à **gauche des versos**
(`@page :left { @top-left }`, chaîne littérale), titre du chapitre courant en haut à
**droite des rectos** (`@page :right { @top-right { content: string(entete) } }`, la
chaîne étant posée par `string-set: entete content(text)` sur le titre de l'ouverture).
Folio en `counter(page)`, centré en bas.

Pages muettes (ni titre courant ni folio) : page de titre, colophon, dédicace, sommaire,
page de partie, ouverture de chapitre, planche d'illustration. Mécanique prouvée : page
nommée (`.ouverture { page: nue }` + `@page nue { @top-left { content: none } … }`), la
spécificité d'une page nommée l'emportant sur `:left`/`:right`. Les pages blanches
insérées par le moteur pour le recto forcé exigent **en plus** une règle `@page :blank`
explicite, sans quoi elles portent titre courant et folio (vérifié par contre-test).

Trois éléments sont obligatoires dans la CSS livrée, faute de quoi le rendu est faux :

1. Le correctif de justification `[data-align-last-split-element]` : paged.js pose cet
   attribut sur les `<section>` coupées et force la justification de la dernière ligne
   de chaque page à partir de la deuxième coupure. Neutralisé par
   `text-align-last: auto !important` sur les éléments non-`<p>`.
2. La règle `@page :blank` ci-dessus.
3. Les points de conduite du sommaire en **repli CSS** (`::after` de points avec
   débordement masqué, la zone de remplissage en `flex: 1 1 0`). `leader('.')` n'est pas
   supporté par paged.js et, pire, invalide toute la déclaration `content` qui le
   contient — le numéro de page disparaît avec lui. Ne jamais l'écrire.

Séparateur de scène : rendu en PDF par trois astérisques séparées par des espaces, comme
`atelier`. L'éditeur et l'EPUB gardent le ⁂ actuel. Choix délibéré et réversible d'une
ligne : la fidélité au livre imprimé prime sur l'uniformité entre supports.

## 3. Les nœuds d'éditeur

Quatre nœuds, tous insérables depuis le menu « ¶+ » existant d'`EditorPane`, aux côtés
de « Séparateur de scène » et « Saut de page ». Ils vivent dans le contenu des
chapitres : les liminaires d'un livre se composent en créant un premier chapitre
(« Liminaires ») qui ne contient que ces nœuds.

### `chapterOpening` — ouverture de chapitre

- Atome bloc sélectionnable. Attributs : `enseigne` (« CHAPITRE 1 »), `titre`,
  `recto` (booléen, défaut `true`).
- Édition par popover, sur le modèle du popover de libellé de snapshot d'`EditorPane` :
  ouvert automatiquement à l'insertion, et rouvert au clic sur le nœud.
- **Pré-remplissage à l'insertion** : `enseigne` = `CHAPITRE {position}` d'après le rang
  du chapitre courant, `titre` = titre du chapitre. L'auteur corrige s'il le souhaite ;
  rien n'est écrit sans son geste. Le rang est celui du chapitre en base, donc un
  chapitre « Liminaires » placé en tête décale la numérotation proposée d'une unité :
  c'est une commodité de saisie, pas une numérotation faisant autorité.
- Rendu éditeur : bloc centré montrant l'enseigne en petites capitales, le titre en
  grand et un filet — une miniature de la page qu'il produira.
- Rendu PDF : `<section class="ouverture" id="ouv-{n}">` avec `page: nue`,
  `break-before: right` si `recto` (sinon `page`), `break-after: page` ; le titre porte
  le `string-set` qui alimente le titre courant des rectos suivants ; l'`id` est la cible
  du sommaire.

### `partOpening` — page de partie

- Atome bloc. Attributs : `label` (« Première partie — Le poids »), `recto` (défaut `true`).
- Même popover, sans pré-remplissage (aucune source évidente en base).
- Rendu PDF : `<section class="page-partie" id="part-{n}">`, page muette, recto forcé ;
  ne pose pas de titre courant ; apparaît comme intertitre groupant dans le sommaire.

### `tableOfContents` — sommaire

- Atome bloc. Attribut : `titre` (défaut « SOMMAIRE »).
- Rendu éditeur : bloc portant son titre et la mention « rempli à l'export ».
- Rendu PDF : `<section class="sommaire">` (page muette, recto forcé) contenant un `<ol>`
  construit à l'assemblage : **tous** les `partOpening` et `chapterOpening` des chapitres
  exportés, dans l'ordre du document. Chaque entrée est un `<a href="#ouv-{n}">` dont
  le `::after` porte `target-counter(attr(href), page)` et les points de conduite.
- Un livre peut contenir plusieurs nœuds sommaire ; chacun rend la même liste.

### `frontMatterPage` — page liminaire

- Nœud **à contenu éditable** (`content: 'block+'`), pas un atome : l'auteur y tape
  librement, comme dans le reste du texte.
- Attribut : `genre` ∈ `'titre' | 'colophon' | 'dedicace'` (défaut `'titre'`), choisi à
  l'insertion et modifiable par le popover.
- Rendu PDF : `<section class="liminaire liminaire-{genre}">`, page muette,
  `break-after: page`. Le genre pilote l'alignement vertical : `titre` centré,
  `colophon` aligné en bas de page, `dedicace` aligné en haut.
- Son contenu compte dans le nombre de mots du chapitre — c'est du texte écrit par
  l'auteur, aucune raison de l'exclure.

## 4. Assemblage du document

`buildBookHtml` procède en deux temps, parce que le sommaire doit connaître des nœuds
qui vivent dans d'autres chapitres :

1. **Relevé** : parcours de tous les chapitres exportés, dans l'ordre, collectant les
   `partOpening` et `chapterOpening` rencontrés et leur attribuant un `id` séquentiel
   stable (`part-1`, `ouv-1`, `ouv-2`, …).
2. **Rendu** : second parcours produisant le HTML, où chaque nœud sommaire est développé
   à partir du relevé.

Le corps de chaque chapitre est enveloppé dans `<section class="chapitre">` (page par
défaut, donc titrée et foliotée).

**Règle de compatibilité** : un chapitre qui ne contient **aucun** `chapterOpening`
garde un simple titre en tête de chapitre, comme aujourd'hui — un `<h1>` porteur du même
`string-set`, qui alimente donc le titre courant des rectos avec le titre du chapitre.
Ce titre de repli n'ouvre pas de page muette : il coule en tête du corps. Les livres déjà en base ne perdent donc
rien, et l'auteur qui pose une ouverture reprend la main complètement. C'est le seul
comportement automatique du design, et c'est un repli, pas une mise en page imposée.

## 5. Réglage du livre

Migration 5 : `ALTER TABLE books ADD COLUMN page_format TEXT NOT NULL DEFAULT 'broche'`.
Type `BookPageFormat = 'broche' | 'relie'`, ajouté à `Book`, `BookPatch` et au panneau
de réglages du livre (un sélecteur à deux valeurs, libellés « Broché » et « Relié »).

## 6. Effet sur les autres exports

Les nouveaux nœuds traversent `src/shared/export.ts` comme les autres :

| Nœud | Markdown | EPUB |
|---|---|---|
| `chapterOpening` | `# {titre}` | `<h1>` (titre), enseigne en `<p class="enseigne">` au-dessus |
| `partOpening` | `# {label}` | `<h1 class="partie">` |
| `frontMatterPage` | son contenu, blocs normaux | `<div class="liminaire liminaire-{genre}">` |
| `tableOfContents` | omis | omis — l'EPUB a déjà sa navigation (`nav.xhtml`) |

L'EPUB continue d'émettre le titre du chapitre en `<h1>` : il en a besoin pour sa table
des matières, et sa maquette n'est pas celle du papier.

## 7. Gestion d'erreurs

- Échec de la pagination paged.js (exception dans la page) : l'export échoue avec un
  message explicite ; le dossier temporaire est nettoyé dans tous les cas (le `finally`
  imbriqué mis en place lors du travail sur les illustrations est conservé).
- Attente de pagination plafonnée à 120 s : au-delà, l'export échoue plutôt que de
  laisser la fenêtre cachée ouverte indéfiniment.
- Polyfill paged.js introuvable au chemin résolu : erreur explicite au premier export,
  pas de repli silencieux vers l'ancienne chaîne — un PDF sans titres courants ni folios
  qui prétendrait être le nouveau serait pire qu'une erreur.
- Nœud sommaire dans un livre sans aucune ouverture : le sommaire rend sa page, avec
  une liste vide. Pas une erreur.
- Illustration dont le fichier a disparu : comportement inchangé (nœud omis).

## 8. Tests

- `pdf/html.test.ts` : relevé et numérotation des ancres ; ordre du sommaire (parties et
  chapitres mêlés) ; développement du sommaire dans plusieurs nœuds ; repli du titre
  automatique quand le chapitre n'a pas d'ouverture ; absence de repli quand il en a une ;
  `recto` traduit en `break-before: right` vs `page`.
- `pdf/style.test.ts` : la CSS contient bien, pour chaque format, les valeurs de page et
  de marges attendues, et les trois éléments obligatoires du §2 (correctif de
  justification, `@page :blank`, absence de `leader(`).
- `shared/export.test.ts` : rendu Markdown et XHTML des quatre nœuds.
- Migration 5 (modèle `migration4.test.ts`) : colonne ajoutée, base ancienne préservée,
  base neuve à `MIGRATIONS.length`.
- `render.ts` n'est pas testé automatiquement (il dépend d'Electron), comme `buildPdf`
  aujourd'hui : le typecheck en est la garde, et la vérification est manuelle sur un
  vrai tome.
