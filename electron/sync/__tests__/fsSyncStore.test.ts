import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FsSyncStore, ubiquityContainerPath } from '../fsSyncStore'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'berean-sync-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('FsSyncStore', () => {
  it('creates its own device folder, writes atomically, and reads other devices', async () => {
    const a = new FsSyncStore(root, 'devA')
    const b = new FsSyncStore(root, 'devB')
    expect(await a.status()).toEqual({ available: true })
    await a.writeOwnFile('journal-000000001-000000001.jsonl', '{"x":1}\n')
    await a.writeOwnManifest({ device: 'devA', name: 'Mac', platform: 'darwin', appVersion: '1', schema: 44, seq: 1, files: [], applied: {}, updatedAt: 1 })
    expect(existsSync(join(root, 'README.txt'))).toBe(true)
    expect((await b.listDevices()).sort()).toEqual(['devA'])
    expect(await b.readManifest('devA')).toMatchObject({ device: 'devA', seq: 1 })
    expect(await b.readFile('devA', 'journal-000000001-000000001.jsonl')).toBe('{"x":1}\n')
    expect(await b.readManifest('nope')).toBeNull()
    await expect(b.readFile('devA', 'missing.jsonl')).rejects.toThrow()
    expect(readFileSync(join(root, 'devices', 'devA', 'manifest.json'), 'utf8')).toContain('"device": "devA"')
    expect(existsSync(join(root, 'devices', 'devA', 'manifest.json.tmp'))).toBe(false)
    await a.deleteOwnFile('journal-000000001-000000001.jsonl')
    await expect(b.readFile('devA', 'journal-000000001-000000001.jsonl')).rejects.toThrow()
  })

  it('reports an evicted iCloud placeholder as not-yet-available (null) instead of an error', async () => {
    mkdirSync(join(root, 'devices', 'devA'), { recursive: true })
    writeFileSync(join(root, 'devices', 'devA', '.journal-000000001-000000002.jsonl.icloud'), 'placeholder')
    const b = new FsSyncStore(root, 'devB')
    expect(await b.readFile('devA', 'journal-000000001-000000002.jsonl')).toBeNull()
  })

  it('ignores a corrupt manifest and maps container ids to the macOS Mobile Documents path', async () => {
    mkdirSync(join(root, 'devices', 'devA'), { recursive: true })
    writeFileSync(join(root, 'devices', 'devA', 'manifest.json'), '{not json')
    const b = new FsSyncStore(root, 'devB')
    expect(await b.readManifest('devA')).toBeNull()
    expect(ubiquityContainerPath('iCloud.com.berean.app', '/Users/x')).toBe('/Users/x/Library/Mobile Documents/iCloud~com~berean~app/Documents')
  })

  it('status reports an unwritable root as unavailable', async () => {
    const s = new FsSyncStore('/dev/null/not-a-dir', 'devA')
    expect((await s.status()).available).toBe(false)
  })
})
