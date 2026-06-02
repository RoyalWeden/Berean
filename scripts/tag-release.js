#!/usr/bin/env node
/**
 * Tag and push a release.
 *
 * Usage:
 *   node scripts/tag-release.js stable   →  finalises current version as stable
 *   node scripts/tag-release.js beta     →  bumps to next beta
 *
 * Beta logic:
 *   0.2.7          → tag:beta → 0.2.8-beta.1   (new series: bump patch)
 *   0.2.8-beta.1   → tag:beta → 0.2.8-beta.2   (same series: increment beta N)
 *   0.2.8-beta.2   → tag:beta → 0.2.8-beta.3   (same series: increment beta N)
 *
 * Stable logic:
 *   0.2.8-beta.3   → tag:stable → 0.2.8         (strips suffix, commits clean version)
 *   0.2.8          → tag:stable → 0.2.8         (already clean, just tags)
 *
 * To start a NEW minor/major series (e.g. 0.3.0), manually edit package.json first:
 *   set version to "0.3.0-beta.1" in package.json, commit it, then run tag:beta
 *   (which will increment to 0.3.0-beta.2 on next call, or run tag:stable for 0.3.0)
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

let newVersion

if (type === 'beta') {
  // Check if we're already in a beta series for this same base
  const betaMatch = currentVersion.match(/^(.+)-beta\.(\d+)$/)
  if (betaMatch && betaMatch[1] === baseVersion) {
    // Increment beta number: 0.2.8-beta.1 → 0.2.8-beta.2
    newVersion = `${baseVersion}-beta.${parseInt(betaMatch[2]) + 1}`
  } else {
    // New series: bump patch and start beta.1
    newVersion = `${major}.${minor}.${patch + 1}-beta.1`
  }
} else {
  // Stable: use the clean base version
  newVersion = baseVersion
}

const tag = `v${newVersion}`

// Check for clean working tree
try {
  const dirty = execSync('git status --porcelain', { encoding: 'utf8' }).trim()
  if (dirty) {
    console.error('\nWorking tree is not clean. Commit or stash your changes first.')
    console.error(dirty.split('\n').slice(0, 5).map(l => '  ' + l).join('\n'))
    process.exit(1)
  }
} catch { /* git not available, skip check */ }

// Check tag doesn't already exist
try {
  const tags = execSync('git tag', { encoding: 'utf8' })
  if (tags.split('\n').includes(tag)) {
    console.error(`\nTag ${tag} already exists. Choose a different version.`)
    process.exit(1)
  }
} catch { /* skip */ }

// Show CHANGELOG context
const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md')
if (fs.existsSync(changelogPath)) {
  const lines = fs.readFileSync(changelogPath, 'utf8').split('\n').slice(0, 18)
  console.log('\n--- CHANGELOG.md (top) ---')
  console.log(lines.join('\n'))
  console.log('---')
}

console.log(`\n  Current version : ${currentVersion}`)
console.log(`  New version     : ${newVersion}`)
console.log(`  Tag             : ${tag}`)
console.log(`  Type            : ${type === 'beta' ? 'PRE-RELEASE (beta)' : 'STABLE'}`)
console.log()

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
rl.question(`Proceed? (y/n): `, (answer) => {
  rl.close()
  if (answer.trim().toLowerCase() !== 'y') {
    console.log('Aborted.')
    process.exit(0)
  }

  try {
    // Update package.json if version changed
    if (newVersion !== currentVersion) {
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
      console.log('   GitHub Actions will build a pre-release — visible on the beta section of the download page.')
    } else {
      console.log('   GitHub Actions will build and publish as stable — visible on the download page immediately.')
    }
    console.log(`   Track CI: https://github.com/RoyalWeden/Berean/actions`)
  } catch (err) {
    console.error('Error:', err.message)
    process.exit(1)
  }
})
