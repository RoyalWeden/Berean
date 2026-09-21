import type { DatabaseAdapter } from '../db/DatabaseAdapter'
import { defaultUuid, type ServiceEvents, type ServiceLogger, type DataChange } from '../services/context'
import { HybridLogicalClock, compareHlc, formatHlc, parseHlc } from './hlc'
import { chunkForFiles, decodeJournal, parseJournalFileName, snapshotFileName, COMPACT_AFTER_BYTES, COMPACT_AFTER_OPS, COMPACT_SILENT_MS } from './journal'
import { createEntityRegistry, SYNCED_ENTITY_KINDS, type EntityAdapter, type EntityRecord } from './entities'
import type { DeviceManifest, JournalFileInfo, SnapshotFile, SnapshotRecord, SyncOp, SyncStatusSnapshot, SyncStore } from './types'
import { SYNC_FORMAT_VERSION } from './types'

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
}

interface OutboxRow { seq: number; entity: string; key: string; op_json: string }
interface MetaRow { hlc: string; device: string; deleted: number; hash?: string | null }

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
} as const

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
  private unsubscribe: (() => void) | null = null
  private syncing: Promise<void> | null = null

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
    return engine
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
        await this.recaptureAll(c.entity, hlc)
      } else {
        await this.captureRecord(c.entity, direct.id, { hlc, rec: await direct.rec, direct: true })
      }
      if (c.op !== 'upsert' || !c.id) {
        // A delete or bulk change can take other rows with it without their own events (a purged
        // note's versions, a deleted tag's members, a deleted trail session's nodes and
        // connections, a deleted folder's notes moved to the root): find what vanished or changed.
        await this.captureVanished(c.entity, hlc)
        for (const dep of adapter.dependents ?? []) await this.recaptureAll(dep, hlc)
      }
    }
    this.captureQueue = this.captureQueue.then(run, run).catch((err) => this.opts.log.error('[sync] capture failed', err))
    return this.captureQueue
  }

  /** Re-read every live record of an entity (only records whose synced fields changed produce ops)
   *  and tombstone the ones that are gone. */
  private async recaptureAll(entity: string, hlc: string): Promise<void> {
    const adapter = this.entities.get(entity)
    if (!adapter) return
    for (const key of await adapter.listKeys(this.db)) await this.captureRecord(entity, key, { hlc })
    await this.captureVanished(entity, hlc)
  }

  /** Records we told other devices about that no longer exist locally (hard-deleted) → delete ops. */
  private async captureVanished(entity: string, hlc: string): Promise<void> {
    const adapter = this.entities.get(entity)
    if (!adapter) return
    const known = await this.db.all<{ key: string }>('SELECT key FROM sync_record_meta WHERE entity = ? AND deleted = 0', [entity])
    if (known.length === 0) return
    const live = new Set(await adapter.listKeys(this.db))
    for (const r of known) if (!live.has(r.key)) await this.captureRecord(entity, r.key, { hlc })
  }

  /**
   * Read the record's current state and queue an op for it (coalescing with a pending unflushed
   * op for the same record). Also advances the record's meta to this change's HLC so a remote op
   * arriving later can tell whether it diverged from what we had.
   */
  async captureRecord(entity: string, key: string, at?: { hlc: string; rec?: EntityRecord | undefined; direct?: boolean }): Promise<void> {
    const adapter = this.entities.get(entity)
    if (!adapter) return
    const rec = at && 'rec' in at ? at.rec : await adapter.read(this.db, key)
    const meta = await this.db.get<MetaRow>('SELECT hlc, device, deleted, hash FROM sync_record_meta WHERE entity = ? AND key = ?', [entity, key])
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
        await this.db.transaction(async (tx) => {
          await tx.run('UPDATE sync_outbox SET op_json = ? WHERE seq = ?', [JSON.stringify({ ...prev, hlc }), pending.seq])
          await tx.run('UPDATE sync_record_meta SET hlc = ? WHERE entity = ? AND key = ?', [hlc, entity, key])
          await tx.run('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)', [STATE.hlc, this.clock.latest()])
        })
      }
      return
    }
    // Coalescing keeps the EARLIEST base so the other side still sees the true divergence point.
    const base = pending ? (JSON.parse(pending.op_json) as Partial<SyncOp>).base : meta?.hlc
    // Tombstone rows (sessions/tabs) carry their deleted_at so the receiver records the same time.
    const fields = op === 'upsert' ? rec!.fields : (rec?.deleted ? rec.fields : undefined)
    const syncOp: Omit<SyncOp, 'seq' | 'device'> = {
      id: this.uuid(), hlc, entity, key, op,
      ...(fields ? { fields } : {}),
      ...(base ? { base } : {}),
      schema: this.opts.schema,
    }
    await this.db.transaction(async (tx) => {
      if (pending) {
        await tx.run('UPDATE sync_outbox SET op_json = ?, created_at = ? WHERE seq = ?', [JSON.stringify(syncOp), this.now(), pending.seq])
      } else {
        await tx.run('INSERT INTO sync_outbox (entity, key, op_json, created_at) VALUES (?, ?, ?, ?)', [entity, key, JSON.stringify(syncOp), this.now()])
      }
      await tx.run('INSERT OR REPLACE INTO sync_record_meta (entity, key, hlc, device, deleted, hash) VALUES (?, ?, ?, ?, ?, ?)', [entity, key, hlc, this.deviceId, op === 'delete' ? 1 : 0, hash])
      await tx.run('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)', [STATE.hlc, this.clock.latest()])
    })
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
        const syncOp: Omit<SyncOp, 'seq' | 'device'> = { id: this.uuid(), hlc, entity: adapter.kind, key, op: 'upsert', fields: rec.fields, schema: this.opts.schema }
        await this.db.transaction(async (tx) => {
          await tx.run('INSERT INTO sync_outbox (entity, key, op_json, created_at) VALUES (?, ?, ?, ?)', [adapter.kind, key, JSON.stringify(syncOp), this.now()])
          await tx.run('INSERT OR REPLACE INTO sync_record_meta (entity, key, hlc, device, deleted, hash) VALUES (?, ?, ?, ?, 0, ?)', [adapter.kind, key, hlc, this.deviceId, hashFields(rec.fields)])
        })
        count++
      }
    }
    await this.setState(STATE.adopted, '1')
    await this.persistClock()
    return count
  }

  // ── push ──────────────────────────────────────────────────────────────────────────────────

  async push(): Promise<number> {
    await this.captureQueue
    const rows = await this.db.all<OutboxRow>('SELECT seq, entity, key, op_json FROM sync_outbox ORDER BY seq ASC')
    if (rows.length === 0) {
      // Nothing new — but journal files waiting on other devices' acknowledgement may be prunable now.
      try { await this.pruneCompacted() } catch (err) { this.opts.log.warn('[sync] prune failed', err) }
      return 0
    }
    const status = await this.store.status()
    if (!status.available) { this.lastError = status.reason ?? 'transport unavailable'; return 0 }
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
      try { await this.compact() } catch (err) { this.opts.log.warn('[sync] compaction failed', err) }
      return ops.length
    } catch (err) {
      this.lastError = `push: ${err instanceof Error ? err.message : String(err)}`
      this.opts.log.error('[sync] push failed', err)
      return 0
    }
  }

  private async writeManifest(): Promise<void> {
    const applied: Record<string, number> = {}
    for (const r of await this.db.all<{ device: string; seq: number }>('SELECT device, MAX(seq) AS seq FROM sync_applied GROUP BY device')) applied[r.device] = r.seq
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
    const metas = await this.db.all<{ entity: string; key: string; hlc: string; deleted: number }>('SELECT entity, key, hlc, deleted FROM sync_record_meta WHERE device = ? ORDER BY entity, key', [this.deviceId])
    for (const m of metas) {
      if (m.deleted) { records.push({ entity: m.entity, key: m.key, hlc: m.hlc, op: 'delete' }); continue }
      const adapter = this.entities.get(m.entity)
      if (!adapter) continue
      const rec = await adapter.read(this.db, m.key)
      if (!rec) continue
      records.push(rec.deleted ? { entity: m.entity, key: m.key, hlc: m.hlc, op: 'delete', fields: rec.fields } : { entity: m.entity, key: m.key, hlc: m.hlc, op: 'upsert', fields: rec.fields })
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
      const op: SyncOp = { id: `${device}-snapshot-${snap.seq}-${r.entity}-${r.key}`, seq: snap.seq, hlc: r.hlc, device, entity: r.entity, key: r.key, op: r.op, ...(r.fields ? { fields: r.fields } : {}), schema: file.schema }
      try { await this.applyOne(op, touched, { recordApplied: false }); applied++ } catch (err) {
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
    const status = await this.store.status()
    if (!status.available) { this.lastError = status.reason ?? 'transport unavailable'; return 0 }
    const maxAttempts = this.opts.maxAttempts ?? 5
    let pending: SyncOp[] = []
    this.unreadable = 0
    const newer: string[] = []
    const touchedBySnapshot = new Set<string>()
    let snapshotApplied = 0
    for (const device of await this.store.listDevices()) {
      if (device === this.deviceId) continue
      let manifest: DeviceManifest | null
      try { manifest = await this.store.readManifest(device) } catch { continue }
      if (!manifest) continue
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
        if (text === null) break   // not downloaded yet — stop at the gap, never skip
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
        await this.applyOne(op, touched)
        applied++
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        this.opts.log.error(`[sync] apply failed ${op.entity}/${op.key} from ${op.device}#${op.seq}: ${msg}`)
        await this.db.run('INSERT INTO sync_failed (device, seq, error, attempts) VALUES (?, ?, ?, 1) ON CONFLICT(device, seq) DO UPDATE SET error = excluded.error, attempts = attempts + 1', [op.device, op.seq, msg])
      }
    }
    this.lastPullAt = this.now()
    await this.setState(STATE.lastPullAt, String(this.lastPullAt))
    await this.persistClock()
    if (applied > 0) {
      try { await this.writeManifest() } catch (err) { this.opts.log.warn('[sync] manifest update after pull failed', err) }
      this.opts.onApplied?.(touched)
    }
    if (!newer.length && this.lastError?.startsWith('Update Berean')) this.lastError = null
    return applied
  }

  /** Apply one remote op under the merge rules. Runs in its own transaction. */
  private async applyOne(op: SyncOp, touched: Set<string>, o: { recordApplied?: boolean } = {}): Promise<void> {
    const adapter = this.entities.get(op.entity)
    const recordApplied = o.recordApplied !== false
    this.clock.receive(op.hlc)
    await this.db.transaction(async (tx) => {
      if (!adapter) {
        // Unknown entity (a newer build's data) — remember we saw it so it is not retried forever.
        if (recordApplied) await tx.run('INSERT OR IGNORE INTO sync_applied (device, seq) VALUES (?, ?)', [op.device, op.seq])
        return
      }
      const meta = await tx.get<MetaRow>('SELECT hlc, device, deleted FROM sync_record_meta WHERE entity = ? AND key = ?', [op.entity, op.key])
      const newer = !meta || compareHlc(op.hlc, meta.hlc) > 0
      if (op.op === 'delete') {
        if (newer) {
          const deletedAt = Number((op.fields as { deleted_at?: unknown } | undefined)?.deleted_at) || parseHlc(op.hlc).wallMs
          await adapter.applyDelete(tx, op.key, deletedAt)
          await tx.run('INSERT OR REPLACE INTO sync_record_meta (entity, key, hlc, device, deleted, hash) VALUES (?, ?, ?, ?, 1, NULL)', [op.entity, op.key, op.hlc, op.device])
          touched.add(op.entity)
          this.emitRemote(op.entity, op.key, 'delete')
        }
      } else {
        const fields = op.fields ?? {}
        if (op.entity === 'note' && meta && !meta.deleted && op.base !== meta.hlc) {
          // Diverged: both sides changed the note since `op.base`. Keep the higher HLC as current
          // and preserve the other content as a conflict version (deterministic id → both devices
          // create exactly one identical row).
          const local = await tx.get<{ content: string; title: string | null }>('SELECT content, title FROM notes WHERE id = ?', [op.key])
          const remoteContent = typeof fields.content === 'string' ? fields.content : ''
          if (local && local.content !== remoteContent) {
            const loser = newer ? { content: local.content, title: local.title, hlc: meta.hlc, device: meta.device } : { content: remoteContent, title: (fields.title as string | null) ?? null, hlc: op.hlc, device: op.device }
            await tx.run(
              `INSERT OR IGNORE INTO note_versions (id, note_id, title, content, kind, created_at) VALUES (?, ?, ?, ?, 'conflict', ?)`,
              [`conflict-${loser.hlc}`, op.key, loser.title, loser.content, parseHlc(loser.hlc).wallMs],
            )
            touched.add('note_version')
          }
        }
        if (newer) {
          await adapter.applyUpsert(tx, op.key, fields)
          const applied = await adapter.read(tx, op.key)
          await tx.run('INSERT OR REPLACE INTO sync_record_meta (entity, key, hlc, device, deleted, hash) VALUES (?, ?, ?, ?, 0, ?)', [op.entity, op.key, op.hlc, op.device, applied && !applied.deleted ? hashFields(applied.fields) : null])
          touched.add(op.entity)
          this.emitRemote(op.entity, op.key, 'upsert')
        }
      }
      if (recordApplied) {
        await tx.run('INSERT OR IGNORE INTO sync_applied (device, seq) VALUES (?, ?)', [op.device, op.seq])
        await tx.run('DELETE FROM sync_failed WHERE device = ? AND seq = ?', [op.device, op.seq])
      }
    })
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
    const devices: SyncStatusSnapshot['devices'] = []
    try {
      for (const d of await this.store.listDevices()) {
        const m = await this.store.readManifest(d).catch(() => null)
        if (!m) continue
        const applied = (await this.db.get<{ seq: number | null }>('SELECT MAX(seq) AS seq FROM sync_applied WHERE device = ?', [d]))?.seq ?? 0
        devices.push({ device: d, name: m.name, platform: m.platform, seq: m.seq, applied: d === this.deviceId ? m.seq : applied, lastSeenAt: m.updatedAt })
      }
    } catch { /* transport unavailable */ }
    return {
      enabled: true, deviceId: this.deviceId, transport: await this.store.status(), pendingOutbox: pending,
      lastPushAt: this.lastPushAt, lastPullAt: this.lastPullAt, lastError: this.lastError, devices, unreadable: this.unreadable,
      journal: { files: this.ownFiles.length, bytes: this.ownFiles.reduce((n, f) => n + (f.bytes ?? 0), 0) + (this.ownSnapshot?.bytes ?? 0), snapshotSeq: this.ownSnapshot?.seq ?? null },
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
