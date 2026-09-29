#!/usr/bin/env node
// Wraps the signed Mac App Store app (release/mas-arm64/Berean.app, from `npm run build:mas`) in
// the installer package App Store Connect accepts: release/Berean-<version>-mas.pkg, signed with
// the team's "Mac Installer Distribution" (a.k.a. "3rd Party Mac Developer Installer")
// certificate, then re-runs verify-mas. Upload the .pkg with Transporter (docs/mac-app-store.md §7).
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const app = join(root, 'release/mas-arm64/Berean.app')
const out = join(root, `release/Berean-${version}-mas.pkg`)

if (!existsSync(app)) {
  console.error('package-mas: release/mas-arm64/Berean.app not found — run npm run build:mas first')
  process.exit(1)
}

const identities = execFileSync('security', ['find-identity', '-v'], { encoding: 'utf8' })
const installer = identities.split('\n')
  .map((l) => (l.match(/"((?:Mac Installer Distribution|3rd Party Mac Developer Installer): .*\(6C8RCZVUZR\))"/) ?? [])[1])
  .find(Boolean)
if (!installer) {
  console.error('package-mas: no "Mac Installer Distribution" certificate for team 6C8RCZVUZR in the keychain.')
  console.error('  Create one: Xcode › Settings › Accounts › (team) › Manage Certificates… › + › Mac Installer Distribution.')
  process.exit(1)
}

execFileSync('productbuild', ['--component', app, '/Applications', '--sign', installer, out], { stdio: 'inherit' })
execFileSync('pkgutil', ['--check-signature', out], { stdio: 'inherit' })
execFileSync('node', [join(root, 'scripts/mac/verify-mas.mjs'), app], { stdio: 'inherit' })
console.log(`package-mas: ${out}`)
