import * as Tooltip from '@radix-ui/react-tooltip'
import { useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowLeft, ArrowRight, History, PanelLeft, Home, FileText, BookMarked, FileType, ScrollText, Youtube,
  Download, RotateCcw,
} from 'lucide-react'
import { useAppStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import { CLOSE_CONTEXT_MENUS_EVENT } from '@/lib/usePositionedMenu'
import { getAllNotes } from '@/lib/notesCache'
import ActionPillGroup from './ActionPillGroup'
import ShortcutKeys from './ShortcutKeys'
import WindowControls from './WindowControls'
import type { TabNavEntry } from '@/types'

const NAV_TYPE_ICON: Record<string, typeof FileText> = {
  note: FileText,
  lexicon: BookMarked,
  pdf: FileType,
  youtube: Youtube,
}

/**
 * One continuous header spanning the full window width — replaces the earlier split of
 * SidebarTopBar.tsx (docked above Sidebar.tsx: collapse toggle + back/forward/history) and
 * TopBar.tsx (docked beside it: tab-specific controls portal). Splitting them fixed an earlier
 * bug (drag-region hit-testing over hidden chrome in Focus mode) but left a visible seam where
 * the two bars met — a single shared background/height here removes that seam by construction
 * instead of trying to keep two components' padding/height/traffic-light logic in sync by hand.
 *
 * The nav pill is deliberately pinned flush-left (docked next to the rail) rather than
 * repositioned to track Sidebar's animating width — this is a genuine functional fix, not just
 * cosmetic: previously, collapsing the sidebar hid the back/forward/history nav entirely (it
 * lived nested inside Sidebar's own width-animating container), leaving no way to reach it
 * except keyboard shortcuts. Now it's part of this always-mounted, full-width bar, so it stays
 * reachable regardless of sidebar state.
 */
export default function ShellHeader({ slotRef }: { slotRef: (el: HTMLDivElement | null) => void }) {
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed)
  const toggleSidebar    = useAppStore((s) => s.toggleSidebar)
  const noteFocusModeTabId = useAppStore((s) => s.noteFocusModeTabId)
  const activeTabId  = useAppStore((s) => s.activeTabId[s.activeSpace])
  const noteFocusMode = noteFocusModeTabId !== null && noteFocusModeTabId === activeTabId
  // Derive currentTab/originTab inside the selector itself (rather than subscribing to the whole
  // `s.tabs` record) — originTab's space is dynamic (whatever the tab's originSpaceId says), so
  // there's no single fixed space to narrow to ahead of time. Computing both objects in the
  // selector means useShallow only sees their two (rarely-changing) references, so a tab-state
  // write in an unrelated space (which doesn't change these specific tab objects) doesn't
  // re-render this. See BiblePanel.tsx's comment for the underlying cause.
  const { currentTab, originTab } = useAppStore(
    useShallow((s) => {
      const tabId = s.activeTabId[s.activeSpace]
      const currentTab = tabId ? s.tabs[s.activeSpace]?.find((t) => t.id === tabId) ?? null : null
      const originTab = currentTab?.originTabId
        ? s.tabs[currentTab.originSpaceId ?? s.activeSpace]?.find((t) => t.id === currentTab.originTabId) ?? null
        : null
      return { currentTab, originTab }
    })
  )
  const tabNavStacks = useAppStore((s) => s.tabNavStacks)
  const navTabBack    = useAppStore((s) => s.navTabBack)
  const navTabForward = useAppStore((s) => s.navTabForward)
  const closeTab      = useAppStore((s) => s.closeTab)
  const activateTab   = useAppStore((s) => s.activateTab)
  const noteChangeToken = useAppStore((s) => s.noteChangeToken)
  const appZoom = useAppStore((s) => s.appZoom)
  const updateStatus = useAppStore((s) => s.updateStatus)

  const isWin = window.__berean_platform === 'win32'

  const [navNoteTitles, setNavNoteTitles] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    getAllNotes(noteChangeToken)
      .then((notes) => setNavNoteTitles(new Map(notes.map((n) => [n.id, n.title ?? '']))))
      .catch(() => {})
  }, [noteChangeToken])

  const currentTabId  = activeTabId
  const currentTabNav = currentTabId ? (tabNavStacks[currentTabId] ?? null) : null
  const navStackType = currentTabNav?.stack[0]?.type
  const navSupportsHome = navStackType === 'note' || navStackType === 'lexicon' || navStackType === 'youtube'
  const canNavBack    = currentTabNav ? currentTabNav.idx > (navSupportsHome ? -1 : 0) : false
  const canNavForward = currentTabNav ? currentTabNav.idx < currentTabNav.stack.length - 1 : false
  const canReturnToOrigin = !canNavBack && !!originTab
  const canGoBack = canNavBack || canReturnToOrigin
  const [navDropdown, setNavDropdown] = useState<{ x: number; y: number; mode: 'back' | 'forward' | 'all' } | null>(null)
  const navDropdownRef   = useRef<HTMLDivElement>(null)
  const navOpenTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const navCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function openNavDropdown(mode: 'back' | 'forward' | 'all', rect: DOMRect) {
    if (navCloseTimer.current) { clearTimeout(navCloseTimer.current); navCloseTimer.current = null }
    if (navOpenTimer.current) clearTimeout(navOpenTimer.current)
    navOpenTimer.current = setTimeout(() => setNavDropdown({ x: rect.left, y: rect.bottom, mode }), 350)
  }
  function cancelNavDropdownOpen() {
    if (navOpenTimer.current) { clearTimeout(navOpenTimer.current); navOpenTimer.current = null }
  }
  function scheduleNavDropdownClose() {
    if (navCloseTimer.current) clearTimeout(navCloseTimer.current)
    navCloseTimer.current = setTimeout(() => setNavDropdown(null), 320)
  }
  function keepNavDropdownOpen() {
    if (navCloseTimer.current) { clearTimeout(navCloseTimer.current); navCloseTimer.current = null }
  }

  useEffect(() => {
    if (!navDropdown) return
    function onDown(e: MouseEvent) {
      if (navDropdownRef.current && !navDropdownRef.current.contains(e.target as Node)) setNavDropdown(null)
    }
    function onClose() { setNavDropdown(null) }
    document.addEventListener('mousedown', onDown, true)
    window.addEventListener(CLOSE_CONTEXT_MENUS_EVENT, onClose)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      window.removeEventListener(CLOSE_CONTEXT_MENUS_EVENT, onClose)
    }
  }, [navDropdown])

  return (
    <Tooltip.Provider delayDuration={200}>
      <div
        className={`
          native-buttons ${noteFocusMode ? '' : 'app-drag-region'} flex-shrink-0 border-b border-[rgb(var(--color-surface-4))]
          ${window.__berean_platform === 'darwin' ? 'topbar-vibrant' : 'bg-[rgb(var(--color-surface-2))]'}
          pr-3 rounded-b-shell
          ${!isWin ? 'pl-[76px]' : 'pl-2'}
        `}
        // Unconditional on mac (not gated on sidebarCollapsed), and a FULL 76px inset, not the
        // 30px this briefly used — this bar is a single row spanning the entire window width,
        // sitting ABOVE the Ribbon+Sidebar row rather than beside it (App.tsx renders
        // ShellHeader first, full-width, then the Ribbon/Sidebar/main row below). Its left edge
        // is therefore always the window's true left edge, with nothing else sharing that row —
        // unlike the intermediate "sidebar to top of window" layout, where Ribbon ALSO touched
        // y:0 directly and contributed 46px of its own width, so a bar beside it only needed
        // 30px more (46+30=76) to reach full clearance. Ribbon no longer touches y:0 at all
        // (it's below this bar now), so this bar alone owns the full 76px — the original value
        // this file used before that intermediate layout ever existed. Deliberately on THIS
        // outer div, outside the `zoom: appZoom` scaling below — the traffic lights are real,
        // fixed-pixel OS chrome, so this clearance must stay true pixels regardless of the
        // user's zoom preference, not get inflated/shrunk along with it.
        //
        // Rounded BOTTOM corners only (rounded-b-shell), deliberately NOT touching the top
        // edge or left/right edges: the top-left corner sits directly under the real macOS
        // traffic-light buttons (the 76px inset above), and Electron's drag-region
        // hit-testing is a plain rectangle that doesn't follow border-radius — rounding or
        // insetting the TOP would either visually clip near the traffic lights or leave a
        // sliver of "looks like content, still drags the window" mismatch right where the
        // user is most likely to click. No shadow (removed per feedback — even a tight
        // custom value still read as too pronounced), and no bottom margin either (also
        // removed per feedback — the gap it created exposed the app root's background
        // color as a visible mismatched bar between the header and Sidebar/main below,
        // since that gap sits directly above surface-3 main content, not the header's own
        // surface-2 tone). The header now sits flush against Sidebar/FloatingRail/main —
        // rounding alone gives the corners a softened edge without needing a gap to read.
        style={{ height: 44 * appZoom }}
      >
        <div className="flex items-center gap-1 h-full" style={{ zoom: appZoom }}>
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* ── Collapse / expand sidebar ── */}
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button
                  onClick={toggleSidebar}
                  className="no-drag flex items-center justify-center w-7 h-7 rounded-shell text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer flex-shrink-0"
                >
                  <PanelLeft size={14} className={sidebarCollapsed ? 'rotate-180' : ''} />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content side="bottom" sideOffset={6} className="z-50 flex items-center gap-2 px-2 py-1 rounded text-xs bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] shadow-lg">
                  {sidebarCollapsed ? 'Expand explorer' : 'Collapse explorer'}
                  <ShortcutKeys keys="⌘⇧S" />
                  <Tooltip.Arrow className="fill-[rgb(var(--color-surface-4))]" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>

            {/* ── Global nav back / forward — joined pill. Pinned here, flush-left, in every
                 sidebar state (see file header comment — this is the functional fix over the
                 old split where collapsing the sidebar hid these entirely). ── */}
            <ActionPillGroup>
              <button
                onClick={canGoBack ? () => {
                  cancelNavDropdownOpen()
                  if (canNavBack) {
                    navTabBack()
                  } else if (currentTab && originTab) {
                    closeTab(currentTab.spaceId, currentTab.id)
                    activateTab(originTab)
                  }
                } : undefined}
                onContextMenu={canNavBack ? (e) => { e.preventDefault(); setNavDropdown({ x: e.clientX, y: e.clientY, mode: 'back' }) } : undefined}
                onMouseEnter={canNavBack ? (e) => openNavDropdown('back', (e.currentTarget as HTMLElement).getBoundingClientRect()) : undefined}
                onMouseLeave={canNavBack ? () => { cancelNavDropdownOpen(); scheduleNavDropdownClose() } : undefined}
                title={canNavBack ? 'Back (⌘[)' : canReturnToOrigin ? `Close tab & return to "${originTab!.title}"` : 'No back history'}
                className={`flex items-center justify-center w-7 h-7 transition-colors ${
                  canGoBack
                    ? 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer'
                    : 'text-[rgb(var(--color-text-muted))] opacity-30 cursor-default'
                }`}
              >
                <ArrowLeft size={14} />
              </button>
              <button
                onClick={canNavForward ? () => { cancelNavDropdownOpen(); navTabForward() } : undefined}
                onContextMenu={canNavForward ? (e) => { e.preventDefault(); setNavDropdown({ x: e.clientX, y: e.clientY, mode: 'forward' }) } : undefined}
                onMouseEnter={canNavForward ? (e) => openNavDropdown('forward', (e.currentTarget as HTMLElement).getBoundingClientRect()) : undefined}
                onMouseLeave={canNavForward ? () => { cancelNavDropdownOpen(); scheduleNavDropdownClose() } : undefined}
                title={canNavForward ? 'Forward (⌘])' : 'No forward history'}
                className={`flex items-center justify-center w-7 h-7 transition-colors ${
                  canNavForward
                    ? 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer'
                    : 'text-[rgb(var(--color-text-muted))] opacity-30 cursor-default'
                }`}
              >
                <ArrowRight size={14} />
              </button>
              {(() => {
                const hasHistory = !!currentTabNav && currentTabNav.stack.length > 0
                return (
                  <button
                    onClick={hasHistory ? (e) => {
                      cancelNavDropdownOpen()
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                      setNavDropdown(d => d?.mode === 'all' ? null : { x: rect.left, y: rect.bottom, mode: 'all' })
                    } : undefined}
                    onMouseEnter={hasHistory ? (e) => openNavDropdown('all', (e.currentTarget as HTMLElement).getBoundingClientRect()) : undefined}
                    onMouseLeave={hasHistory ? () => { cancelNavDropdownOpen(); scheduleNavDropdownClose() } : undefined}
                    title={hasHistory ? 'Navigation history' : 'No navigation history yet'}
                    className={`flex items-center justify-center w-7 h-7 transition-colors ${
                      hasHistory
                        ? 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer'
                        : 'text-[rgb(var(--color-text-muted))] opacity-30 cursor-default'
                    }`}
                  >
                    <History size={14} />
                  </button>
                )
              })()}
            </ActionPillGroup>
          </div>

          {/* ── Tab-specific controls — portal target for the active panel. NOT marked
               no-drag: individual buttons/inputs portaled in are already auto-excluded from
               the drag region by the .app-drag-region CSS rule, so leaving this undecorated
               keeps any empty gap in here draggable too, instead of blanket-blocking the
               whole slot. No fixed-width spacer between this and the nav pill above — the
               whole bar shares one background now, so there's nothing marking a boundary
               that would need to line up with Sidebar's animating width; ordinary flex
               spacing (this div is flex-1, justify-end) is enough. ── */}
          <div ref={slotRef} className="flex-1 flex items-center justify-end gap-2 min-w-0 overflow-hidden" />

          {/* ── Update available/ready — a persistent top-bar action, not just the small dot
               badge on the Settings gear (Ribbon.tsx), so a download/restart being available
               reads as an actual clickable next step wherever the user happens to be looking,
               not something they have to already know to go find. Same window.app calls
               Settings → Updates already uses; the status itself is the single shared
               updateStatus store field (App.tsx owns the one onUpdateStatus subscription). ── */}
          {(updateStatus.status === 'available' || updateStatus.status === 'ready') && (
            <button
              onClick={() => {
                if (updateStatus.status === 'available') window.app.downloadUpdate()
                else if (updateStatus.status === 'ready') window.app.installUpdate()
              }}
              title={updateStatus.status === 'available' ? `Download update${updateStatus.version ? ` (v${updateStatus.version})` : ''}` : 'Restart to finish installing the update'}
              className="no-drag flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[rgb(var(--color-accent))] text-white hover:opacity-90 transition-opacity cursor-pointer flex-shrink-0"
            >
              {updateStatus.status === 'available'
                ? <><Download size={12} /> Download update</>
                : <><RotateCcw size={12} /> Restart to update</>}
            </button>
          )}

          {/* ── Windows min/max/close — same row, far right ── */}
          {isWin && <WindowControls />}
        </div>
      </div>

      {/* ── Per-tab nav history preview — hover-triggered (see openNavDropdown), restyled with
           real lucide icons instead of bare emoji and a labeled header row. ── */}
      {navDropdown && createPortal(
        <div
          ref={navDropdownRef}
          // WebkitAppRegion: 'no-drag' stays explicit (not just the .no-drag class) — this
          // panel sits right against this bar's own app-drag-region strip, and Electron's
          // OS-level drag hit-testing doesn't reliably respect DOM paint order the way click
          // hit-testing does, so relying on CSS class alone here previously left the cursor
          // "inside" the panel while it still behaved as draggable underneath it.
          style={{ position: 'fixed', left: navDropdown.x, top: navDropdown.y, zIndex: 9999, minWidth: 240, maxWidth: 360, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          // `overflow-hidden` moved to a nested inner div, off the same element as the shadow —
          // combining overflow:hidden + border-radius + box-shadow on ONE element is a known
          // WebKit/Chromium compositing gotcha where the shadow can render clipped to the
          // element's square bounding box instead of following its own rounded corners (the
          // "topbar" version of the same square-shadow-corner bug already fixed for the
          // Bible side panel elsewhere — same root cause, different element). The outer div
          // here now only carries the rounding + glass-panel shadow; the inner one clips.
          className="rounded-shell-lg glass-panel text-xs"
          onMouseEnter={keepNavDropdownOpen}
          onMouseLeave={scheduleNavDropdownClose}
        >
          <div className="rounded-shell-lg overflow-hidden">
          {(() => {
            const tabStack = currentTabNav?.stack ?? []
            const tabIdx   = currentTabNav?.idx ?? -1
            const stackType = tabStack[0]?.type
            const supportsHome = stackType === 'note' || stackType === 'lexicon' || stackType === 'youtube'
            const homeLabel = stackType === 'note' ? 'Notes list' : stackType === 'lexicon' ? 'Lexicon search' : 'YouTube browse'

            type Row = { kind: 'entry'; stackIdx: number; entry: TabNavEntry } | { kind: 'home' }
            const backItems: Row[] = tabStack.slice(0, tabIdx).map((entry, i) => ({ kind: 'entry' as const, stackIdx: i, entry })).reverse()
            if (supportsHome) backItems.push({ kind: 'home' })
            const fwdItems: Row[] = tabStack.slice(tabIdx + 1).map((entry, i) => ({ kind: 'entry' as const, stackIdx: tabIdx + 1 + i, entry }))
            const allItems: Row[] = [
              ...tabStack.map((entry, i) => ({ kind: 'entry' as const, stackIdx: i, entry })).reverse(),
              ...(supportsHome ? [{ kind: 'home' as const }] : []),
            ]
            const fullItems = navDropdown.mode === 'back' ? backItems
                        : navDropdown.mode === 'forward' ? fwdItems
                        : allItems
            const items = fullItems.slice(0, 5)
            const hasMore = fullItems.length > 5
            if (items.length === 0) {
              return <div className="px-3 py-3 text-[rgb(var(--color-text-muted))]">No history yet</div>
            }
            const label = navDropdown.mode === 'back' ? 'Back' : navDropdown.mode === 'forward' ? 'Forward' : 'Tab history'
            return (
              <>
                <div className="px-3 py-1.5 text-[9.5px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))] bg-[rgb(var(--color-surface-3))] border-b border-[rgb(var(--color-surface-4))]">{label}</div>
                <div className="py-1">
                {items.map((row) => {
                  if (row.kind === 'home') {
                    return (
                      <button
                        key="__home__"
                        onClick={() => {
                          useAppStore.getState().goToTabHome()
                          setNavDropdown(null)
                        }}
                        className="flex items-center gap-2.5 w-full px-3 py-1.5 text-left transition-colors cursor-pointer text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))]"
                      >
                        <Home size={12} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />
                        <span className="truncate">{homeLabel}</span>
                      </button>
                    )
                  }
                  const { stackIdx, entry } = row
                  const isCurrent = stackIdx === tabIdx
                  const TypeIcon = NAV_TYPE_ICON[entry.type] ?? ScrollText
                  return (
                    <button
                      key={entry.id}
                      onClick={() => {
                        const delta = stackIdx - tabIdx
                        const store = useAppStore.getState()
                        if (delta < 0) { for (let j = 0; j < -delta; j++) store.navTabBack() }
                        else            { for (let j = 0; j < delta;  j++) store.navTabForward() }
                        setNavDropdown(null)
                      }}
                      className={`flex items-center gap-2.5 w-full px-3 py-1.5 text-left transition-colors cursor-pointer ${
                        isCurrent
                          ? 'text-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))/8]'
                          : 'text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))]'
                      }`}
                    >
                      <TypeIcon size={12} className={`flex-shrink-0 ${isCurrent ? 'text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-muted))]'}`} />
                      <span className="truncate">{entry.type === 'note' && entry.noteId ? (navNoteTitles.get(entry.noteId) ?? entry.title) : entry.title}</span>
                      {isCurrent && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[rgb(var(--color-accent))] flex-shrink-0" />}
                    </button>
                  )
                })}
                </div>
                {hasMore && (
                  <div className="py-1 border-t border-[rgb(var(--color-surface-4))]">
                    <button
                      onClick={() => {
                        useAppStore.getState().openHistory()
                        setNavDropdown(null)
                      }}
                      className="flex items-center gap-2.5 w-full px-3 py-1.5 text-left transition-colors cursor-pointer text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))]"
                    >
                      <span className="truncate">View all in History →</span>
                    </button>
                  </div>
                )}
              </>
            )
          })()}
          </div>
        </div>,
        document.body
      )}
    </Tooltip.Provider>
  )
}
