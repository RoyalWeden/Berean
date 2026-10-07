/**
 * scripts/ios/check-setup.mjs — the preflight behind "Missing package product 'app_CapacitorApp'":
 * plugin packages must exist AND live inside this checkout (Xcode opens a local Swift package in
 * only one workspace, so a worktree sharing main's node_modules breaks whichever opens second).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
// @ts-expect-error — plain ESM script without types
import { checkIosSetup, packageSwiftLocalPaths } from '../ios/check-setup.mjs'

let base: string
const plugins = ['app', 'share']
function checkout(name: string, { nodeModules = 'real' as 'real' | 'missing' | 'linkTo', linkTarget = '' } = {}) {
  const root = join(base, name)
  mkdirSync(join(root, 'ios/App/CapApp-SPM'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: Object.fromEntries([...plugins.map((p) => [`@capacitor/${p}`, '1']), ['@capacitor/core', '1'], ['@capacitor/ios', '1']]) }))
  writeFileSync(join(root, 'ios/App/CapApp-SPM/Package.swift'), plugins.map((p) => `.package(name: "Capacitor${p}", path: "../../../node_modules/@capacitor/${p}"),`).join('\n'))
  if (nodeModules === 'real') for (const p of plugins) { mkdirSync(join(root, 'node_modules/@capacitor', p), { recursive: true }); writeFileSync(join(root, 'node_modules/@capacitor', p, 'Package.swift'), '') }
  if (nodeModules === 'linkTo') symlinkSync(join(linkTarget, 'node_modules'), join(root, 'node_modules'))
  return root
}
beforeEach(() => { base = mkdtempSync(join(tmpdir(), 'berean-ioscheck-')) })
afterEach(() => { rmSync(base, { recursive: true, force: true }) })

describe('iOS setup check', () => {
  it('a checkout with its own plugin packages is ready', () => {
    expect(checkIosSetup(checkout('main'))).toEqual([])
  })
  it('missing node_modules → one clear repair message', () => {
    const p = checkIosSetup(checkout('wt', { nodeModules: 'missing' }), { worktree: true })
    expect(p).toHaveLength(1)
    expect(p[0]).toMatch(/node_modules is missing.*setup:worktree/)
  })
  it('a worktree whose node_modules is a symlink to main fails (the Missing package product case)', () => {
    const main = checkout('main')
    const p = checkIosSetup(checkout('wt', { nodeModules: 'linkTo', linkTarget: main }), { worktree: true })
    expect(p.some((x: string) => /@capacitor\/app resolves to .*outside this checkout/.test(x))).toBe(true)
    expect(p.every((x: string) => x.includes('npm run setup:worktree'))).toBe(true)
  })
  it('a plugin without Package.swift is reported', () => {
    const root = checkout('main')
    rmSync(join(root, 'node_modules/@capacitor/share/Package.swift'))
    expect(checkIosSetup(root).join('\n')).toMatch(/@capacitor\/share is not installed/)
  })
  it('parses the generated Package.swift local paths', () => {
    expect(packageSwiftLocalPaths('.package(name: "CapacitorApp", path: "../../../node_modules/@capacitor/app"),')).toEqual([{ name: 'CapacitorApp', path: '../../../node_modules/@capacitor/app' }])
  })
})
