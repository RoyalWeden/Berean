import * as Tooltip from '@radix-ui/react-tooltip'
import { useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowLeft, ArrowRight, History, PanelLeft,
} from 'lucide-react'
import { useAppStore } from '@/store'
import WindowControls from './WindowControls'
import type { TabNavEntry } from '@/types'

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

  const isWin = window.__berean_platform === 'win32'

  // ── Per-tab nav back/forward ─────────────────────────────────────────────
  const currentTabId  = activeTabId[activeSpace]
  const currentTabNav = currentTabId ? (tabNavStacks[currentTabId] ?? null) : null
  // Note/Lexicon tabs can go back one further step, to the list/search view
  // (idx -1) — see navTabBack in the store.
  const navStackType = currentTabNav?.stack[0]?.type
  const navSupportsHome = navStackType === 'note' || navStackType === 'lexicon'
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
  const navBackLongPress = useRef<ReturnType<typeof setTimeout> | null>(null)
  const navFwdLongPress  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const navBackDidLongPress = useRef(false)
  const navFwdDidLongPress  = useRef(false)

  useEffect(() => {
    if (!navDropdown) return
    function onDown(e: MouseEvent) {
      if (navDropdownRef.current && !navDropdownRef.current.contains(e.target as Node)) setNavDropdown(null)
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [navDropdown])

  return (
    <Tooltip.Provider delayDuration={200}>
      <div
        className={`
          app-drag-region flex-shrink-0 h-11 flex items-center gap-1 border-b border-[rgb(var(--color-surface-4))]
          bg-[rgb(var(--color-surface-2))] pr-3
          ${!isWin ? 'pl-[76px]' : 'pl-2'}
        `}
      >
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
              if (navBackDidLongPress.current) { navBackDidLongPress.current = false; return }
              if (canNavBack) {
                navTabBack()
              } else if (currentTab && originTab) {
                closeTab(currentTab.spaceId, currentTab.id)
                activateTab(originTab)
              }
            } : undefined}
            onContextMenu={canNavBack ? (e) => { e.preventDefault(); setNavDropdown({ x: e.clientX, y: e.clientY, mode: 'back' }) } : undefined}
            onMouseDown={canNavBack ? (e) => {
              if (e.button !== 0) return
              navBackDidLongPress.current = false
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
              navBackLongPress.current = setTimeout(() => {
                navBackDidLongPress.current = true
                setNavDropdown({ x: rect.left, y: rect.bottom + 4, mode: 'back' })
              }, 500)
            } : undefined}
            onMouseUp={() => { if (navBackLongPress.current) { clearTimeout(navBackLongPress.current); navBackLongPress.current = null } }}
            onMouseLeave={() => { if (navBackLongPress.current) { clearTimeout(navBackLongPress.current); navBackLongPress.current = null } }}
            title={canNavBack ? 'Back (⌘[) · hold for history' : canReturnToOrigin ? `Close tab & return to "${originTab!.title}"` : 'No back history'}
            className={`flex items-center justify-center w-7 h-7 transition-colors border-r border-[rgb(var(--color-surface-4))] ${
              canGoBack
                ? 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer'
                : 'text-[rgb(var(--color-text-muted))] opacity-30 cursor-default'
            }`}
          >
            <ArrowLeft size={14} />
          </button>
          <button
            onClick={canNavForward ? () => {
              if (navFwdDidLongPress.current) { navFwdDidLongPress.current = false; return }
              navTabForward()
            } : undefined}
            onContextMenu={canNavForward ? (e) => { e.preventDefault(); setNavDropdown({ x: e.clientX, y: e.clientY, mode: 'forward' }) } : undefined}
            onMouseDown={canNavForward ? (e) => {
              if (e.button !== 0) return
              navFwdDidLongPress.current = false
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
              navFwdLongPress.current = setTimeout(() => {
                navFwdDidLongPress.current = true
                setNavDropdown({ x: rect.left, y: rect.bottom + 4, mode: 'forward' })
              }, 500)
            } : undefined}
            onMouseUp={() => { if (navFwdLongPress.current) { clearTimeout(navFwdLongPress.current); navFwdLongPress.current = null } }}
            onMouseLeave={() => { if (navFwdLongPress.current) { clearTimeout(navFwdLongPress.current); navFwdLongPress.current = null } }}
            title={canNavForward ? 'Forward (⌘]) · hold for history' : 'No forward history'}
            className={`flex items-center justify-center w-7 h-7 transition-colors border-r border-[rgb(var(--color-surface-4))] ${
              canNavForward
                ? 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer'
                : 'text-[rgb(var(--color-text-muted))] opacity-30 cursor-default'
            }`}
          >
            <ArrowRight size={14} />
          </button>
          {currentTabNav && currentTabNav.stack.length > 0 && (
            <button
              onClick={(e) => {
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                setNavDropdown(d => d?.mode === 'all' ? null : { x: rect.left, y: rect.bottom + 4, mode: 'all' })
              }}
              title="Navigation history"
              className="flex items-center justify-center w-7 h-7 transition-colors text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer"
            >
              <History size={14} />
            </button>
          )}
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

      {/* ── Per-tab nav history dropdown ── */}
      {navDropdown && createPortal(
        <div
          ref={navDropdownRef}
          style={{ position: 'fixed', left: navDropdown.x, top: navDropdown.y, zIndex: 9999, minWidth: 220, maxWidth: 340 }}
          className="rounded-shell-lg bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] shadow-2xl py-1 text-xs"
        >
          {(() => {
            const tabStack = currentTabNav?.stack ?? []
            const tabIdx   = currentTabNav?.idx ?? -1
            const stackType = tabStack[0]?.type
            const supportsHome = stackType === 'note' || stackType === 'lexicon'
            const homeLabel = stackType === 'note' ? 'Notes list' : 'Lexicon search'

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
            const items = navDropdown.mode === 'back' ? backItems
                        : navDropdown.mode === 'forward' ? fwdItems
                        : allItems
            if (items.length === 0) {
              return <div className="px-3 py-2 text-[rgb(var(--color-text-muted))]">No history yet</div>
            }
            const label = navDropdown.mode === 'back' ? 'Back' : navDropdown.mode === 'forward' ? 'Forward' : 'Tab history'
            return (
              <>
                <div className="px-3 py-1 text-[9px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))]">{label}</div>
                {items.map((row) => {
                  if (row.kind === 'home') {
                    return (
                      <button
                        key="__home__"
                        onClick={() => {
                          useAppStore.getState().goToTabHome()
                          setNavDropdown(null)
                        }}
                        className="flex items-center gap-2 w-full px-3 py-1.5 text-left transition-colors cursor-pointer text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))]"
                      >
                        <span className="text-[11px] flex-shrink-0">🏠</span>
                        <span className="truncate">{homeLabel}</span>
                      </button>
                    )
                  }
                  const { stackIdx, entry } = row
                  const isCurrent = stackIdx === tabIdx
                  const typeIcon = entry.type === 'note' ? '📝' : entry.type === 'lexicon' ? '📖' : entry.type === 'pdf' ? '📄' : '📜'
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
                      className={`flex items-center gap-2 w-full px-3 py-1.5 text-left transition-colors cursor-pointer ${
                        isCurrent
                          ? 'text-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))/8]'
                          : 'text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))]'
                      }`}
                    >
                      <span className="text-[11px] flex-shrink-0">{typeIcon}</span>
                      <span className="truncate">{entry.title}</span>
                      {isCurrent && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[rgb(var(--color-accent))] flex-shrink-0" />}
                    </button>
                  )
                })}
              </>
            )
          })()}
        </div>,
        document.body
      )}
    </Tooltip.Provider>
  )
}
