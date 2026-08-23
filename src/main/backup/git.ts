import { spawn } from 'child_process'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'

export const GIT_BIN = '/usr/bin/git'

/**
 * Délai de garde par défaut, dimensionné pour les commandes **locales**
 * (`add`, `status`, `commit`, `show`) : aucune d'elles ne dure deux minutes.
 * Ne porte pas le mot « push » : un nom de constante réseau appliqué par
 * défaut à tout ferait tuer le clone initial (voir CLONE_TIMEOUT_MS).
 */
export const LOCAL_TIMEOUT_MS = 120_000

/** Délai de garde du push : un réseau qui pend ne doit pas bloquer l'état. */
export const PUSH_TIMEOUT_MS = 120_000

/**
 * Le clone initial rapatrie ~710 Mo de médias (spec §1) : sur une liaison
 * ordinaire il dépasse de loin les deux minutes du push. Il lui faut donc son
 * propre délai, assez large pour ne jamais couper un clone qui progresse, et
 * assez fini pour qu'une liaison morte finisse par rendre la main.
 */
export const CLONE_TIMEOUT_MS = 4 * 60 * 60 * 1000

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

    const timeoutMs = opts.timeoutMs ?? LOCAL_TIMEOUT_MS
    const timer = setTimeout(() => {
      stderr += `\nDélai dépassé après ${timeoutMs} ms.`
      child.kill('SIGKILL')
      finish(false)
    }, timeoutMs)

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
  const result = await runGit(['clone', '-q', remoteUrl, dir], {
    cwd: join(dir, '..'),
    keyPath,
    timeoutMs: CLONE_TIMEOUT_MS
  })

  // git nettoie derrière lui quand il échoue de lui-même, mais pas quand on le
  // tue (SIGKILL du délai dépassé, arrêt de la machine) : le dossier survit
  // avec un `.git` et un HEAD non né. `hasRepo()` rendrait vrai à jamais, plus
  // aucun clone ne serait retenté, et chaque sauvegarde suivante commiterait un
  // commit racine que le distant refuserait — définitivement.
  if (!result.ok) rmSync(dir, { recursive: true, force: true })

  return result
}

/**
 * Lignes de `git status --porcelain` qui décrivent une suppression, en scène
 * (colonne 1) ou dans l'arbre de travail (colonne 2).
 */
function deletedPaths(porcelain: string): string[] {
  return porcelain
    .split('\n')
    .filter((l) => l.length > 3 && (l[0] === 'D' || l[1] === 'D'))
    .map((l) => l.slice(3))
}

/**
 * `committed: false` quand l'arbre est propre — ce n'est pas une erreur, c'est
 * le cas normal d'une sauvegarde déclenchée sans qu'on ait rien écrit depuis.
 *
 * Refuse en revanche de commiter la moindre suppression. C'est l'invariant de
 * la sauvegarde : rien n'en sort jamais. Un arbre de travail amputé (clone
 * interrompu, dossier vidé à la main pour récupérer de l'espace) ferait sinon
 * mettre en scène des suppressions par `git add -A`, qui se commiteraient et se
 * pousseraient proprement — élaguant le dépôt distant en silence, c'est-à-dire
 * détruisant la sauvegarde au nom de la sauvegarde.
 */
export async function commitAll(
  dir: string,
  message: string
): Promise<{ committed: boolean; result: GitResult }> {
  // Avant `add -A`, pour ne pas laisser d'index empoisonné derrière un refus.
  const before = await runGit(['status', '--porcelain'], { cwd: dir })
  if (before.ok) {
    const deleted = deletedPaths(before.stdout)
    if (deleted.length > 0) {
      const shown = deleted.slice(0, 5).join(', ')
      const reste = deleted.length > 5 ? ` (et ${deleted.length - 5} autres)` : ''
      return {
        committed: false,
        result: {
          ok: false,
          stdout: before.stdout,
          stderr: `Suppressions détectées dans le dépôt de sauvegarde, commit refusé : ${shown}${reste}`
        }
      }
    }
  }

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
