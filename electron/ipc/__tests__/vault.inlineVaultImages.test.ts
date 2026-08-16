import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Same main-process-module mocking as vault.extractInlineImages.test.ts — inlineVaultImages
// (like extractInlineImages) is pure fs/path logic, but the module it lives in imports real
// Electron/DB modules at top level.
import { vi } from 'vitest'
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', isPackaged: false, whenReady: () => Promise.resolve() },
  BrowserWindow: class {},
}))
vi.mock('chokidar', () => ({ default: { watch: () => ({ on: () => {}, close: () => {} }) } }))
vi.mock('../../db/berean', () => ({ getBereanDb: () => { throw new Error('not used') } }))
vi.mock('../../db/bible', () => ({ getTextDb: () => null }))
vi.mock('../powerAwareness', () => ({ getResourceMode: () => 'normal' }))

const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

describe('inlineVaultImages (vault import / reconcile) — round trip with extractInlineImages', () => {
  let extractInlineImages: typeof import('../vault').extractInlineImages
  let inlineVaultImages: typeof import('../vault').inlineVaultImages
  let tmpVault: string

  beforeAll(async () => {
    ;({ extractInlineImages, inlineVaultImages } = await import('../vault'))
  })

  afterEach(() => {
    if (tmpVault && existsSync(tmpVault)) rmSync(tmpVault, { recursive: true, force: true })
  })

  function makeVault(): string {
    tmpVault = mkdtempSync(join(tmpdir(), 'berean-vault-test-'))
    return tmpVault
  }

  it('passes through markdown with no relative image references unchanged (fast path)', () => {
    const vault = makeVault()
    const md = 'Just plain text, no images here.'
    expect(inlineVaultImages(md, vault, vault)).toBe(md)
  })

  it('does not touch already-inline data: URLs or remote http(s) images', () => {
    const vault = makeVault()
    const md = `![a](data:image/png;base64,${TINY_PNG_B64}) and ![b](https://example.com/x.png)`
    expect(inlineVaultImages(md, vault, vault)).toBe(md)
  })

  it('re-inlines a relative attachments/ reference back to the original base64 data URL', () => {
    const vault = makeVault()
    const original = `![a photo](data:image/png;base64,${TINY_PNG_B64})`
    const exported = extractInlineImages(original, vault, vault)
    expect(exported).not.toContain('data:image') // sanity: export did rewrite it

    const reinlined = inlineVaultImages(exported, vault, vault)
    expect(reinlined).toBe(original) // byte-identical round trip
  })

  it('round-trips correctly for a note nested in a subfolder', () => {
    const vault = makeVault()
    const noteDir = join(vault, 'Old Testament', 'Genesis')
    const original = `![img](data:image/png;base64,${TINY_PNG_B64})`
    const exported = extractInlineImages(original, vault, noteDir)
    const reinlined = inlineVaultImages(exported, vault, noteDir)
    expect(reinlined).toBe(original)
  })

  it('preserves a |wNNN resize suffix on the alt text through the full round trip', () => {
    const vault = makeVault()
    const original = `![screenshot|w320](data:image/png;base64,${TINY_PNG_B64})`
    const exported = extractInlineImages(original, vault, vault)
    const reinlined = inlineVaultImages(exported, vault, vault)
    expect(reinlined).toBe(original)
  })

  it('leaves a reference to a missing file untouched rather than corrupting it', () => {
    const vault = makeVault()
    const md = '![gone](attachments/doesnotexist.png)'
    expect(inlineVaultImages(md, vault, vault)).toBe(md)
  })

  it('refuses to read outside the vault root (path traversal safety)', () => {
    const vault = makeVault()
    const md = '![evil](../../../../etc/passwd)'
    expect(inlineVaultImages(md, vault, vault)).toBe(md)
  })
})
