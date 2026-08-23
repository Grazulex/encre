# Maquette PDF (paged.js) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Porter l'export PDF d'Encre au niveau d'une vraie maquette de livre — pages d'ouverture, titres courants, folios, sommaire paginé, pages muettes, recto forcé — l'auteur posant lui-même les éléments de mise en page depuis l'éditeur.

**Architecture:** `src/main/pdf.ts` se scinde en `pdf/style.ts` (feuille d'impression), `pdf/html.ts` (assemblage du document, pur et testable) et `pdf/render.ts` (fenêtre cachée + paged.js + printToPDF). Quatre nouveaux nœuds TipTap (`chapterOpening`, `partOpening`, `tableOfContents`, `frontMatterPage`) traversent `shared/export.ts`, qui gagne un unique point d'extension `layout` sur le modèle du `illustration` déjà en place.

**Tech Stack:** Electron + Vue 3 + TipTap 3 + better-sqlite3 + vitest, plus **paged.js 0.4.3** (MIT), unique nouvelle dépendance.

**Spec:** `docs/superpowers/specs/2026-08-23-maquette-pdf-design.md`

**Sonde de faisabilité (à lire avant les tâches 3 et 5) :** `docs/superpowers/notes/2026-08-23-sonde-pagedjs.md` — elle contient la CSS et le JS **prouvés expérimentalement** dans Electron. Ne pas réinventer ces mécanismes ni « améliorer » les valeurs qui y figurent.

## Global Constraints

- Toute la copie UI et tous les commentaires de code sont en **français**, dans le ton des fichiers existants (le commentaire dit le *pourquoi*, pas le *quoi*).
- Aucune nouvelle dépendance npm **hormis `pagedjs@^0.4.3`** (tâche 5).
- Tests : itérer avec `npx vitest run <fichier>`. Si une erreur de version de module natif apparaît, lancer `npm run rebuild:node` une fois. `npm test` (qui recompile better-sqlite3 pour Node puis pour Electron) seulement si nécessaire.
- Typecheck : `npm run typecheck:node` (main/shared) et `npm run typecheck:web` (renderer).
- Un commit par tâche minimum, message en français (`feat:`, `fix:`, `docs:`…) terminé par `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- **Trois éléments sont obligatoires dans la CSS d'impression**, faute de quoi le rendu est faux : le correctif `text-align-last: auto !important` sur `[data-align-last-split-element='justify']`, la règle `@page :blank`, et les points de conduite en repli flex. **`leader('.')` ne doit jamais être écrit** : paged.js ne l'implémente pas et sa présence invalide toute la déclaration `content`, faisant disparaître le numéro de page avec les points.
- Le renderer n'a **aucune** infrastructure de test dans ce dépôt. Ne pas en introduire. Pour les tâches renderer, la garde est `npm run typecheck:web`.
- Noms de nœuds TipTap en anglais (`chapterOpening`…), comme `sceneBreak`/`pageBreak`/`illustration` existants ; libellés affichés en français.

## Contrat DOM du document PDF

Toutes les tâches partagent cette structure, **plate** (aucune imbrication de sections), calquée sur celle d'`atelier` :

```html
<section class="liminaire liminaire-titre">…blocs de l'auteur…</section>
<section class="sommaire"><h2>SOMMAIRE</h2><ol class="toc">…</ol></section>
<section class="page-partie" id="part-1"><p class="partie-label">Première partie — Le poids</p><div class="filet"></div></section>
<section class="illustration"><img src="file://…"/></section>
<section class="ouverture" id="ouv-1"><p class="enseigne">CHAPITRE 1</p><h2 class="titre-chapitre">TROIS HEURES DU MATIN</h2><div class="filet"></div></section>
<section class="chapitre"><p>…</p><p>…</p></section>
```

Un nœud de mise en page devient donc **toujours une section de premier niveau**, et les blocs ordinaires qui les séparent forment des segments `<section class="chapitre">`. C'est le découpage qui rend les pages muettes et les sauts recto prévisibles.

---

### Task 1: Format de page du livre (migration 5, types, réglages)

**Files:**
- Modify: `src/main/db/migrations.ts` (5e entrée de `MIGRATIONS`)
- Modify: `src/shared/types.ts` (`BookPageFormat`, `Book`, `BookPatch`)
- Modify: `src/main/db/books.ts` (mapping de colonne + patch)
- Modify: `src/renderer/src/components/BookSettingsPanel.vue` (sélecteur)
- Test: `src/main/db/migration5.test.ts` (créer), `src/main/db/books.test.ts` (cas ajouté)

**Interfaces:**
- Consomme : `Db`, `migrate`, `openDb` de `src/main/db/connection.ts` ; `MIGRATIONS`.
- Produit (utilisé par les tâches 3, 4, 5) :
  - `export type BookPageFormat = 'broche' | 'relie'` dans `src/shared/types.ts` ;
  - `Book.pageFormat: BookPageFormat` (lu par `getBook`) ;
  - `BookPatch.pageFormat?: BookPageFormat`.

- [ ] **Step 1: Écrire les tests qui échouent**

`src/main/db/migration5.test.ts` (calqué sur `migration4.test.ts`) :

```ts
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, openDb } from './connection'
import { MIGRATIONS } from './migrations'

describe('migration 5', () => {
  it('fait passer une base v4 peuplée en v5 sans perte', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    db.exec(MIGRATIONS[0]); db.exec(MIGRATIONS[1]); db.exec(MIGRATIONS[2]); db.exec(MIGRATIONS[3])
    db.pragma('user_version = 4')
    db.prepare("INSERT INTO books (title) VALUES ('Livre v4')").run()

    migrate(db)

    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)
    const book = db.prepare('SELECT id, page_format FROM books WHERE id = 1').get() as any
    expect(book.id).toBe(1)
    expect(book.page_format).toBe('broche')
  })

  it('une base neuve part directement en v5', () => {
    const db = openDb(':memory:')
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)
    db.close()
  })
})
```

Ajouter à `src/main/db/books.test.ts` :

```ts
  it('expose et met à jour le format de page', () => {
    const db = openDb(':memory:')
    const book = createBook(db, { title: 'Broché par défaut' })
    expect(book.pageFormat).toBe('broche')
    expect(updateBook(db, book.id, { pageFormat: 'relie' }).pageFormat).toBe('relie')
  })
```

(Adapter les imports au style déjà présent en tête de `books.test.ts`.)

- [ ] **Step 2: Vérifier l'échec**

Run : `npx vitest run src/main/db/migration5.test.ts src/main/db/books.test.ts`
Attendu : FAIL (colonne `page_format` inexistante, `pageFormat` absent du type).

- [ ] **Step 3: Implémenter**

Dans `src/main/db/migrations.ts`, ajouter une 5e entrée au tableau :

```ts
  `
  ALTER TABLE books ADD COLUMN page_format TEXT NOT NULL DEFAULT 'broche';
  `
