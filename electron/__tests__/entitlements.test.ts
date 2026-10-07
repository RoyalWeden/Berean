import { describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'

// ─── Release entitlements for all three builds ───────────────────────────────
//
// Mac App Store (build/entitlements.mas.plist), direct download / DMG
// (build/entitlements.mac.plist) and iPhone (ios/App/App/App.entitlements) each
// get a different, deliberately minimal set (docs/mac-app-store.md §2).
//
// The one that matters most: App Review rejected Mac 0.2.1 (Guideline 2.4.5(i),
// June 2026) for `com.apple.security.files.downloads.read-only`, which no feature
// uses. It must never come back. scripts/mac/verify-mas.mjs repeats the check on
// the signed .app, since a signing step could in principle add keys the source
// plist does not have.

const root = join(__dirname, '..', '..')
const CONTAINER = 'iCloud.com.berean.app'

function plist(rel: string): Record<string, unknown> {
  return JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', join(root, rel)], { encoding: 'utf8' }))
}

describe.skipIf(process.platform !== 'darwin')('release entitlements', () => {
  it('MAS: no Downloads entitlement (App Review 2.4.5(i))', () => {
    const e = plist('build/entitlements.mas.plist')
    expect(Object.keys(e).filter((k) => k.startsWith('com.apple.security.files.downloads'))).toEqual([])
    expect(Object.keys(plist('build/entitlements.mas.inherit.plist')).filter((k) => k.includes('downloads'))).toEqual([])
  })

  it('MAS: sandboxed, iCloud Documents in the shared container, no CloudKit, no dev keys', () => {
    const e = plist('build/entitlements.mas.plist')
    expect(e['com.apple.security.app-sandbox']).toBe(true)
    expect(e['com.apple.developer.icloud-container-identifiers']).toEqual([CONTAINER])
    expect(e['com.apple.developer.ubiquity-container-identifiers']).toEqual([CONTAINER])
    expect(e['com.apple.developer.icloud-services']).toEqual(['CloudDocuments'])
    expect(e['com.apple.developer.icloud-container-environment']).toBe('Production')
    expect(e['com.apple.application-identifier']).toBe('6C8RCZVUZR.com.berean.app')
    // Electron's Mach-port rendezvous needs TEAMID.bundle-id (empty → crash at launch). The Mac
    // has no extension, so the iPhone's group.com.berean.app does not belong here.
    expect(e['com.apple.security.application-groups']).toEqual(['6C8RCZVUZR.com.berean.app'])
    for (const k of ['com.apple.security.get-task-allow', 'get-task-allow', 'com.apple.security.network.server', 'com.apple.security.cs.allow-dyld-environment-variables', 'com.apple.security.cs.disable-library-validation']) {
      expect(e[k], k).toBeUndefined()
    }
  })

  it('9. Berean Dev MAS entitlements are development-only (iCloud.com.berean.app.dev, 6C8RCZVUZR.com.berean.app.dev)', () => {
    const d = plist('build/entitlements.mas.dev.plist')
    expect(d['com.apple.developer.icloud-container-identifiers']).toEqual(['iCloud.com.berean.app.dev'])
    expect(d['com.apple.developer.ubiquity-container-identifiers']).toEqual(['iCloud.com.berean.app.dev'])
    expect(d['com.apple.application-identifier']).toBe('6C8RCZVUZR.com.berean.app.dev')
    expect(d['com.apple.security.application-groups']).toEqual(['6C8RCZVUZR.com.berean.app.dev'])
    const text = JSON.stringify(d)
    for (const prodValue of ['"iCloud.com.berean.app"', '"6C8RCZVUZR.com.berean.app"', '"group.com.berean.app"']) expect(text).not.toContain(prodValue)
    // 8. …and production names nothing of Berean Dev.
    expect(JSON.stringify(plist('build/entitlements.mas.plist'))).not.toContain('com.berean.app.dev')
  })

  it('10/11. Berean Dev keeps every MAS requirement and differs from production ONLY in identity values', () => {
    const p = plist('build/entitlements.mas.plist')
    const d = plist('build/entitlements.mas.dev.plist')
    expect(Object.keys(d).sort()).toEqual(Object.keys(p).sort())
    const differing = Object.keys(p).filter((k) => JSON.stringify(p[k]) !== JSON.stringify(d[k])).sort()
    expect(differing).toEqual([
      'com.apple.application-identifier',
      'com.apple.developer.icloud-container-identifiers',
      'com.apple.developer.ubiquity-container-identifiers',
      'com.apple.security.application-groups',
    ])
    expect(Object.keys(d).filter((k) => k.includes('downloads'))).toEqual([])
    for (const k of ['com.apple.security.app-sandbox', 'com.apple.security.files.user-selected.read-write', 'com.apple.security.files.bookmarks.app-scope', 'com.apple.security.network.client', 'com.apple.security.personal-information.location', 'com.apple.security.print', 'com.apple.security.cs.allow-jit', 'com.apple.security.cs.allow-unsigned-executable-memory']) {
      expect(d[k], k).toBe(true)
    }
    expect(d['com.apple.developer.icloud-services']).toEqual(['CloudDocuments'])
  })

  it('MAS helpers inherit the sandbox and nothing else', () => {
    expect(plist('build/entitlements.mas.inherit.plist')).toEqual({ 'com.apple.security.app-sandbox': true, 'com.apple.security.inherit': true })
  })

  it('DMG: not sandboxed and unchanged (hardened runtime keys only)', () => {
    const e = plist('build/entitlements.mac.plist')
    expect(e['com.apple.security.app-sandbox']).toBeUndefined()
    expect(Object.keys(e).sort()).toEqual([
      'com.apple.security.cs.allow-dyld-environment-variables',
      'com.apple.security.cs.allow-jit',
      'com.apple.security.cs.allow-unsigned-executable-memory',
    ])
  })

  it('iPhone: iCloud Documents + App Group through the xcconfig variables', () => {
    const e = plist('ios/App/App/App.entitlements')
    expect(e['com.apple.developer.icloud-services']).toEqual(['CloudDocuments'])
    expect(e['com.apple.developer.icloud-container-identifiers']).toEqual(['$(BEREAN_ICLOUD_CONTAINER)'])
    expect(e['com.apple.developer.ubiquity-container-identifiers']).toEqual(['$(BEREAN_ICLOUD_CONTAINER)'])
    expect(e['com.apple.security.application-groups']).toEqual(['$(BEREAN_APP_GROUP)'])
    expect(plist('ios/App/ShareExtension/ShareExtension.entitlements')).toEqual({ 'com.apple.security.application-groups': ['$(BEREAN_APP_GROUP)'] })
    // Identity values come only from the generated Identity.xcconfig, included LAST (after the
    // developer's Signing.xcconfig, which therefore cannot override them) and required.
    const xc = readFileSync(join(root, 'ios/App/Berean.xcconfig'), 'utf8')
    expect(xc).not.toMatch(/^BEREAN_(BUNDLE_ID|ICLOUD_CONTAINER|APP_GROUP)\s*=/m)
    expect(xc.indexOf('#include "Identity.xcconfig"')).toBeGreaterThan(xc.indexOf('#include? "Signing.xcconfig"'))
    expect(xc).not.toContain('#include? "Identity.xcconfig"')
    // Info.plists: display name, schemes and the iCloud Drive folder follow the identity.
    const app = readFileSync(join(root, 'ios/App/App/Info.plist'), 'utf8')
    for (const v of ['$(BEREAN_DISPLAY_NAME)', '$(BEREAN_URL_SCHEME)', '$(BEREAN_PDF_URL_SCHEME)', '<key>BereanURLScheme</key>']) expect(app, v).toContain(v)
    expect(app).not.toMatch(/<string>berean(-pdf)?<\/string>/)
    const ext = readFileSync(join(root, 'ios/App/ShareExtension/Info.plist'), 'utf8')
    for (const v of ['$(BEREAN_DISPLAY_NAME)', '$(BEREAN_APP_GROUP)', '$(BEREAN_URL_SCHEME)']) expect(ext, v).toContain(v)
  })

  it('iPhone location: When In Use only, and the Always-capable geolocation plugin is not linked (ITMS-90683)', () => {
    const info = plist('ios/App/App/Info.plist')
    expect(info.NSLocationWhenInUseUsageDescription).toMatch(/sunrise/)
    expect(info.NSLocationAlwaysAndWhenInUseUsageDescription).toBeUndefined()
    expect(info.NSLocationAlwaysUsageDescription).toBeUndefined()
    expect(info.UIBackgroundModes).not.toContain('location')
    const cap = readFileSync(join(root, 'capacitor.config.ts'), 'utf8')
    const block = /includePlugins:\s*\[([\s\S]*?)\]/.exec(cap)?.[1] ?? ''
    const included = [...block.matchAll(/'(@capacitor\/[a-z-]+)'/g)].map((m) => m[1])
    expect(included).not.toContain('@capacitor/geolocation')
    // Every other installed native plugin must stay in the list, or it silently drops off iOS.
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    const plugins = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
      .filter((n) => n.startsWith('@capacitor/') && !['@capacitor/cli', '@capacitor/core', '@capacitor/ios', '@capacitor/geolocation'].includes(n))
    expect(included.sort()).toEqual(plugins.sort())
    expect(readFileSync(join(root, 'src/platform/ios/location.ts'), 'utf8')).not.toContain('@capacitor/geolocation')
  })

  it('package.json: one bundle id for every platform, MAS build uses the MAS plists', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(pkg.build.appId).toBe('com.berean.app')
    expect(pkg.build.mac.entitlements).toBe('build/entitlements.mac.plist')
    expect(pkg.build.mas.entitlements).toBe('build/entitlements.mas.plist')
    expect(pkg.build.mas.entitlementsInherit).toBe('build/entitlements.mas.inherit.plist')
    expect(pkg.build.mas.extraResources).toEqual([{ from: 'build/native', to: 'native', filter: ['berean_icloud.node', 'berean_glass.node'] }])
    expect(pkg.scripts['build:mas']).toContain('scripts/mac/build-native.mjs')
    expect(pkg.scripts['build:mas']).toContain('scripts/mac/verify-mas.mjs')
    // 12. The DMG / Developer ID and production MAS builds stay on the production identity.
    expect(pkg.build.productName).toBe('Berean')
    expect(pkg.build.protocols).toEqual([{ name: 'Berean deep link', schemes: ['berean', 'berean-pdf'] }])
    expect(pkg.build.mac.hardenedRuntime).toBe(true)
    expect(pkg.build.mas.provisioningProfile).toBe('build/embedded.provisionprofile')
    expect(pkg.scripts['build:local']).toBe('npm run build && electron-builder --mac --publish never')
    // Berean Dev is built only by scripts/mac/build-mas-dev.mjs (its own complete configuration):
    // package.json has no masDev section that could produce a com.berean.app development build.
    expect(pkg.build.masDev).toBeUndefined()
    expect(pkg.scripts['build:mas:dev']).toBe('BEREAN_IDENTITY=development npm run build && node scripts/mac/build-native.mjs && node scripts/mac/build-mas-dev.mjs')
    expect(pkg.scripts['build:mas']).not.toContain('BEREAN_IDENTITY')
    // The iOS Version.xcconfig is generated from package.json.
    const v = readFileSync(join(root, 'ios/App/Version.xcconfig'), 'utf8')
    expect(v).toContain(`MARKETING_VERSION = ${pkg.version}`)
  })
})
