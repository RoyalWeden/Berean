#!/usr/bin/env node
/**
 * Tag and push a release.
 *
 * Usage:
 *   npm run tag:stable   →  prompts for version, commits changelog + package.json, tags
 *   npm run tag:beta     →  auto-bumps to next beta, commits, tags
 *
 * Beta logic:
 *   0.2.7          → tag:beta → 0.2.8-beta.1   (new series: bump patch)
 *   0.2.8-beta.1   → tag:beta → 0.2.8-beta.2   (same series: increment beta N)
 *
 * Stable logic:
 *   0.2.8-beta.3   → tag:stable → prompts "Release version [0.2.8]:"
 *   0.2.7          → tag:stable → prompts "Release version [0.2.8]:" (suggests next patch)
 */

const { execSync } = require('child_process')
const readline = require('readline')
const fs = require('fs')
const path = require('path')

const type = process.argv[2]
if (type !== 'stable' && type !== 'beta') {
  console.error('Usage: node scripts/tag-release.js <stable|beta>')
  process.exit(1)
}

const pkgPath = path.join(__dirname, '..', 'package.json')
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
const currentVersion = pkg.version

// Strip any pre-release suffix to get the clean base
const baseVersion = currentVersion.replace(/-.*$/, '')
const [major, minor, patch] = baseVersion.split('.').map(Number)

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

function ask(question) {
  return new Promise(resolve => rl.question(question, resolve))
}