```

Dans `src/shared/types.ts`, à côté de `BookStatus` :

```ts
// Format de fabrication du livre : pilote la maquette de l'export PDF (taille de
// page, marges alternées, corps et interligne) — cf. pdf/style.ts.
export type BookPageFormat = 'broche' | 'relie'
```

puis ajouter `pageFormat: BookPageFormat` à `Book` et `pageFormat: BookPageFormat` à l'objet `BookPatch`.

Dans `src/main/db/books.ts` : ajouter `pageFormat: row.page_format` au convertisseur de ligne, et l'entrée `pageFormat: { col: 'page_format' }` à la table des colonnes patchables (suivre exactement la mécanique déjà en place dans ce fichier — lire `COLS`/`updateBook` avant d'écrire).

Dans `src/renderer/src/components/BookSettingsPanel.vue`, ajouter un champ sur le modèle des champs existants (`<label class="field"><span class="field-label">…`), placé après « Genre » :

```html
        <label class="field">
          <span class="field-label">Format</span>
          <select :value="store.book.pageFormat" @change="onPageFormatChange">
            <option value="broche">Broché — 139,7 × 215,9 mm</option>
            <option value="relie">Relié — 6,14 × 9,21 in</option>
          </select>
        </label>
```

avec un handler suivant le style des `onTitleInput`/`onGenreInput` déjà présents (lire leur implémentation et la reproduire ; ils passent par le store, pas par un `window.encre` direct).

- [ ] **Step 4: Vérifier le passage**

Run : `npx vitest run src/main/db/ && npm run typecheck:node && npm run typecheck:web`
Attendu : PASS partout (les tests des migrations 2/3/4 comparent à `MIGRATIONS.length`, ils suivent).

- [ ] **Step 5: Commit**

```bash
git add src/main/db/migrations.ts src/main/db/books.ts src/main/db/migration5.test.ts src/main/db/books.test.ts src/shared/types.ts src/renderer/src/components/BookSettingsPanel.vue
git commit -m "feat: format de page du livre (broché/relié, migration 5)"
```

---

### Task 2: Les quatre nœuds dans le sérialiseur d'export

**Files:**
- Modify: `src/shared/export.ts`
- Modify: `src/main/epub.ts` (CSS des nouveaux blocs)
- Test: `src/shared/export.test.ts` (cas ajoutés), `src/main/epub.test.ts` (cas ajouté)

**Interfaces:**
- Consomme : `ExportOptions` (déjà présent, avec `illustration`), `tiptapToMarkdown`/`tiptapToXhtml`.
- Produit (utilisé par la tâche 4) :

```ts
export interface LayoutNode { type: string; attrs: Record<string, any> }
// Rendu des nœuds de mise en page (chapterOpening, partOpening, tableOfContents,
// frontMatterPage) par le consommateur. `children` porte le rendu déjà fait des
// blocs enfants (vide pour les atomes). Retourner null omet le nœud.
export type LayoutRenderer = (
  node: LayoutNode,
  children: { md: string; xhtml: string }
) => { md: string; xhtml: string } | null

export interface ExportOptions {
  illustration?: (attrs: IllustrationAttrs) => { md: string; xhtml: string } | null
  layout?: LayoutRenderer
}
```

Rendu **par défaut** (aucun `layout` fourni) — celui qu'utilisent l'EPUB et le Markdown :

| Nœud | Markdown | XHTML |
|---|---|---|
| `chapterOpening` | `# {titre}` | `<div class="ouverture"><p class="enseigne">{enseigne}</p><h1>{titre}</h1></div>` |
| `partOpening` | `# {label}` | `<h1 class="partie">{label}</h1>` |
| `tableOfContents` | `` (omis) | `` (omis) |
| `frontMatterPage` | le rendu de ses enfants | `<div class="liminaire liminaire-{genre}">{enfants}</div>` |

Attributs : `chapterOpening { enseigne: string; titre: string; recto: boolean }`, `partOpening { label: string; recto: boolean }`, `tableOfContents { titre: string }`, `frontMatterPage { genre: 'titre' | 'colophon' | 'dedicace' }`.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à `src/shared/export.test.ts` :

```ts
describe('nœuds de mise en page', () => {
  const doc = JSON.stringify({
    type: 'doc',
    content: [
      { type: 'frontMatterPage', attrs: { genre: 'titre' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'LA MAISON' }] }] },
      { type: 'tableOfContents', attrs: { titre: 'SOMMAIRE' } },
      { type: 'partOpening', attrs: { label: 'Première partie', recto: true } },
      { type: 'chapterOpening', attrs: { enseigne: 'CHAPITRE 1', titre: 'TROIS HEURES', recto: true } },
      { type: 'paragraph', content: [{ type: 'text', text: 'Le cri.' }] }
    ]
  })

  it('rend chaque nœud par défaut (EPUB / Markdown)', () => {
    const md = tiptapToMarkdown(doc)
    expect(md).toContain('LA MAISON')
    expect(md).toContain('# Première partie')
    expect(md).toContain('# TROIS HEURES')
    expect(md).not.toContain('SOMMAIRE')      // sommaire omis hors PDF
    const xhtml = tiptapToXhtml(doc)
    expect(xhtml).toContain('<div class="liminaire liminaire-titre">')
    expect(xhtml).toContain('<p class="enseigne">CHAPITRE 1</p>')
    expect(xhtml).toContain('<h1>TROIS HEURES</h1>')
    expect(xhtml).toContain('<h1 class="partie">Première partie</h1>')
    expect(xhtml).toContain('<p>Le cri.</p>')
  })

  it('échappe le XML des attributs', () => {
    const d = JSON.stringify({ type: 'doc', content: [
      { type: 'partOpening', attrs: { label: 'Fer & <acier>', recto: false } }
    ] })
    expect(tiptapToXhtml(d)).toContain('Fer &amp; &lt;acier&gt;')
  })

  it('délègue au callback layout quand il est fourni, et omet sur null', () => {
    const seen: string[] = []
    const opts = {
      layout: (node: any, children: { md: string; xhtml: string }) => {
        seen.push(node.type)
        if (node.type === 'tableOfContents') return { md: '', xhtml: '<nav>TDM</nav>' }
        if (node.type === 'partOpening') return null
        return { md: `[${node.type}]`, xhtml: `<x>${children.xhtml}</x>` }
      }
    }
    const xhtml = tiptapToXhtml(doc, opts)
    expect(seen).toEqual(['frontMatterPage', 'tableOfContents', 'partOpening', 'chapterOpening'])
    expect(xhtml).toContain('<nav>TDM</nav>')
    expect(xhtml).not.toContain('Première partie')
    expect(xhtml).toContain('<x><p>LA MAISON</p></x>')  // enfants rendus, passés au callback
  })
})
```

Ajouter à `src/main/epub.test.ts` :

```ts
  it('style.css définit les blocs de mise en page', async () => {
    const db = openDb(':memory:')
    const api = createApi(db)
    const book = await api.books.create({ title: 'EPUB liminaires' })
    await api.chapters.create(book.id, 'Un')
    const zip = await JSZip.loadAsync(await buildEpub(db, book.id, []))
    const css = await zip.file('OEBPS/style.css')!.async('string')
    expect(css).toContain('.liminaire')
    expect(css).toContain('.ouverture')
  })
```

- [ ] **Step 2: Vérifier l'échec**

