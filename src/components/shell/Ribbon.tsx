import * as Tooltip from '@radix-ui/react-tooltip'
import * as Popover from '@radix-ui/react-popover'
import { useState, useEffect, useRef } from 'react'
import {
  History, Archive, ArchiveRestore, X, Monitor, ScanSearch, ZoomIn, Settings, Search,
} from 'lucide-react'
import { useAppStore } from '@/store'
import ZoomMenuRow from './ZoomMenuRow'

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
    // disableHoverableContent: none of this rail's tooltips have interactive
    // content, so the "hoverable content" grace area Radix keeps open between
    // trigger and tooltip (to let you move the pointer onto the tooltip
    // itself) serves no purpose here — it was overlapping and swallowing
    // clicks on nearby menus/popovers (the session icon-picker grid, and
    // potentially anything else that opens near a chip or the "+" button)
    // since that invisible polygon stays interactive until the pointer fully
    // clears it, independent of any per-menu open-state we control.
    <Tooltip.Provider delayDuration={200} disableHoverableContent>
      <div
        className={`
          app-drag-region flex flex-col items-center flex-shrink-0 h-full w-[46px] py-2 gap-1
          ${window.__berean_platform === 'darwin' ? 'sidebar-vibrant' : 'bg-[rgb(var(--color-surface-3))]'}
          border-r border-[rgb(var(--color-surface-4))]
        `}
      >
        {/* ── Floating search — only shown when the Explorer (Sidebar.tsx)
             is collapsed, since its own search/location bar normally covers
             this; collapsing the sidebar would otherwise leave no way to
             search or open a new tab without expanding it again. ── */}
        {sidebarCollapsed && (
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <button
                onClick={() => openSearch('new')}
                className="no-drag flex items-center justify-center w-8 h-8 rounded-shell text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
              >
                <Search size={16} />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content side="right" sideOffset={8} className="z-50 px-2 py-1 rounded text-xs bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] shadow-lg">
                Search / new tab
                <kbd className="ml-2 font-mono text-[10px] px-1 py-0.5 rounded bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))]">⌘T</kbd>
                <Tooltip.Arrow className="fill-[rgb(var(--color-surface-4))]" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        )}
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              onClick={openHistory}
              className="no-drag relative flex items-center justify-center w-8 h-8 rounded-shell text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
            >
              <History size={16} />
              {hasUnseenHistory && (
                <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[rgb(var(--color-accent))]" />
              )}
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content side="right" sideOffset={8} className="z-50 px-2 py-1 rounded text-xs bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] shadow-lg">
              History
              <kbd className="ml-2 font-mono text-[10px] px-1 py-0.5 rounded bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))]">⌘H</kbd>
              <Tooltip.Arrow className="fill-[rgb(var(--color-surface-4))]" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>

        {/* ── Archived tabs ── */}
        <Popover.Root open={archiveOpen} onOpenChange={setArchiveOpen}>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Popover.Trigger asChild>
                <button
                  className={`no-drag relative flex items-center justify-center w-8 h-8 rounded-shell transition-colors cursor-pointer ${
                    archiveOpen ? 'bg-[rgb(var(--color-accent))/16] text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))]'
                  }`}
                >
                  <Archive size={16} />
                  {archivedGroups.length > 0 && (
                    <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[rgb(var(--color-accent))] opacity-70" />
                  )}
                </button>
              </Popover.Trigger>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content side="right" sideOffset={8} className="z-50 px-2 py-1 rounded text-xs bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] shadow-lg">
                Archived tabs{archivedGroups.length > 0 ? ` (${archivedGroups.length})` : ''}
                <Tooltip.Arrow className="fill-[rgb(var(--color-surface-4))]" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
          <Popover.Portal>
            <Popover.Content
              side="right"
              align="start"
              sideOffset={6}
              className="no-drag z-[9999] w-72 max-h-96 overflow-y-auto rounded-shell-lg shadow-2xl border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-1))] py-1"
            >
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-[rgb(var(--color-surface-4))]">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-[rgb(var(--color-text-muted))]">Archived tabs</span>
                <button
                  onClick={() => { archiveAllTabs(); setArchiveOpen(false) }}
                  className="text-[10px] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer transition-colors"
                >
                  Archive current tabs
                </button>
              </div>
              {archivedGroups.length === 0 && (
                <p className="px-3 py-4 text-xs text-[rgb(var(--color-text-muted))] text-center">No archived tabs yet</p>
              )}
              {archivedGroups.map(group => (
                <div key={group.id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-[rgb(var(--color-surface-3))] group">
                  <Archive size={11} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-[rgb(var(--color-text-primary))] truncate">{group.label}</p>
                    <p className="text-[9px] text-[rgb(var(--color-text-muted))]">
                      {group.tabs.length} tab{group.tabs.length !== 1 ? 's' : ''} · {new Date(group.archivedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <button
                    onClick={() => { restoreArchivedGroup(group.id); setArchiveOpen(false) }}
                    title="Restore tabs"
                    className="p-0.5 rounded opacity-0 group-hover:opacity-100 text-[rgb(var(--color-accent))] hover:bg-[rgb(var(--color-surface-4))] cursor-pointer transition-all"
                  >
                    <ArchiveRestore size={12} />
                  </button>
                  <button
                    onClick={() => dismissArchivedGroup(group.id)}
                    title="Delete permanently"
                    className="p-0.5 rounded opacity-0 group-hover:opacity-100 text-[rgb(var(--color-text-muted))] hover:text-red-400 hover:bg-[rgb(var(--color-surface-4))] cursor-pointer transition-all"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              {archivedGroups.length > 0 && (
                <div className="px-3 pt-1.5 pb-0.5 border-t border-[rgb(var(--color-surface-4))] mt-1">
                  <button
                    onClick={() => { clearAllArchivedGroups(); setArchiveOpen(false) }}
                    className="w-full text-[10px] text-[rgb(var(--color-text-muted))] hover:text-red-400 cursor-pointer transition-colors text-center py-1"
                  >
                    Clear all archived tabs
                  </button>
                </div>
              )}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

        {/* ── Presenter view ── */}
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              onClick={openPresenterView}
              className={`no-drag flex items-center justify-center w-8 h-8 rounded-shell transition-colors cursor-pointer ${
                viewerWindowOpen ? 'bg-[rgb(var(--color-accent))/16] text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))]'
              }`}
            >
              <Monitor size={16} />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content side="right" sideOffset={8} className="z-50 px-2 py-1 rounded text-xs bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] shadow-lg">
              {viewerWindowOpen ? 'Send to presenter view' : 'Open presenter view'}
              <kbd className="ml-2 font-mono text-[10px] px-1 py-0.5 rounded bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))]">⌘⇧B</kbd>
              <Tooltip.Arrow className="fill-[rgb(var(--color-surface-4))]" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>

        {/* ── Find ── */}
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              onClick={handleFind}
              disabled={!findSupported}
              className={`no-drag flex items-center justify-center w-8 h-8 rounded-shell transition-colors ${
                findSupported
                  ? 'cursor-pointer text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))]'
                  : 'cursor-not-allowed text-[rgb(var(--color-text-muted))] opacity-30'
              }`}
            >
              <ScanSearch size={16} />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content side="right" sideOffset={8} className="z-50 px-2 py-1 rounded text-xs bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] shadow-lg">
              Find in panel
              <kbd className="ml-2 font-mono text-[10px] px-1 py-0.5 rounded bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))]">⌘F</kbd>
              <Tooltip.Arrow className="fill-[rgb(var(--color-surface-4))]" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>

        {/* ── Zoom — one shared value across all reading panes (Scripture,
             Lexicon, side panel); doesn't resize the sidebar/rail/shell. ── */}
        <Popover.Root open={zoomPopoverOpen} onOpenChange={setZoomPopoverOpen}>
          <Tooltip.Root>
            <Tooltip.Trigger asChild>
              <Popover.Trigger asChild>
                <button
                  onMouseEnter={openZoomOnHover}
                  onMouseLeave={() => { cancelZoomHoverOpen(); scheduleZoomHoverClose() }}
                  className={`no-drag flex items-center justify-center w-8 h-8 rounded-shell transition-colors cursor-pointer ${
                    zoomPopoverOpen
                      ? 'bg-[rgb(var(--color-accent))/16] text-[rgb(var(--color-accent))]'
                      : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))]'
                  }`}
                >
                  <ZoomIn size={16} />
                </button>
              </Popover.Trigger>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content side="right" sideOffset={8} className="z-50 px-2 py-1 rounded text-xs bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] shadow-lg">
                Zoom
                <Tooltip.Arrow className="fill-[rgb(var(--color-surface-4))]" />
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
          <Popover.Portal>
            <Popover.Content
              side="right"
              align="start"
              sideOffset={6}
              onMouseEnter={keepZoomHoverOpen}
              onMouseLeave={scheduleZoomHoverClose}
              className="no-drag z-[9999] rounded-shell-lg shadow-2xl border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-1))]"
            >
              <ZoomMenuRow />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

        <div className="flex-1" />

        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              onClick={(updateStatus.status === 'available' || updateStatus.status === 'ready') ? openSettingsToAbout : openSettings}
              className="no-drag relative flex items-center justify-center w-8 h-8 rounded-shell text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
            >
              <Settings size={16} />
              {(updateStatus.status === 'available' || updateStatus.status === 'ready') && (
                <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[rgb(var(--color-accent))]" />
              )}
            </button>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content side="right" sideOffset={8} className="z-50 px-2 py-1 rounded text-xs bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] shadow-lg">
              Settings
              {updateStatus.status === 'ready' ? ' — update ready to install' : updateStatus.status === 'available' ? ' — update available' : ''}
              <kbd className="ml-2 font-mono text-[10px] px-1 py-0.5 rounded bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))]">⌘,</kbd>
              <Tooltip.Arrow className="fill-[rgb(var(--color-surface-4))]" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </div>
    </Tooltip.Provider>
  )
}
