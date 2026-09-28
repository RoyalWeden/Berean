import { create } from 'zustand'
import type { SyncConfig } from '@/types/electron'
import type { SyncProgress, SyncStatusSnapshot } from '@/platform/sync/types'

/**
 * The ONE place the UI reads iCloud sync state from (DATA-UX-001). The compact Settings row, the
 * iCloud detail page, the first-sync panel and any status badge subscribe to this store; it
 * subscribes once to `window.sync` (status pushes, including live progress) and owns the
 * enable / disable actions — so every toggle shows the same value and updates everywhere at once.
 * The authoritative state itself lives in the sync engine (main process on the Mac, the WebView
 * host on the iPhone); this store only mirrors it.
 */
export interface SyncUiState {
  config: SyncConfig | null
  status: SyncStatusSnapshot | null
  /** A toggle / enable is in flight. */
  busy: boolean
  /** The last enable attempt failed (message for the user). */
  error: string | null
  /** The user turned sync on in this session and the first pass has not finished yet. */
  setupInProgress: boolean
  refresh: () => Promise<void>
  setEnabled: (on: boolean) => Promise<{ ok: boolean; reason?: string }>
}

let wired = false

export const useSyncUi = create<SyncUiState>((set, get) => ({
  config: null,
  status: null,
  busy: false,
  error: null,
  setupInProgress: false,
  refresh: async () => {
    const api = typeof window !== 'undefined' ? window.sync : undefined
    if (!api) return
    const [config, status] = await Promise.all([api.getConfig().catch(() => null), api.getStatus().catch(() => null)])
    set({ config, status })
  },
  setEnabled: async (on) => {
    const api = typeof window !== 'undefined' ? window.sync : undefined
    if (!api) return { ok: false, reason: 'iCloud sync is not available here.' }
    set({ busy: true, error: null })
    try {
      if (on) {
        const r = await api.enable()
        if (!r.ok) { set({ error: r.reason ?? 'Could not turn on iCloud sync.' }); return r }
        set({ setupInProgress: true })
        return r
      }
      await api.disable()
      set({ setupInProgress: false })
      return { ok: true }
    } finally {
      set({ busy: false })
      await get().refresh()
    }
  },
}))

/** Subscribe the store to the platform's sync bridge (idempotent; called by the app shell and by
 *  any view that needs it first). */
export function wireSyncUi(): void {
  if (wired || typeof window === 'undefined' || !window.sync) return
  wired = true
  window.sync.onStatus((status) => {
    const prev = useSyncUi.getState()
    // The first full pass after turning sync on has finished once a pass ends (no progress).
    const setupDone = prev.setupInProgress && !!status && !status.progress && status.lastSyncedAt != null
    useSyncUi.setState({ status, ...(setupDone ? { setupInProgress: false } : {}) })
  })
  void useSyncUi.getState().refresh()
}

/** Tests only. */
export function __resetSyncUi(): void { wired = false; useSyncUi.setState({ config: null, status: null, busy: false, error: null, setupInProgress: false }) }

// ── presentation (pure) ──────────────────────────────────────────────────────────────────────

/**
 * User-facing sync states (DATA-UX-002). One name per situation the user should be able to tell
 * apart; computed from the engine snapshot, never stored separately.
 */
export type SyncUiKey =
  | 'disabled' | 'checkingAvailability' | 'initializing' | 'bootstrapping'
  | 'fetchingRemoteChanges' | 'applyingRemoteChanges' | 'uploadingLocalChanges' | 'finalizing'
  | 'upToDate' | 'changesWaiting' | 'offline' | 'accountUnavailable' | 'held' | 'error'

export interface SyncPresentation {
  key: SyncUiKey
  /** Short status for the Settings row ("Up to date", "Syncing… 42 of 180"). */
  short: string
  /** A sentence for the detail page. */
  detail: string
  tone: 'neutral' | 'busy' | 'good' | 'warning' | 'danger'
  busy: boolean
}

const ACTIVITY_KEY: Record<SyncProgress['activity'], SyncUiKey> = {
  checking: 'checkingAvailability', fetching: 'fetchingRemoteChanges', applying: 'applyingRemoteChanges',
  uploading: 'uploadingLocalChanges', finalizing: 'finalizing',
}