Run : `npx vitest run src/shared/export.test.ts src/main/epub.test.ts`
Attendu : FAIL (les nœuds tombent dans le repli paragraphe, `layout` inexistant, CSS EPUB sans `.liminaire`).

- [ ] **Step 3: Implémenter**

Dans `src/shared/export.ts` :

1. Ajouter les types `LayoutNode` et `LayoutRenderer` du bloc Interfaces ci-dessus, et le champ `layout?: LayoutRenderer` à `ExportOptions` (commentaire français expliquant le pourquoi du point d'extension unique).
2. Déclarer l'ensemble des types concernés :

```ts
// Nœuds de mise en page (spec maquette PDF) : ils produisent des pages entières
// dans le PDF, un simple bloc sémantique ailleurs. Le PDF passe par ExportOptions
// .layout pour poser ses `id` d'ancrage et développer le sommaire ; sans callback,
// le rendu par défaut ci-dessous sert l'EPUB et le Markdown.
const LAYOUT_TYPES = new Set(['chapterOpening', 'partOpening', 'tableOfContents', 'frontMatterPage'])
```

3. Dans `renderBlockNode`, **avant** le traitement des conteneurs de blocs et du repli paragraphe (donc à la suite des autres atomes : `sceneBreak`, `pageBreak`, `illustration`) :

```ts
  if (LAYOUT_TYPES.has(node.type)) {
    // frontMatterPage porte des blocs enfants ; les trois autres sont des atomes.
    const children = node.type === 'frontMatterPage'
      ? renderChildBlocks(node.content ?? [], opts)
      : { md: '', xhtml: '' }
    if (opts.layout) {
      return opts.layout({ type: node.type, attrs: node.attrs ?? {} }, children) ?? { md: '', xhtml: '' }
    }
    return defaultLayoutRender(node, children)
  }
```

4. Ajouter les deux fonctions d'appui :

```ts
// Rend une suite de blocs enfants comme le fait renderBlocks, mais pour un nœud
// conteneur : les blocs Markdown sont séparés par une ligne vide, le XHTML par un
// simple retour à la ligne.
function renderChildBlocks(nodes: any[], opts: ExportOptions): { md: string; xhtml: string } {
  const parts = nodes.map((n) => renderBlockNode(n, opts))
  return {
    md: parts.map((p) => p.md).filter((m) => m !== '').join('\n\n'),
    xhtml: parts.map((p) => p.xhtml).filter((x) => x !== '').join('\n')
  }
}

// Rendu par défaut des nœuds de mise en page : celui de l'EPUB et du Markdown.
// Le sommaire n'y a pas de sens (l'EPUB a sa navigation native, le Markdown n'a
// pas de pages) : il est omis.
function defaultLayoutRender(node: any, children: { md: string; xhtml: string }): { md: string; xhtml: string } {
  const attrs = node.attrs ?? {}
  if (node.type === 'chapterOpening') {
    const enseigne = String(attrs.enseigne ?? '')
    const titre = String(attrs.titre ?? '')
    const enseigneHtml = enseigne ? `<p class="enseigne">${escapeXml(enseigne)}</p>` : ''
    return { md: `# ${titre}`, xhtml: `<div class="ouverture">${enseigneHtml}<h1>${escapeXml(titre)}</h1></div>` }
  }
  if (node.type === 'partOpening') {
    const label = String(attrs.label ?? '')
    return { md: `# ${label}`, xhtml: `<h1 class="partie">${escapeXml(label)}</h1>` }
  }
  if (node.type === 'tableOfContents') {
    return { md: '', xhtml: '' }
  }
  const genre = String(attrs.genre ?? 'titre')
  return { md: children.md, xhtml: `<div class="liminaire liminaire-${escapeXml(genre)}">${children.xhtml}</div>` }
}
```

Dans `src/main/epub.ts`, ajouter à `STYLE_CSS` :

```css
.liminaire {
  text-align: center;
  text-indent: 0;
  margin: 2em 0;
}
.liminaire p {
  text-indent: 0;
}
.ouverture {
  text-align: center;
  margin: 2em 0;
}
.ouverture .enseigne {
  font-variant: small-caps;
  letter-spacing: 0.18em;
  text-indent: 0;
  font-size: 0.85em;
}
h1.partie {
  text-align: center;
  font-variant: small-caps;
}
```

- [ ] **Step 4: Vérifier le passage (et l'absence de régression)**

Run : `npx vitest run src/shared/export.test.ts src/main/epub.test.ts src/main/exporter.test.ts src/main/smoke.test.ts && npm run typecheck:node && npm run typecheck:web`
Attendu : PASS partout.

- [ ] **Step 5: Commit**

```bash
git add src/shared/export.ts src/shared/export.test.ts src/main/epub.ts src/main/epub.test.ts
git commit -m "feat: nœuds de mise en page dans le sérialiseur d'export"
```

---

### Task 3: `pdf/style.ts` — la feuille d'impression

**Files:**
- Create: `src/main/pdf/style.ts`
- Test: `src/main/pdf/style.test.ts`

**Interfaces:**
- Consomme (tâche 1) : `BookPageFormat` de `src/shared/types.ts`.
- Produit (utilisé par la tâche 4) : `buildPrintCss(format: BookPageFormat, bookTitle: string): string`.

**Lire d'abord** `docs/superpowers/notes/2026-08-23-sonde-pagedjs.md` (sections Q1 à Q6 et « Bug découvert ») : la CSS ci-dessous en est tirée et a été vérifiée visuellement dans Electron. Ne pas s'en écarter.

**Note de spec :** la spec §1 décrit `PRINT_CSS(format)` « sans connaissance du livre ». Le titre courant des versos est une chaîne littérale interpolée dans la CSS (c'est ce que fait `atelier`), donc la fonction prend le titre en second paramètre. Mettre à jour cette ligne de la spec fait partie de la tâche.

- [ ] **Step 1: Écrire les tests qui échouent**

`src/main/pdf/style.test.ts` :

```ts
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

  it('pose le titre courant depuis l’ouverture ET depuis le titre de repli', () => {
    const css = buildPrintCss('broche', 'X')
    expect(css).toContain('.ouverture .titre-chapitre')
    expect(css).toContain('.chapitre h1.titre-chapitre')
    expect(css).toContain('string-set: entete content(text)')
  })
})
```

- [ ] **Step 2: Vérifier l'échec**

Run : `npx vitest run src/main/pdf/style.test.ts`
Attendu : FAIL (module `./style` inexistant).

- [ ] **Step 3: Implémenter**

`src/main/pdf/style.ts` :

```ts
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
.chapitre > p:first-of-type { text-indent: 0; }
.chapitre > p:first-of-type::first-line { font-variant: small-caps; letter-spacing: .04em; }
.scene-break + p, hr.page-break + p { text-indent: 0; }
.chapitre h1 { font-size: 1.4em; font-weight: normal; text-align: center; text-indent: 0; margin: 0 0 1.4em; }

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

