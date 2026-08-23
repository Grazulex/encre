# Sauvegarde git hors machine — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sauvegarder automatiquement la base et les médias vers le dépôt privé
`encre_backup`, et afficher dans l'app la date de la dernière sauvegarde et ce
qui a changé depuis.

**Architecture:** Un miroir git dans `userData/backup-repo` contenant le dump
SQL de la base, les fichiers médias et un manifeste. Le process main régénère
ce miroir, commite et pousse ; le renderer lit un état via deux appels IPC.
Toute la logique de comparaison est en fonctions pures, tous les tests tournent
contre un dépôt nu local — jamais de réseau.

**Tech Stack:** Electron 39, better-sqlite3, Vue 3 + Pinia, vitest, `/usr/bin/git`,
`/usr/bin/sqlite3`.

**Spec:** `docs/superpowers/specs/2026-08-23-backup-git-design.md`

## Global Constraints

- Dépôt distant : `git@github.com:Grazulex/encre_backup.git`
- Toute commande git porte : `-c commit.gpgsign=false -c user.name=Encre -c user.email=jms@grazulex.be`
- Toute commande git parlant au réseau porte :
  `GIT_SSH_COMMAND="ssh -i <clé> -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new"`
- Binaires en chemin absolu : `/usr/bin/git`, `/usr/bin/sqlite3`
- **Jamais `spawnSync`** dans le chemin de sauvegarde : il gèlerait le process main, donc l'UI
- Délai de garde du push : 120 s
- Les médias ne sont jamais supprimés du dépôt
- Commentaires et messages de commit en français, comme le reste du dépôt
- `npm test` doit rester vert à chaque commit

---

### Task 1: Déplacer le backup local dans son dossier

Pur renommage préparatoire : `backup/` devient le seul endroit où vit la
sauvegarde, en suivant les dossiers `db/`, `ai/`, `pdf/` existants.

