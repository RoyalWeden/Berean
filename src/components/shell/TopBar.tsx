import * as Tooltip from '@radix-ui/react-tooltip'
import { useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowLeft, ArrowRight, History, PanelLeft, Home, FileText, BookMarked, FileType, ScrollText, Youtube,
} from 'lucide-react'
import { useAppStore } from '@/store'
import WindowControls from './WindowControls'
import { CLOSE_CONTEXT_MENUS_EVENT } from '@/lib/usePositionedMenu'
import type { TabNavEntry } from '@/types'

const NAV_TYPE_ICON: Record<string, typeof FileText> = {
  note: FileText,
  lexicon: BookMarked,
  pdf: FileType,
  youtube: Youtube,
}

/**
 * Persistent, full-width top bar spanning the sidebar + content area (replacing
 * the sidebar's old nav row + footer, and each tab panel's independent header
 * strip). Left section is app-level chrome, same across every tab. Right
 * section is a portal target (see TopBarSlotContext) — the active tab panel
 * renders its own controls into it.
 */
export default function TopBar({ slotRef }: { slotRef: (el: HTMLDivElement | null) => void }) {
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed)
  const toggleSidebar    = useAppStore((s) => s.toggleSidebar)
  const activeSpace  = useAppStore((s) => s.activeSpace)
  const activeTabId  = useAppStore((s) => s.activeTabId)
  const tabs         = useAppStore((s) => s.tabs)
  const tabNavStacks = useAppStore((s) => s.tabNavStacks)
  const navTabBack    = useAppStore((s) => s.navTabBack)
  const navTabForward = useAppStore((s) => s.navTabForward)
  const closeTab      = useAppStore((s) => s.closeTab)
  const activateTab   = useAppStore((s) => s.activateTab)
  const noteChangeToken = useAppStore((s) => s.noteChangeToken)

  const isWin = window.__berean_platform === 'win32'

  // Live note id → title map for the back/forward nav dropdown below — TabNavEntry.title is a
  // snapshot captured when the entry was pushed, so without this a renamed note keeps showing
  // its old title in the dropdown even though its noteId (and the tab itself) are still correct.
  const [navNoteTitles, setNavNoteTitles] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    window.notes.getNotes(100000, 0)
      .then((notes) => setNavNoteTitles(new Map(notes.map((n) => [n.id, n.title ?? '']))))
      .catch(() => {})
  }, [noteChangeToken])

  // ── Per-tab nav back/forward ─────────────────────────────────────────────
  const currentTabId  = activeTabId[activeSpace]
  const currentTabNav = currentTabId ? (tabNavStacks[currentTabId] ?? null) : null
  // Note/Lexicon tabs can go back one further step, to the list/search view
  // (idx -1) — see navTabBack in the store.
  const navStackType = currentTabNav?.stack[0]?.type
  const navSupportsHome = navStackType === 'note' || navStackType === 'lexicon' || navStackType === 'youtube'
  const canNavBack    = currentTabNav ? currentTabNav.idx > (navSupportsHome ? -1 : 0) : false
  const canNavForward = currentTabNav ? currentTabNav.idx < currentTabNav.stack.length - 1 : false
  // Once a tab's own nav history is exhausted, fall back to closing this tab
  // and returning to whatever tab it was opened FROM (e.g. "open in new tab"
  // on a cross-reference/wikilink/search result) — the tab was only ever a
  // one-off detour, so "back" from it should feel like it never left.
  const currentTab = currentTabId ? tabs[activeSpace]?.find((t) => t.id === currentTabId) ?? null : null
  const originTab = currentTab?.originTabId
    ? tabs[currentTab.originSpaceId ?? activeSpace]?.find((t) => t.id === currentTab.originTabId) ?? null
    : null
  const canReturnToOrigin = !canNavBack && !!originTab
  const canGoBack = canNavBack || canReturnToOrigin
  const [navDropdown, setNavDropdown] = useState<{ x: number; y: number; mode: 'back' | 'forward' | 'all' } | null>(null)
  const navDropdownRef   = useRef<HTMLDivElement>(null)
  // Hover-triggered rather than the earlier 500ms-long-press/right-click-only dropdown — a
  // short open delay (matches Radix's own tooltip delayDuration on this bar) avoids flashing
  // the preview on every incidental mouseover, and a short close delay (like the jump-rail
  // panel in ScriptureSearchView.tsx) lets the pointer travel from the button into the
  // portaled dropdown without it slamming shut mid-move. Right-click still opens it instantly.
  const navOpenTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const navCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function openNavDropdown(mode: 'back' | 'forward' | 'all', rect: DOMRect) {
    if (navCloseTimer.current) { clearTimeout(navCloseTimer.current); navCloseTimer.current = null }
    if (navOpenTimer.current) clearTimeout(navOpenTimer.current)
    // No gap between the button and the panel (y: rect.bottom, not rect.bottom + 4) — a visible
    // gap meant the mouse could cross a strip of dead space where it's over neither the button
    // nor the panel while traveling between them, and a longer close delay (320ms, up from
    // 200ms) gives more slack for that crossing before the panel closes out from under the
    // pointer.
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

  const appZoom = useAppStore((s) => s.appZoom)

  return (
    <Tooltip.Provider delayDuration={200}>
      <div
        className={`
          app-drag-region flex-shrink-0 border-b border-[rgb(var(--color-surface-4))]
          bg-[rgb(var(--color-surface-2))] pr-3
          ${!isWin ? 'pl-[76px]' : 'pl-2'}
        `}
        // Height set inline (overriding a base h-11) rather than left to the zoomed inner
        // content to size it naturally — CSS `zoom` reflows layout for real (unlike `transform:
        // scale`), so the inner wrapper below WOULD grow this bar automatically, but doing it
        // explicitly here keeps the traffic-light padding (pl-[76px], outside the zoomed
        // subtree so it stays visually constant) and this bar's own border/background sized
        // predictably instead of depending on flow quirks.
        style={{ height: 44 * appZoom }}
      >
        <div className="flex items-center gap-1 h-full" style={{ zoom: appZoom }}>
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
              <kbd className="font-mono text-[10px] px-1 py-0.5 rounded bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))]">⌘⇧S</kbd>
              <Tooltip.Arrow className="fill-[rgb(var(--color-surface-4))]" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>

        {/* ── Global nav back / forward — joined pill ── */}
        <div className="no-drag flex items-center rounded-shell border border-[rgb(var(--color-surface-4))] overflow-hidden flex-shrink-0">
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
            className={`flex items-center justify-center w-7 h-7 transition-colors border-r border-[rgb(var(--color-surface-4))] ${
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
            className={`flex items-center justify-center w-7 h-7 transition-colors border-r border-[rgb(var(--color-surface-4))] ${
              canNavForward
                ? 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer'
                : 'text-[rgb(var(--color-text-muted))] opacity-30 cursor-default'
            }`}
          >
            <ArrowRight size={14} />
          </button>
          {/* Always rendered (like back/forward), just dimmed/inert when there's nothing to show
              yet — previously this button didn't render AT ALL until the current tab's nav stack
              had at least one entry, which on a freshly-opened tab (no navigation yet) meant there
              was no icon here to hover in the first place, indistinguishable from "hover does
              nothing." */}
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
        </div>

        {/* ── Divider before tab-specific controls ── */}
        <div className="w-px h-5 bg-[rgb(var(--color-surface-4))] mx-1 flex-shrink-0" />

        {/* ── Tab-specific controls — portal target for the active panel. NOT
             marked no-drag: individual buttons/inputs portaled in are already
             auto-excluded from the drag region by the .app-drag-region CSS rule,
             so leaving this undecorated keeps any empty gap in here draggable
             too, instead of blanket-blocking the whole slot. ── */}
        <div ref={slotRef} className="flex-1 flex items-center justify-end gap-2 min-w-0 overflow-hidden" />

        {/* ── Windows min/max/close — same row, far right ── */}
        {isWin && <WindowControls />}
        </div>
      </div>

      {/* ── Per-tab nav history preview — hover-triggered (see openNavDropdown), restyled with
           real lucide icons instead of bare emoji and a labeled header row. ── */}
      {navDropdown && createPortal(
        <div
          ref={navDropdownRef}
          // Explicit inline no-drag rather than relying on the .no-drag CSS class: this panel
          // sits right against the TopBar's own app-drag-region strip (its top edge touches
          // the trigger button's bottom edge), and Electron's drag hit-testing is computed
          // from a periodically-scanned list of draggable screen rectangles at the OS/browser-
          // process level — it isn't guaranteed to respect normal DOM paint order the way
          // click hit-testing does, so a portaled element merely painted on top of a drag
          // rectangle isn't reliably enough to keep the OS from treating that overlap as
          // still-draggable. This was very likely why the cursor could be visually inside the
          // panel while it still behaved as "not hovering."
          style={{ position: 'fixed', left: navDropdown.x, top: navDropdown.y, zIndex: 9999, minWidth: 240, maxWidth: 360, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          className="rounded-shell-lg bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] shadow-2xl overflow-hidden text-xs"
          onMouseEnter={keepNavDropdownOpen}
          onMouseLeave={scheduleNavDropdownClose}
        >
          {(() => {
            const tabStack = currentTabNav?.stack ?? []
            const tabIdx   = currentTabNav?.idx ?? -1
            const stackType = tabStack[0]?.type
            const supportsHome = stackType === 'note' || stackType === 'lexicon' || stackType === 'youtube'
            const homeLabel = stackType === 'note' ? 'Notes list' : stackType === 'lexicon' ? 'Lexicon search' : 'YouTube browse'

            // Real stack items, tagged with their real index so the synthetic
            // "list/home" entry (idx -1) can be spliced in alongside them.
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
        </div>,
        document.body
      )}
    </Tooltip.Provider>
  )
}
