#!/usr/bin/env node
/**
 * Tag and push a release.
 *
 * Usage:
 *   node scripts/tag-release.js stable   →  tags v{current version}
 *   node scripts/tag-release.js beta     →  bumps patch, appends -beta.1, tags
 *
 * Prerequisites:
 *   - Working tree must be clean (no uncommitted changes)
 *   - GH_TOKEN must be set for CI to publish to GitHub Releases
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
let version = pkg.version

// Strip existing pre-release suffix for a clean base
const baseVersion = version.replace(/-.*$/, '')

if (type === 'beta') {
  // Bump patch, add -beta.1
  const parts = baseVersion.split('.').map(Number)
  parts[2] = (parts[2] ?? 0) + 1
  version = `${parts.join('.')}-beta.1`
} else {
  version = baseVersion
}

const tag = `v${version}`

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

// Show CHANGELOG reminder
const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md')
const changelogExists = fs.existsSync(changelogPath)

console.log(`\nPreparing ${type} release: ${tag}`)
if (changelogExists) {
  const lines = fs.readFileSync(changelogPath, 'utf8').split('\n').slice(0, 15)
  console.log('\n--- CHANGELOG.md (top) ---')
  console.log(lines.join('\n'))
  console.log('---')
}
console.log()

rl.question(`Is CHANGELOG.md updated for ${tag}? Tag and push now? (y/n): `, (answer) => {
  rl.close()
  if (answer.trim().toLowerCase() !== 'y') {
    console.log('Aborted. Update CHANGELOG.md and run again.')
    process.exit(0)
  }

  try {
    if (type === 'beta') {
      // Update package.json version for beta
      pkg.version = version
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
      execSync('git add package.json', { stdio: 'inherit' })
      execSync(`git commit -m "chore: bump version to ${version}"`, { stdio: 'inherit' })
      console.log(`Committed version bump to ${version}`)
    }

    execSync(`git tag ${tag}`, { stdio: 'inherit' })
    execSync(`git push origin HEAD`, { stdio: 'inherit' })
    execSync(`git push origin ${tag}`, { stdio: 'inherit' })

    console.log(`\n✓ Tagged and pushed ${tag}`)
    console.log('GitHub Actions will now build Mac + Windows and publish to GitHub Releases.')
    console.log(`Track progress: https://github.com/RoyalWeden/Berean/actions`)
  } catch (err) {
    console.error('Error:', err.message)
    process.exit(1)
  }
})
