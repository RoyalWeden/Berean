import { useCallback, useEffect, useRef, useState } from 'react'
import type { TrailNode, TrailSession, TrailSessionDetail } from '@/types/studyTrail'
import { LOOSE_SESSION_ID } from '@/store/studyTrailSlice'
import MapView, { pickControlSide, CTRL_W } from './MapView'
import { EVERYTHING_SCROLL_KEY, type TrailHeaderPos } from './trailWindowPrefs'
import TrailMapHeader from './TrailMapHeader'
import { getDailyNoteAnchorDate, toDateKey } from '@/lib/dailyNoteUtils'
import { useAppStore } from '@/store'

// How many sessions are loaded at a time. Everything used to call listAllSessions() and then
// getSession() for EVERY session on every change (plus a 2s poll), which is the "it will just get
// too long" problem from both ends: an unbounded render AND an unbounded fetch. Now it pages
// newest-first and pulls older ones in as you scroll up.
const PAGE_SIZE = 8

// The default landing view — everything recorded across EVERY session, with no session
// selected. Answers "I'm not in any particular session right now, just show me what's been
// tracked" rather than forcing a session pick first (or making you click into each one).
//
// Per the "one continuous spine" design decision: every node from every session is merged
// into a single true chronological timeline and rendered through MapView itself (not a
// separate, simpler copy of it) — a session boundary shows as a small inline divider label,
// but the spine itself is one real timeline, with the exact same gap-spacing, round-trip
// curves, origin lines, and connector overlay as an individual session's Map view. MapView
// itself is what keeps round-trip/forward-edge detection session-scoped (via each node's own
// trailSessionId) so two different sessions that happen to both visit the same chapter never
// look like a round trip between them.

