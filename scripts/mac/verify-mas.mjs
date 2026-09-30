#!/usr/bin/env node
// Inspects a SIGNED Mac App Store build and fails when it is not what its app identity requires
// (config/app-identity.json; docs/mac-app-store.md §6, §10). Read-only — it never modifies the bundle.
//
//   node scripts/mac/verify-mas.mjs [app]                        production (Berean): release/mas-arm64/Berean.app
//   node scripts/mac/verify-mas.mjs [app] --identity development  Berean Dev: release/mas-dev-arm64/Berean Dev.app
//
// Production: submittable — Apple Distribution, a distribution profile, no Downloads or
// development-only entitlement (App Review 2.4.5(i)), sandbox, iCloud Documents in
// iCloud.com.berean.app. Development: Apple Development, a development profile, the same
// entitlements in iCloud.com.berean.app.dev. Both: bundle ID, name, URL schemes, container, App
// Group and the compiled-in identity all match, and no value of the other identity appears.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { profileAuthorises, readProfileValue } from './profileAuthorises.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const identities = JSON.parse(readFileSync(join(root, 'config/app-identity.json'), 'utf8'))
const args = process.argv.slice(2)
const flag = args.indexOf('--identity')
const IDENTITY = flag >= 0 ? args[flag + 1] : 'production'
if (IDENTITY !== 'production' && IDENTITY !== 'development') { console.error(`verify-mas: --identity must be production or development, got ${IDENTITY}`); process.exit(2) }
const positional = args.filter((a, i) => !a.startsWith('--') && (flag < 0 || i !== flag + 1))
const ID = identities.identities[IDENTITY]
const OTHER = identities.identities[IDENTITY === 'production' ? 'development' : 'production']
const DEV = IDENTITY === 'development'
const app = resolve(positional[0] ?? join(root, DEV ? `release/mas-dev-arm64/${ID.appName}.app` : `release/mas-arm64/${ID.appName}.app`))
const BUNDLE_ID = ID.bundleId
const TEAM = identities.teamId
const CONTAINER = ID.cloudContainer
const FORBIDDEN = [
  'com.apple.security.files.downloads.read-only', // App Review 2.4.5(i), June 2026
  'com.apple.security.files.downloads.read-write',
  'com.apple.security.get-task-allow',
  'get-task-allow',
  'com.apple.security.network.server',
  'com.apple.security.cs.allow-dyld-environment-variables',
  'com.apple.security.cs.disable-library-validation',
  'com.apple.security.temporary-exception.files.absolute-path.read-write',
  'com.apple.security.temporary-exception.files.home-relative-path.read-write',
]

