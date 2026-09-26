import { BookOpen, NotepadText, CalendarDays, BookMarked, Youtube, Search, History, Settings, Columns2, FileText, Tags, type LucideIcon } from 'lucide-react'
import { useAppStore } from '@/store'
import type { BibleTabState, Tab, TabType } from '@/types'
import { makeCompareTab, makeCompareTabState } from '../reader/compareState'

/**
 * The major experiences a tab can be (TEST25-NAV-001) — one vocabulary for the top-left tab-type
 * switcher, the caret's "Go to" row, the plus sheet's destination row and typed commands in both
 * searches ("notes", "strong's", "today" …).
 *
 * The set: Scripture, Notes, Today, Lexicon, YouTube, Search, History, Settings. Compare is a
 * Scripture MODE (a Scripture tab with compare columns), so it is not a switcher option — but it is
 * a typed command. PDFs and the Tags graph are not standalone destinations (a PDF needs a document
 * from the library; Tags opens from More / a tag), so they have icons but are never offered.
 *
 *   target 'current-tab' → the current tab CHANGES into the experience (store.transformTab);
 *   target 'new-tab'     → a new tab (History / Settings focus their tab, as elsewhere).
 */
export type ExperienceId = 'scripture' | 'notes' | 'today' | 'lexicon' | 'youtube' | 'search' | 'history' | 'settings' | 'compare'

export interface Experience { id: ExperienceId; label: string; icon: LucideIcon; tabType: TabType }

export const EXPERIENCES: Record<ExperienceId, Experience> = {
  scripture: { id: 'scripture', label: 'Scripture', icon: BookOpen, tabType: 'bible' },
  notes: { id: 'notes', label: 'Notes', icon: NotepadText, tabType: 'note' },
  today: { id: 'today', label: 'Today', icon: CalendarDays, tabType: 'note' },
  lexicon: { id: 'lexicon', label: 'Lexicon', icon: BookMarked, tabType: 'lexicon' },
  youtube: { id: 'youtube', label: 'YouTube', icon: Youtube, tabType: 'youtube' },
  search: { id: 'search', label: 'Search', icon: Search, tabType: 'search' },
  history: { id: 'history', label: 'History', icon: History, tabType: 'history' },
  settings: { id: 'settings', label: 'Settings', icon: Settings, tabType: 'settings' },
  compare: { id: 'compare', label: 'Compare', icon: Columns2, tabType: 'bible' },
}

/** The switcher / "Go to" rows, in this order. */
export const SWITCHER_EXPERIENCES: ExperienceId[] = ['scripture', 'notes', 'today', 'lexicon', 'youtube', 'search', 'history', 'settings']

/** What experience a tab is (null for PDF / Tags, which are not destinations of their own). */
export function experienceOfTab(tab: Pick<Tab, 'type' | 'state'> | null | undefined): ExperienceId | null {
  if (!tab) return null
  switch (tab.type) {
    case 'bible': return (tab.state as { compareMode?: boolean }).compareMode ? 'compare' : 'scripture'
    case 'note': return 'notes'
    case 'lexicon': return 'lexicon'
    case 'youtube': return 'youtube'
    case 'search': return 'search'
    case 'history': return 'history'
    case 'settings': return 'settings'
    default: return null
  }
}

/** The icon + name for the current tab (the switcher's closed state). */
export function tabTypeFace(tab: Pick<Tab, 'type' | 'state'> | null | undefined): { label: string; icon: LucideIcon } {
  if (tab?.type === 'pdf') return { label: 'PDF', icon: FileText }
  if (tab?.type === 'tags') return { label: 'Tags', icon: Tags }
  const e = experienceOfTab(tab)
  return e ? EXPERIENCES[e] : EXPERIENCES.scripture
}

/** The experiences to offer from a tab: every switcher experience except the one it already is
 *  (Today stays — it opens today's note even from a Notes tab; a Compare tab offers Scripture). */
export function otherExperiences(tab: Pick<Tab, 'type' | 'state'> | null | undefined): ExperienceId[] {
  const cur = experienceOfTab(tab)
  return SWITCHER_EXPERIENCES.filter((e) => e !== cur)
}

/** Typed commands: keyword → experience. A query matches when it is a prefix (≥ 2 letters) of a
 *  keyword, case-insensitively. */
const KEYWORDS: Array<[string, ExperienceId]> = [
  ['scripture', 'scripture'], ['bible', 'scripture'],
  ['notes', 'notes'], ['note', 'notes'],
  ['today', 'today'], ['daily', 'today'], ['daily note', 'today'],
  ['lexicon', 'lexicon'], ["strong's", 'lexicon'], ['strongs', 'lexicon'],
  ['youtube', 'youtube'], ['videos', 'youtube'], ['video', 'youtube'],
  ['history', 'history'],
  ['settings', 'settings'],
  ['search', 'search'],
  ['compare', 'compare'],
]

export function matchExperiences(query: string): ExperienceId[] {
  const q = query.trim().toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ')
  if (q.length < 2) return []
  const out: ExperienceId[] = []
  for (const [k, e] of KEYWORDS) if (k.startsWith(q) && !out.includes(e)) out.push(e)
  return out
}

function activeTabOf(s = useAppStore.getState()): Tab | null {
  return s.tabs[s.activeSpace]?.find((t) => t.id === s.activeTabId[s.activeSpace]) ?? null
}

/** The Scripture state Compare starts from: this tab when it is Scripture, else the active Scripture tab. */
function scriptureStateFor(tab: Tab | null): BibleTabState | null {
  if (tab?.type === 'bible') return tab.state as BibleTabState
  const s = useAppStore.getState()
  const sc = s.tabs.scripture.find((t) => t.id === s.activeTabId.scripture && t.type === 'bible')
  return (sc?.state as BibleTabState | undefined) ?? null
}

/** Go to an experience: change the current tab into it, or open it in a new tab. */
export function runExperience(id: ExperienceId, target: 'current-tab' | 'new-tab'): void {
  const s = useAppStore.getState()
  const cur = activeTabOf(s)
  if (target === 'current-tab' && cur) {
    if (id === 'compare') {
      const st = scriptureStateFor(cur)
      const patch = st ? makeCompareTabState(st) : { compareMode: true }
      s.transformTab(cur.id, 'bible', { state: patch as Record<string, unknown> })
      return
    }
    // Scripture from a Compare tab leaves Compare (same tab).
    if (id === 'scripture' && cur.type === 'bible') { s.updateTabState('scripture', cur.id, { compareMode: false }); return }
    s.transformTab(cur.id, EXPERIENCES[id].tabType)
    if (id === 'today') useAppStore.getState().requestDailyNote()
    return
  }
  switch (id) {
    case 'today': s.requestDailyNote(); return
    case 'history': case 'settings': s.ensureTab(id); return
    case 'compare': {
      const st = scriptureStateFor(cur)
      if (st) s.addTab(makeCompareTab(st))
      else {
        s.createTab('bible')
        const n = activeTabOf()
        if (n?.type === 'bible') useAppStore.getState().updateTabState('scripture', n.id, makeCompareTabState(n.state as BibleTabState))
      }
      return
    }
    default: s.createTab(EXPERIENCES[id].tabType)
  }
}
