# Illustrations de livre — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bibliothèque d'illustrations par livre (ajout, renommage, suppression) + insertion dans le texte des chapitres via un nœud d'éditeur, avec sortie Markdown/EPUB/PDF.

**Architecture:** Table SQLite `illustrations` (fichiers copiés dans `userData/media`, servis via `encre-media://`), domaine IPC `illustrations`, nœud TipTap atomique `illustration` (attrs `fileName`/`displayName`), sérialiseur d'export paramétré par un callback de rendu par consommateur (Markdown copie les fichiers, EPUB les embarque dans l'archive, PDF passe par un fichier HTML temporaire + `file://`).

**Tech Stack:** Electron + Vue 3 + Pinia, TipTap 3, better-sqlite3, JSZip, vitest.

**Spec:** `docs/superpowers/specs/2026-08-23-illustrations-design.md`

## Global Constraints

- Toute la copie UI et les commentaires de code sont en **français**, dans le ton des fichiers existants (commentaires qui expliquent le pourquoi).
- Aucune nouvelle dépendance npm.
- Tests : `npx vitest run <fichier>` pour un fichier ciblé. ATTENTION : `npm test` rebuild better-sqlite3 pour Node puis pour Electron — l'utiliser seulement en fin de tâche si nécessaire ; pour itérer, `npm run rebuild:node` une fois puis `npx vitest run`. Si vitest échoue avec une erreur de version de module native, lancer `npm run rebuild:node` d'abord.
- Typecheck : `npm run typecheck:node` (main/shared) et `npm run typecheck:web` (renderer).
- Un commit par tâche minimum, messages en français au format des commits récents (`feat:`, `fix:`, `docs:`…) terminés par `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Extensions image acceptées partout : `png`, `jpg`, `jpeg`, `webp` (la liste déjà utilisée par `pickCover`/`epub.ts`).
- Les noms de fichiers media générés suivent `ill-{bookId}-{horodatage}-{n}{ext}` — uniques, sans métacaractère SQL ni caractère à encoder.

---

### Task 1: Table `illustrations` + module DB

**Files:**
- Modify: `src/main/db/migrations.ts` (ajouter une 4e entrée à `MIGRATIONS`)
- Modify: `src/shared/types.ts` (interface `Illustration`)
- Create: `src/main/db/illustrations.ts`
- Test: `src/main/db/illustrations.test.ts`, `src/main/db/migration4.test.ts`

**Interfaces:**
- Consomme : `Db`, `openDb`, `migrate` de `src/main/db/connection.ts` (inchangés).
- Produit (utilisé par les tâches 2 et 3) :
  - type `Illustration { id: number; bookId: number; fileName: string; displayName: string; position: number; createdAt: string }` dans `src/shared/types.ts` ;
  - `listIllustrations(db: Db, bookId: number): Illustration[]` (tri `position, id`) ;
  - `getIllustration(db: Db, id: number): Illustration` (lève `Illustration introuvable: {id}` si absente) ;
  - `createIllustration(db: Db, bookId: number, fileName: string, displayName: string): Illustration` (`position` = max du livre + 1, première = 1) ;
  - `renameIllustration(db: Db, id: number, displayName: string): Illustration` ;
  - `deleteIllustration(db: Db, id: number): void`.

- [ ] **Step 1: Écrire les tests qui échouent**

`src/main/db/migration4.test.ts` (calqué sur `migration3.test.ts`) :

```ts
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, openDb } from './connection'
import { MIGRATIONS } from './migrations'

describe('migration 4', () => {
  it('fait passer une base v3 peuplée en v4 sans perte', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    db.exec(MIGRATIONS[0])
    db.exec(MIGRATIONS[1])
    db.exec(MIGRATIONS[2])
    db.pragma('user_version = 3')
    db.prepare("INSERT INTO books (title) VALUES ('Livre v3')").run()

    migrate(db)

    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name)
    expect(tables).toContain('illustrations')
    const book = db.prepare('SELECT id FROM books WHERE id = 1').get() as any
    expect(book.id).toBe(1)
    db.close()
  })

  it('une base neuve part directement en v4', () => {
    const db = openDb(':memory:')
    expect(db.pragma('user_version', { simple: true })).toBe(4)
    db.close()
  })
})
```

`src/main/db/illustrations.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { openDb } from './connection'
import { createBook } from './books'
import {
  listIllustrations, getIllustration, createIllustration,
  renameIllustration, deleteIllustration
} from './illustrations'

function setup() {
  const db = openDb(':memory:')
  const book = createBook(db, { title: 'Tome 1' })
  return { db, book }
}

describe('db/illustrations', () => {
  it('crée et liste dans l’ordre de position', () => {
    const { db, book } = setup()
    const a = createIllustration(db, book.id, 'ill-1-100-0.png', 'planche-1.png')
    const b = createIllustration(db, book.id, 'ill-1-100-1.png', 'planche-2.png')
    expect(a.position).toBe(1)
    expect(b.position).toBe(2)
    const list = listIllustrations(db, book.id)
    expect(list.map((i) => i.fileName)).toEqual(['ill-1-100-0.png', 'ill-1-100-1.png'])
    expect(list[0].bookId).toBe(book.id)
    expect(list[0].displayName).toBe('planche-1.png')
  })

  it('renomme et supprime', () => {
    const { db, book } = setup()
    const a = createIllustration(db, book.id, 'ill-1-100-0.png', 'planche-1.png')
    expect(renameIllustration(db, a.id, 'La maison').displayName).toBe('La maison')
    deleteIllustration(db, a.id)
    expect(listIllustrations(db, book.id)).toHaveLength(0)
    expect(() => getIllustration(db, a.id)).toThrow(/introuvable/)
  })

  it('la suppression du livre supprime ses illustrations (cascade)', () => {
    const { db, book } = setup()
    createIllustration(db, book.id, 'ill-1-100-0.png', 'p.png')
    db.prepare('DELETE FROM books WHERE id = ?').run(book.id)
    expect(db.prepare('SELECT COUNT(*) AS n FROM illustrations').get()).toEqual({ n: 0 })
  })
})
```

- [ ] **Step 2: Vérifier l'échec**

Run : `npm run rebuild:node && npx vitest run src/main/db/illustrations.test.ts src/main/db/migration4.test.ts`
Attendu : FAIL (module `./illustrations` inexistant ; user_version 3 ≠ 4).

- [ ] **Step 3: Implémenter**

Dans `src/shared/types.ts`, après l'interface `Series` :

```ts
// Illustration d'un livre : fichier image copié dans userData/media (comme
// les couvertures), listé au niveau du livre et insérable dans le texte via
// le nœud d'éditeur `illustration` (attrs fileName/displayName).
export interface Illustration {
  id: number
  bookId: number
  fileName: string      // nom dans userData/media — unique, généré côté main
  displayName: string   // nom lisible, initialisé au nom du fichier source
  position: number      // ordre dans la bibliothèque du livre
  createdAt: string
}
```

Dans `src/main/db/migrations.ts`, ajouter une 4e entrée au tableau :

```ts
  `
  CREATE TABLE illustrations (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id      INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    file_name    TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    position     INTEGER NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_illustrations_book ON illustrations(book_id, position);
  `
