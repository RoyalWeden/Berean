import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { devBuildConfig, devProfileProblem, DEV_PROFILE, DEV_ENTITLEMENTS } from '../build-mas-dev.mjs'

// Berean Dev (npm run build:mas:dev) gets its own complete electron-builder configuration: arrays
// merge by union in electron-builder, so layering onto package.json would inherit the production
// URL schemes. Nothing of the production identity may survive into it.
const root = join(import.meta.dirname, '..', '..', '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const cfg = devBuildConfig(pkg.build)

describe('Berean Dev Mac build configuration', () => {
  it('is com.berean.app.dev, "Berean Dev", development schemes only', () => {
    expect(cfg.appId).toBe('com.berean.app.dev')
    expect(cfg.productName).toBe('Berean Dev')
    expect(cfg.protocols.flatMap((p) => p.schemes)).toEqual(['berean-dev', 'berean-dev-pdf'])
    expect(cfg.mac.target).toEqual([{ target: 'mas-dev', arch: ['arm64'] }])
  })

  it('signs with the development entitlements and the development profile only', () => {
    expect(cfg.mas.entitlements).toBe(DEV_ENTITLEMENTS)
    expect(cfg.mas.entitlements).toBe('build/entitlements.mas.dev.plist')
    expect(cfg.mas.provisioningProfile).toBe(DEV_PROFILE)
    expect(cfg.masDev.provisioningProfile).toBe(DEV_PROFILE)
    expect(DEV_PROFILE).not.toBe(pkg.build.mas.provisioningProfile)   // never the distribution profile
    expect(DEV_PROFILE).not.toBe('build/embedded.dev.provisionprofile') // nor the retired com.berean.app one
    expect(cfg.mas.hardenedRuntime).toBe(false)
    expect(cfg.publish).toBeUndefined()
  })

  it('contains no production identity value anywhere', () => {
    const text = JSON.stringify(cfg)
    for (const v of ['"com.berean.app"', '"berean"', '"berean-pdf"', 'build/entitlements.mas.plist"', 'build/embedded.provisionprofile"']) expect(text).not.toContain(v)
    expect(pkg.build.appId).toBe('com.berean.app')   // the production configuration itself is untouched
  })

  it('refuses a profile that is not for com.berean.app.dev', () => {
    expect(devProfileProblem(join(root, 'build/does-not-exist.provisionprofile'))).toMatch(/not found/)
    // The retired com.berean.app development profile, when present on this Mac (gitignored).
    const retired = [join(root, 'build/embedded.dev.provisionprofile'), '/Users/roywe/Berean/build/embedded.dev.provisionprofile'].find(existsSync)
    if (retired) expect(devProfileProblem(retired)).toMatch(/is for 6C8RCZVUZR\.com\.berean\.app, not 6C8RCZVUZR\.com\.berean\.app\.dev/)
  })
})
