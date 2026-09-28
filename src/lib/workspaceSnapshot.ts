import type { SpaceId, Tab, TabType } from '@/types'

/**
 * Saved-workspace state (the `workspaces.state_json` column) — shared by desktop and iPhone.
 *
 * v1 (before the iPhone migration) stored `{ tabs, activeTabId }` and was never read back:
 * "Load workspace" only restored the panel layout (docs/mobile/implementation-progress.md Q4).
 * v2 adds the unified display order and the session icon, and every reader goes through
 * `parseWorkspaceState`, which accepts v2, v1 and the pre-v9 `NULL` rows (layout-only
 * workspaces) so no existing record is ever lost or rejected.
 */
export const SPACES: SpaceId[] = ['scripture', 'notes', 'lexicon', 'youtube', 'search']
const TAB_TYPES: TabType[] = ['bible', 'note', 'lexicon', 'youtube', 'search', 'pdf', 'tags']

export interface WorkspaceStateV2 {
  v: 2
  tabs: Record<SpaceId, Tab[]>
  activeTabId: Record<SpaceId, string | null>
  /** Unified cross-space tab order (sessionDisplayOrders[currentSessionId]) */
  displayOrder: string[]
  icon?: string
}

export interface ParsedWorkspaceState {
  tabs: Record<SpaceId, Tab[]>
  activeTabId: Record<SpaceId, string | null>
  displayOrder: string[]
  icon?: string
  /** Which format the record was in (for tests / diagnostics). */
  version: 0 | 1 | 2
}

export function emptyTabs(): Record<SpaceId, Tab[]> {
  return { scripture: [], notes: [], lexicon: [], youtube: [], search: [] }
}
export function emptyActive(): Record<SpaceId, string | null> {
  return { scripture: null, notes: null, lexicon: null, youtube: null, search: null }
}

export function buildWorkspaceState(input: {
  tabs: Record<SpaceId, Tab[]>
  activeTabId: Record<SpaceId, string | null>
  displayOrder?: string[]
  icon?: string
}): WorkspaceStateV2 {
  const tabs = emptyTabs()
  for (const sp of SPACES) tabs[sp] = (input.tabs[sp] ?? []).filter(isTabLike)
  const present = new Set(SPACES.flatMap((sp) => tabs[sp].map((t) => t.id)))
  const stored = (input.displayOrder ?? []).filter((id) => present.has(id))
  const seen = new Set(stored)
  const displayOrder = [...stored, ...SPACES.flatMap((sp) => tabs[sp].map((t) => t.id)).filter((id) => !seen.has(id))]
  return { v: 2, tabs, activeTabId: { ...emptyActive(), ...input.activeTabId }, displayOrder, ...(input.icon ? { icon: input.icon } : {}) }
}

function isTabLike(t: unknown): t is Tab {
  if (!t || typeof t !== 'object') return false
  const x = t as Partial<Tab>
  return typeof x.id === 'string' && typeof x.spaceId === 'string' && SPACES.includes(x.spaceId as SpaceId)
    && typeof x.type === 'string' && TAB_TYPES.includes(x.type as TabType) && typeof x.title === 'string' && !!x.state && typeof x.state === 'object'
}

/** Never throws: malformed JSON or unknown shapes degrade to an empty (layout-only) workspace. */
export function parseWorkspaceState(stateJson: string | null | undefined): ParsedWorkspaceState {
  if (!stateJson) return { tabs: emptyTabs(), activeTabId: emptyActive(), displayOrder: [], version: 0 }
  let raw: unknown
  try { raw = JSON.parse(stateJson) } catch { return { tabs: emptyTabs(), activeTabId: emptyActive(), displayOrder: [], version: 0 } }
  if (!raw || typeof raw !== 'object') return { tabs: emptyTabs(), activeTabId: emptyActive(), displayOrder: [], version: 0 }
  const r = raw as Partial<WorkspaceStateV2> & { tabs?: unknown; activeTabId?: unknown }
  const tabs = emptyTabs()
  const src = (r.tabs && typeof r.tabs === 'object' ? r.tabs : {}) as Record<string, unknown>
  for (const sp of SPACES) {
    const list = Array.isArray(src[sp]) ? (src[sp] as unknown[]) : []
    tabs[sp] = list.filter(isTabLike).map((t) => ({ ...t, spaceId: sp }))
  }
  const activeTabId = emptyActive()
  const act = (r.activeTabId && typeof r.activeTabId === 'object' ? r.activeTabId : {}) as Record<string, unknown>
  for (const sp of SPACES) {
    const id = typeof act[sp] === 'string' ? (act[sp] as string) : null
    activeTabId[sp] = id && tabs[sp].some((t) => t.id === id) ? id : (tabs[sp][0]?.id ?? null)
  }
  const present = new Set(SPACES.flatMap((sp) => tabs[sp].map((t) => t.id)))
  const stored = Array.isArray(r.displayOrder) ? (r.displayOrder as unknown[]).filter((id): id is string => typeof id === 'string' && present.has(id)) : []
  const seen = new Set(stored)
  const displayOrder = [...stored, ...SPACES.flatMap((sp) => tabs[sp].map((t) => t.id)).filter((id) => !seen.has(id))]
  const version: 1 | 2 = r.v === 2 ? 2 : 1
  return { tabs, activeTabId, displayOrder, version, ...(typeof r.icon === 'string' ? { icon: r.icon } : {}) }
}

/** The session id a saved workspace opens as (stable, so re-opening switches rather than duplicates). */
export function workspaceSessionId(workspaceId: string): string {
  return `ws:${workspaceId}`
}