```

`src/main/db/illustrations.ts` (calqué sur `entities.ts`) :

```ts
import type { Db } from './connection'
import type { Illustration } from '../../shared/types'

function rowToIllustration(row: any): Illustration {
  return {
    id: row.id,
    bookId: row.book_id,
    fileName: row.file_name,
    displayName: row.display_name,
    position: row.position,
    createdAt: row.created_at
  }
}

export function listIllustrations(db: Db, bookId: number): Illustration[] {
  return db
    .prepare('SELECT * FROM illustrations WHERE book_id = ? ORDER BY position, id')
    .all(bookId)
    .map(rowToIllustration)
}

export function getIllustration(db: Db, id: number): Illustration {
  const row = db.prepare('SELECT * FROM illustrations WHERE id = ?').get(id)
  if (!row) throw new Error(`Illustration introuvable: ${id}`)
  return rowToIllustration(row)
}

export function createIllustration(
  db: Db, bookId: number, fileName: string, displayName: string
): Illustration {
  const max = db
    .prepare('SELECT COALESCE(MAX(position), 0) AS m FROM illustrations WHERE book_id = ?')
    .get(bookId) as { m: number }
  const result = db
    .prepare('INSERT INTO illustrations (book_id, file_name, display_name, position) VALUES (?, ?, ?, ?)')
    .run(bookId, fileName, displayName, max.m + 1)
  return getIllustration(db, Number(result.lastInsertRowid))
}

export function renameIllustration(db: Db, id: number, displayName: string): Illustration {
  db.prepare('UPDATE illustrations SET display_name = ? WHERE id = ?').run(displayName, id)
  return getIllustration(db, id)
}

export function deleteIllustration(db: Db, id: number): void {
  db.prepare('DELETE FROM illustrations WHERE id = ?').run(id)
}
```

- [ ] **Step 4: Vérifier le passage**

Run : `npx vitest run src/main/db/illustrations.test.ts src/main/db/migration4.test.ts src/main/db/migration2.test.ts src/main/db/migration3.test.ts src/main/db/connection.test.ts`
Attendu : PASS. Les tests migration 2/3 vérifient que `user_version` cible `MIGRATIONS.length` (maintenant 4) — s'ils comparent à un littéral `3`, adapter le littéral est INTERDIT s'ils utilisent `MIGRATIONS.length` (ils passent seuls) ; `migration3.test.ts` compare `openDb` à `3` en dur dans son 2e cas (`une base neuve part directement en v3`) : mettre à jour ce littéral vers `MIGRATIONS.length` fait partie de cette tâche.

- [ ] **Step 5: Typecheck + commit**

Run : `npm run typecheck:node`
```bash
git add src/main/db/migrations.ts src/main/db/illustrations.ts src/main/db/illustrations.test.ts src/main/db/migration4.test.ts src/main/db/migration3.test.ts src/shared/types.ts
git commit -m "feat: table illustrations + module DB (migration 4)"
```

---

### Task 2: Logique fichiers côté main (`addIllustrationFiles`, `removeIllustration`, `illustrationUsage`)

**Files:**
- Create: `src/main/illustrations.ts`
- Test: `src/main/illustrations.test.ts`

**Interfaces:**
- Consomme (Task 1) : `createIllustration`, `getIllustration`, `deleteIllustration` de `src/main/db/illustrations.ts` ; type `Illustration`.
- Produit (utilisé par Task 3) :
  - `addIllustrationFiles(db: Db, bookId: number, sourcePaths: string[], mediaDir: string): Illustration[]` — copie chaque fichier lisible d'extension acceptée dans `mediaDir` sous `ill-{bookId}-{Date.now()}-{index}{ext}` (ext en minuscules), crée la ligne (`displayName` = basename source), renvoie les réussites dans l'ordre ; un fichier illisible ou d'extension refusée est ignoré sans faire échouer les autres.
  - `removeIllustration(db: Db, id: number, mediaDir: string): void` — supprime la ligne puis le fichier ; fichier déjà absent toléré.
  - `illustrationUsage(db: Db, id: number): number` — nombre de chapitres du livre dont `content_json` contient `fileName`.

- [ ] **Step 1: Écrire les tests qui échouent**

`src/main/illustrations.test.ts` :

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { openDb } from './db/connection'
import { createBook } from './db/books'
import { createChapter, saveChapterContent } from './db/chapters'
import { listIllustrations } from './db/illustrations'
import { addIllustrationFiles, removeIllustration, illustrationUsage } from './illustrations'

function setup() {
  const db = openDb(':memory:')
  const book = createBook(db, { title: 'Tome 1' })
  const srcDir = mkdtempSync(join(tmpdir(), 'encre-ill-src-'))
  const mediaDir = mkdtempSync(join(tmpdir(), 'encre-ill-media-'))
  return { db, book, srcDir, mediaDir }
}

describe('addIllustrationFiles', () => {
  it('copie les fichiers dans media et crée les lignes dans l’ordre', () => {
    const { db, book, srcDir, mediaDir } = setup()
    writeFileSync(join(srcDir, 'planche-1.png'), 'png-1')
    writeFileSync(join(srcDir, 'planche-2.jpg'), 'jpg-2')
    const added = addIllustrationFiles(
      db, book.id, [join(srcDir, 'planche-1.png'), join(srcDir, 'planche-2.jpg')], mediaDir
    )
    expect(added).toHaveLength(2)
    expect(added[0].displayName).toBe('planche-1.png')
    expect(added[0].fileName).toMatch(new RegExp(`^ill-${book.id}-\\d+-0\\.png$`))
    expect(added[1].fileName).toMatch(/\.jpg$/)
    for (const ill of added) expect(existsSync(join(mediaDir, ill.fileName))).toBe(true)
    expect(listIllustrations(db, book.id)).toHaveLength(2)
  })

  it('ignore un fichier illisible ou d’extension refusée sans bloquer les autres', () => {
    const { db, book, srcDir, mediaDir } = setup()
    writeFileSync(join(srcDir, 'ok.webp'), 'webp')
    writeFileSync(join(srcDir, 'notes.txt'), 'txt')
    const added = addIllustrationFiles(
      db, book.id,
      [join(srcDir, 'absent.png'), join(srcDir, 'notes.txt'), join(srcDir, 'ok.webp')],
      mediaDir
    )
    expect(added).toHaveLength(1)
    expect(added[0].displayName).toBe('ok.webp')
    expect(readdirSync(mediaDir)).toHaveLength(1)
  })
})

describe('removeIllustration / illustrationUsage', () => {
  it('supprime ligne + fichier, tolère un fichier déjà absent', () => {
    const { db, book, srcDir, mediaDir } = setup()
    writeFileSync(join(srcDir, 'p.png'), 'png')
    const [ill] = addIllustrationFiles(db, book.id, [join(srcDir, 'p.png')], mediaDir)
    removeIllustration(db, ill.id, mediaDir)
    expect(listIllustrations(db, book.id)).toHaveLength(0)
    expect(existsSync(join(mediaDir, ill.fileName))).toBe(false)
    // orphelin : re-création d'une ligne dont le fichier n'existe pas
    const [ill2] = addIllustrationFiles(db, book.id, [join(srcDir, 'p.png')], mediaDir)
    unlinkSync(join(mediaDir, ill2.fileName))
    expect(() => removeIllustration(db, ill2.id, mediaDir)).not.toThrow()
  })

  it('compte les chapitres qui référencent le fichier', () => {
    const { db, book, srcDir, mediaDir } = setup()
    writeFileSync(join(srcDir, 'p.png'), 'png')
    const [ill] = addIllustrationFiles(db, book.id, [join(srcDir, 'p.png')], mediaDir)
    const c1 = createChapter(db, book.id, 'Un')
    const c2 = createChapter(db, book.id, 'Deux')
    const doc = JSON.stringify({
      type: 'doc',
      content: [{ type: 'illustration', attrs: { fileName: ill.fileName, displayName: 'p.png' } }]
    })
    saveChapterContent(db, c1.id, doc, '')
    saveChapterContent(db, c2.id, '{"type":"doc","content":[]}', '')
    expect(illustrationUsage(db, ill.id)).toBe(1)
  })
})
```