**Files:**
- Create: `src/main/backup/local.ts` (contenu de `src/main/backup.ts`)
- Create: `src/main/backup/local.test.ts` (contenu de `src/main/backup.test.ts`)
- Delete: `src/main/backup.ts`, `src/main/backup.test.ts`
- Modify: `src/main/index.ts:9` (chemin d'import)

**Interfaces:**
- Consumes: rien
- Produces: `backupDatabase(db, backupsDir, now): Promise<string>`,
  `shouldBackup(backupsDir, now): boolean`,
  `pruneBackups(backupsDir, now, keepDays?): string[]` — désormais importés
  depuis `./backup/local`

- [ ] **Step 1: Déplacer les deux fichiers**

```bash
mkdir -p src/main/backup
git mv src/main/backup.ts src/main/backup/local.ts
git mv src/main/backup.test.ts src/main/backup/local.test.ts
```

- [ ] **Step 2: Corriger les imports relatifs du module déplacé**

Dans `src/main/backup/local.ts`, l'import de `Db` remonte d'un cran :

```ts
import type { Db } from '../db/connection'
```

Dans `src/main/backup/local.test.ts`, deux imports remontent :

```ts
import { openDb } from '../db/connection'
import { backupDatabase, pruneBackups, shouldBackup } from './local'
```

- [ ] **Step 3: Corriger l'import dans index.ts**

`src/main/index.ts` ligne 9 :

```ts
import { backupDatabase, pruneBackups, shouldBackup } from './backup/local'
```

- [ ] **Step 4: Vérifier que rien n'est cassé**

Run: `npm run typecheck && npx vitest run src/main/backup`
Expected: typecheck sans erreur, tests de `local.test.ts` au vert.

- [ ] **Step 5: Commit**

```bash
git add -A src/main
git commit -m "refactor: regroupe la sauvegarde dans src/main/backup/"
```

---

### Task 2: Le manifeste et le calcul du diff

Le cœur logique, entièrement pur : construire la photo d'un état, et comparer
deux photos. Aucune dépendance à git, au réseau ni à Electron.

**Files:**
- Create: `src/main/backup/manifest.ts`
- Test: `src/main/backup/manifest.test.ts`

**Files (suite):**
- Modify: `src/shared/types.ts` (types partagés main ↔ renderer)

**Interfaces:**
- Consumes: `Db` depuis `../db/connection`
- Produces, dans `src/shared/types.ts` (le renderer les affiche, donc ils ne
  peuvent pas vivre dans `main/` — `shared/` ne dépend jamais de `main/`) :
  - `interface BackupDiff { chaptersChanged: number; chaptersAdded: number; chaptersRemoved: number; wordsDelta: number; mediaAdded: number; booksAdded: number; changedTitles: string[] }`
  - `interface BackupStatus { configured: boolean; running: boolean; missingBinary: string | null; lastCommitAt: string | null; lastPushAt: string | null; lastError: string | null; pending: BackupDiff; lastDiff: BackupDiff | null }`
- Produces, dans `src/main/backup/manifest.ts` (le renderer n'en a pas besoin) :
  - `interface ManifestChapter { id: number; bookId: number; title: string; words: number; hash: string }`
  - `interface Manifest { version: 1; generatedAt: string; counts: { books: number; chapters: number; entities: number; illustrations: number; media: number }; books: number[]; media: string[]; chapters: ManifestChapter[] }`
  - `buildManifest(db: Db, mediaDir: string, now: Date): Manifest`
  - `diffManifests(prev: Manifest | null, next: Manifest): BackupDiff`

- [ ] **Step 0: Ajouter les deux types partagés**

À la fin de `src/shared/types.ts` :

```ts
export interface BackupDiff {
  chaptersChanged: number
  chaptersAdded: number
  chaptersRemoved: number
  wordsDelta: number
  mediaAdded: number
  booksAdded: number
  /** Tronqué à 5 : c'est de l'affichage, pas de la donnée. */
  changedTitles: string[]
}

export interface BackupStatus {
  configured: boolean
  running: boolean
  /** Chemin du binaire manquant (git ou sqlite3), null si tout est là. */
  missingBinary: string | null
  lastCommitAt: string | null
  lastPushAt: string | null
  lastError: string | null
  pending: BackupDiff
  lastDiff: BackupDiff | null
}
```

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `src/main/backup/manifest.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { openDb, type Db } from '../db/connection'
import { createBook } from '../db/books'
import { createChapter } from '../db/chapters'
import { buildManifest, diffManifests, type Manifest } from './manifest'

let db: Db
let mediaDir: string
const NOW = new Date('2026-08-23T20:00:00.000Z')

beforeEach(() => {
  db = openDb(':memory:')
  mediaDir = mkdtempSync(join(tmpdir(), 'encre-manifest-media-'))
})

// Fabrique un manifeste minimal, pour tester diffManifests sans base.
function manifest(over: Partial<Manifest> = {}): Manifest {
  return {
    version: 1,
    generatedAt: NOW.toISOString(),
    counts: { books: 0, chapters: 0, entities: 0, illustrations: 0, media: 0 },
    books: [],
    media: [],
    chapters: [],
    ...over
  }
}

describe('buildManifest', () => {
  it('photographie chapitres, comptes, livres et noms de médias', () => {
    const book = createBook(db, { title: 'Livre' })
    const ch = createChapter(db, book.id, 'Ch. 1')
    db.prepare('UPDATE chapters SET content_json = ?, word_count = ? WHERE id = ?')
      .run('{"doc":1}', 42, ch.id)
    writeFileSync(join(mediaDir, 'b.png'), 'x')
    writeFileSync(join(mediaDir, 'a.png'), 'x')

    const m = buildManifest(db, mediaDir, NOW)

    expect(m.version).toBe(1)
    expect(m.generatedAt).toBe('2026-08-23T20:00:00.000Z')
    expect(m.counts).toMatchObject({ books: 1, chapters: 1, media: 2 })
    expect(m.books).toEqual([book.id])
    expect(m.media).toEqual(['a.png', 'b.png']) // trié, pour un diff git stable
    expect(m.chapters).toEqual([
      { id: ch.id, bookId: book.id, title: 'Ch. 1', words: 42, hash: expect.any(String) }
    ])
  })

  it('tolère un dossier media absent', () => {
    const m = buildManifest(db, join(mediaDir, 'nexistepas'), NOW)
    expect(m.media).toEqual([])
    expect(m.counts.media).toBe(0)
  })
})

describe('diffManifests', () => {
  it('ne signale rien quand rien n\'a changé', () => {
    const m = manifest({
      chapters: [{ id: 1, bookId: 1, title: 'A', words: 10, hash: 'h1' }]
    })
    const d = diffManifests(m, m)
    expect(d).toMatchObject({ chaptersChanged: 0, chaptersAdded: 0, chaptersRemoved: 0, wordsDelta: 0 })
  })

  it('attrape une réécriture à nombre de mots constant (le cas du hash)', () => {
    const prev = manifest({ chapters: [{ id: 1, bookId: 1, title: 'A', words: 10, hash: 'avant' }] })
    const next = manifest({ chapters: [{ id: 1, bookId: 1, title: 'A', words: 10, hash: 'apres' }] })
    const d = diffManifests(prev, next)
    expect(d.chaptersChanged).toBe(1)
    expect(d.wordsDelta).toBe(0)
    expect(d.changedTitles).toEqual(['A'])
  })

  it('compte les chapitres ajoutés et le delta de mots', () => {
    const prev = manifest({ chapters: [{ id: 1, bookId: 1, title: 'A', words: 10, hash: 'h1' }] })
    const next = manifest({
      chapters: [
        { id: 1, bookId: 1, title: 'A', words: 25, hash: 'h1b' },
        { id: 2, bookId: 1, title: 'B', words: 5, hash: 'h2' }
      ]
    })
    const d = diffManifests(prev, next)
    expect(d).toMatchObject({ chaptersChanged: 1, chaptersAdded: 1, wordsDelta: 20 })
  })

  it('compte les chapitres supprimés et retire leurs mots', () => {
    const prev = manifest({
      chapters: [
        { id: 1, bookId: 1, title: 'A', words: 10, hash: 'h1' },
        { id: 2, bookId: 1, title: 'B', words: 7, hash: 'h2' }
      ]
    })
    const next = manifest({ chapters: [{ id: 1, bookId: 1, title: 'A', words: 10, hash: 'h1' }] })
    const d = diffManifests(prev, next)
    expect(d).toMatchObject({ chaptersRemoved: 1, wordsDelta: -7 })
    expect(d.changedTitles).toEqual(['B'])
  })

  it('première sauvegarde (prev null) : tout est ajouté', () => {
    const next = manifest({
      counts: { books: 1, chapters: 1, entities: 0, illustrations: 0, media: 2 },
      books: [1],
      media: ['a.png', 'b.png'],
      chapters: [{ id: 1, bookId: 1, title: 'A', words: 10, hash: 'h1' }]
    })
    const d = diffManifests(null, next)
    expect(d).toMatchObject({ chaptersAdded: 1, wordsDelta: 10, mediaAdded: 2, booksAdded: 1 })
  })

  it('compte les médias par identité, pas par différence de compteurs', () => {
    // 2 supprimés, 3 ajoutés : un calcul par compteurs dirait « 1 ajouté ».
    const prev = manifest({ media: ['a.png', 'b.png', 'c.png'] })
    const next = manifest({ media: ['a.png', 'd.png', 'e.png', 'f.png'] })
    expect(diffManifests(prev, next).mediaAdded).toBe(3)
  })

  it('tronque changedTitles à 5', () => {
    const chapters = Array.from({ length: 8 }, (_, i) => ({
      id: i + 1, bookId: 1, title: `Ch ${i + 1}`, words: 1, hash: 'h'
    }))
    const d = diffManifests(null, manifest({ chapters }))
    expect(d.chaptersAdded).toBe(8)
    expect(d.changedTitles).toHaveLength(5)
  })
})
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `npx vitest run src/main/backup/manifest.test.ts`
Expected: FAIL — `Failed to resolve import "./manifest"`.

- [ ] **Step 3: Écrire l'implémentation**

Créer `src/main/backup/manifest.ts` :

```ts
import { createHash } from 'crypto'
import { readdirSync } from 'fs'
import type { Db } from '../db/connection'
import type { BackupDiff } from '../../shared/types'

export type { BackupDiff }

export interface ManifestChapter {
  id: number
  bookId: number
  title: string
  words: number
  hash: string
}

export interface Manifest {
  version: 1
  generatedAt: string
  counts: { books: number; chapters: number; entities: number; illustrations: number; media: number }
  /** Identités, pas compteurs — voir diffManifests. */
  books: number[]
  media: string[]
  chapters: ManifestChapter[]
}

const TITLES_SHOWN = 5

function count(db: Db, table: string): number {
  return (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n
}

export function buildManifest(db: Db, mediaDir: string, now: Date): Manifest {
  const rows = db
    .prepare('SELECT id, book_id, title, word_count, content_json FROM chapters ORDER BY id')
    .all() as { id: number; book_id: number; title: string; word_count: number; content_json: string }[]

  const chapters: ManifestChapter[] = rows.map((r) => ({
    id: r.id,
    bookId: r.book_id,
    title: r.title,
    words: r.word_count,
    // Le hash rattrape la réécriture à nombre de mots constant, que `words`
    // seul laisserait passer — or c'est précisément du travail à ne pas perdre.
    hash: createHash('sha1').update(r.content_json).digest('hex')
  }))

  const books = (db.prepare('SELECT id FROM books ORDER BY id').all() as { id: number }[]).map((b) => b.id)

  // Trié : sans tri, l'ordre de readdir ferait bouger le manifeste d'une
  // sauvegarde à l'autre sans qu'aucune donnée n'ait changé.
  let media: string[] = []
  try {
    media = readdirSync(mediaDir).sort()
  } catch {
    media = []
  }

  return {
    version: 1,
    generatedAt: now.toISOString(),
    counts: {
      books: books.length,
      chapters: chapters.length,
      entities: count(db, 'entities'),
      illustrations: count(db, 'illustrations'),
      media: media.length
    },
    books,
    media,
    chapters
  }
}

export function diffManifests(prev: Manifest | null, next: Manifest): BackupDiff {
  const before = new Map((prev?.chapters ?? []).map((c) => [c.id, c]))
  const after = new Map(next.chapters.map((c) => [c.id, c]))

  let chaptersChanged = 0
  let chaptersAdded = 0
  let chaptersRemoved = 0
  let wordsDelta = 0
  const changedTitles: string[] = []

  for (const c of next.chapters) {
    const old = before.get(c.id)
    if (!old) {
      chaptersAdded++
      wordsDelta += c.words
      changedTitles.push(c.title)
    } else if (old.hash !== c.hash) {
      chaptersChanged++
      wordsDelta += c.words - old.words
      changedTitles.push(c.title)
    }
  }
  for (const old of before.values()) {
    if (!after.has(old.id)) {
      chaptersRemoved++
      wordsDelta -= old.words
      changedTitles.push(old.title)
    }
  }

  // Par identité et non par différence de compteurs : 2 suppressions + 3 ajouts
  // donneraient « 1 ajouté » avec des compteurs, alors qu'il y a bien trois
  // fichiers neufs à sauvegarder.
  const knownMedia = new Set(prev?.media ?? [])
  const knownBooks = new Set(prev?.books ?? [])

  return {
    chaptersChanged,
    chaptersAdded,
    chaptersRemoved,
    wordsDelta,
    mediaAdded: next.media.filter((f) => !knownMedia.has(f)).length,
    booksAdded: next.books.filter((b) => !knownBooks.has(b)).length,
    changedTitles: changedTitles.slice(0, TITLES_SHOWN)
  }
}
```

- [ ] **Step 4: Lancer les tests pour les voir passer**

Run: `npx vitest run src/main/backup/manifest.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/backup/manifest.ts src/main/backup/manifest.test.ts
git commit -m "feat: manifeste de sauvegarde et calcul du diff"
```

---

### Task 3: Les commandes git

Enveloppe asynchrone autour de `/usr/bin/git`, avec l'identité et la clé
imposées. Testée contre un dépôt nu dans un dossier temporaire — vrai git, zéro
réseau.

**Files:**
- Create: `src/main/backup/git.ts`
- Test: `src/main/backup/git.test.ts`

**Interfaces:**
- Consumes: rien
- Produces:
  - `interface GitResult { ok: boolean; stdout: string; stderr: string }`
  - `runGit(args: string[], opts: { cwd: string; keyPath?: string; timeoutMs?: number }): Promise<GitResult>`
  - `cloneRepo(remoteUrl: string, dir: string, keyPath?: string): Promise<GitResult>`
  - `hasRepo(dir: string): boolean`
  - `commitAll(dir: string, message: string): Promise<{ committed: boolean; result: GitResult }>`
  - `pushRepo(dir: string, keyPath?: string): Promise<GitResult>`
  - `GIT_BIN = '/usr/bin/git'`

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `src/main/backup/git.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { runGit, cloneRepo, hasRepo, commitAll, pushRepo, GIT_BIN } from './git'

let dir: string
let remote: string
let work: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'encre-git-'))
  remote = join(dir, 'remote.git')
  work = join(dir, 'work')
  // Un dépôt nu local tient lieu de GitHub : même protocole côté git, aucun réseau.
  execFileSync(GIT_BIN, ['init', '--bare', '-q', '-b', 'main', remote])
})

