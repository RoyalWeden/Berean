import type { BereanCloudPlugin, CloudChange, CloudEntry } from '../../ios/plugins'

/**
 * A behavioural model of iCloud Drive as the BereanCloud plugin sees it on a real iPhone — the
 * parts that matter for the sync lifecycle (DATA-SYNC-007/008), which the in-memory store does
 * not model:
 *   - a device's write is local at once, but "not uploaded" until the daemon uploads it
 *     (`uploadMs`); only then do other devices learn about it;
 *   - other devices get a metadata notification ("changed, not current") — iOS does NOT
 *     download the file by itself;
 *   - a download happens only when requested (`startDownloadingUbiquitousItem`) and takes
 *     `downloadMs`; its completion is another metadata notification;
 *   - the plugin's watch requests downloads for every non-current file it is told about
 *     (`proactiveDownloads`, the DATA-SYNC-008 behaviour — off = the old plugin, which only
 *     requested a download when a read hit a placeholder).
 * Time is real (tests use small delays).
 */
export class ICloudDriveSim {
  files = new Map<string, string>()
  /** device → paths it has not downloaded */
  private missing = new Map<string, Set<string>>()
  /** paths not uploaded yet (by their writer) */
  private notUploaded = new Set<string>()
  private listeners = new Map<string, Array<(c: CloudChange) => void>>()
  private watching = new Set<string>()
  private pendingDownloads = new Set<string>()
  available = true
  constructor(public o: { uploadMs: number; downloadMs: number; proactiveDownloads: boolean }) {}

  private notify(device: string, paths: string[]) {
    if (!this.watching.has(device)) return
    let requested = 0
    if (this.o.proactiveDownloads) for (const p of paths) if (this.missing.get(device)?.has(p)) { this.requestDownload(device, p); requested++ }
    for (const cb of this.listeners.get(device) ?? []) cb({ paths, initial: false, downloadsRequested: requested })
  }
  private requestDownload(device: string, path: string) {
    const key = `${device}|${path}`
    if (this.pendingDownloads.has(key)) return
    this.pendingDownloads.add(key)
    setTimeout(() => {
      this.pendingDownloads.delete(key)
      this.missing.get(device)?.delete(path)
      this.notify(device, [path])        // "download finished" metadata update
    }, this.o.downloadMs)
  }
  private devicesOtherThan(d: string) { return [...this.missing.keys()].filter((x) => x !== d) }

  plugin(device: string): BereanCloudPlugin {
    if (!this.missing.has(device)) this.missing.set(device, new Set())
    const self = this
    return {
      async status() { return self.available ? { available: true, signedIn: true, containerId: 'iCloud.sim', deviceName: device } : { available: false, signedIn: false, reason: 'signed out', containerId: 'iCloud.sim', deviceName: device } },
      async mkdir() {},
      async list({ path }) {
        const prefix = path.replace(/\/$/, '') + '/'
        const entries = new Map<string, CloudEntry>()
        for (const p of self.files.keys()) {
          if (!p.startsWith(prefix)) continue
          if (self.notUploaded.has(p) && !p.startsWith(`devices/${device}/`)) continue   // not in iCloud yet
          const rest = p.slice(prefix.length)
          const name = rest.split('/')[0]
          entries.set(name, { name, isDir: rest.includes('/'), downloaded: !self.missing.get(device)!.has(p) })
        }
        return { entries: [...entries.values()] }
      },
      async read({ path }) {
        if (!self.files.has(path) || (self.notUploaded.has(path) && !path.startsWith(`devices/${device}/`))) return { exists: false, downloading: false, text: null }
        if (self.missing.get(device)!.has(path)) { self.requestDownload(device, path); return { exists: true, downloading: true, text: null } }
        return { exists: true, downloading: false, text: self.files.get(path)! }
      },
      async write({ path, text }) {
        self.files.set(path, text)
        self.notUploaded.add(path)
        for (const d of self.devicesOtherThan(device)) self.missing.get(d)!.add(path)
        setTimeout(() => {
          self.notUploaded.delete(path)
          for (const d of self.devicesOtherThan(device)) self.notify(d, [path])
        }, self.o.uploadMs)
      },
      async remove({ path }) { self.files.delete(path) },
      async startWatching() { self.watching.add(device) },
      async stopWatching() { self.watching.delete(device) },
      async pendingUploads({ path }) { return { count: [...self.notUploaded].filter((p) => p.startsWith(path + '/')).length } },
      async addListener(_e, cb) {
        const arr = self.listeners.get(device) ?? []
        arr.push(cb); self.listeners.set(device, arr)
        return { remove: async () => { self.listeners.set(device, (self.listeners.get(device) ?? []).filter((f) => f !== cb)) } }
      },
    }
  }

  /** Deliver a duplicate notification (iOS can repeat metadata updates). */
  duplicateNotify(device: string, paths: string[]) { this.notify(device, paths) }
}
