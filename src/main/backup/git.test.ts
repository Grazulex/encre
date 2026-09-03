import { describe, it, expect, beforeEach } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, unlinkSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  runGit,
  cloneRepo,
  hasRepo,
  commitAll,
  pushRepo,
  GIT_BIN,
  CLONE_TIMEOUT_MS,
  PUSH_TIMEOUT_MS,
  LOCAL_TIMEOUT_MS,
  PUSH_ATTEMPTS,
  PUSH_RETRY_DELAYS_MS,
  sshCommand,
  type GitResult
} from './git'

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

  // Le dépôt fait ~710 Mo (spec §1) : un clone initial dépasse largement le
  // délai de garde du push. S'il l'héritait, il serait tué à chaque tentative.
  //
  // Comparer CLONE_TIMEOUT_MS et PUSH_TIMEOUT_MS ne suffit pas : ça reste vert
  // même si `cloneRepo` oublie de transmettre `timeoutMs` à `runGit` (le
  // défaut originel de ce bug). La preuve qui compte porte sur le câblage :
  // la valeur réellement reçue par `runGit`. `cloneRepo` accepte pour ça un
  // `run` injectable — jamais fourni par un appelant réel — qui rend cette
  // valeur observable sans mock de module.
  it('passe le délai de clone à runGit, pas le délai par défaut', async () => {
    const received: Array<{ timeoutMs?: number }> = []
    const fakeRunGit: typeof runGit = async (_args, opts) => {
      received.push(opts)
      return { ok: true, stdout: '', stderr: '' }
    }

    await cloneRepo(remote, work, undefined, fakeRunGit)

    expect(received).toHaveLength(1)
    expect(received[0].timeoutMs).toBe(CLONE_TIMEOUT_MS)
    expect(received[0].timeoutMs).not.toBe(PUSH_TIMEOUT_MS)
  })

  it('efface un dossier de travail partiel laissé par un clone raté', async () => {
    // Un clone tué par SIGKILL (délai dépassé, arrêt de l'app) ne laisse pas
    // git nettoyer : le dossier survit. Sans effacement, `hasRepo` peut rendre
    // vrai à jamais et plus aucun clone ne sera retenté.
    mkdirSync(join(work, '.git'), { recursive: true })
    writeFileSync(join(work, 'reste.txt'), 'débris')

    const r = await cloneRepo(remote, work)
    expect(r.ok).toBe(false)
    expect(existsSync(work)).toBe(false)
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

  it('refuse de commiter quand des fichiers ont disparu du dossier de travail', async () => {
    await cloneRepo(remote, work)
    writeFileSync(join(work, 'library.sql'), 'CREATE TABLE t(a);')
    writeFileSync(join(work, 'media.png'), 'octets')
    await commitAll(work, 'initial')
    const head = await runGit(['rev-parse', 'HEAD'], { cwd: work })

    // Arbre de travail amputé : clone interrompu, ou dossier vidé à la main
    // pour récupérer de l'espace. `git add -A` mettrait la suppression en
    // scène et la pousserait, élaguant le dépôt distant en silence.
    unlinkSync(join(work, 'media.png'))

    const { committed, result } = await commitAll(work, 'après amputation')
    expect(committed).toBe(false)
    expect(result.ok).toBe(false)
    expect(result.stderr).toMatch(/[Ss]uppression/)
    expect(result.stderr).toContain('media.png')

    // HEAD n'a pas bougé : rien n'a été enregistré.
    const after = await runGit(['rev-parse', 'HEAD'], { cwd: work })
    expect(after.stdout.trim()).toBe(head.stdout.trim())
  })

  it("refuse aussi quand la suppression est déjà en scène dans l'index", async () => {
    await cloneRepo(remote, work)
    writeFileSync(join(work, 'a.txt'), 'x')
    writeFileSync(join(work, 'b.txt'), 'y')
    await commitAll(work, 'initial')
    await runGit(['rm', '-q', '--cached', 'b.txt'], { cwd: work })

    const { committed, result } = await commitAll(work, 'après rm --cached')
    expect(committed).toBe(false)
    expect(result.ok).toBe(false)
    expect(result.stderr).toMatch(/[Ss]uppression/)
  })

  it("renvoie committed=false quand il n'y a rien à commiter", async () => {
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

    const r = await pushRepo(work, undefined, { wait: async () => {} })
    expect(r.ok).toBe(false)
    expect(r.stderr).not.toBe('')
  })
})

/**
 * Le défaut qui a motivé ces tests : le dépôt de sauvegarde envoie ~80 Mo de
 * médias par lot sur une liaison montante mesurée à ~750 Ko/s. Deux essais sur
 * trois mouraient en cours de transfert (« Connection to github.com closed by
 * remote host », à 5 puis 6 Mio écrits) ; le troisième est passé en 105,8 s.
 * Une tentative unique transforme donc un aléa réseau ordinaire en
 * « Sauvegarde en échec » jusqu'au run suivant, alors que le distant accepte
 * parfaitement l'envoi.
 */
