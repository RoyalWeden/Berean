import { compareHlc } from './hlc'

/**
 * The merge model (DATA-SAFE-001…, docs/mobile/sync.md "Merge model"). Pure: no database, no
 * clock, so every rule is unit-tested and every device computes the same result.
 *
 * Every record version is named by its HLC. For each record a device keeps:
 *   hlc        the current version
 *   lineage    versions the current one descends from (what this device has already incorporated)
 *   fieldHlc   per field: the version that last changed it
 * and every op carries the same three things for the version it publishes.
 *
 * Applying a remote version R to the local version L:
 *   1. L already contains R (R is L or one of its ancestors)   → nothing to do (replays, duplicate
 *      delivery, snapshots overlapping journals, a third device relaying an old version)
 *   2. R descends from L                                        → R replaces L (fast-forward)
 *   3. otherwise they are CONCURRENT (made apart). Per field:
 *        equal values                          → keep
 *        R's value is a version L contains     → keep L's (L changed it later)
 *        L's value is a version R contains     → take R's (R changed it later)
 *        both changed it                       → the higher field clock wins, deterministically;
 *                                                the other value is a CONFLICT (kept, never dropped)
 *      so a note pinned on one device and edited on another keeps both changes, and only a field
 *      both devices changed can conflict.
 *
 * Versions recorded before per-field clocks existed (legacy) have no lineage: containment falls
 * back to equality and field clocks to the record clock, i.e. the pre-v47 whole-record rules.
 */

export type Hlc = string

export interface VersionInfo {
  hlc: Hlc
  /** Ancestors; null = unknown (recorded before lineage existed). */
  lineage: Hlc[] | null
  /** Per-field clocks; missing fields fall back to `hlc`. */
  fieldHlc: Record<string, Hlc> | null
}

/** Lineage kept per record (local) and carried per op (smaller: ops are journaled). */
export const LINEAGE_KEEP = 64
export const LINEAGE_SEND = 24

export function contains(v: VersionInfo, h: Hlc | undefined | null): boolean {
  if (!h) return false
  return v.hlc === h || (v.lineage ?? []).includes(h)
}

/** The ancestors of a new version made on top of `prev` (prev itself included), newest kept. */
export function childLineage(prev: VersionInfo | null, extra: Hlc[] = []): Hlc[] {
  if (!prev) return trimLineage(extra, LINEAGE_KEEP)
  return trimLineage([...(prev.lineage ?? []), prev.hlc, ...extra], LINEAGE_KEEP)
}

/** Deduplicate and keep the `max` newest (by HLC order). */
export function trimLineage(list: Hlc[], max: number): Hlc[] {
  const uniq = [...new Set(list.filter(Boolean))]
  uniq.sort(compareHlc)
  return uniq.slice(Math.max(0, uniq.length - max))
}

export function fieldClock(v: VersionInfo, field: string): Hlc {
  return v.fieldHlc?.[field] ?? v.hlc
}

export type Relation = 'known' | 'descends' | 'concurrent'

/** How a remote version relates to the local one. */
export function relate(local: VersionInfo, remote: VersionInfo): Relation {
  if (contains(local, remote.hlc)) return 'known'
  if (contains(remote, local.hlc)) return 'descends'
  // Anything else — including an older op from a build without lineage — is treated as made apart
  // and merged field by field: at worst a replayed old op yields a redundant conflict row, never
  // a silently dropped edit.
  return 'concurrent'
}

/** Fields whose conflicts are bookkeeping, not user data (never reported as conflicts). */
export function isBookkeepingField(f: string): boolean {
  return /(^|_)(updated|created|modified|imported)_at$/.test(f) || f === 'order_key' || f === 'hash'
}

export interface FieldConflict { field: string; keptClock: Hlc; lostClock: Hlc; lostValue: unknown; lostSide: 'local' | 'remote' }

export interface MergeResult {
  fields: Record<string, unknown>
  fieldHlc: Record<string, Hlc>
  hlc: Hlc
  lineage: Hlc[]
  /** Fields whose value changed relative to local. */
  changed: string[]
  conflicts: FieldConflict[]
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b)
const blank = (v: unknown) => v == null || (typeof v === 'string' && v.trim() === '')

