#!/usr/bin/env node
/**
 * Convert all data/*.db files from WAL to DELETE journal mode.
 *
 * Why: SQLite WAL mode requires creating .db-shm shared-memory files in the same
 * directory as the database. The packaged app's Resources/data/ directory is
 * read-only on Windows (and in the Mac App Store sandbox), so a WAL-mode DB fails
 * to open and the app shows no Bible text or lexicon. DELETE journal mode needs no
 * auxiliary files.
 *
 * Two conversion backends, tried in order:
 *   1. better-sqlite3 — used in CI, where the module is compiled for Node.js
 *      (this step runs BEFORE `npm run rebuild` switches it to the Electron ABI).
 *   2. sqlite3 CLI fallback — used locally on the developer's Mac, where
 *      better-sqlite3 is usually already compiled for Electron (ABI mismatch) and
 *      can't be loaded by plain Node. macOS ships /usr/bin/sqlite3.
 *
 * Used in:
 *   - GitHub Actions CI (both Mac + Windows) before the rebuild step
 *   - scripts/publish-data.js (local) before uploading the data bundle
 *   - npm run convert-dbs
 */

const { execFileSync } = require('child_process')
const { readdirSync, unlinkSync, statSync, existsSync } = require('fs')
const { join } = require('path')

const dataDir = join(__dirname, '..', 'data')

if (!existsSync(dataDir)) {
  console.log('[convert-dbs] data/ directory not found — skipping')
  process.exit(0)
}

// Try to load better-sqlite3. Locally it may be compiled for Electron, in which
// case the native binding fails to load under Node — we fall back to the CLI.
let Database = null
try { Database = require('better-sqlite3') } catch { Database = null }

function convertWithBetterSqlite(dbPath) {
  const db = new Database(dbPath)
  db.pragma('journal_mode = DELETE')   // checkpoints the WAL into the main DB
  db.pragma('wal_checkpoint(TRUNCATE)')
  db.close()
}

function convertWithCli(dbPath) {
  // Switching out of WAL mode checkpoints the -wal into the main DB and removes
  // the -wal/-shm sidecar files on close.
  execFileSync('sqlite3', [dbPath, 'PRAGMA journal_mode=DELETE;'], { stdio: 'pipe' })
}

const dbFiles = readdirSync(dataDir).filter(f => f.endsWith('.db'))
let converted = 0
let skipped = 0

for (const file of dbFiles) {
  const dbPath = join(dataDir, file)
  // Skip empty placeholder files (e.g. berean.db which is seeded at runtime)
  if (statSync(dbPath).size === 0) { skipped++; continue }

  let ok = false

  // Prefer better-sqlite3 (works in CI); fall back to the sqlite3 CLI (works locally).
  if (Database) {
    try { convertWithBetterSqlite(dbPath); ok = true } catch { /* fall through to CLI */ }
  }
  if (!ok) {
    try { convertWithCli(dbPath); ok = true }
    catch (err) {
      console.warn(`[convert-dbs] ✗ ${file}: ${String(err.message).split('\n')[0]}`)
      skipped++
      continue
    }
  }

  // Remove stale WAL/SHM files so electron-builder doesn't include them
  for (const ext of ['-shm', '-wal']) {
    const sideFile = dbPath + ext
    if (existsSync(sideFile)) {
      try { unlinkSync(sideFile) } catch { /* already gone */ }
    }
  }

  console.log(`[convert-dbs] ✓ ${file}`)
  converted++
}

console.log(`[convert-dbs] done — ${converted} converted, ${skipped} skipped`)

if (converted === 0 && dbFiles.length > 0) {
  console.error('[convert-dbs] ERROR: no databases were converted — refusing to proceed')
  console.error('  Neither better-sqlite3 (Node ABI) nor the sqlite3 CLI was usable.')
  console.error('  Locally: ensure `sqlite3` is on PATH (macOS ships it at /usr/bin/sqlite3).')
  process.exit(1)
}
