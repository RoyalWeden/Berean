// Cross-window sync for synced peer main windows (Phase 1).
//
// Each synced window is its own Electron BrowserWindow => its own renderer
// process => its own `useAppStore` instance. This module keeps a defined SHARED
// slice of that store convergent across every window, while leaving a per-window
// slice (which tab/space/layout each window is looking at) alone.
//
//   SHARED  (broadcast on local change, applied on remote message):
//     - the tab set + order of every session          -> `sessions`, live `tabs`
//     - the session list (create / rename / icon / delete)
//     - `sessionDisplayOrders`
//     - all display / notes / print / TTS / etc. preference fields
//
//   PER-WINDOW (never broadcast, never applied from a remote message):
//     - `currentSessionId`, `activeSpace`, `activeTabId`
//     - `panelLayout`
//     - scroll positions, text selection, floating search, modals
//
// Transport is `window.crossWindow` (preload) -> a dumb relay in the main
// process. This module owns all the semantics: which keys sync, echo
// suppression, session/tab reconciliation, and the one-time "mirror" handshake
// that seeds a freshly-spawned window from the window that opened it.

import { useAppStore } from '@/store'
import type { AppState, Session } from '@/store'
import type { SpaceId, Tab } from '@/types'

// ── Which store keys are part of the shared slice ────────────────────────────
// Session/tab structure is handled specially (see below); everything here is a
// plain "copy the value across" preference field. Kept in sync with the
// `partialize` list in src/store/index.ts — a field that should follow the user
// regardless of which window they're in belongs here.
const SHARED_PREFERENCE_KEYS = [
  'theme', 'themePreset', 'appZoom', 'bibleFontSize', 'bibleLineHeight',
  'defaultBibleTranslation', 'hermasTranslation', 'defaultScriptureLayout',
  'scriptureFontFamily', 'notesFontFamily', 'uiFontFamily',
  'noteTypingLook', 'noteTransformLayout', 'noteSidePanelPinned',
  'noteVerseRefsEnabled', 'noteLexiconRefsEnabled', 'autoEmDash',
  'autoPiP', 'defaultYoutubeLayout', 'floatingSearchDensity',
  'autoCloseTabsAfter', 'crossRefSource',
  'wordReplacerEnabled', 'wordReplacerRules',
  'idiomHighlightEnabled', 'idiomHoverPreviewEnabled',
  'backgroundAnimationEnabled', 'backgroundAnimationStyle', 'backgroundAnimationIntensity',
  'swipePanelGestureEnabled',
  'aiLookupCommentaryOn', 'aiLookupAgenticOn', 'aiLookupUseTabContext',
  'pdfFeatureEnabled', 'pdfDownloadLocation', 'dailyNoteLocation',
  'printMarginPreset', 'printCustomMargins', 'printPaperSize', 'printFontSizePt',
  'printFontFamily', 'printIncludeTitle', 'printColorMode', 'printTheme',
  'ttsVoiceURI', 'ttsRate', 'ttsHighlightWordsEnabled', 'ttsAutoAdvanceEnabled',
  'ttsAutoAdvancePauseSec', 'ttsAutoplayOnOpen',
  'studyTrailAskChapterJumpReason',
  'viewerTheme', 'viewerLaserEnabled', 'viewerSelectionMirror', 'viewerSidePanelEnabled',
  'historyMaxEntries', 'tabNavMaxStack',
] as const satisfies readonly (keyof AppState)[]

type SharedKey = (typeof SHARED_PREFERENCE_KEYS)[number]

// ── Wire protocol ───────────────────────────────────────────────────────────
type Message =
  | { kind: 'prefs'; patch: Partial<Record<SharedKey, unknown>> }
  | { kind: 'tabs'; sessionId: string; tabs: Record<SpaceId, Tab[]>; order: string[] | undefined }
  | { kind: 'sessions'; sessions: Session[] }
  | { kind: 'sessionOrders'; orders: Record<string, string[]> }
  | { kind: 'requestMirror'; replyTo: number }
  | { kind: 'mirrorState'; prefs: Partial<Record<SharedKey, unknown>>; sessions: Session[]; sessionDisplayOrders: Record<string, string[]>; view: { currentSessionId: string; activeSpace: SpaceId; activeTabId: Record<SpaceId, string | null> } }

// Guard so applying an inbound message doesn't immediately rebroadcast it.
let applyingRemote = false

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const ka = Object.keys(a as object), kb = Object.keys(b as object)
  if (ka.length !== kb.length) return false
  return ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

const SPACES: SpaceId[] = ['scripture', 'notes', 'lexicon', 'youtube', 'search']

/** Reconcile a window's own per-space active tab after a synced tab-set change:
 *  if this window was looking at a tab that another window just closed, fall
 *  back to the first remaining tab in that space (or null). */
