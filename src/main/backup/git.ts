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

/**
 * Délai de garde du push. Il valait deux minutes, dimensionné comme s'il ne
 * transportait qu'un dump SQL — alors qu'il pousse les mêmes médias que le
 * clone rapatrie. Mesure faite sur le dépôt réel : 80 Mo à ~750 Ko/s, soit
 * 105,8 s. La marge était de quatorze secondes, et le lot suivant aurait fait
 * que l'app tuerait son propre envoi au SIGKILL — en affichant une erreur
 * réseau dont le réseau n'est pas responsable.
 *
 * Une heure, donc : assez pour ne jamais couper un envoi qui progresse, et
 * fini pour qu'un blocage rende un jour la main. Reste sous CLONE_TIMEOUT_MS,
 * qui rapatrie tout l'historique là où le push n'envoie qu'un lot.
 *
 * Ce délai n'est plus le premier rempart contre une liaison morte : les sondes
 * de vivacité armées par `sshCommand` la font tomber en moins d'une minute,
 * assez tôt pour qu'une reprise ait lieu.
 */
export const PUSH_TIMEOUT_MS = 60 * 60 * 1000

/** Nombre d'essais d'envoi : le premier, plus les reprises. */
export const PUSH_ATTEMPTS = 3

/**
 * Attente avant chaque reprise (une de moins que PUSH_ATTEMPTS). Croissante :
 * une coupure isolée passe au coup suivant, une micro-panne de quelques
 * dizaines de secondes laisse le temps au lien de revenir.
 */
export const PUSH_RETRY_DELAYS_MS = [5_000, 20_000]

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
  '-c',
  'commit.gpgsign=false',
  '-c',
  'user.name=Encre',
  '-c',
  'user.email=jms@grazulex.be'
]

export interface GitResult {
  ok: boolean
  stdout: string
  stderr: string
}

/** Exportée pour les tests : les appelants passent par `runGit`. */
export function sshCommand(keyPath: string): string {
  // BatchMode=yes : une app graphique ne doit jamais se bloquer sur une invite
  // que personne ne verra. Elle échoue franchement, l'erreur remonte dans l'UI.
  //
  // ServerAlive* : une liaison qui meurt sans FIN (Wi-Fi coupé, NAT qui oublie
  // la connexion) ne se manifeste pas — ssh reste pendu sur un tube que plus
  // personne ne lit. Sans sonde, seul le délai de garde le débloquerait, une
  // heure trop tard, et la reprise n'aurait jamais lieu dans le même run.
  // Trois sondes à quinze secondes : le mort est constaté en moins d'une
  // minute, et un envoi lent mais vivant n'est jamais pris pour un mort
  // puisque la sonde répond.
  return [
    'ssh',
    `-i "${keyPath}"`,
    '-o IdentitiesOnly=yes',
    '-o BatchMode=yes',
    '-o ServerAliveInterval=15',
    '-o ServerAliveCountMax=3',
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

    // `setEncoding` fait passer chaque morceau par le `StringDecoder` interne
    // du flux, qui retient l'octet de tête d'une séquence multi-octets coupée
    // par la frontière et la recolle au morceau suivant. Sans ça, décoder
    // chaque morceau isolément (`d.toString()`) casse tout caractère accentué
    // à cheval sur une frontière de morceau — silencieusement, en U+FFFD.
    // stderr aussi : les messages d'erreur de git sont localisés et peuvent
    // contenir des accents.
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
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

/**
 * `run` n'est un paramètre que pour les tests : les appelants réels ne le
 * passent jamais et héritent du vrai `runGit`. Il donne un point d'observation
 * direct sur le délai effectivement transmis, sans quoi rien ne distingue un
 * `cloneRepo` qui câble bien `CLONE_TIMEOUT_MS` de l'ancien défaut oublié.
 */
export async function cloneRepo(
  remoteUrl: string,
  dir: string,
  keyPath?: string,
  run: typeof runGit = runGit
): Promise<GitResult> {
  // cwd = parent : le dossier cible ne doit pas exister avant le clone.
  const result = await run(['clone', '-q', remoteUrl, dir], {
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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Envoie le dépôt, en retentant les envois coupés.
 *
 * Le lot de médias d'une journée d'écriture pèse des dizaines de mégaoctets et
 * met plusieurs minutes à monter. Sur ce trajet, une coupure en cours de
 * transfert n'a rien d'exceptionnel : le dépôt réel a vu deux essais mourir à
 * 5 et 6 Mio écrits, puis le troisième passer intégralement. Avec une
 * tentative unique, cet aléa devenait « Sauvegarde en échec » jusqu'au run
 * suivant — soit un jour entier de travail non protégé hors de la machine,
 * pour une cause qui disparaissait en dix secondes.
 *
 * Rien à défaire entre deux essais : un push coupé ne laisse aucun état
 * intermédiaire, le distant ne bouge que sur un pack reçu en entier. Un échec
 * définitif (remote absent, poussée refusée) coûte seulement les attentes.
 *
 * `run` et `wait` ne sont des paramètres que pour les tests : les appelants
 * réels ne les passent jamais.
 */
export async function pushRepo(
  dir: string,
  keyPath?: string,
  opts: { run?: typeof runGit; wait?: (ms: number) => Promise<void> } = {}
): Promise<GitResult> {
  const run = opts.run ?? runGit
  const wait = opts.wait ?? sleep

  let last: GitResult = { ok: false, stdout: '', stderr: "Aucune tentative d'envoi." }

  for (let essai = 0; essai < PUSH_ATTEMPTS; essai++) {
    if (essai > 0) await wait(PUSH_RETRY_DELAYS_MS[essai - 1] ?? 0)

    last = await run(['push', '-q', 'origin', 'HEAD'], {
      cwd: dir,
      keyPath,
      timeoutMs: PUSH_TIMEOUT_MS
    })
    if (last.ok) return last
  }

  // La dernière erreur de git telle quelle : c'est sa dernière ligne que
  // `sync` montre à l'utilisateur, et un message maison la masquerait.
  return last
}
