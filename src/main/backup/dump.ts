import { spawn } from 'child_process'
import { createWriteStream, statSync, existsSync } from 'fs'

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

    const out = createWriteStream(outPath)
    let settled = false

    // On attend 'finish' : le flux peut avoir des octets en tampon après la
    // sortie du process, et mesurer la taille avant serait une course.
    // On configure ce listener AVANT de spawner pour ne pas rater l'événement.
    out.on('finish', () => {
      if (settled) return
      settled = true
      // sqlite3 sort en 0 même sur une base inexistante (il en créerait une
      // vide à la demande) : un dump vide est donc le vrai signal d'échec.
      if (statSync(outPath).size === 0) {
        reject(new Error(`Dump vide : ${dbPath} est illisible ou inexistant.`))
      } else {
        resolve()
      }
    })

    const child = spawn(SQLITE_BIN, [dbPath, '.dump'])
    let stderr = ''

    child.stdout.pipe(out)
    child.stderr.on('data', (d) => (stderr += d.toString()))
    child.on('error', (err) => {
      if (settled) return
      settled = true
      reject(err)
    })

    child.on('close', (code) => {
      if (code !== 0) {
        if (settled) return
        settled = true
        reject(new Error(stderr || `sqlite3 a quitté avec le code ${code}`))
      }
      out.end()
    })
  })
}
