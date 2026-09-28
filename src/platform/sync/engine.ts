import type { DatabaseAdapter } from '../db/DatabaseAdapter'
import { defaultUuid, type ServiceEvents, type ServiceLogger, type DataChange } from '../services/context'
import { HybridLogicalClock, compareHlc, formatHlc, parseHlc } from './hlc'
import { chunkForFiles, decodeJournal, parseJournalFileName, snapshotFileName, COMPACT_AFTER_BYTES, COMPACT_AFTER_OPS, COMPACT_SILENT_MS } from './journal'
import { createEntityRegistry, SYNCED_ENTITY_KINDS, type EntityAdapter, type EntityRecord } from './entities'
import type { DeviceManifest, JournalFileInfo, SnapshotFile, SnapshotRecord, SyncOp, SyncState, SyncStatusSnapshot, SyncStore } from './types'
import { shortId, type SyncTrace } from './trace'
import { SYNC_FORMAT_VERSION } from './types'
import { childLineage, fieldHashes, LINEAGE_SEND, mergeConcurrent, parseJsonOr, relate, trimLineage, LINEAGE_KEEP, type VersionInfo } from './merge'

/**
 * The sync engine (docs/mobile/icloud.md). Transport-agnostic: it only talks to `SyncStore`.
 *
 * Capture:  services emit `data:changed`; for synced entities the engine reads the record and
 *           appends an op to `sync_outbox` with an HLC timestamp and the record's previous HLC
 *           as `base`. Local writes never wait for the transport.
 * Push:     outbox → numbered journal files in this device's own folder + manifest.
 * Pull:     every other device's manifest + unread journal files → ops sorted by HLC → applied
 *           through the entity adapters with the merge rules below → `sync_applied` bookkeeping.
 *
 * Merge rules:
 *  - record-level last-writer-wins by HLC (`sync_record_meta` holds each record's current HLC);
 *  - deletes are tombstones in `sync_record_meta`: an older upsert cannot resurrect a record, a
 *    newer upsert can (the user edited after the delete);
 *  - notes: when an incoming edit and the local record diverged from the same base (both edited
 *    while apart), the higher HLC becomes the note's content and the other content is stored as a
 *    `note_versions` row of kind 'conflict' with a deterministic id, so both devices converge on
 *    the same current text AND the same recoverable conflict copy. Nothing is discarded.
 *  - every (device, seq) is applied at most once; ops within one device are applied in seq order
 *    and a missing journal file stops that device's stream at the gap (never skips).
 */
export interface SyncEngineOptions {
  db: DatabaseAdapter
  store: SyncStore
  events: ServiceEvents
  deviceName: string
  platform: DeviceManifest['platform']
  appVersion: string
  schema: number
  log: ServiceLogger
  now?: () => number
  uuid?: () => string
  /** Called after a pull applied changes (entities touched) — hosts refresh UI / the tab mirror. */
  onApplied?: (entities: Set<string>) => void
  /** Max attempts for an op that throws while applying before it is left in sync_failed. */
  maxAttempts?: number
  /** Called after a local change has been captured into the outbox — hosts wake the push
   *  (DATA-SYNC-007: outbound sync is event-driven, not timer-driven). */
  onLocalChange?: () => void
  /** Diagnostic log (metadata only). */
  trace?: SyncTrace
  /** Network reachability, when the host knows it (only used to word the status). */
  online?: () => boolean
  /** Opaque identity of the signed-in iCloud account (iOS: hash of ubiquityIdentityToken). */
  accountIdentity?: string | null
  /** berean.db failed its integrity check (checkDatabase): sync holds, and nothing is inferred
   *  from what the database appears to be missing. */
  databaseProblem?: string | null
}

interface OutboxRow { seq: number; entity: string; key: string; op_json: string }
interface MetaRow { hlc: string; device: string; deleted: number; hash?: string | null; field_hlc?: string | null; field_hash?: string | null; lineage?: string | null }
const META_COLS = 'hlc, device, deleted, hash, field_hlc, field_hash, lineage'

function versionOfMeta(m: MetaRow): VersionInfo {
  return { hlc: m.hlc, lineage: m.lineage == null ? null : parseJsonOr<string[]>(m.lineage, []), fieldHlc: parseJsonOr<Record<string, string> | null>(m.field_hlc, null) }
}
function versionOfOp(op: Pick<SyncOp, 'hlc' | 'lin' | 'base' | 'fh'>): VersionInfo {
  return { hlc: op.hlc, lineage: op.lin ?? (op.base ? [op.base] : null), fieldHlc: op.fh ?? null }
}
/** Lineage of a version that has seen both `a` and `b` (the result of a merge or of learning about a delete). */
function unionLineage(a: VersionInfo, b: VersionInfo, exclude: string): string[] {
  return trimLineage([...(a.lineage ?? []), a.hlc, ...(b.lineage ?? []), b.hlc].filter((h) => h !== exclude), LINEAGE_KEEP)
}

/** Why sync is holding back (fail closed — DATA-SAFE-020…): nothing is pushed or deleted until resolved. */
export type SyncHold =
  | { kind: 'quarantine'; entities: Record<string, number>; at: number }
  | { kind: 'container'; at: number }
  | { kind: 'account'; at: number }
  | { kind: 'database'; at: number; detail: string }

/** A reconciliation never infers more deletions than this from rows that are missing locally. */
export const VANISH_LIMIT = { absolute: 20, fraction: 0.25 }

const STATE = {
  deviceId: 'device_id',
  hlc: 'hlc_latest',
  ownSeq: 'own_seq',
  ownFiles: 'own_files',
  lastPushAt: 'last_push_at',
  lastPullAt: 'last_pull_at',
  adopted: 'adopted',
  enabled: 'enabled',
  snapshot: 'own_snapshot',
  /** Wall time of the last completed capture — the reconciliation's watermark. */
  capturedAt: 'captured_at',
  /** Identity of the database file this state belongs to (creation time of berean.db): a copy or
   *  a restored backup has a different one → the device id is forked (DATA-SAFE-030). */
  storageIdentity: 'storage_identity',
  /** Identity of the iCloud account last synced with (iOS ubiquityIdentityToken hash). */
  accountIdentity: 'account_identity',
  /** Deletions inferred from missing rows that were NOT sent (DATA-SAFE-020). */
  quarantine: 'quarantine',
  /** Last full (hash-compare) reconciliation. */
  lastFullReconcile: 'last_full_reconcile',
  appVersion: 'app_version',
  /** Forks of this database's device identity (diagnostics). */
  forks: 'forks',
  /** Set by resolveHold('republish'): publish every record on the next start. */
  republish: 'republish',
} as const

/** A reconciliation looks this far behind the watermark (clock adjustments, in-flight writes). */
const RECONCILE_MARGIN_MS = 10 * 60 * 1000
const FULL_RECONCILE_EVERY_MS = 7 * 24 * 60 * 60 * 1000

export class SyncEngine {
  readonly deviceId: string
  private readonly db: DatabaseAdapter
  private readonly store: SyncStore
  private readonly events: ServiceEvents
  private readonly entities: Map<string, EntityAdapter>
  private readonly clock: HybridLogicalClock
  private readonly opts: SyncEngineOptions
  private readonly now: () => number
  private readonly uuid: () => string
  private ownSeq = 0
  private ownFiles: JournalFileInfo[] = []
  private ownSnapshot: DeviceManifest['snapshot'] | null = null
  private lastError: string | null = null
  private lastPushAt: number | null = null
  private lastPullAt: number | null = null
  private unreadable = 0
  private phase: 'idle' | 'uploading' | 'reconciling' = 'idle'
  private remoteWaiting = 0
  private lastNotifiedAt: number | null = null
  private lastState: SyncState | null = null
  private localChangeListener: (() => void) | null = null
  private lastApplied: { at: number; count: number } | null = null
  private unsubscribe: (() => void) | null = null
  private syncing: Promise<void> | null = null
  private hold: SyncHold | null = null
  private madeConflictCopies = new Set<string>()
  private resolutions = new Set<string>()

  private constructor(opts: SyncEngineOptions, deviceId: string, clock: HybridLogicalClock) {
    this.opts = opts
    this.db = opts.db
    this.store = opts.store
    this.events = opts.events
    this.entities = createEntityRegistry()
    this.deviceId = deviceId
    this.clock = clock
    this.now = opts.now ?? (() => Date.now())
    this.uuid = opts.uuid ?? defaultUuid
  }