/* Sommaire — points de conduite en repli flex : leader('.') n'existe pas dans
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
```

Puis mettre à jour la spec : dans `docs/superpowers/specs/2026-08-23-maquette-pdf-design.md`, §1, remplacer la description de `PRINT_CSS(format)` par `buildPrintCss(format, bookTitle)` en disant que le titre courant des versos est une chaîne littérale interpolée, comme dans `atelier`.

- [ ] **Step 4: Vérifier le passage**

Run : `npx vitest run src/main/pdf/style.test.ts && npm run typecheck:node`
Attendu : PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/pdf/style.ts src/main/pdf/style.test.ts docs/superpowers/specs/2026-08-23-maquette-pdf-design.md
git commit -m "feat: feuille d'impression de la maquette PDF"
```

---

### Task 4: `pdf/html.ts` — assemblage du document

**Files:**
- Create: `src/main/pdf/html.ts`
- Test: `src/main/pdf/html.test.ts`

**Interfaces:**
- Consomme : `buildPrintCss(format, bookTitle)` (tâche 3) ; `ExportOptions`, `LayoutRenderer`, `tiptapToXhtml`, `escapeXml` de `src/shared/export.ts` (tâche 2) ; `getBook`, `listChapters`, `getChapter` ; `IMAGE_MEDIA_TYPES` de `src/main/epub.ts` ; `Book.pageFormat` (tâche 1).
- Produit (utilisé par la tâche 5) : `buildBookHtml(db: Db, bookId: number, chapterIds: number[], mediaDir?: string): string`.

**Contrat de sortie** — voir « Contrat DOM du document PDF » en tête de plan. Points qui font la tâche :

1. **Deux passes.** Le sommaire doit connaître des nœuds vivant dans d'autres chapitres. Passe 1 : parcours de tous les chapitres retenus, dans l'ordre, relevant chaque `partOpening` et `chapterOpening` et leur attribuant un `id` séquentiel (`part-1`, `ouv-1`, `ouv-2`…). Passe 2 : rendu, où chaque `tableOfContents` est développé à partir du relevé.
2. **Découpage plat.** Les nœuds de mise en page sortent en sections de premier niveau ; les blocs ordinaires entre eux forment des segments `<section class="chapitre">`. Concrètement : rendre le document du chapitre via `tiptapToXhtml(contentJson, opts)` où le callback `layout` renvoie un **marqueur de coupure** unique autour de la section produite, puis découper la chaîne obtenue sur ce marqueur et envelopper chaque tronçon non vide restant dans `<section class="chapitre">`. Le marqueur retenu est `%%ENCRE-SECTION%%` (même stratégie que le jeton de saut de page de `importer.ts`, avec la même collision acceptée et documentée).
3. **Repli de titre.** Un chapitre dont le contenu ne comporte **aucun** `chapterOpening` reçoit, en tête de son premier segment, `<h1 class="titre-chapitre">{titre du chapitre}</h1>` — porteur du même `string-set`, il alimente donc le titre courant des rectos. Ce titre ne crée pas de page muette : il coule en tête du corps.
4. **Planches.** Le callback `illustration` reste celui du PDF actuel (`src/main/pdf.ts` avant scission) : garde `fileName !== basename(fileName)`, `existsSync`, extension connue de `IMAGE_MEDIA_TYPES`, `pathToFileURL`. Chaque planche sort en `<section class="illustration">` et doit donc, elle aussi, passer par le marqueur de coupure.

- [ ] **Step 1: Écrire les tests qui échouent**

`src/main/pdf/html.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { openDb } from '../db/connection'
import { createApi } from '../api'
import { buildBookHtml } from './html'

function doc(...content: any[]): string {
  return JSON.stringify({ type: 'doc', content })
}
const para = (t: string) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] })

async function livre() {
  const db = openDb(':memory:')
  const api = createApi(db)
  const book = await api.books.create({ title: 'LA MAISON', author: 'JMS' })
  return { db, api, book }
}

describe('buildBookHtml', () => {
  it('sort les nœuds de mise en page en sections de premier niveau, corps en segments', async () => {
    const { db, api, book } = await livre()
    const ch = await api.chapters.create(book.id, 'Un')
    await api.chapters.saveContent(ch.id, doc(
      { type: 'chapterOpening', attrs: { enseigne: 'CHAPITRE 1', titre: 'TROIS HEURES', recto: true } },
      para('Le cri.'),
      para('Elle était debout.')
    ), 'Le cri. Elle était debout.')

    const html = buildBookHtml(db, book.id, [])
    expect(html).toContain('<section class="ouverture" id="ouv-1" data-recto="true">')
    expect(html).toContain('<p class="enseigne">CHAPITRE 1</p>')
    expect(html).toContain('<h2 class="titre-chapitre">TROIS HEURES</h2>')
    expect(html).toContain('<section class="chapitre">')
    expect(html).toContain('<p>Le cri.</p>')
    // l'ouverture n'est pas imbriquée dans le segment de corps
    expect(html.indexOf('<section class="ouverture"')).toBeLessThan(html.indexOf('<section class="chapitre">'))
    expect(html).not.toMatch(/<section class="chapitre">[\s\S]*<section class="ouverture"/)
  })

  it('développe le sommaire avec parties et chapitres dans l’ordre du livre', async () => {
    const { db, api, book } = await livre()
    const lim = await api.chapters.create(book.id, 'Liminaires')
    await api.chapters.saveContent(lim.id, doc(
      { type: 'tableOfContents', attrs: { titre: 'SOMMAIRE' } }
    ), '')
    const c1 = await api.chapters.create(book.id, 'Un')
    await api.chapters.saveContent(c1.id, doc(
      { type: 'partOpening', attrs: { label: 'Première partie', recto: true } },
      { type: 'chapterOpening', attrs: { enseigne: 'CHAPITRE 1', titre: 'TROIS HEURES', recto: true } },
      para('Le cri.')
    ), 'Le cri.')
    const c2 = await api.chapters.create(book.id, 'Deux')
    await api.chapters.saveContent(c2.id, doc(
      { type: 'chapterOpening', attrs: { enseigne: 'CHAPITRE 2', titre: 'CEUX QUI', recto: true } },
      para('Suite.')
    ), 'Suite.')

    const html = buildBookHtml(db, book.id, [])
    expect(html).toContain('<section class="sommaire">')
    expect(html).toContain('<h2>SOMMAIRE</h2>')
    expect(html).toContain('<li class="toc-partie">Première partie</li>')
    expect(html).toContain('<a href="#ouv-1">')
    expect(html).toContain('<a href="#ouv-2">')
    expect(html).toContain('<span class="toc-fill"></span>')
    expect(html.indexOf('href="#ouv-1"')).toBeLessThan(html.indexOf('href="#ouv-2"'))
    expect(html).toContain('id="part-1"')
  })

  it('replie sur le titre du chapitre quand aucune ouverture n’est posée', async () => {
    const { db, api, book } = await livre()
    const ch = await api.chapters.create(book.id, 'Sans ouverture')
    await api.chapters.saveContent(ch.id, doc(para('Texte.')), 'Texte.')

    const html = buildBookHtml(db, book.id, [])
    expect(html).toContain('<h1 class="titre-chapitre">Sans ouverture</h1>')
    expect(html).not.toContain('class="ouverture"')
  })

  it('ne replie pas quand une ouverture est posée', async () => {
    const { db, api, book } = await livre()
    const ch = await api.chapters.create(book.id, 'Titre en base')
    await api.chapters.saveContent(ch.id, doc(
      { type: 'chapterOpening', attrs: { enseigne: 'CH. 1', titre: 'Titre posé', recto: false } },
      para('Texte.')
    ), 'Texte.')

    const html = buildBookHtml(db, book.id, [])
    expect(html).not.toContain('<h1 class="titre-chapitre">Titre en base</h1>')
    expect(html).toContain('data-recto="false"')
  })

  it('embarque la feuille du bon format et le titre du livre', async () => {
    const { db, api, book } = await livre()
    await api.chapters.create(book.id, 'Un')
    expect(buildBookHtml(db, book.id, [])).toContain('size: 139.7mm 215.9mm')
    await api.books.update(book.id, { pageFormat: 'relie' })
    const html = buildBookHtml(db, book.id, [])
    expect(html).toContain('size: 6.14in 9.21in')
    expect(html).toContain('content: "LA MAISON"')
  })

  it('rend un sommaire vide sans erreur quand aucune ouverture n’est posée', async () => {
    const { db, api, book } = await livre()
    const ch = await api.chapters.create(book.id, 'Liminaires')
    await api.chapters.saveContent(ch.id, doc(
      { type: 'tableOfContents', attrs: { titre: 'SOMMAIRE' } }
    ), '')
    const html = buildBookHtml(db, book.id, [])
    expect(html).toContain('<section class="sommaire">')
    expect(html).not.toContain('<a href="#ouv-')
  })

  it('rend une page liminaire avec son contenu et son genre', async () => {
    const { db, api, book } = await livre()
    const ch = await api.chapters.create(book.id, 'Liminaires')
    await api.chapters.saveContent(ch.id, doc(
      { type: 'frontMatterPage', attrs: { genre: 'colophon' }, content: [para('© 2026')] }
    ), '© 2026')
    const html = buildBookHtml(db, book.id, [])
    expect(html).toContain('<section class="liminaire liminaire-colophon">')
    expect(html).toContain('<p>© 2026</p>')
  })
})
```

- [ ] **Step 2: Vérifier l'échec**

Run : `npx vitest run src/main/pdf/html.test.ts`
Attendu : FAIL (module `./html` inexistant).

- [ ] **Step 3: Implémenter**

`src/main/pdf/html.ts` : lire d'abord `src/main/pdf.ts` (le callback `illustration` et la garde `basename` y sont déjà écrits, les reprendre tels quels) et `src/shared/export.ts` (signature de `layout`). Structure attendue :

```ts
import { existsSync } from 'fs'
import { join, extname, basename } from 'path'
import { pathToFileURL } from 'url'
import type { Db } from '../db/connection'
import { getBook } from '../db/books'
import { listChapters, getChapter } from '../db/chapters'
import { tiptapToXhtml, escapeXml } from '../../shared/export'
import type { ExportOptions } from '../../shared/export'
import { IMAGE_MEDIA_TYPES } from '../epub'
import { buildPrintCss } from './style'

// Marqueur de coupure : le sérialiseur rend les nœuds de mise en page à leur place
// dans le flux du chapitre, mais la maquette exige qu'ils soient des sections de
// premier niveau (c'est ce qui rend les pages muettes et les sauts recto
// prévisibles). On les encadre donc d'un jeton, puis on découpe la chaîne rendue
// dessus. Même stratégie et même collision acceptée que le jeton de saut de page
// de importer.ts : un auteur qui écrirait littéralement ce jeton verrait son
// paragraphe coupé en deux.
const COUPURE = '%%ENCRE-SECTION%%'

interface Ancre {
  kind: 'part' | 'chapter'
  id: string
  enseigne: string
  texte: string
}
```

Puis, dans l'ordre :

```ts
const entourer = (section: string): string => `${COUPURE}${section}${COUPURE}`

function walk(node: any, visit: (n: any) => void): void {
  visit(node)
  if (Array.isArray(node?.content)) node.content.forEach((c: any) => walk(c, visit))
}

// Passe 1 : relève les ancres de tous les chapitres retenus, dans l'ordre du livre.
// Le sommaire d'un chapitre doit pouvoir citer les ouvertures des autres, d'où ce
// premier parcours complet avant tout rendu.
function collectAnchors(docs: string[]): Ancre[] {
  const ancres: Ancre[] = []
  let parts = 0
  let chapitres = 0
  for (const json of docs) {
    let doc: any
    try {
      doc = JSON.parse(json)
    } catch {
      continue
    }
    walk(doc, (n) => {
      if (n?.type === 'partOpening') {
        parts += 1
        ancres.push({ kind: 'part', id: `part-${parts}`, enseigne: '', texte: String(n.attrs?.label ?? '') })
      } else if (n?.type === 'chapterOpening') {
        chapitres += 1
        ancres.push({
          kind: 'chapter',
          id: `ouv-${chapitres}`,
          enseigne: String(n.attrs?.enseigne ?? ''),
          texte: String(n.attrs?.titre ?? '')
        })
      }
    })
  }
  return ancres
}

function contientOuverture(contentJson: string): boolean {
  let trouve = false
  try {
    walk(JSON.parse(contentJson), (n) => {
      if (n?.type === 'chapterOpening') trouve = true
    })
  } catch {
    return false
  }
  return trouve
}

// Le numéro de page et les points de conduite sont posés par la CSS
// (target-counter + remplissage flex) : ici on ne produit que la structure.
function renderToc(ancres: Ancre[], titre: string): string {
  const items = ancres.map((a) => {
    if (a.kind === 'part') return `<li class="toc-partie">${escapeXml(a.texte)}</li>`
    const enseigne = a.enseigne ? `<span class="toc-enseigne">${escapeXml(a.enseigne)} — </span>` : ''
    return `<li><a href="#${a.id}"><span class="toc-titre">${enseigne}${escapeXml(a.texte)}</span><span class="toc-fill"></span></a></li>`
  })
  return `<section class="sommaire"><h2>${escapeXml(titre)}</h2><ol>\n${items.join('\n')}\n</ol></section>`
}

// Les compteurs de ce rendu suivent le même ordre de parcours que collectAnchors,
// donc les identifiants coïncident. Il ne doit exister QU'UN renderer pour tout le
// livre : en créer un par chapitre remettrait les compteurs à zéro et ferait
// pointer tous les sommaires sur les ancres du premier chapitre.
function makeLayoutRenderer(ancres: Ancre[]): NonNullable<ExportOptions['layout']> {
  let parts = 0
  let chapitres = 0
  return (node, children) => {
    const attrs = node.attrs ?? {}
    const recto = attrs.recto === false ? 'false' : 'true'
    if (node.type === 'chapterOpening') {
      chapitres += 1
      const enseigne = String(attrs.enseigne ?? '')
      const ligne = enseigne ? `<p class="enseigne">${escapeXml(enseigne)}</p>` : ''
      return {
        md: '',
        xhtml: entourer(
          `<section class="ouverture" id="ouv-${chapitres}" data-recto="${recto}">${ligne}` +
            `<h2 class="titre-chapitre">${escapeXml(String(attrs.titre ?? ''))}</h2>` +
            `<div class="filet"></div></section>`
        )
      }
    }
    if (node.type === 'partOpening') {
      parts += 1
      return {
        md: '',
        xhtml: entourer(
          `<section class="page-partie" id="part-${parts}" data-recto="${recto}">` +
            `<p class="partie-label">${escapeXml(String(attrs.label ?? ''))}</p>` +
            `<div class="filet"></div></section>`
        )
      }
    }
    if (node.type === 'tableOfContents') {
      return { md: '', xhtml: entourer(renderToc(ancres, String(attrs.titre ?? 'SOMMAIRE'))) }
    }
    const genre = String(attrs.genre ?? 'titre')
    return {
      md: '',
      xhtml: entourer(`<section class="liminaire liminaire-${escapeXml(genre)}">${children.xhtml}</section>`)
    }
  }
}

// Reprise du callback de src/main/pdf.ts avant scission, encadrée du marqueur : une
// planche est une page à part entière, elle ne peut pas rester dans un segment de
// corps sans en emporter le titre courant et le folio.
function makeIllustrationRenderer(mediaDir?: string): NonNullable<ExportOptions['illustration']> {
  return ({ fileName, displayName }) => {
    if (fileName !== basename(fileName)) return null
    if (!mediaDir) return null
    const src = join(mediaDir, fileName)
    if (!existsSync(src) || !(extname(fileName).toLowerCase() in IMAGE_MEDIA_TYPES)) return null
    return {
      md: '',
      xhtml: entourer(
        `<section class="illustration"><img src="${pathToFileURL(src).toString()}" alt="${escapeXml(displayName)}"/></section>`
      )
    }
  }
}

// Découpe le rendu d'un chapitre sur le marqueur : les tronçons déjà sectionnés
// sortent tels quels, les autres deviennent des segments de corps. Un chapitre
// entièrement composé de nœuds de mise en page n'a aucun segment de corps — le
// titre de repli n'a alors nulle part où aller, et c'est correct.
function segmenter(xhtml: string, titreRepli: string | null): string {
  const sorties: string[] = []
  let repliPose = false
  for (const morceau of xhtml.split(COUPURE)) {
    const contenu = morceau.trim()
    if (contenu === '') continue
    if (contenu.startsWith('<section')) {
      sorties.push(contenu)
      continue
    }
    const tete =
      titreRepli !== null && !repliPose ? `<h1 class="titre-chapitre">${escapeXml(titreRepli)}</h1>\n` : ''
    repliPose = true
    sorties.push(`<section class="chapitre">\n${tete}${contenu}\n</section>`)
  }
  return sorties.join('\n')
}

export function buildBookHtml(
  db: Db,
  bookId: number,
  chapterIds: number[],
  mediaDir?: string
): string {
  const book = getBook(db, bookId)
  const tous = listChapters(db, bookId)
  const retenus = chapterIds.length === 0 ? tous : tous.filter((c) => chapterIds.includes(c.id))
  const complets = retenus.map((meta) => ({ meta, full: getChapter(db, meta.id) }))

  const ancres = collectAnchors(complets.map((c) => c.full.contentJson))
  const opts: ExportOptions = {
    layout: makeLayoutRenderer(ancres),
    illustration: makeIllustrationRenderer(mediaDir)
  }

  const corps = complets
    .map(({ meta, full }) =>
      segmenter(
        tiptapToXhtml(full.contentJson, opts),
        contientOuverture(full.contentJson) ? null : meta.title
      )
    )
    .join('\n')

  return `<!DOCTYPE html>
<html lang="${escapeXml(book.language || 'fr')}">
<head>
<meta charset="utf-8"/>
<title>${escapeXml(book.title)}</title>
<style>${buildPrintCss(book.pageFormat, book.title)}</style>
</head>
<body>
${corps}
</body>
</html>`
}
```

- [ ] **Step 4: Vérifier le passage**

Run : `npx vitest run src/main/pdf/ src/shared/export.test.ts && npm run typecheck:node`
Attendu : PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/pdf/html.ts src/main/pdf/html.test.ts src/main/pdf/style.ts src/main/pdf/style.test.ts
git commit -m "feat: assemblage du document PDF (ancres, sommaire, segments)"
```

---

### Task 5: `pdf/render.ts` — paged.js dans la fenêtre cachée

**Files:**
- Create: `src/main/pdf/render.ts`
- Modify: `src/main/pdf.ts` (réduit à l'orchestration)
- Modify: `package.json` (dépendance `pagedjs`)
- Test: aucun test automatique (dépend d'Electron, comme `buildPdf` aujourd'hui) — la garde est le typecheck et une vérification manuelle

**Interfaces:**
- Consomme : `buildBookHtml` (tâche 4).
- Produit : `renderHtmlToPdf(html: string): Promise<Buffer>` ; `buildPdf(db, bookId, chapterIds, mediaDir?)` garde sa signature actuelle, appelée telle quelle par `src/main/api.ts` (aucun changement dans `api.ts`).

**Lire d'abord** les sections « Détection de fin de pagination dans Electron » et « Options printToPDF validées » de `docs/superpowers/notes/2026-08-23-sonde-pagedjs.md`. Le code ci-dessous en est la transposition ; ne pas s'en écarter, en particulier : injecter paged.js **après** `loadFile`, poser `PagedConfig = { auto: false }` **avant** le chargement du script, et attendre la résolution de `previewer.preview()` — `did-finish-load` ne suffit pas.

- [ ] **Step 1: Installer la dépendance**

```bash
npm install pagedjs@^0.4.3
```

Vérifier que `node_modules/pagedjs/dist/paged.polyfill.js` existe.

**Ne jamais écrire `import … from 'pagedjs'`.** Le polyfill est un fichier lu au
runtime, pas un module du bundle : c'est ce qui dispense de toucher à
`electron.vite.config.ts` et évite qu'un `<script src>` pointe à l'intérieur
d'`app.asar`. La spec (§1) décrit cette mécanique.

- [ ] **Step 2: Écrire `src/main/pdf/render.ts`**

```ts
// Rendu PDF : paged.js compose le flux en pages réelles dans une fenêtre cachée,
// puis printToPDF imprime ces pages telles quelles. Chromium n'implémente aucune
// des fonctions CSS Paged Media dont dépend une maquette de livre (boîtes de marge,
// string-set, target-counter, break-before: right) ; paged.js les fournit côté page.
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Le polyfill est copié à côté du HTML temporaire plutôt que chargé depuis
// node_modules : le chemin reste un simple fichier voisin, valable aussi bien en
// développement que dans une application empaquetée (readFileSync sait lire dans
// app.asar, un <script src> pointant dans l'archive serait plus fragile).
const POLYFILL = 'node_modules/pagedjs/dist/paged.polyfill.js'

// Au-delà, on considère la pagination perdue plutôt que de laisser une fenêtre
// cachée ouverte indéfiniment.
const DELAI_MAX_MS = 120_000

export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const { app, BrowserWindow } = await import('electron')

  const source = join(app.getAppPath(), POLYFILL)
  if (!existsSync(source)) {
    throw new Error(`paged.js introuvable (${source}) — impossible de composer le PDF`)
  }
  const polyfill = readFileSync(source)

  const tmpDir = mkdtempSync(join(tmpdir(), 'encre-pdf-'))
  try {
    const htmlPath = join(tmpDir, 'livre.html')
    writeFileSync(htmlPath, html)
    writeFileSync(join(tmpDir, 'paged.polyfill.js'), polyfill)

    let win: InstanceType<typeof BrowserWindow> | null = null
    try {
      win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
      await win.loadFile(htmlPath)
      await win.webContents.executeJavaScript(
        `new Promise((resolve, reject) => {
          const echec = setTimeout(() => reject(new Error('pagination interrompue')), ${DELAI_MAX_MS});
          window.PagedConfig = { auto: false };
          const s = document.createElement('script');
          s.src = 'paged.polyfill.js';
          s.onload = async () => {
            try {
              const flow = await new window.Paged.Previewer().preview();
              await document.fonts.ready;
              requestAnimationFrame(() => requestAnimationFrame(() => {
                clearTimeout(echec);
                resolve(flow.total);
              }));
            } catch (e) { clearTimeout(echec); reject(e); }
          };
          s.onerror = () => { clearTimeout(echec); reject(new Error('chargement de paged.js impossible')); };
          document.head.appendChild(s);
        })`,
        true
      )
      // margins à zéro et preferCSSPageSize : paged.js porte lui-même la taille de
      // page et les marges alternées ; laisser Chromium en ajouter les doublerait.
      return await win.webContents.printToPDF({
        preferCSSPageSize: true,
        printBackground: true,
        margins: { top: 0, bottom: 0, left: 0, right: 0 }
      })
    } finally {
      win?.close()
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}
```

- [ ] **Step 3: Réduire `src/main/pdf.ts` à l'orchestration**

Le fichier ne conserve que :

```ts
import type { Db } from './db/connection'
import { buildBookHtml } from './pdf/html'
import { renderHtmlToPdf } from './pdf/render'

export async function buildPdf(
  db: Db,
  bookId: number,
  chapterIds: number[],
  mediaDir?: string
): Promise<Buffer> {
  return renderHtmlToPdf(buildBookHtml(db, bookId, chapterIds, mediaDir))
}
```

Tout le reste (ancienne `STYLE_CSS`, `buildHtml`, callback d'illustration, gestion de la fenêtre) disparaît : `pdf/style.ts`, `pdf/html.ts` et `pdf/render.ts` le portent désormais. Vérifier qu'aucun autre module n'importait ces symboles (`grep -rn "from './pdf'" src/`).

- [ ] **Step 4: Vérifier**

Run : `npx vitest run && npm run typecheck:node && npm run typecheck:web`
Attendu : PASS (aucun test n'importait les internes de `pdf.ts`).

Vérification manuelle (`npm run dev`) : ouvrir un livre existant → Exporter → PDF. Sans aucun nœud posé, le PDF doit désormais présenter titres courants, folios et chapitres commençant en page de droite, avec le titre de repli en tête de chaque chapitre. Noter le temps d'export.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/main/pdf.ts src/main/pdf/render.ts
git commit -m "feat: composition du PDF par paged.js dans la fenêtre cachée"
```

---

### Task 6: Les quatre nœuds d'éditeur

**Files:**
- Create: `src/renderer/src/editor/layoutNodes.ts`
- Modify: `src/renderer/src/components/EditorPane.vue` (enregistrement des extensions)
- Modify: `src/renderer/src/styles/theme.css` (rendu éditeur)

**Interfaces:**
- Consomme : `insertBlockAtomCommand(nodeName)` exporté par `src/renderer/src/editor/formatNodes.ts` (fabrique déjà généralisée aux attributs lors du travail sur les illustrations : `(attrs?: Record<string, unknown>) => Command`).
- Produit (utilisé par la tâche 7) : extensions `ChapterOpening`, `PartOpening`, `TableOfContents`, `FrontMatterPage` et les commandes `insertChapterOpening({ enseigne, titre, recto })`, `insertPartOpening({ label, recto })`, `insertTableOfContents({ titre })`, `insertFrontMatterPage({ genre })`.

**Aucun test automatisé** (pas d'infrastructure de test renderer dans ce dépôt). Garde : `npm run typecheck:web`.

- [ ] **Step 1: Écrire `src/renderer/src/editor/layoutNodes.ts`**

Lire d'abord `src/renderer/src/editor/formatNodes.ts` et `illustration.ts` : reprendre leur forme (déclaration de module `@tiptap/core` pour typer les commandes, `Node.create`, `parseHTML`/`renderHTML`, `mergeAttributes`).

Les trois premiers sont des **atomes bloc** (`group: 'block'`, `atom: true`, `selectable: true`), construits sur `insertBlockAtomCommand`. Attributs et balisage d'aller-retour :

| Nœud | `name` | Attributs (défauts) | `renderHTML` / `parseHTML` |
|---|---|---|---|
| `ChapterOpening` | `chapterOpening` | `enseigne: ''`, `titre: ''`, `recto: true` | `<div data-ouverture data-enseigne data-titre data-recto>` |
| `PartOpening` | `partOpening` | `label: ''`, `recto: true` | `<div data-partie data-label data-recto>` |
| `TableOfContents` | `tableOfContents` | `titre: 'SOMMAIRE'` | `<div data-sommaire data-titre>` |

Le booléen `recto` se sérialise en `'true'`/`'false'` dans l'attribut HTML et se relit avec `element.getAttribute('data-recto') !== 'false'`.

`FrontMatterPage` est un nœud **à contenu** :

```ts
export const FrontMatterPage = Node.create({
  name: 'frontMatterPage',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      genre: {
        default: 'titre',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-genre') ?? 'titre',
        renderHTML: (attributes: Record<string, any>) => ({ 'data-genre': attributes.genre })
      }
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-liminaire]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-liminaire': '' }), 0]
  },
  addCommands() {
    return {
      insertFrontMatterPage:
        (attrs: { genre: string }) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs,
            content: [{ type: 'paragraph' }]
          })
    }
  }
})
```

(Le `0` final de `renderHTML` est le trou de contenu ; sans lui le texte saisi n'est pas rendu. La commande insère un paragraphe vide pour que le curseur ait où atterrir.)

- [ ] **Step 2: Enregistrer et styler**

Dans `EditorPane.vue` : importer les quatre extensions et les ajouter à la liste `extensions` de `useEditor`, à la suite d'`Illustration`.

Dans `theme.css`, à la suite des règles du nœud illustration — un rendu qui donne à voir la page produite, sans imiter le PDF :

```css
/* Nœuds de mise en page : chacun produira une page entière dans le PDF. Le rendu
   éditeur les montre comme des blocs encadrés, pour qu'ils se distinguent du texte
   sans prétendre en être un aperçu fidèle. */
