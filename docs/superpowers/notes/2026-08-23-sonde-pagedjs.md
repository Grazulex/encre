# Sonde de faisabilité — paged.js dans Electron (BrowserWindow cachée + printToPDF)

Date : 2026-08-23. Sonde jetable, code dans
`/private/tmp/claude-501/-Users-jean-marcstrauven-Dev-encre/b8e030bb-c5fc-4f31-9ed9-c40b5ae520ae/scratchpad/pagedjs-probe/`
(build.js → book.html, book.css, main.js, probe.pdf, png/).

Environnement : Electron 39.8.10 (celui du repo, `node_modules/.bin/electron`), pagedjs 0.4.3
(`dist/paged.polyfill.js`), EB Garamond locale, chapitres réels CH-01/02/03 de
« La Maison qui se tait » + planche `p1_1.png`. Note : dans ces sources, les ruptures de
scène sont des lignes `---` (pas `* * *`) ; le générateur accepte les deux.

**Verdict global : OUI, paged.js + printToPDF reproduit la maquette WeasyPrint visée.**
Les 6 points fonctionnent ; 2 exigent un correctif CSS documenté ci-dessous (bug de
justification de paged.js, et repli maison pour `leader()`).

---

## Q1 — Titres courants via `@page :left/:right` + `string-set` : **WORKS**

Vérifié visuellement : « La Maison qui se tait » en petites capitales en haut-gauche de
chaque verso (p. 8, 10, 12, 20, 30, 42) ; le titre du chapitre COURANT en haut-droite des
rectos (p. 9/11/17 → « TROIS HEURES DU MATIN », p. 21 → « CEUX QUI NE VOIENT PAS »).
Le changement de chaîne au fil des chapitres fonctionne.

```css
@page :left  { margin-left: 14mm; margin-right: 18mm;   /* verso : ext. 14 / int. 18 */
  @top-left  { content: string(titre-livre); font-variant: small-caps; font-size: 9pt; } }
@page :right { margin-left: 18mm; margin-right: 14mm;   /* recto : int. 18 / ext. 14 */
  @top-right { content: string(entete); font-variant: small-caps; font-size: 9pt; } }

.page-titre .titre-livre        { string-set: titre-livre content(text); }
.ouverture-chapitre .titre-chapitre { string-set: entete content(text); }
```

Les marges alternées recto/verso par `@page :left/:right` fonctionnent aussi (le bloc de
texte est bien décalé vers l'intérieur, visible sur les paires 8/9, 10/11…).

## Q2 — Folio `counter(page)` : **WORKS**

```css
@page { size: 139.7mm 215.9mm; margin-top: 17mm; margin-bottom: 17mm;
  @bottom-center { content: counter(page); font-size: 9.5pt; } }
```

Folio centré en pied présent sur toutes les pages de corps (8…42), chiffres corrects et
cohérents avec le sommaire.

## Q3 — Pages muettes : **WORKS** (pages nommées + `:first`)

Deux mécanismes, tous deux fonctionnels dans paged.js 0.4.3 :

```css
/* liminaires (titre, colophon, sommaire, partie, planche) */
@page nue { @top-left { content: none; } @top-right { content: none; }
            @bottom-center { content: none; } }
.nue { page: nue; }

/* première page de chaque chapitre (le corps commence sur la page d'ouverture) */
.chapitre { page: chapitre; break-before: right; }
@page chapitre:first { @top-left { content: none; } @top-right { content: none; }
                       @bottom-center { content: none; } }
```

Vérifié : pages 1–6 (titre, colophon, sommaire, blanche, partie, planche) et ouvertures
de chapitres (7, 19, 31) sans titre courant ni folio ; la page 2 du chapitre (p. 8, 20…)
retrouve les siens. La spécificité des pages nommées l'emporte bien sur `:left/:right`.

## Q4 — Recto forcé + blanche insérée : **WORKS** (avec `@page :blank` obligatoire)

`break-before: right` insère bien une page blanche quand nécessaire : sommaire finit
p. 3 (recto) → partie forcée p. 5 avec blanche p. 4 ; ch. 1 finit p. 17 (recto) → ch. 2
ouvre p. 19 avec blanche p. 18. Quand le chapitre précédent finit sur un verso (ch. 2
finit p. 30), aucune blanche n'est insérée (ch. 3 ouvre p. 31) — correct.

**Caveat vérifié expérimentalement** : sans règle `@page :blank`, la blanche insérée
reçoit le titre courant ET le folio (contre-essai : p. 18 affichait « La Maison qui se
tait » + « 18 »). paged.js supporte `:blank`, il faut le déclarer :

```css
@page :blank { @top-left { content: none; } @top-right { content: none; }
               @bottom-center { content: none; } }
```

## Q5 — Numéros de page du sommaire : **WORKS**

```css
.toc a::after { content: target-counter(attr(href), page); flex: none; }
/* <a href="#ch1"> … ; id="ch1" sur la <section> de chapitre */
```

Le sommaire affiche 7 / 19 / 31, et les ouvertures de chapitres tombent réellement
pages 7, 19 et 31 (vérifié image par image). Résolution après repagination : exacte.

## Q6 — Points de conduite : **WORKS WITH CAVEAT** (repli CSS ; `leader()` non supporté)

`content: leader('.') target-counter(…)` : **DOES NOT WORK** — paged.js 0.4.3 ne
l'implémente pas (le bundle le dit lui-même : « leader() is omitted until
stabilization »), et le symptôme est vicieux : toute la déclaration `content` est
invalidée, donc les points ET le numéro de page disparaissent (contre-essai visuel p. 3).

