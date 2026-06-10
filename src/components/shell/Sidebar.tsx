import * as Tooltip from '@radix-ui/react-tooltip'
import * as Popover from '@radix-ui/react-popover'
import { BookOpen, FileText, BookMarked, Youtube, Search, Settings, PanelLeft, Plus, ChevronRight, Layers, Check, Pencil, Trash2, Star, Flame, Leaf, Globe, Compass, Shield, Feather, Anchor, Crown, Zap, Heart, Cloud, Mountain, Fish, Key, Bell, Clock, Home, Map, Gem, Music2, Sun, Moon, History, CalendarDays, Archive, ArchiveRestore, X, ArrowLeft, ArrowRight, type LucideIcon } from 'lucide-react'
import { useAppStore } from '@/store'
import TabBar from './TabBar'
import type { SpaceId, TabType } from '@/types'
import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { MenuPositioner } from '@/lib/usePositionedMenu'
import type { Book } from '@/types'

const SPACES: { id: SpaceId; type: TabType; label: string; icon: LucideIcon; tip: string }[] = [
  { id: 'scripture', type: 'bible',   label: 'Scripture', icon: BookOpen,   tip: 'New Scripture tab' },
  { id: 'notes',     type: 'note',    label: 'Notes',     icon: FileText,   tip: 'New Notes tab' },
  { id: 'lexicon',   type: 'lexicon', label: 'Lexicon',   icon: BookMarked, tip: 'New Lexicon tab' },
  { id: 'youtube',   type: 'youtube', label: 'YouTube',   icon: Youtube,    tip: 'New YouTube tab' },
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
  const setActiveSpace = useAppStore((s) => s.setActiveSpace)
  const sessions     = useAppStore((s) => s.sessions)
  const currentSessionId = useAppStore((s) => s.currentSessionId)
  const createSession    = useAppStore((s) => s.createSession)
  const switchSession    = useAppStore((s) => s.switchSession)
  const renameSession    = useAppStore((s) => s.renameSession)
  const setSessionIcon   = useAppStore((s) => s.setSessionIcon)
  const deleteSession    = useAppStore((s) => s.deleteSession)
  const sessionTabFilters    = useAppStore((s) => s.sessionTabFilters)
  const setSessionTabFilter  = useAppStore((s) => s.setSessionTabFilter)
  const sessionDisplayOrders = useAppStore((s) => s.sessionDisplayOrders)
  const reorderTabDisplay    = useAppStore((s) => s.reorderTabDisplay)
  const sidebarNewTabIconOnly = useAppStore((s) => s.sidebarNewTabIconOnly)
  const openHistory            = useAppStore((s) => s.openHistory)
  const historyCount           = useAppStore((s) => s.history.length)
  const historySeenLength      = useAppStore((s) => s.historySeenLength)
  const hasUnseenHistory       = historyCount > historySeenLength
  const globalNavStack         = useAppStore((s) => s.globalNavStack)
  const globalNavIdx           = useAppStore((s) => s.globalNavIdx)
  const navGlobalBack          = useAppStore((s) => s.navGlobalBack)
  const navGlobalForward       = useAppStore((s) => s.navGlobalForward)
  const archivedGroups         = useAppStore((s) => s.archivedGroups)
  const archiveAllTabs         = useAppStore((s) => s.archiveAllTabs)
  const restoreArchivedGroup   = useAppStore((s) => s.restoreArchivedGroup)
  const dismissArchivedGroup   = useAppStore((s) => s.dismissArchivedGroup)

  // ── Global nav back/forward ──────────────────────────────────────────────
  const canNavBack    = globalNavIdx > 0
  const canNavForward = globalNavIdx < globalNavStack.length - 1
  const [navDropdown, setNavDropdown] = useState<{ x: number; y: number; mode: 'back' | 'forward' | 'all' } | null>(null)
  const navDropdownRef       = useRef<HTMLDivElement>(null)
  const navBackLongPress     = useRef<ReturnType<typeof setTimeout> | null>(null)
  const navFwdLongPress      = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Prevents a click firing navigation after a long-press already showed the dropdown
  const navBackDidLongPress  = useRef(false)
  const navFwdDidLongPress   = useRef(false)

  const [archiveOpen, setArchiveOpen] = useState(false)
  const archivePanelRef = useRef<HTMLDivElement>(null)
  const archiveBtnRef   = useRef<HTMLButtonElement>(null)

  const [sessionPopoverOpen, setSessionPopoverOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [iconPickerFor, setIconPickerFor] = useState<string | null>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)

  // ── Tab-bar right-click context menu ──
  const [tabBarMenu, setTabBarMenu] = useState<{ x: number; y: number } | null>(null)
  const tabBarMenuRef = useRef<HTMLDivElement>(null)

  // ── Nav history dropdown close-on-outside-click ──
  useEffect(() => {
    if (!navDropdown) return
    function onDown(e: MouseEvent) {
      if (navDropdownRef.current && !navDropdownRef.current.contains(e.target as Node)) setNavDropdown(null)
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [navDropdown])

  // ── Archive panel close-on-outside-click ──
  useEffect(() => {
    if (!archiveOpen) return
    function onDown(e: MouseEvent) {
      // Ignore clicks on the button itself — onClick handles the toggle
      if (archiveBtnRef.current?.contains(e.target as Node)) return
      if (archivePanelRef.current && !archivePanelRef.current.contains(e.target as Node)) setArchiveOpen(false)
    }
    function onClose() { setArchiveOpen(false) }
    document.addEventListener('mousedown', onDown, true)
    window.addEventListener('berean:closeMenus', onClose)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('berean:closeMenus', onClose)
    }
  }, [archiveOpen])

  // ── Space-button drag-to-float tracking ──
  const spaceLeftWindowRef  = useRef(false)
  const spaceDraggingType   = useRef<TabType | null>(null)
  useEffect(() => {
    function onDragLeave(e: DragEvent) { if (e.relatedTarget === null) spaceLeftWindowRef.current = true }
    function onDragEnter() { spaceLeftWindowRef.current = false }
    document.addEventListener('dragleave', onDragLeave, { capture: true })
    document.addEventListener('dragenter', onDragEnter, { capture: true })
    return () => {
      document.removeEventListener('dragleave', onDragLeave, { capture: true })
      document.removeEventListener('dragenter', onDragEnter, { capture: true })
    }
  }, [])

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

  async function openBookMenu(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
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
    setBookMenu({ x: e.clientX, y: e.clientY, books: entries, filter: '' })
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

  const currentTabFilter = (sessionTabFilters[currentSessionId] ?? 'all') as TabType | 'all'

  const SESSION_ICONS: { name: string; Icon: LucideIcon }[] = [
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

  // Build display name and icon for the current session
  const currentSession = sessions.find(s => s.id === currentSessionId)
  const currentSessionName = currentSession?.name ?? 'Session 1'
  const currentSessionIconEntry = SESSION_ICONS.find(i => i.name === currentSession?.icon) ?? SESSION_ICONS[0]
  const CurrentSessionIcon = currentSessionIconEntry.Icon

  function startRename(id: string, currentName: string) {
    setRenamingId(id)
    setRenameValue(currentName)
    setTimeout(() => renameInputRef.current?.focus(), 50)
  }

  function commitRename() {
    if (renamingId && renameValue.trim()) {
      renameSession(renamingId, renameValue.trim())
    }
    setRenamingId(null)
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
  const filteredTabs = currentTabFilter === 'all'
    ? orderedTabs
    : orderedTabs.filter((t) => t.type === currentTabFilter)

  const FILTER_OPTIONS: { value: TabType | 'all'; label: string; Icon?: LucideIcon }[] = [
    { value: 'all',     label: 'All' },
    { value: 'bible',   label: 'Bible',   Icon: BookOpen },
    { value: 'note',    label: 'Notes',   Icon: FileText },
    { value: 'lexicon', label: 'Lexicon', Icon: BookMarked },
    { value: 'youtube', label: 'YouTube', Icon: Youtube },
  ]

  return (
    <Tooltip.Provider delayDuration={200}>
      <aside
        onContextMenu={sidebarCollapsed ? (e) => {
          e.preventDefault()
          setTabBarMenu({ x: e.clientX, y: e.clientY })
        } : undefined}
        className={`
          flex flex-col flex-shrink-0 h-full
          bg-[rgb(var(--color-surface-2))]
          border-r border-[rgb(var(--color-surface-4))]
          transition-all duration-200 ease-in-out
          ${sidebarCollapsed ? 'w-14' : 'w-56'}
        `}
      >
        {/* macOS traffic light spacer — contains right-aligned back/forward nav buttons */}
        {window.__berean_platform !== 'win32' && (
          <div className="h-9 app-drag-region flex-shrink-0 flex items-center justify-end pr-2">
            {/* ── Global nav back / forward — distinctive joined pill ── */}
            <div className="no-drag flex items-center rounded-md border border-[rgb(var(--color-surface-4))] overflow-hidden">
              {/* Back */}
              <button
                onClick={canNavBack ? () => {
                  if (navBackDidLongPress.current) { navBackDidLongPress.current = false; return }
                  navGlobalBack()
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
                title={canNavBack ? 'Back (⌘[) · hold for history' : 'No back history'}
                className={`flex items-center justify-center w-6 h-6 transition-colors border-r border-[rgb(var(--color-surface-4))] ${
                  canNavBack
                    ? 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer'
                    : 'text-[rgb(var(--color-text-muted))] opacity-30 cursor-default'
                }`}
              >
                <ArrowLeft size={12} />
              </button>
              {/* Forward */}
              <button
                onClick={canNavForward ? () => {
                  if (navFwdDidLongPress.current) { navFwdDidLongPress.current = false; return }
                  navGlobalForward()
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
                className={`flex items-center justify-center w-6 h-6 transition-colors border-r border-[rgb(var(--color-surface-4))] ${
                  canNavForward
                    ? 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer'
                    : 'text-[rgb(var(--color-text-muted))] opacity-30 cursor-default'
                }`}
              >
                <ArrowRight size={12} />
              </button>
              {/* Clock — full nav history (shown once something is in the stack) */}
              {globalNavStack.length > 0 && (
                <button
                  onClick={(e) => {
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                    setNavDropdown(d => d?.mode === 'all' ? null : { x: rect.left, y: rect.bottom + 4, mode: 'all' })
                  }}
                  title="Navigation history"
                  className="flex items-center justify-center w-6 h-6 transition-colors text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer"
                >
                  <History size={11} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Search / location bar (ABOVE space buttons) ── */}
        <div className="px-2 pb-1 flex-shrink-0">
          {sidebarCollapsed ? (
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button
                  onClick={() => openSearch('current')}
                  className="no-drag flex items-center justify-center w-10 h-7 rounded-lg bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                >
                  <Search size={13} />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content side="right" sideOffset={6} className="z-50 px-2 py-1 rounded text-xs bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] shadow-lg">
                  Search
                  <Tooltip.Arrow className="fill-[rgb(var(--color-surface-4))]" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          ) : (
            <div className="flex items-center gap-1">
              {/* Location bar — shows breadcrumb, click to search in current tab */}
              <button
                onClick={() => openSearch('current')}
                className="flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-[rgb(var(--color-surface-4))] hover:bg-[rgb(var(--color-surface-4))/70] text-left transition-colors cursor-pointer min-w-0"
              >
                <Search size={11} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
                {tabTitle ? (
                  // Only show "Space > Tab" breadcrumb when the tab has a meaningful
                  // title different from the space name (e.g. "YouTube > Video Title").
                  // When the tab title equals the space name (default empty tab), show
                  // just the space label to avoid "YouTube > YouTube".
                  tabTitle.toLowerCase() === spaceLabel.toLowerCase() ? (
                    <span className="text-[11px] text-[rgb(var(--color-text-secondary))] truncate flex-1">{spaceLabel}</span>
                  ) : (
                    <span className="flex items-center gap-0.5 min-w-0 flex-1">
                      <span className="text-[10px] text-[rgb(var(--color-text-muted))] flex-shrink-0">{spaceLabel}</span>
                      <ChevronRight size={9} className="text-[rgb(var(--color-text-muted))] flex-shrink-0 opacity-50" />
                      <span className="text-[11px] text-[rgb(var(--color-text-secondary))] truncate">{tabTitle}</span>
                    </span>
                  )
                ) : (
                  <span className="text-xs text-[rgb(var(--color-text-muted))] truncate">Search…</span>
                )}
              </button>
              {/* New tab search button */}
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <button
                    onClick={() => openSearch('new')}
                    className="p-1.5 rounded-lg bg-[rgb(var(--color-surface-4))] hover:bg-[rgb(var(--color-accent))/15] hover:text-[rgb(var(--color-accent))] text-[rgb(var(--color-text-muted))] transition-colors cursor-pointer flex-shrink-0"
                  >
                    <Plus size={13} />
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
          )}
        </div>

        {/* ── Space buttons ── */}
        {/* Icon-only mode: single row of icon chips; hover reveals Plus overlay */}
        {!sidebarCollapsed && sidebarNewTabIconOnly ? (
          <div className="flex items-center gap-1 px-2 pb-1 flex-shrink-0">
            {SPACES.map(({ id, type, icon: Icon, tip }) => {
              const isActive = activeSpace === id
              return (
                <Tooltip.Root key={id}>
                  <Tooltip.Trigger asChild>
                    <button
                      onClick={() => createTab(type)}
                      onContextMenu={id === 'scripture' ? openBookMenu : undefined}
                      className={`
                        no-drag group relative flex-1 flex items-center justify-center h-8 rounded-lg
                        transition-colors duration-100 cursor-pointer select-none
                        ${isActive
                          ? 'bg-[rgb(var(--color-accent))/15] text-[rgb(var(--color-accent))]'
                          : 'text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))]'
                        }
                      `}
                    >
                      {/* On hover: icon fades and Plus appears */}
                      <Icon size={15} className="flex-shrink-0 transition-opacity group-hover:opacity-0" />
                      <Plus size={14} className="absolute inset-0 m-auto opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      side="right"
                      sideOffset={6}
                      className="z-50 px-2 py-1 rounded text-xs bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] shadow-lg"
                    >
                      {tip}
                      <Tooltip.Arrow className="fill-[rgb(var(--color-surface-4))]" />
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
              )
            })}
          </div>
        ) : (
          <nav className="flex flex-col gap-0.5 px-2 flex-shrink-0">
            {SPACES.map(({ id, type, label, icon: Icon, tip }) => {
              const isActive = activeSpace === id
              // Notes space — expanded: show slightly smaller Notes button + today's daily note button
              if (id === 'notes' && !sidebarCollapsed) {
                return (
                  <div key={id} className="flex items-center gap-0.5">
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <button
                          onClick={() => createTab(type)}
                          draggable
                          onDragStart={(e) => {
                            spaceDraggingType.current = type
                            spaceLeftWindowRef.current = false
                            e.dataTransfer.effectAllowed = 'move'
                            e.dataTransfer.setData('berean-space-type', type)
                          }}
                          onDragEnd={(e) => {
                            const insideWindow = e.clientX > 0 && e.clientX < window.innerWidth &&
                                                 e.clientY > 0 && e.clientY < window.innerHeight
                            if (spaceLeftWindowRef.current && !insideWindow && spaceDraggingType.current) {
                              window.app.openFloatingTab('notes', {})
                              useAppStore.getState().bumpFloatingTabToken()
                            }
                            spaceDraggingType.current = null
                            spaceLeftWindowRef.current = false
                          }}
                          className={`
                            no-drag flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm font-medium
                            transition-colors duration-100 cursor-pointer select-none flex-1 text-left min-w-0
                            ${isActive
                              ? 'bg-[rgb(var(--color-accent))/15] text-[rgb(var(--color-accent))]'
                              : 'text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))]'
                            }
                          `}
                        >
                          <Icon size={16} className="flex-shrink-0" />
                          <span className="truncate flex-1">{label}</span>
                          <Plus size={12} className="flex-shrink-0 opacity-40" />
                        </button>
                      </Tooltip.Trigger>
                      <Tooltip.Portal>
                        <Tooltip.Content side="right" sideOffset={6} className="z-50 px-2 py-1 rounded text-xs bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] shadow-lg">
                          {tip}
                          <Tooltip.Arrow className="fill-[rgb(var(--color-surface-4))]" />
                        </Tooltip.Content>
                      </Tooltip.Portal>
                    </Tooltip.Root>
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <button
                          onClick={() => {
                            createTab('note')
                            requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('berean:openDailyNote')))
                          }}
                          className="no-drag flex-shrink-0 p-1 rounded transition-colors cursor-pointer text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-accent))]"
                        >
                          <CalendarDays size={15} />
                        </button>
                      </Tooltip.Trigger>
                      <Tooltip.Portal>
                        <Tooltip.Content side="right" sideOffset={6} className="z-50 px-2 py-1 rounded text-xs bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] shadow-lg">
                          Today's daily note
                          <Tooltip.Arrow className="fill-[rgb(var(--color-surface-4))]" />
                        </Tooltip.Content>
                      </Tooltip.Portal>
                    </Tooltip.Root>
                  </div>
                )
              }
              return (
                <Tooltip.Root key={id}>
                  <Tooltip.Trigger asChild>
                    <button
                      onClick={() => createTab(type)}
                      onContextMenu={id === 'scripture' ? openBookMenu : undefined}
                      draggable
                      onDragStart={(e) => {
                        spaceDraggingType.current = type
                        spaceLeftWindowRef.current = false
                        e.dataTransfer.effectAllowed = 'move'
                        e.dataTransfer.setData('berean-space-type', type)
                      }}
                      onDragEnd={(e) => {
                        const insideWindow = e.clientX > 0 && e.clientX < window.innerWidth &&
                                             e.clientY > 0 && e.clientY < window.innerHeight
                        if (spaceLeftWindowRef.current && !insideWindow && spaceDraggingType.current) {
                          window.app.openFloatingTab(spaceDraggingType.current === 'note' ? 'notes' : spaceDraggingType.current, {})
                          useAppStore.getState().bumpFloatingTabToken()
                        }
                        spaceDraggingType.current = null
                        spaceLeftWindowRef.current = false
                      }}
                      className={`
                        no-drag flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm font-medium
                        transition-colors duration-100 cursor-pointer select-none w-full text-left
                        ${isActive
                          ? 'bg-[rgb(var(--color-accent))/15] text-[rgb(var(--color-accent))]'
                          : 'text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))]'
                        }
                      `}
                    >
                      <Icon size={16} className="flex-shrink-0" />
                      {!sidebarCollapsed && (
                        <>
                          <span className="truncate flex-1">{label}</span>
                          <Plus size={12} className="flex-shrink-0 opacity-40" />
                        </>
                      )}
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Portal>
                    <Tooltip.Content
                      side="right"
                      sideOffset={6}
                      className="z-50 px-2 py-1 rounded text-xs bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] shadow-lg"
                    >
                      {tip}
                      <Tooltip.Arrow className="fill-[rgb(var(--color-surface-4))]" />
                    </Tooltip.Content>
                  </Tooltip.Portal>
                </Tooltip.Root>
              )
            })}
          </nav>
        )}

        {/* Tabs section */}
        {!sidebarCollapsed && (
          <>
            {/* Divider + always-visible filter chips row */}
            <div className="flex items-center gap-1 px-2 py-1.5 flex-shrink-0 border-t border-[rgb(var(--color-surface-4))] mt-1">
              {FILTER_OPTIONS.map(({ value, label, Icon }) => (
                <button
                  key={value}
                  onClick={() => setSessionTabFilter(currentSessionId, value)}
                  title={label}
                  className={`flex-1 flex items-center justify-center gap-0.5 py-1 rounded-md text-[10px] transition-colors cursor-pointer ${
                    currentTabFilter === value
                      ? 'bg-[rgb(var(--color-accent))/20] text-[rgb(var(--color-accent))]'
                      : 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))]'
                  }`}
                >
                  {Icon ? <Icon size={9} className="flex-shrink-0" /> : <span>{label}</span>}
                </button>
              ))}
            </div>
            <div
              className="flex-1 overflow-y-auto min-h-0"
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
                tabs={filteredTabs}
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
          </>
        )}

        {/* ── Session switcher ── */}
        {!sidebarCollapsed && (
          <div className="px-2 pb-1 flex-shrink-0">
            <Popover.Root open={sessionPopoverOpen} onOpenChange={setSessionPopoverOpen}>
              <Popover.Trigger asChild>
                <button className="no-drag w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer text-xs">
                  <span className="flex-shrink-0 leading-none"><CurrentSessionIcon size={14} /></span>
                  <span className="truncate flex-1 text-left">{currentSessionName}</span>
                  <ChevronRight size={10} className="flex-shrink-0 opacity-50 rotate-90" />
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content
                  side="top"
                  align="start"
                  sideOffset={4}
                  className="z-50 w-52 rounded-xl bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] shadow-xl p-1"
                  onInteractOutside={(e) => { if (renamingId !== null) e.preventDefault() }}
                >
                  <div className="text-[10px] text-[rgb(var(--color-text-muted))] uppercase tracking-wide px-2 pt-1 pb-1.5">Sessions</div>
                  {sessions.map((session) => (
                    <div
                      key={session.id}
                      className={`relative flex items-center gap-1 rounded-lg px-2 py-1.5 group cursor-pointer
                        ${session.id === currentSessionId
                          ? 'bg-[rgb(var(--color-accent))/15] text-[rgb(var(--color-accent))]'
                          : 'hover:bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))]'
                        }`}
                      onClick={() => { if (session.id !== currentSessionId) { switchSession(session.id); setSessionPopoverOpen(false) } }}
                    >
                      {renamingId === session.id ? (
                        <input
                          ref={renameInputRef}
                          className="flex-1 text-xs bg-[rgb(var(--color-surface-4))] rounded px-1 py-0.5 outline-none text-[rgb(var(--color-text-primary))]"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={commitRename}
                          onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenamingId(null) }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <>
                          {/* Icon button — click to open picker */}
                          <button
                            className="flex-shrink-0 leading-none rounded px-0.5 hover:bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))]"
                            title="Change icon"
                            onClick={(e) => { e.stopPropagation(); setIconPickerFor(iconPickerFor === session.id ? null : session.id) }}
                          >
                            {(() => { const e = SESSION_ICONS.find(i => i.name === session.icon) ?? SESSION_ICONS[0]; return <e.Icon size={13} /> })()}
                          </button>
                          {/* Inline icon grid — appears ABOVE the row, left-aligned */}
                          {iconPickerFor === session.id && (
                            <div
                              className="absolute left-0 bottom-full mb-1 z-[60] p-1.5 grid grid-cols-6 gap-0.5 rounded-lg bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] shadow-xl"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {SESSION_ICONS.map(({ name, Icon }) => (
                                <button
                                  key={name}
                                  onClick={() => { setSessionIcon(session.id, name); setIconPickerFor(null) }}
                                  className={`p-1.5 rounded cursor-pointer transition-colors hover:bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text-primary))] ${session.icon === name ? 'bg-[rgb(var(--color-accent))/15] text-[rgb(var(--color-accent))]' : ''}`}
                                  title={name}
                                >
                                  <Icon size={14} />
                                </button>
                              ))}
                            </div>
                          )}
                          <span className="flex-1 text-xs truncate">{session.name}</span>
                          {session.id === currentSessionId && <Check size={11} className="flex-shrink-0 text-[rgb(var(--color-accent))]" />}
                          <button
                            className={`p-0.5 rounded hover:bg-[rgb(var(--color-surface-4))] transition-opacity ${session.id === currentSessionId ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
                            onClick={(e) => { e.stopPropagation(); startRename(session.id, session.name) }}
                          >
                            <Pencil size={10} />
                          </button>
                          {sessions.length > 1 && (
                            <button
                              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-500/20 hover:text-red-400 transition-opacity"
                              onClick={(e) => { e.stopPropagation(); deleteSession(session.id) }}
                            >
                              <Trash2 size={10} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                  <div className="my-1 h-px bg-[rgb(var(--color-surface-4))]" />
                  <button
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                    onClick={() => { createSession(); setSessionPopoverOpen(false) }}
                  >
                    <Plus size={12} />
                    New session <span className="ml-auto opacity-50">⌘⇧0</span>
                  </button>
                  <Popover.Arrow className="fill-[rgb(var(--color-surface-4))]" />
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          </div>
        )}

        {/* Settings + collapse — layout depends on collapsed state */}
        {sidebarCollapsed ? (
          <div className="px-2 pt-2 pb-3 flex-shrink-0 border-t border-[rgb(var(--color-surface-4))] flex flex-col items-center gap-0.5">
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button
                  onClick={openHistory}
                  className="no-drag relative flex items-center justify-center w-10 h-8 rounded-lg text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer select-none"
                >
                  <History size={15} />
                  {hasUnseenHistory && (
                    <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-[rgb(var(--color-accent))] opacity-70" />
                  )}
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content side="right" sideOffset={6} className="z-50 flex items-center gap-2 px-2 py-1 rounded text-xs bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] shadow-lg">
                  History
                  <kbd className="font-mono text-[10px] px-1 py-0.5 rounded bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))]">⌘H</kbd>
                  <Tooltip.Arrow className="fill-[rgb(var(--color-surface-4))]" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button
                  onClick={openSettings}
                  className="no-drag flex items-center justify-center w-10 h-8 rounded-lg text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer select-none"
                >
                  <Settings size={16} />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content side="right" sideOffset={6} className="z-50 flex items-center gap-2 px-2 py-1 rounded text-xs bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] shadow-lg">
                  Settings
                  <kbd className="font-mono text-[10px] px-1 py-0.5 rounded bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))]">⌘,</kbd>
                  <Tooltip.Arrow className="fill-[rgb(var(--color-surface-4))]" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button
                  onClick={toggleSidebar}
                  className="no-drag flex items-center justify-center w-10 h-8 rounded-lg text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                >
                  <PanelLeft size={14} className="rotate-180" />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content side="right" sideOffset={6} className="z-50 flex items-center gap-2 px-2 py-1 rounded text-xs bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] shadow-lg">
                  Expand sidebar
                  <kbd className="font-mono text-[10px] px-1 py-0.5 rounded bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))]">⌘⇧S</kbd>
                  <Tooltip.Arrow className="fill-[rgb(var(--color-surface-4))]" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          </div>
        ) : (
          <div className="px-2 pt-2 pb-3 flex-shrink-0 border-t border-[rgb(var(--color-surface-4))] flex items-center gap-1">
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button
                  onClick={openSettings}
                  className="no-drag flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm flex-1
                    text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))]
                    hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer select-none"
                >
                  <Settings size={16} className="flex-shrink-0" />
                  <span>Settings</span>
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content side="right" sideOffset={6} className="z-50 flex items-center gap-2 px-2 py-1 rounded text-xs bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] shadow-lg">
                  Settings
                  <kbd className="font-mono text-[10px] px-1 py-0.5 rounded bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))]">⌘,</kbd>
                  <Tooltip.Arrow className="fill-[rgb(var(--color-surface-4))]" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button
                  onClick={openHistory}
                  className="no-drag relative p-1.5 rounded flex-shrink-0 text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                >
                  <History size={14} />
                  {hasUnseenHistory && (
                    <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-[rgb(var(--color-accent))] opacity-70" />
                  )}
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content side="right" sideOffset={6} className="z-50 flex items-center gap-2 px-2 py-1 rounded text-xs bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] shadow-lg">
                  History
                  <kbd className="font-mono text-[10px] px-1 py-0.5 rounded bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))]">⌘H</kbd>
                  <Tooltip.Arrow className="fill-[rgb(var(--color-surface-4))]" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
            {/* Archive button — always visible in expanded bar */}
            <div className="relative">
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <button
                    ref={archiveBtnRef}
                    onClick={() => setArchiveOpen(v => !v)}
                    className={`no-drag relative p-1.5 rounded flex-shrink-0 transition-colors cursor-pointer ${
                      archiveOpen ? 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))]'
                        : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))]'
                    }`}
                  >
                    <Archive size={14} />
                    {archivedGroups.length > 0 && (
                      <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-[rgb(var(--color-accent))] opacity-70" />
                    )}
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Portal>
                  <Tooltip.Content side="top" sideOffset={6} className="z-50 px-2 py-1 rounded text-xs bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] shadow-lg">
                    Archived tabs{archivedGroups.length > 0 ? ` (${archivedGroups.length})` : ''}
                    <Tooltip.Arrow className="fill-[rgb(var(--color-surface-4))]" />
                  </Tooltip.Content>
                </Tooltip.Portal>
              </Tooltip.Root>
              {archiveOpen && createPortal(
                <div
                  ref={archivePanelRef}
                  className="fixed z-[9999] w-72 max-h-96 overflow-y-auto rounded-xl shadow-2xl border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-1))] py-1"
                  style={{ bottom: 48, left: 8 }}
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
                </div>,
                document.body
              )}
            </div>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button
                  onClick={toggleSidebar}
                  className="no-drag p-1.5 rounded flex-shrink-0 text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                >
                  <PanelLeft size={14} />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content side="right" sideOffset={6} className="z-50 flex items-center gap-2 px-2 py-1 rounded text-xs bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] shadow-lg">
                  Collapse sidebar
                  <kbd className="font-mono text-[10px] px-1 py-0.5 rounded bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))]">⌘⇧S</kbd>
                  <Tooltip.Arrow className="fill-[rgb(var(--color-surface-4))]" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          </div>
        )}
      </aside>

      {/* ── Tab-bar right-click context menu ── */}
      {tabBarMenu && createPortal(
        <MenuPositioner ref={tabBarMenuRef} x={tabBarMenu.x} y={tabBarMenu.y}
          className="min-w-44 rounded-xl bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] shadow-2xl p-1 text-xs"
        >
          <div className="px-2 py-1 text-[10px] text-[rgb(var(--color-text-muted))] uppercase tracking-wide">Open new tab</div>
          {SPACES.map(({ type, label, icon: Icon }) => (
            <button
              key={type}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
              onClick={() => { createTab(type); setTabBarMenu(null) }}
            >
              <Icon size={12} />
              {label}
            </button>
          ))}
          <div className="my-1 h-px bg-[rgb(var(--color-surface-4))]" />
          <button
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
            onClick={() => { toggleSidebar(); setTabBarMenu(null) }}
          >
            <PanelLeft size={12} className={sidebarCollapsed ? 'rotate-180' : ''} />
            {sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          </button>
          <button
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
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
          className="w-56 max-h-[70vh] flex flex-col rounded-xl bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] shadow-2xl text-xs"
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
                    className="w-full text-left px-2 py-1 rounded-lg text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer flex items-center justify-between gap-2"
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
                        className="w-full text-left px-2 py-1 rounded-lg text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer flex items-center justify-between gap-2"
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
      {/* ── Global nav history dropdown ── */}
      {navDropdown && createPortal(
        <div
          ref={navDropdownRef}
          style={{ position: 'fixed', left: navDropdown.x, top: navDropdown.y, zIndex: 9999, minWidth: 220, maxWidth: 340 }}
          className="rounded-xl bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] shadow-2xl py-1 text-xs"
        >
          {(() => {
            const backItems = globalNavStack.slice(0, globalNavIdx).reverse()
            const fwdItems  = globalNavStack.slice(globalNavIdx + 1)
            const items     = navDropdown.mode === 'back' ? backItems
                            : navDropdown.mode === 'forward' ? fwdItems
                            : [...globalNavStack].reverse()
            if (items.length === 0) {
              return <div className="px-3 py-2 text-[rgb(var(--color-text-muted))]">No history yet</div>
            }
            const label = navDropdown.mode === 'back' ? 'Back' : navDropdown.mode === 'forward' ? 'Forward' : 'Navigation history'
            return (
              <>
                <div className="px-3 py-1 text-[9px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))]">{label}</div>
                {items.map((entry, i) => {
                  // Compute the actual stack index so we can jump to it
                  const stackIdx = navDropdown.mode === 'all'
                    ? globalNavStack.length - 1 - i
                    : navDropdown.mode === 'back'
                      ? globalNavIdx - 1 - i
                      : globalNavIdx + 1 + i
                  const isCurrent = stackIdx === globalNavIdx
                  const typeIcon = entry.type === 'note' ? '📝' : entry.type === 'lexicon' ? '📖' : entry.type === 'pdf' ? '📄' : '📜'
                  return (
                    <button
                      key={entry.id}
                      onClick={() => {
                        // Jump directly to this stack position
                        const delta = stackIdx - globalNavIdx
                        if (delta < 0) { for (let j = 0; j < -delta; j++) useAppStore.getState().navGlobalBack() }
                        else            { for (let j = 0; j < delta;  j++) useAppStore.getState().navGlobalForward() }
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