.tiptap [data-ouverture],
.tiptap [data-partie],
.tiptap [data-sommaire],
.tiptap [data-liminaire] {
  border: 1px dashed var(--border);
  border-radius: 6px;
  padding: 1.2em 1em;
  margin: 1.6em 0;
  text-align: center;
}
.tiptap [data-ouverture]::before { content: attr(data-enseigne); display: block; font-size: .75em; letter-spacing: .18em; text-transform: uppercase; color: var(--text-muted); margin-bottom: .5em; }
.tiptap [data-ouverture]::after { content: attr(data-titre); display: block; font-size: 1.4em; }
.tiptap [data-partie]::after { content: attr(data-label); display: block; font-size: 1.1em; letter-spacing: .08em; }
.tiptap [data-sommaire]::after { content: attr(data-titre) " — rempli à l'export"; display: block; color: var(--text-muted); font-size: .9em; letter-spacing: .1em; }
.tiptap [data-liminaire] { text-align: left; }
.tiptap [data-liminaire]::before { content: "Page liminaire — " attr(data-genre); display: block; font-size: .75em; letter-spacing: .1em; text-transform: uppercase; color: var(--text-muted); margin-bottom: .6em; }
.tiptap [data-ouverture].ProseMirror-selectednode,
.tiptap [data-partie].ProseMirror-selectednode,
.tiptap [data-sommaire].ProseMirror-selectednode,
.tiptap [data-liminaire].ProseMirror-selectednode { outline: 2px solid var(--accent); outline-offset: 2px; }
```

Vérifier dans `theme.css` les noms réels des variables (`--border`, `--text-muted`, `--accent`) et employer celles qui existent réellement dans ce fichier.

- [ ] **Step 3: Vérifier**

Run : `npm run typecheck:web && npm run typecheck:node`
Attendu : PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/editor/layoutNodes.ts src/renderer/src/components/EditorPane.vue src/renderer/src/styles/theme.css
git commit -m "feat: nœuds d'éditeur de mise en page (ouverture, partie, sommaire, liminaire)"
```