Repli qui rend correctement (points alignés, numéro calé à droite, titre non écrasé) :

```html
<a href="#ch1"><span class="toc-titre">Chapitre 1. …</span><span class="toc-fill"></span></a>
```
```css
.toc a { display: flex; align-items: baseline; text-decoration: none; color: inherit; }
.toc .toc-titre { flex: 0 1 auto; }
.toc .toc-fill  { flex: 1 1 0; min-width: 1.5em; overflow: hidden;
                  white-space: nowrap; margin: 0 0.35em; text-align: right; }
.toc .toc-fill::after { content: ". . . . . . (longue chaîne de points)"; font-size: 10pt; }
.toc a::after   { content: target-counter(attr(href), page); flex: none; }
```

Piège rencontré : avec `flex: 1 1 auto` sur le remplissage, sa base flex (la chaîne de
points, très large) écrase le titre qui se replie sur deux lignes. `flex: 1 1 0` règle le
problème.

---

## Bug découvert (hors questions) : justification forcée des dernières lignes

Symptôme : à partir de la p. 9, TOUTES les dernières lignes de paragraphes (dialogues
courts inclus) étaient justifiées de force, avec des espaces énormes. Cause, lue dans le
source de paged.js : à chaque coupure de page, `handleAlignment()` pose
`data-align-last-split-element='justify'` sur l'élément scindé le plus profond ; quand la
coupure tombe ENTRE deux paragraphes, cet élément est la `<section>` de chapitre, et
comme `text-align-last` hérite, tout le chapitre restant est contaminé. Correctif CSS
(vérifié : rendu redevenu propre partout) :

```css
section[data-align-last-split-element='justify'],
header[data-align-last-split-element='justify'],
div[data-align-last-split-element='justify'] { text-align-last: auto !important; }
/* on ne neutralise PAS sur <p> : un paragraphe réellement coupé en bas de page
   garde sa dernière ligne partielle justifiée, ce qui est le comportement voulu */
```

**Ce correctif est indispensable pour un rendu professionnel — à embarquer dans la CSS
de l'app.**

## Typographie fine — constats visuels

- `hyphens: auto` + `lang="fr"` : césures françaises réelles (« lais-sées », « cour-
  tes »…) — WORKS.
- `p.premier::first-line { font-variant: small-caps }` : la première ligne du premier
  paragraphe de chaque chapitre est en petites capitales (p. 7, 19, 31) — WORKS, y
  compris quand le corps commence sur la page d'ouverture.
