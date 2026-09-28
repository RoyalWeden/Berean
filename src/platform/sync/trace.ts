import type { SyncTraceEntry } from './types'

/**
 * The sync diagnostic log (DATA-SYNC-006): a small ring buffer of lifecycle events — capture,
 * push, container notification, pull, apply, UI invalidation, state changes, errors — carrying
 * METADATA ONLY (entity kind, a short id prefix, counts, reasons). Never titles, never content,
 * never field values, so it is safe to enable on a user's device. Off by default; Settings →
 * iCloud → Diagnostic log turns it on and shows / copies the entries; when on, each entry is also
 * written to the console (Xcode's console for the iPhone app, the main-process log on the Mac).
 */
const MAX = 300

export interface SyncTrace {
  enabled(): boolean
  setEnabled(on: boolean): void
  record(event: string, meta?: SyncTraceEntry['meta']): void
  entries(): SyncTraceEntry[]
  clear(): void
}

export function createSyncTrace(opts: { now?: () => number; log?: (line: string) => void; enabled?: boolean } = {}): SyncTrace {
  let on = !!opts.enabled
  let buf: SyncTraceEntry[] = []
  const now = opts.now ?? (() => Date.now())
  return {
    enabled: () => on,
    setEnabled: (v) => { on = v },
    record(event, meta) {
      if (!on) return
      const e: SyncTraceEntry = { t: now(), event, ...(meta ? { meta } : {}) }
      buf.push(e)
      if (buf.length > MAX) buf = buf.slice(-MAX)
      opts.log?.(`[sync-trace] ${event}${meta ? ' ' + JSON.stringify(meta) : ''}`)
    },
    entries: () => buf.slice(),
    clear: () => { buf = [] },
  }
}

/** A record id shortened for the log (ids are UUIDs — not content — but short is enough). */
export const shortId = (id: string | null | undefined): string => (id ? String(id).slice(0, 8) : '')
