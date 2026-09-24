import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, Route, Radio } from 'lucide-react'
import { useStudyTrailStore, installStudyTrailStateSync } from '@/store/studyTrailSlice'
import type { TrailSession } from '@/types/studyTrail'
import type { SpaceId } from '@/types'
import { Page, ListSection, Row, IconTap } from '../primitives/Page'
import { useNavigation } from '../navigation/NavigationStack'
import { useActionSheet, type SheetAction } from '../primitives/ActionSheet'
import { useSheets } from '../primitives/Sheet'
import { haptic } from '../primitives/haptics'
import { TrailSessionPage } from './TrailSessionPage'
import { TrailNotesSheet } from './TrailNotesSheet'
import { TrailTagsSheet } from './TrailTagsSheet'
import { orderSessionsForPhone, sessionSubtitle, sessionActionsFor, type SessionActionId } from './trailSessions'
import { useTrailNavigatorOnPhone } from './trailPhoneNav'
import './trail.css'

/**
 * Study Trail root page (R042): every session (the one this device records into first), the
 * merged Everything timeline, and a "+" that starts a named session — the same
 * `useStudyTrailStore` actions and `window.studyTrail.*` calls StudyTrailApp uses in the Mac's
 * separate window. Selecting a session pushes TrailSessionPage (Map / Threads / Everything /
 * Search). While this page is mounted the shared trail views' taps open the reader (trailPhoneNav).
 */
