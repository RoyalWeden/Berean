import { useAppStore, type AppState } from './index'
import { buildSnapshot, hydrateFromRows, emptyKeyMaps, type OrderKeyMaps, type HydratedState, SPACES } from './tabPersistence'
import type { SpaceId, Tab, TabType } from '../types'
import { splitTabState, mergeTabState, isKnownTabType } from '../platform/sync/tabFields'

/**
 * Runtime half of the sessions/tabs mirror (see tabPersistence.ts for the pure functions).
 *
 *  - Startup: if the `sessions` table is empty, the store's current (localStorage-restored)
 *    sessions/tabs are imported once ("legacy import"); otherwise the store is hydrated from
 *    SQLite, which is the durable, syncable source from then on. The window's own view
 *    (current session, active space, active tab) is preserved.
 *  - Then every change to sessions / tabs / display orders / archived groups / active tabs is
 *    written back, debounced, as a full snapshot diff (only changed rows are actually written).
 *  - `applyExternalSessions()` is the entry point the sync engine uses after it has applied
 *    remote ops to the tables: structure (membership, order, titles, sync state) comes from the
 *    rows, per-tab local view state stays local — the same policy crossWindowSync.mergeTabSets
 *    uses between two desktop windows.
 *
 * Silent when `window.sessions` is absent (vitest, an independent desktop window that opts out of
 * shared tabs) — the store then behaves exactly as before this module existed.
 */
const DEBOUNCE_MS = 400

let keys: OrderKeyMaps = emptyKeyMaps()

/**
 * Remote changes to the tab ON SCREEN are held back (DATA-TAB-001): another device navigating the
 * same synced tab must never move what the user is reading right now. The held remote tab is
 * applied when the user leaves that tab; if the user changes the tab meanwhile, their change
 * wins (it is newer) and the held remote state is dropped. While held, snapshots write the
 * REMOTE state for that tab back unchanged, so this device never re-publishes its stale view.
 */
const deferred = new Map<string, { kept: string; remote: Tab }>()
const syncSig = (t: Tab) => JSON.stringify([t.type, splitTabState(isKnownTabType(t.type) ? t.type : 'bible', t.state).sync])
function onScreenTabId(s: AppState): string | null { return s.activeTabId[s.activeSpace] ?? null }
function replaceTab(tabs: AppState['tabs'], id: string, next: Tab): AppState['tabs'] {
  const out = { ...tabs }
  for (const sp of SPACES) if ((out[sp] ?? []).some((t) => t.id === id)) out[sp] = out[sp].map((t) => (t.id === id ? next : t))
  return out
}
function findTab(tabs: AppState['tabs'], id: string): Tab | undefined {
  for (const sp of SPACES) { const t = (tabs[sp] ?? []).find((x) => x.id === id); if (t) return t }
  return undefined
}
/** The store as it should be WRITTEN: held tabs carry their remote state (or the user's own newer change). */
function writableState(s: AppState): AppState {
  let tabs = s.tabs
  for (const [id, d] of [...deferred]) {
    const mine = findTab(tabs, id)
    if (!mine) { deferred.delete(id); continue }
    if (syncSig(mine) !== d.kept) { deferred.delete(id); continue }   // the user changed it: theirs wins
    if (mine.type === d.remote.type) tabs = replaceTab(tabs, id, { ...d.remote, state: mergeTabState(mine.type, splitTabState(mine.type, d.remote.state).sync, splitTabState(mine.type, mine.state).local) })
  }
  return tabs === s.tabs ? s : { ...s, tabs }
}
/** The user left a held tab: show the remote state now (unless they changed the tab meanwhile). */
function releaseDeferred(): void {
  if (!deferred.size) return
  const s = useAppStore.getState()
  const onScreen = onScreenTabId(s)
  let tabs = s.tabs
  for (const [id, d] of [...deferred]) {
    if (id === onScreen) continue
    deferred.delete(id)
    const mine = findTab(tabs, id)
    if (!mine || syncSig(mine) !== d.kept) continue
    const type: TabType = isKnownTabType(d.remote.type) ? d.remote.type : 'bible'
    tabs = replaceTab(tabs, id, { ...d.remote, state: mergeTabState(type, d.remote.state as unknown as Record<string, unknown>, type === mine.type ? splitTabState(type, mine.state).local : {}) })
  }
  if (tabs !== s.tabs) {
    applyingExternal = true
    try { useAppStore.setState({ tabs }) } finally { applyingExternal = false }
  }
}
let lastSnapshotSig = ''
let applyingExternal = false
let installed = false

