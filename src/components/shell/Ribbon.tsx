import { useState, useEffect, useRef } from 'react'
import {
  History, Archive, ArchiveRestore, X, Monitor, ScanSearch, ZoomIn, Settings, Search, Sparkles, Volume2, GitBranch,
} from 'lucide-react'
import { useAppStore } from '@/store'
import ZoomMenuRow from './ZoomMenuRow'
import { IconButton, Popover, PopoverTrigger, PopoverSurface, SectionLabel } from '@/components/ui'

/**
 * Workspace-level rail, split out from Sidebar.tsx. Originally this held
 * Scripture/Notes/Lexicon/YouTube space-switcher icons, but that job was
 * redundant with the sidebar's own flat tab list (which already switches
 * space on click) and its new-tab tile row (which starts a fresh tab of a
 * given type) — so the rail dropped space-switching entirely and instead
 * became the single home for every "global, not really per-tab" action
 * that used to be scattered across TopBar's "More" menu and duplicated
 * inside individual panels' own More menus (History, Archived tabs,
 * Presenter view, Find, Zoom). Anything living here must NOT also have a
 * button anywhere else — see the removals in TopBar.tsx/BiblePanel.tsx/
 * BibleRightPanel.tsx/NotesPanel.tsx/LexiconPanel.tsx that accompanied
 * this file's rewrite. Keyboard shortcuts and the command palette entries
 * for these same actions are deliberately left alone — those aren't
 * "buttons," just a separate fast-access surface.
 */