export function StudyTrailPage({ onBack, onOpenSpace }: { onBack: () => void; onOpenSpace?: (space: SpaceId) => void }) {
  const nav = useNavigation()
  const sheets = useSheets()
  const actions = useActionSheet()
  const [sessions, setSessions] = useState<TrailSession[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const countsRef = useRef<Record<string, number>>({})
  const currentTrailSessionId = useStudyTrailStore((s) => s.currentTrailSessionId)
  const trailSessionStatus = useStudyTrailStore((s) => s.trailSessionStatus)
  useTrailNavigatorOnPhone(onOpenSpace)
  useEffect(() => { installStudyTrailStateSync() }, [])

  const refresh = useCallback(async () => {
    const rows = await window.studyTrail.listSessions().catch(() => [] as TrailSession[])
    setSessions(rows)
    // Stop counts are not on the session row — fetch each detail once per updatedAt.
    const next: Record<string, number> = {}
    await Promise.all(rows.slice(0, 60).map(async (r) => {
      const key = `${r.id}:${r.updatedAt}`
      if (countsRef.current[key] != null) { next[key] = countsRef.current[key]; return }
      const d = await window.studyTrail.getSession(r.id).catch(() => null)
      if (d) next[key] = d.nodes.length
    }))
    countsRef.current = next
    setCounts(next)
  }, [])
  useEffect(() => {
    void refresh()
    const interval = setInterval(() => void refresh(), 4000)
    const unsub = window.studyTrail.onDataChanged(() => void refresh())
    return () => { clearInterval(interval); unsub?.() }
  }, [refresh])

  const openSession = useCallback((id: string | null) => {
    void haptic.light()
    nav.push(`trail-session-${id ?? 'everything'}`, (
      <TrailSessionPage sessionId={id} onBack={nav.pop} onOpenSession={(other) => openSession(other)} />
    ))
  }, [nav])

  const newSession = async () => {
    const name = prompt('Session name', '')
    if (!name?.trim()) return
    await useStudyTrailStore.getState().startTrailSession(name.trim())
    void haptic.success()
    await refresh()
  }

  const runAction = async (s: TrailSession, id: SessionActionId) => {
    const st = useStudyTrailStore.getState()
    const isCurrent = s.id === currentTrailSessionId
    switch (id) {
      case 'resume': isCurrent && s.status === 'paused' ? await st.resumeTrailSession() : await st.activateExistingSession(s.id); break
      case 'pause': await st.pauseTrailSession(); break
      case 'end': isCurrent ? await st.endTrailSession() : await window.studyTrail.endSession(s.id); break
      case 'rename': { const n = prompt('Session name', s.name); if (n?.trim()) await window.studyTrail.renameSession(s.id, n.trim()); break }
      case 'recap': { const r = prompt('Recap', s.recapText ?? ''); if (r != null) await window.studyTrail.updateRecap(s.id, r); break }
      case 'notes': sheets.open({ id: 'trail-notes', title: 'Sticky notes', detents: [0.6, 0.92], render: (api) => <TrailNotesSheet sessionId={s.id} api={api} /> }); return
      case 'tags': sheets.open({ id: 'trail-tags', title: 'Tags', detents: [0.6, 0.92], render: (api) => <TrailTagsSheet sessionId={s.id} api={api} /> }); return
      case 'delete': if (confirm(`Delete "${s.name}" and its stops?`)) await st.deleteTrailSession(s.id); break
    }
    void haptic.light()
    await refresh()
  }
  const openActions = (s: TrailSession) => {
    const isCurrent = s.id === currentTrailSessionId
    const labels: Record<SessionActionId, string> = { resume: isCurrent && s.status === 'paused' ? 'Resume recording' : 'Record into this session', pause: 'Pause recording', end: 'End session', rename: 'Rename…', recap: 'Recap…', tags: 'Tags…', notes: 'Sticky notes…', delete: 'Delete session' }
    // Sticky notes / Tags open inside this action sheet (NEW-002), not as a second sheet.
    const list: SheetAction[] = sessionActionsFor(s, isCurrent).map((id) => ({ id, label: labels[id], destructive: id === 'delete', onSelect: () => void runAction(s, id),
      view: id === 'notes' ? () => ({ key: 'trail-notes', title: 'Sticky notes', render: (api) => <TrailNotesSheet sessionId={s.id} api={api} /> })
        : id === 'tags' ? () => ({ key: 'trail-tags', title: 'Tags', render: (api) => <TrailTagsSheet sessionId={s.id} api={api} /> }) : undefined }))
    actions('trail-session-actions', s.name, list)
  }

  const ordered = orderSessionsForPhone(sessions, currentTrailSessionId)
  const current = ordered.find((s) => s.id === currentTrailSessionId) ?? null
  const rest = ordered.filter((s) => s.id !== current?.id)

  return (
    <Page title="Study trail" onBack={onBack} right={<IconTap icon={Plus} label="New session" onClick={() => void newSession()} />}>
      <ListSection>
        <Row leading={<Route size={20} aria-hidden />} title="Everything" subtitle="Every stop, across all sessions" chevron onClick={() => openSession(null)} />
      </ListSection>
      {current && (
        <ListSection title={trailSessionStatus === 'paused' ? 'Paused' : 'Recording'}>
          <SessionRow s={current} stops={counts[`${current.id}:${current.updatedAt}`]} live onOpen={() => openSession(current.id)} onActions={() => openActions(current)} />
        </ListSection>
      )}
      <ListSection title="Sessions">
        {rest.length === 0 && !current && <div className="mobile-empty">No sessions yet. Reading is recorded into Everything; tap + to name a session.</div>}
        {rest.map((s) => <SessionRow key={s.id} s={s} stops={counts[`${s.id}:${s.updatedAt}`]} onOpen={() => openSession(s.id)} onActions={() => openActions(s)} />)}
      </ListSection>
    </Page>
  )
}

function SessionRow({ s, stops, live, onOpen, onActions }: { s: TrailSession; stops: number | undefined; live?: boolean; onOpen: () => void; onActions: () => void }) {
  return (
    <Row
      leading={live ? <Radio size={20} aria-hidden className="m-trail-live-icon" /> : <span className={`m-trail-status is-${s.status}`} aria-hidden />}
      title={s.name}
      subtitle={sessionSubtitle(s, stops)}
      right={<button type="button" className="mobile-icon-tap" aria-label={`Actions for ${s.name}`} onClick={(e) => { e.stopPropagation(); onActions() }}>…</button>}
      chevron
      onClick={onOpen}
    />
  )
}
