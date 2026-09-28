import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { MoreHorizontal, ZoomIn, ZoomOut, StickyNote, Tags, Pencil, FileText, Play, Pause, Square, Trash2 } from 'lucide-react'
import { useStudyTrailStore, LOOSE_SESSION_ID } from '@/store/studyTrailSlice'
import type { TrailSession, TrailSessionDetail } from '@/types/studyTrail'
import MapView from '@/components/studyTrail/MapView'
import ThreadsView from '@/components/studyTrail/ThreadsView'
import EverythingView from '@/components/studyTrail/EverythingView'
import TrailSearchView from '@/components/studyTrail/TrailSearchView'
import { DEFAULT_REVISIT_WINDOW_MS } from '@/components/studyTrail/trailTime'
import { EVERYTHING_SCROLL_KEY, TRAIL_ZOOM_MIN, TRAIL_ZOOM_MAX } from '@/components/studyTrail/trailWindowPrefs'
import { Page, IconTap } from '../primitives/Page'
import { useSheets } from '../primitives/Sheet'
import { useActionSheet, type SheetAction } from '../primitives/ActionSheet'
import { Segmented } from '../settings/SettingsPage'
import { haptic } from '../primitives/haptics'
import { TrailNotesSheet } from './TrailNotesSheet'
import { TrailTagsSheet } from './TrailTagsSheet'
import { sessionActionsFor, type SessionActionId } from './trailSessions'
import './trail.css'

export type TrailView = 'map' | 'threads' | 'everything' | 'search'
const VIEW_OPTIONS: Array<[TrailView, string]> = [['map', 'Map'], ['threads', 'Threads'], ['everything', 'Everything'], ['search', 'Search']]
const clampZoom = (z: number) => Math.min(TRAIL_ZOOM_MAX, Math.max(TRAIL_ZOOM_MIN, z))

/**
 * One session (or, with `sessionId` null, the merged Everything timeline) on the phone: the
 * desktop's own MapView / ThreadsView / EverythingView / TrailSearchView hosted under a segmented
 * control. Data flows exactly as in StudyTrailApp — `window.studyTrail.getSession` + a 2 s poll
 * + `onDataChanged` push — and a tap on any stop / Strong's label opens it in the reader (see
 * trailPhoneNav.ts, installed by StudyTrailPage). The session "…" menu holds the actions the
 * desktop offers from its rail context menu and header: resume / pause / end, rename, recap,
 * sticky notes, tags, zoom, delete.
 */
