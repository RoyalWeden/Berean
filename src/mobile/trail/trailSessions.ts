import type { TrailSession } from '@/types/studyTrail'
import { LOOSE_SESSION_ID } from '@/store/studyTrailSlice'

/**
 * Pure helpers for the phone's Study Trail pages (R042). Kept free of React and `window.*` so
 * the ordering / labelling rules are unit-testable (src/mobile/__tests__/trail-*.test.tsx).
 */

/** Sessions for the list: the current (live/paused) one first, then hand-placed order, then
 *  most recently updated. The implicit loose bucket never appears as a row. */
export function orderSessionsForPhone(sessions: TrailSession[], currentId: string | null): TrailSession[] {
  const rows = sessions.filter((s) => s.id !== LOOSE_SESSION_ID)
  return [...rows].sort((a, b) => {
    const aCur = a.id === currentId ? 1 : 0
    const bCur = b.id === currentId ? 1 : 0
    if (aCur !== bCur) return bCur - aCur
    const aLive = a.status === 'live' || a.status === 'paused' ? 1 : 0
    const bLive = b.status === 'live' || b.status === 'paused' ? 1 : 0
    if (aLive !== bLive) return bLive - aLive
    const aSort = a.sortOrder, bSort = b.sortOrder
    if (aSort != null && bSort != null && aSort !== bSort) return aSort - bSort
    if (aSort != null && bSort == null) return -1
    if (aSort == null && bSort != null) return 1
    return b.updatedAt - a.updatedAt
  })
}

export function statusLabel(status: TrailSession['status']): string {
  return status === 'live' ? 'Live' : status === 'paused' ? 'Paused' : 'Ended'
}

/** "Live · 3 stops · 2h ago" — the row subtitle. `stops` undefined while the count is loading. */
export function sessionSubtitle(session: TrailSession, stops: number | undefined, now = Date.now()): string {
  const parts = [statusLabel(session.status)]
  if (stops != null) parts.push(`${stops} stop${stops === 1 ? '' : 's'}`)
  parts.push(relativeTime(session.updatedAt, now))
  if (session.possiblyAccidental) parts.push('possibly accidental')
  return parts.join(' · ')
}

export function relativeTime(ms: number, now = Date.now()): string {
  const diff = now - ms
  const min = diff / 60_000
  if (min < 1) return 'just now'
  if (min < 60) return `${Math.round(min)}m ago`
  const hr = min / 60
  if (hr < 24) return `${Math.round(hr)}h ago`
  const d = new Date(ms)
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  return d.toLocaleDateString([], sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Which session actions the phone offers, derived from the session's status and whether it is
 *  the one this device is recording into. Mirrors what the desktop rail's row / context menu can do. */
export type SessionActionId = 'resume' | 'pause' | 'end' | 'rename' | 'recap' | 'tags' | 'notes' | 'delete'
export function sessionActionsFor(session: TrailSession, isCurrent: boolean): SessionActionId[] {
  const out: SessionActionId[] = []
  if (session.status === 'live' && isCurrent) out.push('pause')
  else out.push('resume')
  if (session.status !== 'ended') out.push('end')
  out.push('rename', 'recap', 'tags', 'notes', 'delete')
  return out
}
