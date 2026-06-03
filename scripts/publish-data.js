#!/usr/bin/env node
/**
 * Publish the Bible/lexicon/cross-ref/YouTube SQLite databases to a dedicated
 * GitHub Release so CI builds can download them.
 *
 * WHY: the data/*.db files (~159 MB) are gitignored and far too large to commit.
 * GitHub Actions checks out an empty data/ directory, so packaged apps shipped
 * with no Bible texts or lexicon. This hosts the DBs as release assets that the
 * release.yml workflow downloads before building (both Mac and Windows).
 *
 * USAGE:  npm run data:publish
 *   - Run once to seed the data-v1 release.
 *   - Re-run only when the database files change; it re-uploads with --clobber.
 *
 * Requires: gh CLI authenticated (gh auth login) — same auth used for pushing.
 */

const { execFileSync, execSync } = require('child_process')
const { readdirSync, statSync } = require('fs')
const { join } = require('path')

const TAG = 'data-v1'
const dataDir = join(__dirname, '..', 'data')

// 1. Normalize every DB to DELETE journal mode (removes -wal/-shm siblings) so
//    the bundled files work in the read-only resources dir on Windows / MAS.
console.log('[data:publish] converting databases to DELETE journal mode…')
execSync('node ' + JSON.stringify(join(__dirname, 'convert-dbs.js')), { stdio: 'inherit' })

// 2. Gather the .db files to upload (skip empty placeholders like berean.db)
const dbFiles = readdirSync(dataDir)
  .filter(f => f.endsWith('.db'))
  .map(f => join(dataDir, f))
  .filter(p => statSync(p).size > 0)

if (dbFiles.length === 0) {
  console.error('[data:publish] no .db files found in data/ — nothing to upload')
  process.exit(1)
}

console.log(`[data:publish] ${dbFiles.length} database files to upload:`)
for (const f of dbFiles) {
  const mb = (statSync(f).size / 1024 / 1024).toFixed(1)
  console.log(`  ${f.split('/').pop()}  (${mb} MB)`)
}

// 3. Create the release if missing, otherwise upload with --clobber
let exists = false
try {
  execSync(`gh release view ${TAG}`, { stdio: 'ignore' })
  exists = true
} catch { /* not found */ }

const notes = 'Database assets (Bible texts, lexicons, cross-references, YouTube seed) ' +
  'downloaded automatically by CI builds. Not intended for direct download — ' +
  'install Berean from the latest v* release instead.'

if (!exists) {
  console.log(`[data:publish] creating release ${TAG}…`)
  execFileSync('gh', [
    'release', 'create', TAG,
    '--title', 'Berean data bundle (CI use)',
    '--notes', notes,
    ...dbFiles,
  ], { stdio: 'inherit' })
} else {
  console.log(`[data:publish] release ${TAG} exists — uploading with --clobber…`)
  execFileSync('gh', [
    'release', 'upload', TAG, '--clobber',
    ...dbFiles,
  ], { stdio: 'inherit' })
}

console.log(`\n[data:publish] ✓ done — assets live at the ${TAG} release`)
console.log('CI builds will now download these before packaging.')
