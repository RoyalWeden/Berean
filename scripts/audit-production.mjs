#!/usr/bin/env node
/**
 * Production artifact audit (DATA-UX-060). Scans what actually ships — the desktop renderer +
 * preload bundles (`out/`) and the iOS web bundle (`ios/App/App/public`) — for development-only
 * code, plus the iOS entitlements / container ids. Run after `npm run build` and `npm run ios:sync`.
 *
 * Rules are about the SHIPPED bytes, not the source: a dev-only branch that the bundler removed
 * (import.meta.env.DEV) must be absent; runtime checks backed by a packaged-app constant
 * (electron `is.dev` = !app.isPackaged) are allowed in the main-process bundle and listed as such.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const files = (dir, ext) => {
  if (!existsSync(dir)) return []
  const out = []
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) out.push(...files(p, ext))
    else if (ext.some((e) => f.endsWith(e))) out.push(p)
  }
  return out
}
const FORBIDDEN_WEB = [
  ['__bereanStore', 'E2E / CDP store handle (import.meta.env.DEV or VITE_E2E_PROBE only)'],
  ['127.0.0.1:9555', 'simulator probe server'],
  ['berean-debug-presenter', 'persistent debug switch definition (DEV only; readers of the undefined global are inert)'],
  ['__verseSheetsDebug', 'verse-sheet debug hook (probe only)'],
  ['localhost:5173', 'Vite dev server URL'],
  ["'unsafe-eval'", 'relaxed CSP (dev server / probe only)'],
]
let problems = 0
const scan = (label, list, rules) => {
  let n = 0
  for (const f of list) {
    const text = readFileSync(f, 'utf8')
    for (const [needle, why] of rules) if (text.includes(needle)) { console.log(`✗ ${label}: ${f.replace(root, '')} contains ${needle} — ${why}`); problems++ }
    n++
  }
  console.log(`${n ? '✓' : '·'} ${label}: ${n} file(s) scanned`)
}
scan('desktop renderer', files(join(root, 'out/renderer'), ['.js', '.html']), FORBIDDEN_WEB)
scan('desktop preload', files(join(root, 'out/preload'), ['.js', '.mjs']), FORBIDDEN_WEB.filter(([n]) => n !== "'unsafe-eval'"))
scan('iOS web bundle', files(join(root, 'ios/App/App/public'), ['.js', '.html']), FORBIDDEN_WEB)

// iOS identifiers: one production set (Debug and Release share Berean.xcconfig).
const xc = existsSync(join(root, 'ios/App/Berean.xcconfig')) ? readFileSync(join(root, 'ios/App/Berean.xcconfig'), 'utf8') : ''
const container = /BEREAN_ICLOUD_CONTAINER\s*=\s*(\S+)/.exec(xc)?.[1]
if (container && container !== 'iCloud.com.berean.app') { console.log(`✗ iOS iCloud container is ${container} (expected iCloud.com.berean.app)`); problems++ }
else console.log(`✓ iOS iCloud container: ${container ?? '(default iCloud.com.berean.app)'}`)
const release = existsSync(join(root, 'ios/App/BereanRelease.xcconfig')) ? readFileSync(join(root, 'ios/App/BereanRelease.xcconfig'), 'utf8') : ''
if (/debug\.xcconfig/.test(release)) { console.log('✗ Release config includes debug.xcconfig (CAPACITOR_DEBUG)'); problems++ }
else console.log('✓ Release config does not include debug.xcconfig')

console.log(problems ? `\n${problems} problem(s) found` : '\nNo development-only code in the shipped artifacts.')
process.exit(problems ? 1 : 0)
