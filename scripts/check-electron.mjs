#!/usr/bin/env node
// Runs before `npm run dev`. `npm install` doesn't re-run Electron's postinstall when the package
// folder exists, so a missing app bundle (2026-11-05: spawn ... Electron ENOENT) stays missing.
// Repairs with Electron's own installer: same locked version, checksum-verified, lockfile untouched.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const root = dirname(require.resolve('electron/package.json'))
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const binary = join(root, 'dist', readFileSync(join(root, 'path.txt'), 'utf8').trim())

function works() {
  if (!existsSync(binary)) return false
  try {
    return execFileSync(binary, ['--version'], { encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } }).trim() === `v${version}`
  } catch {
    return false
  }
}

if (!works()) {
  console.log(`Electron ${version} is missing or damaged. Reinstalling it (about 100 MB).`)
  execFileSync(process.execPath, [join(root, 'install.js')], { stdio: 'inherit', env: { ...process.env, force_no_cache: 'true' } })
  if (!works()) {
    console.error(`Electron could not be repaired at ${binary}.`)
    process.exit(1)
  }
  console.log(`Electron ${version} repaired.`)
}