async function main() {
  let newVersion

  if (type === 'beta') {
    // Beta: auto-calculate, no prompt needed
    const betaMatch = currentVersion.match(/^(.+)-beta\.(\d+)$/)
    if (betaMatch && betaMatch[1] === baseVersion) {
      newVersion = `${baseVersion}-beta.${parseInt(betaMatch[2]) + 1}`
    } else {
      newVersion = `${major}.${minor}.${patch + 1}-beta.1`
    }
  } else {
    // Stable: suggest the next sensible version, let the user confirm or change it
    // If currently on a beta, the suggestion is the clean base (e.g. 0.2.8-beta.3 → 0.2.8)
    // If currently on a clean version, suggest bumping the patch (e.g. 0.2.7 → 0.2.8)
    const suggestion = currentVersion.includes('-')
      ? baseVersion
      : `${major}.${minor}.${patch + 1}`

    console.log(`\n  Current package.json version: ${currentVersion}`)
    const answer = await ask(`  Release version [${suggestion}]: `)
    newVersion = answer.trim() || suggestion

    // Basic validation
    if (!/^\d+\.\d+\.\d+$/.test(newVersion)) {
      console.error(`\nInvalid version: "${newVersion}" — must be x.y.z`)
      rl.close(); process.exit(1)
    }
  }

  const tag = `v${newVersion}`

  // Check tag doesn't already exist
  try {
    const tags = execSync('git tag', { encoding: 'utf8' })
    if (tags.split('\n').includes(tag)) {
      console.error(`\nTag ${tag} already exists. Choose a different version.`)
      rl.close(); process.exit(1)
    }
  } catch { /* skip */ }

  // For stable: stage CHANGELOG + package.json together (working tree can be dirty with these)
  // For beta: require clean tree (beta auto-commits its own version bump)
  if (type === 'stable') {
    // Allow CHANGELOG.md and package.json to be dirty — we'll stage and commit them
    try {
      // Split the RAW output (before any trim) and drop empty lines — trimming the whole
      // string first strips the leading space off a single-char status line like " M foo",
      // which then throws off the fixed slice(3) offset for that one line (e.g.
      // "M CHANGELOG.md".slice(3) → "HANGELOG.md", silently mis-parsing the filename and
      // making CHANGELOG.md look "unexpected" even when it's on the allowed list below).
      const rawDirty = execSync('git status --porcelain', { encoding: 'utf8' })
      const dirtyLines = rawDirty.split('\n').filter(l => l.length > 0)
      if (dirtyLines.length > 0) {
        const allowedFiles = new Set(['CHANGELOG.md', 'package.json', 'package-lock.json'])
        const dirtyFiles = dirtyLines.map(l => l.slice(3).trim())
        const unexpected = dirtyFiles.filter(f => !allowedFiles.has(f))
        if (unexpected.length > 0) {
          console.error('\nUnexpected uncommitted changes — commit or stash these first:')
          console.error(unexpected.map(f => '  ' + f).join('\n'))
          rl.close(); process.exit(1)
        }
      }
    } catch { /* skip */ }
  } else {
    // Beta: must be fully clean
    try {
      const dirty = execSync('git status --porcelain', { encoding: 'utf8' }).trim()
      if (dirty) {
        console.error('\nWorking tree is not clean. Commit or stash your changes first.')
        console.error(dirty.split('\n').slice(0, 5).map(l => '  ' + l).join('\n'))
        rl.close(); process.exit(1)
      }
    } catch { /* skip */ }
  }

  // Show CHANGELOG context
  const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md')
  if (fs.existsSync(changelogPath)) {
    // Show the visible (non-comment) lines near the top
    const lines = fs.readFileSync(changelogPath, 'utf8')
      .split('\n')
      .filter(l => !l.startsWith('<!--') && !l.startsWith('  ') && !l.startsWith('═') && !l.startsWith('─'))
      .slice(0, 12)
    console.log('\n--- CHANGELOG.md ---')
    console.log(lines.join('\n'))
    console.log('---')
  }

  console.log(`\n  Version  : ${currentVersion} → ${newVersion}`)
  console.log(`  Tag      : ${tag}`)
  console.log(`  Type     : ${type === 'beta' ? 'PRE-RELEASE (beta)' : 'STABLE'}`)
  console.log()

  const confirm = await ask('Proceed? (y/n): ')
  rl.close()

  if (confirm.trim().toLowerCase() !== 'y') {
    console.log('Aborted.')
    process.exit(0)
  }

  try {
    if (type === 'stable') {
      // Update package.json and commit alongside any CHANGELOG changes
      const versionChanged = newVersion !== currentVersion
      if (versionChanged) {
        pkg.version = newVersion
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
      }
      // Stage package.json + CHANGELOG.md + package-lock.json (if present)
      const filesToStage = ['package.json', 'CHANGELOG.md', 'package-lock.json'].filter(f =>
        fs.existsSync(path.join(__dirname, '..', f))
      )
      execSync(`git add ${filesToStage.join(' ')}`, { stdio: 'inherit' })
      // Only commit if there's something staged
      const staged = execSync('git diff --cached --name-only', { encoding: 'utf8' }).trim()
      if (staged) {
        execSync(`git commit -m "chore: release ${newVersion}"`, { stdio: 'inherit' })
        console.log(`\nCommitted release ${newVersion}`)
      }
    } else {
      // Beta: commit just the version bump
      pkg.version = newVersion
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
      execSync('git add package.json', { stdio: 'inherit' })
      execSync(`git commit -m "chore: bump version to ${newVersion}"`, { stdio: 'inherit' })
      console.log(`\nCommitted package.json → ${newVersion}`)
    }

    execSync(`git tag ${tag}`, { stdio: 'inherit' })
    execSync(`git push origin HEAD`, { stdio: 'inherit' })
    execSync(`git push origin ${tag}`, { stdio: 'inherit' })

    console.log(`\n✓  Tagged and pushed ${tag}`)
    if (type === 'beta') {
      console.log('   GitHub Actions will build a pre-release — visible in the beta section of the download page.')
    } else {
      console.log('   GitHub Actions will build and publish as stable — visible on the download page once CI finishes.')
    }
    console.log(`   Track CI: https://github.com/RoyalWeden/Berean/actions`)
  } catch (err) {
    console.error('Error:', err.message)
    process.exit(1)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
