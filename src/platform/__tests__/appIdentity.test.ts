import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import {
  appIdentity, otherIdentity, parseIdentityName, shareExtensionBundleId, macAppGroup, allDeepLinkSchemes,
  assertOwnContainer, isForeignContainerPath, containerFolderName,
} from '../appIdentity'

// ─── Berean vs Berean Dev: the identity boundary ─────────────────────────────
//
// Production and development are separate apps (config/app-identity.json;
// docs/mobile/icloud-lifecycle.md §6): bundle ID = local data/sandbox boundary,
// iCloud container = sync data boundary (iCloud Documents has no dev/prod split
// inside one container), App Group = Share Extension boundary, URL schemes = no
// cross-launch, userData folder = separate berean.db on the Mac.

const root = join(__dirname, '..', '..', '..')
const prod = appIdentity('production')
const dev = appIdentity('development')
const valuesOf = (i: ReturnType<typeof appIdentity>) => [i.bundleId, i.cloudContainer, i.appGroup, i.urlScheme, i.pdfUrlScheme, i.userDataDir, shareExtensionBundleId(i), macAppGroup(i)]

describe('app identities', () => {
  it('1. production resolves to com.berean.app / iCloud.com.berean.app / group.com.berean.app', () => {
    expect(prod).toMatchObject({ bundleId: 'com.berean.app', cloudContainer: 'iCloud.com.berean.app', appGroup: 'group.com.berean.app', appName: 'Berean' })
  })

  it('2. development resolves to com.berean.app.dev / iCloud.com.berean.app.dev / group.com.berean.app.dev', () => {
    expect(dev).toMatchObject({ bundleId: 'com.berean.app.dev', cloudContainer: 'iCloud.com.berean.app.dev', appGroup: 'group.com.berean.app.dev', appName: 'Berean Dev' })
  })

  it('3. development contains no production value', () => {
    for (const v of valuesOf(prod)) expect(valuesOf(dev), v).not.toContain(v)
  })

  it('4. production contains no development value', () => {
    for (const v of valuesOf(dev)) expect(valuesOf(prod), v).not.toContain(v)
  })

  it('5. development URL schemes are berean-dev / berean-dev-pdf', () => {
    expect([dev.urlScheme, dev.pdfUrlScheme]).toEqual(['berean-dev', 'berean-dev-pdf'])
  })

  it('6. production URL schemes remain berean / berean-pdf', () => {
    expect([prod.urlScheme, prod.pdfUrlScheme]).toEqual(['berean', 'berean-pdf'])
    expect(allDeepLinkSchemes().sort()).toEqual(['berean', 'berean-dev', 'berean-dev-pdf', 'berean-pdf'])
  })

  it('7. the Share Extension follows the app identity', () => {
    expect(shareExtensionBundleId(prod)).toBe('com.berean.app.share')
    expect(shareExtensionBundleId(dev)).toBe('com.berean.app.dev.share')
    expect(macAppGroup(prod)).toBe('6C8RCZVUZR.com.berean.app')
    expect(macAppGroup(dev)).toBe('6C8RCZVUZR.com.berean.app.dev')
    // iOS: the extension's bundle ID and group are derived from the app's build settings only.
    const pbx = readFileSync(join(root, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8')
    expect(pbx).toContain('PRODUCT_BUNDLE_IDENTIFIER = "$(BEREAN_BUNDLE_ID).share";')
    expect(readFileSync(join(root, 'ios/App/ShareExtension/Info.plist'), 'utf8')).toContain('<string>$(BEREAN_APP_GROUP)</string>')
  })

  it('13/14. the two local databases can never be the same folder', () => {
    expect(prod.userDataDir).toBe('Berean')
    expect(dev.userDataDir).toBe('Berean-dev')
    expect(prod.userDataDir.toLowerCase()).not.toBe(dev.userDataDir.toLowerCase())   // APFS is case-insensitive
    // main.ts sets userData from the identity for every run, packaged or not.
    const main = readFileSync(join(root, 'electron/main.ts'), 'utf8')
    expect(main).toContain("app.setPath('userData', join(app.getPath('appData'), APP_IDENTITY.userDataDir))")
    expect(main).not.toMatch(/setPath\('userData'[^\n]*'Berean/)
    // An unpackaged run is development whatever it was compiled as; packaged uses the build identity.
    expect(readFileSync(join(root, 'electron/appIdentity.ts'), 'utf8')).toContain("appIdentity(app.isPackaged ? parseIdentityName(BUILD_IDENTITY) : 'development')")
  })

  it('15/16. each identity accepts only its own container, and the other container folder is refused', () => {
    expect(() => assertOwnContainer(dev, 'iCloud.com.berean.app')).toThrow()
    expect(() => assertOwnContainer(prod, 'iCloud.com.berean.app.dev')).toThrow()
    expect(() => assertOwnContainer(dev, 'iCloud.com.berean.app.dev')).not.toThrow()
    expect(() => assertOwnContainer(prod, 'iCloud.com.berean.app')).not.toThrow()
    const prodDir = `/Users/x/Library/Mobile Documents/${containerFolderName(prod.cloudContainer)}/Documents/sync/v1`
    const devDir = `/Users/x/Library/Mobile Documents/${containerFolderName(dev.cloudContainer)}/Documents/sync/v1`
    expect(isForeignContainerPath(dev, prodDir)).toBe(true)
    expect(isForeignContainerPath(prod, devDir)).toBe(true)
    expect(isForeignContainerPath(dev, devDir)).toBe(false)   // iCloud~com~berean~app is not a prefix match
    expect(isForeignContainerPath(prod, prodDir)).toBe(false)
    expect(isForeignContainerPath(dev, '/Users/x/Library/Mobile Documents/com~apple~CloudDocs/Berean sync')).toBe(false)
    expect(() => parseIdentityName('staging')).toThrow()
    expect(() => parseIdentityName(undefined)).toThrow()
    expect(otherIdentity('development').name).toBe('production')
  })

  it('15/16. no active source file hard-codes an identity value (nothing can fall back across the boundary)', () => {
    // Identity values live only in config/app-identity.json (and the entitlement plists / release
    // verifiers, checked elsewhere). Code, Swift and plists derive them — comments may mention them.
    const LITERAL = /(?:iCloud\.|group\.)?com\.berean\.app(?:\.dev)?(?:\.share)?\b/
    const dirs = ['electron', 'src', 'ios/App/App', 'ios/App/ShareExtension', 'ios/App/BereanNative/Sources']
    const exts = /\.(ts|tsx|swift|plist|entitlements)$/
    const skip = /__tests__|\/public\/|\.test\.|appIdentity\.ts$|\/node_modules\//
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { if (!skip.test(`${p}/`)) walk(p); continue }
        if (!exts.test(name) || skip.test(p)) continue
        const code = readFileSync(p, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
        code.split('\n').forEach((line, i) => { if (LITERAL.test(line)) offenders.push(`${p.slice(root.length + 1)}:${i + 1}: ${line.trim()}`) })
      }
    }
    for (const d of dirs) walk(join(root, d))
    expect(offenders).toEqual([])
  })
})
