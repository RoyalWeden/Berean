import type { DatabaseAdapter } from '../db/DatabaseAdapter'

/**
 * Everything a shared service needs from its host. Desktop builds one of these in
 * electron/services.ts (better-sqlite3 adapters, file paths under resources/); iOS builds one in
 * src/platform/ios/services.ts (BereanSQLite adapters, bundle paths). Services never import
 * Node, Electron or Capacitor — they only see this context.
 */
export interface ServiceContext {
  /** The user database (berean.db). Open and migrated before any service is used. */
  readonly userDb: DatabaseAdapter
  /** A bundled scripture text (`kjva`, `lxx`, `enoch`, …) opened read-only, or null if the file is missing. */
  textDb(textId: string): Promise<DatabaseAdapter | null>
  /** Strong's lexicon for Hebrew (`H`) or Greek (`G`). */
  lexiconDb(lang: 'H' | 'G'): Promise<DatabaseAdapter>
  /** Bundled auxiliary databases; null when not shipped. `hermas_taylor` is Charles Taylor's
   *  Shepherd-of-Hermas cross-reference footnotes, keyed to the Taylor translation's own
   *  versification (see crossrefsService.ts's getHermasTaylorChapter). */
  dataDb(name: 'cross_references' | 'tske_refs' | 'hermas_taylor'): Promise<DatabaseAdapter | null>
  /** Change notifications — the host fans these out (cross-window broadcast, sync journal, UI refresh). */
  readonly events: ServiceEvents
  now(): number
  uuid(): string
  readonly isDev: boolean
  /** Host-specific log sink (electron-log on desktop, console on iOS). */
  readonly log: ServiceLogger
}

export interface ServiceLogger {
  info(msg: string, ...rest: unknown[]): void
  warn(msg: string, ...rest: unknown[]): void
  error(msg: string, ...rest: unknown[]): void
}

/**
 * Data-change events. `entity` names the synced entity kind (see docs/mobile/icloud.md §5); `op`
 * is what happened. The cross-window `notes:changed` / `studyTrail:dataChanged` broadcasts on
 * desktop are derived from these by electron/services.ts, so the services themselves stay free
 * of BrowserWindow.
 */
export type ChangeOp = 'upsert' | 'delete' | 'bulk'

export interface DataChange {
  entity: string
  id?: string
  op: ChangeOp
  /** Free-form host hint (e.g. the trail session id for studyTrail:dataChanged). */
  scope?: string
  /** True when the change came from applying a remote sync op (so hosts don't re-journal it). */
  remote?: boolean
}

export type ServiceEventMap = {
  'data:changed': DataChange
}

export interface ServiceEvents {
  emit<K extends keyof ServiceEventMap>(event: K, payload: ServiceEventMap[K]): void
  on<K extends keyof ServiceEventMap>(event: K, cb: (payload: ServiceEventMap[K]) => void): () => void
}

/** Minimal typed emitter with no Node dependency. */
export function createServiceEvents(): ServiceEvents {
  const listeners = new Map<string, Set<(p: unknown) => void>>()
  return {
    emit(event, payload) {
      const set = listeners.get(event)
      if (!set) return
      for (const cb of [...set]) {
        try { cb(payload) } catch (err) { console.error(`[services] listener for ${event} threw`, err) }
      }
    },
    on(event, cb) {
      let set = listeners.get(event)
      if (!set) { set = new Set(); listeners.set(event, set) }
      set.add(cb as (p: unknown) => void)
      return () => { set!.delete(cb as (p: unknown) => void) }
    },
  }
}

export function defaultUuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (c?.randomUUID) return c.randomUUID()
  // RFC 4122 v4 fallback (only reached in very old runtimes; never on iOS 17+/Node 19+).
  const bytes = new Uint8Array(16)
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export const consoleLogger: ServiceLogger = {
  info: (m, ...r) => console.log(m, ...r),
  warn: (m, ...r) => console.warn(m, ...r),
  error: (m, ...r) => console.error(m, ...r),
}
