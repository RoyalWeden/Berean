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
    const xc = readFileSync(join(root, 'ios/App/Berean.xcconfig'), 'utf8')
    expect(xc).toMatch(/^BEREAN_BUNDLE_ID = com\.berean\.app$/m)
    expect(xc).toMatch(/^BEREAN_ICLOUD_CONTAINER = iCloud\.com\.berean\.app$/m)
    expect(xc).toMatch(/^BEREAN_APP_GROUP = group\.com\.berean\.app$/m)
  })

  it('package.json: one bundle id for every platform, MAS build uses the MAS plists', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(pkg.build.appId).toBe('com.berean.app')
    expect(pkg.build.mac.entitlements).toBe('build/entitlements.mac.plist')
    expect(pkg.build.mas.entitlements).toBe('build/entitlements.mas.plist')
    expect(pkg.build.mas.entitlementsInherit).toBe('build/entitlements.mas.inherit.plist')
    expect(pkg.build.mas.extraResources).toEqual([{ from: 'build/native', to: 'native', filter: ['berean_icloud.node'] }])
    expect(pkg.scripts['build:mas']).toContain('scripts/mac/build-native.mjs')
    expect(pkg.scripts['build:mas']).toContain('scripts/mac/verify-mas.mjs')
    // The iOS Version.xcconfig is generated from package.json.
    const v = readFileSync(join(root, 'ios/App/Version.xcconfig'), 'utf8')
    expect(v).toContain(`MARKETING_VERSION = ${pkg.version}`)
  })
})
