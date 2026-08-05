import { Circle, Clock, CheckCircle2, Video, Archive, type LucideIcon } from 'lucide-react'
import type { NoteStatus } from '@/types'

export interface NoteStatusMeta {
  id: NoteStatus
  label: string
  /** Hex color for the badge/board-column accent — sensible defaults, no Settings UI to
   *  customize yet (per plan, deferred until the user tries the default set). */
  color: string
  icon: LucideIcon
}

// Order here is the canonical display order everywhere: filter chips, board columns,
// the status-picker dropdown.
export const NOTE_STATUSES: NoteStatusMeta[] = [
  { id: 'started',      label: 'Started',      color: '#94a3b8', icon: Circle },      // slate
  { id: 'in-progress',  label: 'In Progress',  color: '#60a5fa', icon: Clock },        // blue
  { id: 'complete',     label: 'Complete',     color: '#4ade80', icon: CheckCircle2 }, // green
  { id: 'make-video',   label: 'Make Video',   color: '#a78bfa', icon: Video },        // violet
  { id: 'archive',      label: 'Archive',      color: '#78716c', icon: Archive },      // muted stone
]

export const NOTE_STATUS_BY_ID: Record<NoteStatus, NoteStatusMeta> =
  Object.fromEntries(NOTE_STATUSES.map((s) => [s.id, s])) as Record<NoteStatus, NoteStatusMeta>

export function noteStatusMeta(status: string | null | undefined): NoteStatusMeta | null {
  if (!status) return null
  return NOTE_STATUS_BY_ID[status as NoteStatus] ?? null
}