const eq0 = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const errors = []
const notes = []
const fail = (m) => errors.push(m)
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const toJson = (xml) => {
  const dir = mkdtempSync(join(tmpdir(), 'berean-verify-'))
  try {
    const f = join(dir, 'x.plist')
    writeFileSync(f, xml)
    return JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', f]))
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
const entitlements = (path) => {
  const xml = run('codesign', ['-d', '--entitlements', '-', '--xml', path])
  return xml.trim() ? toJson(xml) : {}
}

if (!existsSync(app)) {
  console.error(`verify-mas: ${app} not found — run npm run ${DEV ? 'build:mas:dev' : 'build:mas'} first`)
  process.exit(1)
}

// 1. Signature
try { run('codesign', ['--verify', '--deep', '--strict', app]) } catch (e) { fail(`codesign --verify failed: ${e.stderr || e.message}`) }
const sig = spawnSync('codesign', ['-dvv', app], { encoding: 'utf8' }).stderr ?? ''
const authority = (sig.match(/^Authority=(.*)$/m) ?? [])[1] ?? '(unsigned)'
if (DEV) {
  if (!/^(Apple Development|Mac Developer): /.test(authority)) fail(`signed by "${authority}" — ${ID.appName} (mas-dev) is signed with Apple Development`)
} else if (!/^(Apple Distribution|3rd Party Mac Developer Application): .*\(6C8RCZVUZR\)$/.test(authority)) fail(`signed by "${authority}" — the Mac App Store needs Apple Distribution (${TEAM})`)
if (!sig.includes(`TeamIdentifier=${TEAM}`)) fail(`TeamIdentifier is not ${TEAM}`)
if (/flags=.*runtime/.test(sig)) notes.push('hardened runtime is on (allowed, not required for the Mac App Store)')

// 2. Info.plist
const info = JSON.parse(run('plutil', ['-convert', 'json', '-o', '-', join(app, 'Contents/Info.plist')]))
if (info.CFBundleIdentifier !== BUNDLE_ID) fail(`CFBundleIdentifier ${info.CFBundleIdentifier} ≠ ${BUNDLE_ID}`)
if (info.CFBundleName !== ID.appName) fail(`CFBundleName ${info.CFBundleName} ≠ ${ID.appName}`)
const schemes = (info.CFBundleURLTypes ?? []).flatMap((t) => t.CFBundleURLSchemes ?? []).sort()
if (!eq0(schemes, [ID.urlScheme, ID.pdfUrlScheme].sort())) fail(`URL schemes ${JSON.stringify(schemes)} ≠ ${JSON.stringify([ID.urlScheme, ID.pdfUrlScheme])}`)
if (info.CFBundleShortVersionString !== pkg.version) fail(`CFBundleShortVersionString ${info.CFBundleShortVersionString} ≠ package.json ${pkg.version}`)
if (info.ITSAppUsesNonExemptEncryption !== false) fail('ITSAppUsesNonExemptEncryption is not false')
if (!info.LSApplicationCategoryType) fail('LSApplicationCategoryType missing')
if (!info.NSLocationWhenInUseUsageDescription) fail('NSLocationWhenInUseUsageDescription missing (location entitlement is declared)')

// 3. Main entitlements
const main = entitlements(app)
for (const k of FORBIDDEN) if (k in main) fail(`forbidden entitlement present: ${k}`)
if (main['com.apple.security.app-sandbox'] !== true) fail('App Sandbox is not enabled')
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
if (!eq(main['com.apple.developer.icloud-container-identifiers'], [CONTAINER])) fail(`icloud-container-identifiers ≠ [${CONTAINER}]`)
if (!eq(main['com.apple.developer.ubiquity-container-identifiers'], [CONTAINER])) fail(`ubiquity-container-identifiers ≠ [${CONTAINER}]`)
if (!eq(main['com.apple.developer.icloud-services'], ['CloudDocuments'])) fail('icloud-services ≠ [CloudDocuments]')
if (main['com.apple.developer.icloud-container-environment'] !== 'Production') fail('icloud-container-environment ≠ Production')
if (main['com.apple.application-identifier'] !== `${TEAM}.${BUNDLE_ID}`) fail(`application-identifier ≠ ${TEAM}.${BUNDLE_ID}`)
// Electron's Mach-port rendezvous: without TEAMID.bundle-id the sandboxed app crashes at launch.
if (!eq(main['com.apple.security.application-groups'], [`${TEAM}.${BUNDLE_ID}`])) fail(`application-groups ≠ [${TEAM}.${BUNDLE_ID}] (the MAS build would crash at launch)`)
if (info.ElectronTeamID !== TEAM) fail(`Info.plist ElectronTeamID ${info.ElectronTeamID} ≠ ${TEAM}`)
// Nothing of the other identity anywhere in the entitlements (bundle ID, container, groups).
const foreign = new Set([OTHER.bundleId, `${TEAM}.${OTHER.bundleId}`, OTHER.cloudContainer, OTHER.appGroup])
const values = (v) => (Array.isArray(v) ? v.flatMap(values) : v && typeof v === 'object' ? Object.values(v).flatMap(values) : [v])
for (const v of values(main)) if (foreign.has(v)) fail(`entitlements contain the other identity's value ${v}`)

// 3b. The JavaScript inside was compiled for this identity (electron/appIdentity.ts BUILD_IDENTITY).
try {
  const asar = createRequire(import.meta.url)('@electron/asar')
  const mainJs = asar.extractFile(join(app, 'Contents/Resources/app.asar'), 'out/main/index.js').toString('utf8')
  const built = /BUILD_IDENTITY\s*=\s*"(production|development)"/.exec(mainJs)?.[1]
  if (built && built !== IDENTITY) fail(`the bundled JavaScript was built for ${built}, not ${IDENTITY} (run the matching npm run build)`)
  else if (!built && DEV) fail('the bundled JavaScript has no identity marker (built before app identities, or not with BEREAN_IDENTITY=development)')
  else if (!built) notes.push('bundled JavaScript predates identity markers (built before app identities — production)')
} catch (e) { fail(`could not read out/main/index.js from app.asar: ${e.message}`) }

// 4. Every other signed Mach-O / bundle: sandbox + inherit only
const nested = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p, { throwIfNoEntry: false })
    if (!st) continue
    if (st.isDirectory()) {
      if (/\.(app|framework)$/.test(name)) nested.push(p)
      walk(p)
    }
  }
}
walk(join(app, 'Contents'))
for (const p of nested) {
  let e
  try { e = entitlements(p) } catch { continue }
  for (const k of FORBIDDEN) if (k in e) fail(`${p.slice(app.length)}: forbidden entitlement ${k}`)
  if (p.endsWith('.app') && (e['com.apple.security.app-sandbox'] !== true || e['com.apple.security.inherit'] !== true)) fail(`${p.slice(app.length)}: helper is not sandbox+inherit`)
}