describe('cloneRepo / hasRepo', () => {
  it('clone un dépôt vide et le reconnaît', async () => {
    expect(hasRepo(work)).toBe(false)
    const r = await cloneRepo(remote, work)
    expect(r.ok).toBe(true)
    expect(hasRepo(work)).toBe(true)
  })
})

describe('commitAll', () => {
  it('commite les fichiers présents sans signature GPG', async () => {
    await cloneRepo(remote, work)
    writeFileSync(join(work, 'library.sql'), 'CREATE TABLE t(a);')

    const { committed } = await commitAll(work, 'sauvegarde de test')
    expect(committed).toBe(true)

    const log = await runGit(['log', '-1', '--format=%an <%ae>%n%s'], { cwd: work })
    expect(log.stdout.trim()).toBe('Encre <jms@grazulex.be>\nsauvegarde de test')

    // %G? vaut 'N' quand le commit n'est pas signé : c'est la preuve que le
    // commit.gpgsign=true global a bien été désarmé.
    const sig = await runGit(['log', '-1', '--format=%G?'], { cwd: work })
    expect(sig.stdout.trim()).toBe('N')
  })

  it('renvoie committed=false quand il n\'y a rien à commiter', async () => {
    await cloneRepo(remote, work)
    writeFileSync(join(work, 'a.txt'), 'x')
    await commitAll(work, 'premier')
    const { committed } = await commitAll(work, 'second')
    expect(committed).toBe(false)
  })
})

describe('pushRepo', () => {
  it('pousse vers le dépôt nu', async () => {
    await cloneRepo(remote, work)
    writeFileSync(join(work, 'a.txt'), 'x')
    await commitAll(work, 'sauvegarde')
    const r = await pushRepo(work)
    expect(r.ok).toBe(true)

    const check = await runGit(['log', '-1', '--format=%s'], { cwd: remote })
    expect(check.stdout.trim()).toBe('sauvegarde')
  })

  it('échoue proprement quand le remote est introuvable', async () => {
    await cloneRepo(remote, work)
    writeFileSync(join(work, 'a.txt'), 'x')
    await commitAll(work, 'sauvegarde')
    await runGit(['remote', 'set-url', 'origin', join(dir, 'nexistepas.git')], { cwd: work })

    const r = await pushRepo(work)
    expect(r.ok).toBe(false)
    expect(r.stderr).not.toBe('')
  })
})

describe('runGit', () => {
  it('rend ok=false plutôt que de lever sur une commande invalide', async () => {
    const r = await runGit(['pas-une-commande'], { cwd: dir })
    expect(r.ok).toBe(false)
  })

  it('ne laisse pas de dossier derrière un clone raté', async () => {
    const r = await cloneRepo(join(dir, 'vide.git'), join(dir, 'rate'))
    expect(r.ok).toBe(false)
    expect(existsSync(join(dir, 'rate', '.git'))).toBe(false)
  })
})
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `npx vitest run src/main/backup/git.test.ts`
Expected: FAIL — `Failed to resolve import "./git"`.

- [ ] **Step 3: Écrire l'implémentation**

Créer `src/main/backup/git.ts` :

```ts
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

export const GIT_BIN = '/usr/bin/git'

/** Délai de garde du push : un réseau qui pend ne doit pas bloquer l'état. */
export const PUSH_TIMEOUT_MS = 120_000

/**
 * Identité imposée à chaque commande. La config globale de la machine porte
 * `commit.gpgsign = true` : sans ce désarmement, chaque sauvegarde ferait
 * surgir une fenêtre pinentry en pleine session d'écriture — ou échouerait
 * sans rien dire dans une app lancée depuis le Finder.
 */
const IDENTITY = [
  '-c', 'commit.gpgsign=false',
  '-c', 'user.name=Encre',
  '-c', 'user.email=jms@grazulex.be'
]

export interface GitResult {
  ok: boolean
  stdout: string
  stderr: string
}

function sshCommand(keyPath: string): string {
  // BatchMode=yes : une app graphique ne doit jamais se bloquer sur une invite
  // que personne ne verra. Elle échoue franchement, l'erreur remonte dans l'UI.
  return [
    'ssh',
    `-i "${keyPath}"`,
    '-o IdentitiesOnly=yes',
    '-o BatchMode=yes',
    '-o StrictHostKeyChecking=accept-new'
  ].join(' ')
}

/**
 * `spawn` et non `spawnSync` : tout ceci tourne dans le process main, et un
 * appel synchrone gèlerait l'UI entière le temps d'un aller-retour réseau.
 * Ne lève jamais — un échec est une donnée (`ok: false`), pas une exception :
 * l'appelant doit toujours pouvoir enregistrer l'erreur et continuer.
 */
export function runGit(
  args: string[],
  opts: { cwd: string; keyPath?: string; timeoutMs?: number }
): Promise<GitResult> {
  return new Promise((resolve) => {
    const env = { ...process.env }
    if (opts.keyPath) env.GIT_SSH_COMMAND = sshCommand(opts.keyPath)

    const child = spawn(GIT_BIN, [...IDENTITY, ...args], { cwd: opts.cwd, env })
    let stdout = ''
    let stderr = ''
    let done = false

    const finish = (ok: boolean): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ ok, stdout, stderr })
    }

    const timer = setTimeout(() => {
      stderr += `\nDélai dépassé après ${opts.timeoutMs} ms.`
      child.kill('SIGKILL')
      finish(false)
    }, opts.timeoutMs ?? PUSH_TIMEOUT_MS)

    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.stderr.on('data', (d) => (stderr += d.toString()))
    child.on('error', (err) => {
      stderr += err.message
      finish(false)
    })
    child.on('close', (code) => finish(code === 0))
  })
}

export function hasRepo(dir: string): boolean {
  return existsSync(join(dir, '.git'))
}

export async function cloneRepo(remoteUrl: string, dir: string, keyPath?: string): Promise<GitResult> {
  // cwd = parent : le dossier cible ne doit pas exister avant le clone.
  return runGit(['clone', '-q', remoteUrl, dir], { cwd: join(dir, '..'), keyPath })
}

/**
 * `committed: false` quand l'arbre est propre — ce n'est pas une erreur, c'est
 * le cas normal d'une sauvegarde déclenchée sans qu'on ait rien écrit depuis.
 */
export async function commitAll(
  dir: string,
  message: string
): Promise<{ committed: boolean; result: GitResult }> {
  const add = await runGit(['add', '-A'], { cwd: dir })
  if (!add.ok) return { committed: false, result: add }

  const status = await runGit(['status', '--porcelain'], { cwd: dir })
  if (status.ok && status.stdout.trim() === '') {
    return { committed: false, result: status }
  }

  const commit = await runGit(['commit', '-q', '-m', message], { cwd: dir })
  return { committed: commit.ok, result: commit }
}

export async function pushRepo(dir: string, keyPath?: string): Promise<GitResult> {
  return runGit(['push', '-q', 'origin', 'HEAD'], { cwd: dir, keyPath, timeoutMs: PUSH_TIMEOUT_MS })
}
```

