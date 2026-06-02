#!/usr/bin/env node
/**
 * Convert all data/*.db files from WAL to DELETE journal mode.
 *
 * Must run BEFORE `npm run rebuild` (electron-rebuild) because it uses
 * better-sqlite3 in its Node.js-compiled form. After electron-rebuild the
 * module is recompiled for Electron and can no longer be required by Node.
 *
 * Used in:
 *   - GitHub Actions CI (both Mac + Windows) before the rebuild step
 *   - npm run convert-dbs for local pre-packaging preparation
 *
 * Why: SQLite WAL mode requires creating .db-shm shared-memory files in
 * the same directory as the database. The packaged app's Resources/data/
 * directory is read-only on Windows (and in the Mac App Store sandbox),
 * so WAL mode fails silently and the app has no Bible text or lexicon data.
 * DELETE journal mode needs no auxiliary files.
 */

const Database = require('better-sqlite3')
const { readdirSync, unlinkSync, statSync, existsSync } = require('fs')
const { join } = require('path')

const dataDir = join(__dirname, '..', 'data')

if (!existsSync(dataDir)) {
  console.log('[convert-dbs] data/ directory not found — skipping')
  process.exit(0)
}

const dbFiles = readdirSync(dataDir).filter(f => f.endsWith('.db'))
let converted = 0
let skipped = 0

for (const file of dbFiles) {
  const dbPath = join(dataDir, file)
  // Skip empty placeholder files (e.g. berean.db which is seeded at runtime)
  if (statSync(dbPath).size === 0) { skipped++; continue }

  try {
    const db = new Database(dbPath)
    db.pragma('journal_mode = DELETE')
    db.pragma('wal_checkpoint(TRUNCATE)')
    db.close()

    // Remove stale WAL/SHM files so electron-builder doesn't include them
    for (const ext of ['-shm', '-wal']) {
      const sideFile = dbPath + ext
      if (existsSync(sideFile)) {
        try { unlinkSync(sideFile); console.log(`  removed ${file}${ext}`) }
        catch { /* already gone */ }
      }
    }

    console.log(`[convert-dbs] ✓ ${file}`)
    converted++
  } catch (err) {
    console.warn(`[convert-dbs] ✗ ${file}: ${err.message}`)
    skipped++
  }
}

console.log(`[convert-dbs] done — ${converted} converted, ${skipped} skipped`)
