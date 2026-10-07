import { resolveDailyNoteId } from '@/lib/dailyNotes'
import { Popover, PopoverTrigger, PopoverSurface } from '@/components/ui'
import { motion } from 'framer-motion'
import { PANEL_SLIDE } from '@/lib/motion'
import { BookOpen, NotepadText, BookMarked, Youtube, Search, Settings, PanelLeft, Plus, ChevronRight, ChevronsUpDown, Pencil, Palette, Hash, Trash2, Layers, Star, Flame, Leaf, Globe, Compass, Shield, Feather, Anchor, Crown, Zap, Heart, Cloud, Mountain, Fish, Key, Bell, Clock, Home, Map, Gem, Music2, Sun, Moon, CalendarCheck, PanelRightOpen, ExternalLink, Monitor, type LucideIcon } from 'lucide-react'
import { useAppStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import TabBar from './TabBar'
import type { SpaceId, TabType } from '@/types'
import { useState, useRef, useEffect, useMemo } from 'react'
import Ribbon from './Ribbon'
import { createPortal } from 'react-dom'
import { MenuPositioner, CLOSE_CONTEXT_MENUS_EVENT } from '@/lib/usePositionedMenu'
import { normalizeBookName } from '@/lib/parseRef'
import { getAllNotes } from '@/lib/notesCache'
import type { Book, Note } from '@/types'
import { CalendarGrid, toDateKey, findDailyNote } from '@/components/notes/CalendarWidget'
import { dailyNoteTitle, dailyNoteToday } from '@/lib/dailyNoteUtils'
import { IconButton, ListRow, ControlGroup, MenuSurface, MenuItem, MenuSeparator, MenuLabel, TextField, Tooltip, BarMetrics } from '@/components/ui'
import { useRovingNav } from '@/lib/useRovingNav'

/** The sidebar's single "New Tab" row + its menu. */
function NewTabMenu({ onCreate, onSearch }: { onCreate: (id: SpaceId, type: TabType) => void; onSearch: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <ListRow
          dense
          // Same rounded shape as the tab rows below it (rounded-control-md) — `flush` drew a
          // square-cornered highlight (TEST 2026-10-05: "new tab button not properly rounded").
          inset
          selected={open}
          leading={<Plus size={14} className="text-text-secondary flex-shrink-0" />}
          title={<span className="text-footnote text-text-secondary">New Tab</span>}
          titleSize="footnote"
          aria-haspopup="menu"
          aria-label="New tab — choose Scripture, Notes, Lexicon or YouTube"
        />
      </PopoverTrigger>
      <PopoverSurface side="bottom" align="start" sideOffset={4} innerClassName="p-1 min-w-[220px]" role="menu">
        {SPACES.map(({ id, type, label, icon }) => (
          <MenuItem key={id} icon={icon} label={label} onClick={() => { onCreate(id, type); setOpen(false) }} />
        ))}
        <MenuSeparator />
        <MenuItem icon={Search} label="Search in New Tab…" shortcut="⌘T" onClick={() => { onSearch(); setOpen(false) }} />
      </PopoverSurface>
    </Popover>
  )
}

const SPACES: { id: SpaceId; type: TabType; label: string; icon: LucideIcon; tip: string }[] = [
  { id: 'scripture', type: 'bible',   label: 'Scripture', icon: BookOpen,   tip: 'New Scripture tab' },
  { id: 'notes',     type: 'note',    label: 'Notes',     icon: NotepadText, tip: 'New Notes tab' },
  { id: 'lexicon',   type: 'lexicon', label: 'Lexicon',   icon: BookMarked, tip: 'New Lexicon tab' },
  { id: 'youtube',   type: 'youtube', label: 'YouTube',   icon: Youtube,    tip: 'New YouTube tab' },
]

// Module-level (not per-render) so SessionsSection.tsx (Settings → data hub)
// can reuse the exact same icon set for the fuller rename/icon/delete
// controls that used to live only in this sidebar popover.
export const SESSION_ICONS: { name: string; Icon: LucideIcon }[] = [
  { name: 'BookOpen', Icon: BookOpen },
  { name: 'BookMarked', Icon: BookMarked },
  { name: 'FileText', Icon: NotepadText },
  { name: 'Star', Icon: Star },
  { name: 'Flame', Icon: Flame },
  { name: 'Leaf', Icon: Leaf },
  { name: 'Globe', Icon: Globe },
  { name: 'Compass', Icon: Compass },
  { name: 'Shield', Icon: Shield },
  { name: 'Layers', Icon: Layers },
  { name: 'Feather', Icon: Feather },
  { name: 'Anchor', Icon: Anchor },
  { name: 'Crown', Icon: Crown },
  { name: 'Zap', Icon: Zap },
  { name: 'Heart', Icon: Heart },
  { name: 'Cloud', Icon: Cloud },
  { name: 'Mountain', Icon: Mountain },
  { name: 'Fish', Icon: Fish },
  { name: 'Key', Icon: Key },
  { name: 'Bell', Icon: Bell },
  { name: 'Clock', Icon: Clock },
  { name: 'Home', Icon: Home },
  { name: 'Map', Icon: Map },
  { name: 'Gem', Icon: Gem },
  { name: 'Search', Icon: Search },
  { name: 'Music2', Icon: Music2 },
  { name: 'Sun', Icon: Sun },
  { name: 'Moon', Icon: Moon },
]

const SPACE_LABEL: Record<SpaceId, string> = {
  scripture: 'Scripture',
  notes: 'Notes',
  lexicon: 'Lexicon',
  youtube: 'YouTube',
  search: 'Search',
}

export default function Sidebar() {
  const activeSpace  = useAppStore((s) => s.activeSpace)
  // Sidebar genuinely needs all 5 spaces — it lists tabs across scripture/notes/lexicon/youtube
  // (SPACES.flatMap below) and can show a currentTab from any space (activeSpace, including
  // 'search'). useShallow compares each space's array reference individually, so a write in one
  // space (e.g. a scroll-position tick in Scripture) no longer re-renders this on writes that
  // don't touch that space's own array. See BiblePanel.tsx's comment for the underlying cause.
  const tabs         = useAppStore(useShallow((s) => s.tabs))
  const activeTabId  = useAppStore((s) => s.activeTabId)
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed)
  const sidebarWidth = useAppStore((s) => s.sidebarWidth)
  const setSidebarWidth = useAppStore((s) => s.setSidebarWidth)
  const [isResizingSidebar, setIsResizingSidebar] = useState(false)
  const sidebarResizeRef = useRef<{ startX: number; startWidth: number } | null>(null)

  // Publishes this sidebar's real width as a CSS var so global.css's ambient
  // background-animation layer (html.theme-anim-bg body::before) can clip itself out from
  // behind it — on mac this sidebar is `.material-bar` over a genuinely transparent Electron
  // window (`transparent: true, vibrancy: 'sidebar'` in electron/main.ts), not just a
  // translucent-looking CSS color, so the animated blob painting behind it visibly tinted what's
  // supposed to be neutral OS-blurred vibrancy — most noticeably along the whole left edge,
  // where this panel sits (see ShellHeader.tsx's matching `--berean-header-h` effect for the
  // other half of the same fix at the top-left corner, where the two overlap). Zero when
  // collapsed, matching the animated `width` this <aside> collapses to below.
  useEffect(() => {
    document.documentElement.style.setProperty('--berean-sidebar-w', sidebarCollapsed ? '0px' : `${sidebarWidth}px`)
  }, [sidebarCollapsed, sidebarWidth])
  // Bounds mirrored from the store's own setSidebarWidth clamp (kept here too since the drag
  // handler reads/writes the live value directly on every move, not through the setter's own
  // clamp on every tick — clamping locally avoids a store round-trip per rAF frame).
  function handleSidebarResizeMouseDown(e: React.MouseEvent) {
    sidebarResizeRef.current = { startX: e.clientX, startWidth: sidebarWidth }
    setIsResizingSidebar(true)
    e.preventDefault()
    let rafId: number | null = null
    let latestX = e.clientX
    function onMove(e: MouseEvent) {
      if (!sidebarResizeRef.current) return
      latestX = e.clientX
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        if (!sidebarResizeRef.current) return
        const delta = latestX - sidebarResizeRef.current.startX
        setSidebarWidth(Math.max(200, Math.min(360, sidebarResizeRef.current.startWidth + delta)))
      })
    }
    function onUp() {
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
      sidebarResizeRef.current = null
      setIsResizingSidebar(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }
  const createTab    = useAppStore((s) => s.createTab)
  const activateTab  = useAppStore((s) => s.activateTab)
  const closeTab     = useAppStore((s) => s.closeTab)
  const reorderTabs  = useAppStore((s) => s.reorderTabs)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const openSettings = useAppStore((s) => s.openSettings)
  const openSearch   = useAppStore((s) => s.openSearch)
  const appZoom      = useAppStore((s) => s.appZoom)
  const currentSessionId = useAppStore((s) => s.currentSessionId)
  const sessionDisplayOrders = useAppStore((s) => s.sessionDisplayOrders)
  const reorderTabDisplay    = useAppStore((s) => s.reorderTabDisplay)
  const noteChangeToken      = useAppStore((s) => s.noteChangeToken)

  // ── Tab-bar right-click context menu ──
  const [tabBarMenu, setTabBarMenu] = useState<{ x: number; y: number } | null>(null)
  const tabBarMenuRef = useRef<HTMLDivElement>(null)

  const tabListRef = useRef<HTMLDivElement>(null)
  // Arrow-key navigation between tab rows (TabBar marks each row's inner button
  // `data-roving`) — Enter activates the focused row via its own native button click.
  const tabListRovingNav = useRovingNav({ orientation: 'vertical', selector: '[data-roving]' })
  // Manual click-drag-to-move tracking for empty tab-list space — see the mousedown handler
  // below and app:moveWindowBy's own comment in electron/main.ts for why this doesn't use a
  // real `-webkit-app-region: drag` CSS region (would break double-click-to-search on the
  // same area, per the four prior failed attempts documented just below).
  const windowDragRef = useRef<{ lastScreenX: number; lastScreenY: number; moved: boolean } | null>(null)

  // ── Scripture button right-click → book list ──
  const [bookMenu, setBookMenu] = useState<{ x: number; y: number; books: Array<{ book: Book; textId: string }>; filter: string } | null>(null)
  const bookMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!tabBarMenu && !bookMenu) return
    function onDown(e: MouseEvent) {
      if (tabBarMenu && tabBarMenuRef.current && !tabBarMenuRef.current.contains(e.target as Node)) {
        setTabBarMenu(null)
      }
      if (bookMenu && bookMenuRef.current && !bookMenuRef.current.contains(e.target as Node)) {
        setBookMenu(null)
      }
    }
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') { setTabBarMenu(null); setBookMenu(null) } }
    function onClose() { setTabBarMenu(null); setBookMenu(null) }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onEsc)
    window.addEventListener(CLOSE_CONTEXT_MENUS_EVENT, onClose)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onEsc)
      window.removeEventListener(CLOSE_CONTEXT_MENUS_EVENT, onClose)
    }
  }, [tabBarMenu, bookMenu])

  // Double-click empty tab-bar space → open floating search for a new tab. Four earlier attempts
  // (element onMouseDown, document-capture onMouseDown, document-capture click, element
  // onDoubleClick while the container was still an app-drag-region) all failed to fire reliably —
  // Electron's OS-level drag hit-testing over an app-drag-region element intercepts the
  // mousedown/click gesture at the browser-process level before it's guaranteed to reach the
  // renderer, regardless of listener type or capture phase. The container itself was switched
  // from app-drag-region to no-drag below to make that reliable.
  //
  // Window-drag on the same empty space was later added back WITHOUT reverting to
  // app-drag-region — instead, the onMouseDown handler below tracks screen-space mouse deltas
  // manually and moves the window via app:moveWindowBy (IPC to BrowserWindow.setPosition), only
  // once real movement crosses a small threshold. Since the region is never marked as a CSS drag
  // region, dblclick keeps firing reliably exactly as above, and drag-to-move now also works on
  // the same pixels — the two gestures no longer have to fight over the same screen area.

  // ── Daily-note calendar — pinned permanently at the bottom of the
  // sidebar (not gated to the Notes space, not a toggle) so jumping to a
  // past/future daily note is always one click away regardless of what
  // space is currently active. Notes are re-fetched on mount and whenever
  // noteChangeToken bumps (any note create/update), so a freshly-created
  // daily note's dot appears immediately instead of only after remount. ──
  const [sbCalendarDate, setSbCalendarDate] = useState(new Date())
  const [sbCalendarNotes, setSbCalendarNotes] = useState<Note[]>([])

  useEffect(() => {
    getAllNotes(noteChangeToken).then(setSbCalendarNotes).catch(() => {})
  }, [noteChangeToken])

  // Resolve (find-or-create) the daily note BEFORE creating a tab, then stamp the new tab's
  // state with the resolved noteId synchronously — createTab alone leaves the tab in its default
  // `isNew: true` / blank-list state for one render pass, and the old flow (create the tab, then
  // dispatch an event a frame later to swap in the real note) visibly flashed an empty "New Note"
  // tab before the daily note appeared. Resolving first means the tab is created already pointing
  // at the right note, so NotesPanel's restore effect loads it directly with no intermediate state.
  // The shared find-or-create (src/lib/dailyNotes.ts) — the iPhone calendars use the same.

  async function openDailyNoteInTab(date: Date) {
    const noteId = await resolveDailyNoteId(date)
    if (!noteId) return
    const store = useAppStore.getState()

    // Reuse a Notes tab already pointed at THIS daily note instead of stacking a fresh duplicate
    // every time the same day is clicked (clicking the 5th three times used to leave three
    // identical tabs behind).
    const existing = (store.tabs.notes ?? []).find(
      (t) => t.type === 'note' && (t.state as { noteId?: string | null } | undefined)?.noteId === noteId,
    )
    if (existing) {
      store.activateTab(existing)
      store.bumpNoteToken()
      return
    }

    // Build the tab ALREADY carrying its title and noteId, rather than the old
    // createTab('note')-then-updateTabState() two-step. That two-step caused both reported
    // calendar bugs:
    //  - createTab stamps a note tab with the generic `title: 'Notes'` (see its `type === 'note'`
    //    branch in store/index.ts), and nothing in this path ever replaced it — so a daily note
    //    opened from the sidebar calendar sat in the tab bar labelled "Notes" instead of its date.
    //  - it left the tab observably `{ noteId: null, isNew: true }` between the two store writes.
    //    NotesPanel's restore AND persist effects both key on the active notes tab id, so a pass
    //    landing in that window sees a blank tab while `activeNote` is still the PREVIOUS tab's
    //    note — normally today's daily note — and can write that back over the day actually
    //    requested, which is exactly "opening a different day opens today's note".
    // The sibling openDailyNoteInNewTab() below already constructed its tab this way; matching
    // that shape means the two paths can no longer drift apart.
    store.addTab({
      id: `note-${noteId}-${Date.now()}`,
      spaceId: 'notes',
      type: 'note',
      title: dailyNoteTitle(date),
      state: { noteId, isNew: false },
    })
    useAppStore.getState().bumpNoteToken()
  }

  async function openDailyNoteInNewTab(date: Date) {
    const noteId = await resolveDailyNoteId(date)
    if (!noteId) return
    const store = useAppStore.getState()
    const notesTabId = store.activeTabId['notes']
    store.addTab({
      id: `note-${noteId}-${Date.now()}`,
      spaceId: 'notes',
      type: 'note',
      title: dailyNoteTitle(date),
      state: { noteId, isNew: false },
      ...(notesTabId ? { originTabId: notesTabId, originSpaceId: 'notes' as const } : {}),
    })
    useAppStore.getState().bumpNoteToken()
  }

  async function openDailyNoteInFloatingTab(date: Date) {
    const noteId = await resolveDailyNoteId(date)
    if (!noteId) return
    window.app.openFloatingTab('notes', { noteId })
    useAppStore.getState().bumpNoteToken()
  }

  async function deleteDailyNoteForDate(date: Date) {
    const note = findDailyNote(sbCalendarNotes, date)
    if (!note) return
    await window.notes.deleteNote(note.id).catch(() => {})
    useAppStore.getState().bumpNoteToken()
  }

  // Right-click on a calendar date (grid cell or the "Today" shortcut) — open/open-in-new-tab/
  // open-floating all create the daily note if it doesn't exist yet (same as a left click would);
  // delete only applies when one already exists, so the menu hides that option otherwise.
  const [dailyNoteMenu, setDailyNoteMenu] = useState<{ date: Date; x: number; y: number } | null>(null)
  const dailyNoteMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!dailyNoteMenu) return
    function onDown(e: MouseEvent) {
      if (dailyNoteMenuRef.current && !dailyNoteMenuRef.current.contains(e.target as Node)) setDailyNoteMenu(null)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setDailyNoteMenu(null) }
    function onCloseAll() { setDailyNoteMenu(null) }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey)
    window.addEventListener(CLOSE_CONTEXT_MENUS_EVENT, onCloseAll)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener(CLOSE_CONTEXT_MENUS_EVENT, onCloseAll)
    }
  }, [dailyNoteMenu])

  function selectSidebarCalendarDate(d: Date) {
    openDailyNoteInTab(d)
  }

  function openTodaysDailyNote() {
    openDailyNoteInTab(dailyNoteToday())
  }

  // If the active Notes tab is pointed at a daily note, sync the sidebar calendar to that
  // note's month/year and highlight its day — so switching to (or creating) a daily note
  // always brings the calendar view along with it.
  const activeNotesTabId = activeTabId['notes']
  const activeNotesTab = activeNotesTabId ? tabs.notes?.find(t => t.id === activeNotesTabId) : undefined
  const activeNoteId = activeNotesTab && activeNotesTab.type === 'note' ? (activeNotesTab.state as { noteId?: string | null }).noteId : null
  const activeDailyNote = activeNoteId
    ? sbCalendarNotes.find(n => n.id === activeNoteId && (n.type === 'daily' || n.type === 'journal' || (n.type === 'general' && !!(n.title?.startsWith('Daily — ') || n.title?.startsWith('Journal — ')))))
    : undefined
  const activeDailyDate = (() => {
    if (!activeDailyNote) return null
    const raw = activeDailyNote.title ?? ''
    const dateStr = raw.replace(/^(Daily|Journal) — /, '')
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      const [y, m, d] = dateStr.split('-').map(Number)
      return new Date(y, m - 1, d)
    }
    const parsed = new Date(dateStr)
    return isNaN(parsed.getTime()) ? null : parsed
  })()

  useEffect(() => {
    if (!activeDailyDate) return
    setSbCalendarDate(prev =>
      prev.getFullYear() === activeDailyDate.getFullYear() && prev.getMonth() === activeDailyDate.getMonth()
        ? prev
        : new Date(activeDailyDate.getFullYear(), activeDailyDate.getMonth(), 1),
    )
  }, [activeDailyDate?.getTime()])

  // Triggered by Ribbon.tsx's Scripture icon right-click — Ribbon and
  // Sidebar are now sibling components (Ribbon owns space-switching,
  // Sidebar/Explorer owns the tab list), so a plain custom event is the
  // simplest way for Ribbon to ask Sidebar to open the book menu it already
  // owns the state/popup-rendering for, without prop-drilling across App.tsx.
  useEffect(() => {
    function onOpenBookMenu(e: Event) {
      const { x, y } = (e as CustomEvent<{ x: number; y: number }>).detail
      openBookMenu(x, y)
    }
    window.addEventListener('berean:openScriptureBookMenu', onOpenBookMenu)
    return () => window.removeEventListener('berean:openScriptureBookMenu', onOpenBookMenu)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function openBookMenu(x: number, y: number) {
    const TEXT_IDS = ['kjva', 'lxx', 'enoch', 'jubilees', 'hermas', 't12p', 'asc_isaiah', 'recog_clement', 'apoc_elijah', 't_job', '1clement', 'apoc_abraham', 't_jacob', '2baruch']
    const results = await Promise.allSettled(
      TEXT_IDS.map(id => window.bible.getBooks(id).then(bs => ({ id, books: bs })))
    )
    const seen = new Set<string>()
    const entries: Array<{ book: Book; textId: string }> = []
    for (const r of results) {
      if (r.status !== 'fulfilled') continue
      for (const book of r.value.books) {
        if (!seen.has(book.id)) { seen.add(book.id); entries.push({ book: { ...book, name: normalizeBookName(book.name) }, textId: r.value.id }) }
      }
    }
    setBookMenu({ x, y, books: entries, filter: '' })
  }

  function openTabFromBook(entry: { book: Book; textId: string }) {
    setBookMenu(null)
    const store = useAppStore.getState()
    store.createTab('bible')
    setTimeout(() => {
      const s = useAppStore.getState()
      const tabId = s.activeTabId['scripture']
      if (tabId) s.updateTabState('scripture', tabId, {
        bookId: entry.book.id, chapter: 1, scrollPosition: 0,
        ...(entry.textId !== 'kjva' ? { translation: entry.textId.toUpperCase() } : {}),
      })
    }, 0)
  }

  // Current breadcrumb: Space › Tab title. Daily notes get a THIRD segment (Space ›
  // Daily › date) instead of collapsing "Daily" and the date into one — their title
  // is stored as "Daily — 2026-07-24" (dailyNoteTitle in NotesPanel.tsx), which read
  // fine as a single breadcrumb segment but buried the date (the part someone
  // actually wants to glance at) behind the word "Daily" every time.
  const currentTab = tabs[activeSpace].find((t) => t.id === activeTabId[activeSpace])
  const spaceLabel = SPACE_LABEL[activeSpace]
  const tabTitle = currentTab?.title ?? ''
  const dailyNoteMatch = /^Daily — (\d{4}-\d{2}-\d{2})$/.exec(tabTitle)
  const breadcrumbTail = dailyNoteMatch ? ['Daily', dailyNoteMatch[1]] : [tabTitle]

  // The sidebar's LIVE width (mid-animation, mid-drag) for the macOS glass pane cut-out
  // (SidebarGlassPane.tsx / global.css .shell-pane-hole) — written straight to a CSS variable so
  // the pane tracks every frame without a React render.
  const liveWidthRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = liveWidthRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const root = document.documentElement
    const write = () => root.style.setProperty('--sidebar-live-w', `${el.getBoundingClientRect().width}px`)
    write()
    const ro = new ResizeObserver(write)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Build the unified tab list, respecting the session's custom display order.
  // New tabs not yet in the order are appended; closed tabs are silently dropped.
  // Memoised: this ran on every render (incl. every activeTabId change / scroll tick
  // that re-renders the sidebar) and rebuilds several arrays; TabBar takes it as a
  // prop, so a fresh identity also churned TabBar's own work.
  const storedOrder = sessionDisplayOrders[currentSessionId] ?? []
  const orderedTabs = useMemo(() => {
    const allTabsFlat = SPACES.flatMap((s) => tabs[s.id])
    if (storedOrder.length === 0) return allTabsFlat
    return [
      ...(storedOrder
        .map((id) => allTabsFlat.find((t) => t.id === id))
        .filter((t): t is import('@/types').Tab => t != null)),
      // Append any tabs added since the order was last saved
      ...allTabsFlat.filter((t) => !storedOrder.includes(t.id)),
    ]
  }, [tabs, storedOrder])
  // Ribbon.tsx (the always-visible workspace icon rail) now owns the
  // "icon-only" role the sidebar itself used to fall back to when
  // collapsed — so collapsing this Explorer pane now just hides it
  // entirely (Obsidian's own "toggle the file explorer" behavior), rather
  // than shrinking down to a second icon rail beside the ribbon. Animated
  // via the outer motion.div's width (clipping the fixed-width aside inside
  // it) so toggling reads as a slide — width-only, though, read as an abrupt
  // cut rather than a fade (the user-resizable-width content just gets clipped away by
  // the shrinking overflow-hidden box, with nothing actually fading). Opacity
  // is now animated too, on its OWN faster transition that finishes well
  // before the width spring does, so the content is already invisible by the
  // time it starts getting visually clipped — the clip itself is never seen,
  // and collapsing genuinely reads as a fade instead of a disappear.
  return (
    <motion.div
      ref={liveWidthRef}
      animate={{ width: sidebarCollapsed ? 0 : sidebarWidth, opacity: sidebarCollapsed ? 0 : 1 }}
      initial={false}
      transition={{
        // No tween while actively dragging the resize handle — an animated transition lagging
        // behind the live mouse position during a drag reads as sluggish/rubbery; only
        // collapse/expand (not a manual resize) is animated. §7.1: the sidebar/inspector/rail
        // panel-slide token, not the snappy spring (that's for geometry tracking the pointer).
        width: isResizingSidebar ? { duration: 0 } : PANEL_SLIDE,
        opacity: { duration: 0.12, ease: 'easeOut', delay: sidebarCollapsed ? 0 : 0.05 },
      }}
      className="h-full flex-shrink-0 overflow-hidden relative"
    >
      <aside
        style={{ width: sidebarWidth }}
        // no-drag, not app-drag-region: this used to be a real CSS drag region, which broke
        // ANY portaled popup that could end up visually overlapping it — most notably the
        // tab-bar right-click context menu (TabBar.tsx), which is `position: fixed` at the raw
        // click coordinates and, for any tab beyond the first few in the list, commonly extends
        // past tabListRef's own (already no-drag) bottom edge into this <aside>'s still-drag
        // area below it (e.g. over the daily-note calendar). Per this file's own prior findings
        // just above (four failed attempts to fix double-click on empty tab-list space): an
        // overlapping no-drag portal does NOT reliably suppress Electron's drag-region hit-test
        // over a real `-webkit-app-region: drag` ancestor elsewhere on screen — the click gets
        // eaten as a window-drag gesture before the renderer ever sees it, regardless of paint
        // order or z-index. Window-dragging from the header/ribbon (ShellHeader.tsx,
        // Ribbon.tsx — both still real app-drag-region) is unaffected; only "drag the window by
        // clicking blank sidebar chrome outside the tab list" is given up here, same tradeoff
        // already made for the tab-list area itself via the manual moveWindowBy() drag below.
        className="shell-sidebar no-drag select-none flex flex-col flex-shrink-0 h-full material-sidebar border-r border-separator"
        // Clicking anywhere in the sidebar (switching tabs/spaces, etc.) should close any
        // open overlay elsewhere (Ribbon's archive-tabs list, zoom popover, session menu) —
        // those already listen for this broadcast (see HeaderOverflowMenu.tsx, Ribbon.tsx,
        // usePositionedMenu.ts), Sidebar just wasn't one of the places that fired it.
        //
        // ROOT CAUSE of "tab context menu — menu opens, clicking any item does nothing"
        // (4 rounds of investigation): TabBar's own tab-list — and the context menu it
        // portals to document.body — renders INSIDE this <aside>. React bubbles a portaled
        // element's synthetic events through the REACT tree, not the physical DOM tree, so a
        // click on ANY button inside that portaled menu (Duplicate tab, Close tab, etc.) was
        // ALSO captured here, since this is a capture-phase ancestor in the React tree. That
        // fired 'berean:closeMenus' — which usePositionedMenu.ts listens for and closes the
        // menu on — BEFORE the click's bubble phase ever reached the button's own onClick,
        // unmounting the menu (and the button) out from under the click. The menu's OWN
        // "click outside closes it" logic (the same file's mousedown-based onDown) already
        // correctly ignores clicks genuinely inside the menu; this second, broader broadcast
        // just wasn't excluding them at all. Guard: skip the broadcast for a click that
        // originates inside ANY currently-open context menu (`[role="menu"]`, the semantic
        // marker MenuSurface itself renders — see Menu.tsx) — those clicks should be handled
        // by that menu's own item, not treated as "user clicked away, close overlays."
        onClickCapture={(e) => {
          if ((e.target as HTMLElement).closest('[role="menu"]')) return
          window.dispatchEvent(new Event('berean:closeMenus'))
        }}
      >
        {/* The session switcher is a toolbar control now (SessionSwitcher.tsx, in ShellHeader). */}

        {/* ── Search / location bar — own row, full sidebar width. Back/forward nav,
             history, archive, settings, and collapse now live in the shared TopBar
             above the sidebar+content row, not here. ── */}
        <div className="px-2 pt-1 pb-1 flex-shrink-0">
          {/* BarMetrics: this row is a bar even though it is not a `Toolbar`, so its field and
              its + button step up to the one 32px control height the toolbars use (see
              metrics.tsx) instead of rendering 28 beside 24. */}
          <BarMetrics>
          <div className="no-drag flex items-center gap-1">
            {/* Location bar — shows breadcrumb, click to search in current tab */}
            <ListRow
              dense
              radius="capsule"
              className="flex-1"
              buttonClassName="control-field bg-field hover:bg-control-hover h-9 px-4 text-subhead"
              leading={<Search size={14} className="text-text-muted" />}
              onClick={() => openSearch('current')}
              title={
                tabTitle ? (
                  // Only show "Space > Tab" breadcrumb when the tab has a meaningful
                  // title different from the space name (e.g. "YouTube > Video Title").
                  // When the tab title equals the space name (default empty tab), show
                  // just the space label to avoid "YouTube > YouTube".
                  tabTitle.toLowerCase() === spaceLabel.toLowerCase() ? (
                    <span className="text-footnote text-text-secondary truncate" style={{ zoom: appZoom }}>{spaceLabel}</span>
                  ) : (
                    <span className="flex items-center gap-0.5 min-w-0" style={{ zoom: appZoom }}>
                      <span className="text-caption2 text-text-muted flex-shrink-0">{spaceLabel}</span>
                      {breadcrumbTail.map((seg, i) => (
                        <span key={i} className="flex items-center gap-0.5 min-w-0">
                          <ChevronRight size={9} className="text-text-tertiary flex-shrink-0" />
                          <span className={`text-footnote text-text-secondary truncate ${i < breadcrumbTail.length - 1 ? 'flex-shrink-0' : ''}`}>{seg}</span>
                        </span>
                      ))}
                    </span>
                  )
                ) : (
                  <span className="text-footnote text-text-muted truncate" style={{ zoom: appZoom }}>Search…</span>
                )
              }
            />
          </div>
          </BarMetrics>
        </div>

        {/* ── New Tab — ONE creation affordance (TEST 2026-10-05) replacing the "+" beside the
             search field and the row of four tab-type tiles: the source list's first row, like
             Safari / Arc's "New Tab". It opens a labelled menu — Scripture · Notes · Lexicon ·
             YouTube · Search in New Tab — so the sidebar reads navigation · search · content.
             ⌘T and the tab list's right-click menu are unchanged. ── */}
        <div className="px-2 pb-1 flex-shrink-0">
          <NewTabMenu
            onCreate={(id, type) => { createTab(type); useAppStore.getState().setActiveSpace(id) }}
            onSearch={() => openSearch('new')}
          />
        </div>

            <div
              ref={tabListRef}
              // §7.1: 8px inset from the sidebar edges — rows sit as an inset selection list
              // (macOS source list), not flush full-bleed.
              className="no-drag flex-1 overflow-y-auto min-h-0 scrollbar-none px-2"
              onKeyDown={tabListRovingNav}
              onDoubleClick={(e) => {
                const t = e.target as HTMLElement
                if (t.closest('[data-tab-idx]')) return
                // Universal placement rule: double-click empty tab-bar space is the ONE case
                // that appends at the very end, unlike every other "new tab" entry point
                // (Cmd+T, the "+" buttons, "open in new tab" from content), which insert
                // directly after the active tab — see computeInsertOrder in store/index.ts.
                openSearch('new', 'all', 'end')
              }}
              // Click-drag-to-move on empty space — same target guard as the double-click
              // handler above (skip actual tab items; both affordances share this area).
              // Tracks screen-space deltas via a window-level mousemove/mouseup pair (not React
              // handlers on this element) so movement is still tracked even if the cursor
              // leaves this element mid-drag. A small movement threshold before the first
              // moveWindowBy call keeps a plain click/double-click from ever nudging the
              // window — only a genuine sustained drag engages it.
              onMouseDown={(e) => {
                const t = e.target as HTMLElement
                if (t.closest('[data-tab-idx]')) return
                if (e.button !== 0) return
                windowDragRef.current = { lastScreenX: e.screenX, lastScreenY: e.screenY, moved: false }
                const DRAG_THRESHOLD = 4
                function onMove(ev: MouseEvent) {
                  const drag = windowDragRef.current
                  if (!drag) return
                  const dx = ev.screenX - drag.lastScreenX
                  const dy = ev.screenY - drag.lastScreenY
                  if (!drag.moved && Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return
                  drag.moved = true
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
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                const MENU_W = 208; const MENU_H = 160; const pad = 8
                setTabBarMenu({
                  x: Math.max(pad, Math.min(e.clientX, window.innerWidth  - MENU_W - pad)),
                  y: Math.max(pad, Math.min(e.clientY, window.innerHeight - MENU_H - pad)),
                })
              }}
              // Accept note-item drags anywhere in the tab list area (fallback for gaps between tabs)
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('berean-note-id')) {
                  e.preventDefault()
                  e.stopPropagation()
                }
              }}
              onDrop={(e) => {
                const noteId    = e.dataTransfer.getData('berean-note-id')
                const noteTitle = e.dataTransfer.getData('berean-note-title')
                if (!noteId) return
                e.preventDefault(); e.stopPropagation()
                const store = useAppStore.getState()
                const tab = {
                  id:      `note-${noteId}-${Date.now()}`,
                  spaceId: 'notes' as const,
                  type:    'note'  as const,
                  title:   noteTitle || 'Note',
                  state:   { noteId, isNew: false },
                }
                store.addTab(tab as import('@/types').Tab)
                store.activateTab(tab as import('@/types').Tab)
                store.setActiveSpace('notes')
              }}
            >
              <TabBar
                tabs={orderedTabs}
                activeTabId={activeTabId[activeSpace]}
                // §7.1 narrow mode: below 240px, hide the compare/LXX meta chips and keep icon + title.
                narrow={sidebarWidth < 240}
                onTabClick={(tab) => {
                  // Fire synchronously so panels can snapshot their scroll/cursor before React re-renders
                  window.dispatchEvent(new CustomEvent('berean:saveScrollBeforeTabChange'))
                  activateTab(tab)
                }}
                onTabClose={(tab) => {
                  window.dispatchEvent(new CustomEvent('berean:saveScrollBeforeTabChange'))
                  closeTab(tab.spaceId, tab.id)
                }}
                onReorder={(fromId, toId, before) =>
                  reorderTabDisplay(currentSessionId, fromId, toId, before)
                }
              />
            </div>

        {/* ── Daily-note calendar — pinned permanently at the bottom, not
             gated to the Notes space and not a toggle (sessions used to
             live in this footer slot; they moved to the rail as numbered
             chips, freeing this spot for the calendar). A plain top hairline
             (no bordered card) so it reads as a native sidebar section, the
             same way Finder/Mail sidebar sections are just separated by a
             rule rather than each getting their own card chrome. ── */}
        <div className="mx-2 mb-1 mt-1.5 pt-2 border-t border-separator flex-shrink-0">
          <CalendarGrid
            date={sbCalendarDate}
            notes={sbCalendarNotes}
            onDateChange={setSbCalendarDate}
            onSelectDate={selectSidebarCalendarDate}
            onContextMenu={(d, x, y) => setDailyNoteMenu({ date: d, x, y })}
            selectedDate={activeDailyDate}
            compact
            todayAction={
              <IconButton
                icon={CalendarCheck}
                label="Today's daily note"
                size={24}
                onClick={openTodaysDailyNote}
                onContextMenu={(e) => { e.preventDefault(); setDailyNoteMenu({ date: dailyNoteToday(), x: e.clientX, y: e.clientY }) }}
              />
            }
          />
        </div>

        {/* ── Sidebar command bar — the workspace commands with no other visible home (archived
             tabs, presenter, Read Aloud, Study Trail, Berean Chat, Settings), as quiet icons at the
             foot of the sidebar instead of a hover-revealed floating rail (Ribbon layout="bar"). ── */}
        <div className="mx-2 mb-1.5 flex-shrink-0">
          <Ribbon layout="bar" />
        </div>

      {/* ── Tab-bar right-click context menu ── */}
      {tabBarMenu && createPortal(
        <MenuPositioner ref={tabBarMenuRef} x={tabBarMenu.x} y={tabBarMenu.y}>
          <MenuSurface className="min-w-44">
            {SPACES.map(({ id, type, icon: Icon, tip }) => (
              <MenuItem
                key={id}
                icon={Icon}
                label={tip}
                onClick={() => { createTab(type); useAppStore.getState().setActiveSpace(id); setTabBarMenu(null) }}
              />
            ))}
            <MenuItem
              icon={Search}
              label="Search / new tab…"
              onClick={() => { openSearch('new'); setTabBarMenu(null) }}
            />
            <MenuSeparator />
            <MenuItem
              icon={PanelLeft}
              label={sidebarCollapsed ? 'Expand explorer' : 'Collapse explorer'}
              onClick={() => { toggleSidebar(); setTabBarMenu(null) }}
            />
            <MenuItem
              icon={Settings}
              label="Theme settings"
              onClick={() => { openSettings(); setTabBarMenu(null) }}
            />
          </MenuSurface>
        </MenuPositioner>,
        document.body
      )}

      {/* ── Scripture right-click → book list ── */}
      {bookMenu && createPortal(
        <MenuPositioner ref={bookMenuRef} x={bookMenu.x} y={bookMenu.y}>
          <MenuSurface className="w-56 max-h-[70vh] flex flex-col">
            {/* Filter input — sticky at top */}
            <div className="flex items-center gap-1.5 pb-1.5 border-b border-separator flex-shrink-0">
              <Search size={12} className="text-text-muted flex-shrink-0" />
              <TextField
                autoFocus
                bare
                size="sm"
                value={bookMenu.filter}
                onChange={(e) => setBookMenu(prev => prev ? { ...prev, filter: e.target.value } : null)}
                placeholder="Filter books…"
                wrapperClassName="flex-1"
              />
            </div>
            <div className="overflow-y-auto flex-1 pt-1">
              {(() => {
                const q = bookMenu.filter.toLowerCase()
                const filtered = q ? bookMenu.books.filter(e => e.book.name.toLowerCase().includes(q)) : bookMenu.books
                if (filtered.length === 0) {
                  return <div className="px-2 py-2 text-text-muted text-center">No books found</div>
                }
                if (q) {
                  // Flat list when filtering
                  return filtered.map(entry => (
                    <MenuItem
                      key={entry.book.id}
                      label={entry.book.name}
                      trailing={entry.textId !== 'kjva' ? <span className="text-micro text-text-tertiary font-mono uppercase">{entry.textId}</span> : undefined}
                      onClick={() => openTabFromBook(entry)}
                    />
                  ))
                }
                // Grouped by testament when not filtering
                return (['OT', 'NT', 'Apocrypha', 'Pseudepigrapha'] as const).map((testament) => {
                  const group = filtered.filter(e => e.book.testament === testament)
                  if (group.length === 0) return null
                  return (
                    <div key={testament}>
                      <MenuLabel className="mt-1">{testament}</MenuLabel>
                      {group.map(entry => (
                        <MenuItem
                          key={entry.book.id}
                          label={entry.book.name}
                          trailing={entry.textId !== 'kjva' ? <span className="text-micro text-text-tertiary font-mono uppercase">{entry.textId}</span> : undefined}
                          onClick={() => openTabFromBook(entry)}
                        />
                      ))}
                    </div>
                  )
                })
              })()}
            </div>
          </MenuSurface>
        </MenuPositioner>,
        document.body
      )}


      {/* ── Daily-note calendar right-click (grid cells + the "Today" shortcut) ── */}
      {dailyNoteMenu && createPortal(
        <MenuPositioner ref={dailyNoteMenuRef} x={dailyNoteMenu.x} y={dailyNoteMenu.y}>
          <MenuSurface className="min-w-[190px]">
            <MenuItem icon={PanelRightOpen} label="Open" onClick={() => { openDailyNoteInTab(dailyNoteMenu.date); setDailyNoteMenu(null) }} />
            <MenuItem icon={ExternalLink} label="Open in new tab" onClick={() => { openDailyNoteInNewTab(dailyNoteMenu.date); setDailyNoteMenu(null) }} />
            <MenuItem icon={Monitor} label="Open in floating tab" onClick={() => { openDailyNoteInFloatingTab(dailyNoteMenu.date); setDailyNoteMenu(null) }} />
            {findDailyNote(sbCalendarNotes, dailyNoteMenu.date) && (
              <>
                <MenuSeparator />
                <MenuItem icon={Trash2} label="Delete note" danger onClick={() => { deleteDailyNoteForDate(dailyNoteMenu.date); setDailyNoteMenu(null) }} />
              </>
            )}
          </MenuSurface>
        </MenuPositioner>,
        document.body
      )}
      </aside>
    {/* Resize handle — thin strip on the sidebar's right edge, only visible on hover (matching
        the side-panel's own hDivider convention in BiblePanel.tsx). Sits on the motion.div
        itself (not the inner aside) so it stays pinned to the right edge regardless of the
        collapse/expand width animation. */}
    {!sidebarCollapsed && (
      <Tooltip label="Drag to resize">
        <div
          onMouseDown={handleSidebarResizeMouseDown}
          className="group absolute top-0 right-0 h-full w-1.5 -mr-0.5 cursor-col-resize z-raised no-drag"
        >
          <div className="w-px h-full mx-auto bg-transparent group-hover:bg-accent/40 transition-colors" />
        </div>
      </Tooltip>
    )}
    </motion.div>
  )
}
