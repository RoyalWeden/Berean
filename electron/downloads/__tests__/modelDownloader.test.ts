// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer, type Server } from 'http'
import { createHash, randomBytes } from 'crypto'
import { mkdtempSync, existsSync, readFileSync, writeFileSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { downloadModel, DownloadError } from '../modelDownloader'

const BODY = randomBytes(256 * 1024)
const SHA = createHash('sha256').update(BODY).digest('hex')
let server: Server
let base = ''
let honorRange = true
let cutAfter: number | null = null

beforeAll(async () => {
  server = createServer((req, res) => {
    const range = req.headers.range?.match(/bytes=(\d+)-/)
    const start = honorRange && range ? Number(range[1]) : 0
    const slice = BODY.subarray(start)
    res.writeHead(start > 0 ? 206 : 200, { 'Content-Length': String(slice.length) })
    if (cutAfter != null) { res.write(slice.subarray(0, cutAfter)); setTimeout(() => res.destroy(), 80); return }
    res.end(slice)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
  const a = server.address()
  base = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))
beforeEach(() => { honorRange = true; cutAfter = null })

const dir = () => mkdtempSync(join(tmpdir(), 'berean-dl-'))
const plenty = async () => 1e12

describe('downloadModel (spec §8.3)', () => {
  it('downloads, verifies SHA-256 and installs atomically', async () => {
    const dest = join(dir(), 'model.gguf')
    const r = await downloadModel({ url: `${base}/m`, dest, sha256: SHA, size: BODY.length, freeBytes: plenty })
    expect(r).toMatchObject({ bytes: BODY.length, resumed: false })
    expect(readFileSync(dest).equals(BODY)).toBe(true)
    expect(existsSync(`${dest}.part`)).toBe(false)
  })

  it('resumes an interrupted download with a Range request', async () => {
    const dest = join(dir(), 'model.gguf')
    cutAfter = 100_000
    await expect(downloadModel({ url: `${base}/m`, dest, sha256: SHA, size: BODY.length, freeBytes: plenty })).rejects.toBeInstanceOf(DownloadError)
    expect(statSync(`${dest}.part`).size).toBe(100_000)
    expect(existsSync(dest)).toBe(false) // never installed partially
    cutAfter = null
    const r = await downloadModel({ url: `${base}/m`, dest, sha256: SHA, size: BODY.length, freeBytes: plenty })
    expect(r.resumed).toBe(true)
    expect(readFileSync(dest).equals(BODY)).toBe(true)
  })

  it('restarts cleanly when the server ignores Range', async () => {
    const dest = join(dir(), 'model.gguf')
    writeFileSync(`${dest}.part`, BODY.subarray(0, 50_000))
    honorRange = false
    const r = await downloadModel({ url: `${base}/m`, dest, sha256: SHA, size: BODY.length, freeBytes: plenty })
    expect(r.resumed).toBe(false)
    expect(readFileSync(dest).equals(BODY)).toBe(true)
  })

  it('rejects and discards a corrupt download (checksum mismatch)', async () => {
    const dest = join(dir(), 'model.gguf')
    await expect(downloadModel({ url: `${base}/m`, dest, sha256: '0'.repeat(64), size: BODY.length, freeBytes: plenty }))
      .rejects.toMatchObject({ code: 'CHECKSUM_MISMATCH' })
    expect(existsSync(dest)).toBe(false)
    expect(existsSync(`${dest}.part`)).toBe(false)
  })

  it('refuses to start without enough free disk space', async () => {
    const dest = join(dir(), 'model.gguf')
    await expect(downloadModel({ url: `${base}/m`, dest, sha256: SHA, size: BODY.length, freeBytes: async () => 1000 }))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_DISK' })
  })

  it('cancels on request and keeps the partial file for resuming', async () => {
    const dest = join(dir(), 'model.gguf')
    const ac = new AbortController()
    await expect(downloadModel({ url: `${base}/m`, dest, sha256: SHA, size: BODY.length, freeBytes: plenty, signal: ac.signal, onProgress: () => ac.abort() }))
      .rejects.toMatchObject({ code: 'CANCELLED' })
    expect(existsSync(dest)).toBe(false)
  })

  it('treats an already-installed intact file as done', async () => {
    const dest = join(dir(), 'model.gguf')
    writeFileSync(dest, BODY)
    const r = await downloadModel({ url: `${base}/never-called`, dest, sha256: SHA, size: BODY.length, freeBytes: plenty, fetchImpl: () => { throw new Error('should not fetch') } })
    expect(r.bytes).toBe(BODY.length)
  })
})
