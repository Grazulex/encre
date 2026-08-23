import { spawn } from 'child_process'
import { createWriteStream, renameSync, rmSync, statSync, existsSync } from 'fs'

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
    // Vérifier que la base existe avant de la dumper
    if (!existsSync(dbPath)) {
      reject(new Error(`Base de données inexistante : ${dbPath}`))
      return
    }

    // On écrit à côté, pas par-dessus : `createWriteStream` tronque le fichier
    // à l'ouverture, ce qui détruirait le dernier dump connu bon avant même de
    // savoir si le nouveau tient debout. Le définitif n'est remplacé qu'au
    // succès, par un rename atomique dans le même dossier.
    const tmpPath = `${outPath}.tmp`
    const out = createWriteStream(tmpPath)
    let settled = false

    // Centraliser la gestion des erreurs pour éviter double settling et
    // garantir que le flux est détruit proprement
    const fail = (err: Error): void => {
      if (settled) return
      settled = true
      out.destroy()
      rmSync(tmpPath, { force: true })
      reject(err)
    }

    const succeed = (): void => {
      if (settled) return
      settled = true
      try {
        renameSync(tmpPath, outPath)
      } catch (err) {
        rmSync(tmpPath, { force: true })
        reject(err as Error)
        return
      }
      resolve()
    }

    out.on('error', fail)

    const child = spawn(SQLITE_BIN, [dbPath, '.dump'])
    let stderr = ''

    child.stdout.pipe(out)
    child.stderr.on('data', (d) => (stderr += d.toString()))
    child.on('error', fail)

    child.on('close', (code) => {
      // Le code de sortie ne suffit pas : sur une base corrompue, sqlite3 sort en 0
      // en n'écrivant que des marqueurs d'erreur en commentaires SQL, et signale le
      // vrai problème sur stderr. Un dump sain, lui, laisse stderr vide — c'est donc
      // le seul signal qui distingue « sauvegarde valide » de « coquille vide ».
      if (code !== 0 || stderr.trim() !== '') {
        fail(new Error(stderr.trim() || `sqlite3 a quitté avec le code ${code}`))
        return
      }

      // Le code de sortie fait autorité : on n'observe la fin du flux qu'APRÈS
      // l'avoir confirmé à 0. Écouter 'finish' inconditionnellement le ferait
      // gagner la course contre 'close', et un dump partiel suivi d'un échec se
      // résoudrait comme un succès — le pire cas pour une sauvegarde.
      const check = (): void => {
        // `fail()` peut déjà être passé par ici et avoir supprimé `tmpPath`
        // (ex. `out.on('error', fail)` déclenché entre-temps) : sans cette
        // garde, `statSync` lèverait ENOENT de façon synchrone dans cet
        // écouteur 'close', donc comme exception non rattrapée dans le
        // process main d'Electron.
        if (settled) return

        // sqlite3 sort en 0 même sur une base inexistante (il en créerait une
        // vide à la demande) : un dump vide est donc le vrai signal d'échec.
        if (statSync(tmpPath).size === 0) {
          fail(new Error(`Dump vide : ${dbPath} est illisible.`))
        } else {
          succeed()
        }
      }

      // `pipe` termine `out` tout seul quand stdout se ferme, et 'finish' a donc
      // pu être émis avant qu'on arrive ici : sans cette garde, l'écouteur ne
      // serait jamais appelé et la promesse resterait suspendue à jamais.
      if (out.writableFinished) check()
      else out.once('finish', check)
    })
  })
}