- [ ] **Step 4: Lancer les tests pour les voir passer**

Run: `npx vitest run src/main/backup/git.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/backup/git.ts src/main/backup/git.test.ts
git commit -m "feat: enveloppe git asynchrone pour la sauvegarde"
```

---

### Task 4: Le dump SQL et l'état persisté

Deux petits modules de service dont `sync.ts` a besoin.

**Files:**
- Create: `src/main/backup/dump.ts`, `src/main/backup/state.ts`
- Test: `src/main/backup/dump.test.ts`, `src/main/backup/state.test.ts`

**Interfaces:**
- Consumes: rien
- Produces:
  - `dumpDatabase(dbPath: string, outPath: string): Promise<void>` — lève en cas d'échec
  - `SQLITE_BIN = '/usr/bin/sqlite3'`
  - `interface BackupState { lastCommitAt: string | null; lastPushAt: string | null; lastError: string | null; lastDiff: BackupDiff | null }`
  - `readState(path: string): BackupState`
  - `writeState(path: string, state: BackupState): void`
  - `EMPTY_STATE: BackupState`

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `src/main/backup/dump.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { openDb } from '../db/connection'
import { createBook } from '../db/books'
import { dumpDatabase } from './dump'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'encre-dump-'))
})

describe('dumpDatabase', () => {
  it('produit un SQL qui reconstruit la base à l\'identique', async () => {
    const dbPath = join(dir, 'library.db')
    const db = openDb(dbPath)
    createBook(db, { title: 'Le Livre' })
    db.close()

    const out = join(dir, 'library.sql')
    await dumpDatabase(dbPath, out)

    const sql = readFileSync(out, 'utf8')
    expect(sql).toContain('CREATE TABLE')
    expect(sql).toContain('Le Livre')

    // Preuve de l'aller-retour : on rejoue le dump dans une base neuve.
    const restored = join(dir, 'restored.db')
    const target = openDb(restored)
    target.close()
    const { execFileSync } = await import('child_process')
    execFileSync('/usr/bin/sqlite3', [restored], { input: sql })
    const check = openDb(restored)
    expect((check.prepare('SELECT title FROM books').get() as { title: string }).title).toBe('Le Livre')
    check.close()
  })

  it('lève si la base source n\'existe pas', async () => {
    await expect(dumpDatabase(join(dir, 'nexistepas.db'), join(dir, 'o.sql'))).rejects.toThrow()
  })
})
```

Créer `src/main/backup/state.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readState, writeState, EMPTY_STATE } from './state'

let path: string
beforeEach(() => {
  path = join(mkdtempSync(join(tmpdir(), 'encre-state-')), 'backup-state.json')
})

describe('readState / writeState', () => {
  it('rend un état vide quand le fichier n\'existe pas', () => {
    expect(readState(path)).toEqual(EMPTY_STATE)
  })

  it('rend un état vide plutôt que de lever sur un fichier corrompu', () => {
    // Un état illisible ne doit jamais empêcher l'app de démarrer : au pire on
    // reperd la date du dernier backup, jamais des données.
    writeFileSync(path, '{ pas du json')
    expect(readState(path)).toEqual(EMPTY_STATE)
  })

  it('relit ce qui a été écrit', () => {
    const state = {
      lastCommitAt: '2026-08-23T20:00:00.000Z',
      lastPushAt: null,
      lastError: 'réseau injoignable',
      lastDiff: {
        chaptersChanged: 2, chaptersAdded: 0, chaptersRemoved: 0,
        wordsDelta: 340, mediaAdded: 1, booksAdded: 0, changedTitles: ['A', 'B']
      }
    }
    writeState(path, state)
    expect(readState(path)).toEqual(state)
  })
})
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `npx vitest run src/main/backup/dump.test.ts src/main/backup/state.test.ts`
Expected: FAIL — imports `./dump` et `./state` non résolus.

- [ ] **Step 3: Écrire les deux implémentations**

Créer `src/main/backup/dump.ts` :

```ts
import { spawn } from 'child_process'
import { createWriteStream, statSync } from 'fs'

export const SQLITE_BIN = '/usr/bin/sqlite3'

/**
 * `sqlite3 <base> .dump` vers un fichier. Asynchrone pour la même raison que
 * les commandes git : ceci tourne dans le process main.
 *
 * La base passée ici est toujours un instantané figé produit par
 * `backupDatabase()`, jamais la base vivante — la consistance est donc acquise
 * avant d'arriver ici.
 */
export function dumpDatabase(dbPath: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const out = createWriteStream(outPath)
    const child = spawn(SQLITE_BIN, [dbPath, '.dump'])
    let stderr = ''

    child.stdout.pipe(out)
    child.stderr.on('data', (d) => (stderr += d.toString()))
    child.on('error', reject)

    child.on('close', (code) => {
      if (code !== 0) {
        out.end()
        reject(new Error(stderr || `sqlite3 a quitté avec le code ${code}`))
        return
      }
      // On attend 'finish' : le flux peut avoir des octets en tampon après la
      // sortie du process, et mesurer la taille avant serait une course.
      out.on('finish', () => {
        // sqlite3 sort en 0 même sur une base inexistante (il en créerait une
        // vide à la demande) : un dump vide est donc le vrai signal d'échec.
        if (statSync(outPath).size === 0) {
          reject(new Error(`Dump vide : ${dbPath} est illisible ou inexistant.`))
        } else {
          resolve()
        }
      })
      out.end()
    })
  })
}
```

Créer `src/main/backup/state.ts` :

```ts
import { readFileSync, writeFileSync } from 'fs'
import type { BackupDiff } from '../../shared/types'

export interface BackupState {
  lastCommitAt: string | null
  lastPushAt: string | null
  lastError: string | null
  lastDiff: BackupDiff | null
}

export const EMPTY_STATE: BackupState = {
  lastCommitAt: null,
  lastPushAt: null,
  lastError: null,
  lastDiff: null
}

/**
 * Ne lève jamais. Un fichier d'état corrompu doit coûter la date du dernier
 * backup, jamais le démarrage de l'app.
 */
export function readState(path: string): BackupState {
  try {
    return { ...EMPTY_STATE, ...JSON.parse(readFileSync(path, 'utf8')) }
  } catch {
    return EMPTY_STATE
  }
}

export function writeState(path: string, state: BackupState): void {
  writeFileSync(path, JSON.stringify(state, null, 2))
}
```

- [ ] **Step 4: Lancer les tests pour les voir passer**

Run: `npx vitest run src/main/backup/dump.test.ts src/main/backup/state.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/backup/dump.ts src/main/backup/dump.test.ts \
        src/main/backup/state.ts src/main/backup/state.test.ts
