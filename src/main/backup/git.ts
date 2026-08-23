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