function fmtBoundaryDate(ms: number): string {
  const d = new Date(ms)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString([], sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}

// Per feedback ("make it more clear where the time break is"), the automatic day/session
// boundary divider gets an actual clock time now, not just a date/session name — MapView pairs
// this with a clock icon and a heavier rule so it reads as distinctly "time actually moved here"
// rather than just another divider.
function fmtClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

// Day boundaries use the app's own daily-note anchor date rather than raw midnight: with a
// location configured, a stop recorded between midnight and sunrise still belongs to the previous
// day, which is how Berean's daily notes already define a day. Without a location it degrades to
// the plain calendar date, which is what getDailyNoteAnchorDate itself does.
function dayKeyFor(ms: number): string {
  try { return toDateKey(getDailyNoteAnchorDate(new Date(ms), useAppStore.getState().dailyNoteLocation)) }
  catch { return toDateKey(new Date(ms)) }
}

function fmtDayHeading(ms: number): string {
  const key = dayKeyFor(ms)
  const today = dayKeyFor(Date.now())
  const yesterday = dayKeyFor(Date.now() - 86_400_000)
  if (key === today) return 'Today'
  if (key === yesterday) return 'Yesterday'
  const d = new Date(ms)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString([], sameYear
    ? { weekday: 'short', month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function EverythingView({
  sessions, zoom, onZoomChange, revisitWindowMs, onLayoutRoomChange, layoutRoom,
  headerCollapsed, onToggleHeaderCollapsed, headerPos, onHeaderDragStart,
}: {
  sessions: TrailSession[]
  zoom?: number
  onZoomChange?: (zoom: number) => void
  revisitWindowMs?: number
  onLayoutRoomChange?: (room: { left: number; right: number }) => void
  layoutRoom?: { left: number; right: number }
  headerCollapsed: boolean
  onToggleHeaderCollapsed: () => void
  headerPos: TrailHeaderPos | null
  onHeaderDragStart: (e: React.MouseEvent) => void
}) {
  const headerSide = pickControlSide(layoutRoom, CTRL_W.header)
  const [details, setDetails] = useState<TrailSessionDetail[]>([])
  const [allSessions, setAllSessions] = useState<TrailSession[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  // Paging state. `cursor` is the keyset cursor for the NEXT page (undefined once exhausted);
  // `loadedCount` is how many sessions are currently in the window, so a live refresh re-fetches
  // exactly what's on screen rather than resetting back to one page.
  const [cursor, setCursor] = useState<number | undefined>(undefined)
  const [exhausted, setExhausted] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const loadedCountRef = useRef(PAGE_SIZE)

  /** Fetches the newest `count` sessions and their details, replacing the window. Used both for
   *  the first load and for every live refresh — refreshing has to cover everything currently
   *  visible, not just the first page, or scrolling back in time then studying would silently
   *  drop the older pages. */
  const loadWindow = useCallback(async (count: number, showLoading: boolean) => {
    if (showLoading) setLoading(true)
    // listSessionsPage (not the `sessions` prop, and no longer listAllSessions) so the implicit
    // "Loose stops" bucket is merged in too — it's filtered out of the session rail, so it only
    // ever appears here — while still bounding how much is fetched at once.
    const page = await window.studyTrail.listSessionsPage(undefined, count).catch(() => ({ sessions: [] as TrailSession[], nextCursor: undefined }))
    setAllSessions(page.sessions)
    setCursor(page.nextCursor)
    setExhausted(page.nextCursor == null)
    const rows = await Promise.all(page.sessions.map((s) => window.studyTrail.getSession(s.id)))
    setDetails(rows.filter((r): r is TrailSessionDetail => !!r))
    if (showLoading) setLoading(false)
  }, [])

  /** Pulls the next page of OLDER sessions in, appending to the window. */
  const loadOlder = useCallback(async () => {
    if (exhausted || loadingMore || cursor == null) return
    setLoadingMore(true)
    try {
      const page = await window.studyTrail.listSessionsPage(cursor, PAGE_SIZE)
      const rows = await Promise.all(page.sessions.map((s) => window.studyTrail.getSession(s.id)))
      setAllSessions((prev) => [...prev, ...page.sessions])
      setDetails((prev) => [...prev, ...rows.filter((r): r is TrailSessionDetail => !!r)])
      setCursor(page.nextCursor)
      setExhausted(page.nextCursor == null)
      loadedCountRef.current += page.sessions.length
    } finally {
      setLoadingMore(false)
    }
  }, [cursor, exhausted, loadingMore])

  useEffect(() => { loadedCountRef.current = PAGE_SIZE; void loadWindow(PAGE_SIZE, true) }, [sessions.map((s) => s.id).join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  // The old 2s poll is gone. It re-ran the full "every session, in full" fetch twice a second's
  // worth of CPU forever while this view was open, and the push channel below already covers the
  // "auto updates as i am studying" requirement it was there for — the poll was only ever a
  // fallback from before that channel existed.
  useEffect(() => window.studyTrail.onDataChanged(() => { void loadWindow(loadedCountRef.current, false) }), [loadWindow])

  const totalConnections = details.reduce((n, d) => n + d.connections.length, 0)
  const totalNodes = details.reduce((n, d) => n + d.nodes.length, 0)

  if (loading) return <div style={{ color: 'rgb(var(--color-text-muted))', fontSize: 13 }}>Loading…</div>

  // Merge every session's nodes/connections/pausedIntervals into one chronologically-sorted
  // timeline. Nodes are globally-unique UUIDs (not per-session sequence numbers), so a plain
  // concat + sort is safe — no id collisions to worry about across sessions.
  const mergedNodes: TrailNode[] = details.flatMap((d) => d.nodes).sort((a, b) => a.anchorStartedAt - b.anchorStartedAt)
  const mergedConnections = details.flatMap((d) => d.connections)
  const mergedPausedIntervals = details.flatMap((d) => d.pausedIntervals)
  const sessionById = new Map(allSessions.map((s) => [s.id, s]))

  // Two kinds of divider, in one map because MapView renders one label per node: a DAY heading
  // whenever the (sunset-aware) day rolls over, and a SESSION label whenever the session changes.
  // A node that starts both gets them on one line — repeating the date directly under a "Today"
  // heading reads as noise. Chunking by day is the "things in the everything need to be broken up
  // because it will just get too long" half of the fix; paging above is the other half.
  const boundaryLabelForNodeId = new Map<string, string>()
  let lastSessionId: string | null = null
  let lastDayKey: string | null = null
  for (const n of mergedNodes) {
    const dayKey = dayKeyFor(n.anchorStartedAt)
    const dayRolled = dayKey !== lastDayKey
    const sessionChanged = n.trailSessionId !== lastSessionId
    if (dayRolled || sessionChanged) {
      const s = sessionById.get(n.trailSessionId)
      // The implicit bucket renders as a plain "Loose stops" divider (no session name to
      // show — the user never named it) so a run of un-sessioned stops still reads as its
      // own stretch of the timeline.
      const label = s?.id === LOOSE_SESSION_ID || !s ? 'Loose stops' : s.name
      boundaryLabelForNodeId.set(n.id, dayRolled
        ? `${fmtDayHeading(n.anchorStartedAt)}, ${fmtClock(n.anchorStartedAt)} · ${label}`
        : `${label} — ${fmtBoundaryDate(n.anchorStartedAt)}, ${fmtClock(n.anchorStartedAt)}`)
      lastSessionId = n.trailSessionId
      lastDayKey = dayKey
    }
  }

  const merged: TrailSessionDetail = {
    // MapView never reads `session` itself (only nodes/connections/pausedIntervals) — this is
    // just a placeholder to satisfy the shared type.
    session: details[0]?.session ?? { id: 'merged', name: 'Everything', status: 'ended', possiblyAccidental: false, recapUserEdited: false, createdAt: 0, updatedAt: 0 },
    nodes: mergedNodes,
    connections: mergedConnections,
    pausedIntervals: mergedPausedIntervals,
  }

  return (
    // flex column filling the full height handed down by StudyTrailApp's "Main pane" — MapView
    // needs a genuinely bounded ancestor chain for ITS OWN internal scroll container to be the
    // one that actually scrolls (see MapView.tsx's own comment on this).
    <div data-trail-map-viewport style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <TrailMapHeader
        side={headerSide}
        collapsed={headerCollapsed}
        onToggleCollapsed={onToggleHeaderCollapsed}
        pos={headerPos}
        onDragStart={onHeaderDragStart}
        title={<h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Everything</h2>}
        filterValue={filter}
        onFilterChange={setFilter}
        statsLine={<>{sessions.length} session{sessions.length === 1 ? '' : 's'} · {totalNodes} chapter stop{totalNodes === 1 ? '' : 's'} · {totalConnections} connection{totalConnections === 1 ? '' : 's'} total</>}
      />
      {mergedNodes.length === 0 ? (
        <div style={{ fontSize: 12, color: 'rgb(var(--color-text-muted))' }}>No sessions yet — start one from the rail on the left.</div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {/* Older sessions load on demand rather than all at once. Deliberately a button and not
              a scroll sentinel: the map restores its own scroll position on mount and auto-jumps
              to the newest stop, so an "am I near the top?" observer would fire spuriously during
              those jumps and pull in pages nobody asked for. */}
          {!exhausted && (
            <button
              onClick={() => { void loadOlder() }}
              disabled={loadingMore}
              style={{
                alignSelf: 'center', marginBottom: 6, fontSize: 11, padding: '4px 12px', borderRadius: 999,
                cursor: loadingMore ? 'default' : 'pointer', background: 'rgb(var(--color-surface-2))',
                border: '1px solid rgb(var(--color-surface-4))', color: 'rgb(var(--color-text-muted))',
              }}
            >{loadingMore ? 'Loading…' : `Load ${PAGE_SIZE} older sessions`}</button>
          )}
          <MapView detail={merged} onChanged={() => { void loadWindow(loadedCountRef.current, false) }} boundaryLabelForNodeId={boundaryLabelForNodeId} scrollKey={EVERYTHING_SCROLL_KEY} zoom={zoom} onZoomChange={onZoomChange} revisitWindowMs={revisitWindowMs} filterValue={filter} onFilterChange={setFilter} topInset={8} onLayoutRoomChange={onLayoutRoomChange} />
        </div>
      )}
    </div>
  )
}
