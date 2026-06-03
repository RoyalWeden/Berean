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

// 3. Create/refresh the release.
//
// CRITICAL: the release MUST be a DRAFT. electron-updater scans all *published*
// GitHub releases (including prereleases on the beta channel) to find the latest
// app version. A published data-v1 gets mistaken for an app release and the
// updater 404s looking for latest.yml inside it. Draft releases are invisible to
// electron-updater but still downloadable in CI via the authenticated token.
// GitHub does NOT allow converting a published release back to a draft, so if an
// existing data-v1 is published we delete and recreate it as a draft.
const notes = 'Database assets (Bible texts, lexicons, cross-references, YouTube seed) ' +
  'downloaded automatically by CI builds. Kept as a DRAFT so the in-app updater ' +
  'ignores it. Install Berean from the latest v* release instead.'

let exists = false
let isDraft = false
try {
  const out = execSync(`gh release view ${TAG} --json isDraft`, { encoding: 'utf8' })
  exists = true
  isDraft = JSON.parse(out).isDraft === true
} catch { /* not found */ }

function createDraft() {
  console.log(`[data:publish] creating DRAFT release ${TAG}…`)
  execFileSync('gh', [
    'release', 'create', TAG,
    '--draft',
    '--title', 'Berean data bundle (CI use)',
    '--notes', notes,
    ...dbFiles,
  ], { stdio: 'inherit' })
}

if (!exists) {
  createDraft()
} else if (isDraft) {
  console.log(`[data:publish] draft release ${TAG} exists — uploading with --clobber…`)
  execFileSync('gh', ['release', 'upload', TAG, '--clobber', ...dbFiles], { stdio: 'inherit' })
} else {
  // Published release found — must recreate as draft so the updater ignores it.
  console.log(`[data:publish] ${TAG} is published (breaks auto-updater) — deleting and recreating as draft…`)
  execSync(`gh release delete ${TAG} --yes --cleanup-tag`, { stdio: 'inherit' })
  createDraft()
}

console.log(`\n[data:publish] ✓ done — assets live at the ${TAG} DRAFT release`)
console.log('CI builds download these before packaging; the in-app updater ignores drafts.')