describe('pushRepo — reprises', () => {
  // `run` et `wait` ne sont des paramètres que pour les tests : les appelants
  // réels ne les passent jamais. Ils rendent observables le nombre d'essais et
  // le délai transmis, sans mock de module ni attente réelle.
  const failure = (msg: string): GitResult => ({ ok: false, stdout: '', stderr: msg })
  const CUT = 'fatal: the remote end hung up unexpectedly'

  it('retente et réussit quand un envoi est coupé en cours de transfert', async () => {
    const attempts: number[] = []
    const waits: number[] = []
    let n = 0
    const run: typeof runGit = async () => {
      attempts.push(++n)
      return n < 3 ? failure(CUT) : { ok: true, stdout: '', stderr: '' }
    }

    const r = await pushRepo(work, undefined, {
      run,
      wait: async (ms) => {
        waits.push(ms)
      }
    })

    expect(r.ok).toBe(true)
    expect(attempts).toHaveLength(3)
    // Une attente avant chaque reprise, pas avant le premier essai.
    expect(waits).toEqual(PUSH_RETRY_DELAYS_MS.slice(0, 2))
  })

  it('renonce après PUSH_ATTEMPTS et rend la dernière erreur de git', async () => {
    let n = 0
    const run: typeof runGit = async () => failure(`${CUT} (essai ${++n})`)

    const r = await pushRepo(work, undefined, { run, wait: async () => {} })

    expect(r.ok).toBe(false)
    expect(n).toBe(PUSH_ATTEMPTS)
    // La dernière ligne reste celle de git : c'est elle que `sync` montre à
    // l'utilisateur. Un message maison à la place masquerait la vraie cause.
    expect(r.stderr).toContain(`essai ${PUSH_ATTEMPTS}`)
  })

  it("n'attend pas avant le premier essai quand il réussit du premier coup", async () => {
    const waits: number[] = []
    const run: typeof runGit = async () => ({ ok: true, stdout: '', stderr: '' })

    await pushRepo(work, undefined, { run, wait: async (ms) => waits.push(ms) as unknown as void })

    expect(waits).toEqual([])
  })

  // Même piège que pour le clone : comparer les constantes entre elles reste
  // vert si `pushRepo` oublie de transmettre `timeoutMs`. La preuve porte sur
  // la valeur reçue par `runGit`.
  it('passe le délai de push à runGit, pas le délai local', async () => {
    const received: Array<{ timeoutMs?: number }> = []
    const run: typeof runGit = async (_args, opts) => {
      received.push(opts)
      return { ok: true, stdout: '', stderr: '' }
    }

    await pushRepo(work, undefined, { run, wait: async () => {} })

    expect(received).toHaveLength(1)
    expect(received[0].timeoutMs).toBe(PUSH_TIMEOUT_MS)
    expect(received[0].timeoutMs).not.toBe(LOCAL_TIMEOUT_MS)
  })

  // L'ancienne valeur valait 120 000 ms. L'envoi mesuré en a pris 105 800 : la
  // marge était de quatorze secondes, et le lot de médias suivant aurait fait
  // que l'app tuerait son propre push au SIGKILL — en affichant une erreur
  // réseau dont le réseau n'est pas responsable.
  it('laisse au push une marge sans rapport avec les 106 s mesurées', () => {
    expect(PUSH_TIMEOUT_MS).toBeGreaterThan(10 * 106_000)
  })
})

describe('sshCommand', () => {
  // Sans sonde de vivacité, une liaison coupée sans FIN ne se manifeste pas :
  // ssh reste pendu jusqu'au délai de garde. Avec un délai de garde large
  // (indispensable pour ne pas couper un envoi lent qui progresse), ça
  // condamnerait la reprise à n'arriver qu'une heure trop tard.
  it("arme des sondes de vivacité pour qu'une liaison morte rende vite la main", () => {
    const cmd = sshCommand('/tmp/cle')
    expect(cmd).toContain('ServerAliveInterval=')
    expect(cmd).toContain('ServerAliveCountMax=')
  })

  it('garde BatchMode : une app graphique ne se bloque pas sur une invite', () => {
    expect(sshCommand('/tmp/cle')).toContain('BatchMode=yes')
  })
})

describe('runGit / encodage UTF-8', () => {
  it('ne corrompt pas les caractères accentués à cheval sur une frontière de morceau', async () => {
    await cloneRepo(remote, work)

    // Recette du contrôleur : ~1,8 Mo dense en accents (2000 entrées portant
    // chacune 400 fois « é »), assez pour être livré en plusieurs dizaines de
    // morceaux par le tube stdout et donc faire tomber au moins une frontière
    // en plein milieu d'un « é » (2 octets en UTF-8) si le décodage se fait
    // morceau par morceau au lieu d'être tenu par un StringDecoder continu.
    const entries = Array.from({ length: 2000 }, (_, i) => ({
      titre: `chapitre ${i} : ${'é'.repeat(400)}`
    }))
    const content = JSON.stringify(entries)
    writeFileSync(join(work, 'manifest.json'), content)
    await commitAll(work, 'manifeste dense en accents')

    const shown = await runGit(['show', 'HEAD:manifest.json'], { cwd: work })
    expect(shown.ok).toBe(true)
    expect(shown.stdout).not.toContain('�')
    expect(shown.stdout).toBe(content)
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
