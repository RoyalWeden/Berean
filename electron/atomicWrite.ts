import { renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'

/** Writes through a temporary file in the same folder and renames it into place, so a crash or an
 *  iCloud eviction mid-write leaves the old file whole instead of a truncated one. The name starts
 *  with a dot and doesn't end in .md, so the vault watcher and Octarine skip it. */
export function writeFileAtomicSync(path: string, data: string | Buffer): void {
  const tmp = join(dirname(path), `.berean-${randomBytes(6).toString('hex')}.tmp`)
  try {
    writeFileSync(tmp, data, typeof data === 'string' ? 'utf-8' : undefined)
    renameSync(tmp, path)
  } catch (e) {
    rmSync(tmp, { force: true })
    throw e
  }
}
