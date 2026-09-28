import type { SyncEngine } from './engine'
import type { SyncStatusSnapshot, SyncStore } from './types'
import type { SyncTrace } from './trace'

/**
 * The sync lifecycle shared by the iPhone host (src/platform/ios/syncHost.ts) and the Mac host
 * (electron/sync/host.ts) — DATA-SYNC-007. Event-driven in both directions:
 *
 *   local change captured  → engine.onLocalChange → sync after LOCAL_DEBOUNCE (coalesces typing)
 *   container changed      → store.watch          → sync (the plugin has already requested the
 *                                                    downloads; their completion is the next event)
 *   app foreground / wake / network back           → sync
 *   app background / quit                          → push
 *   FALLBACK_INTERVAL (60 s)                        → sync — a safety net, not the mechanism
 *
 * Syncs never overlap and are never lost: a request that arrives while a sync runs marks it dirty
 * and one more pass runs right after (a file can land between our listing and the end of a pass).
 * After every pass the status is published; after a pass that applied remote changes the engine's
 * `onApplied` has already told the UI which entities changed (the database is the source of
 * truth; the event only invalidates what the UI shows).
 */
export const LOCAL_DEBOUNCE_MS = 1500
export const FALLBACK_INTERVAL_MS = 60_000

export interface SyncHostCore {
  requestSync(reason: string, delayMs?: number): void
  /** Push only (backgrounding / quit). */
  pushNow(reason: string): Promise<void>
  /** Resolves when no sync is running or scheduled (tests, shutdown). */
  idle(): Promise<void>
  stop(): void
  lastStatus(): SyncStatusSnapshot | null
}

export function createSyncHostCore(o: {
  engine: SyncEngine
  store: SyncStore
  trace?: SyncTrace
  onStatus?: (s: SyncStatusSnapshot | null) => void
  log?: { error: (m: string, ...r: unknown[]) => void }
  localDebounceMs?: number
  fallbackIntervalMs?: number | null
  /** Start the watch (default true). */
  watch?: boolean
  /** The engine found this database writing as a device whose history is ahead of it (a copy /
   *  restored backup): the host must reopen the engine, which forks the device id. */
  onForkDetected?: () => void
}): SyncHostCore {
  let running: Promise<void> | null = null
  let dirty = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let interval: ReturnType<typeof setInterval> | null = null
  let stopped = false
  let status: SyncStatusSnapshot | null = null
  const debounce = o.localDebounceMs ?? LOCAL_DEBOUNCE_MS

  const publish = async () => {
    try { status = await o.engine.status() } catch { /* transport gone */ }
    o.onStatus?.(status)
  }

  const run = (reason: string): Promise<void> => {
    if (stopped) return Promise.resolve()
    if (running) { dirty = true; return running }
    o.trace?.record('sync:run', { reason })
    running = (async () => {
      try {
        do {
          dirty = false
          try { await o.engine.sync() } catch (err) { o.log?.error(`[sync] sync (${reason}) failed`, err) }
          await publish()
          if (o.engine.forkDetected) { stopped = true; o.onForkDetected?.(); break }
        } while (dirty && !stopped)
      } finally {
        running = null
      }
    })()
    return running
  }

  const requestSync = (reason: string, delayMs = 0) => {
    if (stopped) return
    if (delayMs <= 0) { void run(reason); return }
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = null; void run(reason) }, delayMs)
  }

  // Outbound: every captured local change wakes a (debounced) sync.
  o.engine.setLocalChangeListener(() => requestSync('local-change', debounce))
  // Inbound: container notifications.
  const unwatch = o.watch === false ? null : o.store.watch?.((info) => { o.engine.noteNotified(info?.paths); requestSync('remote-notified') }) ?? null
  if (o.fallbackIntervalMs !== null) interval = setInterval(() => requestSync('interval'), o.fallbackIntervalMs ?? FALLBACK_INTERVAL_MS)

  return {
    requestSync,
    async pushNow(reason) {
      o.trace?.record('sync:push-now', { reason })
      try { await o.engine.push() } catch { /* the outbox keeps it */ }
      await publish()
    },
    async idle() {
      while (running || timer) {
        if (running) await running
        else await new Promise((r) => setTimeout(r, Math.min(debounce, 50)))
      }
    },
    stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      if (interval) clearInterval(interval)
      o.engine.setLocalChangeListener(null)
      unwatch?.()
    },
    lastStatus: () => status,
  }
}
