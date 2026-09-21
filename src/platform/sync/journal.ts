import type { SyncOp, JournalFileInfo } from './types'

/**
 * Journal file encoding (docs/mobile/icloud.md §3): one JSON object per line. A file holds a
 * contiguous seq range of ONE device. Names sort lexically in seq order.
 *
 * Decoding is line-tolerant: a truncated trailing line (interrupted upload) or an unparsable line
 * is reported, never thrown, so one bad byte can never stop a device from syncing everything else.
 */
export const JOURNAL_MAX_OPS = 500
export const JOURNAL_MAX_BYTES = 256 * 1024

export function journalFileName(seqFrom: number, seqTo: number): string {
  return `journal-${String(seqFrom).padStart(9, '0')}-${String(seqTo).padStart(9, '0')}.jsonl`
}

export function parseJournalFileName(name: string): JournalFileInfo | null {
  const m = /^journal-(\d{9})-(\d{9})\.jsonl$/.exec(name)
  if (!m) return null
  return { name, seqFrom: Number(m[1]), seqTo: Number(m[2]) }
}

export function encodeJournal(ops: SyncOp[]): string {
  return ops.map((op) => JSON.stringify(op)).join('\n') + '\n'
}

export interface DecodedJournal {
  ops: SyncOp[]
  /** Lines that could not be parsed or failed validation (counted, skipped). */
  unreadable: number
  /** True when the last line had no trailing newline (a partial write in progress). */
  truncated: boolean
}

export function decodeJournal(text: string): DecodedJournal {
  const ops: SyncOp[] = []
  let unreadable = 0
  const truncated = text.length > 0 && !text.endsWith('\n')
  const lines = text.split('\n')
  const last = lines.length - 1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') continue
    if (i === last && truncated) continue   // partial trailing line: retried on the next pass
    try {
      const op = JSON.parse(line) as unknown
      if (isValidOp(op)) ops.push(op)
      else unreadable++
    } catch {
      unreadable++
    }
  }
  return { ops, unreadable, truncated }
}

export function isValidOp(x: unknown): x is SyncOp {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  if (typeof o.id !== 'string' || typeof o.seq !== 'number' || !Number.isInteger(o.seq) || o.seq < 1) return false
  if (typeof o.hlc !== 'string' || !/^\d{13}-[0-9a-f]{4}-[^-\s]+$/.test(o.hlc)) return false
  if (typeof o.device !== 'string' || !o.device || typeof o.entity !== 'string' || !o.entity) return false
  if (typeof o.key !== 'string' || !o.key) return false
  if (o.op !== 'upsert' && o.op !== 'delete') return false
  if (o.op === 'upsert' && (!o.fields || typeof o.fields !== 'object' || Array.isArray(o.fields))) return false
  if (o.base !== undefined && typeof o.base !== 'string') return false
  if (typeof o.schema !== 'number') return false
  return true
}

/** Split a flat list of ops (already in seq order) into files respecting the size caps. */
export function chunkForFiles(ops: SyncOp[]): Array<{ info: JournalFileInfo; content: string }> {
  const out: Array<{ info: JournalFileInfo; content: string }> = []
  let batch: SyncOp[] = []
  let bytes = 0
  const flush = () => {
    if (batch.length === 0) return
    const content = encodeJournal(batch)
    out.push({ info: { name: journalFileName(batch[0].seq, batch[batch.length - 1].seq), seqFrom: batch[0].seq, seqTo: batch[batch.length - 1].seq }, content })
    batch = []
    bytes = 0
  }
  for (const op of ops) {
    const line = JSON.stringify(op).length + 1
    if (batch.length > 0 && (batch.length >= JOURNAL_MAX_OPS || bytes + line > JOURNAL_MAX_BYTES)) flush()
    batch.push(op)
    bytes += line
  }
  flush()
  return out
}