- [ ] **Step 2: Vérifier l'échec**

Run : `npx vitest run src/main/illustrations.test.ts`
Attendu : FAIL (module `./illustrations` inexistant).

- [ ] **Step 3: Implémenter**

`src/main/illustrations.ts` :

```ts
// Logique testable du domaine illustrations (Task illustrations) : tout ce
// qui touche disque + base vit ici, hors electron — api.ts n'ajoute que le
// dialogue de sélection et le chemin userData (même découpage
// qu'importChapterFromFile vs importer.importChapter).
import { copyFileSync, mkdirSync, unlinkSync } from 'fs'
import { join, extname, basename } from 'path'
import type { Db } from './db/connection'
import type { Illustration } from '../shared/types'
import { createIllustration, getIllustration, deleteIllustration } from './db/illustrations'

// Mêmes extensions que pickCover/pickImage (api.ts) et que la table des
// media-types EPUB — la seule famille d'images que l'app sait afficher et
// exporter.
const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

export function addIllustrationFiles(
  db: Db, bookId: number, sourcePaths: string[], mediaDir: string
): Illustration[] {
  mkdirSync(mediaDir, { recursive: true })
  // Horodatage unique par lot + index par fichier : deux ajouts successifs du
  // même fichier source produisent des noms différents (même raison que le
  // nommage des couvertures — une URL identique ne serait pas revalidée par
  // le renderer).
  const stamp = Date.now()
  const added: Illustration[] = []
  sourcePaths.forEach((src, i) => {
    const ext = extname(src).toLowerCase()
    if (!ALLOWED_EXTENSIONS.has(ext)) return
    const fileName = `ill-${bookId}-${stamp}-${i}${ext}`
    try {
      copyFileSync(src, join(mediaDir, fileName))
    } catch {
      // Fichier source illisible/absent : on ignore CE fichier, les autres
      // de la sélection continuent (contrat d'erreur de la spec §6).
      return
    }
    added.push(createIllustration(db, bookId, fileName, basename(src)))
  })
  return added
}

export function removeIllustration(db: Db, id: number, mediaDir: string): void {
  const ill = getIllustration(db, id)
  deleteIllustration(db, id)
  try {
    unlinkSync(join(mediaDir, ill.fileName))
  } catch {
    // Fichier déjà absent (supprimé hors de l'app) : la ligne est retirée
    // quand même — pas d'erreur pour un orphelin (spec §6).
  }
}

export function illustrationUsage(db: Db, id: number): number {
  const ill = getIllustration(db, id)
  // LIKE suffit : les noms générés (ill-{bookId}-{ts}-{n}.{ext}) ne
  // contiennent ni % ni _ ni quote — pas d'échappement nécessaire.
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM chapters WHERE book_id = ? AND content_json LIKE ?')
    .get(ill.bookId, `%${ill.fileName}%`) as { n: number }
  return row.n
}
```

- [ ] **Step 4: Vérifier le passage**

Run : `npx vitest run src/main/illustrations.test.ts`
Attendu : PASS.

- [ ] **Step 5: Typecheck + commit**

Run : `npm run typecheck:node`
```bash
git add src/main/illustrations.ts src/main/illustrations.test.ts
git commit -m "feat: ajout/suppression/usage des fichiers d'illustration côté main"
```

---

### Task 3: Domaine IPC `illustrations` (contrat + api + preload)

**Files:**
- Modify: `src/shared/ipc-contract.ts` (domaine `illustrations` + import du type)
- Modify: `src/main/api.ts` (implémentation du domaine)
- Modify: `src/preload/index.ts` (pont ipcRenderer)
- Test: `src/main/api.test.ts` (cas ajoutés)

**Interfaces:**
- Consomme (Tasks 1–2) : `listIllustrations`, `renameIllustration` de `src/main/db/illustrations.ts` ; `addIllustrationFiles`, `removeIllustration`, `illustrationUsage` de `src/main/illustrations.ts` ; type `Illustration`.
- Produit (utilisé par Task 7 côté renderer via `window.encre`) :

```ts
illustrations: {
  listByBook(bookId: number): Promise<Illustration[]>
  add(bookId: number): Promise<Illustration[]>       // showOpenDialog multiSelections ; [] si annulé
  rename(id: number, displayName: string): Promise<Illustration>
  remove(id: number): Promise<void>                  // supprime ligne + fichier media ; orphelin toléré
  usage(id: number): Promise<number>                 // nb de chapitres référençant le fichier
}
```

- [ ] **Step 1: Écrire le test qui échoue**