  /**
   * The device id this database may write under (DATA-SAFE-030). A device's journal is a single
   * append-only stream, so two databases must never write as the same device. That happens when
   * berean.db is copied (Migration Assistant, a copied Mac profile) or rolled back (an iPhone or
   * Time Machine backup restored): the copy still holds the old device id and an OLDER own
   * sequence number, so its next ops would reuse numbers other devices have already applied — and
   * be skipped there — and its manifest would drop files the original wrote after the copy.
   * Evidence of a fork, any of:
   *   - the database file's identity (its creation time, passed by the host) changed;
   *   - this device's manifest in iCloud is AHEAD of the sequence number stored here.
   * A fork gets a fresh device id and journal. Nothing local is discarded; the old device's
   * journal stays in iCloud and is pulled like any other device's, which brings back edits made
   * after the backup was taken.
   */
  static async resolveDeviceId(db: DatabaseAdapter, o: {
    newId: () => string
    storageIdentity?: string | null
    /** Reads a device's manifest from the transport; null when unknown / unavailable. */
    peekManifest?: (deviceId: string) => Promise<DeviceManifest | null>
    log?: ServiceLogger
  }): Promise<{ deviceId: string; forked: null | 'storage' | 'manifest-ahead' }> {
    const get = async (k: string) => (await db.get<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', [k]))?.value
    const set = (k: string, v: string) => db.run('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)', [k, v])
    const current = await get(STATE.deviceId)
    const storedIdentity = await get(STATE.storageIdentity)
    if (!current) {
      const id = o.newId()
      await set(STATE.deviceId, id)
      if (o.storageIdentity) await set(STATE.storageIdentity, o.storageIdentity)
      return { deviceId: id, forked: null }
    }
    let reason: null | 'storage' | 'manifest-ahead' = null
    if (o.storageIdentity && storedIdentity && storedIdentity !== o.storageIdentity) reason = 'storage'
    if (!reason && o.peekManifest) {
      const ownSeq = Number((await get(STATE.ownSeq)) ?? 0)
      const m = await o.peekManifest(current).catch(() => null)
      if (m && m.device === current && m.seq > ownSeq) reason = 'manifest-ahead'
    }
    if (o.storageIdentity && !storedIdentity) await set(STATE.storageIdentity, o.storageIdentity)
    if (!reason) return { deviceId: current, forked: null }
    const id = o.newId()
    await db.transaction(async (tx) => {
      const forks = parseJsonOr<Array<{ from: string; to: string; reason: string; at: number }>>((await tx.get<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', [STATE.forks]))?.value, [])
      forks.push({ from: current, to: id, reason, at: Date.now() })
      // Everything this database was the last writer of is published again under the new id with
      // its own version: devices that already have it recognise it; a version the copy pushed but
      // that never became visible (both copies writing at once) is not lost.
      for (const [k, v] of [[STATE.deviceId, id], [STATE.ownSeq, '0'], [STATE.ownFiles, '[]'], [STATE.snapshot, 'null'], [STATE.forks, JSON.stringify(forks.slice(-20))], [STATE.republish, `own:${current}`]] as const) {
        await tx.run('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)', [k, v])
      }
      if (o.storageIdentity) await tx.run('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)', [STATE.storageIdentity, o.storageIdentity])
    })
    o.log?.warn(`[sync] device identity forked (${reason}): ${current.slice(0, 8)} → ${id.slice(0, 8)}`)
    return { deviceId: id, forked: reason }
  }

  /** Load bookkeeping (device id, clock, own seq/files) and return a ready engine. */
  static async open(opts: SyncEngineOptions & { deviceId: string }): Promise<SyncEngine> {
    const get = async (k: string) => (await opts.db.get<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', [k]))?.value
    const set = (k: string, v: string) => opts.db.run('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)', [k, v])
    let deviceId = await get(STATE.deviceId)
    if (!deviceId) { deviceId = opts.deviceId; await set(STATE.deviceId, deviceId) }
    if (deviceId !== opts.store.deviceId) throw new Error(`SyncStore is bound to ${opts.store.deviceId} but this database's device id is ${deviceId}`)
    const last = await get(STATE.hlc)
    const clock = new HybridLogicalClock(deviceId, { now: opts.now, last: last || undefined, onDrift: (ms) => opts.log.warn(`[sync] clock drift ${ms} ms clamped`) })
    const engine = new SyncEngine(opts, deviceId, clock)
    engine.ownSeq = Number((await get(STATE.ownSeq)) ?? 0)
    try { engine.ownFiles = JSON.parse((await get(STATE.ownFiles)) ?? '[]') } catch { engine.ownFiles = [] }
    try { engine.ownSnapshot = JSON.parse((await get(STATE.snapshot)) ?? 'null') } catch { engine.ownSnapshot = null }
    engine.lastPushAt = numOrNull(await get(STATE.lastPushAt))
    engine.lastPullAt = numOrNull(await get(STATE.lastPullAt))
    if (opts.databaseProblem) engine.hold = { kind: 'database', at: engine.now(), detail: opts.databaseProblem }
    // Deletions held back by an earlier reconciliation stay held until the user decides.
    const q = parseJsonOr<SyncHold | null>(await get(STATE.quarantine), null)
    if (q && q.kind === 'quarantine' && !engine.hold) {
      engine.hold = q
      engine.quarantineKeys = parseJsonOr<Record<string, string[]>>(await get(STATE.quarantine + ':keys'), {})
    }
    // iCloud account (DATA-SAFE-040): the database belongs to the account it last synced with. A
    // different account means another person's (or an empty) iCloud: never merge the two
    // silently — hold until the user decides (switching back resumes on its own).
    if (opts.accountIdentity && !engine.hold) {
      const stored = await get(STATE.accountIdentity)
      if (!stored) await set(STATE.accountIdentity, opts.accountIdentity)
      else if (stored !== opts.accountIdentity) engine.hold = { kind: 'account', at: engine.now() }
    }
    // A new app version may understand ops an older one could not apply (an unknown entity, a
    // failing constraint): give every parked op a fresh set of attempts (DATA-SAFE-050).
    const lastVersion = await get(STATE.appVersion)
    if (lastVersion !== opts.appVersion) {
      await opts.db.run('UPDATE sync_failed SET attempts = 0')
      await set(STATE.appVersion, opts.appVersion)
    }
    return engine
  }

  /**
   * The user's answer to an account / container hold (DATA-SAFE-041/042):
   *   'republish'  this IS the iCloud to use: this database gets a new device id and, after the
   *                host reopens the engine, publishes every record it holds there (the other
   *                container is left untouched). Nothing is deleted anywhere.
   * Waiting is the other answer: switching back to the previous account (or the container
   * reappearing) lifts the hold by itself.
   */
  async resolveHold(choice: 'republish'): Promise<{ restart: true }> {
    void choice
    const id = this.uuid().replace(/-/g, '').slice(0, 16)
    await this.db.transaction(async (tx) => {
      for (const [k, v] of [[STATE.deviceId, id], [STATE.ownSeq, '0'], [STATE.ownFiles, '[]'], [STATE.snapshot, 'null'], [STATE.republish, '1']] as const) {
        await tx.run('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)', [k, v])
      }
      if (this.opts.accountIdentity) await tx.run('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)', [STATE.accountIdentity, this.opts.accountIdentity])
    })
    this.hold = null
    this.trace('hold:resolved', { kind: 'republish' })
    return { restart: true }
  }

  /** After `resolveHold('republish')` and a restart: journal every record as it stands, with its
   *  own version (not a new one), so devices already holding it recognise it and new ones get it. */
  async republishIfRequested(): Promise<number> {
    const flag = (await this.db.get<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', [STATE.republish]))?.value
    if (!flag) return 0
    let n = 0
    const onlyDevice = flag.startsWith('own:') ? flag.slice(4) : null
    const metas = onlyDevice
      ? await this.db.all<MetaRow & { entity: string; key: string }>(`SELECT entity, key, ${META_COLS} FROM sync_record_meta WHERE device = ?`, [onlyDevice])
      : await this.db.all<MetaRow & { entity: string; key: string }>(`SELECT entity, key, ${META_COLS} FROM sync_record_meta`)
    for (const m of metas) {
      const adapter = this.entities.get(m.entity)
      if (!adapter) continue
      const v = versionOfMeta(m)
      const rec = m.deleted ? undefined : await adapter.read(this.db, m.key)
      const op: Omit<SyncOp, 'seq' | 'device'> = {
        id: this.uuid(), hlc: m.hlc, entity: m.entity, key: m.key, op: rec && !rec.deleted ? 'upsert' : 'delete',
        ...(rec ? { fields: rec.fields } : {}), schema: this.opts.schema,
        ...(v.fieldHlc ? { fh: v.fieldHlc } : {}), ...(v.lineage ? { lin: v.lineage.slice(-LINEAGE_SEND) } : {}),
      }
      await this.db.run('INSERT INTO sync_outbox (entity, key, op_json, created_at) VALUES (?, ?, ?, ?)', [m.entity, m.key, JSON.stringify(op), this.now()])
      n++
    }
    await this.db.run('DELETE FROM sync_state WHERE key = ?', [STATE.republish])
    this.opts.log.info(`[sync] republished ${n} record(s)`)
    return n
  }

  /** What sync is holding back, if anything (Settings → iCloud shows it with its actions). */
  getHold(): SyncHold | null { return this.hold }

  private trace(event: string, meta?: Parameters<SyncTrace['record']>[1]): void {
    try { this.opts.trace?.record(event, meta) } catch { /* diagnostics never break sync */ }
  }

  /** The host's wake-up for outbound sync (in addition to `opts.onLocalChange`). */
  setLocalChangeListener(cb: (() => void) | null): void { this.localChangeListener = cb }

  /** The host was told the container changed (a watch event) — recorded for status / diagnostics. */
  noteNotified(paths?: number): void {
    this.lastNotifiedAt = this.now()
    this.trace('remote:notified', paths != null ? { paths } : undefined)
  }

  private async setState(k: string, v: string): Promise<void> {
    await this.db.run('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)', [k, v])
  }
  private async persistClock(): Promise<void> {
    await this.setState(STATE.hlc, this.clock.latest())
  }

  // ── capture ───────────────────────────────────────────────────────────────────────────────

  /** Subscribe to service change events so local mutations land in the outbox. */
  start(): void {
    if (this.unsubscribe) return
    this.unsubscribe = this.events.on('data:changed', (c) => { void this.onLocalChange(c) })
  }
  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
  }

  private captureQueue: Promise<void> = Promise.resolve()

  private onLocalChange(c: DataChange): Promise<void> {
    if (c.remote || !SYNCED_ENTITY_KINDS.has(c.entity)) return Promise.resolve()
    const adapter = this.entities.get(c.entity)!
    // The HLC and the record snapshot are taken NOW, at event time, not when the queued capture
    // runs: captures are serialised behind each other, so a late read would see later mutations
    // (a session tagged after its pause event) and give the op an HLC that predates records it
    // references. Event-time capture keeps ops causal within a device.
    const hlc = this.clock.tick()
    const direct = c.op !== 'bulk' && c.id ? { id: c.id, rec: adapter.read(this.db, c.id).catch(() => undefined) } : null
    const run = async () => {
      if (!direct) {
        // A bulk change (reorder, emptyTrash, merge…) — re-capture every live key of the entity.
        // Cheap for the entity sizes involved and keeps the outbox precise.
        await this.recaptureAll(c.entity, hlc, { guarded: false, explicit: c.scope === 'explicit-delete-all' })
      } else {
        await this.captureRecord(c.entity, direct.id, { hlc, rec: await direct.rec, direct: true })
      }
      if (c.op !== 'upsert' || !c.id) {
        // A delete or bulk change can take other rows with it without their own events (a purged
        // note's versions, a deleted tag's members, a deleted trail session's nodes and
        // connections, a deleted folder's notes moved to the root): find what vanished or changed.
        const explicit = c.scope === 'explicit-delete-all'
        await this.captureVanished(c.entity, hlc, { guarded: false, explicit })
        for (const dep of adapter.dependents ?? []) await this.recaptureAll(dep, hlc, { guarded: false, explicit })
      }
      this.trace('local:captured', { entity: c.entity, op: c.op, id: shortId(c.id) })
      try { this.opts.onLocalChange?.(); this.localChangeListener?.() } catch { /* host callback */ }
    }
    this.captureQueue = this.captureQueue.then(run, run).catch((err) => this.opts.log.error('[sync] capture failed', err))
    return this.captureQueue
  }

  /** Re-read every live record of an entity (only records whose synced fields changed produce ops)
   *  and tombstone the ones that are gone. */
  private async recaptureAll(entity: string, hlc: string, o: { guarded?: boolean; explicit?: boolean } = {}): Promise<void> {
    const adapter = this.entities.get(entity)
    if (!adapter) return
    for (const key of await adapter.listKeys(this.db)) await this.captureRecord(entity, key, { hlc })
    await this.captureVanished(entity, hlc, o)
  }

  /**
   * Records we told other devices about that no longer exist locally (hard-deleted) → delete ops.
   *
   * Deletion INFERRED from absence is the one place local state alone could delete cloud data, so
   * it is guarded (DATA-SAFE-020, "an empty or partial local database is never the user deleting
   * everything"): when a pass would infer more than VANISH_LIMIT deletions for an entity — or the
   * entity's table is empty while records are known — nothing is sent, the keys are recorded
   * as quarantined and sync reports it. The user then restores them from iCloud or confirms the
   * deletion (`resolveQuarantine`). A user's own delete of a record arrives as a direct event
   * and is never inferred; `guarded: false` is only used for the cascades of an explicit delete
   * the user just made, with the same empty-table stop.
   */
  private async captureVanished(entity: string, hlc: string, o: { guarded?: boolean; explicit?: boolean } = {}): Promise<number> {
    const adapter = this.entities.get(entity)
    if (!adapter) return 0
    if (this.hold?.kind === 'database') return 0   // a damaged database proves nothing about deletions
    const known = await this.db.all<{ key: string }>('SELECT key FROM sync_record_meta WHERE entity = ? AND deleted = 0', [entity])
    if (known.length === 0) return 0
    const liveKeys = await adapter.listKeys(this.db)
    const live = new Set(liveKeys)
    const held = this.quarantinedKeys(entity)
    const vanished = known.map((r) => r.key).filter((k) => !live.has(k) && !held.has(k))
    if (vanished.length === 0) return 0
    const guarded = o.guarded !== false
    // Unguarded = the cascade of a delete the user just made (a purged note's versions, a deleted
    // tag's members): only a large table emptied at once is suspicious there.
    const tableEmpty = liveKeys.length === 0 && known.length >= (guarded ? 3 : 50)
    const tooMany = vanished.length > Math.max(VANISH_LIMIT.absolute, Math.ceil(known.length * VANISH_LIMIT.fraction))
    if (!o.explicit && (tableEmpty || (guarded && tooMany))) {
      await this.quarantine(entity, vanished)
      return 0
    }
    for (const k of vanished) await this.captureRecord(entity, k, { hlc })
    return vanished.length
  }

  private quarantinedKeys(entity: string): Set<string> {
    return new Set(this.quarantineKeys[entity] ?? [])
  }
  private quarantineKeys: Record<string, string[]> = {}

  private async quarantine(entity: string, keys: string[]): Promise<void> {
    const merged = new Set([...(this.quarantineKeys[entity] ?? []), ...keys])
    this.quarantineKeys[entity] = [...merged]
    const entities = Object.fromEntries(Object.entries(this.quarantineKeys).map(([e, k]) => [e, k.length]))
    this.hold = { kind: 'quarantine', entities, at: this.now() }
    await this.db.transaction(async (tx) => {
      await tx.run('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)', [STATE.quarantine, JSON.stringify(this.hold)])
      await tx.run('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)', [STATE.quarantine + ':keys', JSON.stringify(this.quarantineKeys)])
    })
    this.opts.log.warn(`[sync] ${keys.length} ${entity} record(s) missing locally — NOT deleted from iCloud (held for review)`)
    this.trace('hold:quarantine', { entity, count: keys.length })
  }

  /**
   * The user's answer to a quarantine:
   *   'restore'  bring the missing records back from iCloud (the default, safe answer): their
   *              bookkeeping is cleared and every journal — this device's own included — is
   *              replayed; everything already present is recognised and skipped
   *   'delete'   they really were deleted here: send the deletions
   */
  async resolveQuarantine(choice: 'restore' | 'delete'): Promise<number> {
    const keys = this.quarantineKeys
    let n = 0
    if (choice === 'delete') {
      const hlc = this.clock.tick()
      this.quarantineKeys = {}
      for (const [entity, list] of Object.entries(keys)) for (const k of list) { await this.captureRecord(entity, k, { hlc }); n++ }
    } else {
      await this.db.transaction(async (tx) => {
        for (const [entity, list] of Object.entries(keys)) for (const k of list) { await tx.run('DELETE FROM sync_record_meta WHERE entity = ? AND key = ?', [entity, k]); n++ }
        await tx.run('DELETE FROM sync_applied')
      })
      this.quarantineKeys = {}
      this.replayOwn = true
    }
    if (this.hold?.kind === 'quarantine') this.hold = null
    await this.db.run('DELETE FROM sync_state WHERE key IN (?, ?)', [STATE.quarantine, STATE.quarantine + ':keys'])
    this.trace('hold:resolved', { choice, count: n })
    return n
  }
  /** Next pull also replays this device's own journal (recovery after a quarantine). */
  private replayOwn = false

  /**
   * Read the record's current state and queue an op for it (coalescing with a pending unflushed
   * op for the same record). Also advances the record's meta to this change's HLC so a remote op
   * arriving later can tell whether it diverged from what we had.
   */
  async captureRecord(entity: string, key: string, at?: { hlc: string; rec?: EntityRecord | undefined; direct?: boolean }): Promise<void> {
    const adapter = this.entities.get(entity)
    if (!adapter) return
    const rec = at && 'rec' in at ? at.rec : await adapter.read(this.db, key)
    const meta = await this.db.get<MetaRow>(`SELECT ${META_COLS} FROM sync_record_meta WHERE entity = ? AND key = ?`, [entity, key])
    const op: SyncOp['op'] = !rec || rec.deleted ? 'delete' : 'upsert'
    // Nothing to tell other devices about a record they never knew or already saw deleted.
    if (op === 'delete' && (!meta || meta.deleted)) return
    const hash = op === 'upsert' ? hashFields(rec!.fields) : null
    const hlc = at?.hlc ?? this.clock.tick()
    const pending = await this.db.get<OutboxRow>('SELECT seq, entity, key, op_json FROM sync_outbox WHERE entity = ? AND key = ? ORDER BY seq DESC LIMIT 1', [entity, key])
    if (op === 'upsert' && meta && !meta.deleted && meta.hash === hash) {
      // Unchanged synced fields. A bulk re-capture (reorder, emptyTrash…) touches every record;
      // untouched records keep their HLC (no spurious conflicts on other devices). A direct event
      // for this record whose op is still in the outbox does move that op forward to the event's
      // time — an earlier capture may have read state that this later event produced.
      if (at?.direct && pending && compareHlc(hlc, meta.hlc) > 0) {
        const prev = JSON.parse(pending.op_json) as SyncOp
        const lineage = childLineage(versionOfMeta(meta))
        await this.db.transaction(async (tx) => {
          await tx.run('UPDATE sync_outbox SET op_json = ? WHERE seq = ?', [JSON.stringify({ ...prev, hlc, lin: lineage.slice(-LINEAGE_SEND) }), pending.seq])
          await tx.run('UPDATE sync_record_meta SET hlc = ?, lineage = ? WHERE entity = ? AND key = ?', [hlc, JSON.stringify(lineage), entity, key])
          await tx.run('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)', [STATE.hlc, this.clock.latest()])
        })
      }
      return
    }
    // Coalescing keeps the EARLIEST base so the other side still sees the true divergence point.
    const base = pending ? (JSON.parse(pending.op_json) as Partial<SyncOp>).base : meta?.hlc
    // The new version descends from what this device had (DATA-SAFE-001): its lineage is the
    // previous version plus that version's ancestors. A record recreated after a deletion this
    // device saw descends from the tombstone, so other devices recognise it as a recreation.
    const prev = meta ? versionOfMeta(meta) : null
    const lineage = childLineage(prev)
    // Per-field clocks: fields whose value this write changed get the new clock; the rest keep the
    // version that last changed them — so a device that only pinned a note does not claim to have
    // written its text.
    let fh: Record<string, string> | undefined
    let fHash: Record<string, string> | undefined
    if (op === 'upsert') {
      fHash = fieldHashes(rec!.fields)
      const prevHash = meta && !meta.deleted ? parseJsonOr<Record<string, string> | null>(meta.field_hash, null) : null
      fh = {}
      for (const f of Object.keys(rec!.fields)) {
        fh[f] = prevHash && prevHash[f] === fHash[f] ? (prev?.fieldHlc?.[f] ?? prev!.hlc) : hlc
      }
    }
    // Tombstone rows (sessions/tabs) carry their deleted_at so the receiver records the same time.
    const fields = op === 'upsert' ? rec!.fields : (rec?.deleted ? rec.fields : undefined)
    const syncOp: Omit<SyncOp, 'seq' | 'device'> = {
      id: this.uuid(), hlc, entity, key, op,
      ...(fields ? { fields } : {}),
      ...(base ? { base } : {}),
      schema: this.opts.schema,
      ...(fh ? { fh } : {}),
      lin: lineage.slice(-LINEAGE_SEND),
    }
    await this.db.transaction(async (tx) => {
      if (pending) {
        await tx.run('UPDATE sync_outbox SET op_json = ?, created_at = ? WHERE seq = ?', [JSON.stringify(syncOp), this.now(), pending.seq])
      } else {
        await tx.run('INSERT INTO sync_outbox (entity, key, op_json, created_at) VALUES (?, ?, ?, ?)', [entity, key, JSON.stringify(syncOp), this.now()])
      }
      await this.writeMeta(tx, entity, key, { hlc, device: this.deviceId, deleted: op === 'delete', hash, fieldHlc: fh ?? null, fieldHash: fHash ?? null, lineage })
      await tx.run('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)', [STATE.hlc, this.clock.latest()])
      await tx.run('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)', [STATE.capturedAt, String(this.now())])
    })
  }

  private async writeMeta(tx: DatabaseAdapter, entity: string, key: string, m: { hlc: string; device: string; deleted: boolean; hash: string | null; fieldHlc: Record<string, string> | null; fieldHash: Record<string, string> | null; lineage: string[] | null }): Promise<void> {
    await tx.run(
      `INSERT OR REPLACE INTO sync_record_meta (entity, key, hlc, device, deleted, hash, field_hlc, field_hash, lineage) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [entity, key, m.hlc, m.device, m.deleted ? 1 : 0, m.hash, m.fieldHlc ? JSON.stringify(m.fieldHlc) : null, m.fieldHash ? JSON.stringify(m.fieldHash) : null, m.lineage ? JSON.stringify(m.lineage) : null],
    )
  }

  /**
   * Local reconciliation (DATA-SYNC-001): capture every change the event-driven capture missed —
   * writes made while this device was not capturing (sync switched off, or an older build that
   * only captured while iCloud was reachable) and the few milliseconds between a database write
   * and its queued capture when the app is killed. Records whose synced fields still hash to what
   * was last captured / applied produce nothing, so running it is cheap and safe.
   *
   *   full = false  rows changed since the last capture watermark (tables with a timestamp) plus a
   *                 one-query compare of the small tables without one; the default at every start.
   *   full = true   every row of every entity (sync re-enabled, or no watermark yet).
   * Returns the number of records it (re)captured.
   */
  async reconcileLocal(full = false): Promise<number> {
    await this.captureQueue
    if (this.hold?.kind === 'database') return 0
    const started = this.now()
    // The watermark pass trusts each table's timestamp column; a write that does not bump it
    // (a pin, a colour) and whose capture was cut off by a kill would be missed forever. A full
    // hash compare every week closes that gap (DATA-SAFE-011).
    const lastFull = numOrNull((await this.db.get<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', [STATE.lastFullReconcile]))?.value)
    if (!full && (lastFull == null || started - lastFull > FULL_RECONCILE_EVERY_MS)) full = true
    const mark = full ? null : numOrNull((await this.db.get<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', [STATE.capturedAt]))?.value)
    const hlc = this.clock.tick()
    const before = (await this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM sync_outbox'))?.n ?? 0
    for (const adapter of this.entities.values()) {
      const keys = mark != null && adapter.changedSince ? await adapter.changedSince(this.db, mark - RECONCILE_MARGIN_MS) : null
      if (keys) {
        for (const key of keys) await this.captureRecord(adapter.kind, key, { hlc })
      } else if (adapter.readAll) {
        const metas = new Map((await this.db.all<{ key: string; hash: string | null; deleted: number }>('SELECT key, hash, deleted FROM sync_record_meta WHERE entity = ?', [adapter.kind])).map((m) => [m.key, m]))
        for (const [key, rec] of await adapter.readAll(this.db)) {
          const m = metas.get(key)
          if (rec.deleted ? (!m || m.deleted) : (m && !m.deleted && m.hash === hashFields(rec.fields))) continue
          await this.captureRecord(adapter.kind, key, { hlc, rec })
        }
      } else {
        for (const key of await adapter.listKeys(this.db)) await this.captureRecord(adapter.kind, key, { hlc })
      }
      await this.captureVanished(adapter.kind, hlc)
    }
    await this.setState(STATE.capturedAt, String(started))
    if (full) await this.setState(STATE.lastFullReconcile, String(started))
    await this.persistClock()
    const after = (await this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM sync_outbox'))?.n ?? 0
    return Math.max(0, after - before)
  }

  /**
   * One-time adoption of data that existed before sync was enabled: every live record of every
   * synced entity becomes an upsert op whose HLC is derived from the row's own `updated_at` /
   * `created_at`, so an older desktop copy of a record never overrides a newer edit made elsewhere
   * (ids are UUIDs, so the same record can only exist on two devices if it was synced before).
   */
  async adoptExisting(): Promise<number> {
    const done = (await this.db.get<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', [STATE.adopted]))?.value
    if (done === '1') return 0
    let count = 0
    for (const adapter of this.entities.values()) {
      for (const key of await adapter.listKeys(this.db)) {
        const meta = await this.db.get<MetaRow>('SELECT hlc, device, deleted FROM sync_record_meta WHERE entity = ? AND key = ?', [adapter.kind, key])
        if (meta) continue
        const rec = await adapter.read(this.db, key)
        if (!rec || rec.deleted) continue
        const ts = pickTimestamp(rec.fields) ?? this.now()
        const hlc = formatHlc({ wallMs: Math.min(ts, this.now()), counter: 0, deviceId: this.deviceId })
        this.clock.receive(hlc)
        // A pre-sync record is a creation (no ancestry): per-field clocks all at its own time.
        const fh = Object.fromEntries(Object.keys(rec.fields).map((f) => [f, hlc]))
        const syncOp: Omit<SyncOp, 'seq' | 'device'> = { id: this.uuid(), hlc, entity: adapter.kind, key, op: 'upsert', fields: rec.fields, schema: this.opts.schema, fh, lin: [] }
        await this.db.transaction(async (tx) => {
          await tx.run('INSERT INTO sync_outbox (entity, key, op_json, created_at) VALUES (?, ?, ?, ?)', [adapter.kind, key, JSON.stringify(syncOp), this.now()])
          await this.writeMeta(tx, adapter.kind, key, { hlc, device: this.deviceId, deleted: false, hash: hashFields(rec.fields), fieldHlc: fh, fieldHash: fieldHashes(rec.fields), lineage: [] })
        })
        count++
      }
    }
    await this.setState(STATE.adopted, '1')
    await this.persistClock()
    return count
  }

  // ── push ──────────────────────────────────────────────────────────────────────────────────

  /** Holds that stop all transport traffic (a quarantine only withholds the inferred deletions). */
  private blocked(): boolean {
    return !!this.hold && this.hold.kind !== 'quarantine'
  }
  /** Holds only the user can lift (a container hold is re-checked on every pass and lifts itself). */
  private blockedHard(): boolean {
    return !!this.hold && (this.hold.kind === 'account' || this.hold.kind === 'database')
  }

  /** Set when this database turned out to be a copy / rollback while running: the host must
   *  reopen the engine, which forks the device id (resolveDeviceId). */
  forkDetected = false

  /**
   * Is the container still the one this database has been syncing with (DATA-SAFE-041)? After
   * this device has published, its own manifest must be there. If neither it nor any device we
   * ever received from is visible, iCloud is a different (or wiped, or signed-out) container:
   * pushing would publish this device's changes into someone else's iCloud and pulling would
   * merge theirs into this database, so sync holds until they reappear or the user decides.
   * Returns this device's manifest (null when absent).
   */
  private async checkContainer(): Promise<DeviceManifest | null | undefined> {
    let own: DeviceManifest | null
    try { own = await this.store.readManifest(this.deviceId) } catch { return undefined }
    if (own && own.seq > this.ownSeq) {
      // Another database is writing as this device (copy / restored backup still running).
      this.forkDetected = true
      this.lastError = 'This device\'s iCloud history is ahead of its database (restored or copied). Berean will resync as a new device.'
      this.trace('hold:fork', { seq: own.seq, local: this.ownSeq })
      return own
    }
    if (this.hold?.kind === 'container' && own) { this.hold = null; this.trace('hold:resolved', { kind: 'container' }) }
    if (own || this.ownSeq === 0) return own
    // Our journal files are there but the manifest is not (killed between the two writes): it is
    // our container — the push repairs the manifest.
    const last = this.ownFiles[this.ownFiles.length - 1]
    if (last) {
      try { await this.store.readFile(this.deviceId, last.name); if (this.hold?.kind === 'container') this.hold = null; return own } catch { /* not there */ }
    }
    const listed = new Set(await this.store.listDevices().catch(() => [] as string[]))
    const known = (await this.db.all<{ device: string }>('SELECT DISTINCT device FROM sync_applied')).map((r) => r.device)
    if (known.some((d) => d !== this.deviceId && listed.has(d))) return own
    if (this.hold?.kind !== 'container') {
      this.hold = { kind: 'container', at: this.now() }
      this.opts.log.warn('[sync] iCloud container does not hold this device\'s history — sync paused')
      this.trace('hold:container')
    }
    return own
  }

  async push(): Promise<number> {
    await this.captureQueue
    if (this.blockedHard() || this.forkDetected) { this.trace('push:held', { hold: this.hold?.kind ?? 'fork' }); return 0 }
    const rows = await this.db.all<OutboxRow>('SELECT seq, entity, key, op_json FROM sync_outbox ORDER BY seq ASC')
    const status = await this.store.status()
    if (!status.available) {
      if (rows.length) { this.lastError = status.reason ?? 'transport unavailable'; this.trace('push:skipped', { reason: 'unavailable', pending: rows.length }) }
      return 0
    }
    const own = await this.checkContainer()
    if (this.blocked() || this.forkDetected) return 0
    if (rows.length === 0) {
      // Nothing new. A crash after the outbox was committed but before the manifest was written
      // leaves published files unlisted — other devices would never read them (DATA-SAFE-033).
      if ((own === null || (own && own.seq < this.ownSeq)) && this.ownSeq > 0) { try { await this.writeManifest(); this.trace('push:manifest-repaired', { seq: this.ownSeq }) } catch (err) { this.opts.log.warn('[sync] manifest repair failed', err) } }
      // Journal files waiting on other devices' acknowledgement may be prunable now.
      try { await this.pruneCompacted() } catch (err) { this.opts.log.warn('[sync] prune failed', err) }
      return 0
    }
    this.phase = 'uploading'
    this.trace('push:start', { ops: rows.length })
    const ops: SyncOp[] = rows.map((r, i) => ({ ...(JSON.parse(r.op_json) as Omit<SyncOp, 'seq' | 'device'>), seq: this.ownSeq + i + 1, device: this.deviceId }))
    const files = chunkForFiles(ops)
    try {
      for (const f of files) await this.store.writeOwnFile(f.info.name, f.content)
      this.ownFiles = [...this.ownFiles, ...files.map((f) => f.info)]
      this.ownSeq = ops[ops.length - 1].seq
      await this.db.transaction(async (tx) => {
        await tx.run('DELETE FROM sync_outbox WHERE seq <= ?', [rows[rows.length - 1].seq])
        await tx.run('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)', [STATE.ownSeq, String(this.ownSeq)])
        await tx.run('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)', [STATE.ownFiles, JSON.stringify(this.ownFiles)])
      })
      await this.writeManifest()
      this.lastPushAt = this.now()
      await this.setState(STATE.lastPushAt, String(this.lastPushAt))
      this.lastError = null
      this.trace('push:written', { ops: ops.length, files: files.length, seq: this.ownSeq })
      try { await this.compact() } catch (err) { this.opts.log.warn('[sync] compaction failed', err) }
      return ops.length
    } catch (err) {
      this.lastError = `push: ${err instanceof Error ? err.message : String(err)}`
      this.opts.log.error('[sync] push failed', err)
      this.trace('push:error', { kind: err instanceof Error ? err.name : 'error' })
      return 0
    } finally {
      this.phase = 'idle'
    }
  }

  private async writeManifest(): Promise<void> {
    const applied: Record<string, number> = {}
    for (const r of await this.db.all<{ device: string; seq: number }>('SELECT device, MAX(seq) AS seq FROM sync_applied GROUP BY device')) if (r.device !== this.deviceId) applied[r.device] = r.seq
    await this.store.writeOwnManifest({
      device: this.deviceId, name: this.opts.deviceName, platform: this.opts.platform, appVersion: this.opts.appVersion, schema: this.opts.schema,
      seq: this.ownSeq, files: this.ownFiles, applied, ...(this.ownSnapshot ? { snapshot: this.ownSnapshot } : {}), updatedAt: this.now(),
    })
  }

  // ── compaction (docs/mobile/icloud.md §8) ─────────────────────────────────────────────────

  /** Live journal = files newer than the last snapshot. */
  private liveJournal(): { ops: number; bytes: number } {
    const since = this.ownSnapshot?.seq ?? 0
    let ops = 0, bytes = 0
    for (const f of this.ownFiles) if (f.seqTo > since) { ops += f.seqTo - Math.max(f.seqFrom, since + 1) + 1; bytes += f.bytes ?? 0 }
    return { ops, bytes }
  }

  /**
   * Write `snapshot-<ownSeq>.json` with the current state of every record this device is the
   * current writer of (upserts with their HLCs and tombstones), once the live journal is past
   * the thresholds. The snapshot is what a device that missed (or lost) journal files ≤ ownSeq
   * bootstraps from; journal files are only removed later by `pruneCompacted`.
   */
  async compact(force = false): Promise<boolean> {
    const live = this.liveJournal()
    if (!force && live.ops < COMPACT_AFTER_OPS && live.bytes < COMPACT_AFTER_BYTES) return false
    if (this.ownSnapshot && this.ownSnapshot.seq >= this.ownSeq) return false
    const records: SnapshotRecord[] = []
    const metas = await this.db.all<MetaRow & { entity: string; key: string }>(`SELECT entity, key, ${META_COLS} FROM sync_record_meta WHERE device = ? ORDER BY entity, key`, [this.deviceId])
    for (const m of metas) {
      const v = versionOfMeta(m)
      const extra = { ...(v.fieldHlc ? { fh: v.fieldHlc } : {}), ...(v.lineage ? { lin: v.lineage.slice(-LINEAGE_SEND) } : {}) }
      if (m.deleted) { records.push({ entity: m.entity, key: m.key, hlc: m.hlc, op: 'delete', ...extra }); continue }
      const adapter = this.entities.get(m.entity)
      if (!adapter) continue
      const rec = await adapter.read(this.db, m.key)
      if (!rec) continue
      records.push(rec.deleted ? { entity: m.entity, key: m.key, hlc: m.hlc, op: 'delete', fields: rec.fields, ...extra } : { entity: m.entity, key: m.key, hlc: m.hlc, op: 'upsert', fields: rec.fields, ...extra })
    }
    const file: SnapshotFile = { format: SYNC_FORMAT_VERSION, device: this.deviceId, seq: this.ownSeq, schema: this.opts.schema, writtenAt: this.now(), records }
    const name = snapshotFileName(this.ownSeq)
    const content = JSON.stringify(file)
    await this.store.writeOwnFile(name, content)
    const previous = this.ownSnapshot
    this.ownSnapshot = { name, seq: this.ownSeq, records: records.length, bytes: content.length }
    await this.setState(STATE.snapshot, JSON.stringify(this.ownSnapshot))
    await this.writeManifest()
    if (previous && previous.name !== name) await this.store.deleteOwnFile(previous.name).catch(() => {})
    this.opts.log.info(`[sync] compacted: snapshot ${name} (${records.length} records)`)
    await this.pruneCompacted()
    return true
  }

  /**
   * Remove journal files ≤ the snapshot seq once every other known device's manifest reports
   * `applied[me] ≥ snapshot.seq` — or has been silent for 90 days (it will bootstrap from the
   * snapshot). A device never touches another device's folder.
   */
  async pruneCompacted(): Promise<number> {
    if (!this.ownSnapshot) return 0
    const prunable = this.ownFiles.filter((f) => f.seqTo <= this.ownSnapshot!.seq)
    if (prunable.length === 0) return 0
    for (const device of await this.store.listDevices()) {
      if (device === this.deviceId) continue
      let m: DeviceManifest | null
      try { m = await this.store.readManifest(device) } catch { return 0 }
      if (!m) return 0   // not downloaded yet: assume it still needs the files
      if ((m.applied[this.deviceId] ?? 0) >= this.ownSnapshot.seq) continue
      if (this.now() - m.updatedAt > COMPACT_SILENT_MS) continue
      return 0
    }
    for (const f of prunable) await this.store.deleteOwnFile(f.name)
    this.ownFiles = this.ownFiles.filter((f) => f.seqTo > this.ownSnapshot!.seq)
    await this.setState(STATE.ownFiles, JSON.stringify(this.ownFiles))
    await this.writeManifest()
    this.opts.log.info(`[sync] pruned ${prunable.length} journal file(s) ≤ ${this.ownSnapshot.seq}`)
    return prunable.length
  }

  /**
   * Bootstrap from another device's snapshot when its journal no longer reaches back to what we
   * have applied (new device, reinstall, or files pruned after compaction). Records are applied
   * under the normal merge rules — LWW by the HLC each record carried — so nothing newer on this
   * device is overwritten, and the pass is idempotent (rerun-safe if interrupted).
   */
  private async applySnapshot(device: string, manifest: DeviceManifest, touched: Set<string>): Promise<number> {
    const snap = manifest.snapshot!
    let text: string | null
    try { text = await this.store.readFile(device, snap.name) } catch (err) { this.opts.log.warn(`[sync] cannot read ${device}/${snap.name}`, err); return 0 }
    if (text === null) return 0
    let file: SnapshotFile
    try { file = JSON.parse(text) as SnapshotFile } catch { this.unreadable++; return 0 }
    if (!file || file.device !== device || !Array.isArray(file.records)) { this.unreadable++; return 0 }
    let applied = 0
    for (const r of file.records) {
      if (!r || typeof r.entity !== 'string' || typeof r.key !== 'string' || typeof r.hlc !== 'string') { this.unreadable++; continue }
      const op: SyncOp = { id: `${device}-snapshot-${snap.seq}-${r.entity}-${r.key}`, seq: snap.seq, hlc: r.hlc, device, entity: r.entity, key: r.key, op: r.op, ...(r.fields ? { fields: r.fields } : {}), schema: file.schema, ...(r.fh ? { fh: r.fh } : {}), ...(r.lin ? { lin: r.lin } : {}) }
      try { await this.applyOne(op, touched, { recordApplied: false, replay: true }); applied++ } catch (err) {
        this.opts.log.error(`[sync] snapshot apply failed ${r.entity}/${r.key} from ${device}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    // Everything ≤ snap.seq is now represented; the journal continues from snap.seq + 1.
    await this.db.run('INSERT OR IGNORE INTO sync_applied (device, seq) VALUES (?, ?)', [device, snap.seq])
    this.opts.log.info(`[sync] bootstrapped from ${device}/${snap.name}: ${applied} records`)
    return applied
  }

  // ── pull ──────────────────────────────────────────────────────────────────────────────────

  async pull(): Promise<number> {
    if (this.blockedHard() || this.forkDetected) { this.trace('pull:held', { hold: this.hold?.kind ?? 'fork' }); return 0 }
    const status = await this.store.status()
    if (!status.available) { this.lastError = status.reason ?? 'transport unavailable'; this.trace('pull:skipped', { reason: 'unavailable' }); return 0 }
    await this.checkContainer()
    if (this.blocked() || this.forkDetected) return 0
    this.phase = 'reconciling'
    try { return await this.pullInner() } finally { this.phase = 'idle' }
  }

  private async pullInner(): Promise<number> {
    const maxAttempts = this.opts.maxAttempts ?? 5
    let pending: SyncOp[] = []
    this.unreadable = 0
    const newer: string[] = []
    const touchedBySnapshot = new Set<string>()
    let snapshotApplied = 0
    let waiting = 0
    this.trace('pull:start')
    const replay = this.replayOwn
    this.replayOwn = false
    for (const device of await this.store.listDevices()) {
      // This device's own journal is only read back in a recovery replay (resolveQuarantine).
      if (device === this.deviceId && !replay) continue
      let manifest: DeviceManifest | null
      try { manifest = await this.store.readManifest(device) } catch { continue }
      if (!manifest) { waiting++; this.trace('pull:waiting', { device: shortId(device), file: 'manifest' }); continue }
      if (manifest.schema > this.opts.schema) { newer.push(device); continue }
      let cursor = (await this.db.get<{ seq: number | null }>('SELECT MAX(seq) AS seq FROM sync_applied WHERE device = ?', [device]))?.seq ?? 0
      const files = [...manifest.files].map((f) => parseJournalFileName(f.name) ?? f).sort((a, b) => a.seqFrom - b.seqFrom)
      if (manifest.snapshot && cursor < manifest.snapshot.seq && !files.some((f) => f.seqFrom <= cursor + 1 && f.seqTo >= cursor + 1)) {
        // The journal no longer reaches back to where we are (compacted, or we are new): bootstrap.
        const n = await this.applySnapshot(device, manifest, touchedBySnapshot)
        if (n === 0 && !(await this.db.get('SELECT 1 FROM sync_applied WHERE device = ? AND seq = ?', [device, manifest.snapshot.seq]))) continue   // snapshot not readable yet
        snapshotApplied += n
        cursor = Math.max(cursor, manifest.snapshot.seq)
      }
      const failed = new Map((await this.db.all<{ seq: number; attempts: number }>('SELECT seq, attempts FROM sync_failed WHERE device = ?', [device])).map((r) => [r.seq, r.attempts]))
      let expected = cursor + 1
      for (const f of files) {
        if (f.seqTo < expected && ![...failed.keys()].some((s) => s >= f.seqFrom && s <= f.seqTo)) continue
        if (f.seqFrom > expected && !failed.size) break   // gap: a file this device has not published/downloaded yet
        let text: string | null
        try { text = await this.store.readFile(device, f.name) } catch (err) { this.opts.log.warn(`[sync] cannot read ${device}/${f.name}`, err); break }
        if (text === null) { waiting++; this.trace('pull:waiting', { device: shortId(device), file: f.name }); break }   // not downloaded yet — stop at the gap, never skip
        const decoded = decodeJournal(text)
        this.unreadable += decoded.unreadable
        for (const op of decoded.ops) {
          if (op.device !== device) { this.unreadable++; continue }
          const attempts = failed.get(op.seq)
          if (op.seq < expected && attempts === undefined) continue
          if (attempts !== undefined && attempts >= maxAttempts) continue
          pending.push(op)
          if (op.seq >= expected) expected = op.seq + 1
        }
        if (decoded.truncated) break   // the rest of this device's stream is still being written
      }
    }
    if (newer.length) this.lastError = `Update Berean to sync with: ${newer.join(', ')}`
    // Global order: HLC, then device + seq as a deterministic tiebreak.
    pending.sort((a, b) => compareHlc(a.hlc, b.hlc) || (a.device < b.device ? -1 : a.device > b.device ? 1 : a.seq - b.seq))
    const touched = touchedBySnapshot
    let applied = snapshotApplied
    for (const op of pending) {
      const already = await this.db.get('SELECT 1 FROM sync_applied WHERE device = ? AND seq = ?', [op.device, op.seq])
      if (already) continue
      try {
        await this.applyOne(op, touched, { replay })
        applied++
        this.trace('remote:applied', { entity: op.entity, op: op.op, id: shortId(op.key), device: shortId(op.device), seq: op.seq })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        this.opts.log.error(`[sync] apply failed ${op.entity}/${op.key} from ${op.device}#${op.seq}: ${msg}`)
        await this.db.run('INSERT INTO sync_failed (device, seq, error, attempts) VALUES (?, ?, ?, 1) ON CONFLICT(device, seq) DO UPDATE SET error = excluded.error, attempts = attempts + 1', [op.device, op.seq, msg])
      }
    }
    await this.publishResolutions()
    if (this.madeConflictCopies.size) {
      const hlc = this.clock.tick()
      for (const id of this.madeConflictCopies) await this.captureRecord('note_version', id, { hlc })
      this.madeConflictCopies.clear()
    }
    this.lastPullAt = this.now()
    await this.setState(STATE.lastPullAt, String(this.lastPullAt))
    await this.persistClock()
    this.remoteWaiting = waiting
    this.trace('pull:done', { applied, waiting })
    if (applied > 0) {
      this.lastApplied = { at: this.now(), count: applied }
      try { await this.writeManifest() } catch (err) { this.opts.log.warn('[sync] manifest update after pull failed', err) }
      this.opts.onApplied?.(touched)
    }
    if (!newer.length && this.lastError?.startsWith('Update Berean')) this.lastError = null
    return applied
  }

  /**
   * Apply one remote op under the merge model (merge.ts). Runs in its own transaction, and the
   * op is recorded as applied in the SAME transaction — so a kill mid-pull never leaves an op
   * half-applied or recorded without its effect, and a redelivered op is recognised twice over
   * (sync_applied and the record's lineage).
   */
  private async applyOne(op: SyncOp, touched: Set<string>, o: { recordApplied?: boolean; replay?: boolean } = {}): Promise<void> {
    const adapter = this.entities.get(op.entity)
    const recordApplied = o.recordApplied !== false
    this.clock.receive(op.hlc)
    await this.db.transaction(async (tx) => {
      if (!adapter) {
        // Unknown entity (a newer build's data): never dropped (DATA-SAFE-050). Parked in
        // sync_failed with its attempts used up; the next app version re-arms it (open()).
        if (recordApplied) await tx.run(`INSERT INTO sync_failed (device, seq, error, attempts) VALUES (?, ?, ?, ?) ON CONFLICT(device, seq) DO UPDATE SET error = excluded.error, attempts = excluded.attempts`, [op.device, op.seq, `unknown entity ${op.entity}`, this.opts.maxAttempts ?? 5])
        return
      }
      const meta = await tx.get<MetaRow>(`SELECT ${META_COLS} FROM sync_record_meta WHERE entity = ? AND key = ?`, [op.entity, op.key])
      const remote = versionOfOp(op)
      if (!meta) {
        await this.applyFresh(tx, adapter, op, remote, touched)
      } else {
        const local = versionOfMeta(meta)
        // A replay (recovery pass, snapshot overlapping journals) of an op older than a record
        // recorded before v47 is history this device already incorporated.
        const replayedLegacy = !!o.replay && local.lineage === null && compareHlc(op.hlc, meta.hlc) <= 0
        const rel = replayedLegacy ? 'known' : relate(local, remote)
        if (rel === 'descends') await this.applyForward(tx, adapter, op, local, remote, touched)
        else if (rel === 'concurrent') await this.applyConcurrent(tx, adapter, op, meta, local, remote, touched)
        // 'known': this device already has this version (or a later one built on it) — nothing to do.
      }
      if (recordApplied) {
        await tx.run('INSERT OR IGNORE INTO sync_applied (device, seq) VALUES (?, ?)', [op.device, op.seq])
        await tx.run('DELETE FROM sync_failed WHERE device = ? AND seq = ?', [op.device, op.seq])
      }
    })
  }

  private fieldClocksOf(op: SyncOp): Record<string, string> {
    return op.fh ?? Object.fromEntries(Object.keys(op.fields ?? {}).map((f) => [f, op.hlc]))
  }

  /** First time this device hears of the record. */
  private async applyFresh(tx: DatabaseAdapter, adapter: EntityAdapter, op: SyncOp, remote: VersionInfo, touched: Set<string>): Promise<void> {
    if (op.op === 'delete') {
      // Remember the tombstone so a stale copy arriving later cannot resurrect the record.
      await adapter.applyDelete(tx, op.key, deletedAtOf(op))
      await this.writeMeta(tx, op.entity, op.key, { hlc: op.hlc, device: op.device, deleted: true, hash: null, fieldHlc: null, fieldHash: null, lineage: remote.lineage ?? [] })
      touched.add(op.entity)
      this.emitRemote(op.entity, op.key, 'delete')
      return
    }
    await adapter.applyUpsert(tx, op.key, op.fields ?? {})
    await this.recordApplied(tx, adapter, op.entity, op.key, { hlc: op.hlc, device: op.device, fieldHlc: this.fieldClocksOf(op), lineage: remote.lineage ?? [] })
    touched.add(op.entity)
    this.emitRemote(op.entity, op.key, 'upsert')
  }

  /** The remote version was made on top of ours: it replaces ours. */
  private async applyForward(tx: DatabaseAdapter, adapter: EntityAdapter, op: SyncOp, local: VersionInfo, remote: VersionInfo, touched: Set<string>): Promise<void> {
    const lineage = unionLineage(local, { ...remote, hlc: op.hlc }, op.hlc)
    if (op.op === 'delete') {
      await adapter.applyDelete(tx, op.key, deletedAtOf(op))
      await this.writeMeta(tx, op.entity, op.key, { hlc: op.hlc, device: op.device, deleted: true, hash: null, fieldHlc: null, fieldHash: null, lineage })
      touched.add(op.entity)
      this.emitRemote(op.entity, op.key, 'delete')
      return
    }
    // An op from an older build may lack columns this build has: those keep their local values.
    await adapter.applyUpsert(tx, op.key, op.fields ?? {})
    const fieldHlc = { ...(local.fieldHlc ?? {}), ...this.fieldClocksOf(op) }
    await this.recordApplied(tx, adapter, op.entity, op.key, { hlc: op.hlc, device: op.device, fieldHlc, lineage })
    touched.add(op.entity)
    this.emitRemote(op.entity, op.key, 'upsert')
  }

  /** Made apart from ours: merge without losing either side (DATA-SAFE-002…). */
  private async applyConcurrent(tx: DatabaseAdapter, adapter: EntityAdapter, op: SyncOp, meta: MetaRow, local: VersionInfo, remote: VersionInfo, touched: Set<string>): Promise<void> {
    const cur = meta.deleted ? undefined : await adapter.read(tx, op.key)
    const localDeleted = !!meta.deleted || !!cur?.deleted
    // The outcome of merging two versions is a NEW version (DATA-SAFE-004): it contains both
    // sides, so it must not share an id with either — otherwise a later op built on only one side
    // would look like a descendant of the merge and fast-forward over the other side's changes.
    const winnerHlc = this.clock.tick()
    const winnerDevice = this.deviceId
    const lineage = trimLineage([...(local.lineage ?? []), local.hlc, ...(remote.lineage ?? []), remote.hlc], LINEAGE_KEEP)

    // ── both deleted ──
    // A deletion keeps a deterministic id — the deleting op's own version (the later one when both
    // sides deleted) — so every device labels the same tombstone the same way and a record re-created
    // after seeing it is recognised as such everywhere. Only merged LIVE states get a fresh id.
    const tomb = (h: string, dev: string) => ({ hlc: h, device: dev, deleted: true, hash: null, fieldHlc: null, fieldHash: null, lineage: lineage.filter((x) => x !== h) })
    if (localDeleted && op.op === 'delete') {
      const later = compareHlc(op.hlc, meta.hlc) > 0
      await this.writeMeta(tx, op.entity, op.key, later ? tomb(op.hlc, op.device) : tomb(meta.hlc, meta.device))
      return
    }
    // ── a note deleted (purged) on one side and changed on the other: Trash with the edit ──
    // One rule for every arrival order (convergence): a deletion made apart from a change wins,
    // and nothing is dropped — a note goes to the Trash holding the change; any other record is
    // deleted and the change's values are kept in sync_conflicts. (A record re-created AFTER its
    // deletion was seen descends from the tombstone and is simply applied — relate() 'descends'.)
    if (op.entity === 'note' && (localDeleted || op.op === 'delete')) {
      await this.resolveNoteDeleteConflict(tx, op, meta, touched, lineage)
      return
    }
    // ── an edit and a deletion made apart (other entities) ──
    if (op.op === 'delete') {
      if (cur) await this.logConflict(tx, { entity: op.entity, key: op.key, field: null, kind: 'edit-deleted', keptHlc: op.hlc, lostHlc: meta.hlc, lostDevice: meta.device, lostValue: cur.fields })
      await adapter.applyDelete(tx, op.key, deletedAtOf(op))
      await this.writeMeta(tx, op.entity, op.key, tomb(op.hlc, op.device))
      touched.add(op.entity)
      this.emitRemote(op.entity, op.key, 'delete')
      return
    }
    if (localDeleted || !cur) {
      if (!localDeleted && !cur) {
        // Bookkeeping says live but the row is gone (damaged or externally changed database):
        // the remote version is the only copy we have — restore it rather than lose it.
        await this.applyForward(tx, adapter, op, local, remote, touched)
        return
      }
      // A stale edit of a record deleted here: the deletion stands; the edit is kept as a conflict.
      await this.logConflict(tx, { entity: op.entity, key: op.key, field: null, kind: 'edit-deleted', keptHlc: meta.hlc, lostHlc: op.hlc, lostDevice: op.device, lostValue: op.fields ?? null })
      await this.writeMeta(tx, op.entity, op.key, tomb(meta.hlc, meta.device))
      return
    }
    // ── both edited: field by field ──
    const merged = mergeConcurrent({ ...local, fields: cur.fields }, { ...remote, fields: op.fields ?? {} }, { preferNonEmpty: op.entity === 'note' ? ['content', 'title'] : [] })
    if (merged.conflicts.length) await this.preserveConflicts(tx, op, meta, cur.fields, merged.conflicts, touched)
    if (merged.changed.length) {
      await adapter.applyUpsert(tx, op.key, merged.fields)
      touched.add(op.entity)
      this.emitRemote(op.entity, op.key, 'upsert')
    }
    await this.recordApplied(tx, adapter, op.entity, op.key, { hlc: winnerHlc, device: winnerDevice, fieldHlc: merged.fieldHlc, lineage })
  }

  /** Meta after an upsert was applied: hashes of what is actually stored now. */
  private async recordApplied(tx: DatabaseAdapter, adapter: EntityAdapter, entity: string, key: string, m: { hlc: string; device: string; fieldHlc: Record<string, string>; lineage: string[] }): Promise<void> {
    const applied = await adapter.read(tx, key)
    const live = applied && !applied.deleted
    await this.writeMeta(tx, entity, key, { hlc: m.hlc, device: m.device, deleted: !live && !!applied?.deleted, hash: live ? hashFields(applied!.fields) : null, fieldHlc: m.fieldHlc, fieldHash: live ? fieldHashes(applied!.fields) : null, lineage: m.lineage })
  }

  /**
   * Values the merge could not keep. A note's text or title → a conflict copy in the note's
   * Versions (deterministic id: every device creates the same single row); anything else → a
   * sync_conflicts row with the lost value. Nothing is dropped.
   */
  private async preserveConflicts(tx: DatabaseAdapter, op: SyncOp, meta: MetaRow, localFields: Record<string, unknown>, conflicts: ReturnType<typeof mergeConcurrent>['conflicts'], touched: Set<string>): Promise<void> {
    const noteText = op.entity === 'note' ? conflicts.filter((c) => c.field === 'content' || c.field === 'title') : []
    if (noteText.length) {
      // One copy per losing side, holding that side's text and title.
      for (const side of ['local', 'remote'] as const) {
        const lost = noteText.filter((c) => c.lostSide === side)
        if (!lost.length) continue
        const src = side === 'local' ? localFields : (op.fields ?? {})
        const clock = (lost.find((c) => c.field === 'content') ?? lost[0]).lostClock
        await this.writeConflictCopy(tx, op.key, { content: String(src.content ?? ''), title: (src.title as string | null) ?? null, hlc: clock }, touched)
      }
    }
    for (const c of conflicts) {
      const kept = op.entity === 'note' && (c.field === 'content' || c.field === 'title')
      await this.logConflict(tx, {
        entity: op.entity, key: op.key, field: c.field, kind: kept ? 'note-version' : 'field',
        keptHlc: c.keptClock, lostHlc: c.lostClock, lostDevice: c.lostSide === 'local' ? meta.device : op.device,
        lostValue: kept ? null : c.lostValue,
      })
    }
  }

  private async logConflict(tx: DatabaseAdapter, c: { entity: string; key: string; field: string | null; kind: string; keptHlc: string | null; lostHlc: string; lostDevice: string | null; lostValue: unknown }): Promise<void> {
    await tx.run(
      `INSERT OR IGNORE INTO sync_conflicts (id, entity, key, field, kind, kept_hlc, lost_hlc, lost_device, lost_value, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [`${c.entity}:${c.key}:${c.field ?? '*'}:${c.lostHlc}`, c.entity, c.key, c.field, c.kind, c.keptHlc, c.lostHlc, c.lostDevice, c.lostValue === null || c.lostValue === undefined ? null : JSON.stringify(c.lostValue), parseHlc(c.lostHlc).wallMs],
    )
    this.trace('merge:conflict', { entity: c.entity, id: shortId(c.key), field: c.field ?? '*', kind: c.kind })
  }

  /**
   * A note deleted (trashed or purged) on one device while it was changed on another, neither
   * having seen the other's change (DATA-SYNC-002). Neither intent is silently lost: the note
   * ends up in the TRASH (the deletion is honoured — it leaves the notes list) holding the LIVE
   * side's content (the edit is kept — Restore brings it back). If both sides changed the content,
   * the other content is kept as a conflict version as usual. Every device computes the same
   * record, the same deleted_at (the deleting side's) and the same record HLC (the greater), so
   * they converge whichever order the ops arrive in.
   */
  private async resolveNoteDeleteConflict(tx: DatabaseAdapter, op: SyncOp, meta: MetaRow, touched: Set<string>, lineage: string[]): Promise<void> {
    // One side purged the note, the other changed it without having seen the purge (DATA-SYNC-002,
    // DATA-SAFE-005). The same outcome in every arrival order: the note stays, IN THE TRASH, holding
    // the surviving side's content (restorable — nothing is lost), trashed at the later of the two
    // times. The resolving device publishes the outcome (publishResolutions) so every device ends
    // on one version even where the two sides' histories differ in detail.
    const adapter = this.entities.get('note')!
    const localPurged = !!meta.deleted
    const surviving = localPurged ? (op.op === 'upsert' ? { fields: op.fields ?? {}, v: versionOfOp(op) } : null) : (await adapter.read(tx, op.key)) ? { fields: (await adapter.read(tx, op.key))!.fields, v: versionOfMeta(meta) } : null
    const purgeHlc = localPurged ? meta.hlc : op.hlc
    const hlc = this.clock.tick()   // a merge outcome is a new version (see applyConcurrent)
    const device = this.deviceId
    if (!surviving) {
      await this.writeMeta(tx, op.entity, op.key, { hlc: purgeHlc, device: localPurged ? meta.device : op.device, deleted: true, hash: null, fieldHlc: null, fieldHash: null, lineage: lineage.filter((x) => x !== purgeHlc) })
      return
    }
    const trashedAt = Math.max(Number(surviving.fields.deleted_at) || 0, parseHlc(purgeHlc).wallMs)
    await adapter.applyUpsert(tx, op.key, { ...surviving.fields, deleted_at: trashedAt })
    this.emitRemote('note', op.key, 'upsert')
    const after = (await adapter.read(tx, op.key))!
    const clocks: Record<string, string> = {}
    for (const f of Object.keys(after.fields)) clocks[f] = surviving.v.fieldHlc?.[f] ?? surviving.v.hlc
    // The Trash time is this resolution's own write: its clock is the resolution's version (a value
    // and its clock must always travel together, or two devices can hold one clock with two values).
    clocks.deleted_at = hlc
    await this.writeMeta(tx, op.entity, op.key, { hlc, device, deleted: false, hash: hashFields(after.fields), fieldHlc: clocks, fieldHash: fieldHashes(after.fields), lineage })
    await this.logConflict(tx, { entity: 'note', key: op.key, field: null, kind: 'note-trashed', keptHlc: hlc, lostHlc: purgeHlc, lostDevice: localPurged ? meta.device : op.device, lostValue: null })
    this.resolutions.add(op.key)
    touched.add('note')
  }

  /**
   * Publish, as this device's own new version, every note a pull resolved from a purge-vs-change
   * conflict. The version descends from both sides, so every device fast-forwards to it; two
   * devices publishing their own resolutions merge field by field like any concurrent edit.
   */
  private async publishResolutions(): Promise<void> {
    if (!this.resolutions.size) return
    const keys = [...this.resolutions]
    this.resolutions.clear()
    for (const key of keys) {
      const adapter = this.entities.get('note')!
      const rec = await adapter.read(this.db, key)
      const meta = await this.db.get<MetaRow>(`SELECT ${META_COLS} FROM sync_record_meta WHERE entity = 'note' AND key = ?`, [key])
      if (!rec || rec.deleted || !meta || meta.deleted) continue
      const v = versionOfMeta(meta)
      const hlc = this.clock.tick()
      const lineage = childLineage(v)
      const op: Omit<SyncOp, 'seq' | 'device'> = { id: this.uuid(), hlc, entity: 'note', key, op: 'upsert', fields: rec.fields, base: meta.hlc, schema: this.opts.schema, fh: v.fieldHlc ?? undefined, lin: lineage.slice(-LINEAGE_SEND) }
      await this.db.transaction(async (tx) => {
        await tx.run('INSERT INTO sync_outbox (entity, key, op_json, created_at) VALUES (?, ?, ?, ?)', ['note', key, JSON.stringify(op), this.now()])
        await tx.run('UPDATE sync_record_meta SET hlc = ?, device = ?, lineage = ? WHERE entity = ? AND key = ?', [hlc, this.deviceId, JSON.stringify(lineage), 'note', key])
      })
    }
    await this.persistClock()
  }

  private async writeConflictCopy(tx: DatabaseAdapter, noteId: string, loser: { content: string; title: string | null; hlc: string }, touched: Set<string>): Promise<void> {
    await tx.run(
      `INSERT OR IGNORE INTO note_versions (id, note_id, title, content, kind, created_at) VALUES (?, ?, ?, ?, 'conflict', ?)`,
      [`conflict-${loser.hlc}`, noteId, loser.title, loser.content, parseHlc(loser.hlc).wallMs],
    )
    // Journal it (after the apply commits): with three or more devices, only the devices that saw
    // the two versions meet will create the copy, so it must travel like any other record.
    this.madeConflictCopies.add(`conflict-${loser.hlc}`)
    touched.add('note_version')
  }

  private emitRemote(entity: string, id: string, op: 'upsert' | 'delete'): void {
    try { this.events.emit('data:changed', { entity, id, op, remote: true }) } catch { /* listeners must not break sync */ }
  }

  // ── orchestration ─────────────────────────────────────────────────────────────────────────

  /** push then pull; serialised so overlapping timers/watch callbacks never interleave. */
  sync(): Promise<void> {
    if (this.syncing) return this.syncing
    this.syncing = (async () => {
      try {
        await this.push()
        await this.pull()
        await this.push()   // ops captured while pulling (e.g. conflict versions) go out at once
      } finally {
        this.syncing = null
      }
    })()
    return this.syncing
  }

  async status(): Promise<SyncStatusSnapshot> {
    const pending = (await this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM sync_outbox'))?.n ?? 0
    const conflicts = (await this.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM note_versions WHERE kind = 'conflict'").catch(() => undefined))?.n ?? 0
    const failedOps = (await this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM sync_failed').catch(() => undefined))?.n ?? 0
    const transport = await this.store.status()
    const devices: SyncStatusSnapshot['devices'] = []
    try {
      for (const d of await this.store.listDevices()) {
        const m = await this.store.readManifest(d).catch(() => null)
        if (!m) continue
        const applied = (await this.db.get<{ seq: number | null }>('SELECT MAX(seq) AS seq FROM sync_applied WHERE device = ?', [d]))?.seq ?? 0
        devices.push({ device: d, name: m.name, platform: m.platform, seq: m.seq, applied: d === this.deviceId ? m.seq : applied, lastSeenAt: m.updatedAt })
      }
    } catch { /* transport unavailable */ }
    const pendingUploads = transport.available ? await this.store.pendingUploads?.().catch(() => undefined) : undefined
    // Changes other devices published (their manifests) that this device has not applied yet.
    let behind = 0
    for (const d of devices) if (d.device !== this.deviceId) behind += Math.max(0, d.seq - d.applied)
    const mergeConflicts = (await this.db.get<{ n: number }>('SELECT COUNT(*) AS n FROM sync_conflicts WHERE resolved_at IS NULL').catch(() => undefined))?.n ?? 0
    const forks = parseJsonOr<unknown[]>((await this.db.get<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', [STATE.forks]))?.value, []).length
    const lastFullReconcile = numOrNull((await this.db.get<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', [STATE.lastFullReconcile]))?.value)
    const state: SyncState = this.hold || this.forkDetected ? 'held'
      : !transport.available ? 'unavailable'
      : (this.lastError || this.unreadable || failedOps) ? 'attention'
      : this.phase === 'reconciling' ? 'reconciling'
      : this.phase === 'uploading' || (pendingUploads ?? 0) > 0 ? 'uploading'
      : behind > 0 || this.remoteWaiting > 0 ? 'downloading'
      : pending > 0 ? (this.opts.online && !this.opts.online() ? 'offline' : 'pending')
      : 'synced'
    if (state !== this.lastState) { this.lastState = state; this.trace('state', { state, pending, behind, uploads: pendingUploads ?? null }) }
    return {
      enabled: true, deviceId: this.deviceId, transport, pendingOutbox: pending, state, conflicts, failedOps,
      lastApplied: this.lastApplied, schema: this.opts.schema, remoteBehind: behind, pendingUploads, lastNotifiedAt: this.lastNotifiedAt,
      lastPushAt: this.lastPushAt, lastPullAt: this.lastPullAt, lastError: this.lastError, devices, unreadable: this.unreadable,
      journal: { files: this.ownFiles.length, bytes: this.ownFiles.reduce((n, f) => n + (f.bytes ?? 0), 0) + (this.ownSnapshot?.bytes ?? 0), snapshotSeq: this.ownSnapshot?.seq ?? null },
      hold: this.hold ? { ...this.hold } : null, mergeConflicts, forks, lastFullReconcile,
    }
  }

  /** Test/diagnostic access to the record metadata. */
  async recordMeta(entity: string, key: string): Promise<MetaRow | undefined> {
    return this.db.get<MetaRow>('SELECT hlc, device, deleted FROM sync_record_meta WHERE entity = ? AND key = ?', [entity, key])
  }
}

/** Stable FNV-1a hash of a record's synced fields (key order independent) for change detection. */
export function hashFields(fields: Record<string, unknown>): string {
  const json = JSON.stringify(fields, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.keys(v as object).sort().reduce<Record<string, unknown>>((acc, key) => { acc[key] = (v as Record<string, unknown>)[key]; return acc }, {})
    : v))
  let h = 0x811c9dc5
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0') + json.length.toString(16)
}

function deletedAtOf(op: SyncOp): number {
  return Number((op.fields as { deleted_at?: unknown } | undefined)?.deleted_at) || parseHlc(op.hlc).wallMs
}

function numOrNull(v: string | undefined): number | null {
  if (v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function pickTimestamp(fields: Record<string, unknown>): number | undefined {
  for (const k of ['updated_at', 'archived_at', 'created_at']) {
    const v = fields[k]
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v
    if (typeof v === 'string' && /^\d{4}-/.test(v)) { const t = Date.parse(v); if (Number.isFinite(t)) return t }
  }
  return undefined
}
