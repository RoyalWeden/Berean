/**
 * TEST 2026-10-01 — `ios:sync` + Xcode ▶ Run installed com.berean.app (production) over the App Store
 * Berean on the iPhone. Debug (every Run) is now ALWAYS Berean Dev; Release (archives) keeps the
 * synced identity; a build-phase safety check fails any Debug build that is not Berean Dev.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '../..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')
const config = JSON.parse(read('config/app-identity.json'))
const dev = config.identities.development
const prod = config.identities.production

describe('iOS identity per build configuration', () => {
  it('BereanDebug.xcconfig includes the development identity LAST; Release does not', () => {
    const debug = read('ios/App/BereanDebug.xcconfig').split('\n').filter((l) => l.startsWith('#include'))
    expect(debug.at(-1)).toBe('#include "IdentityDevelopment.xcconfig"')
    expect(debug.indexOf('#include "Berean.xcconfig"')).toBeLessThan(debug.length - 1)
    expect(read('ios/App/BereanRelease.xcconfig')).not.toContain('IdentityDevelopment')
  })

  it('identity.mjs writes the Release identity as asked AND always a development Debug identity', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'berean-identity-'))
    try {
      mkdirSync(join(tmp, 'config')); mkdirSync(join(tmp, 'ios/App'), { recursive: true })
      copyFileSync(join(root, 'config/app-identity.json'), join(tmp, 'config/app-identity.json'))
      execFileSync('node', [join(root, 'scripts/ios/identity.mjs')], { cwd: tmp, env: { ...process.env, BEREAN_IDENTITY: 'production' } })
      const release = readFileSync(join(tmp, 'ios/App/Identity.xcconfig'), 'utf8')
      const debug = readFileSync(join(tmp, 'ios/App/IdentityDevelopment.xcconfig'), 'utf8')
      expect(release).toContain(`BEREAN_BUNDLE_ID = ${prod.bundleId}`)
      expect(debug).toContain(`BEREAN_BUNDLE_ID = ${dev.bundleId}`)
      expect(debug).toContain('BEREAN_IDENTITY = development')
      expect(debug).toContain(`BEREAN_ICLOUD_CONTAINER = ${dev.cloudContainer}`)
      expect(debug).toContain(`BEREAN_APP_GROUP = ${dev.appGroup}`)
      expect(debug).not.toContain(prod.cloudContainer + '\n')
    } finally { rmSync(tmp, { recursive: true, force: true }) }
  })

  it('the Xcode project runs the Berean Dev safety check first in the App target', () => {
    const pbx = read('ios/App/App.xcodeproj/project.pbxproj')
    expect(pbx).toMatch(/buildPhases = \(\n\t+\w+ \/\* Berean Dev safety check \*\/,/)
    expect(pbx).toContain('scripts/ios/dev-safety-check.sh')
  })
})

describe('dev-safety-check.sh', () => {
  const run = (env: Record<string, string>) => spawnSync('sh', [join(root, 'scripts/ios/dev-safety-check.sh')], { env: { PATH: process.env.PATH ?? '', ...env }, encoding: 'utf8' })
  const devEnv = { CONFIGURATION: 'Debug', PRODUCT_BUNDLE_IDENTIFIER: dev.bundleId, BEREAN_IDENTITY: 'development', BEREAN_BUNDLE_ID: dev.bundleId, BEREAN_DISPLAY_NAME: dev.appName, BEREAN_ICLOUD_CONTAINER: dev.cloudContainer, BEREAN_APP_GROUP: dev.appGroup, BEREAN_URL_SCHEME: dev.urlScheme }

  it('passes a Berean Dev Debug build', () => {
    const r = run(devEnv)
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('Berean Dev safety check: OK')
  })
  it('FAILS a Debug build with the production identity, naming expected and actual bundle IDs', () => {
    const r = run({ ...devEnv, PRODUCT_BUNDLE_IDENTIFIER: prod.bundleId, BEREAN_IDENTITY: 'production', BEREAN_BUNDLE_ID: prod.bundleId, BEREAN_ICLOUD_CONTAINER: prod.cloudContainer, BEREAN_APP_GROUP: prod.appGroup })
    expect(r.status).toBe(1)
    expect(r.stdout).toContain('IOS DEV BUILD SAFETY CHECK FAILED')
    expect(r.stdout).toContain(`Expected bundle ID: ${dev.bundleId}`)
    expect(r.stdout).toContain(`Actual bundle ID: ${prod.bundleId}`)
    expect(r.stdout).toContain('Share Extension bundle ID')
  })
  it('a single wrong value (App Group) still fails', () => {
    expect(run({ ...devEnv, BEREAN_APP_GROUP: prod.appGroup }).status).toBe(1)
  })
  it('Release (archive) builds pass through to verify-identity', () => {
    expect(run({ CONFIGURATION: 'Release', PRODUCT_BUNDLE_IDENTIFIER: prod.bundleId }).status).toBe(0)
  })
})
