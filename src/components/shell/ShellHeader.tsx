import { useCallback, useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowLeft, ArrowRight, History, PanelLeft, Home, NotepadText, BookMarked, FileType, ScrollText, Youtube,
  Download, RotateCcw,
} from 'lucide-react'
import ShortcutKeys from './ShortcutKeys'
import { useAppStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import { CLOSE_CONTEXT_MENUS_EVENT, MenuPositioner } from '@/lib/usePositionedMenu'
import { getAllNotes } from '@/lib/notesCache'
import { ensureYouTubeTitles } from '@/lib/youtubeTitle'
import { cachedLexiconTitle } from '@/lib/lexiconTitle'
import { TRAFFIC_LIGHT_INSET, HEADER_HEIGHT } from '@/lib/windowChrome'
import { IconButton, Button, ControlGroup, Toolbar, MenuSurface, MenuItem, MenuSeparator, MenuLabel, Tooltip } from '@/components/ui'
import { publishActionsSlot } from './TopBarSlotContext'
import WindowControls from './WindowControls'
import type { TabNavEntry } from '@/types'

const NAV_TYPE_ICON: Record<string, typeof NotepadText> = {
  note: NotepadText,
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

  // Publishes the ACTIONS-zone container to TopBarSlotContext's module-level store (see that
  // file's comment) — the panel-side counterpart of `slotRef` below, which App.tsx still owns
  // directly for the CONTEXT zone. `useCallback` with no deps keeps this ref callback's identity
  // stable across renders, so React only invokes it on mount/unmount, not on every render.
  const actionsSlotRef = useCallback((el: HTMLDivElement | null) => {
    publishActionsSlot(el)
  }, [])

  // Manual click-drag-to-move on blank header space — same pattern as Sidebar.tsx's tabListRef
  // (see that file's own comment for why: a real CSS `-webkit-app-region: drag` region can
  // swallow a click meant for something ELSE entirely, at the OS hit-test level, regardless of
  // an overlapping no-drag element's paint order or z-index). This bar was the last real static
  // drag region positioned where a context menu opened low in the sidebar's tab list can land
  // after usePositionedMenu.ts's flip-up logic pushes it upward to stay on-screen.
  //
  // Attached as a NATIVE DOM listener on the header element itself (via ref + addEventListener),
  // not as a React `onMouseDown` prop. The tab-specific right-hand portion of this bar
  // (everything from `slotRef` onward) is filled via TabHeaderPortal.tsx's `createPortal` call
  // from each panel (BiblePanel, LexiconPanel, NotesPanel, YouTubeTab, ...) — that DOM node is a
  // real descendant of this header element on screen, but in the REACT tree it's a child of
  // whichever panel called createPortal, not a child of ShellHeader. React's synthetic event
  // bubbling (including capture) follows the React tree, so a plain `onMouseDown` prop here never
  // saw clicks on blank space inside the portaled region — only the left-hand cluster (nav pills,
  // sidebar toggle — real React children of this component) ever triggered a drag. A native
  // listener bypasses that entirely: native DOM events bubble along the real DOM tree, which does
  // contain the portaled content, so blank space anywhere under this bar now drags correctly.
  const headerRef = useRef<HTMLDivElement>(null)
  const windowDragRef = useRef<{ lastScreenX: number; lastScreenY: number } | null>(null)
  const noteFocusModeRef = useRef(noteFocusMode)
  noteFocusModeRef.current = noteFocusMode
  useEffect(() => {
    const headerEl = headerRef.current
    if (!headerEl) return
    function handleHeaderMouseDown(e: MouseEvent) {
      if (noteFocusModeRef.current) return
      const t = e.target as HTMLElement
      // Same interactive-element guard global.css's own `.app-drag-region button, a, input, ...`
      // rule used to provide automatically — reproduced here in JS since this bar is no longer a
      // real CSS drag region for anything to auto-exclude itself from.
      if (t.closest('button, a, input, select, textarea, [role="button"], [role="combobox"], [role="listbox"]')) return
      if (e.button !== 0) return
      windowDragRef.current = { lastScreenX: e.screenX, lastScreenY: e.screenY }
      const DRAG_THRESHOLD = 4
      let moved = false
      function onMove(ev: MouseEvent) {
        const drag = windowDragRef.current
        if (!drag) return
        const dx = ev.screenX - drag.lastScreenX
        const dy = ev.screenY - drag.lastScreenY
        if (!moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
        moved = true
        drag.lastScreenX = ev.screenX
        drag.lastScreenY = ev.screenY
        window.app.moveWindowBy(dx, dy)
      }
      function onUp() {
        windowDragRef.current = null
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    }
    headerEl.addEventListener('mousedown', handleHeaderMouseDown)
    return () => headerEl.removeEventListener('mousedown', handleHeaderMouseDown)
  }, [])

  // Publishes this header's real rendered height as a CSS var so global.css's ambient
  // background-animation layer (html.theme-anim-bg body::before) can clip itself below it —
  // on mac this header is `.material-bar` over a genuinely transparent Electron window with
  // vibrancy, not just a translucent-looking CSS color: electron/main.ts sets
  // `transparent: true, vibrancy: 'sidebar'`), so the animated blob painting behind it was
  // visibly tinting what's supposed to be neutral OS-blurred vibrancy — worst right at the
  // window's top-left corner, where this header's vibrancy and Sidebar.tsx's own (see its
  // matching effect for `--berean-sidebar-w`) overlap. A ResizeObserver (not a one-time
  // measurement) because `appZoom` and window-width-driven wrapping can change this bar's real
  // height after mount.
  useEffect(() => {
    const headerEl = headerRef.current
    if (!headerEl) return
    const root = document.documentElement
    const ro = new ResizeObserver(() => {
      root.style.setProperty('--berean-header-h', `${headerEl.getBoundingClientRect().height}px`)
    })
    ro.observe(headerEl)
    return () => ro.disconnect()
  }, [])

  const [navNoteTitles, setNavNoteTitles] = useState<Map<string, string>>(new Map())
  useEffect(() => {
    getAllNotes(noteChangeToken)
      .then((notes) => setNavNoteTitles(new Map(notes.map((n) => [n.id, n.title ?? '']))))
      .catch(() => {})
  }, [noteChangeToken])

  const currentTabId  = activeTabId
  const currentTabNav = currentTabId ? (tabNavStacks[currentTabId] ?? null) : null
  const navStackType = currentTab?.type ?? currentTabNav?.stack[0]?.type
  const navSupportsHome = navStackType === 'note' || navStackType === 'lexicon' || navStackType === 'youtube'
  const canNavBack    = currentTabNav ? currentTabNav.idx > (navSupportsHome ? -1 : 0) : false
  const canNavForward = currentTabNav ? currentTabNav.idx < currentTabNav.stack.length - 1 : false
  const canReturnToOrigin = !canNavBack && !!originTab
  const canGoBack = canNavBack || canReturnToOrigin
  const [navDropdown, setNavDropdown] = useState<{ x: number; y: number; mode: 'back' | 'forward' | 'all' } | null>(null)
  // Same live-title trick as navNoteTitles above, for YouTube: nav-stack entries
  // are pushed before the new video's metadata is known, so the stored title can
  // be a placeholder. Loaded lazily — only once a history dropdown is actually
  // opened on a stack that contains YouTube entries.
  const [navVideoTitles, setNavVideoTitles] = useState<Map<string, string>>(new Map())
  const navDropdownRef   = useRef<HTMLDivElement>(null)
  const navOpenTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const navCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Titles stored on a nav entry are a snapshot from push time and can be stale
  // (note renamed since) or a placeholder (video/lexicon metadata not loaded yet),
  // so prefer a live lookup wherever one is available.
  function navEntryTitle(entry: TabNavEntry): string {
    if (entry.type === 'note' && entry.noteId) return navNoteTitles.get(entry.noteId) ?? entry.title
    if (entry.type === 'youtube' && entry.videoId) return navVideoTitles.get(entry.videoId) ?? entry.title
    if (entry.type === 'lexicon' && entry.strongsNum) return cachedLexiconTitle(entry.strongsNum) ?? entry.title
    return entry.title
  }

  useEffect(() => {
    if (!navDropdown) return
    const stack = currentTabNav?.stack ?? []
    if (!stack.some((e) => e.type === 'youtube' && e.videoId)) return
    let cancelled = false
    ensureYouTubeTitles()
      .then((titles) => { if (!cancelled) setNavVideoTitles(titles) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [navDropdown, currentTabNav])

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

  const homeSupported = navStackType === 'note' || navStackType === 'lexicon' || navStackType === 'youtube'
  // A note open in the current tab always has a "home" to go to (the notes list), even when this
  // tab's nav stack was never seeded (e.g. a note opened straight into its own dedicated tab) —
  // so the button must not depend solely on the nav-stack idx there. It stays disabled only once
  // the tab is already back on the notes home view (no open note → noteId cleared).
  const noteOpenHere = currentTab?.type === 'note' && !!(currentTab.state as { noteId?: string | null }).noteId
  const canGoHome = noteOpenHere || (!!currentTabNav && homeSupported && currentTabNav.idx >= 0)
  const homeLabel = (navStackType === 'note' || noteOpenHere) ? 'Notes list'
    : navStackType === 'lexicon' ? 'Lexicon search'
    : navStackType === 'youtube' ? 'YouTube browse'
    : 'Home'
  const hasHistory = !!currentTabNav && currentTabNav.stack.length > 0

  return (
    <>
      <div
        ref={headerRef}
        className="no-drag flex-shrink-0 material-bar"
        // No permanent `border-b` — scroll-edge (macOS 26/27's seamless-at-rest toolbar) owns the
        // hairline instead, appearing only once the content beneath has actually scrolled. Full
        // wiring (a `scrolled` boolean driven by a `scrollEdge` store slice, passed to `Toolbar`
        // below) is a later lane; for now this only sets up the CSS hook (`data-scroll-edge`)
        // so nothing regresses to a permanent line, and the inner Toolbar stays `edge="none"`
        // (no `data-scrolled` is ever set, so `[data-scroll-edge="bottom"][data-scrolled]` in
        // global.css never matches — the bar is seamless until that store slice lands).
        // TODO(scrollEdge store slice): pass `scrolled` through and switch the inner Toolbar to
        // `edge="auto"`.
        data-scroll-edge="bottom"
        // Unconditional on mac (not gated on sidebarCollapsed), and a FULL 76px inset, not the
        // 30px this briefly used — this bar is a single row spanning the entire window width,
        // sitting ABOVE the Ribbon+Sidebar row rather than beside it (App.tsx renders
        // ShellHeader first, full-width, then the Ribbon/Sidebar/main row below). Its left edge
        // is therefore always the window's true left edge, with nothing else sharing that row —
        // unlike the intermediate "sidebar to top of window" layout, where Ribbon ALSO touched
        // y:0 directly and contributed 46px of its own width, so a bar beside it only needed
        // 30px more (46+30=76) to reach full clearance. Ribbon no longer touches y:0 at all
        // (it's below this bar now), so this bar alone owns the full 76px — the original value
        // this file used before that intermediate layout ever existed. Deliberately computed
        // here, outside the `zoom: appZoom` scaling below — the traffic lights are real,
        // fixed-pixel OS chrome, so this clearance must stay true pixels regardless of the
        // user's zoom preference, not get inflated/shrunk along with it. Sourced from
        // windowChrome.ts's shared constants rather than re-hardcoded here.
        //
        // No rounded bottom corners anymore — a real macOS toolbar is flush with the window
        // edge, and (per the design-system decision log) bars never carry their own shadow;
        // `.material-bar` + the scroll-edge hairline above is the whole visual treatment.
        style={{ height: HEADER_HEIGHT * appZoom, paddingLeft: isWin ? 8 : TRAFFIC_LIGHT_INSET }}
      >
        <Toolbar size="md" edge="none" material="none" style={{ zoom: appZoom }}>
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* ── Collapse / expand sidebar ── */}
            <IconButton
              icon={PanelLeft}
              label={sidebarCollapsed ? 'Expand explorer' : 'Collapse explorer'}
              tooltip={{ shortcut: '⌘⇧S' }}
              size={28}
              iconClassName={sidebarCollapsed ? 'rotate-180' : undefined}
              onClick={toggleSidebar}
            />

            {/* ── Global nav back / forward — joined pill. Pinned here, flush-left, in every
                 sidebar state (see file header comment — this is the functional fix over the
                 old split where collapsing the sidebar hid these entirely). ── */}
            <ControlGroup>
              {/* ── Home — first in the nav pill, immediately right of the sidebar toggle ──
                   This used to be portaled in from each panel's own TabHeaderPortal, which lands
                   in the flex-1 tab-content slot on the RIGHT. Because it appeared and vanished
                   with the active tab's navigation state, every other control in that slot
                   shifted sideways whenever it came or went — reported as "the home button
                   shifts around the top buttons."
                   It now lives here in the fixed left cluster, which never reflows, and is
                   ALWAYS rendered — dimmed and inert when the current tab has no home to return
                   to, exactly like the back/forward/history buttons beside it. A control that
                   holds its position and greys out is far easier to aim at than one that
                   disappears. Scripture is deliberately excluded from `homeSupported` above:
                   there's no real "home page" for it, just "the earliest chapter you happened to
                   visit in this tab" — treating that as a home destination would be misleading,
                   not a real "go home" action. ── */}
              <IconButton
                icon={Home}
                label={canGoHome ? homeLabel : 'No home view for this tab'}
                size={28}
                disabled={!canGoHome}
                onClick={() => { cancelNavDropdownOpen(); useAppStore.getState().goToTabHome() }}
              />
              <IconButton
                icon={ArrowLeft}
                label={canNavBack ? 'Back' : canReturnToOrigin ? `Close tab & return to "${originTab!.title}"` : 'No back history'}
                // The hover dropdown IS the hover surface when there's history (its header carries
                // the name + shortcut) — a second tooltip on top of it read as doubled chrome.
                tooltip={canNavBack ? false : true}
                size={28}
                disabled={!canGoBack}
                onClick={() => {
                  cancelNavDropdownOpen()
                  if (canNavBack) {
                    navTabBack()
                  } else if (currentTab && originTab) {
                    closeTab(currentTab.spaceId, currentTab.id)
                    activateTab(originTab)
                  }
                }}
                onContextMenu={canNavBack ? (e) => { e.preventDefault(); setNavDropdown({ x: e.clientX, y: e.clientY, mode: 'back' }) } : undefined}
                onMouseEnter={canNavBack ? (e) => openNavDropdown('back', (e.currentTarget as HTMLElement).getBoundingClientRect()) : undefined}
                onMouseLeave={canNavBack ? () => { cancelNavDropdownOpen(); scheduleNavDropdownClose() } : undefined}
              />
              <IconButton
                icon={ArrowRight}
                label={canNavForward ? 'Forward' : 'No forward history'}
                tooltip={canNavForward ? false : true}
                size={28}
                disabled={!canNavForward}
                onClick={() => { cancelNavDropdownOpen(); navTabForward() }}
                onContextMenu={canNavForward ? (e) => { e.preventDefault(); setNavDropdown({ x: e.clientX, y: e.clientY, mode: 'forward' }) } : undefined}
                onMouseEnter={canNavForward ? (e) => openNavDropdown('forward', (e.currentTarget as HTMLElement).getBoundingClientRect()) : undefined}
                onMouseLeave={canNavForward ? () => { cancelNavDropdownOpen(); scheduleNavDropdownClose() } : undefined}
              />
              <IconButton
                icon={History}
                label={hasHistory ? 'Navigation history' : 'No navigation history yet'}
                tooltip={hasHistory ? false : true}
                size={28}
                disabled={!hasHistory}
                onClick={(e) => {
                  cancelNavDropdownOpen()
                  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                  setNavDropdown((d) => d?.mode === 'all' ? null : { x: rect.left, y: rect.bottom, mode: 'all' })
                  // Trigger rect for the History overlay (lane S1) to animate/anchor from — optional
                  // chaining since that setter is landing concurrently on another lane.
                  useAppStore.getState().setHistoryTriggerRect?.({ x: rect.left, y: rect.top, w: rect.width, h: rect.height })
                }}
                onMouseEnter={hasHistory ? (e) => openNavDropdown('all', (e.currentTarget as HTMLElement).getBoundingClientRect()) : undefined}
                onMouseLeave={hasHistory ? () => { cancelNavDropdownOpen(); scheduleNavDropdownClose() } : undefined}
              />
            </ControlGroup>
          </div>

          {/* ── CONTEXT zone — portal target for the active panel's title/nav control
               (TabHeaderPortal's default `zone="context"`). NOT marked no-drag: individual
               buttons/inputs portaled in are already auto-excluded from the drag region by the
               .app-drag-region CSS rule, so leaving this undecorated keeps any empty gap in here
               draggable too. No divider between this and the nav pill above — grouping (the
               ControlGroup container itself) already makes the nav cluster legible as one unit;
               a bar-spanning hairline on top of that read as double emphasis. ── */}
          <div ref={slotRef} className="flex items-center gap-2 min-w-0 flex-shrink" />

          {/* ── Flexible space — pushes the ACTIONS zone to the right, CONTEXT zone to the
               left, macOS toolbar-style. ── */}
          <div className="flex-1" />

          {/* ── ACTIONS zone — portal target for the active panel's trailing action group(s)
               (TabHeaderPortal's `zone="actions"`). ── */}
          <div ref={actionsSlotRef} className="flex items-center gap-2 flex-shrink-0 justify-end" />

          {/* ── Download in progress — same top-bar spot as the button below, shown instead of
               it while a download is running. Fires from the SAME 'downloading' updateStatus
               regardless of whether the user just clicked "Download update" above or the
               download started on its own (Settings → Updates → auto-download), so this one
               bar covers both triggers without needing to know which one caused it. Plain text +
               a thin progress bar, not a glass capsule — this is passive status, not a control,
               so it shouldn't carry CONTROL-layer chrome (per the design-system's four-layer
               rule: CHROME is the bar itself; a status readout inside it stays flat). Percent
               bar styling matches UpdatesSection.tsx's own downloading state (surface-4 track,
               accent fill). ── */}
          {updateStatus.status === 'downloading' && (
            <Tooltip label={`Downloading update… ${updateStatus.percent ?? 0}%`}>
              <div className="relative flex items-center gap-1.5 px-1 flex-shrink-0">
                <Download size={12} className="flex-shrink-0 text-text-tertiary" />
                <span className="text-meta">Downloading… {updateStatus.percent ?? 0}%</span>
                <div className="w-10 h-0.5 rounded-full bg-separator overflow-hidden flex-shrink-0">
                  <div
                    className="h-full bg-accent transition-[width] duration-300"
                    style={{ width: `${updateStatus.percent ?? 0}%` }}
                  />
                </div>
              </div>
            </Tooltip>
          )}

          {/* ── Update available/ready — a persistent top-bar action, not just the small dot
               badge on the Settings gear (Ribbon.tsx), so a download/restart being available
               reads as an actual clickable next step wherever the user happens to be looking,
               not something they have to already know to go find. Same window.app calls
               Settings → Updates already uses; the status itself is the single shared
               updateStatus store field (App.tsx owns the one onUpdateStatus subscription).
               'available' is a lower-urgency nudge (tinted glass); 'ready' is the one actually
               worth a filled accent button — restarting finishes something already downloaded. ── */}
          {(updateStatus.status === 'available' || updateStatus.status === 'ready') && (
            <Button
              variant={updateStatus.status === 'ready' ? 'primary' : 'prominent'}
              size="sm"
              icon={updateStatus.status === 'available' ? Download : RotateCcw}
              onClick={() => {
                if (updateStatus.status === 'available') window.app.downloadUpdate()
                else if (updateStatus.status === 'ready') window.app.installUpdate()
              }}
              tooltip={updateStatus.status === 'available' ? `Download update${updateStatus.version ? ` (v${updateStatus.version})` : ''}` : 'Restart to finish installing the update'}
              className="flex-shrink-0"
            >
              {updateStatus.status === 'available' ? 'Download update' : 'Restart to update'}
            </Button>
          )}

          {/* ── Windows min/max/close — same row, far right ── */}
          {isWin && <WindowControls />}
        </Toolbar>
      </div>

      {/* ── Per-tab nav history preview — hover-triggered (see openNavDropdown). ── */}
      {navDropdown && createPortal(
        <MenuPositioner
          ref={navDropdownRef}
          x={navDropdown.x}
          y={navDropdown.y}
        >
          <MenuSurface
            className="min-w-[240px] max-w-[360px]"
            onMouseEnter={keepNavDropdownOpen}
            onMouseLeave={scheduleNavDropdownClose}
          >
          {(() => {
            const tabStack = currentTabNav?.stack ?? []
            const tabIdx   = currentTabNav?.idx ?? -1
            const stackType = tabStack[0]?.type
            const supportsHome = stackType === 'note' || stackType === 'lexicon' || stackType === 'youtube'
            const dropdownHomeLabel = stackType === 'note' ? 'Notes list' : stackType === 'lexicon' ? 'Lexicon search' : 'YouTube browse'

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
              return <div className="px-3 py-3 text-text-muted">No history yet</div>
            }
            const dropdownLabel = navDropdown.mode === 'back' ? 'Back' : navDropdown.mode === 'forward' ? 'Forward' : 'Tab history'
            return (
              <>
                <MenuLabel className="flex items-center justify-between gap-3">
                  <span>{dropdownLabel}</span>
                  {navDropdown.mode !== 'all' && <ShortcutKeys keys={navDropdown.mode === 'back' ? '⌘[' : '⌘]'} className="opacity-70" />}
                </MenuLabel>
                {items.map((row) => {
                  if (row.kind === 'home') {
                    return (
                      <MenuItem
                        key="__home__"
                        icon={Home}
                        label={dropdownHomeLabel}
                        onClick={() => { useAppStore.getState().goToTabHome(); setNavDropdown(null) }}
                      />
                    )
                  }
                  const { stackIdx, entry } = row
                  const isCurrent = stackIdx === tabIdx
                  const TypeIcon = NAV_TYPE_ICON[entry.type] ?? ScrollText
                  return (
                    <MenuItem
                      key={entry.id}
                      icon={TypeIcon}
                      label={navEntryTitle(entry)}
                      active={isCurrent}
                      onClick={() => {
                        const delta = stackIdx - tabIdx
                        const store = useAppStore.getState()
                        if (delta < 0) { for (let j = 0; j < -delta; j++) store.navTabBack() }
                        else            { for (let j = 0; j < delta;  j++) store.navTabForward() }
                        setNavDropdown(null)
                      }}
                    />
                  )
                })}
                {hasMore && (
                  <>
                    <MenuSeparator />
                    <MenuItem
                      label="View all in History →"
                      onClick={() => { useAppStore.getState().openHistory(); setNavDropdown(null) }}
                    />
                  </>
                )}
              </>
            )
          })()}
          </MenuSurface>
        </MenuPositioner>,
        document.body
      )}
    </>
  )
}