export function presentSync(config: SyncConfig | null, status: SyncStatusSnapshot | null, o: { setupInProgress?: boolean; busy?: boolean } = {}): SyncPresentation {
  if (!config?.enabled) return { key: 'disabled', short: 'Off', detail: 'iCloud Sync is off on this device. Nothing is deleted: your data stays in iCloud and on your other devices, and this device keeps its own copy. Turning it back on reconciles both.', tone: 'neutral', busy: false }
  if (o.busy && !status) return { key: 'initializing', short: 'Turning on…', detail: 'Connecting to iCloud…', tone: 'busy', busy: true }
  if (!status) return { key: 'initializing', short: 'Starting…', detail: 'Starting iCloud sync…', tone: 'busy', busy: true }
  const p = status.progress
  if (status.state === 'held' || status.hold) return { key: 'held', short: 'Paused', detail: 'Sync is paused to protect your data — see below.', tone: 'warning', busy: false }
  if (status.state === 'unavailable' || !status.transport.available) return { key: 'accountUnavailable', short: 'iCloud unavailable', detail: 'iCloud is not available right now. Changes are kept on this device and sync when it returns.', tone: 'warning', busy: false }
  if (p) {
    const first = p.firstSync || !!o.setupInProgress
    const count = p.total != null && p.total > 0 && (p.activity === 'applying' || p.activity === 'uploading') ? ` ${Math.min(p.done, p.total)} of ${p.total}` : ''
    const verb = p.activity === 'uploading' ? 'Uploading' : p.activity === 'applying' ? (first ? 'Restoring' : 'Receiving') : p.activity === 'fetching' ? 'Checking iCloud' : p.activity === 'finalizing' ? 'Finishing' : 'Connecting'
    return { key: first && p.activity !== 'uploading' ? 'bootstrapping' : ACTIVITY_KEY[p.activity], short: `${verb}…${count}`, detail: first ? 'Setting up iCloud on this device.' : 'Syncing with your other devices.', tone: 'busy', busy: true }
  }
  if (status.state === 'attention' || status.lastError || status.failedOps) return { key: 'error', short: 'Needs attention', detail: 'Something could not sync. Your data is safe on this device; details are below.', tone: 'danger', busy: false }
  if (status.state === 'offline') return { key: 'offline', short: 'Offline', detail: 'Changes are kept on this device and sync when the network returns.', tone: 'warning', busy: false }
  if (status.state === 'pending' || status.state === 'uploading' || status.state === 'downloading' || status.state === 'reconciling') {
    const n = status.pendingOutbox + (status.remoteBehind ?? 0)
    return { key: 'changesWaiting', short: n ? `${n} change${n === 1 ? '' : 's'} waiting` : 'Changes waiting', detail: status.state === 'downloading' ? 'Another device has changes that are still arriving.' : status.state === 'uploading' ? 'iCloud has not accepted the latest changes yet.' : 'Changes are waiting to be written to iCloud.', tone: 'busy', busy: false }
  }
  return { key: 'upToDate', short: 'Up to date', detail: 'Everything this device can see is in sync.', tone: 'good', busy: false }
}

/** Progress as a fraction, or null when it cannot honestly be known (indeterminate). */
export function progressFraction(p: SyncProgress | null | undefined): number | null {
  if (!p || p.total == null || p.total <= 0) return null
  if (p.activity !== 'applying' && p.activity !== 'uploading' && p.activity !== 'fetching') return null
  return Math.max(0, Math.min(1, p.done / p.total))
}

/** How entities are grouped for the first-sync stage list (only the groups present are shown). */
export const ENTITY_GROUPS: Array<{ id: string; label: string; entities: string[] }> = [
  { id: 'notes', label: 'Notes', entities: ['note', 'note_version'] },
  { id: 'folders', label: 'Folders', entities: ['note_folder'] },
  { id: 'highlights', label: 'Highlights', entities: ['highlight'] },
  { id: 'tags', label: 'Verse tags', entities: ['verse_tag', 'verse_tag_member', 'tag_edge'] },
  { id: 'tabs', label: 'Tabs & sessions', entities: ['session', 'tab', 'archived_group'] },
  { id: 'workspaces', label: 'Workspaces', entities: ['workspace'] },
  { id: 'library', label: 'Library & study trail', entities: ['playlist', 'pdf', 'pdf_highlight', 'pdf_bookmark', 'youtube_user', 'ai_chat', 'trail_session', 'trail_node', 'trail_connection', 'trail_note', 'trail_tag'] },
]

export function groupProgress(p: SyncProgress | null | undefined): Array<{ id: string; label: string; done: number; total: number; complete: boolean }> {
  if (!p) return []
  const out = []
  for (const g of ENTITY_GROUPS) {
    let done = 0, total = 0
    for (const e of g.entities) { const x = p.byEntity[e]; if (x) { done += x.done; total += x.total } }
    if (total > 0) out.push({ id: g.id, label: g.label, done, total, complete: done >= total })
  }
  return out
}

/** "Today at 1:27 PM" / "Yesterday at …" / a date. */
export function formatSyncedAt(t: number | null | undefined, now = Date.now()): string {
  if (!t) return 'Never'
  const d = new Date(t), n = new Date(now)
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((day(n) - day(d)) / 86_400_000)
  if (diff <= 0) return `Today at ${time}`
  if (diff === 1) return `Yesterday at ${time}`
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === n.getFullYear() ? undefined : 'numeric' })} at ${time}`
}

/** Devices as Berean can honestly describe them (from their manifests). Devices silent for 90 days
 *  (e.g. an uninstalled copy) are listed as inactive, never removed or treated as a deletion. */
export function describeDevices(status: SyncStatusSnapshot | null, now = Date.now()): Array<{ id: string; name: string; platform: string; isThis: boolean; lastSeenAt: number | null; inactive: boolean }> {
  if (!status) return []
  return status.devices
    .map((d) => ({ id: d.device, name: d.name, platform: d.platform, isThis: d.device === status.deviceId, lastSeenAt: d.lastSeenAt ?? null, inactive: !!d.lastSeenAt && now - d.lastSeenAt > 90 * 86_400_000 }))
    .sort((a, b) => Number(b.isThis) - Number(a.isThis) || Number(a.inactive) - Number(b.inactive) || (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0))
}