git commit -m "feat: dump SQL et état persisté de la sauvegarde"
```

---

### Task 5: L'orchestration

Assemble la séquence complète et expose le service que l'IPC consommera.

**Files:**
- Create: `src/main/backup/sync.ts`
- Test: `src/main/backup/sync.test.ts`

**Interfaces:**
- Consumes: `buildManifest`, `diffManifests`, `isEmptyDiff`, `type Manifest`, `type BackupDiff` (Task 2) ; `cloneRepo`, `hasRepo`, `commitAll`, `pushRepo` (Task 3) ; `dumpDatabase` (Task 4) ; `readState`, `writeState`, `type BackupState` (Task 4) ; `backupDatabase` (Task 1)
- Produces:
  - `interface BackupPaths { repoDir: string; mediaDir: string; backupsDir: string; keyPath: string; statePath: string; remoteUrl: string }`
  - `interface BackupService { status(): Promise<BackupStatus>; runNow(): Promise<BackupStatus> }`
  - `BackupStatus` vient de `src/shared/types.ts` (Task 2), pas d'ici
  - `createBackupService(db: Db, paths: BackupPaths): BackupService`
  - `commitMessage(now: Date, diff: BackupDiff): string`

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `src/main/backup/sync.test.ts` :

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { openDb, type Db } from '../db/connection'
import { createBook } from '../db/books'
import { createChapter } from '../db/chapters'
import { GIT_BIN, runGit } from './git'
import { createBackupService, commitMessage, type BackupPaths } from './sync'

let dir: string
let db: Db
let dbPath: string
let paths: BackupPaths

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'encre-sync-'))
  const remote = join(dir, 'remote.git')
  execFileSync(GIT_BIN, ['init', '--bare', '-q', '-b', 'main', remote])

  dbPath = join(dir, 'library.db')
  db = openDb(dbPath)
  const book = createBook(db, { title: 'Livre' })
  createChapter(db, book.id, 'Ch. 1')

  const mediaDir = join(dir, 'media')
  mkdirSync(mediaDir)
  writeFileSync(join(mediaDir, 'photo.png'), 'octets')

  paths = {
    repoDir: join(dir, 'backup-repo'),
    mediaDir,
    backupsDir: join(dir, 'backups'),
    keyPath: join(dir, 'pas-de-cle'),
    statePath: join(dir, 'backup-state.json'),
    remoteUrl: remote
  }
})

describe('commitMessage', () => {
  it('résume le diff dans le message', () => {
    const msg = commitMessage(new Date('2026-08-23T20:15:00Z'), {
      chaptersChanged: 3, chaptersAdded: 0, chaptersRemoved: 0,
      wordsDelta: 1240, mediaAdded: 0, booksAdded: 0, changedTitles: []
    })
    expect(msg).toContain('3 chapitres')
    expect(msg).toContain('+1 240 mots')
  })

  it('mentionne les images quand il y en a', () => {
    const msg = commitMessage(new Date('2026-08-23T20:15:00Z'), {
      chaptersChanged: 0, chaptersAdded: 0, chaptersRemoved: 0,
      wordsDelta: 0, mediaAdded: 2, booksAdded: 0, changedTitles: []
    })
    expect(msg).toContain('2 images')
  })
})

describe('createBackupService — séquence nominale', () => {
  it('clone, dumpe, copie les médias, commite et pousse', async () => {
    const svc = createBackupService(db, paths)
    const status = await svc.runNow()

    expect(status.lastCommitAt).not.toBeNull()
    expect(status.lastPushAt).not.toBeNull()
    expect(status.lastError).toBeNull()

    expect(existsSync(join(paths.repoDir, 'library.sql'))).toBe(true)
    expect(existsSync(join(paths.repoDir, 'media', 'photo.png'))).toBe(true)

    const manifest = JSON.parse(readFileSync(join(paths.repoDir, 'manifest.json'), 'utf8'))
    expect(manifest.counts.chapters).toBe(1)
    expect(manifest.media).toEqual(['photo.png'])

    // Le commit est bien arrivé sur le remote.
    const log = await runGit(['log', '-1', '--format=%s'], { cwd: paths.remoteUrl })
    expect(log.stdout).toContain('sauvegarde')
  })

  it('après une sauvegarde, le diff en attente est vide', async () => {
    const svc = createBackupService(db, paths)
    await svc.runNow()
    const status = await svc.status()
    expect(status.pending.chaptersChanged).toBe(0)
    expect(status.pending.chaptersAdded).toBe(0)
    expect(status.pending.mediaAdded).toBe(0)
  })

  it('signale le travail fait depuis la dernière sauvegarde', async () => {
    const svc = createBackupService(db, paths)
    await svc.runNow()

    const ch = createChapter(db, 1, 'Ch. 2')
    db.prepare('UPDATE chapters SET content_json = ?, word_count = ? WHERE id = ?')
      .run('{"nouveau":1}', 300, ch.id)
    writeFileSync(join(paths.mediaDir, 'autre.png'), 'octets')

    const status = await svc.status()
    expect(status.pending.chaptersAdded).toBe(1)
    expect(status.pending.wordsDelta).toBe(300)
    expect(status.pending.mediaAdded).toBe(1)
    expect(status.pending.changedTitles).toEqual(['Ch. 2'])
  })

  it('ne copie pas deux fois un média déjà présent', async () => {
    const svc = createBackupService(db, paths)
    await svc.runNow()
    const before = readFileSync(join(paths.repoDir, 'media', 'photo.png'), 'utf8')
    await svc.runNow()
    expect(readFileSync(join(paths.repoDir, 'media', 'photo.png'), 'utf8')).toBe(before)
  })

  it('garde dans le dépôt un média supprimé de la bibliothèque', async () => {
    const svc = createBackupService(db, paths)
    await svc.runNow()
    const { unlinkSync } = await import('fs')
    unlinkSync(join(paths.mediaDir, 'photo.png'))
    await svc.runNow()
    // Délibéré : une sauvegarde qui réplique les suppressions ne protège pas
    // d'une suppression accidentelle.
    expect(existsSync(join(paths.repoDir, 'media', 'photo.png'))).toBe(true)
  })
})

describe('createBackupService — chemins d\'échec', () => {
  it('garde le commit local quand le push échoue', async () => {
    const svc = createBackupService(db, paths)
    await svc.runNow()
    await runGit(['remote', 'set-url', 'origin', join(dir, 'disparu.git')], { cwd: paths.repoDir })

    createChapter(db, 1, 'Ch. 2')
    const status = await svc.runNow()

    expect(status.lastCommitAt).not.toBeNull()
    expect(status.lastError).not.toBeNull()
    // lastPushAt reste sur la date du push réussi précédent, il ne recule pas.
    const log = await runGit(['log', '-1', '--format=%s'], { cwd: paths.repoDir })
    expect(log.stdout).toContain('sauvegarde')
  })

  it('rejette un second runNow pendant qu\'une sauvegarde tourne', async () => {
    const svc = createBackupService(db, paths)
    const first = svc.runNow()
    await expect(svc.runNow()).rejects.toThrow(/en cours/)
    await first
  })

  it('status() sans dépôt ni sauvegarde rend configured=false sans lever', async () => {
    const svc = createBackupService(db, paths)
    const status = await svc.status()
    expect(status.configured).toBe(false)
    expect(status.lastCommitAt).toBeNull()
    // Le diff en attente est calculable même sans dépôt : tout est « à sauvegarder ».
    expect(status.pending.chaptersAdded).toBe(1)
    // git et sqlite3 sont présents sur la machine de test comme en production.
    expect(status.missingBinary).toBeNull()
  })
})
```

- [ ] **Step 2: Lancer les tests pour les voir échouer**

Run: `npx vitest run src/main/backup/sync.test.ts`
Expected: FAIL — `Failed to resolve import "./sync"`.

- [ ] **Step 3: Écrire l'implémentation**

Créer `src/main/backup/sync.ts` :

