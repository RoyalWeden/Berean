import { useAppStore } from '@/store'

export interface Command {
  id: string
  label: string
  /** Extra fuzzy-match terms beyond the label itself. */
  keywords?: string[]
  shortcut?: string
  run: () => void
}

/**
 * Obsidian-style command palette entries (FloatingSearch's `>` prefix mode).
 * Deliberately reuses the SAME dispatch mechanisms the keyboard shortcuts
 * and native menu already use (`berean:*` custom events for panel-local
 * actions, direct store calls for global ones) rather than inventing a
 * second way to trigger the same behavior — see App.tsx's onMenuAction
 * switch and its global keydown handler for the events these mirror.
 */
export function getCommands(): Command[] {
  const dispatch = (name: string) => window.dispatchEvent(new CustomEvent(name))
  const store = () => useAppStore.getState()

  return [
    { id: 'new-note', label: 'New general note', shortcut: '⌘⇧N', run: () => {
      store().setActiveSpace('notes'); dispatch('berean:newNote')
    } },
    { id: 'new-verse-note', label: 'New verse note', keywords: ['verse note'], shortcut: '⌘⇧V', run: () => dispatch('berean:newVerseNote') },
    { id: 'new-scripture-tab', label: 'New Scripture tab', keywords: ['bible', 'scripture'], run: () => { store().ensureTab('bible'); store().createTab('bible'); store().setActiveSpace('scripture') } },
    { id: 'new-lexicon-tab', label: 'New Lexicon tab', keywords: ['strongs'], run: () => { store().createTab('lexicon'); store().setActiveSpace('lexicon') } },
    { id: 'new-youtube-tab', label: 'New YouTube tab', keywords: ['video'], run: () => { store().createTab('youtube'); store().setActiveSpace('youtube') } },
    { id: 'todays-daily-note', label: "Open today's daily note", keywords: ['daily', 'journal', 'today'], shortcut: '⌘⇧D', run: () => {
      store().setActiveSpace('notes'); dispatch('berean:openDailyNote')
    } },
    { id: 'toggle-strongs', label: "Toggle Strong's numbers", keywords: ['strongs', 'hebrew', 'greek'], shortcut: '⌘G', run: () => dispatch('berean:toggleStrongs') },
    { id: 'compare-verse', label: 'Compare this verse', keywords: ['compare', 'translations'], run: () => dispatch('berean:compareVerse') },
    { id: 'focus-ref-bar', label: 'Focus scripture reference bar', keywords: ['jump', 'go to'], shortcut: '⌘L', run: () => dispatch('berean:focusRefBar') },
    { id: 'prev-chapter', label: 'Previous chapter', run: () => dispatch('berean:prevChapter') },
    { id: 'next-chapter', label: 'Next chapter', run: () => dispatch('berean:nextChapter') },
    { id: 'toggle-markdown', label: 'Toggle Edit / View mode', keywords: ['markdown', 'preview', 'raw'], shortcut: '⌘⇧M', run: () => dispatch('berean:toggleMarkdown') },
    { id: 'insert-timestamp', label: 'Insert YouTube timestamp into note', keywords: ['youtube', 'video', 'time'], shortcut: '⌘⇧L', run: () => dispatch('berean:insertTimestamp') },
    { id: 'toggle-pip', label: 'Toggle YouTube Picture-in-Picture', keywords: ['pip', 'video'], shortcut: '⌘⇧P', run: () => dispatch('berean:togglePiP') },
    { id: 'toggle-sidebar', label: 'Toggle sidebar explorer', keywords: ['explorer', 'collapse', 'expand'], shortcut: '⌘⇧S', run: () => store().toggleSidebar() },
    { id: 'toggle-focus-mode', label: 'Toggle Focus mode', keywords: ['zen', 'distraction free', 'writing'], shortcut: '⌘⇧U', run: () => {
      const s = store()
      const tabId = s.activeTabId[s.activeSpace]
      if (tabId) s.toggleNoteFocusMode(tabId)
    } },
    { id: 'open-history', label: 'Open History', keywords: ['recent', 'visited'], shortcut: '⌘H', run: () => store().openHistory() },
    { id: 'open-settings', label: 'Open Settings', keywords: ['preferences', 'options'], shortcut: '⌘,', run: () => store().openSettings() },
    { id: 'open-markdown-reference', label: 'Markdown reference guide', keywords: ['help', 'formatting', 'syntax'], run: () => store().openMarkdownReference() },
    { id: 'full-text-search', label: 'Full-text search across all texts', keywords: ['search', 'find'], shortcut: '⌘⇧F', run: () => { store().openSearchTab(''); store().setActiveSpace('search') } },
    { id: 'open-presenter', label: 'Open Presenter view', keywords: ['viewer', 'broadcast', 'present'], shortcut: '⌘⇧B', run: async () => {
      if (!store().viewerWindowOpen) {
        await window.app.openViewerWindow?.()
        store().setViewerWindowOpen(true)
      }
    } },
  ]
}

export function filterCommands(commands: Command[], query: string): Command[] {
  const q = query.trim().toLowerCase()
  if (!q) return commands
  return commands.filter((c) =>
    c.label.toLowerCase().includes(q) || (c.keywords ?? []).some((k) => k.toLowerCase().includes(q))
  )
}
