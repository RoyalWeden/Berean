/**
 * `npm run dev` must sync ONLY through Berean Dev's iCloud container (2026-10-18 — "make sure that
 * you absolutely don't interfere with the production icloud data"). Covers the one decision that
 * picks the identity for an unpackaged Mac run, the container path it leads to, and the file
 * store's refusals: a production-claimed folder, a path into the production container, and file
 * names / device ids that could leave this device's own folder.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const electronApp = { isPackaged: false }
vi.mock('electron', () => ({ app: electronApp }))

beforeEach(() => { vi.resetModules(); electronApp.isPackaged = false })

async function identityFor(packaged: boolean, built: string) {
  electronApp.isPackaged = packaged
  ;(globalThis as unknown as { __BEREAN_IDENTITY__: string }).__BEREAN_IDENTITY__ = built
  return (await import('../../appIdentity')).APP_IDENTITY
}

describe('npm run dev is Berean Dev', () => {
  it('an unpackaged run is development even when the bundle was built as production', async () => {
    const id = await identityFor(false, 'production')
    expect(id.name).toBe('development')
    expect(id.cloudContainer).toBe('iCloud.com.berean.app.dev')
    expect(id.userDataDir).toBe('Berean-dev')
  })

  it('a packaged production build stays production (the switch is only "packaged or not")', async () => {
    expect((await identityFor(true, 'production')).cloudContainer).toBe('iCloud.com.berean.app')
  })

  it("Dev's default sync folder is the ~dev container, which is never the production one", async () => {
    const id = await identityFor(false, 'production')
    const { ubiquityContainerPath } = await import('../fsSyncStore')
    const { isForeignContainerPath } = await import('../../../src/platform/appIdentity')
    const folder = `${ubiquityContainerPath(id.cloudContainer, '/Users/x')}/sync/v1`
    expect(folder).toBe('/Users/x/Library/Mobile Documents/iCloud~com~berean~app~dev/Documents/sync/v1')
    expect(isForeignContainerPath(id, folder)).toBe(false)
    expect(isForeignContainerPath(id, '/Users/x/Library/Mobile Documents/iCloud~com~berean~app/Documents/sync/v1')).toBe(true)
    expect(isForeignContainerPath(id, '/Users/x/Library/Mobile Documents/iCloud~com~berean~app/Documents/elsewhere')).toBe(true)
  })
})

describe('the Dev file store never writes into production data', () => {
  it('refuses a folder claimed by production and writes nothing there', async () => {
    const { FsSyncStore, IDENTITY_FILE } = await import('../fsSyncStore')
    const root = mkdtempSync(join(tmpdir(), 'berean-prod-'))
    writeFileSync(join(root, IDENTITY_FILE), JSON.stringify({ identity: 'production' }))
    mkdirSync(join(root, 'devices', 'prodmac'), { recursive: true })
    const dev = new FsSyncStore(root, 'devmac', null, null, 'development')
    expect((await dev.status()).available).toBe(false)
    await expect(dev.writeOwnFile('journal-000000001-000000001.jsonl', '{}\n')).rejects.toThrow(/belongs to the production Berean app/)
    await expect(dev.writeOwnManifest({ device: 'devmac' } as never)).rejects.toThrow(/production/)
    await expect(dev.deleteOwnFile('journal-000000001-000000001.jsonl')).rejects.toThrow(/production/)
    expect(readdirSync(join(root, 'devices'))).toEqual(['prodmac'])
  })

  it('refuses file names and device ids that could leave its own folder', async () => {
    const { FsSyncStore } = await import('../fsSyncStore')
    const root = mkdtempSync(join(tmpdir(), 'berean-dev-'))
    const dev = new FsSyncStore(root, 'devmac', null, null, 'development')
    await expect(dev.writeOwnFile('../otherdevice/manifest.json', 'x')).rejects.toThrow(/unsafe/)
    await expect(dev.deleteOwnFile('../../berean-identity.json')).rejects.toThrow(/unsafe/)
    await expect(new FsSyncStore(root, '../prod', null, null, 'development').writeOwnFile('manifest.json', 'x')).rejects.toThrow(/unsafe/)
    expect(existsSync(join(root, 'berean-identity.json'))).toBe(true) // still there, still development
    await dev.writeOwnFile('journal-000000001-000000001.jsonl', '{}\n')
    expect(readdirSync(join(root, 'devices', 'devmac'))).toContain('journal-000000001-000000001.jsonl')
  })
})