```ts
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Db } from '../db/connection'
import type { BackupDiff, BackupStatus } from '../../shared/types'
import { backupDatabase } from './local'
import { buildManifest, diffManifests, type Manifest } from './manifest'
import { cloneRepo, commitAll, hasRepo, pushRepo, GIT_BIN } from './git'
import { dumpDatabase, SQLITE_BIN } from './dump'
import { readState, writeState, type BackupState } from './state'

export interface BackupPaths {
  repoDir: string
  mediaDir: string
  backupsDir: string
  keyPath: string
  statePath: string
  remoteUrl: string
}

export interface BackupService {
  status(): Promise<BackupStatus>
  runNow(): Promise<BackupStatus>
}

const nf = new Intl.NumberFormat('fr-FR')

export function commitMessage(now: Date, diff: BackupDiff): string {
  const stamp = now.toISOString().slice(0, 16).replace('T', ' ')
  const parts: string[] = []
  const chapters = diff.chaptersChanged + diff.chaptersAdded + diff.chaptersRemoved
  if (chapters > 0) parts.push(`${chapters} chapitre${chapters > 1 ? 's' : ''}`)
  if (diff.wordsDelta !== 0) {
    parts.push(`${diff.wordsDelta > 0 ? '+' : '−'}${nf.format(Math.abs(diff.wordsDelta))} mots`)
  }
  if (diff.mediaAdded > 0) parts.push(`${diff.mediaAdded} image${diff.mediaAdded > 1 ? 's' : ''}`)
  return parts.length > 0 ? `sauvegarde ${stamp} — ${parts.join(', ')}` : `sauvegarde ${stamp}`
}

/** Manifeste de la dernière sauvegarde, ou null si le dépôt n'en a pas encore. */
function repoManifest(repoDir: string): Manifest | null {
  try {
    return JSON.parse(readFileSync(join(repoDir, 'manifest.json'), 'utf8')) as Manifest
  } catch {
    return null
  }
}

/**
 * Copie les fichiers absents du dépôt, en clone APFS : `COPYFILE_FICLONE`
 * partage les blocs au lieu de les dupliquer, donc la copie de travail ne
 * coûte quasiment aucun octet. Retombe sur une copie normale si le système de
 * fichiers ne sait pas cloner.
 *
 * N'efface jamais : un média retiré de la bibliothèque reste dans la
 * sauvegarde, c'est tout l'intérêt d'une sauvegarde.
 */
function syncMedia(mediaDir: string, repoMediaDir: string): void {
  mkdirSync(repoMediaDir, { recursive: true })
  let files: string[] = []
  try {
    files = readdirSync(mediaDir)
  } catch {
    return
  }
  for (const f of files) {
    const dest = join(repoMediaDir, f)
    if (existsSync(dest)) continue
    copyFileSync(join(mediaDir, f), dest, constants.COPYFILE_FICLONE)
  }
}

export function createBackupService(db: Db, paths: BackupPaths): BackupService {
  let running = false

  const currentManifest = (now: Date): Manifest => buildManifest(db, paths.mediaDir, now)

  // Spec §4 : git et sqlite3 vivent dans /usr/bin, présent dans le PATH minimal
  // d'une app lancée depuis le Finder. On vérifie quand même : un message clair
  // vaut mieux qu'un échec de spawn incompréhensible pour l'utilisateur.
  const missingBinary = (): string | null => {
    if (!existsSync(GIT_BIN)) return GIT_BIN
    if (!existsSync(SQLITE_BIN)) return SQLITE_BIN
    return null
  }

  const buildStatus = (state: BackupState, now: Date): BackupStatus => ({
    configured: hasRepo(paths.repoDir) && existsSync(paths.keyPath),
    running,
    missingBinary: missingBinary(),
    lastCommitAt: state.lastCommitAt,
    lastPushAt: state.lastPushAt,
    lastError: state.lastError,
    pending: diffManifests(repoManifest(paths.repoDir), currentManifest(now)),
    lastDiff: state.lastDiff
  })

  return {
    async status() {
      return buildStatus(readState(paths.statePath), new Date())
    },

    async runNow() {
      // Verrou et non file d'attente : deux sauvegardes simultanées se
      // marcheraient dessus dans le même dossier de travail.
      if (running) throw new Error('Une sauvegarde est déjà en cours.')
      running = true
      const now = new Date()
      const state = readState(paths.statePath)

      try {
        const missing = missingBinary()
        if (missing) throw new Error(`Binaire introuvable : ${missing}`)

        if (!hasRepo(paths.repoDir)) {
          mkdirSync(join(paths.repoDir, '..'), { recursive: true })
          const cloned = await cloneRepo(paths.remoteUrl, paths.repoDir, paths.keyPath)
          if (!cloned.ok) throw new Error(`Clone impossible : ${cloned.stderr.trim()}`)
        }

        // Instantané frais, jamais le fichier de la veille : sans ça un
        // « Sauvegarder maintenant » enverrait l'état d'hier.
        const snapshot = await backupDatabase(db, paths.backupsDir, now)
        await dumpDatabase(snapshot, join(paths.repoDir, 'library.sql'))

        syncMedia(paths.mediaDir, join(paths.repoDir, 'media'))

        const previous = repoManifest(paths.repoDir)
        const next = currentManifest(now)
        const diff = diffManifests(previous, next)
        writeFileSync(join(paths.repoDir, 'manifest.json'), JSON.stringify(next, null, 2))

        const { committed } = await commitAll(paths.repoDir, commitMessage(now, diff))
        if (committed) {
          state.lastCommitAt = now.toISOString()
          state.lastDiff = diff
        }

        const pushed = await pushRepo(paths.repoDir, paths.keyPath)
        if (pushed.ok) {
          state.lastPushAt = now.toISOString()
          state.lastError = null
        } else {
          // Demi-victoire : le commit local tient, le travail est figé. On le
          // dit sans effacer lastCommitAt ni faire reculer lastPushAt.
          state.lastError = `Envoi impossible : ${pushed.stderr.trim().split('\n').pop() ?? 'erreur inconnue'}`
        }
      } catch (err) {
        state.lastError = err instanceof Error ? err.message : String(err)
      } finally {
        writeState(paths.statePath, state)
        running = false
      }

      return buildStatus(state, new Date())
    }
  }
}
```

- [ ] **Step 4: Lancer les tests pour les voir passer**

Run: `npx vitest run src/main/backup/sync.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Vérifier que rien d'autre n'a bougé**

Run: `npm test`
Expected: tous les tests au vert.

- [ ] **Step 6: Commit**

```bash
git add src/main/backup/sync.ts src/main/backup/sync.test.ts
git commit -m "feat: orchestration de la sauvegarde git"
```

---

### Task 6: Câblage IPC

Expose `status` et `runNow` au renderer, et branche le déclenchement quotidien.

**Files:**
- Modify: `src/shared/ipc-contract.ts` (ajout du domaine `backup`)
- Modify: `src/preload/index.ts` (ajout du domaine `backup`)
- Modify: `src/main/api.ts` (option `backup`, domaine `backup`)
- Modify: `src/main/index.ts` (construction du service, déclenchement quotidien)
- Test: `src/main/api.test.ts` (ajout d'un bloc `describe`)

**Interfaces:**
- Consumes: `createBackupService`, `type BackupService`, `type BackupStatus` (Task 5)
- Produces: `window.api.backup.status()`, `window.api.backup.runNow()` côté renderer

- [ ] **Step 1: Écrire le test qui échoue**

Ajouter à la fin de `src/main/api.test.ts` :

```ts
describe('domaine backup', () => {
  it('délègue status et runNow au service injecté', async () => {
    const fake = {
      status: vi.fn(async () => ({ configured: true } as never)),
      runNow: vi.fn(async () => ({ configured: true } as never))
    }
    const api = createApi(openDb(':memory:'), { backup: fake })
    await api.backup.status()
    await api.backup.runNow()
    expect(fake.status).toHaveBeenCalledTimes(1)
    expect(fake.runNow).toHaveBeenCalledTimes(1)
  })

  it('rend configured=false sans service injecté, au lieu de lever', async () => {
    const api = createApi(openDb(':memory:'))
    const status = await api.backup.status()
    expect(status.configured).toBe(false)
    expect(status.lastCommitAt).toBeNull()
  })

  it('runNow sans service injecté lève un message explicite', async () => {
    const api = createApi(openDb(':memory:'))
    await expect(api.backup.runNow()).rejects.toThrow(/pas configurée/)
  })
})
```

Vérifier que `vi` est bien dans l'import vitest en tête du fichier ; l'ajouter
sinon (`import { describe, it, expect, vi } from 'vitest'`).

- [ ] **Step 2: Lancer le test pour le voir échouer**

Run: `npx vitest run src/main/api.test.ts -t "domaine backup"`
Expected: FAIL — `api.backup` est `undefined`.

- [ ] **Step 3: Ajouter le contrat**

Dans `src/shared/ipc-contract.ts`, ajouter `BackupStatus` à la liste des types
importés depuis `./types` (elle y a été définie en Task 2 — `shared/` ne
dépend jamais de `main/`), puis le domaine après `series` :

```ts
  backup: {
    /** Lit l'état sur disque et calcule le diff en attente. Ne touche jamais au réseau. */
    status(): Promise<BackupStatus>
    /** Force une sauvegarde. Rejette si une sauvegarde est déjà en cours. */
    runNow(): Promise<BackupStatus>
  }
