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

  it('tue la commande et le dit quand le délai est dépassé', async () => {
    // `git hash-object --stdin` attend EOF sur son entrée standard, que runGit
    // ne ferme jamais : blocage déterministe, sans dépendre du réseau.
    const r = await runGit(['hash-object', '--stdin'], { cwd: dir, timeoutMs: 300 })
    expect(r.ok).toBe(false)
    expect(r.stderr).toContain('Délai dépassé après 300 ms.')
  })

  it('ne laisse pas de dossier derrière un clone raté', async () => {
    const r = await cloneRepo(join(dir, 'vide.git'), join(dir, 'rate'))
    expect(r.ok).toBe(false)
    expect(existsSync(join(dir, 'rate', '.git'))).toBe(false)
  })
})
