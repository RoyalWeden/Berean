import type { DeviceManifest, SyncStore, SyncStoreStatus } from '../types'

/**
 * In-memory transport for tests. Models what iCloud Drive actually gives us:
 *  - each device writes only its own folder;
 *  - an OFFLINE device keeps writing locally (writes are queued) and sees a stale copy of the
 *    other devices until it comes back online, at which point queued writes upload and the
 *    latest cloud state downloads;
 *  - a file can be "evicted" (exists in the cloud, not yet downloaded → `readFile` returns null);
 *  - a file can be corrupted or truncated in the cloud.
 */
type Folder = Map<string, string>

export class MemoryCloud {
  readonly folders = new Map<string, Folder>()
  readonly manifests = new Map<string, DeviceManifest>()
  private evicted = new Set<string>()

  folder(device: string): Folder {
    let f = this.folders.get(device)
    if (!f) { f = new Map(); this.folders.set(device, f) }
    return f
  }
  device(deviceId: string): MemorySyncStore {
    return new MemorySyncStore(this, deviceId)
  }
  /** Simulate "not downloaded yet" for one file. */
  evict(device: string, name: string, on = true): void {
    const k = `${device}/${name}`
    if (on) this.evicted.add(k); else this.evicted.delete(k)
  }
  isEvicted(device: string, name: string): boolean {
    return this.evicted.has(`${device}/${name}`)
  }
  corrupt(device: string, name: string, mutate: (text: string) => string): void {
    const f = this.folder(device)
    const cur = f.get(name)
    if (cur !== undefined) f.set(name, mutate(cur))
  }
}

export class MemorySyncStore implements SyncStore {
  readonly deviceId: string
  private readonly cloud: MemoryCloud
  private online = true
  /** Own writes made while offline, uploaded on reconnect (in order). */
  private queued: Array<{ kind: 'file'; name: string; content: string } | { kind: 'delete'; name: string } | { kind: 'manifest'; manifest: DeviceManifest }> = []
  /** Snapshot of the cloud as last seen while online (what an offline device can still read). */
  private view: { folders: Map<string, Folder>; manifests: Map<string, DeviceManifest> } = { folders: new Map(), manifests: new Map() }
  /** Optional fault injection: throw on the next N writes. */
  failWrites = 0
  private watchers = new Set<() => void>()

  constructor(cloud: MemoryCloud, deviceId: string) {
    this.cloud = cloud
    this.deviceId = deviceId
    this.refreshView()
  }

  private refreshView(): void {
    this.view = {
      folders: new Map([...this.cloud.folders].map(([d, f]) => [d, new Map(f)])),
      manifests: new Map([...this.cloud.manifests].map(([d, m]) => [d, structuredClone(m)])),
    }
  }

  setOnline(on: boolean): void {
    if (on && !this.online) {
      for (const q of this.queued) {
        if (q.kind === 'file') this.cloud.folder(this.deviceId).set(q.name, q.content)
        else if (q.kind === 'delete') this.cloud.folder(this.deviceId).delete(q.name)
        else this.cloud.manifests.set(this.deviceId, structuredClone(q.manifest))
      }
      this.queued = []
    }
    this.online = on
    if (on) { this.refreshView(); for (const w of this.watchers) w() }
  }
  isOnline(): boolean { return this.online }

  async status(): Promise<SyncStoreStatus> {
    // iCloud Drive is "available" offline too — writes land locally. Only a missing container
    // (signed out) makes it unavailable; tests toggle that with `containerMissing`.
    if (this.containerMissing) return { available: false, reason: 'iCloud Drive not available (signed out)' }
    // Like the real transports (mkdir of the own folder), coming online makes the device known
    // to others even before its first push — so compaction on other devices waits for it.
    if (this.online) this.cloud.folder(this.deviceId)
    return { available: true }
  }
  containerMissing = false

  private source() {
    return this.online ? { folders: this.cloud.folders, manifests: this.cloud.manifests } : this.view
  }

  async listDevices(): Promise<string[]> {
    const ids = new Set<string>([...this.source().manifests.keys(), ...this.source().folders.keys(), this.deviceId])
    return [...ids]
  }
  async readManifest(device: string): Promise<DeviceManifest | null> {
    if (device === this.deviceId && !this.online) {
      // Own files are local on iCloud Drive: offline, this device still sees what it wrote last.
      const q = [...this.queued].reverse().find((x) => x.kind === 'manifest')
      if (q && q.kind === 'manifest') return structuredClone(q.manifest)
      const mine = this.cloud.manifests.get(device)
      if (mine) return structuredClone(mine)
    }
    const m = this.source().manifests.get(device)
    return m ? structuredClone(m) : null
  }
  async readFile(device: string, name: string): Promise<string | null> {
    if (this.online && this.cloud.isEvicted(device, name)) return null
    if (device === this.deviceId) {
      const q = [...this.queued].reverse().find((x) => x.kind === 'file' && x.name === name)
      if (q && q.kind === 'file') return q.content
    }
    const f = this.source().folders.get(device)
    if (!f || !f.has(name)) throw new Error(`no such file ${device}/${name}`)
    return f.get(name)!
  }
  async writeOwnFile(name: string, content: string): Promise<void> {
    if (this.failWrites > 0) { this.failWrites--; throw new Error('simulated write failure') }
    if (this.online) { this.cloud.folder(this.deviceId).set(name, content); this.notify() }
    else this.queued.push({ kind: 'file', name, content })
  }
  async writeOwnManifest(manifest: DeviceManifest): Promise<void> {
    if (this.failWrites > 0) { this.failWrites--; throw new Error('simulated write failure') }
    if (this.online) { this.cloud.manifests.set(this.deviceId, structuredClone(manifest)); this.notify() }
    else this.queued.push({ kind: 'manifest', manifest: structuredClone(manifest) })
  }
  async deleteOwnFile(name: string): Promise<void> {
    if (this.online) this.cloud.folder(this.deviceId).delete(name)
    else this.queued.push({ kind: 'delete', name })
  }
  watch(onChange: () => void): () => void {
    this.watchers.add(onChange)
    return () => { this.watchers.delete(onChange) }
  }
  private notify(): void {
    // other devices' watchers fire on cloud change (a real store would get NSMetadataQuery / fs events)
    for (const s of MemorySyncStore.all) if (s !== this && s.online) for (const w of s.watchers) w()
  }
  static all = new Set<MemorySyncStore>()
}
