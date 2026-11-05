import { createHash } from 'crypto'
import { createReadStream, createWriteStream, existsSync, promises as fsp } from 'fs'
import { dirname } from 'path'

/**
 * Resumable, integrity-checked, atomic file download for local AI models (spec §8.3).
 *
 * - Writes to `<dest>.part`; an interrupted download resumes with an HTTP Range request when the
 *   server supports it (206), otherwise restarts cleanly.
 * - The finished file must match the expected SHA-256 (and size, when given) before it is moved
 *   into place with a rename — a damaged or partial file is never installed.
 * - Refuses to start when the volume lacks room for the file plus a safety margin.
 * - Cancellable through an AbortSignal; a cancelled download keeps its `.part` for resuming.
 *
 * `fetchImpl` is injectable so tests (and a future Electron `net.fetch` host) can supply it.
 */

export type DownloadErrorCode = 'CANCELLED' | 'INSUFFICIENT_DISK' | 'CHECKSUM_MISMATCH' | 'SIZE_MISMATCH' | 'HTTP_ERROR' | 'NETWORK'

export class DownloadError extends Error {
  constructor(readonly code: DownloadErrorCode, message: string) { super(message); this.name = 'DownloadError' }
}

export interface DownloadProgress { received: number; total: number | null }

export interface DownloadOptions {
  url: string
  dest: string
  sha256: string
  /** Expected size in bytes (also used for the disk check). */
  size?: number
  signal?: AbortSignal
  onProgress?: (p: DownloadProgress) => void
  fetchImpl?: typeof fetch
  /** Free bytes on the destination volume (injectable for tests). */
  freeBytes?: (dir: string) => Promise<number>
  /** Extra room kept free beyond the file itself (default 512 MB). */
  marginBytes?: number
}

async function defaultFreeBytes(dir: string): Promise<number> {
  const s = await fsp.statfs(dir)
  return Number(s.bavail) * Number(s.bsize)
}

async function hashFile(path: string): Promise<string> {
  const h = createHash('sha256')
  await new Promise<void>((resolve, reject) => {
    createReadStream(path).on('data', (c) => h.update(c)).on('end', () => resolve()).on('error', reject)
  })
  return h.digest('hex')
}

export async function downloadModel(o: DownloadOptions): Promise<{ path: string; bytes: number; resumed: boolean }> {
  const fetchImpl = o.fetchImpl ?? fetch
  const part = `${o.dest}.part`
  await fsp.mkdir(dirname(o.dest), { recursive: true })

  // Already installed and intact → nothing to do.
  if (existsSync(o.dest) && (await hashFile(o.dest)) === o.sha256.toLowerCase()) {
    return { path: o.dest, bytes: (await fsp.stat(o.dest)).size, resumed: false }
  }

  let have = existsSync(part) ? (await fsp.stat(part)).size : 0
  if (o.size != null) {
    const need = Math.max(0, o.size - have) + (o.marginBytes ?? 512 * 1024 * 1024)
    const free = await (o.freeBytes ?? defaultFreeBytes)(dirname(o.dest))
    if (free < need) throw new DownloadError('INSUFFICIENT_DISK', `Needs ${need} bytes free, ${free} available`)
  }

  let res: Response
  try {
    res = await fetchImpl(o.url, { headers: have > 0 ? { Range: `bytes=${have}-` } : {}, signal: o.signal })
  } catch (e) {
    if (o.signal?.aborted) throw new DownloadError('CANCELLED', 'Download cancelled')
    throw new DownloadError('NETWORK', String((e as Error)?.message ?? e))
  }
  if (res.status === 416 && o.size != null && have === o.size) {
    // The part is already complete; fall through to verification.
  } else if (!res.ok) {
    throw new DownloadError('HTTP_ERROR', `Server answered ${res.status}`)
  }
  const resumed = res.status === 206
  if (res.status === 200 && have > 0) have = 0 // server ignored Range → restart
  const lengthHeader = Number(res.headers.get('content-length') ?? NaN)
  const total = o.size ?? (Number.isFinite(lengthHeader) ? lengthHeader + (resumed ? have : 0) : null)

  if (res.status !== 416 && res.body) {
    const out = createWriteStream(part, { flags: resumed ? 'a' : 'w' })
    let received = have
    const reader = res.body.getReader()
    try {
      for (;;) {
        if (o.signal?.aborted) throw new DownloadError('CANCELLED', 'Download cancelled')
        const { done, value } = await reader.read()
        if (done) break
        await new Promise<void>((resolve, reject) => out.write(value, (err) => (err ? reject(err) : resolve())))
        received += value.byteLength
        o.onProgress?.({ received, total })
      }
    } catch (e) {
      await new Promise<void>((resolve) => out.end(resolve))
      if (e instanceof DownloadError) throw e
      if (o.signal?.aborted) throw new DownloadError('CANCELLED', 'Download cancelled')
      throw new DownloadError('NETWORK', String((e as Error)?.message ?? e))
    }
    await new Promise<void>((resolve) => out.end(resolve))
  }

  const bytes = (await fsp.stat(part)).size
  if (o.size != null && bytes !== o.size) {
    if (bytes > o.size) await fsp.rm(part, { force: true })
    throw new DownloadError('SIZE_MISMATCH', `Got ${bytes} bytes, expected ${o.size}`)
  }
  const digest = await hashFile(part)
  if (digest !== o.sha256.toLowerCase()) {
    await fsp.rm(part, { force: true }) // a corrupt download is never kept or installed
    throw new DownloadError('CHECKSUM_MISMATCH', `SHA-256 ${digest} does not match the expected value`)
  }
  await fsp.rename(part, o.dest) // atomic on the same volume
  return { path: o.dest, bytes, resumed }
}
