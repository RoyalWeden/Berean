import type { DeviceManifest, SyncStore, SyncStoreStatus } from '../sync/types'
import { BereanCloud, type BereanCloudPlugin } from './plugins'

/**
 * SyncStore over the app's iCloud Drive ubiquity container, through the BereanCloud plugin —
 * the iOS counterpart of electron/sync/fsSyncStore.ts (same folder layout, same rules:
 * this device writes only under `devices/<deviceId>/`, a not-yet-downloaded file reads as
 * `null` and is requested from iCloud, `watch` relays NSMetadataQuery updates).
 */
export class CloudSyncStore implements SyncStore {
  readonly deviceId: string
  private plugin: BereanCloudPlugin

  constructor(deviceId: string, plugin: BereanCloudPlugin = BereanCloud) {
    this.deviceId = deviceId
    this.plugin = plugin
  }

  private ownDir(): string { return `devices/${this.deviceId}` }

  async status(): Promise<SyncStoreStatus> {
    const st = await this.plugin.status()
    if (!st.available) return { available: false, reason: st.reason ?? 'iCloud unavailable' }
    try {
      await this.plugin.mkdir({ path: this.ownDir() })
      return { available: true }
    } catch (err) {
      return { available: false, reason: `sync folder not writable: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  async listDevices(): Promise<string[]> {
    try {
      const { entries } = await this.plugin.list({ path: 'devices' })
      const ids = entries.filter((e) => e.isDir).map((e) => e.name)
      return ids.length ? ids : [this.deviceId]
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
    const r = await this.plugin.read({ path: `devices/${device}/${name}` })
    if (r.exists && r.downloading) return null
    if (!r.exists) {
      if (name === 'manifest.json') return null
      throw new Error(`ENOENT: devices/${device}/${name}`)
    }
    return r.text ?? ''
  }

  async writeOwnFile(name: string, content: string): Promise<void> {
    await this.plugin.write({ path: `${this.ownDir()}/${name}`, text: content })
  }

  async writeOwnManifest(manifest: DeviceManifest): Promise<void> {
    await this.plugin.write({ path: `${this.ownDir()}/manifest.json`, text: JSON.stringify(manifest, null, 1) })
  }

  async deleteOwnFile(name: string): Promise<void> {
    await this.plugin.remove({ path: `${this.ownDir()}/${name}` })
  }

  watch(onChange: () => void): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null
    let stopped = false
    let handle: { remove: () => Promise<void> } | null = null
    void this.plugin.addListener('change', (change) => {
      if (stopped || change.initial) return
      // Only other devices' files matter; our own uploads also produce metadata updates.
      const own = `${this.ownDir()}/`
      if (!change.paths.some((p) => !p.startsWith(own))) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { timer = null; onChange() }, 1500)
    }).then((h) => { if (stopped) void h.remove(); else handle = h })
    void this.plugin.startWatching().catch(() => { /* polling still runs */ })
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      void handle?.remove()
      void this.plugin.stopWatching().catch(() => {})
    }
  }
}
