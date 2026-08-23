import { mkdirSync, readdirSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import type { Db } from '../db/connection'

const DAY_MS = 24 * 60 * 60 * 1000

export async function backupDatabase(db: Db, backupsDir: string, now: Date): Promise<string> {
  mkdirSync(backupsDir, { recursive: true })
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const dest = join(backupsDir, `library-${stamp}.db`)
  await db.backup(dest)
  return dest
}

// `library-<horodatage>.db` et ses frères : chaque `db.backup()` laisse aussi
// un `-wal` et un `-shm`. Un filtre sur `.db` seul les laissait survivre à
// l'élagage pour toujours ; ils partent maintenant avec leur instantané.
const BACKUP_FILE = /^library-.+\.db(-wal|-shm)?$/

function backupFiles(backupsDir: string): string[] {
  try {
    return readdirSync(backupsDir)
      .filter((f) => BACKUP_FILE.test(f))
      .map((f) => join(backupsDir, f))
  } catch {
    return []
  }
}

export function shouldBackup(backupsDir: string, now: Date): boolean {
  return !backupFiles(backupsDir).some((f) => now.getTime() - statSync(f).mtimeMs < DAY_MS)
}

export function pruneBackups(backupsDir: string, now: Date, keepDays = 30): string[] {
  const removed: string[] = []
  for (const f of backupFiles(backupsDir)) {
    if (now.getTime() - statSync(f).mtimeMs > keepDays * DAY_MS) {
      unlinkSync(f)
      removed.push(f)
    }
  }
  return removed
}
