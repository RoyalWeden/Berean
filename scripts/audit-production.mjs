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

// App identities (config/app-identity.json): production and development never share a value, and
// what ships is the production identity.
const ids = JSON.parse(readFileSync(join(root, 'config/app-identity.json'), 'utf8')).identities
const prodValues = Object.values(ids.production)
const shared = Object.values(ids.development).filter((v) => prodValues.includes(v))
if (shared.length) { console.log(`✗ production and development identities share ${shared.join(', ')}`); problems++ }
else console.log(`✓ app identities separate: ${ids.production.bundleId} / ${ids.development.bundleId}`)
// iOS: the identity the last ios:sync generated (Identity.xcconfig). A production audit must see production.
const idxc = join(root, 'ios/App/Identity.xcconfig')
const iosIdentity = existsSync(idxc) ? /BEREAN_IDENTITY = (\w+)/.exec(readFileSync(idxc, 'utf8'))?.[1] : null
const container = existsSync(idxc) ? /BEREAN_ICLOUD_CONTAINER = (\S+)/.exec(readFileSync(idxc, 'utf8'))?.[1] : null
if (iosIdentity && (iosIdentity !== 'production' || container !== ids.production.cloudContainer)) { console.log(`✗ iOS is configured as ${iosIdentity} (${container}) — run npm run ios:sync before a production build`); problems++ }
else console.log(`✓ iOS identity: ${iosIdentity ? `production (${container})` : 'not generated yet (npm run ios:sync writes production)'}`)
// Desktop: out/ must be compiled for production (electron/appIdentity.ts BUILD_IDENTITY).
const mainJs = join(root, 'out/main/index.js')
const built = existsSync(mainJs) ? /BUILD_IDENTITY\s*=\s*"(production|development)"/.exec(readFileSync(mainJs, 'utf8'))?.[1] : null
if (built && built !== 'production') { console.log(`✗ out/ was built for ${built} — run npm run build (no BEREAN_IDENTITY) before a production build`); problems++ }
else console.log(`✓ desktop build identity: ${built ?? '(out/ not built)'}`)
const release = existsSync(join(root, 'ios/App/BereanRelease.xcconfig')) ? readFileSync(join(root, 'ios/App/BereanRelease.xcconfig'), 'utf8') : ''
if (/debug\.xcconfig/.test(release)) { console.log('✗ Release config includes debug.xcconfig (CAPACITOR_DEBUG)'); problems++ }
else console.log('✓ Release config does not include debug.xcconfig')

// Mac App Store entitlements: App Review rejected 0.2.1 (Guideline 2.4.5(i)) for the Downloads
// entitlement; development-only keys never ship (docs/mac-app-store.md §2). The signed .app is
// checked again by scripts/mac/verify-mas.mjs.
const mas = readFileSync(join(root, 'build/entitlements.mas.plist'), 'utf8').replace(/<!--[\s\S]*?-->/g, '')
const masBad = ['com.apple.security.files.downloads', 'get-task-allow', 'com.apple.security.network.server', 'allow-dyld-environment-variables'].filter((k) => mas.includes(k))
if (masBad.length) { console.log(`✗ Mac App Store entitlements include ${masBad.join(', ')}`); problems++ }
else console.log('✓ Mac App Store entitlements: no Downloads or development-only keys')
const hasString = (xml, v) => xml.includes(`<string>${v}</string>`)
const masOk = hasString(mas, ids.production.cloudContainer) && !hasString(mas, ids.development.cloudContainer) && !hasString(mas, `6C8RCZVUZR.${ids.development.bundleId}`)
if (!masOk) { console.log(`✗ Mac App Store entitlements must name ${ids.production.cloudContainer} and nothing of Berean Dev`); problems++ }
else console.log(`✓ Mac App Store iCloud container: ${ids.production.cloudContainer}`)
// Berean Dev (mas-dev) entitlements: the development identity only.
const masDev = readFileSync(join(root, 'build/entitlements.mas.dev.plist'), 'utf8').replace(/<!--[\s\S]*?-->/g, '')
const devOk = hasString(masDev, ids.development.cloudContainer) && !hasString(masDev, ids.production.cloudContainer) && !hasString(masDev, `6C8RCZVUZR.${ids.production.bundleId}`) && !masDev.includes('com.apple.security.files.downloads')
if (!devOk) { console.log(`✗ Berean Dev entitlements must name only ${ids.development.cloudContainer}`); problems++ }
else console.log(`✓ Berean Dev entitlements: ${ids.development.cloudContainer} only`)

console.log(problems ? `\n${problems} problem(s) found` : '\nNo development-only code in the shipped artifacts.')
process.exit(problems ? 1 : 0)