/**
 * Merge two concurrent versions field by field. `preferNonEmpty` lists fields where an empty value
 * never beats a non-empty one (a note created empty on a fresh install must not blank the cloud's
 * text for the same deterministic id, e.g. today's daily note).
 */
export function mergeConcurrent(
  local: VersionInfo & { fields: Record<string, unknown> },
  remote: VersionInfo & { fields: Record<string, unknown> },
  o: { preferNonEmpty?: readonly string[] } = {},
): MergeResult {
  const fields: Record<string, unknown> = { ...local.fields }
  const fieldHlc: Record<string, Hlc> = {}
  const changed: string[] = []
  const conflicts: FieldConflict[] = []
  const keys = new Set([...Object.keys(local.fields), ...Object.keys(remote.fields)])
  for (const f of keys) {
    const lc = fieldClock(local, f)
    const hasRemote = f in remote.fields
    if (!hasRemote) { fieldHlc[f] = lc; continue }
    const rc = fieldClock(remote, f)
    const lv = local.fields[f], rv = remote.fields[f]
    const newerClock = compareHlc(rc, lc) > 0 ? rc : lc
    let takeRemote: boolean
    let conflict = false
    if (!(f in local.fields)) takeRemote = true
    else if (same(lv, rv)) { fieldHlc[f] = newerClock; continue }
    else if (contains(local, rc)) takeRemote = false
    else if (contains(remote, lc)) takeRemote = true
    else if (o.preferNonEmpty?.includes(f) && blank(lv) !== blank(rv)) takeRemote = blank(lv)
    else { takeRemote = compareHlc(rc, lc) > 0; conflict = true }
    if (takeRemote) { fields[f] = rv; fieldHlc[f] = rc; changed.push(f) } else fieldHlc[f] = lc
    if (conflict && !isBookkeepingField(f)) {
      conflicts.push(takeRemote
        ? { field: f, keptClock: rc, lostClock: lc, lostValue: lv, lostSide: 'local' }
        : { field: f, keptClock: lc, lostClock: rc, lostValue: rv, lostSide: 'remote' })
    }
  }
  const hlc = compareHlc(remote.hlc, local.hlc) > 0 ? remote.hlc : local.hlc
  const lower = hlc === remote.hlc ? local.hlc : remote.hlc
  const lineage = trimLineage([...(local.lineage ?? []), ...(remote.lineage ?? []), lower].filter((h) => h !== hlc), LINEAGE_KEEP)
  return { fields, fieldHlc, hlc, lineage, changed, conflicts }
}

/**
 * An edit and a deletion made apart (the delete never saw the edit, or the edit never saw the
 * delete). Who survives:
 *   - a CREATION the deleting device never saw (no ancestry in common — a deterministic id such as
 *     today's daily note or a highlight's range, made fresh) survives: it is new data, not an edit
 *     of what was deleted;
 *   - an EDIT of the deleted record loses to the deletion (a stale device cannot resurrect it) — the
 *     edit's values are kept as a conflict row; notes have their own rule (Trash with the edit).
 */
export function editSurvivesDelete(edit: VersionInfo, del: VersionInfo): boolean {
  if (edit.lineage === null || del.lineage === null) return compareHlc(edit.hlc, del.hlc) > 0   // pre-v47 rule
  const delKnows = new Set([del.hlc, ...del.lineage])
  const shared = edit.lineage.some((h) => delKnows.has(h))
  return edit.lineage.length === 0 || !shared
}

/** Per-field hashes of a record, to see which fields a local write changed. */
export function fieldHashes(fields: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(fields)) out[k] = shortHash(JSON.stringify(v ?? null))
  return out
}

function shortHash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0') + s.length.toString(36)
}

export function parseJsonOr<T>(s: string | null | undefined, fallback: T): T {
  if (s == null) return fallback
  try { return JSON.parse(s) as T } catch { return fallback }
}
