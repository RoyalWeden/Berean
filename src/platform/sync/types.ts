/**
 * Sync engine types (docs/mobile/icloud.md).
 *
 *   Berean data model → local SQLite → SyncEngine → SyncStore (transport)
 *
 * The engine is written against `SyncStore`, a deliberately small "per-device folder of files"
 * abstraction. The first transport is the iCloud Drive ubiquity container (Electron: plain fs;
 * iOS: BereanCloud plugin); the in-memory store drives the two-device integration tests. Nothing
 * outside `src/platform/sync/stores/*` knows which transport is in use.
 */

export type SyncOpKind = 'upsert' | 'delete'

/** One journal line. Immutable once written. */
export interface SyncOp {
  /** Mutation id (uuid) — duplicate delivery is detected by (device, seq) but the id is kept for logs. */
  id: string
  /** Per-device, contiguous, monotonically increasing. */
  seq: number
  /** Hybrid logical clock timestamp (src/platform/sync/hlc.ts) — the global order. */
  hlc: string
  /** Originating device id. */
  device: string
  /** Entity kind (see entities.ts). */
  entity: string
  /** Record key within the entity (usually the row id). */
  key: string
  op: SyncOpKind
  /** Full synced field set for an upsert (column-name keyed). Absent for deletes. */
  fields?: Record<string, unknown>
  /** The record's HLC as the writer last saw it before this change (conflict detection). */
  base?: string
  /** berean.db schema version the writer was on. */
  schema: number
}

export interface DeviceManifest {
  device: string
  name: string
  platform: 'darwin' | 'win32' | 'linux' | 'ios'
  appVersion: string
  schema: number
  /** Highest seq this device has written. */
  seq: number
  /** Journal files currently present for this device, oldest first. */
  files: JournalFileInfo[]
  /** For every OTHER device: the highest seq this device has applied (drives compaction). */
  applied: Record<string, number>
  /** Latest compaction snapshot (docs/mobile/icloud.md §8): the state of every record this
   *  device is the current writer of, as of `seq`. Journal files ≤ `seq` may be gone. */
  snapshot?: { name: string; seq: number; records: number; bytes: number }
  updatedAt: number
}

export interface JournalFileInfo {
  name: string
  seqFrom: number
  seqTo: number
  /** Encoded size; absent in manifests written before compaction existed. */
  bytes?: number
}

/** `snapshot-<seq>.json` — one device's compacted history. */
export interface SnapshotFile {
  format: number
  device: string
  seq: number
  schema: number
  writtenAt: number
  records: SnapshotRecord[]
}
export interface SnapshotRecord {
  entity: string
  key: string
  hlc: string
  op: SyncOpKind
  fields?: Record<string, unknown>
}

export interface SyncStoreStatus {
  available: boolean
  reason?: string
}

/**
 * Transport. Bound to one device id at construction; may only write inside that device's own
 * folder. Reads see every device.
 */
export interface SyncStore {
  readonly deviceId: string
  status(): Promise<SyncStoreStatus>
  listDevices(): Promise<string[]>
  readManifest(device: string): Promise<DeviceManifest | null>
  /** Returns null when the file exists but is not available locally yet (evicted / downloading);
   *  throws when the read itself fails. */
  readFile(device: string, name: string): Promise<string | null>
  writeOwnFile(name: string, content: string): Promise<void>
  writeOwnManifest(manifest: DeviceManifest): Promise<void>
  deleteOwnFile(name: string): Promise<void>
  /** Optional push notification of remote changes; the engine also polls. */
  watch?(onChange: () => void): () => void
}

export interface SyncStatusSnapshot {
  enabled: boolean
  deviceId: string
  transport: SyncStoreStatus
  pendingOutbox: number
  lastPushAt: number | null
  lastPullAt: number | null
  lastError: string | null
  devices: Array<{ device: string; name: string; platform: string; seq: number; applied: number; lastSeenAt?: number }>
  unreadable: number
  /** Own journal: files + bytes currently in the container, and the last compaction (if any). */
  journal?: { files: number; bytes: number; snapshotSeq: number | null }
}

export const SYNC_FORMAT_VERSION = 1