function api(): Window['sessions'] | undefined {
  return typeof window !== 'undefined' ? window.sessions : undefined
}

function pickState(s: AppState) {
  return {
    sessions: s.sessions, currentSessionId: s.currentSessionId, tabs: s.tabs, activeTabId: s.activeTabId,
    sessionDisplayOrders: s.sessionDisplayOrders, archivedGroups: s.archivedGroups,
  }
}

async function writeSnapshot(): Promise<void> {
  const sessionsApi = api()
  if (!sessionsApi) return
  const s = writableState(useAppStore.getState())
  const built = buildSnapshot(pickState(s), keys)
  keys = built.keys
  const sig = JSON.stringify(built.snapshot)
  if (sig !== lastSnapshotSig) {
    lastSnapshotSig = sig
    try {
      await sessionsApi.applySnapshot(built.snapshot)
    } catch (err) {
      console.error('[tabPersistence] applySnapshot failed', err)
      lastSnapshotSig = ''   // retry on the next change
    }
  }
  try {
    const active = built.localState.get(s.currentSessionId)
    if (active) await sessionsApi.setLocalState(s.currentSessionId, active)
  } catch (err) {
    console.error('[tabPersistence] setLocalState failed', err)
  }
}

/** Merge hydrated sessions into the store, keeping this window's view. */
function applyHydrated(h: HydratedState, opts: { keepLocalTabState: boolean; holdOnScreen?: boolean }): void {
  applyingExternal = true
  try {
    useAppStore.setState((s) => {
      const onScreen = opts.holdOnScreen ? onScreenTabId(s) : null
      const sessions = h.sessions.map((inc) => {
        if (!opts.keepLocalTabState) return inc
        // Keep per-tab local view state this window already has (scroll, cursor, pane sizes).
        const local = inc.id === s.currentSessionId ? s.tabs : s.sessions.find((x) => x.id === inc.id)?.tabs
        if (!local) return inc
        const tabs = { ...inc.tabs }
        for (const sp of SPACES) {
          const byId = new Map((local[sp] ?? []).map((t) => [t.id, t]))
          tabs[sp] = inc.tabs[sp].map((t) => {
            const mine = byId.get(t.id)
            if (!mine) return t
            // The tab on screen keeps what the user is looking at; the remote state waits.
            if (t.id === onScreen && inc.id === s.currentSessionId && syncSig(t) !== syncSig(mine)) {
              const held = deferred.get(t.id)
              deferred.set(t.id, { kept: held?.kept ?? syncSig(mine), remote: t })
              return mine
            }
            // Synced fields come from the rows; this device's in-memory LOCAL fields (scroll,
            // cursor, pane sizes) are newer than whatever local_state_json was last mirrored.
            const type: TabType = isKnownTabType(mine.type) ? mine.type : 'bible'
            const { local } = splitTabState(type, mine.state)
            // mergeTabState, not a spread: nested local parts (compare columns' scrollPos) must be
            // merged per column — a spread replaced the synced columns with the bare local shells.
            return { ...t, state: mergeTabState(type, t.state as unknown as Record<string, unknown>, local) }
          })
        }
        return { ...inc, tabs }
      })
      const stillExists = sessions.some((x) => x.id === s.currentSessionId)
      const currentSessionId = stillExists ? s.currentSessionId : (sessions[0]?.id ?? s.currentSessionId)
      const cur = sessions.find((x) => x.id === currentSessionId)
      const patch: Partial<AppState> = { sessions, sessionDisplayOrders: h.sessionDisplayOrders, archivedGroups: h.archivedGroups, currentSessionId }
      if (cur) {
        patch.tabs = cur.tabs
        const activeTabId = { ...s.activeTabId }
        for (const sp of SPACES) {
          const wanted = stillExists ? s.activeTabId[sp] : cur.activeTabId[sp]
          activeTabId[sp] = wanted && cur.tabs[sp].some((t) => t.id === wanted) ? wanted : (cur.activeTabId[sp] ?? cur.tabs[sp][0]?.id ?? null)
        }
        patch.activeTabId = activeTabId as Record<SpaceId, string | null>
      }
      return patch
    })
  } finally {
    applyingExternal = false
  }
}

async function loadRows(): Promise<HydratedState> {
  const sessionsApi = api()!
  const sessionRows = await sessionsApi.listSessions()
  const tabRows = await sessionsApi.listTabs()
  const groupRows = await sessionsApi.listArchivedGroups()
  const local = new Map<string, Record<string, string | null>>()
  for (const s of sessionRows) local.set(s.id, await sessionsApi.getLocalState(s.id))
  return hydrateFromRows(sessionRows, tabRows, groupRows, local)
}

