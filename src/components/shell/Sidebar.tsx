import * as Tooltip from '@radix-ui/react-tooltip'
import * as Popover from '@radix-ui/react-popover'
import { motion } from 'framer-motion'
import { BookOpen, FileText, BookMarked, Youtube, Search, Settings, PanelLeft, Plus, ChevronRight, ChevronsUpDown, Check, Pencil, Palette, Hash, Trash2, Layers, Star, Flame, Leaf, Globe, Compass, Shield, Feather, Anchor, Crown, Zap, Heart, Cloud, Mountain, Fish, Key, Bell, Clock, Home, Map, Gem, Music2, Sun, Moon, CalendarDays, PanelRightOpen, ExternalLink, Monitor, type LucideIcon } from 'lucide-react'
import { useAppStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import TabBar from './TabBar'
import type { SpaceId, TabType } from '@/types'
import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { MenuPositioner, CLOSE_CONTEXT_MENUS_EVENT } from '@/lib/usePositionedMenu'
import { normalizeBookName } from '@/lib/parseRef'
import { getAllNotes } from '@/lib/notesCache'
import type { Book, Note } from '@/types'
import { CalendarGrid, toDateKey, findDailyNote } from '@/components/notes/CalendarWidget'
import { dailyNoteTitle, dailyNoteToday } from '@/lib/dailyNoteUtils'

const SPACES: { id: SpaceId; type: TabType; label: string; icon: LucideIcon; tip: string }[] = [
  { id: 'scripture', type: 'bible',   label: 'Scripture', icon: BookOpen,   tip: 'New Scripture tab' },
  { id: 'notes',     type: 'note',    label: 'Notes',     icon: FileText,   tip: 'New Notes tab' },
  { id: 'lexicon',   type: 'lexicon', label: 'Lexicon',   icon: BookMarked, tip: 'New Lexicon tab' },
  { id: 'youtube',   type: 'youtube', label: 'YouTube',   icon: Youtube,    tip: 'New YouTube tab' },
]

// Module-level (not per-render) so SessionsSection.tsx (Settings → data hub)
// can reuse the exact same icon set for the fuller rename/icon/delete
// controls that used to live only in this sidebar popover.
export const SESSION_ICONS: { name: string; Icon: LucideIcon }[] = [
  { name: 'BookOpen', Icon: BookOpen },
  { name: 'BookMarked', Icon: BookMarked },
  { name: 'FileText', Icon: FileText },
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
        setSidebarWidth(Math.max(224, Math.min(250, sidebarResizeRef.current.startWidth + delta)))
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

  // ── Sessions — moved here from Ribbon.tsx's narrow icon rail, which only
  // ever showed the current session's name on hover (a tooltip). The sidebar
  // has real width to spend, so the current session's name is always visible
  // as text in its own row above the search/location bar, not hidden behind
  // a hover. Clicking it opens the same full session-list popover the old
  // "+" trigger did; right-clicking (or the row's own icon button) still
  // offers rename/change-icon/delete via the same portaled menu pattern as
  // bookMenu/tabBarMenu below. ──
  const sessions          = useAppStore((s) => s.sessions)
  const switchSession     = useAppStore((s) => s.switchSession)
  const createSession     = useAppStore((s) => s.createSession)
  const deleteSession     = useAppStore((s) => s.deleteSession)
  const renameSession     = useAppStore((s) => s.renameSession)
  const setSessionIcon    = useAppStore((s) => s.setSessionIcon)
  const openSettingsToSessions = useAppStore((s) => s.openSettingsToSessions)
  const [sessionPopoverOpen, setSessionPopoverOpen] = useState(false)
  const [sessionMenu, setSessionMenu] = useState<{ x: number; y: number; sessionId: string } | null>(null)
  const [sessionMenuMode, setSessionMenuMode] = useState<'default' | 'rename' | 'icon'>('default')
  const [renameValue, setRenameValue] = useState('')
  const sessionMenuRef = useRef<HTMLDivElement>(null)
  const currentSession = sessions.find((s) => s.id === currentSessionId) ?? sessions[0]
  const currentSessionIdx = sessions.findIndex((s) => s.id === currentSessionId)
  const CurrentSessionIcon = (SESSION_ICONS.find((i) => i.name === currentSession?.icon) ?? SESSION_ICONS[0]).Icon

  useEffect(() => {
    if (!sessionMenu) return
    function onDown(e: MouseEvent) {
      if (sessionMenuRef.current && !sessionMenuRef.current.contains(e.target as Node)) { setSessionMenu(null); setSessionMenuMode('default') }
    }
    function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') { setSessionMenu(null); setSessionMenuMode('default') } }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onEsc)
    return () => { window.removeEventListener('mousedown', onDown, true); window.removeEventListener('keydown', onEsc) }
  }, [sessionMenu])

  // `closePopover` defaults to true (right-clicking the trigger button, where the session
  // list popover isn't open yet). Right-clicking a row INSIDE the already-open popover
  // passes false, so the session list stays visible behind the rename/icon/delete submenu
  // instead of vanishing the instant you right-click.
  function openSessionMenu(x: number, y: number, sessionId: string, currentName: string, closePopover = true) {
    if (closePopover) setSessionPopoverOpen(false)
    setSessionMenuMode('default')
    setRenameValue(currentName)
    setSessionMenu({ x, y, sessionId })
  }

  // ── Tab-bar right-click context menu ──
  const [tabBarMenu, setTabBarMenu] = useState<{ x: number; y: number } | null>(null)
  const tabBarMenuRef = useRef<HTMLDivElement>(null)

  const tabListRef = useRef<HTMLDivElement>(null)
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
  async function resolveDailyNoteId(date: Date): Promise<string | null> {
    const title = dailyNoteTitle(date)
    let noteId: string | null = null
    try {
      const candidates = await window.notes.searchNotes(title, 5)
      noteId = candidates.find(n => n.title === title && n.type === 'daily')?.id ?? null
    } catch { /* fall through to create */ }
    if (!noteId) {
      const result = await window.notes.createNote({ title, content: '', type: 'daily' })
      if (result.success && result.note) noteId = result.note.id
    }
    return noteId
  }

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

  // Build the unified tab list, respecting the session's custom display order.
  // New tabs not yet in the order are appended; closed tabs are silently dropped.
  const allTabsFlat = SPACES.flatMap((s) => tabs[s.id])
  const storedOrder = sessionDisplayOrders[currentSessionId] ?? []
  const orderedTabs = storedOrder.length === 0
    ? allTabsFlat
    : [
        ...(storedOrder
          .map((id) => allTabsFlat.find((t) => t.id === id))
          .filter((t): t is import('@/types').Tab => t != null)),
        // Append any tabs added since the order was last saved
        ...allTabsFlat.filter((t) => !storedOrder.includes(t.id)),
      ]

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
      animate={{ width: sidebarCollapsed ? 0 : sidebarWidth, opacity: sidebarCollapsed ? 0 : 1 }}
      initial={false}
      transition={{
        // No spring while actively dragging the resize handle — a spring lagging behind the
        // live mouse position during a drag reads as sluggish/rubbery; only collapse/expand
        // (not a manual resize) benefits from the spring feel.
        width: isResizingSidebar ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 45 },
        opacity: { duration: 0.12, ease: 'easeOut', delay: sidebarCollapsed ? 0 : 0.05 },
      }}
      className="h-full flex-shrink-0 overflow-hidden relative"
    >
    {/* disableHoverableContent — same fix as Ribbon.tsx: none of these
        tooltips have interactive content, so Radix's hoverable-content grace
        area (kept open/interactive between trigger and tooltip) served no
        purpose and could overlap nearby context menus (tab-bar right-click,
        book-picker) that open close to a tooltip-having trigger. */}
    <Tooltip.Provider delayDuration={200} disableHoverableContent>
      <aside
        style={{ width: sidebarWidth }}
        className={`
          native-buttons app-drag-region flex flex-col flex-shrink-0 h-full
          ${window.__berean_platform === 'darwin' ? 'sidebar-vibrant' : "bg-[rgb(var(--color-surface-2))] shadow-[inset_0_1px_0_0_rgb(var(--color-surface-4)/0.35),1px_0_12px_-4px_rgb(0_0_0/0.25)]"}
          border-r border-[rgb(var(--color-surface-4))]
        `}
        // Clicking anywhere in the sidebar (switching tabs/spaces, etc.) should close any
        // open overlay elsewhere (Ribbon's archive-tabs list, zoom popover, session menu) —
        // those already listen for this broadcast (see HeaderOverflowMenu.tsx, Ribbon.tsx,
        // usePositionedMenu.ts), Sidebar just wasn't one of the places that fired it.
        onClickCapture={() => window.dispatchEvent(new Event('berean:closeMenus'))}
      >
        {/* ── Session switcher — own row, full sidebar width, always shows the
             current session's name as text (never just an icon behind a
             hover tooltip). Deliberately quieter than the search/location bar
             below it (no background/border at rest, muted text) — it's a
             secondary, occasional action, not something that should compete
             with the search bar for visual attention. Click opens the full
             session list to switch; right-click (or the icon button) opens
             rename/change-icon/delete. ── */}
        <div className="px-2 pt-1 flex-shrink-0">
          <Popover.Root open={sessionPopoverOpen} onOpenChange={(v) => { if (v) { setSessionMenu(null); setSessionMenuMode('default') }; setSessionPopoverOpen(v) }}>
            <Popover.Trigger asChild>
              <button
                className="no-drag w-full flex items-center gap-1.5 px-2 py-1 rounded-shell hover:bg-[rgb(var(--color-surface-3))] text-left transition-colors cursor-pointer min-w-0"
                onContextMenu={(e) => {
                  e.preventDefault()
                  if (currentSession) openSessionMenu(e.clientX, e.clientY, currentSession.id, currentSession.name)
                }}
              >
                <CurrentSessionIcon size={12} className="text-[rgb(var(--color-text-muted))] flex-shrink-0 opacity-70" />
                <span className="flex-1 text-[11px] text-[rgb(var(--color-text-muted))] truncate" style={{ zoom: appZoom }}>
                  {currentSession ? currentSession.name : `Session ${currentSessionIdx + 1}`}
                </span>
                <ChevronsUpDown size={11} className="text-[rgb(var(--color-text-muted))] flex-shrink-0 opacity-50" />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                side="bottom" align="start" sideOffset={4}
                className="no-drag z-50 w-52 rounded-shell-lg bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] shadow-xl p-1"
                // The rename/icon/delete submenu is portaled separately (to document.body,
                // outside this Popover.Content), so Radix's own outside-interaction dismissal
                // would otherwise treat clicks inside it as "outside" and auto-close this
                // popover — undoing the point of keeping it open. Ignore interactions that
                // land inside the still-open submenu.
                onInteractOutside={(e) => {
                  if (sessionMenuRef.current && sessionMenuRef.current.contains(e.target as Node)) e.preventDefault()
                }}
              >
                {sessions.map((session) => {
                  const SessionIcon = (SESSION_ICONS.find(i => i.name === session.icon) ?? SESSION_ICONS[0]).Icon
                  return (
                    <button
                      key={session.id}
                      className={`no-drag w-full flex items-center gap-2 rounded-shell px-2 py-1.5 cursor-pointer text-left
                        ${session.id === currentSessionId
                          ? 'bg-[rgb(var(--color-accent))/15] text-[rgb(var(--color-accent))]'
                          : 'hover:bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))]'
                        }`}
                      onClick={() => { if (session.id !== currentSessionId) { switchSession(session.id); setSessionPopoverOpen(false) } }}
                      onContextMenu={(e) => { e.preventDefault(); openSessionMenu(e.clientX, e.clientY, session.id, session.name, false) }}
                    >
                      <SessionIcon size={13} className="flex-shrink-0" />
                      <span className="flex-1 text-xs truncate">{session.name}</span>
                      {session.id === currentSessionId && <Check size={11} className="flex-shrink-0 text-[rgb(var(--color-accent))]" />}
                    </button>
                  )
                })}
                <div className="my-1 h-px bg-[rgb(var(--color-surface-4))]" />
                <button
                  className="no-drag w-full flex items-center gap-2 px-2 py-1.5 rounded-shell text-xs text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                  onClick={() => { createSession(); setSessionPopoverOpen(false) }}
                >
                  <Plus size={12} />
                  New session <span className="ml-auto opacity-50">⌘⇧0</span>
                </button>
                <button
                  className="no-drag w-full flex items-center gap-2 px-2 py-1.5 rounded-shell text-xs text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                  onClick={() => { openSettingsToSessions(); setSessionPopoverOpen(false) }}
                >
                  <Settings size={12} />
                  Manage sessions…
                </button>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>

        {/* ── Search / location bar — own row, full sidebar width. Back/forward nav,
             history, archive, settings, and collapse now live in the shared TopBar
             above the sidebar+content row, not here. ── */}
        <div className="px-2 pt-1 pb-1 flex-shrink-0">
          <div className="no-drag flex items-center gap-1">
            {/* Location bar — shows breadcrumb, click to search in current tab */}
            <button
              onClick={() => openSearch('current')}
              className="flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-shell bg-[rgb(var(--color-surface-4))] hover:bg-[rgb(var(--color-surface-4))/70] text-left transition-colors cursor-pointer min-w-0"
            >
              <Search size={14} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
              {tabTitle ? (
                // Only show "Space > Tab" breadcrumb when the tab has a meaningful
                // title different from the space name (e.g. "YouTube > Video Title").
                // When the tab title equals the space name (default empty tab), show
                // just the space label to avoid "YouTube > YouTube".
                tabTitle.toLowerCase() === spaceLabel.toLowerCase() ? (
                  <span className="text-[11px] text-[rgb(var(--color-text-secondary))] truncate flex-1" style={{ zoom: appZoom }}>{spaceLabel}</span>
                ) : (
                  <span className="flex items-center gap-0.5 min-w-0 flex-1" style={{ zoom: appZoom }}>
                    <span className="text-[10px] text-[rgb(var(--color-text-muted))] flex-shrink-0">{spaceLabel}</span>
                    {breadcrumbTail.map((seg, i) => (
                      <span key={i} className="flex items-center gap-0.5 min-w-0">
                        <ChevronRight size={9} className="text-[rgb(var(--color-text-muted))] flex-shrink-0 opacity-50" />
                        <span className={`text-[11px] text-[rgb(var(--color-text-secondary))] truncate ${i < breadcrumbTail.length - 1 ? 'flex-shrink-0' : ''}`}>{seg}</span>
                      </span>
                    ))}
                  </span>
                )
              ) : (
                <span className="text-xs text-[rgb(var(--color-text-muted))] truncate" style={{ zoom: appZoom }}>Search…</span>
              )}
            </button>
            {/* New tab search button */}
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button
                  onClick={() => openSearch('new')}
                  className="p-1.5 rounded-shell bg-[rgb(var(--color-surface-4))] hover:bg-[rgb(var(--color-accent))/15] hover:text-[rgb(var(--color-accent))] text-[rgb(var(--color-text-muted))] transition-colors cursor-pointer flex-shrink-0"
                >
                  <Plus size={14} />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content side="right" sideOffset={6} className="z-50 px-2 py-1 rounded text-xs bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] shadow-lg">
                  Search in new tab
                  <Tooltip.Arrow className="fill-[rgb(var(--color-surface-4))]" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          </div>
        </div>

        {/* ── New-tab tile row — one square tile per space, always visible
             (not conditional on activeSpace). Ribbon.tsx no longer creates
             tabs at all, and the old space-header "+"/right-click "open new
             tab" menu are gone — this is the single "start a fresh tab of
             type X" affordance now. Precise switching to an EXISTING tab
             stays the flat list's job below. ── */}
        <div className="flex gap-1.5 px-2 pt-1 pb-1.5 flex-shrink-0">
          {SPACES.map(({ id, type, icon: Icon, tip }) => (
            <Tooltip.Root key={id}>
              <Tooltip.Trigger asChild>
                <button
                  onClick={() => createTab(type)}
                  className="no-drag group relative flex-1 flex items-center justify-center aspect-square max-h-9 rounded-shell bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-accent))] hover:bg-[rgb(var(--color-accent))/15] transition-colors cursor-pointer overflow-hidden"
                >
                  <Icon size={15} className="transition-opacity group-hover:opacity-0" />
                  <Plus size={15} className="absolute opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content side="bottom" sideOffset={6} className="z-50 px-2 py-1 rounded text-xs bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] shadow-lg">
                  {tip}
                  <Tooltip.Arrow className="fill-[rgb(var(--color-surface-4))]" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          ))}
        </div>

            <div
              ref={tabListRef}
              className="no-drag flex-1 overflow-y-auto min-h-0"
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
             chips, freeing this spot for the calendar). Its own rounded card
             (matching the search bar's surface-4 pill treatment above)
             rather than a bare `border-t` hairline — now that Ribbon+Sidebar
             read as one continuous vibrant surface, a single top-only line
             was the one remaining "seam" in an otherwise unbroken field and
             read as arbitrary rather than intentional. A self-contained
             card gives it the same deliberate weight as the sidebar's other
             grouped elements instead of floating on a lone divider. ── */}
        <div className="mx-2 mb-2 mt-1.5 p-2 rounded-shell bg-[rgb(var(--color-surface-4))/40] border border-[rgb(var(--color-surface-4))/60] flex-shrink-0">
          <CalendarGrid
            date={sbCalendarDate}
            notes={sbCalendarNotes}
            onDateChange={setSbCalendarDate}
            onSelectDate={selectSidebarCalendarDate}
            onContextMenu={(d, x, y) => setDailyNoteMenu({ date: d, x, y })}
            selectedDate={activeDailyDate}
            compact
            todayAction={
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <button
                    onClick={openTodaysDailyNote}
                    onContextMenu={(e) => { e.preventDefault(); setDailyNoteMenu({ date: dailyNoteToday(), x: e.clientX, y: e.clientY }) }}
                    className="no-drag flex items-center gap-1 text-[10px] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-accent))] transition-colors cursor-pointer"
                  >
                    <CalendarDays size={11} />
                    Today
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content side="top" sideOffset={6} className="z-50 px-2 py-1 rounded text-xs bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] shadow-lg">
                    Today's daily note
                    <Tooltip.Arrow className="fill-[rgb(var(--color-surface-4))]" />
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
            }
          />
        </div>

      </aside>

      {/* ── Tab-bar right-click context menu ── */}
      {tabBarMenu && createPortal(
        <MenuPositioner ref={tabBarMenuRef} x={tabBarMenu.x} y={tabBarMenu.y}
          className="min-w-44 rounded-shell glass-panel p-1 text-xs"
        >
          {SPACES.map(({ id, type, icon: Icon, tip }) => (
            <button
              key={id}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-shell text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
              onClick={() => { createTab(type); useAppStore.getState().setActiveSpace(id); setTabBarMenu(null) }}
            >
              <Icon size={12} />
              {tip}
            </button>
          ))}
          <button
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-shell text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
            onClick={() => { openSearch('new'); setTabBarMenu(null) }}
          >
            <Search size={12} />
            Search / new tab…
          </button>
          <div className="my-1 border-t border-[rgb(var(--color-surface-4))]" />
          <button
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-shell text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
            onClick={() => { toggleSidebar(); setTabBarMenu(null) }}
          >
            <PanelLeft size={12} className={sidebarCollapsed ? 'rotate-180' : ''} />
            {sidebarCollapsed ? 'Expand explorer' : 'Collapse explorer'}
          </button>
          <button
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-shell text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
            onClick={() => { openSettings(); setTabBarMenu(null) }}
          >
            <Settings size={12} />
            Theme settings
          </button>
        </MenuPositioner>,
        document.body
      )}

      {/* ── Scripture right-click → book list ── */}
      {bookMenu && createPortal(
        <MenuPositioner ref={bookMenuRef} x={bookMenu.x} y={bookMenu.y}
          className="w-56 max-h-[70vh] flex flex-col rounded-shell glass-panel text-xs"
        >
          {/* Filter input — sticky at top */}
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-[rgb(var(--color-surface-4))] flex-shrink-0">
            <Search size={11} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
            <input
              autoFocus
              type="text"
              value={bookMenu.filter}
              onChange={(e) => setBookMenu(prev => prev ? { ...prev, filter: e.target.value } : null)}
              placeholder="Filter books…"
              className="flex-1 bg-transparent outline-none text-[rgb(var(--color-text-primary))] placeholder:text-[rgb(var(--color-text-muted))] text-[11px]"
            />
          </div>
          <div className="overflow-y-auto flex-1 p-1">
            {(() => {
              const q = bookMenu.filter.toLowerCase()
              const filtered = q ? bookMenu.books.filter(e => e.book.name.toLowerCase().includes(q)) : bookMenu.books
              if (filtered.length === 0) {
                return <div className="px-2 py-2 text-[rgb(var(--color-text-muted))] text-center">No books found</div>
              }
              if (q) {
                // Flat list when filtering
                return filtered.map(entry => (
                  <button
                    key={entry.book.id}
                    className="w-full text-left px-2 py-1 rounded-shell text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer flex items-center justify-between gap-2"
                    onClick={() => openTabFromBook(entry)}
                  >
                    <span>{entry.book.name}</span>
                    {entry.textId !== 'kjva' && (
                      <span className="text-[9px] text-[rgb(var(--color-text-muted))] opacity-70 font-mono uppercase">{entry.textId}</span>
                    )}
                  </button>
                ))
              }
              // Grouped by testament when not filtering
              return (['OT', 'NT', 'Apocrypha', 'Pseudepigrapha'] as const).map((testament) => {
                const group = filtered.filter(e => e.book.testament === testament)
                if (group.length === 0) return null
                return (
                  <div key={testament}>
                    <div className="px-2 py-0.5 text-[9px] text-[rgb(var(--color-text-muted))] uppercase tracking-wider opacity-60 mt-1">{testament}</div>
                    {group.map(entry => (
                      <button
                        key={entry.book.id}
                        className="w-full text-left px-2 py-1 rounded-shell text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer flex items-center justify-between gap-2"
                        onClick={() => openTabFromBook(entry)}
                      >
                        <span>{entry.book.name}</span>
                        {entry.textId !== 'kjva' && (
                          <span className="text-[9px] text-[rgb(var(--color-text-muted))] opacity-70 font-mono uppercase">{entry.textId}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )
              })
            })()}
          </div>
        </MenuPositioner>,
        document.body
      )}

      {sessionMenu && (() => {
        const menuSession = sessions.find((s) => s.id === sessionMenu.sessionId)
        const MenuSessionIcon = (SESSION_ICONS.find((i) => i.name === menuSession?.icon) ?? SESSION_ICONS[0]).Icon
        return createPortal(
        <MenuPositioner ref={sessionMenuRef} x={sessionMenu.x} y={sessionMenu.y}
          className={`rounded-shell glass-panel p-1 text-xs ${sessionMenuMode === 'icon' ? 'w-48' : 'min-w-44'}`}
        >
          {/* Live preview header — icon + name update in place as edits are made below,
              so renaming/changing the icon is visible without closing the menu to check. */}
          <div className="flex items-center gap-2 px-2 py-1.5 mb-1 border-b border-[rgb(var(--color-surface-4))]">
            <MenuSessionIcon size={12} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
            <span className="flex-1 text-[11px] font-medium text-[rgb(var(--color-text-secondary))] truncate">
              {menuSession?.name ?? 'Session'}
            </span>
          </div>
          {sessionMenuMode === 'rename' ? (
            <input
              autoFocus
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={() => {
                if (renameValue.trim()) renameSession(sessionMenu.sessionId, renameValue.trim())
                setSessionMenuMode('default')
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() }
                if (e.key === 'Escape') { e.preventDefault(); setSessionMenu(null); setSessionMenuMode('default') }
              }}
              className="w-full px-2 py-1.5 rounded-shell bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] outline-none transition-shadow focus:ring-2 focus:ring-[rgb(var(--color-accent))]"
            />
          ) : sessionMenuMode === 'icon' ? (
            <>
              <div className="px-2 py-1 text-[10px] text-[rgb(var(--color-text-muted))] uppercase tracking-wide">Session icon</div>
              <div className="grid grid-cols-7 gap-0.5 p-1">
                <button
                  title="No icon (show number)"
                  className={`flex items-center justify-center w-6 h-6 rounded-shell transition-all duration-100 cursor-pointer hover:scale-110 active:scale-90 ${
                    !menuSession?.icon
                      ? 'bg-[rgb(var(--color-accent))/20] text-[rgb(var(--color-accent))] ring-1 ring-[rgb(var(--color-accent))/50]'
                      : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))]'
                  }`}
                  onClick={() => setSessionIcon(sessionMenu.sessionId, '')}
                >
                  <Hash size={13} />
                </button>
                {SESSION_ICONS.map(({ name, Icon }) => (
                  <button
                    key={name}
                    title={name}
                    className={`flex items-center justify-center w-6 h-6 rounded-shell transition-all duration-100 cursor-pointer hover:scale-110 active:scale-90 ${
                      menuSession?.icon === name
                        ? 'bg-[rgb(var(--color-accent))/20] text-[rgb(var(--color-accent))] ring-1 ring-[rgb(var(--color-accent))/50]'
                        : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))]'
                    }`}
                    onClick={() => setSessionIcon(sessionMenu.sessionId, name)}
                  >
                    <Icon size={13} />
                  </button>
                ))}
              </div>
              <button
                className="w-full flex items-center justify-center gap-1.5 mt-1 px-2 py-1.5 rounded-shell text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                onClick={() => setSessionMenuMode('default')}
              >
                Done
              </button>
            </>
          ) : (
            <>
              <button
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-shell text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] hover:translate-x-0.5 transition-all duration-100 cursor-pointer"
                onClick={() => setSessionMenuMode('rename')}
              >
                <Pencil size={12} />
                Rename
              </button>
              <button
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-shell text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] hover:translate-x-0.5 transition-all duration-100 cursor-pointer"
                onClick={() => setSessionMenuMode('icon')}
              >
                <Palette size={12} />
                Change icon
              </button>
              <div className="my-1 h-px bg-[rgb(var(--color-surface-4))]" />
              <button
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-shell text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] hover:translate-x-0.5 transition-all duration-100 cursor-pointer"
                onClick={() => { openSettingsToSessions(); setSessionMenu(null) }}
              >
                <Settings size={12} />
                Manage sessions…
              </button>
              {sessions.length > 1 && (
                <button
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-shell text-[rgb(var(--color-text-secondary))] hover:bg-red-500/15 hover:text-red-400 hover:translate-x-0.5 transition-all duration-100 cursor-pointer"
                  onClick={() => { deleteSession(sessionMenu.sessionId); setSessionMenu(null) }}
                >
                  <Trash2 size={12} />
                  Delete session
                </button>
              )}
            </>
          )}
        </MenuPositioner>,
        document.body
      )})()}

      {/* ── Daily-note calendar right-click (grid cells + the "Today" shortcut) ── */}
      {dailyNoteMenu && createPortal(
        <MenuPositioner ref={dailyNoteMenuRef} x={dailyNoteMenu.x} y={dailyNoteMenu.y}
          className="min-w-[190px] rounded-shell context-menu py-1 overflow-hidden text-xs"
        >
          <button
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
            onClick={() => { openDailyNoteInTab(dailyNoteMenu.date); setDailyNoteMenu(null) }}
          >
            <PanelRightOpen size={13} className="flex-shrink-0" /> Open
          </button>
          <button
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
            onClick={() => { openDailyNoteInNewTab(dailyNoteMenu.date); setDailyNoteMenu(null) }}
          >
            <ExternalLink size={13} className="flex-shrink-0" /> Open in new tab
          </button>
          <button
            className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
            onClick={() => { openDailyNoteInFloatingTab(dailyNoteMenu.date); setDailyNoteMenu(null) }}
          >
            <Monitor size={13} className="flex-shrink-0" /> Open in floating tab
          </button>
          {findDailyNote(sbCalendarNotes, dailyNoteMenu.date) && (
            <>
              <div className="my-1 h-px bg-[rgb(var(--color-surface-4))]" />
              <button
                className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left text-[rgb(var(--color-text-secondary))] hover:bg-red-500/15 hover:text-red-400 transition-colors cursor-pointer"
                onClick={() => { deleteDailyNoteForDate(dailyNoteMenu.date); setDailyNoteMenu(null) }}
              >
                <Trash2 size={13} className="flex-shrink-0" /> Delete note
              </button>
            </>
          )}
        </MenuPositioner>,
        document.body
      )}
    </Tooltip.Provider>
    {/* Resize handle — thin strip on the sidebar's right edge, only visible on hover (matching
        the side-panel's own hDivider convention in BiblePanel.tsx). Sits on the motion.div
        itself (not the inner aside) so it stays pinned to the right edge regardless of the
        collapse/expand width animation. */}
    {!sidebarCollapsed && (
      <div
        onMouseDown={handleSidebarResizeMouseDown}
        title="Drag to resize"
        className="group absolute top-0 right-0 h-full w-1.5 -mr-0.5 cursor-col-resize z-10 no-drag"
      >
        <div className="w-px h-full mx-auto bg-transparent group-hover:bg-[rgb(var(--color-accent))/40] transition-colors" />
      </div>
    )}
    </motion.div>
  )
}