export default function Ribbon() {
  const activeSpace  = useAppStore((s) => s.activeSpace)
  const openSettings = useAppStore((s) => s.openSettings)
  const openSettingsToAbout = useAppStore((s) => s.openSettingsToAbout)
  const updateStatus = useAppStore((s) => s.updateStatus)
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed)
  const openSearch = useAppStore((s) => s.openSearch)

  const openHistory       = useAppStore((s) => s.openHistory)
  const historyCount      = useAppStore((s) => s.history.length)
  const historySeenLength = useAppStore((s) => s.historySeenLength)
  const hasUnseenHistory  = historyCount > historySeenLength

  const archivedGroups         = useAppStore((s) => s.archivedGroups)
  const archiveAllTabs         = useAppStore((s) => s.archiveAllTabs)
  const restoreArchivedGroup   = useAppStore((s) => s.restoreArchivedGroup)
  const dismissArchivedGroup   = useAppStore((s) => s.dismissArchivedGroup)
  const clearAllArchivedGroups = useAppStore((s) => s.clearAllArchivedGroups)
  const [archiveOpen, setArchiveOpen] = useState(false)

  const viewerWindowOpen       = useAppStore((s) => s.viewerWindowOpen)
  const setViewerWindowOpen    = useAppStore((s) => s.setViewerWindowOpen)
  const bumpPresenterPushToken = useAppStore((s) => s.bumpPresenterPushToken)

  const openFindBar = useAppStore((s) => s.openFindBar)
  const setActivePanelId = useAppStore((s) => s.setActivePanelId)

  const aiLookupPanelOpen = useAppStore((s) => s.aiLookupPanelOpen)
  const setAiLookupPanelOpen = useAppStore((s) => s.setAiLookupPanelOpen)

  // ── Read Aloud (TTS) global toggle ──────────────────────────────────────────
  const audioPlayback = useAppStore((s) => s.audioPlayback)
  const startPlaybackFrom = useAppStore((s) => s.startPlaybackFrom)
  const togglePlayPause = useAppStore((s) => s.togglePlayPause)
  const scriptureTabs = useAppStore((s) => s.tabs.scripture)
  const scriptureActiveTabId = useAppStore((s) => s.activeTabId.scripture)
  // A session already playing can always be paused/resumed from anywhere (it's a global
  // player, background playback is the whole point) — but STARTING a fresh read only makes
  // sense while actually looking at Scripture. From Notes/Lexicon/YouTube/Search there's no
  // "current verse" a click here could plausibly mean, so the icon simply does nothing there.
  const canStartReadAloud = activeSpace === 'scripture'
  function handleReadAloudClick() {
    if (audioPlayback) { togglePlayPause(); return }
    if (!canStartReadAloud) return
    const activeTab = scriptureTabs.find((t) => t.id === scriptureActiveTabId)
    const state = activeTab?.state as import('@/types').BibleTabState | undefined
    if (!state) return // no scripture tab open — nothing to read
    const textId = (state.translation ?? 'KJVA').toLowerCase()
    startPlaybackFrom(state.bookId, state.chapter, state.targetVerse ?? 1, textId)
  }

  const [zoomPopoverOpen, setZoomPopoverOpen] = useState(false)
  // Hover-to-open/close for the zoom popover — same timing as TopBar.tsx's nav dropdown and
  // HeaderOverflowMenu.tsx's "..." menu (350ms open delay, 320ms close delay). Click still works
  // as an instant toggle via the trigger's own onClick below.
  const zoomOpenTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const zoomCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function openZoomOnHover() {
    if (zoomCloseTimer.current) { clearTimeout(zoomCloseTimer.current); zoomCloseTimer.current = null }
    if (zoomOpenTimer.current) clearTimeout(zoomOpenTimer.current)
    zoomOpenTimer.current = setTimeout(() => setZoomPopoverOpen(true), 350)
  }
  function cancelZoomHoverOpen() {
    if (zoomOpenTimer.current) { clearTimeout(zoomOpenTimer.current); zoomOpenTimer.current = null }
  }
  function scheduleZoomHoverClose() {
    if (zoomCloseTimer.current) clearTimeout(zoomCloseTimer.current)
    zoomCloseTimer.current = setTimeout(() => setZoomPopoverOpen(false), 320)
  }
  function keepZoomHoverOpen() {
    if (zoomCloseTimer.current) { clearTimeout(zoomCloseTimer.current); zoomCloseTimer.current = null }
  }
  useEffect(() => () => {
    if (zoomOpenTimer.current) clearTimeout(zoomOpenTimer.current)
    if (zoomCloseTimer.current) clearTimeout(zoomCloseTimer.current)
  }, [])

  useEffect(() => {
    function onClose() { setArchiveOpen(false); setZoomPopoverOpen(false) }
    window.addEventListener('berean:closeMenus', onClose)
    return () => window.removeEventListener('berean:closeMenus', onClose)
  }, [])

  async function openPresenterView() {
    if (!viewerWindowOpen) {
      await window.app.openViewerWindow?.()
      setViewerWindowOpen(true)
    }
    if (activeSpace === 'scripture') bumpPresenterPushToken()
    else if (activeSpace === 'notes') window.dispatchEvent(new CustomEvent('berean:presenterPushNote'))
    else if (activeSpace === 'lexicon') window.dispatchEvent(new CustomEvent('berean:presenterPushLexicon'))
  }

  function handleFind() {
    if (activeSpace === 'scripture') { setActivePanelId('bible'); openFindBar(true) }
    else if (activeSpace === 'notes') window.dispatchEvent(new CustomEvent('berean:openNotesFindBar'))
    else if (activeSpace === 'lexicon') window.dispatchEvent(new CustomEvent('berean:openLexiconFindBar'))
  }

  const findSupported = activeSpace === 'scripture' || activeSpace === 'notes' || activeSpace === 'lexicon'

  return (
    <div
      className="native-buttons no-drag flex flex-col items-center flex-shrink-0 w-[46px] py-2 gap-1"
      // Was `app-drag-region` when this was a permanently-docked column — now mounted inside
      // FloatingRail.tsx's floating/portaled wrapper, which is deliberately `no-drag` all over
      // (see that file's comment on why: Electron's drag-region hit-testing doesn't reliably
      // follow portaled content's visual bounds, a class of bug this app has hit before).
      // `app-drag-region` on THIS element would win over an ancestor's `no-drag` for its own
      // pixels (region rules follow normal CSS specificity, innermost wins), so it has to be
      // explicitly `no-drag` here too, not just on the wrapper. Background/border now also
      // owned by FloatingRail's own wrapper div instead of duplicated here.
    >
      {/* No traffic-light clearance spacer here — Ribbon sits BELOW ShellHeader.tsx (which
           spans the full window width and owns that clearance), not at the window's own top
           edge. An intermediate version of this file briefly had Ribbon touching y:0 directly
           (before SidebarTopBar.tsx/TopBar.tsx were merged into ShellHeader.tsx) and needed
           its own spacer then; that's no longer true, and re-adding one here would just push
           every icon down by an extra, unneeded 44px under ShellHeader's own 44px. */}

      {/* ── Floating search — only shown when the Explorer (Sidebar.tsx)
           is collapsed, since its own search/location bar normally covers
           this; collapsing the sidebar would otherwise leave no way to
           search or open a new tab without expanding it again. ── */}
      {sidebarCollapsed && (
        <IconButton
          icon={Search}
          label="Search / new tab"
          tooltip={{ shortcut: '⌘T', side: 'right' }}
          size={32}
          onClick={() => openSearch('new')}
        />
      )}

      <IconButton
        icon={History}
        label="History"
        tooltip={{ shortcut: '⌘H', side: 'right' }}
        size={32}
        className="relative"
        onClick={openHistory}
      >
        {hasUnseenHistory && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-accent" />}
      </IconButton>

      {/* ── Archived tabs ── */}
      <Popover open={archiveOpen} onOpenChange={setArchiveOpen}>
        <PopoverTrigger asChild>
          <IconButton
            icon={Archive}
            label={`Archived tabs${archivedGroups.length > 0 ? ` (${archivedGroups.length})` : ''}`}
            tooltip={{ side: 'right' }}
            size={32}
            active={archiveOpen}
            className="relative"
          >
            {archivedGroups.length > 0 && <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-accent opacity-70" />}
          </IconButton>
        </PopoverTrigger>
        <PopoverSurface side="right" align="start" sideOffset={6} innerClassName="w-72 max-h-96 overflow-y-auto py-1">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-separator">
            <SectionLabel>Archived tabs</SectionLabel>
            <button
              onClick={() => { archiveAllTabs(); setArchiveOpen(false) }}
              className="text-caption2 text-text-muted hover:text-text-primary cursor-pointer transition-colors"
            >
              Archive current tabs
            </button>
          </div>
          {archivedGroups.length === 0 && (
            <p className="px-3 py-4 text-footnote text-text-muted text-center">No archived tabs yet</p>
          )}
          {archivedGroups.map(group => (
            <div key={group.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface-hover group">
              <Archive size={11} className="flex-shrink-0 text-text-muted" />
              <div className="flex-1 min-w-0">
                <p className="text-footnote text-text-primary truncate">{group.label}</p>
                <p className="text-micro text-text-muted">
                  {group.tabs.length} tab{group.tabs.length !== 1 ? 's' : ''} · {new Date(group.archivedAt).toLocaleDateString()}
                </p>
              </div>
              <IconButton
                icon={ArchiveRestore}
                label="Restore tabs"
                size={20}
                active
                className="opacity-0 group-hover:opacity-100"
                onClick={() => { restoreArchivedGroup(group.id); setArchiveOpen(false) }}
              />
              <IconButton
                icon={X}
                label="Delete permanently"
                size={20}
                danger
                className="opacity-0 group-hover:opacity-100"
                onClick={() => dismissArchivedGroup(group.id)}
              />
            </div>
          ))}
          {archivedGroups.length > 0 && (
            <div className="px-3 pt-1.5 pb-0.5 border-t border-separator mt-1">
              <button
                onClick={() => { clearAllArchivedGroups(); setArchiveOpen(false) }}
                className="w-full text-caption2 text-text-muted hover:text-destructive cursor-pointer transition-colors text-center py-1"
              >
                Clear all archived tabs
              </button>
            </div>
          )}
        </PopoverSurface>
      </Popover>

      {/* ── Presenter view ── */}
      <IconButton
        icon={Monitor}
        label={viewerWindowOpen ? 'Send to presenter view' : 'Open presenter view'}
        tooltip={{ shortcut: '⌘⇧B', side: 'right' }}
        size={32}
        active={viewerWindowOpen}
        onClick={openPresenterView}
      />

      {/* ── Study Trail ── */}
      <IconButton
        icon={GitBranch}
        label="Study Trail"
        tooltip={{ side: 'right' }}
        size={32}
        onClick={() => window.app.openStudyTrailWindow?.()}
      />

      {/* ── Find ── */}
      <IconButton
        icon={ScanSearch}
        label="Find in panel"
        tooltip={{ shortcut: '⌘F', side: 'right' }}
        size={32}
        disabled={!findSupported}
        onClick={handleFind}
      />

      {/* ── Zoom — one shared value across all reading panes (Scripture,
           Lexicon, side panel); doesn't resize the sidebar/rail/shell. ── */}
      <Popover open={zoomPopoverOpen} onOpenChange={setZoomPopoverOpen}>
        <PopoverTrigger asChild>
          <IconButton
            icon={ZoomIn}
            label="Zoom"
            tooltip={{ side: 'right' }}
            size={32}
            active={zoomPopoverOpen}
            onMouseEnter={openZoomOnHover}
            onMouseLeave={() => { cancelZoomHoverOpen(); scheduleZoomHoverClose() }}
          />
        </PopoverTrigger>
        <PopoverSurface side="right" align="start" sideOffset={6} onMouseEnter={keepZoomHoverOpen} onMouseLeave={scheduleZoomHoverClose}>
          <ZoomMenuRow />
        </PopoverSurface>
      </Popover>

      {/* ── Read Aloud (TTS) ── */}
      <IconButton
        icon={Volume2}
        label={audioPlayback || canStartReadAloud ? 'Read Aloud' : 'Open a Scripture tab to Read Aloud'}
        tooltip={(audioPlayback || canStartReadAloud) ? { shortcut: '⌘⇧R', side: 'right' } : { side: 'right' }}
        size={32}
        active={!!audioPlayback}
        disabled={!audioPlayback && !canStartReadAloud}
        onClick={handleReadAloudClick}
      />

      {/* ── Berean Chat (AI Scripture Lookup) ── */}
      <IconButton
        icon={Sparkles}
        label="Berean Chat"
        tooltip={{ side: 'right' }}
        size={32}
        active={aiLookupPanelOpen}
        onClick={() => setAiLookupPanelOpen(!aiLookupPanelOpen)}
      />

      <IconButton
        icon={Settings}
        label={`Settings${updateStatus.status === 'ready' ? ' — update ready to install' : updateStatus.status === 'available' ? ' — update available' : ''}`}
        tooltip={{ shortcut: '⌘,', side: 'right' }}
        size={32}
        className="relative"
        onClick={(updateStatus.status === 'available' || updateStatus.status === 'ready') ? openSettingsToAbout : openSettings}
      >
        {(updateStatus.status === 'available' || updateStatus.status === 'ready') && (
          <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-accent" />
        )}
      </IconButton>
    </div>
  )
}