function reconcileActiveTabs(
  activeTabId: Record<SpaceId, string | null>,
  tabs: Record<SpaceId, Tab[]>,
): Record<SpaceId, string | null> {
  let changed = false
  const next = { ...activeTabId }
  for (const space of Object.keys(tabs) as SpaceId[]) {
    const id = next[space]
    if (id && !tabs[space].some((t) => t.id === id)) {
      next[space] = tabs[space][0]?.id ?? null
      changed = true
    }
  }
  return changed ? next : activeTabId
}

/** Merge an incoming tab set onto the local one for the same session.
 *
 *  Membership + order come from `incoming` (so open / close / reorder in another
 *  window mirror here). But a tab that ALREADY exists in this window keeps its
 *  own `state` — that's where per-window navigation and scroll live ("the only
 *  difference is what's getting viewed"). Only genuinely new tabs adopt the
 *  sender's state, so their mirrored copy opens on the right chapter / note. */
function mergeTabSets(
  incoming: Record<SpaceId, Tab[]>,
  local: Record<SpaceId, Tab[]> | undefined,
): Record<SpaceId, Tab[]> {
  const out = {} as Record<SpaceId, Tab[]>
  for (const sp of SPACES) {
    const byId = new Map((local?.[sp] ?? []).map((t) => [t.id, t]))
    out[sp] = (incoming[sp] ?? []).map((inc) => {
      const mine = byId.get(inc.id)
      return mine ? { ...mine, title: inc.title, isPinned: inc.isPinned } : inc
    })
  }
  return out
}

function applyMessage(msg: Message): void {
  const store = useAppStore
  applyingRemote = true
  try {
    switch (msg.kind) {
      case 'prefs': {
        store.setState(msg.patch as Partial<AppState>)
        break
      }
      case 'sessions': {
        store.setState((s) => {
          // Keep our own current session; if it was deleted elsewhere, fall back.
          const stillExists = msg.sessions.some((ss) => ss.id === s.currentSessionId)
          const currentSessionId = stillExists ? s.currentSessionId : (msg.sessions[0]?.id ?? s.currentSessionId)
          // Merge each incoming session's tabs onto whatever this window already
          // has for that session (keep local per-tab view state).
          const sessions = msg.sessions.map((inc) => {
            const localSameId = s.sessions.find((ss) => ss.id === inc.id)
            const localTabs = inc.id === s.currentSessionId ? s.tabs : localSameId?.tabs
            return { ...inc, tabs: mergeTabSets(inc.tabs, localTabs) }
          })
          const cur = sessions.find((ss) => ss.id === currentSessionId)
          const patch: Partial<AppState> = { sessions, currentSessionId }
          if (cur) {
            patch.tabs = cur.tabs
            patch.activeTabId = reconcileActiveTabs(s.activeTabId, cur.tabs)
          }
          return patch
        })
        break
      }
      case 'tabs': {
        store.setState((s) => {
          const localTabs = s.currentSessionId === msg.sessionId
            ? s.tabs
            : s.sessions.find((ss) => ss.id === msg.sessionId)?.tabs
          const merged = mergeTabSets(msg.tabs, localTabs)
          const sessions = s.sessions.map((ss) => (ss.id === msg.sessionId ? { ...ss, tabs: merged } : ss))
          const patch: Partial<AppState> = { sessions }
          if (msg.order) patch.sessionDisplayOrders = { ...s.sessionDisplayOrders, [msg.sessionId]: msg.order }
          if (s.currentSessionId === msg.sessionId) {
            patch.tabs = merged
            patch.activeTabId = reconcileActiveTabs(s.activeTabId, merged)
          }
          return patch
        })
        break
      }
      case 'sessionOrders': {
        store.setState({ sessionDisplayOrders: msg.orders })
        break
      }
      case 'mirrorState': {
        // A deliberate one-time "open a copy of that window" — take the
        // spawner's sessions, tabs (with their live state) and view verbatim.
        store.setState((s) => {
          const sessions = msg.sessions
          const currentSessionId = sessions.some((ss) => ss.id === msg.view.currentSessionId)
            ? msg.view.currentSessionId
            : (sessions[0]?.id ?? s.currentSessionId)
          const cur = sessions.find((ss) => ss.id === currentSessionId)
          return {
            ...(msg.prefs as Partial<AppState>),
            sessions,
            sessionDisplayOrders: msg.sessionDisplayOrders,
            currentSessionId,
            activeSpace: msg.view.activeSpace,
            activeTabId: msg.view.activeTabId,
            tabs: cur?.tabs ?? s.tabs,
          }
        })
        break
      }
    }
  } finally {
    applyingRemote = false
  }
}

