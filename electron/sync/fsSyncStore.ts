import { promises as fs, existsSync, watch as fsWatch, type FSWatcher } from 'fs'
import { join, dirname } from 'path'
import { execFile } from 'child_process'
import type { DeviceManifest, SyncStore, SyncStoreStatus } from '../../src/platform/sync/types'

/**
 * SyncStore over a plain folder — on macOS the app's iCloud Drive ubiquity container
 * (`~/Library/Mobile Documents/iCloud~com~berean~app/Documents/sync/v1`) or a user-chosen folder
 * inside iCloud Drive; the iCloud daemon does the uploading (docs/mobile/icloud.md §2).
 *
 *  - This device only ever writes under `devices/<deviceId>/`; writes are atomic (temp + rename)
 *    so the daemon never uploads a half-written file.
 *  - A file that iCloud has evicted appears as `.<name>.icloud`; `readFile` returns null for it
 *    (the engine stops that device's stream at the gap) and asks the daemon to download it —
 *    `brctl download` in the DMG build, the injected `download` (NSFileManager) in the sandboxed
 *    Mac App Store build, which cannot run brctl (macOS only, best effort).
 *  - `watch` uses a recursive fs watcher, debounced; the engine also polls.
 *  - Identity (config/app-identity.json): when constructed with one, the store claims the folder
 *    with `berean-identity.json` and refuses to write into a folder another identity claimed — so
 *    Berean and Berean Dev can never share a sync folder, even a custom one inside iCloud Drive.
 */
export const IDENTITY_FILE = 'berean-identity.json'

export class FsSyncStore implements SyncStore {
  readonly deviceId: string
  readonly root: string
  private downloadRequested = new Map<string, number>()

  /** When set, the store is unavailable until this folder exists — it never creates the iCloud
   *  container itself (that would sync to a plain local folder and look like it worked). */
  private readonly requiredParent: string | null
  private readonly download: ((path: string) => void) | null
  private readonly identity: string | null
  private identityChecked = false

  constructor(root: string, deviceId: string, requiredParent: string | null = null, download: ((path: string) => void) | null = null, identity: string | null = null) {
    this.root = root
    this.deviceId = deviceId
    this.requiredParent = requiredParent
    this.download = download
    this.identity = identity
  }

  /** Throws when another app identity claimed this folder; claims it otherwise (once per store). */
  private async guardIdentity(): Promise<void> {
    if (!this.identity || this.identityChecked) return
    const file = join(this.root, IDENTITY_FILE)
    let claimed: string | null = null
    try { claimed = (JSON.parse(await fs.readFile(file, 'utf8')) as { identity?: string }).identity ?? null } catch { claimed = null }
    if (claimed && claimed !== this.identity) throw new Error(`sync folder belongs to the ${claimed} Berean app, not ${this.identity}: ${this.root}`)
    if (!claimed) {
      await fs.mkdir(this.root, { recursive: true })
      await fs.writeFile(file, JSON.stringify({ identity: this.identity }) + '\n', 'utf8')
    }
    this.identityChecked = true
  }

  private devicesDir(): string { return join(this.root, 'devices') }
  private ownDir(): string { return join(this.devicesDir(), this.deviceId) }

  async status(): Promise<SyncStoreStatus> {
    if (this.requiredParent && !existsSync(this.requiredParent)) return { available: false, reason: `iCloud folder not found: ${this.requiredParent}` }
    try {
      await this.guardIdentity()
      await fs.mkdir(this.ownDir(), { recursive: true })
      const readme = join(this.root, 'README.txt')
      if (!existsSync(readme)) await fs.writeFile(readme, 'Managed by Berean — synchronisation journals. Do not edit or delete.\n', 'utf8').catch(() => {})
      return { available: true }
    } catch (err) {
      return { available: false, reason: `sync folder not writable: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  async listDevices(): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.devicesDir(), { withFileTypes: true })
      return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name)
    } catch {
      return [this.deviceId]
    }
  }

  async readManifest(device: string): Promise<DeviceManifest | null> {
    const text = await this.readFile(device, 'manifest.json')
    if (text === null) return null
    try {
      const m = JSON.parse(text) as DeviceManifest
      return m && m.device === device ? m : null
    } catch {
      return null
    }
  }

  async readFile(device: string, name: string): Promise<string | null> {
    const path = join(this.devicesDir(), device, name)
    try {
      return await fs.readFile(path, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      const placeholder = join(this.devicesDir(), device, `.${name}.icloud`)
      if (existsSync(placeholder)) {
        this.requestDownload(path)
        return null
      }
      if (name === 'manifest.json') return null
      throw err
    }
  }

  /** Ask the iCloud daemon to materialise an evicted file (throttled to once a minute per file). */
  private requestDownload(path: string): void {
    if (process.platform !== 'darwin') return
    const last = this.downloadRequested.get(path) ?? 0
    if (Date.now() - last < 60_000) return
    this.downloadRequested.set(path, Date.now())
    if (this.download) { this.download(path); return }
    execFile('/usr/bin/brctl', ['download', path], () => { /* best effort */ })
  }

  private async atomicWrite(path: string, content: string): Promise<void> {
    await fs.mkdir(dirname(path), { recursive: true })
    const tmp = `${path}.tmp-${process.pid}-${Date.now()}`
    await fs.writeFile(tmp, content, 'utf8')
    await fs.rename(tmp, path)
  }

  async writeOwnFile(name: string, content: string): Promise<void> {
    await this.guardIdentity()
    await this.atomicWrite(join(this.ownDir(), name), content)
  }

  async writeOwnManifest(manifest: DeviceManifest): Promise<void> {
    await this.guardIdentity()
    await this.atomicWrite(join(this.ownDir(), 'manifest.json'), JSON.stringify(manifest, null, 1))
  }

  async deleteOwnFile(name: string): Promise<void> {
    await this.guardIdentity()
    await fs.rm(join(this.ownDir(), name), { force: true })
  }

  watch(onChange: () => void): () => void {
    let watcher: FSWatcher | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    try {
      watcher = fsWatch(this.devicesDir(), { recursive: true }, (_evt, filename) => {
        // Ignore our own folder and temp files: only other devices' journals matter.
        const f = String(filename ?? '')
        if (f.startsWith(this.deviceId) || f.includes('.tmp-')) return
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => { timer = null; onChange() }, 1500)
      })
      watcher.on('error', () => { /* watcher died (folder removed) — polling still runs */ })
    } catch { /* recursive watch unsupported — polling still runs */ }
    return () => { watcher?.close(); if (timer) clearTimeout(timer) }
  }
}

/** The ubiquity container's Documents folder on macOS for a container id like `iCloud.com.berean.app`. */
export function ubiquityContainerPath(containerId: string, home: string): string {
  return join(home, 'Library', 'Mobile Documents', containerId.replace(/\./g, '~'), 'Documents')
}