---

### Task 7: Insertion depuis le menu ¶+ et popover d'édition

**Files:**
- Modify: `src/renderer/src/components/EditorPane.vue`

**Interfaces:**
- Consomme (tâche 6) : les quatre commandes d'insertion ; `store.currentChapter` (titre et `position`) du store livre.

**Aucun test automatisé.** Garde : `npm run typecheck:web`, puis vérification manuelle.

- [ ] **Step 1: Étendre le menu ¶+**

Lire la section du template d'`EditorPane.vue` autour du bloc `format-menu` (les deux entrées « Séparateur de scène ⁂ » et « Saut de page forcé ») et la fonction `chooseFormatNode`. Ajouter quatre entrées à la suite, séparées des deux existantes par un filet (`<div class="format-menu-sep"></div>` avec une règle CSS `border-top: 1px solid var(--border); margin: .35em 0;`) :

- « Ouverture de chapitre »
- « Page de partie »
- « Sommaire »
- « Page liminaire »

Les deux entrées existantes conservent leur comportement actuel (insertion immédiate, fermeture du menu).

- [ ] **Step 2: Popover d'édition**

Sur le modèle du popover de libellé de snapshot déjà présent dans ce fichier (`snapshotPromptOpen`, `snapshotWrapEl`, fermeture au clic extérieur et à Échap, `@keydown` sur le conteneur), ajouter un popover unique piloté par un état :

