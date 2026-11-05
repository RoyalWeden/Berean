import { BookOpen, NotepadText, BookMarked, Youtube, Search, FileText, Tags, History, Settings as SettingsIcon, CalendarDays, type LucideIcon } from 'lucide-react'
import type { Tab } from '@/types'
import { displayNoteTitle } from '@/lib/noteTitle'

/** Icon + short kind label for a tab. */
export function tabKind(t: Tab): { icon: LucideIcon; label: string } {
  if (t.type === 'bible' && (t.state as { searchMode?: boolean }).searchMode) return { icon: Search, label: 'Scripture Search' }
  if (t.type === 'bible') return { icon: BookOpen, label: (t.state as { compareMode?: boolean }).compareMode ? 'Compare' : 'Scripture' }
  if (t.type === 'pdf') return { icon: FileText, label: 'PDF' }
  if (t.type === 'note') return { icon: NotepadText, label: 'Note' }
  if (t.type === 'tags') return { icon: Tags, label: 'Tags' }
  if (t.type === 'lexicon') return { icon: BookMarked, label: 'Lexicon' }
  if (t.type === 'youtube') return { icon: Youtube, label: 'YouTube' }
  if (t.type === 'history') return { icon: History, label: 'History' }
  if (t.type === 'settings') return { icon: SettingsIcon, label: 'Settings' }
  if (t.type === 'calendar') return { icon: CalendarDays, label: 'Calendar' }
  return { icon: Search, label: 'Search' }
}

export function tabTitle(t: Tab): string {
  // An empty YouTube tab keeps the hosted player's transient "Loading…" title — name it by kind.
  if (t.type === 'youtube' && !(t.state as { videoId?: string | null }).videoId && /^loading/i.test(t.title)) return tabKind(t).label
  // A note tab named after a vault verse note reads "Matthew 5:3", not "Matthew 5.3" (NOTES-REF-001).
  if (t.type === 'note' && t.title) return displayNoteTitle(t.title)
  return t.title || tabKind(t).label
}