```

- [ ] **Step 4: Ajouter le domaine au preload**

Dans `src/preload/index.ts`, après le domaine `series` :

```ts
  backup: {
    status: () => ipcRenderer.invoke('backup:status'),
    runNow: () => ipcRenderer.invoke('backup:runNow')
  }
```

- [ ] **Step 5: Ajouter le domaine à l'api**

Dans `src/main/api.ts`, ajouter `backup?: BackupService` à `CreateApiOptions`,
importer le type, et ajouter le domaine après `series` :

```ts
    backup: {
      // Sans service injecté (tests, ou bootstrap pas encore fait), on rend un
      // état inerte plutôt que de lever : l'UI doit pouvoir s'afficher et dire
      // « non configurée » sans traitement d'erreur particulier.
      status: async () =>
        options.backup?.status() ??
        ({
          configured: false, running: false, missingBinary: null,
          lastCommitAt: null, lastPushAt: null, lastError: null,
          pending: {
            chaptersChanged: 0, chaptersAdded: 0, chaptersRemoved: 0,
            wordsDelta: 0, mediaAdded: 0, booksAdded: 0, changedTitles: []
          },
          lastDiff: null
        } as BackupStatus),
      runNow: async () => {
        if (!options.backup) throw new Error('La sauvegarde n\'est pas configurée sur cette machine.')
        return options.backup.runNow()
      }
    }
```

- [ ] **Step 6: Lancer le test pour le voir passer**

Run: `npx vitest run src/main/api.test.ts -t "domaine backup"`
Expected: PASS, 3 tests.

- [ ] **Step 7: Brancher dans index.ts**

Dans `src/main/index.ts`, construire le service et l'injecter. Remplacer
`registerIpc(createApi(db))` (ligne 157) par :

```ts
  const backupService = createBackupService(db, {
    repoDir: join(app.getPath('userData'), 'backup-repo'),
    mediaDir: join(app.getPath('userData'), 'media'),
    backupsDir,
    keyPath: join(app.getPath('userData'), 'backup-key'),
    statePath: join(app.getPath('userData'), 'backup-state.json'),
    remoteUrl: 'git@github.com:Grazulex/encre_backup.git'
  })

  registerIpc(createApi(db, { backup: backupService }))
```

Puis étendre `performBackup` (ligne ~121) pour enchaîner la sauvegarde
distante après le backup local, sans jamais faire planter le main :

```ts
      if (shouldBackup(backupsDir, new Date())) {
        backupDatabase(db, backupsDir, new Date())
          .then((path) => {
            console.log(`Backup créé: ${path}`)
            pruneBackups(backupsDir, new Date())
            // Sauvegarde distante : même tranche de 24 h que le backup local.
            // Le service enregistre lui-même ses erreurs dans son état ; on ne
            // laisse jamais un échec réseau remonter jusqu'ici.
            return backupService.runNow().catch((err) => console.error(err))
          })
          .catch(console.error)
      }
```

- [ ] **Step 8: Vérifier**

Run: `npm run typecheck && npm test`
Expected: typecheck propre, tous les tests au vert.

- [ ] **Step 9: Commit**

```bash
git add src/shared/ipc-contract.ts src/preload/index.ts src/main/api.ts \
        src/main/api.test.ts src/main/index.ts
git commit -m "feat: expose la sauvegarde au renderer et la déclenche quotidiennement"
```

---

### Task 7: Le store et le bloc sur la Bibliothèque

**Files:**
- Create: `src/renderer/src/stores/backup.ts`
- Create: `src/renderer/src/components/BackupPanel.vue`
- Modify: `src/renderer/src/views/LibraryView.vue`

**Interfaces:**
- Consumes: `window.api.backup.status()`, `window.api.backup.runNow()` (Task 6)
- Produces: `useBackupStore()` avec `state.status`, `state.busy`, `refresh()`,
  `runNow()`, `startPolling()`, `stopPolling()`

- [ ] **Step 1: Écrire le store**

Créer `src/renderer/src/stores/backup.ts` :

```ts
import { defineStore } from 'pinia'
import type { BackupStatus } from '../../../shared/types'

/** Un seul store pour les deux vues : la Bibliothèque et la barre d'état. */
export const useBackupStore = defineStore('backup', {
  state: () => ({
    status: null as BackupStatus | null,
    busy: false,
    error: null as string | null,
    timer: null as ReturnType<typeof setInterval> | null
  }),
  actions: {
    async refresh() {
      try {
        this.status = await window.api.backup.status()
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err)
      }
    },
    async runNow() {
      if (this.busy) return
      this.busy = true
      this.error = null
      try {
        this.status = await window.api.backup.runNow()
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err)
      } finally {
        this.busy = false
      }
    },
    startPolling() {
      if (this.timer) return
      void this.refresh()
      // 60 s : le calcul coûte un SHA-1 sur ~5 Mo, invisible à ce rythme.
      this.timer = setInterval(() => void this.refresh(), 60_000)
    },
    stopPolling() {
      if (this.timer) clearInterval(this.timer)
      this.timer = null
    }
  }
})
```

- [ ] **Step 2: Écrire le composant**

Créer `src/renderer/src/components/BackupPanel.vue` :

```vue
<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useBackupStore } from '../stores/backup'

const store = useBackupStore()
onMounted(() => store.startPolling())
onUnmounted(() => store.stopPolling())

const nf = new Intl.NumberFormat('fr-FR')

function relative(iso: string | null): string {
  if (!iso) return 'jamais'
  const d = new Date(iso)
  const today = new Date().toDateString() === d.toDateString()
  const heure = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  return today ? `aujourd'hui à ${heure}` : `${d.toLocaleDateString('fr-FR')} à ${heure}`
}

function summarize(d: { chaptersChanged: number; chaptersAdded: number; chaptersRemoved: number; wordsDelta: number; mediaAdded: number }): string {
  const parts: string[] = []
  const ch = d.chaptersChanged + d.chaptersAdded + d.chaptersRemoved
  if (ch > 0) parts.push(`${ch} chapitre${ch > 1 ? 's' : ''}`)
  if (d.wordsDelta !== 0) parts.push(`${d.wordsDelta > 0 ? '+' : '−'}${nf.format(Math.abs(d.wordsDelta))} mots`)
  if (d.mediaAdded > 0) parts.push(`${d.mediaAdded} image${d.mediaAdded > 1 ? 's' : ''}`)
  return parts.join(', ')
}

const pendingLabel = computed(() => {
  const p = store.status?.pending
  if (!p) return ''
  const s = summarize(p)
  return s === '' ? 'Tout est sauvegardé' : `En attente : ${s}`
})

const lastLabel = computed(() => {
  const s = store.status
  if (!s) return 'Chargement…'
  if (!s.lastCommitAt) return 'Jamais sauvegardé'
  const base = `Sauvegardé ${relative(s.lastPushAt ?? s.lastCommitAt)}`
  return s.lastDiff ? `${base} · ${summarize(s.lastDiff)}` : base
})

// Un commit local sans push n'est pas un échec : le travail est figé, il n'est
// simplement pas encore parti. On le distingue visuellement d'une vraie panne.
const pendingPush = computed(
  () => store.status != null && store.status.lastError != null && store.status.lastCommitAt != null
)
</script>

<template>
  <section v-if="store.status" class="backup">
    <div class="line">
      <span class="pastille" :class="{ warn: pendingPush, off: !store.status.configured }" />
      <strong>{{ lastLabel }}</strong>
    </div>
    <p v-if="store.status.missingBinary" class="warn-text">
      Binaire introuvable : {{ store.status.missingBinary }} — la sauvegarde ne peut pas fonctionner.
    </p>
    <p v-else-if="!store.status.configured" class="muted">
      Sauvegarde non configurée sur cette machine — voir RESTAURATION.md dans le dépôt encre_backup.
    </p>
    <template v-else>
      <p class="muted">{{ pendingLabel }}</p>
      <p v-if="store.status.lastError" class="warn-text">{{ store.status.lastError }}</p>
      <p v-if="store.error" class="warn-text">{{ store.error }}</p>
      <button type="button" :disabled="store.busy" @click="store.runNow()">
        {{ store.busy ? 'Sauvegarde en cours…' : 'Sauvegarder maintenant' }}
      </button>
    </template>
  </section>