/**
 * Install the mirror. Returns a teardown. Idempotent per window.
 */
export function installTabPersistence(): () => void {
  const sessionsApi = api()
  if (!sessionsApi || installed) return () => {}
  installed = true

  let timer: ReturnType<typeof setTimeout> | null = null
  let ready = false
  const schedule = () => {
    if (!ready || applyingExternal) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = null; void writeSnapshot() }, DEBOUNCE_MS)
  }

  const unsub = useAppStore.subscribe((s, p) => {
    if (s.activeTabId !== p.activeTabId || s.activeSpace !== p.activeSpace) releaseDeferred()
    if (s.sessions !== p.sessions || s.tabs !== p.tabs || s.sessionDisplayOrders !== p.sessionDisplayOrders
      || s.archivedGroups !== p.archivedGroups || s.activeTabId !== p.activeTabId || s.currentSessionId !== p.currentSessionId) {
      schedule()
    }
  })

  const flush = () => { if (timer) { clearTimeout(timer); timer = null; void writeSnapshot() } }
  window.addEventListener('pagehide', flush)
  window.addEventListener('beforeunload', flush)
  // iOS rarely fires pagehide on backgrounding; the app can then be killed while suspended.
  const onHidden = () => { if (document.visibilityState === 'hidden') flush() }
  document.addEventListener('visibilitychange', onHidden)

  void (async () => {
    try {
      if (await sessionsApi.hasAny()) {
        const h = await loadRows()
        keys = h.keys
        // The tab the user was reading when the app closed stays where it was, even if another
        // device moved it meanwhile (held until they leave it — see `deferred`).
        applyHydrated(h, { keepLocalTabState: true, holdOnScreen: true })
        lastSnapshotSig = JSON.stringify(buildSnapshot(pickState(writableState(useAppStore.getState())), keys).snapshot)
      } else {
        // Legacy import: the localStorage-restored store is the only copy; make it durable.
        const s = useAppStore.getState()
        const built = buildSnapshot(pickState(s))
        keys = built.keys
        const diff = await sessionsApi.applySnapshot(built.snapshot)
        for (const [sid, active] of built.localState) await sessionsApi.setLocalState(sid, active)
        lastSnapshotSig = JSON.stringify(built.snapshot)
        console.log(`[tabPersistence] imported ${diff.upserted.sessions} sessions / ${diff.upserted.tabs} tabs / ${diff.upserted.archivedGroups} archived groups from localStorage`)
      }
    } catch (err) {
      console.error('[tabPersistence] startup failed — store keeps running from localStorage', err)
    } finally {
      ready = true
      schedule()   // catch anything that changed while loading
    }
  })()

  return () => {
    unsub()
    window.removeEventListener('pagehide', flush)
    window.removeEventListener('beforeunload', flush)
    document.removeEventListener('visibilitychange', onHidden)
    flush()
    installed = false
  }
}

/** Sync engine hook (Phase 6+): re-read the tables after remote ops were applied. */
/**
 * A tab gesture in progress (drag-reorder on the Mac tab bar, lift-and-drag on the iPhone tab
 * cards): remote tab changes that arrive meanwhile are applied once the gesture ends, so the list
 * never reshuffles under the user's finger (DATA-TAB-002).
 */
let interacting = 0
let pendingExternal = false
let interactionTimer: ReturnType<typeof setTimeout> | null = null
export function setTabInteraction(active: boolean): void {
  interacting = Math.max(0, interacting + (active ? 1 : -1))
  // A lost pointer / missed drag-end must never hold remote tab changes forever.
  if (interactionTimer) { clearTimeout(interactionTimer); interactionTimer = null }
  if (interacting > 0) interactionTimer = setTimeout(() => { interacting = 1; setTabInteraction(false) }, 30_000)
  if (interacting === 0 && pendingExternal) { pendingExternal = false; void applyExternalSessions() }
}

export async function applyExternalSessions(): Promise<void> {
  if (!api()) return
  if (interacting > 0) { pendingExternal = true; return }
  const h = await loadRows()
  keys = h.keys
  applyHydrated(h, { keepLocalTabState: true, holdOnScreen: true })
  lastSnapshotSig = JSON.stringify(buildSnapshot(pickState(writableState(useAppStore.getState())), keys).snapshot)
}

/** Test-only: reset module state between installs. */
export function __resetTabPersistence(): void {
  keys = emptyKeyMaps()
  lastSnapshotSig = ''
  applyingExternal = false
  installed = false
  deferred.clear()
  interacting = 0
  pendingExternal = false
}