export function TrailSessionPage({ sessionId, onBack, onOpenSession, initialView }: {
  sessionId: string | null
  onBack: () => void
  onOpenSession: (id: string) => void
  initialView?: TrailView
}) {
  const [view, setView] = useState<TrailView>(initialView ?? (sessionId ? 'map' : 'everything'))
  const [detail, setDetail] = useState<TrailSessionDetail | null>(null)
  const [sessions, setSessions] = useState<TrailSession[]>([])
  const [zoom, setZoom] = useState(1)
  const [headerCollapsed, setHeaderCollapsed] = useState(true)
  const sheets = useSheets()
  const actions = useActionSheet()
  const currentTrailSessionId = useStudyTrailStore((s) => s.currentTrailSessionId)

  const loadDetail = useCallback(() => {
    if (!sessionId) return Promise.resolve()
    return window.studyTrail.getSession(sessionId).then((d) => setDetail(d)).catch(() => {})
  }, [sessionId])
  useEffect(() => {
    void loadDetail()
    if (!sessionId) return
    const interval = setInterval(() => void loadDetail(), 2000)
    const unsub = window.studyTrail.onDataChanged((id) => { if (id === undefined || id === sessionId) void loadDetail() })
    return () => { clearInterval(interval); unsub?.() }
  }, [sessionId, loadDetail])
  const loadSessions = useCallback(() => window.studyTrail.listSessions().then(setSessions).catch(() => {}), [])
  useEffect(() => { void loadSessions(); return window.studyTrail.onDataChanged(() => void loadSessions()) }, [loadSessions])

  const session = detail?.session ?? null
  const isCurrent = !!sessionId && sessionId === currentTrailSessionId
  const title = sessionId ? (session?.name ?? 'Session') : 'Everything'

  const runAction = useCallback(async (id: SessionActionId) => {
    if (!sessionId || !session) return
    const st = useStudyTrailStore.getState()
    switch (id) {
      case 'resume': isCurrent && session.status === 'paused' ? await st.resumeTrailSession() : await st.activateExistingSession(sessionId); break
      case 'pause': await st.pauseTrailSession(); break
      case 'end': isCurrent ? await st.endTrailSession() : await window.studyTrail.endSession(sessionId); break
      case 'rename': { const n = prompt('Session name', session.name); if (n?.trim()) await window.studyTrail.renameSession(sessionId, n.trim()); break }
      case 'recap': { const r = prompt('Recap', session.recapText ?? ''); if (r != null) await window.studyTrail.updateRecap(sessionId, r); break }
      case 'notes': sheets.open({ id: 'trail-notes', title: 'Sticky notes', detents: [0.6, 0.92], render: (api) => <TrailNotesSheet sessionId={sessionId} api={api} /> }); return
      case 'tags': sheets.open({ id: 'trail-tags', title: 'Tags', detents: [0.6, 0.92], render: (api) => <TrailTagsSheet sessionId={sessionId} api={api} /> }); return
      case 'delete': if (confirm(`Delete "${session.name}" and its stops?`)) { await st.deleteTrailSession(sessionId); onBack() } return
    }
    void haptic.light()
    await loadDetail()
  }, [sessionId, session, isCurrent, sheets, loadDetail, onBack])

  const openMore = () => {
    const icons: Record<SessionActionId, SheetAction['icon']> = { resume: Play, pause: Pause, end: Square, rename: Pencil, recap: FileText, tags: Tags, notes: StickyNote, delete: Trash2 }
    const labels: Record<SessionActionId, string> = { resume: isCurrent && session?.status === 'paused' ? 'Resume recording' : 'Record into this session', pause: 'Pause recording', end: 'End session', rename: 'Rename…', recap: 'Recap…', tags: 'Tags…', notes: 'Sticky notes…', delete: 'Delete session' }
    const list: SheetAction[] = []
    if (view === 'map' || view === 'everything') {
      list.push({ id: 'zoom-in', label: 'Zoom in', icon: ZoomIn, disabled: zoom >= TRAIL_ZOOM_MAX, onSelect: () => setZoom((z) => clampZoom(z * 1.2)) })
      list.push({ id: 'zoom-out', label: 'Zoom out', icon: ZoomOut, disabled: zoom <= TRAIL_ZOOM_MIN, onSelect: () => setZoom((z) => clampZoom(z / 1.2)) })
    }
    if (session && sessionId && sessionId !== LOOSE_SESSION_ID) {
      // Sticky notes / Tags open inside this action sheet (NEW-002), not as a second sheet.
      for (const id of sessionActionsFor(session, isCurrent)) list.push({ id, label: labels[id], icon: icons[id], destructive: id === 'delete', onSelect: () => void runAction(id),
        view: id === 'notes' ? () => ({ key: 'trail-notes', title: 'Sticky notes', render: (api) => <TrailNotesSheet sessionId={sessionId} api={api} /> })
          : id === 'tags' ? () => ({ key: 'trail-tags', title: 'Tags', render: (api) => <TrailTagsSheet sessionId={sessionId} api={api} /> }) : undefined })
    }
    actions('trail-session-more', session?.name, list)
  }

  const splitHere = useCallback(async (nodeId: string) => {
    if (!sessionId) return
    const name = prompt('Name for the new session (starts at this stop)', '')
    if (name == null) return
    const res = await window.studyTrail.splitSession(sessionId, nodeId, name.trim() || undefined)
    if (res.success && res.id) onOpenSession(res.id)
  }, [sessionId, onOpenSession])

  const body = useMemo(() => {
    if (view === 'threads') return <ThreadsView onOpenSession={onOpenSession} />
    if (view === 'search') return <TrailSearchView onOpenSession={onOpenSession} />
    if (view === 'everything' || !sessionId) {
      return (
        <EverythingView sessions={sessions} zoom={zoom} onZoomChange={setZoom} revisitWindowMs={DEFAULT_REVISIT_WINDOW_MS}
          headerCollapsed={headerCollapsed} onToggleHeaderCollapsed={() => setHeaderCollapsed((c) => !c)} headerPos={null} onHeaderDragStart={() => {}}
          hideHeader emptyHint="No stops yet — every chapter you open in the reader is recorded here." />
      )
    }
    if (!detail) return <div className="mobile-empty">Loading…</div>
    return (
      <MapView detail={detail} onChanged={() => void loadDetail()} scrollKey={sessionId ?? EVERYTHING_SCROLL_KEY}
        zoom={zoom} onZoomChange={setZoom} revisitWindowMs={DEFAULT_REVISIT_WINDOW_MS} topInset={8} onSplitHere={splitHere} />
    )
  }, [view, sessionId, sessions, zoom, headerCollapsed, detail, loadDetail, onOpenSession, splitHere])

  return (
    <Page noScroll title={title} onBack={onBack}
      right={<IconTap icon={MoreHorizontal} label="Session actions" onClick={openMore} />}
      headerBelow={<div className="m-trail-segment"><Segmented value={view} options={VIEW_OPTIONS} onChange={(v) => { void haptic.selection(); setView(v as TrailView) }} /></div>}
    >
      <div className="m-trail-host" data-trail-view={view}>{body}</div>
    </Page>
  )
}