```ts
type LayoutDraft =
  | { kind: 'chapterOpening'; enseigne: string; titre: string; recto: boolean }
  | { kind: 'partOpening'; label: string; recto: boolean }
  | { kind: 'tableOfContents'; titre: string }
  | { kind: 'frontMatterPage'; genre: 'titre' | 'colophon' | 'dedicace' }

// `pos` vaut null pour une insertion, ou la position du nœud pour une édition.
const layoutDraft = ref<{ draft: LayoutDraft; pos: number | null } | null>(null)
```

Le popover affiche les champs du `kind` courant (deux textes + une case « Commencer en page de droite » pour `chapterOpening` ; un texte + la même case pour `partOpening` ; un texte pour `tableOfContents` ; un `<select>` à trois valeurs — « Page de titre », « Colophon », « Dédicace » — pour `frontMatterPage`), plus « Annuler » et « Valider ».

**Pré-remplissage à l'insertion d'une ouverture de chapitre** : `enseigne = 'CHAPITRE ' + store.currentChapter.position`, `titre = store.currentChapter.title`, `recto = true`. Commenter en français que le rang vient de la base et n'est qu'une commodité de saisie (un chapitre « Liminaires » placé en tête décale la proposition d'une unité).

À la validation : si `pos` est `null`, appeler la commande d'insertion correspondante ; sinon mettre à jour les attributs du nœud existant avec `editor.value?.chain().focus().setNodeSelection(pos).updateAttributes(kind, attrs).run()`. Fermer ensuite le popover.

- [ ] **Step 3: Rouvrir le popover au clic sur un nœud**

`useEditor` a déjà un `editorProps.handleClickOn` (il ouvre le tiroir d'entité au clic sur une mention). L'étendre : si `node.type.name` est l'un des quatre, poser `layoutDraft` à partir de `node.attrs` avec `pos = nodePos`, ouvrir le popover et retourner `true`. Ne pas casser la branche `mention` existante.

- [ ] **Step 4: Vérifier**

Run : `npm run typecheck:web && npm run typecheck:node && npm run lint -- src/renderer/src/components/EditorPane.vue`
Attendu : typechecks PASS ; pour le lint, comparer aux erreurs préexistantes du fichier (le dépôt en a) et n'en introduire aucune nouvelle.

Vérification manuelle (`npm run dev`) — à effectuer par le partenaire humain, ou décrite précisément dans le rapport de tâche si elle n'est pas exécutable :

1. Créer un chapitre « Liminaires » en tête d'un livre ; y insérer une page liminaire de genre « titre » (taper le titre du livre dedans), une seconde de genre « colophon », puis un sommaire.
2. Dans le premier vrai chapitre, insérer une page de partie, puis une ouverture de chapitre : vérifier le pré-remplissage, valider.
3. Cliquer sur l'ouverture posée : le popover se rouvre avec les valeurs, une modification est bien reprise.
4. Exporter en PDF : page de titre, colophon, sommaire à numéros réels et points de conduite, page de partie, ouverture, puis corps avec titre du livre en haut à gauche des versos, titre du chapitre en haut à droite des rectos, folio en bas, chapitres commençant en page de droite avec page blanche muette insérée si nécessaire.
5. Comparer au PDF de référence `~/Documents/livres/L'ENVERS/Tome-01-LA-MAISON-QUI-SE-TAIT/L'ENVERS T1 — LA MAISON QUI SE TAIT.pdf`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/EditorPane.vue
git commit -m "feat: insertion et édition des nœuds de mise en page depuis le menu ¶+"
```

---

## Vérification finale (après Task 7)

- [ ] `npm test` (suite complète, avec le double rebuild better-sqlite3)
- [ ] `npm run typecheck`
- [ ] Export PDF d'un tome complet : mesurer le temps (budget attendu 5 à 10 s de pagination) et vérifier que le nombre de pages du PDF est cohérent
- [ ] Passe de vérification manuelle du Step 4 de Task 7 si pas encore faite
