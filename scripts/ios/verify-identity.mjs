#!/usr/bin/env node
// Checks a BUILT iOS app (App.app or an .xcarchive) against its app identity
// (config/app-identity.json): bundle IDs, display name, URL schemes, iCloud container, App Group
// and the Share Extension, in both Info.plists and the signed entitlements — and that no value of
// the other identity appears. Read-only. Run by scripts/ios/build.sh after an archive.
//
//   node scripts/ios/verify-identity.mjs <App.app | Berean.xcarchive> [--identity production|development]
//
// The identity defaults to the one in ios/App/Identity.xcconfig (the one the build used).
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const identities = JSON.parse(readFileSync(join(root, 'config/app-identity.json'), 'utf8'))
const args = process.argv.slice(2)
const flag = args.indexOf('--identity')
const fromXcconfig = () => /BEREAN_IDENTITY = (\w+)/.exec(readFileSync(join(root, 'ios/App/Identity.xcconfig'), 'utf8'))?.[1]
const name = flag >= 0 ? args[flag + 1] : fromXcconfig()
if (name !== 'production' && name !== 'development') { console.error(`verify-identity: unknown identity ${name}`); process.exit(2) }
const target = resolve(args.find((a, i) => !a.startsWith('--') && (flag < 0 || i !== flag + 1)) ?? join(root, 'ios/App/build/Berean.xcarchive'))
const app = target.endsWith('.xcarchive') ? join(target, 'Products/Applications/App.app') : target
if (!existsSync(app)) { console.error(`verify-identity: ${app} not found`); process.exit(1) }

const ID = identities.identities[name]
const OTHER = identities.identities[name === 'production' ? 'development' : 'production']
const errors = []
const fail = (m) => errors.push(m)
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const plist = (file) => JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', file], { encoding: 'utf8' }))
const entitlements = (bundle) => {
  const xml = execFileSync('codesign', ['-d', '--entitlements', '-', '--xml', bundle], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  return xml.trim() ? JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', '-'], { input: xml, encoding: 'utf8' })) : {}
}
const values = (v) => (Array.isArray(v) ? v.flatMap(values) : v && typeof v === 'object' ? [...Object.keys(v), ...Object.values(v).flatMap(values)] : [v])
const foreign = new Set([OTHER.bundleId, `${OTHER.bundleId}.share`, OTHER.cloudContainer, OTHER.appGroup, OTHER.urlScheme, OTHER.pdfUrlScheme])
const noForeign = (label, obj) => { for (const v of values(obj)) if (typeof v === 'string' && foreign.has(v)) fail(`${label} contains the other identity's value ${v}`) }

// App
const info = plist(join(app, 'Info.plist'))
if (info.CFBundleIdentifier !== ID.bundleId) fail(`app bundle ID ${info.CFBundleIdentifier} ≠ ${ID.bundleId}`)
if (info.CFBundleDisplayName !== ID.appName) fail(`display name ${info.CFBundleDisplayName} ≠ ${ID.appName}`)
if (info.BereanICloudContainer !== ID.cloudContainer) fail(`BereanICloudContainer ${info.BereanICloudContainer} ≠ ${ID.cloudContainer}`)
if (info.BereanAppGroup !== ID.appGroup) fail(`BereanAppGroup ${info.BereanAppGroup} ≠ ${ID.appGroup}`)
if (info.BereanURLScheme !== ID.urlScheme) fail(`BereanURLScheme ${info.BereanURLScheme} ≠ ${ID.urlScheme}`)
const schemes = (info.CFBundleURLTypes ?? []).flatMap((t) => t.CFBundleURLSchemes ?? []).sort()
if (!eq(schemes, [ID.urlScheme, ID.pdfUrlScheme].sort())) fail(`URL schemes ${JSON.stringify(schemes)} ≠ ${JSON.stringify([ID.urlScheme, ID.pdfUrlScheme])}`)
const ubiq = info.NSUbiquitousContainers ?? {}
if (!eq(Object.keys(ubiq), [ID.cloudContainer])) fail(`NSUbiquitousContainers keys ${JSON.stringify(Object.keys(ubiq))} ≠ [${ID.cloudContainer}]`)
else if (ubiq[ID.cloudContainer].NSUbiquitousContainerName !== ID.appName) fail(`iCloud Drive folder name ${ubiq[ID.cloudContainer].NSUbiquitousContainerName} ≠ ${ID.appName}`)
noForeign('app Info.plist', info)
const ent = entitlements(app)
if (!eq(ent['com.apple.developer.icloud-container-identifiers'], [ID.cloudContainer])) fail(`app icloud-container-identifiers ≠ [${ID.cloudContainer}]`)
if (!eq(ent['com.apple.developer.ubiquity-container-identifiers'], [ID.cloudContainer])) fail(`app ubiquity-container-identifiers ≠ [${ID.cloudContainer}]`)
if (!eq(ent['com.apple.security.application-groups'], [ID.appGroup])) fail(`app application-groups ≠ [${ID.appGroup}]`)
noForeign('app entitlements', ent)

// Share Extension
const ext = join(app, 'PlugIns/ShareExtension.appex')
if (!existsSync(ext)) fail('PlugIns/ShareExtension.appex missing')
else {
  const extInfo = plist(join(ext, 'Info.plist'))
  if (extInfo.CFBundleIdentifier !== `${ID.bundleId}.share`) fail(`share extension bundle ID ${extInfo.CFBundleIdentifier} ≠ ${ID.bundleId}.share`)
  if (extInfo.BereanAppGroup !== ID.appGroup) fail(`share extension BereanAppGroup ${extInfo.BereanAppGroup} ≠ ${ID.appGroup}`)
  if (extInfo.BereanURLScheme !== ID.urlScheme) fail(`share extension BereanURLScheme ${extInfo.BereanURLScheme} ≠ ${ID.urlScheme}`)
  noForeign('share extension Info.plist', extInfo)
  const extEnt = entitlements(ext)
  if (!eq(extEnt['com.apple.security.application-groups'], [ID.appGroup])) fail(`share extension application-groups ≠ [${ID.appGroup}]`)
  noForeign('share extension entitlements', extEnt)
}

console.log(`verify-identity: ${target}`)
console.log(`  ${name}: ${info.CFBundleIdentifier} "${info.CFBundleDisplayName}" ${info.CFBundleShortVersionString} (${info.CFBundleVersion})`)
if (errors.length) {
  for (const e of errors) console.error(`  ✗ ${e}`)
  console.error(`verify-identity: ${errors.length} problem(s)`)
  process.exit(1)
}
console.log(`verify-identity: OK — ${ID.appName} (${ID.bundleId}), ${ID.cloudContainer}, ${ID.appGroup}, ${ID.urlScheme}://`)