Dans `src/main/api.test.ts`, ajouter (la partie dialogue de `add` n'est pas testée — même statut que `pickCover` ; on passe par `addIllustrationFiles` pour peupler) :

```ts
  it('expose la bibliothèque d’illustrations (list/rename/usage/remove)', async () => {
    const { mkdtempSync, writeFileSync } = await import('fs')
    const { tmpdir } = await import('os')
    const { join } = await import('path')
    const { openDb } = await import('./db/connection')
    const { addIllustrationFiles } = await import('./illustrations')
    const db = openDb(':memory:')
    const api = createApi(db)
    const book = await api.books.create({ title: 'Illustré' })
    const srcDir = mkdtempSync(join(tmpdir(), 'encre-api-ill-'))
    const mediaDir = mkdtempSync(join(tmpdir(), 'encre-api-media-'))
    writeFileSync(join(srcDir, 'planche.png'), 'png')
    const [ill] = addIllustrationFiles(db, book.id, [join(srcDir, 'planche.png')], mediaDir)

    expect(await api.illustrations.listByBook(book.id)).toHaveLength(1)
    expect((await api.illustrations.rename(ill.id, 'La maison')).displayName).toBe('La maison')
    expect(await api.illustrations.usage(ill.id)).toBe(0)
  })
```

- [ ] **Step 2: Vérifier l'échec**

Run : `npx vitest run src/main/api.test.ts`
Attendu : FAIL (`api.illustrations` undefined) — et erreur TypeScript à la compilation vitest tant que le contrat n'existe pas.

- [ ] **Step 3: Implémenter**

`src/shared/ipc-contract.ts` : ajouter `Illustration` à l'import de types, puis le domaine après `entities` :

```ts
  illustrations: {
    listByBook(bookId: number): Promise<Illustration[]>
    add(bookId: number): Promise<Illustration[]>       // showOpenDialog (multiSelections) + copie dans media ; [] si annulé
    rename(id: number, displayName: string): Promise<Illustration>
    remove(id: number): Promise<void>                  // ligne + fichier media ; fichier déjà absent toléré
    usage(id: number): Promise<number>                 // nb de chapitres du livre référençant le fichier (garde-fou avant suppression)
  }
```

`src/main/api.ts` : ajouter les imports

```ts
import * as dbIllustrations from './db/illustrations'
import { addIllustrationFiles, removeIllustration, illustrationUsage } from './illustrations'
```

puis le domaine dans l'objet retourné par `createApi`, après `entities` :

```ts
    illustrations: {
      listByBook: async (bookId) => dbIllustrations.listIllustrations(db, bookId),
      // Même découpage que importer.importChapter : le dialogue vit ici, toute
      // la logique copie+insertion (testable) dans addIllustrationFiles.
      add: async (bookId) => {
        const { app, dialog } = await import('electron')
        const res = await dialog.showOpenDialog({
          title: 'Ajouter des illustrations',
          filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
          properties: ['openFile', 'multiSelections']
        })
        if (res.canceled || res.filePaths.length === 0) return []
        const mediaDir = join(app.getPath('userData'), 'media')
        return addIllustrationFiles(db, bookId, res.filePaths, mediaDir)
      },
      rename: async (id, displayName) => dbIllustrations.renameIllustration(db, id, displayName),
      remove: async (id) => {
        const { app } = await import('electron')
        removeIllustration(db, id, join(app.getPath('userData'), 'media'))
      },
      usage: async (id) => illustrationUsage(db, id)
    },
```

`src/preload/index.ts` : après le bloc `entities` :

```ts
  illustrations: {
    listByBook: (bookId) => ipcRenderer.invoke('illustrations:listByBook', bookId),
    add: (bookId) => ipcRenderer.invoke('illustrations:add', bookId),
    rename: (id, displayName) => ipcRenderer.invoke('illustrations:rename', id, displayName),
    remove: (id) => ipcRenderer.invoke('illustrations:remove', id),
    usage: (id) => ipcRenderer.invoke('illustrations:usage', id)
  },
```

(`registerIpc` dans `ipc.ts` est générique : aucun changement.)

- [ ] **Step 4: Vérifier le passage**

Run : `npx vitest run src/main/api.test.ts && npm run typecheck:node`
Attendu : PASS des deux.

- [ ] **Step 5: Commit**

```bash
git add src/shared/ipc-contract.ts src/main/api.ts src/preload/index.ts src/main/api.test.ts
git commit -m "feat: domaine IPC illustrations (list/add/rename/remove/usage)"
```

---

### Task 4: Sérialiseur d'export — nœud `illustration` + `collectIllustrations`

**Files:**
- Modify: `src/shared/export.ts`
- Test: `src/shared/export.test.ts` (cas ajoutés)

**Interfaces:**
- Produit (utilisé par Task 5) :

```ts
export interface IllustrationAttrs { fileName: string; displayName: string }
export interface ExportOptions {
  // Rendu d'un nœud illustration par le consommateur ; retourner null l'omet.
  // Option absente => tous les nœuds illustration sont omis (défaut sûr : pas
  // de lien mort dans un export qui n'a pas prévu les images).
  illustration?: (attrs: IllustrationAttrs) => { md: string; xhtml: string } | null
}
export function tiptapToMarkdown(contentJson: string, opts?: ExportOptions): string
export function tiptapToXhtml(contentJson: string, opts?: ExportOptions): string
export function collectIllustrations(contentJson: string): IllustrationAttrs[]
// ordre d'apparition dans le document, dédupliqué par fileName ; [] si JSON invalide
```

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à `src/shared/export.test.ts` :

```ts
describe('nœud illustration', () => {
  const doc = JSON.stringify({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Avant.' }] },
      { type: 'illustration', attrs: { fileName: 'ill-1-9-0.png', displayName: 'La maison' } },
      { type: 'paragraph', content: [{ type: 'text', text: 'Après.' }] },
      { type: 'illustration', attrs: { fileName: 'ill-1-9-0.png', displayName: 'La maison' } },
      { type: 'illustration', attrs: { fileName: 'ill-1-9-1.jpg', displayName: 'Le café' } }
    ]
  })

  it('est rendu via le callback du consommateur', () => {
    const opts = {
      illustration: ({ fileName, displayName }: { fileName: string; displayName: string }) => ({
        md: `![${displayName}](Illustrations/${fileName})`,
        xhtml: `<div class="illustration"><img src="images/${fileName}" alt="${displayName}"/></div>`
      })
    }
    expect(tiptapToMarkdown(doc, opts)).toContain('![La maison](Illustrations/ill-1-9-0.png)')
    expect(tiptapToXhtml(doc, opts)).toContain('<img src="images/ill-1-9-0.png" alt="La maison"/>')
  })

  it('est omis quand le callback retourne null ou est absent', () => {
    const withNull = { illustration: () => null }
    expect(tiptapToMarkdown(doc, withNull)).not.toContain('ill-1-9-0.png')
    expect(tiptapToMarkdown(doc)).not.toContain('ill-1-9-0.png')
    expect(tiptapToXhtml(doc)).not.toContain('ill-1-9-0.png')
    // les paragraphes autour restent rendus
    expect(tiptapToMarkdown(doc)).toContain('Avant.')
    expect(tiptapToMarkdown(doc)).toContain('Après.')
  })

  it('collectIllustrations déduplique par fileName dans l’ordre d’apparition', () => {
    expect(collectIllustrations(doc)).toEqual([
      { fileName: 'ill-1-9-0.png', displayName: 'La maison' },
      { fileName: 'ill-1-9-1.jpg', displayName: 'Le café' }
    ])
    expect(collectIllustrations('pas du json')).toEqual([])
  })
})
```

(Importer `collectIllustrations` en tête du fichier de test avec les imports existants.)

- [ ] **Step 2: Vérifier l'échec**

Run : `npx vitest run src/shared/export.test.ts`
Attendu : FAIL (`collectIllustrations` inexistant ; nœud illustration rendu comme paragraphe vide sans callback → les assertions « contient » échouent).

- [ ] **Step 3: Implémenter**

Dans `src/shared/export.ts` :

1. Ajouter en tête les types `IllustrationAttrs` et `ExportOptions` (code du bloc Interfaces ci-dessus, commentaires compris).
2. Fileter `opts` à travers la chaîne de rendu : `renderBlockNode(node, opts)`, `renderListItemMarkdown(item, marker, opts)`, `renderListMarkdown(node, opts)`, `renderBlockquoteMarkdown(node, opts)`, `renderBlocks(doc, opts)` — paramètre obligatoire en interne (les seuls points d'entrée publics ont le défaut `{}`).
3. Dans `renderBlockNode`, avant le bloc `heading` (avec les autres atomes) :

```ts
  if (node.type === 'illustration') {
    const fileName = String(node.attrs?.fileName ?? '')
    const displayName = String(node.attrs?.displayName ?? '')
    // Le rendu appartient au consommateur (Markdown copie les fichiers, EPUB
    // les embarque, PDF les référence en file://) : sans callback, ou si le
    // callback répond null (fichier manquant), le nœud est omis — un export
    // ne doit jamais contenir de lien mort (spec §5).
    const rendered = fileName && opts.illustration ? opts.illustration({ fileName, displayName }) : null
    return rendered ?? { md: '', xhtml: '' }
  }
```

4. Signatures publiques :

```ts
export function tiptapToMarkdown(contentJson: string, opts: ExportOptions = {}): string
export function tiptapToXhtml(contentJson: string, opts: ExportOptions = {}): string
```

5. `collectIllustrations` :

```ts
// Fichiers d'illustration référencés par un document, dans l'ordre
// d'apparition, dédupliqués par fileName — sert aux exports qui doivent
// copier/embarquer les fichiers une seule fois chacun.
export function collectIllustrations(contentJson: string): IllustrationAttrs[] {
  const seen = new Map<string, IllustrationAttrs>()
  const walk = (node: any): void => {
    if (node?.type === 'illustration') {
      const fileName = String(node.attrs?.fileName ?? '')
      if (fileName && !seen.has(fileName)) {
        seen.set(fileName, { fileName, displayName: String(node.attrs?.displayName ?? '') })
      }
    }
    if (Array.isArray(node?.content)) node.content.forEach(walk)
  }
  try {
    walk(JSON.parse(contentJson))
  } catch {
    return []
  }
  return [...seen.values()]
}
```

- [ ] **Step 4: Vérifier le passage (et l'absence de régression)**

Run : `npx vitest run src/shared/export.test.ts src/main/epub.test.ts src/main/smoke.test.ts`
Attendu : PASS partout (le filetage d'`opts` ne change aucun rendu existant).

- [ ] **Step 5: Typecheck + commit**

Run : `npm run typecheck:node && npm run typecheck:web`
```bash
git add src/shared/export.ts src/shared/export.test.ts
git commit -m "feat: rendu du nœud illustration dans le sérialiseur d'export"
```

---

### Task 5: Consommateurs d'export — Markdown, EPUB, PDF

**Files:**
- Modify: `src/main/exporter.ts` (copie `Illustrations/` + rendu md)
- Modify: `src/main/epub.ts` (embarquement archive + manifest + CSS)
- Modify: `src/main/pdf.ts` (fichier HTML temporaire + `file://` + CSS pleine page)
- Modify: `src/main/api.ts` (passer `mediaDir` aux trois exports)
- Test: `src/main/epub.test.ts` (cas ajouté), `src/main/exporter.test.ts` (créé)

**Interfaces:**
- Consomme (Task 4) : `ExportOptions`, `collectIllustrations`, signatures étendues de `tiptapToMarkdown`/`tiptapToXhtml`.
- Produit : signatures étendues, `mediaDir` optionnel (absent → comportement actuel, illustrations omises) :
  - `exportMarkdownToFolder(db, bookId, folder, mediaDir?: string): string`
  - `buildEpub(db, bookId, chapterIds, mediaDir?: string): Promise<Buffer>`
  - `buildPdf(db, bookId, chapterIds, mediaDir?: string): Promise<Buffer>`
  - `epub.ts` exporte sa table `IMAGE_MEDIA_TYPES` (renommage de `COVER_MEDIA_TYPES`, mêmes entrées) pour que `pdf.ts` ne la duplique pas.

**Note de déviation vs spec :** la spec §5 prévoyait des data-URI pour le PDF. La fenêtre cachée charge aujourd'hui une URL `data:` dont Chromium limite la longueur (~2 Mo) — inliner des planches en base64 la dépasserait. `buildPdf` écrit donc le HTML dans un fichier temporaire chargé par `loadFile`, et les images sont référencées en `file://` (autorisé depuis une page `file://`). Reporter cette correction dans la spec (§5, PDF) fait partie de la tâche.

- [ ] **Step 1: Écrire les tests qui échouent**

`src/main/exporter.test.ts` (nouveau, calqué sur le style d'`epub.test.ts`) :

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { openDb } from './db/connection'
import { createApi } from './api'
import { exportMarkdownToFolder } from './exporter'

function docWithIllustration(fileName: string): string {
  return JSON.stringify({
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Avant.' }] },
      { type: 'illustration', attrs: { fileName, displayName: 'La maison' } }
    ]
  })
}

describe('exportMarkdownToFolder + illustrations', () => {
  it('copie les fichiers référencés dans Illustrations/ et rend ![…]', async () => {
    const db = openDb(':memory:')
    const api = createApi(db)
    const book = await api.books.create({ title: 'MD' })
    const c1 = await api.chapters.create(book.id, 'Un')
    const mediaDir = mkdtempSync(join(tmpdir(), 'encre-exp-media-'))
    writeFileSync(join(mediaDir, 'ill-1-9-0.png'), 'png')
    await api.chapters.saveContent(c1.id, docWithIllustration('ill-1-9-0.png'), 'Avant.')

    const out = mkdtempSync(join(tmpdir(), 'encre-exp-out-'))
    exportMarkdownToFolder(db, book.id, out, mediaDir)
    const md = readFileSync(join(out, '01-un.md'), 'utf8')
    expect(md).toContain('![La maison](Illustrations/ill-1-9-0.png)')
    expect(existsSync(join(out, 'Illustrations', 'ill-1-9-0.png'))).toBe(true)
  })

  it('omet un nœud dont le fichier media est absent', async () => {
    const db = openDb(':memory:')
    const api = createApi(db)
    const book = await api.books.create({ title: 'MD' })
    const c1 = await api.chapters.create(book.id, 'Un')
    const mediaDir = mkdtempSync(join(tmpdir(), 'encre-exp-media-'))
    await api.chapters.saveContent(c1.id, docWithIllustration('ill-1-9-9.png'), 'Avant.')

    const out = mkdtempSync(join(tmpdir(), 'encre-exp-out-'))
    exportMarkdownToFolder(db, book.id, out, mediaDir)
    const md = readFileSync(join(out, '01-un.md'), 'utf8')
    expect(md).not.toContain('ill-1-9-9.png')
    expect(existsSync(join(out, 'Illustrations'))).toBe(false)
  })
})
```

Ajouter à `src/main/epub.test.ts` :

```ts
  it('embarque les illustrations référencées et les déclare au manifest', async () => {
    const { mkdtempSync, writeFileSync } = await import('fs')
    const { tmpdir } = await import('os')
    const { join } = await import('path')
    const db = openDb(':memory:')
    const api = createApi(db)
    const book = await api.books.create({ title: 'EPUB illustré' })
    const c1 = await api.chapters.create(book.id, 'Un')
    const mediaDir = mkdtempSync(join(tmpdir(), 'encre-epub-media-'))
    writeFileSync(join(mediaDir, 'ill-1-9-0.png'), 'png-bytes')
    await api.chapters.saveContent(c1.id, JSON.stringify({
      type: 'doc',
      content: [
        { type: 'illustration', attrs: { fileName: 'ill-1-9-0.png', displayName: 'La maison' } },
        { type: 'illustration', attrs: { fileName: 'absente.png', displayName: 'Fantôme' } }
      ]
    }), '')

    const buffer = await buildEpub(db, book.id, [], mediaDir)
    const zip = await JSZip.loadAsync(buffer)
    expect(await zip.file('OEBPS/images/ill-1-9-0.png')!.async('string')).toBe('png-bytes')
    const opf = await zip.file('OEBPS/content.opf')!.async('string')
    expect(opf).toContain('href="images/ill-1-9-0.png" media-type="image/png"')
    const ch1 = await zip.file('OEBPS/chapter-1.xhtml')!.async('string')
    expect(ch1).toContain('<img src="images/ill-1-9-0.png" alt="La maison"/>')
    expect(ch1).not.toContain('absente.png')
    const css = await zip.file('OEBPS/style.css')!.async('string')
    expect(css).toContain('.illustration')
  })
```

- [ ] **Step 2: Vérifier l'échec**

Run : `npx vitest run src/main/exporter.test.ts src/main/epub.test.ts`
Attendu : FAIL (signatures sans `mediaDir`, nœuds omis par défaut).

- [ ] **Step 3: Implémenter**

`src/main/exporter.ts` — imports : ajouter `copyFileSync`, `existsSync` à l'import `fs`, `ExportOptions` et le type depuis `../shared/export` ; signature `exportMarkdownToFolder(db: Db, bookId: number, folder: string, mediaDir?: string): string` ; avant la boucle chapitres :

```ts
  const illustrationsDir = join(folder, 'Illustrations')
  const copied = new Set<string>()
  // Un seul callback pour tout l'export : chaque fichier référencé est copié
  // une fois, à la première rencontre ; un fichier manquant dans media omet
  // le nœud (pas de lien mort dans le Markdown exporté).
  const opts: ExportOptions = {
    illustration: ({ fileName, displayName }) => {
      if (!mediaDir || !existsSync(join(mediaDir, fileName))) return null
      if (!copied.has(fileName)) {
        mkdirSync(illustrationsDir, { recursive: true })
        copyFileSync(join(mediaDir, fileName), join(illustrationsDir, fileName))
        copied.add(fileName)
      }
      return { md: `![${displayName}](Illustrations/${fileName})`, xhtml: '' }
    }
  }
```

et dans la boucle : `const body = tiptapToMarkdown(full.contentJson, opts)`.

`src/main/epub.ts` — renommer `COVER_MEDIA_TYPES` en `IMAGE_MEDIA_TYPES` et l'exporter (mettre à jour ses deux usages) ; signature `buildEpub(db, bookId, chapterIds, mediaDir?: string)` ; avant la boucle chapitres :

```ts
  const embeddedImages = new Set<string>()
  const illustrationManifest: string[] = []
  const opts: ExportOptions = {
    illustration: ({ fileName, displayName }) => {
      if (!mediaDir) return null
      const src = join(mediaDir, fileName)
      if (!existsSync(src)) return null
      if (!embeddedImages.has(fileName)) {
        zip.file(`OEBPS/images/${fileName}`, readFileSync(src))
        const mediaType = IMAGE_MEDIA_TYPES[extname(fileName).toLowerCase()] ?? 'application/octet-stream'
        illustrationManifest.push(
          `<item id="illustration-${illustrationManifest.length + 1}" href="images/${fileName}" media-type="${mediaType}"/>`
        )
        embeddedImages.add(fileName)
      }
      return {
        md: '',
        xhtml: `<div class="illustration"><img src="images/${fileName}" alt="${escapeXml(displayName)}"/></div>`
      }
    }
  }
```

Dans la boucle : `tiptapToXhtml(full.contentJson, opts)`. Après la boucle, avant la construction de l'OPF : `manifestItems.push(...illustrationManifest)`. Dans `STYLE_CSS` :

```css
.illustration {
  text-align: center;
  margin: 1.5em 0;
  text-indent: 0;
}
.illustration img {
  max-width: 100%;
}
```

`src/main/pdf.ts` — signature `buildPdf(db, bookId, chapterIds, mediaDir?: string)` ; imports : `mkdtempSync`, `writeFileSync`, `rmSync`, `existsSync` de `fs`, `tmpdir` de `os`, `join`, `extname` de `path`, `pathToFileURL` de `url`, `ExportOptions` de `../shared/export`, `IMAGE_MEDIA_TYPES` de `./epub` (importé uniquement pour vérifier l'extension — même famille d'images partout). Callback :

```ts
  const opts: ExportOptions = {
    illustration: ({ fileName, displayName }) => {
      if (!mediaDir) return null
      const src = join(mediaDir, fileName)
      if (!existsSync(src) || !(extname(fileName).toLowerCase() in IMAGE_MEDIA_TYPES)) return null
      return {
        md: '',
        xhtml: `<div class="illustration"><img src="${pathToFileURL(src).toString()}" alt="${escapeXml(displayName)}"/></div>`
      }
    }
  }
```

Rendu chapitres : `tiptapToXhtml(full.contentJson, opts)`. Chargement : remplacer le `loadURL('data:…')` par un fichier temporaire — les URL `data:` sont plafonnées (~2 Mo) par Chromium, ce qui casserait un livre long même sans images, et `file://` permet aux `<img src="file://…">` de charger :

```ts
  const tmpDir = mkdtempSync(join(tmpdir(), 'encre-pdf-'))
  const htmlPath = join(tmpDir, 'livre.html')
  writeFileSync(htmlPath, html)
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  try {
    await win.loadFile(htmlPath)
    return await win.webContents.printToPDF({ pageSize: 'A5', printBackground: true })
  } finally {
    win.close()
    rmSync(tmpDir, { recursive: true, force: true })
  }
```

Dans `STYLE_CSS` de `pdf.ts` (planche pleine page, usage L'ENVERS) :

```css
.illustration {
  page-break-before: always;
  page-break-after: always;
  text-align: center;
  text-indent: 0;
}
.illustration img {
  max-width: 100%;
  max-height: 96vh;
}
```

`src/main/api.ts` — les trois méthodes `exporter.*` calculent `const mediaDir = join(app.getPath('userData'), 'media')` (l'import `app` est déjà fait via `await import('electron')` dans chacune — ajouter `app` à la déstructuration) et le passent en dernier argument à `exportMarkdownToFolder` / `buildEpub` / `buildPdf`.

Mettre à jour la spec : dans `docs/superpowers/specs/2026-08-23-illustrations-design.md` §5, remplacer la phrase sur les data-URI par le mécanisme fichier temporaire + `file://` (avec la raison : plafond de longueur des URL `data:`).

- [ ] **Step 4: Vérifier le passage (et l'absence de régression)**

Run : `npx vitest run src/main/exporter.test.ts src/main/epub.test.ts src/main/api.test.ts src/main/smoke.test.ts && npm run typecheck:node`
Attendu : PASS partout.

- [ ] **Step 5: Commit**

```bash
git add src/main/exporter.ts src/main/epub.ts src/main/pdf.ts src/main/api.ts src/main/exporter.test.ts src/main/epub.test.ts docs/superpowers/specs/2026-08-23-illustrations-design.md
git commit -m "feat: illustrations dans les exports Markdown, EPUB et PDF"
```

---

### Task 6: Nœud d'éditeur `illustration`

**Files:**
- Modify: `src/renderer/src/editor/formatNodes.ts` (exporter `insertBlockAtomCommand` avec attrs)
- Create: `src/renderer/src/editor/illustration.ts`
- Modify: `src/renderer/src/components/EditorPane.vue` (enregistrer l'extension)
- Modify: `src/renderer/src/styles/theme.css` (rendu pleine largeur + état sélectionné/manquant)

**Interfaces:**
- Consomme (Task 1) : rien côté données — le nœud ne connaît que ses attrs.
- Produit (utilisé par Task 7) : commande TipTap `insertIllustration({ fileName, displayName })` ; extension `Illustration` enregistrée dans l'éditeur.

**Pas de test automatisé** : le renderer n'a aucune infra de test dans ce repo (aucun composant/éditeur testé) — vérification par `npm run typecheck:web` puis manuelle en Task 7. Ne pas introduire d'infra de test renderer dans cette tâche.

- [ ] **Step 1: Généraliser `insertBlockAtomCommand` aux attrs**

Dans `formatNodes.ts`, modifier la fabrique existante (les deux appels `insertContent*` gagnent les attrs ; les usages `setSceneBreak`/`setPageBreak` restent des appels sans argument, inchangés) et l'**exporter** :

```ts
export function insertBlockAtomCommand(
  nodeName: string
): (attrs?: Record<string, unknown>) => Command {
  return (attrs?: Record<string, unknown>) =>
    ({ chain, state }) => {
      ...
      if (isNodeSelection(selection)) {
        currentChain.insertContentAt($originTo.pos, { type: nodeName, ...(attrs ? { attrs } : {}) })
      } else {
        currentChain.insertContent({ type: nodeName, ...(attrs ? { attrs } : {}) })
      }
      ...
```

(Seules ces trois lignes + le mot-clé `export` changent ; tout le reste de la fonction — garde `canInsertNode`, repositionnement du curseur, paragraphe de fin de document — est conservé à l'identique.)

- [ ] **Step 2: Créer le nœud**

`src/renderer/src/editor/illustration.ts` :

```ts
// Nœud illustration (spec 2026-08-23) : planche pleine largeur insérée au
// curseur. Atome bloc comme sceneBreak/pageBreak — même fabrique d'insertion
// (curseur repositionné après le nœud, paragraphe ajouté en fin de document).
// Le src n'est PAS un attribut persisté : il est dérivé de fileName au rendu
// (encre-media://, seul protocole d'image autorisé par la CSP) — le JSON en
// base ne contient que fileName/displayName.
import { Node, mergeAttributes } from '@tiptap/core'
import { insertBlockAtomCommand } from './formatNodes'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    illustration: {
      /**
       * Insère une illustration de la bibliothèque du livre au curseur.
       */
      insertIllustration: (attrs: { fileName: string; displayName: string }) => ReturnType
    }
  }
}

export const Illustration = Node.create({
  name: 'illustration',

  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      fileName: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-illustration') ?? '',
        renderHTML: () => ({}) // porté par le renderHTML global ci-dessous
      },
      displayName: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('alt') ?? '',
        renderHTML: () => ({})
      }
    }
  },

  parseHTML() {
    return [{ tag: 'img[data-illustration]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const fileName = String(node.attrs.fileName ?? '')
    return [
      'img',
      mergeAttributes(HTMLAttributes, {
        'data-illustration': fileName,
        alt: String(node.attrs.displayName ?? ''),
        src: `encre-media://${encodeURIComponent(fileName)}`
      })
    ]
  },

  addCommands() {
    return {
      insertIllustration: insertBlockAtomCommand(this.name)
    }
  }
})
```

Si TypeScript refuse la signature de `insertIllustration` (la fabrique renvoie `(attrs?: Record<string, unknown>) => Command`, le contrat déclaré exige des attrs typés), poser le cast localement : `insertIllustration: insertBlockAtomCommand(this.name) as unknown as (attrs: { fileName: string; displayName: string }) => Command`.

- [ ] **Step 3: Enregistrer l'extension et styler**

`EditorPane.vue` : ajouter `import { Illustration } from '../editor/illustration'` et `Illustration` à la liste `extensions` de `useEditor`.

`theme.css`, à côté des styles `hr[data-kind]` existants :

```css
/* Nœud illustration : planche pleine largeur dans le flux du texte. L'alt
   (displayName) sert d'état « manquant » : si le fichier media a disparu,
   le navigateur affiche l'alt dans le cadre de l'image cassée. */
.tiptap img[data-illustration] {
  display: block;
  max-width: 100%;
  margin: 1.6em auto;
}
.tiptap img[data-illustration].ProseMirror-selectednode {
  outline: 2px solid var(--accent, #4a7dcf);
  outline-offset: 2px;
}
```

(Vérifier le nom réel de la variable d'accent dans `theme.css` — utiliser celle des états sélectionnés existants, p. ex. celle du `.ProseMirror-selectednode` des `hr` si elle existe, sinon la variable d'accent globale du thème.)

- [ ] **Step 4: Vérifier**

Run : `npm run typecheck:web`
Attendu : PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/editor/formatNodes.ts src/renderer/src/editor/illustration.ts src/renderer/src/components/EditorPane.vue src/renderer/src/styles/theme.css
git commit -m "feat: nœud d'éditeur illustration (atome bloc encre-media)"
```

---

### Task 7: Panneau Illustrations + insertion depuis la barre d'éditeur

**Files:**
- Create: `src/renderer/src/components/IllustrationsPanel.vue`
- Modify: `src/renderer/src/components/EditorPane.vue` (bouton d'ouverture + insertion)

**Interfaces:**
- Consomme : domaine `window.encre.illustrations` (Task 3), commande `insertIllustration` (Task 6), `mediaUrl` de `src/renderer/src/utils/media.ts` (accepte un nom de fichier nu : il n'en garde que le basename), `ConfirmDialog.vue` (composant existant — lire ses props/événements avant usage), store livre (`useBookStore`, champ `store.book`).
- Produit : composant `IllustrationsPanel.vue` — props `{ bookId: number }`, événements `close` et `insert` (payload `Illustration`).

- [ ] **Step 1: Créer le composant**

`IllustrationsPanel.vue` — panneau overlay modelé sur `SnapshotManager.vue` (lire ce fichier d'abord et reprendre sa structure : overlay, fermeture Échap/clic extérieur, classes CSS de la même famille). Contenu :

- En-tête « Illustrations » + bouton « Ajouter… » (`window.encre.illustrations.add(bookId)` puis rechargement de la liste) + bouton fermer.
- Liste chargée au montage (`listByBook`), état vide : « Aucune illustration. Ajoutez des fichiers PNG, JPG ou WebP à la bibliothèque de ce livre. »
- Chaque entrée : vignette `<img :src="mediaUrl(ill.fileName)" :alt="ill.displayName">` (~72 px de haut, `object-fit: cover`), nom éditable (input inline → `rename` au blur/Entrée, comme le titre de chapitre dans `EditorPane`), bouton « Insérer » (émet `insert(ill)` — le panneau reste ouvert pour insérer plusieurs planches), bouton supprimer.
- Suppression : au clic, appeler `usage(ill.id)` puis ouvrir `ConfirmDialog` avec le message « Supprimer « {displayName} » ? » enrichi, si usage > 0, de « Utilisée dans {n} chapitre(s) : les images déjà insérées afficheront un cadre vide. » Confirmé → `remove(ill.id)` + rechargement.
- Toute la copie en français.

Squelette du script :

```ts
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { Illustration } from '../../../shared/types'
import { mediaUrl } from '../utils/media'
import ConfirmDialog from './ConfirmDialog.vue'

const props = defineProps<{ bookId: number }>()
const emit = defineEmits<{ close: []; insert: [ill: Illustration] }>()

const illustrations = ref<Illustration[]>([])

async function reload(): Promise<void> {
  illustrations.value = await window.encre.illustrations.listByBook(props.bookId)
}
onMounted(reload)

async function add(): Promise<void> {
  await window.encre.illustrations.add(props.bookId)
  await reload()
}

async function rename(ill: Illustration, event: Event): Promise<void> {
  const displayName = (event.target as HTMLInputElement).value.trim()
  if (!displayName || displayName === ill.displayName) return
  await window.encre.illustrations.rename(ill.id, displayName)
  await reload()
}

// … suppression : voir description ci-dessus (usage → ConfirmDialog → remove)
</script>
```

- [ ] **Step 2: Brancher dans `EditorPane.vue`**

- Import du composant + `import type { Illustration } from '../../../shared/types'` (fusionner avec l'import de types existant).
- `const illustrationsPanelOpen = ref(false)`.
- Bouton dans le `<header>` à côté du menu « ¶+ » (même langage visuel que les boutons existants — SVG inline trait 1.75, `title`/`aria-label` « Illustrations du livre ») qui toggle `illustrationsPanelOpen`.
- Dans le template, à côté de `<SnapshotManager v-if="ai.snapshotManagerOpen" />` :

```html
    <IllustrationsPanel
      v-if="illustrationsPanelOpen && store.book"
      :book-id="store.book.id"
      @close="illustrationsPanelOpen = false"
      @insert="insertIllustrationFromPanel"
    />
```

- Handler d'insertion (même famille qu'`insertFormatNode`, opération synchrone sur l'éditeur affiché) :

```ts
function insertIllustrationFromPanel(ill: Illustration): void {
  editor.value
    ?.chain()
    .focus()
    .insertIllustration({ fileName: ill.fileName, displayName: ill.displayName })
    .run()
}
```

- [ ] **Step 3: Vérifier (typecheck + manuel)**

Run : `npm run typecheck:web && npm run typecheck:node`
Attendu : PASS.

Vérification manuelle (`npm run dev`, à faire par le partenaire humain ou décrire précisément dans le rapport de tâche si non exécutable) :
1. Ouvrir un livre → chapitre → bouton Illustrations → « Ajouter… » avec 2 PNG (p. ex. `~/Documents/livres/L'ENVERS/Illustrations/p1_1.png` et `p1_2.png`) → vignettes visibles.
2. « Insérer » → l'image apparaît pleine largeur au curseur ; sélectionnable ; suppression au clavier OK ; rechargement du chapitre → l'image persiste.
3. Renommer une illustration → le nom persiste après réouverture du panneau.
4. Supprimer une illustration utilisée → le message d'usage apparaît ; après confirmation, le nœud inséré montre le cadre « alt ».
5. Exports EPUB et PDF du livre → la planche est dans l'archive/le PDF, pleine page côté PDF.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/IllustrationsPanel.vue src/renderer/src/components/EditorPane.vue
git commit -m "feat: panneau Illustrations et insertion au curseur"
```

---

## Vérification finale (après Task 7)

- [ ] `npm test` (suite complète, avec le double rebuild better-sqlite3)
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] Passe de vérification manuelle du Step 3 de Task 7 si pas encore faite
