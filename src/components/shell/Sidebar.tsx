import * as Tooltip from '@radix-ui/react-tooltip'
import { motion } from 'framer-motion'
import { BookOpen, FileText, BookMarked, Youtube, Search, Settings, PanelLeft, Plus, ChevronRight, Layers, Star, Flame, Leaf, Globe, Compass, Shield, Feather, Anchor, Crown, Zap, Heart, Cloud, Mountain, Fish, Key, Bell, Clock, Home, Map, Gem, Music2, Sun, Moon, CalendarDays, type LucideIcon } from 'lucide-react'
import { useAppStore } from '@/store'
import TabBar from './TabBar'
import type { SpaceId, TabType } from '@/types'
import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { MenuPositioner } from '@/lib/usePositionedMenu'
import type { Book, Note } from '@/types'
import { CalendarGrid } from '@/components/notes/CalendarWidget'

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
  const tabs         = useAppStore((s) => s.tabs)
  const activeTabId  = useAppStore((s) => s.activeTabId)
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed)
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

  // ── Tab-bar right-click context menu ──
  const [tabBarMenu, setTabBarMenu] = useState<{ x: number; y: number } | null>(null)
  const tabBarMenuRef = useRef<HTMLDivElement>(null)

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
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onEsc)
    return () => { window.removeEventListener('mousedown', onDown, true); window.removeEventListener('keydown', onEsc) }
  }, [tabBarMenu, bookMenu])

  // ── Daily-note calendar — pinned permanently at the bottom of the
  // sidebar (not gated to the Notes space, not a toggle) so jumping to a
  // past/future daily note is always one click away regardless of what
  // space is currently active. Notes are fetched once on mount purely to
  // compute which days already have a note. ──
  const [sbCalendarDate, setSbCalendarDate] = useState(new Date())
  const [sbCalendarNotes, setSbCalendarNotes] = useState<Note[]>([])

  useEffect(() => {
    window.notes.getNotes(100000, 0).then(setSbCalendarNotes).catch(() => {})
  }, [])

  function selectSidebarCalendarDate(d: Date) {
    useAppStore.getState().createTab('note')
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('berean:openDailyNote', { detail: { date: iso } })))
  }

  function openTodaysDailyNote() {
    useAppStore.getState().createTab('note')
    requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('berean:openDailyNote')))
  }

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
    const TEXT_IDS = ['kjva', 'lxx', 'enoch', 'jubilees', 'hermas', 't12p', 'asc_isaiah', 'recog_clement', 'apoc_elijah', 't_job', '1clement', 'apoc_abraham']
    const results = await Promise.allSettled(
      TEXT_IDS.map(id => window.bible.getBooks(id).then(bs => ({ id, books: bs })))
    )
    const seen = new Set<string>()
    const entries: Array<{ book: Book; textId: string }> = []
    for (const r of results) {
      if (r.status !== 'fulfilled') continue
      for (const book of r.value.books) {
        if (!seen.has(book.id)) { seen.add(book.id); entries.push({ book, textId: r.value.id }) }
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

  // Current breadcrumb: Space › Tab title
  const currentTab = tabs[activeSpace].find((t) => t.id === activeTabId[activeSpace])
  const spaceLabel = SPACE_LABEL[activeSpace]
  const tabTitle = currentTab?.title ?? ''

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
  // it) rather than an instant unmount, so toggling reads as a slide instead
  // of a jump cut.
  return (
    <motion.div
      animate={{ width: sidebarCollapsed ? 0 : 224 }}
      initial={false}
      transition={{ type: 'spring', stiffness: 500, damping: 45 }}
      className="h-full flex-shrink-0 overflow-hidden"
    >
    {/* disableHoverableContent — same fix as Ribbon.tsx: none of these
        tooltips have interactive content, so Radix's hoverable-content grace
        area (kept open/interactive between trigger and tooltip) served no
        purpose and could overlap nearby context menus (tab-bar right-click,
        book-picker) that open close to a tooltip-having trigger. */}
    <Tooltip.Provider delayDuration={200} disableHoverableContent>
      <aside
        className={`
          app-drag-region flex flex-col flex-shrink-0 h-full w-56
          ${window.__berean_platform === 'darwin' ? 'sidebar-vibrant' : "bg-[rgb(var(--color-surface-2))] shadow-[inset_0_1px_0_0_rgb(var(--color-surface-4)/0.35),1px_0_12px_-4px_rgb(0_0_0/0.25)]"}
          border-r border-[rgb(var(--color-surface-4))]
        `}
      >
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
                    <ChevronRight size={9} className="text-[rgb(var(--color-text-muted))] flex-shrink-0 opacity-50" />
                    <span className="text-[11px] text-[rgb(var(--color-text-secondary))] truncate">{tabTitle}</span>
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
              className="no-drag flex-1 overflow-y-auto min-h-0"
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
             chips, freeing this spot for the calendar). ── */}
        <div className="px-2 pb-2 pt-1.5 border-t border-[rgb(var(--color-surface-4))] flex-shrink-0">
          <div className="flex items-center justify-between px-0.5 pb-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[rgb(var(--color-text-muted))]" style={{ zoom: appZoom }}>Daily notes</span>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button
                  onClick={openTodaysDailyNote}
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
          </div>
          <CalendarGrid
            date={sbCalendarDate}
            notes={sbCalendarNotes}
            onDateChange={setSbCalendarDate}
            onSelectDate={selectSidebarCalendarDate}
            compact
          />
        </div>

      </aside>

      {/* ── Tab-bar right-click context menu ── */}
      {tabBarMenu && createPortal(
        <MenuPositioner ref={tabBarMenuRef} x={tabBarMenu.x} y={tabBarMenu.y}
          className="min-w-44 rounded-shell glass-panel p-1 text-xs"
        >
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
    </Tooltip.Provider>
    </motion.div>
  )
}