/** Call once, early, from the main app shell (App.tsx). Idempotent. */
export function initCrossWindowSync(): () => void {
  const cw = window.crossWindow
  if (!cw) return () => {}

  // ── Inbound ───────────────────────────────────────────────────────────────
  const offMessage = cw.onMessage((raw) => {
    const msg = raw as Message
    if (msg?.kind === 'requestMirror') {
      const s = useAppStore.getState()
      const prefs: Partial<Record<SharedKey, unknown>> = {}
      for (const k of SHARED_PREFERENCE_KEYS) prefs[k] = (s as unknown as Record<string, unknown>)[k]
      // Snapshot the live tabs back into the sessions array so the new window
      // sees the current session's real tab set, not its last stale snapshot.
      const sessions = s.sessions.map((ss) => (ss.id === s.currentSessionId ? { ...ss, tabs: s.tabs } : ss))
      cw.sendTo(msg.replyTo, {
        kind: 'mirrorState',
        prefs,
        sessions,
        sessionDisplayOrders: s.sessionDisplayOrders,
        view: { currentSessionId: s.currentSessionId, activeSpace: s.activeSpace, activeTabId: s.activeTabId },
      } satisfies Message)
      return
    }
    if (msg?.kind) applyMessage(msg)
  })

  // ── Outbound: watch the shared slice and broadcast real changes ───────────
  // This runs on EVERY store mutation (including one per keystroke while typing
  // a note), so the fast path has to be cheap: plain reference `!==` checks
  // against the previous state, no snapshots / JSON until something a synced key
  // cares about actually changed. Preference broadcasts are also debounced —
  // there's no need for a setting toggle to cross windows within the same tick.
  let prevPrefs: Record<string, unknown> | null = null
  let prevTabs: Record<SpaceId, Tab[]> | null = null
  let prevTabsSession = ''
  let prevSessions: Session[] | null = null
  let prevSessionsSig = ''
  let prevOrders: Record<string, string[]> | null = null

  const snapshotPrefs = (s: AppState) => {
    const o: Record<string, unknown> = {}
    for (const k of SHARED_PREFERENCE_KEYS) o[k] = (s as unknown as Record<string, unknown>)[k]
    return o
  }
  // Sessions signature ignores the per-session `tabs` (those ride the 'tabs'
  // message) — only list membership / name / icon changes matter here.
  const sessionsSig = (sessions: Session[]) =>
    JSON.stringify(sessions.map((ss) => [ss.id, ss.name, ss.icon ?? '']))

  const s0 = useAppStore.getState()
  prevPrefs = snapshotPrefs(s0)
  prevTabs = s0.tabs
  prevTabsSession = s0.currentSessionId
  prevSessions = s0.sessions
  prevSessionsSig = sessionsSig(s0.sessions)
  prevOrders = s0.sessionDisplayOrders

  let prefsTimer: ReturnType<typeof setTimeout> | null = null
  const flushPrefs = () => {
    prefsTimer = null
    const s = useAppStore.getState()
    const cur = snapshotPrefs(s)
    const changed: Record<string, unknown> = {}
    for (const k of SHARED_PREFERENCE_KEYS) {
      if (!shallowEqual(cur[k], prevPrefs![k])) changed[k] = cur[k]
    }
    if (Object.keys(changed).length > 0) {
      prevPrefs = cur
      cw.broadcast({ kind: 'prefs', patch: changed } satisfies Message)
    }
  }

  const unsub = useAppStore.subscribe((s, p) => {
    if (applyingRemote) return

    // Preferences — cheap ref scan first, then a debounced diff+broadcast.
    for (const k of SHARED_PREFERENCE_KEYS) {
      if ((s as unknown as Record<string, unknown>)[k] !== (p as unknown as Record<string, unknown>)[k]) {
        if (prefsTimer) clearTimeout(prefsTimer)
        prefsTimer = setTimeout(flushPrefs, 120)
        break
      }
    }

    // Live tabs of the session this window is currently on
    if (s.tabs !== prevTabs || s.currentSessionId !== prevTabsSession) {
      prevTabs = s.tabs
      prevTabsSession = s.currentSessionId
      cw.broadcast({
        kind: 'tabs',
        sessionId: s.currentSessionId,
        tabs: s.tabs,
        order: s.sessionDisplayOrders[s.currentSessionId],
      } satisfies Message)
    }

    // Session list membership / rename / icon — only stringify when the array ref moved
    if (s.sessions !== prevSessions) {
      prevSessions = s.sessions
      const sig = sessionsSig(s.sessions)
      if (sig !== prevSessionsSig) {
        prevSessionsSig = sig
        cw.broadcast({ kind: 'sessions', sessions: s.sessions } satisfies Message)
      }
    }

    // Display orders (drag-reorder in another window's sidebar)
    if (s.sessionDisplayOrders !== prevOrders) {
      prevOrders = s.sessionDisplayOrders
      cw.broadcast({ kind: 'sessionOrders', orders: s.sessionDisplayOrders } satisfies Message)
    }
  })

  // ── Mirror handshake for a freshly-spawned window ─────────────────────────
  try {
    const params = new URLSearchParams(window.location.search)
    const mirrorFrom = params.get('mirrorFrom')
    if (mirrorFrom) {
      cw.selfId().then((selfId) => {
        cw.sendTo(Number(mirrorFrom), { kind: 'requestMirror', replyTo: selfId } satisfies Message)
      }).catch(() => { /* opener already gone — new window keeps its rehydrated state */ })
    }
  } catch { /* no window.location (tests) */ }

  return () => { offMessage?.(); unsub(); if (prefsTimer) clearTimeout(prefsTimer) }
}
