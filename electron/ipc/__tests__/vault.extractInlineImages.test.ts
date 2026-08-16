import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// vault.ts imports real Electron/main-process modules at module scope (BrowserWindow, app,
// chokidar, the SQLite DB wrappers) that don't exist under plain vitest — same reasoning
// aiLookup.scopeDetection.test.ts's own comment documents for that file. None of it is touched
// by extractInlineImages (pure fs/path/crypto), so everything just needs to not throw on import.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', isPackaged: false, whenReady: () => Promise.resolve() },
  BrowserWindow: class {},
}))
vi.mock('chokidar', () => ({ default: { watch: () => ({ on: () => {}, close: () => {} }) } }))
vi.mock('../../db/berean', () => ({ getBereanDb: () => { throw new Error('not used') } }))
vi.mock('../../db/bible', () => ({ getTextDb: () => null }))
vi.mock('../powerAwareness', () => ({ getResourceMode: () => 'normal' }))

// A minimal real PNG (1x1 transparent pixel) — small, valid image bytes so base64-decoding and
// re-writing to disk is exercised for real, not just string manipulation.
const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

describe('extractInlineImages (vault export)', () => {
  let extractInlineImages: typeof import('../vault').extractInlineImages
  let tmpVault: string

  beforeAll(async () => {
    ;({ extractInlineImages } = await import('../vault'))
  })

  afterEach(() => {
    if (tmpVault && existsSync(tmpVault)) rmSync(tmpVault, { recursive: true, force: true })
  })

  function makeVault(): string {
    tmpVault = mkdtempSync(join(tmpdir(), 'berean-vault-test-'))
    return tmpVault
  }

  it('passes through markdown with no embedded images unchanged (fast path)', () => {
    const vault = makeVault()
    const md = 'Just plain text, no images here.'
    expect(extractInlineImages(md, vault, vault)).toBe(md)
  })

  it('extracts a base64 image into attachments/ and rewrites the reference to a relative path', () => {
    const vault = makeVault()
    const md = `![a photo](data:image/png;base64,${TINY_PNG_B64})`
    const out = extractInlineImages(md, vault, vault)
    expect(out).not.toContain('data:image')
    expect(out).toMatch(/^!\[a photo\]\(attachments\/[0-9a-f]{16}\.png\)$/)
    const writtenFiles = readdirSync(join(vault, 'attachments'))
    expect(writtenFiles).toHaveLength(1)
    expect(readFileSync(join(vault, 'attachments', writtenFiles[0]))).toEqual(Buffer.from(TINY_PNG_B64, 'base64'))
  })

  it('computes the relative path correctly for a note nested in a subfolder', () => {
    const vault = makeVault()
    const noteDir = join(vault, 'Old Testament', 'Genesis')
    const md = `![img](data:image/png;base64,${TINY_PNG_B64})`
    const out = extractInlineImages(md, vault, noteDir)
    expect(out).toMatch(/^!\[img\]\(\.\.\/\.\.\/attachments\/[0-9a-f]{16}\.png\)$/)
  })

  it('deduplicates identical images onto the same file (content-hashed filename)', () => {
    const vault = makeVault()
    const md1 = `![first](data:image/png;base64,${TINY_PNG_B64})`
    const md2 = `![second copy](data:image/png;base64,${TINY_PNG_B64})`
    extractInlineImages(md1, vault, vault)
    extractInlineImages(md2, vault, vault)
    expect(readdirSync(join(vault, 'attachments'))).toHaveLength(1)
  })

  it('preserves a |wNNN resize suffix on the alt text untouched', () => {
    const vault = makeVault()
    const md = `![screenshot|w320](data:image/png;base64,${TINY_PNG_B64})`
    const out = extractInlineImages(md, vault, vault)
    expect(out).toMatch(/^!\[screenshot\|w320\]\(attachments\/[0-9a-f]{16}\.png\)$/)
  })
})