</template>

<style scoped>
/* Variables du thème (src/renderer/src/styles) : --accent, --danger, --fg-muted.
   Il n'existe ni --ok ni --warn — ne pas en inventer. */
.backup { display: flex; flex-direction: column; gap: 0.35rem; }
.line { display: flex; align-items: center; gap: 0.5rem; }
.pastille { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); }
.pastille.warn { background: var(--danger); }
.pastille.off { background: var(--fg-muted); }
.muted { color: var(--fg-muted); margin: 0; }
.warn-text { color: var(--danger); margin: 0; }
</style>
```

- [ ] **Step 3: L'insérer dans la Bibliothèque**

Dans `src/renderer/src/views/LibraryView.vue`, importer le composant et le
placer sous le `<header>` :

```vue
import BackupPanel from '../components/BackupPanel.vue'
```

```vue
    </header>
    <BackupPanel />
```

- [ ] **Step 4: Vérifier**

Run: `npm run typecheck && npm test`
Expected: propre et vert.

Puis lancer l'app (`npm run dev`) et vérifier de visu que le bloc s'affiche sur
la Bibliothèque avec « Sauvegarde non configurée » (le bootstrap n'a pas encore
eu lieu à ce stade du plan).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/stores/backup.ts \
        src/renderer/src/components/BackupPanel.vue \
        src/renderer/src/views/LibraryView.vue
git commit -m "feat: bloc d'état de sauvegarde sur la Bibliothèque"
```

---

### Task 8: Le voyant dans la barre d'état

**Files:**
- Modify: `src/renderer/src/components/StatusBar.vue`

**Interfaces:**
- Consumes: `useBackupStore()` (Task 7)
- Produces: rien

- [ ] **Step 1: Ajouter le voyant**

Dans `src/renderer/src/components/StatusBar.vue`, ajouter au `<script setup>` :

```ts
import { onMounted, onUnmounted } from 'vue'
import { useBackupStore } from '../stores/backup'
import { useRouter } from 'vue-router'

const backup = useBackupStore()
const router = useRouter()
onMounted(() => backup.startPolling())
onUnmounted(() => backup.stopPolling())

const backupLabel = computed(() => {
  const p = backup.status?.pending
  if (!p) return null
  const ch = p.chaptersChanged + p.chaptersAdded + p.chaptersRemoved
  if (ch === 0 && p.mediaAdded === 0) return 'Sauvegardé'
  return `${ch || p.mediaAdded} en attente`
})
</script>
```

Et dans le `<template>`, juste avant `<span class="spacer" />` :

```vue
    <span class="dot">·</span>
    <button v-if="backupLabel" type="button" class="backup-link" @click="router.push('/')">
      {{ backupLabel }}
    </button>
```

Avec le style, aligné sur `.save-state` existant :

```css
.backup-link {
  background: none;
  border: 0;
  padding: 0;
  font: inherit;
  color: var(--fg-muted);
  cursor: pointer;
}
```

La route de la Bibliothèque est bien `'/'` (`src/renderer/src/router.ts:8`).

- [ ] **Step 2: Vérifier**

Run: `npm run typecheck && npm test`
Expected: propre et vert.

Puis `npm run dev`, ouvrir un livre, et vérifier que le voyant apparaît dans la
barre du bas et ramène à la Bibliothèque au clic.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/StatusBar.vue
git commit -m "feat: voyant de sauvegarde dans la barre d'état"
```

---

### Task 9: Bootstrap réel et procédure de restauration

Le seul travail hors code : créer la clé, l'enregistrer sur GitHub, faire le
premier push des 710 Mo, puis prouver que la restauration fonctionne.

**Files:**
- Create: `RESTAURATION.md` (à la racine du dépôt `encre_backup`, pas du dépôt `encre`)

**Interfaces:**
- Consumes: tout ce qui précède
- Produces: un dépôt `encre_backup` peuplé, une clé de déploiement active

- [ ] **Step 1: Générer la clé de déploiement**

```bash
ssh-keygen -t ed25519 -N '' -C 'encre-backup' \
  -f "$HOME/Library/Application Support/encre/backup-key"
chmod 600 "$HOME/Library/Application Support/encre/backup-key"
```

- [ ] **Step 2: L'enregistrer sur GitHub en écriture**

```bash
gh api -X POST repos/Grazulex/encre_backup/keys \
  -f title='Encre (sauvegarde automatique)' \
  -f key="$(cat "$HOME/Library/Application Support/encre/backup-key.pub")" \
  -F read_only=false
```

Vérifier : `gh api repos/Grazulex/encre_backup/keys --jq '.[].title'`

- [ ] **Step 3: Vérifier que la clé pousse bien**

```bash
GIT_SSH_COMMAND="ssh -i '$HOME/Library/Application Support/encre/backup-key' -o IdentitiesOnly=yes -o BatchMode=yes" \
  git ls-remote git@github.com:Grazulex/encre_backup.git
```

Expected: sortie vide (dépôt vide) et code de retour 0 — pas d'erreur
d'authentification.

- [ ] **Step 4: Premier push, par le code lui-même**

Lancer l'app, ouvrir la Bibliothèque, cliquer « Sauvegarder maintenant ».
C'est le meilleur test possible : le premier import valide le code réel contre
le vrai remote. Surveiller la progression côté disque :

```bash
du -sh "$HOME/Library/Application Support/encre/backup-repo/.git"
```

Expected: le bloc passe à « Sauvegardé aujourd'hui à HH:MM », et
`gh api repos/Grazulex/encre_backup/commits --jq '.[0].commit.message'` renvoie
le message de sauvegarde.

- [ ] **Step 5: Écrire et vérifier la procédure de restauration**

Créer `RESTAURATION.md` dans la copie de travail
(`~/Library/Application Support/encre/backup-repo/`) :

```markdown
# Restaurer une bibliothèque Encre

Trois temps. Rien d'autre n'est nécessaire : ce dépôt se suffit à lui-même.

## 1. Récupérer la sauvegarde

    git clone git@github.com:Grazulex/encre_backup.git ~/encre-restauration
    cd ~/encre-restauration

Pour revenir à un état antérieur plutôt qu'au dernier :

    git log --oneline          # repérer la date voulue
    git checkout <sha>

## 2. Reconstruire la base

    sqlite3 library.db < library.sql

## 3. Remettre en place

Fermer Encre, puis :

    DEST=~/Library/Application\ Support/encre
    mv "$DEST/library.db" "$DEST/library.db.avant-restauration"
    cp library.db "$DEST/library.db"
    cp -R media/ "$DEST/media/"

Relancer Encre. L'ancienne base reste à côté sous
`library.db.avant-restauration` — ne la supprimer qu'une fois la restauration
vérifiée.
```

- [ ] **Step 6: Prouver que la procédure marche**

Sur une copie, jamais sur les données vivantes :

```bash
cd /tmp && rm -rf verif-restauration
git clone ~/Library/Application\ Support/encre/backup-repo verif-restauration
cd verif-restauration
sqlite3 library.db < library.sql
sqlite3 library.db "select (select count(*) from books)||' livres, '||(select count(*) from chapters)||' chapitres'; pragma integrity_check;"
ls media | wc -l
```

Expected: mêmes comptes que la bibliothèque vivante, `integrity_check` à `ok`,
même nombre de médias.

- [ ] **Step 7: Commiter la procédure dans le dépôt de sauvegarde**

```bash
cd ~/Library/Application\ Support/encre/backup-repo
git -c commit.gpgsign=false -c user.name=Encre -c user.email=jms@grazulex.be \
    add RESTAURATION.md && \
git -c commit.gpgsign=false -c user.name=Encre -c user.email=jms@grazulex.be \
    commit -m "docs: procédure de restauration" && git push
```

- [ ] **Step 8: Commit final côté dépôt encre**

Marquer le plan comme exécuté :

```bash
cd ~/Dev/encre
git add docs/superpowers/plans/2026-08-23-backup-git.md
git commit -m "docs: plan de sauvegarde git exécuté"
```
