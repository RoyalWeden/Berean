import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'

type DB = InstanceType<typeof Database>

// The semantic-embedding index is a LOCAL DEV BUILD ARTIFACT (see scripts/build-embedding-index.js
// and its own header comment) — deliberately NOT one of the shared data/*.db files (those are
// symlinked from outside this worktree, read-only, and shipped in the packaged app's Resources/).
// This file lives inside the worktree at electron/db-generated/ instead, same two-levels-up
// relationship to out/main/ that electron/db/bible.ts's dataPath() already uses for data/ — see
// that file's own comment for why (`__dirname` = out/main/ at runtime).
//
// Not wired into electron-builder's packaged Resources/ in this pass (per the mission brief: "do
// not wire it into the shipped app's download/distribution pipeline in this pass — that's a
// separate, later decision the user hasn't made yet"). A packaged build therefore never finds this
// file, and every caller here degrades gracefully (returns null) when that's the case — semantic
// search is an ADDITIVE candidate source (see aiLookup.ts's gatherSemanticCandidates), never a
// hard dependency of AI Lookup, so a missing index just means that one extra signal is unavailable,
// not a broken feature.
let cachedDb: DB | null | undefined // undefined = not yet checked; null = checked, doesn't exist

function embeddingsDbPath(): string {
  if (app.isPackaged) {
    // Not shipped in Resources/ yet (see comment above) — this path simply won't exist in a
    // packaged build, and getEmbeddingsDb() below returns null for it, same as dev before the
    // index has been built.
    return join(process.resourcesPath, 'data', 'verse_embeddings.db')
  }
  return join(__dirname, '../../electron/db-generated', 'verse_embeddings.db')
}

/** Opens (and caches) the verse_embeddings.db connection, or returns null if the index hasn't
 *  been built yet — never throws. Read-only, same as every text DB in electron/db/bible.ts. */
export function getEmbeddingsDb(): DB | null {
  if (cachedDb !== undefined) return cachedDb
  const path = embeddingsDbPath()
  if (!existsSync(path)) {
    cachedDb = null
    return null
  }
  try {
    cachedDb = new Database(path, { readonly: true })
  } catch {
    cachedDb = null
  }
  return cachedDb
}

/** Test-only escape hatch — forces the next getEmbeddingsDb() call to re-check the filesystem
 *  instead of trusting the cached undefined/null from an earlier call in the same process. */
export function resetEmbeddingsDbCache(): void {
  cachedDb = undefined
}
