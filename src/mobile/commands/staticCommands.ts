import { Hash, Copy, Search, Plus, Settings as SettingsIcon, Download, Library, NotepadText, BookOpen, ArrowLeft } from 'lucide-react'
import { useAppStore } from '@/store'
import type { SpaceId, Tab } from '@/types'
import { buildLexiconCopyText } from '@/components/lexicon/LexiconPanel'
import type { CaretScope } from './caretRegistry'
import { createElement } from 'react'
import { CaretGoTo } from './CaretGoTo'
import { openDestination } from '@/lib/navigation/destination'

/** The caret header every tab shares (SEP25): a ⌘L-style go-to for the current tab + ‹ ›. */
function goToLocation(label: string): NonNullable<CaretScope['location']> {
  return { label, placeholder: 'Search Berean', view: () => ({ title: 'Search', render: (api) => createElement(CaretGoTo, { api }) }) }
}

/** Destinations the static providers can reach without importing pages (supplied by the shell). */
export type MoreRoute = 'more' | 'settings' | 'history' | 'workspaces' | 'archive' | 'transcripts' | 'youtube-settings' | 'trail' | 'queue' | 'pdfs'
export interface ShellNav { openMore: (route: MoreRoute) => void }

/**
 * Caret commands for tab types whose page does not register its own (the desktop panels hosted on
 * the phone: Lexicon, YouTube, PDF, the tags graph). One provider per tab type — the registry
 * (caretRegistry.ts) prefers a page's own registration whenever one is mounted.
 */
export function staticCaretScope(space: SpaceId, tab: Tab | null, shell: ShellNav): CaretScope {
  const st = () => useAppStore.getState()
  if (space === 'lexicon') {
    const num = (tab?.state as { strongsNum?: string } | undefined)?.strongsNum ?? null
    return {
      title: num ? `Lexicon · ${num}` : 'Lexicon',
      location: goToLocation(num ? `Lexicon · ${num}` : 'Lexicon'),
      sections: [
        { id: 'quick', style: 'tiles', commands: [
          { kind: 'action', id: 'open-num', label: "Open number", icon: Hash, run: () => { const n = prompt("Strong's number (e.g. H7225, G3056)")?.trim().toUpperCase(); if (n) st().openLexiconEntry(n) } },
          { kind: 'action', id: 'copy', label: 'Copy entry', icon: Copy, disabled: !num, run: () => { if (num) void window.lexicon.getEntry(num).then((e) => { if (e) void navigator.clipboard.writeText(buildLexiconCopyText(e)) }) } },
          { kind: 'action', id: 'search', label: 'In Scripture', icon: Search, disabled: !num, run: () => { if (num) openDestination({ kind: 'search', query: num, scope: 'scripture' }, 'current-tab') } },
        ] },
        { id: 'tabs', title: 'Lexicon', commands: [
          { kind: 'action', id: 'copy-num', label: "Copy Strong's number", icon: Hash, disabled: !num, run: () => { if (num) void navigator.clipboard.writeText(num) } },
          { kind: 'action', id: 'new', label: 'New lexicon tab', icon: Plus, run: () => { st().createTab('lexicon'); st().setActiveSpace('lexicon') } },
        ] },
      ],
    }
  }
  if (space === 'youtube') {
    return {
      title: 'YouTube',
      location: goToLocation(tab?.title || 'YouTube'),
      sections: [
        { id: 'yt', title: 'YouTube', commands: [
          { kind: 'action', id: 'settings', label: 'YouTube settings', detail: 'Channels, playback, transcripts', icon: SettingsIcon, run: () => shell.openMore('youtube-settings') },
          { kind: 'action', id: 'packs', label: 'Transcript packs', detail: 'Download channel transcripts for offline search', icon: Download, run: () => shell.openMore('transcripts') },
          { kind: 'action', id: 'new', label: 'New YouTube tab', icon: Plus, run: () => { st().createTab('youtube'); st().setActiveSpace('youtube') } },
        ] },
      ],
    }
  }
  if (space === 'scripture' && tab?.type === 'pdf') {
    return {
      title: tab.title || 'PDF',
      location: goToLocation(tab.title || 'PDF'),
      sections: [
        { id: 'pdf', title: 'PDF', commands: [
          { kind: 'action', id: 'library', label: 'PDF library', icon: Library, run: () => shell.openMore('pdfs') },
          { kind: 'action', id: 'scripture', label: 'New Scripture tab', icon: BookOpen, run: () => { st().createTab('bible'); st().setActiveSpace('scripture') } },
        ] },
      ],
    }
  }
  if (space === 'notes' && tab?.type === 'tags') {
    return {
      title: 'Verse tags',
      location: goToLocation('Verse tags'),
      sections: [
        { id: 'tags', title: 'Tags', commands: [
          { kind: 'action', id: 'notes', label: 'Back to notes', icon: ArrowLeft, run: () => { const s = st(); const other = s.tabs.notes.find((t) => t.type !== 'tags'); if (other) s.setActiveTab('notes', other.id); else s.createTab('note') } },
          { kind: 'action', id: 'new-note', label: 'New note', icon: NotepadText, run: () => { st().createTab('note'); st().setActiveSpace('notes') } },
        ] },
      ],
    }
  }
  return { title: 'Actions', location: goToLocation(tab?.title || 'Berean'), sections: [{ id: 'nav', commands: [{ kind: 'action', id: 'more', label: 'More', icon: SettingsIcon, run: () => shell.openMore('more') }] }] }
}