- Retrait 1.3em supprimé sur `p.premier` et `p.apres-blanc` (après dinkus) — WORKS.
- Dinkus ⁂ centré, sans retrait — WORKS.
- Planche pleine page avant le ch. 1, muette, sur le verso faisant face à l'ouverture
  (p. 6 face à p. 7) — WORKS. (Dans la sonde l'image est calée en haut, `max-height:
  178mm` ; un `object-fit`/hauteur fixe la centrerait.)
- EB Garamond locale prise en compte par Chromium sans embarquer la police.

## Mesures

- **Pagination** (injection du script → résolution de `previewer.preview()` + fonts +
  2×rAF) : **367–373 ms pour 42 pages** (3 chapitres, ~8 400 mots, 1 planche), stable
  sur 4 exécutions.
- **printToPDF** : 388 ms (PDF de 7,05 Mo — la planche PNG en constitue l'essentiel).
- **Extrapolation 30 chapitres / ~415 pages / 14 planches** : la pagination de paged.js
  est ~linéaire en nombre de pages ⇒ **≈ 3,7 s** au prorata ; en comptant une dérive
  superlinéaire (reflow DOM croissant), **budget réaliste : 5 à 10 s**, très acceptable
  pour un export. printToPDF ≈ 2–4 s. Attention au POIDS du PDF : 1 planche PNG ≈ 7 Mo
  ici ⇒ 14 planches ≈ 90–100 Mo ; prévoir des planches recompressées (JPEG ou PNG
  réduit) en amont.
- PDF final : 42 pages, **396 × 612 pts = exactement 139,7 × 215,9 mm** (pdfinfo),
  1 page composée = 1 page PDF, **aucune page blanche parasite en fin de document**.

## Détection de fin de pagination dans Electron (implémentation de référence)

`webContents.executeJavaScript` qui retourne une promesse ; le signal « terminé » est la
résolution de `previewer.preview()` (équivalent de l'événement `rendered` du Previewer) :

```js
await win.loadFile('book.html');   // book.html N'inclut PAS paged.js
const result = await win.webContents.executeJavaScript(`
  new Promise((resolve, reject) => {
    window.PagedConfig = { auto: false };          // avant le chargement du script
    const t0 = performance.now();
    const s = document.createElement('script');
    s.src = ${JSON.stringify('file://…/node_modules/pagedjs/dist/paged.polyfill.js')};
    s.onload = async () => {
      const previewer = new window.Paged.Previewer();
      const flow = await previewer.preview();      // ← signal de complétion
      await document.fonts.ready;                  // polices peintes
      requestAnimationFrame(() => requestAnimationFrame(() =>
        resolve({ pages: flow.total, ms: Math.round(performance.now() - t0) })));
    };
    s.onerror = () => reject(new Error('échec de chargement de paged.polyfill.js'));
    document.head.appendChild(s);
  })
`, true);
```

`flow.total` donne le nombre de pages composées — à comparer au nombre de pages du PDF
comme garde-fou. Fenêtre : `new BrowserWindow({ show: false, webPreferences: { sandbox:
true, contextIsolation: true } })` — aucun nodeIntegration nécessaire.

## Options printToPDF validées

```js
win.webContents.printToPDF({
  preferCSSPageSize: true,                       // reprend size: 139.7mm 215.9mm de @page
  printBackground: true,
  margins: { top: 0, bottom: 0, left: 0, right: 0 },  // paged.js gère les marges lui-même
})
```

Pas de `pageSize` explicite : `preferCSSPageSize` suffit (paged.js réinjecte la taille
`@page` pour l'impression). Résultat : 42/42 pages, format exact, marges portées par la
composition paged.js (y compris l'alternance intérieur/extérieur), rien de rogné.

## Journal de vérification visuelle (pdftoppm -png, lecture page par page)

| p. | attendu | constaté |
|----|---------|----------|
| 1  | titre, muette (recto) | ✓ série + titre + auteur centrés, aucun folio/titre courant |
| 2  | colophon, muette (verso) | ✓ bloc en bas de page, muette |
| 3  | sommaire, muette (recto) | ✓ 3 entrées, points de conduite, folios 7/19/31 |
| 4  | blanche insérée, muette | ✓ entièrement vide |
| 5  | page de partie « Première partie — Le poids », recto, muette | ✓ |
| 6  | planche pleine page, muette (verso, face au ch. 1) | ✓ image seule |
| 7  | ouverture ch. 1, recto, muette, corps démarre, 1re ligne en petites caps | ✓ |
| 8  | verso : « La Maison qui se tait » haut-gauche + folio 8 ; dinkus ; pas de retrait après dinkus | ✓ |
| 9  | recto : « TROIS HEURES DU MATIN » haut-droite + folio 9 ; justification normale après correctif | ✓ |
| 10 | verso : titre livre + folio 10 | ✓ |
| 11 | recto : titre ch. 1 + folio 11 | ✓ |
| 12 | verso : titre livre + folio 12 | ✓ |
| 17 | dernière page ch. 1 (recto, folio 17) | ✓ |
| 18 | blanche insérée avant ch. 2, muette | ✓ (et contre-essai sans `@page :blank` : elle affichait entête+folio) |
| 19 | ouverture ch. 2 recto muette = folio annoncé au sommaire | ✓ |
| 20/21 | versos/rectos ch. 2, entête recto = « CEUX QUI NE VOIENT PAS » | ✓ |
| 30 | fin ch. 2 sur un verso → pas de blanche | ✓ |
| 31 | ouverture ch. 3 recto muette = folio annoncé | ✓ |
| 42 | dernière page, folio 42, pas de page parasite ensuite | ✓ |

## RECOMMANDATION

**Faisable avec paged.js dans Electron — la totalité de la maquette cible est atteinte
dans la sonde.** Rien n'exige de contournement côté app au sens « fonctionnalité
manquante » ; trois éléments sont à embarquer d'office dans la CSS/le code de l'app :

1. **Correctif justification** `[data-align-last-split-element]` (bug paged.js, sinon
   rendu inacceptable dès la 2e coupure de page).
2. **`@page :blank`** pour museler les pages blanches insérées (sinon entête + folio).
3. **Points de conduite en repli CSS** (`leader()` non supporté ; ne jamais l'écrire :
   il avale aussi le `target-counter` de la même déclaration).

Points de vigilance pour l'implémentation réelle :
- paged.js réécrit tout le DOM en `.pagedjs_page` ; la fenêtre doit être dédiée à
  l'export (c'est déjà l'architecture de `src/main/pdf.ts`).
- Charger paged.js APRÈS `loadFile` avec `PagedConfig.auto=false` et attendre
  `previewer.preview()` — ne pas se fier à `did-finish-load`.
- Recompresser les planches avant inclusion (poids PDF ≈ proportionnel aux PNG).
- Performance largement suffisante (≈ 0,4 s / 42 p. ; budget < 10 s pour 415 p.).
- Ce qui resterait hors de portée par rapport à WeasyPrint : rien dans la maquette
  demandée ; les écarts connus de paged.js (notes de bas de page complexes, `leader()`)
  ne concernent pas ce livre.