// 5. iCloud helper
const helper = join(app, 'Contents/Resources/native/berean_icloud.node')
if (!existsSync(helper)) fail('Contents/Resources/native/berean_icloud.node missing (npm run build:mas builds it)')
else { try { run('codesign', ['--verify', '--strict', helper]) } catch { fail('berean_icloud.node is not signed') } }
if (!existsSync(join(app, 'Contents/Resources/data'))) fail('bundled Bible databases (Contents/Resources/data) missing')

// 6. Provisioning profile authorises the entitlements
const profilePath = join(app, 'Contents/embedded.provisionprofile')
if (!existsSync(profilePath)) fail('Contents/embedded.provisionprofile missing')
else {
  // A profile has <date>/<data> values plutil cannot turn into JSON, so read single keys.
  const dir = mkdtempSync(join(tmpdir(), 'berean-verify-'))
  const pf = join(dir, 'profile.plist')
  writeFileSync(pf, run('security', ['cms', '-D', '-i', profilePath]))
  const key = (k) => k.replace(/\./g, '\\.')
  const get = (path, fmt = 'json') => { if (fmt === 'json') return readProfileValue(pf, path); try { return run('plutil', ['-extract', path, fmt, '-o', '-', pf]).trim() } catch { return undefined } }
  const profile = { Name: get('Name', 'raw'), ExpirationDate: get('ExpirationDate', 'raw'), ProvisionedDevices: get('ProvisionedDevices') }
  const appId = get(`Entitlements.${key('com.apple.application-identifier')}`, 'raw') ?? get('Entitlements.application-identifier', 'raw')
  if (appId !== `${TEAM}.${BUNDLE_ID}`) fail(`profile App ID ${appId} ≠ ${TEAM}.${BUNDLE_ID}`)
  if (DEV && !profile.ProvisionedDevices) fail(`profile "${profile.Name}" is not a development profile (no devices) — ${ID.appName} uses a macOS App Development profile`)
  if (!DEV && profile.ProvisionedDevices) fail(`profile "${profile.Name}" is a development profile (has devices) — use a Mac App Store distribution profile`)
  if (new Date(profile.ExpirationDate) < new Date()) fail(`profile "${profile.Name}" expired ${profile.ExpirationDate}`)
  for (const k of ['com.apple.developer.icloud-container-identifiers', 'com.apple.developer.ubiquity-container-identifiers', 'com.apple.developer.icloud-services']) {
    const allowed = get(`Entitlements.${key(k)}`)
    const want = main[k] ?? []
    const ok = profileAuthorises(allowed, want)
    if (!ok) fail(`profile "${profile.Name}" does not authorise ${k} = ${JSON.stringify(want)} — regenerate the ${DEV ? 'development' : 'distribution'} profile after enabling iCloud (docs/mac-app-store.md §5)`)
  }
  rmSync(dir, { recursive: true, force: true })
  notes.push(`profile: ${profile.Name} (expires ${profile.ExpirationDate})`)
}

// 7. Installer package, when electron-builder produced one (production only — mas-dev has none)
const pkgFile = DEV || !existsSync(join(root, 'release')) ? null : readdirSync(join(root, 'release')).find((f) => f.endsWith('.pkg') && f.includes(pkg.version))
if (DEV) notes.push('development build — no installer package')
else if (pkgFile) {
  try { notes.push(run('pkgutil', ['--check-signature', join(root, 'release', pkgFile)]).split('\n').slice(0, 3).join(' | ')) } catch { fail(`${pkgFile} is not signed with a Mac Installer Distribution certificate`) }
} else notes.push('no .pkg in release/ (needs a "Mac Installer Distribution" certificate)')

console.log(`verify-mas: ${app}`)
console.log(`  ${info.CFBundleIdentifier} ${info.CFBundleShortVersionString} (${info.CFBundleVersion}) — ${authority}`)
for (const n of notes) console.log(`  · ${n}`)
if (errors.length) {
  for (const e of errors) console.error(`  ✗ ${e}`)
  console.error(`verify-mas: ${errors.length} problem(s) — not submittable`)
  process.exit(1)
}
console.log(DEV
  ? `verify-mas: OK — ${ID.appName} (${BUNDLE_ID}), Apple Development, sandboxed, iCloud Documents in ${CONTAINER} only`
  : 'verify-mas: OK — signed, sandboxed, no Downloads entitlement, iCloud Documents in the shared container')
