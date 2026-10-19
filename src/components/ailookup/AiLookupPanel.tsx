import { useEffect, useRef, useState } from 'react'
import { X, SquarePen, Maximize2, ChevronDown } from 'lucide-react'
import { useAppStore } from '@/store'
import { IconButton, Popover, PopoverTrigger, PopoverSurface, BarMetrics, cx } from '@/components/ui'
import { HEADER_HEIGHT } from '@/lib/windowChrome'
import { ChatSurface, type ChatSurfaceHandle } from './ChatSurface'
import { ChatHistoryList, ChatListDialogs, type ChatListDialog } from './ChatHistoryList'
import { useChatController } from './useChatController'
import { performChatNav, getActiveTabContextRef } from './chatNav'
import { viewTitle } from './ChatTitle'
import { CHAT_HANDOFF_EVENT } from './chatMainBridge'
import type { ChatHandoff } from '@/types/electron'

// Resizable between MIN and MAX (also capped to the viewport).
const MIN_WIDTH = 360
const MIN_HEIGHT = 440
const MAX_WIDTH = 760
const MAX_HEIGHT = 860
const MARGIN = 16
/** Never cover the main window's top toolbar (title bar + its controls). */
const TOP_INSET = HEADER_HEIGHT + 8

function defaultSize() {
  return { width: 420, height: 600 }
}

/** Enforces the min/max bounds, also capping to the viewport itself. */
function clampSize(size: { width: number; height: number }) {
  const maxW = typeof window === 'undefined' ? MAX_WIDTH : Math.min(MAX_WIDTH, window.innerWidth - MARGIN * 2)
  const maxH = typeof window === 'undefined' ? MAX_HEIGHT : Math.min(MAX_HEIGHT, window.innerHeight - TOP_INSET - MARGIN)
  return {
    width: Math.min(Math.max(size.width, MIN_WIDTH), Math.max(MIN_WIDTH, maxW)),
    height: Math.min(Math.max(size.height, MIN_HEIGHT), Math.max(MIN_HEIGHT, maxH)),
  }
}

/** Bottom-right, like a Messages / FaceTime floating window. */
function defaultPos(size: { width: number; height: number }) {
  if (typeof window === 'undefined') return { x: 0, y: 0 }
  return { x: window.innerWidth - size.width - MARGIN, y: window.innerHeight - size.height - MARGIN }
}

function clampPos(pos: { x: number; y: number }, size: { width: number; height: number }) {
  const maxX = Math.max(MARGIN, window.innerWidth - size.width - MARGIN)
  const maxY = Math.max(TOP_INSET, window.innerHeight - size.height - MARGIN)
  return { x: Math.min(Math.max(pos.x, MARGIN), maxX), y: Math.min(Math.max(pos.y, TOP_INSET), maxY) }
}

/** Outside interactions that belong to the switcher (its row menu, the delete alert). */
const ownedByOverlay = (t: EventTarget | null) => t instanceof Element && !!t.closest('[role="menu"],[role="alertdialog"]')

/**
 * Berean Chat, embedded: a compact floating panel over the main window — one toolbar (the
 * conversation switcher = the title with a chevron, New Conversation, Expand, Close) above the
 * conversation. The switcher is an anchored popover holding the shared history list (search,
 * All Messages, Days, conversations by date; rename / delete in each row's menu). "Expand"
 * hands the conversation and draft to the standalone chat window (ChatWindowApp — same data,
 * same controller); "Return to Main Window" there hands them back (CHAT_HANDOFF_EVENT).
 *
 * LazyOnce (App.tsx) mounts this the first time the panel opens; it then stays mounted and only
 * hides on close, so an unsent draft survives closing and reopening the panel.
 */
export default function AiLookupPanel() {
  const open = useAppStore((s) => s.aiLookupPanelOpen)
  const setOpen = useAppStore((s) => s.setAiLookupPanelOpen)
  const settingsOpen = useAppStore((s) => s.settingsOpen)
  const storedPos = useAppStore((s) => s.aiLookupPanelPos)
  const setStoredPos = useAppStore((s) => s.setAiLookupPanelPos)
  const storedSize = useAppStore((s) => s.aiLookupPanelSize)
  const setStoredSize = useAppStore((s) => s.setAiLookupPanelSize)
  const setActiveChatId = useAppStore((s) => s.setAiLookupActiveChatId)

  const [size, setSize] = useState(() => clampSize(storedSize ?? defaultSize()))
  const [pos, setPos] = useState(() => clampPos(storedPos ?? defaultPos(size), size))
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const resizeRef = useRef<{ startX: number; startY: number; origW: number; origH: number } | null>(null)
  const composerRef = useRef<ChatSurfaceHandle | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  // Something was picked in the switcher → focus goes to the composer, not back to the title.
  const pickedRef = useRef(false)
  const [listDialog, setListDialog] = useState<ChatListDialog | null>(null)

  const c = useChatController({
    initialChatId: useAppStore.getState().aiLookupActiveChatId,
    onActiveChatIdChange: setActiveChatId,
    getTabContext: async () => getActiveTabContextRef(),
    aiSupported: true,
    resumeLatest: true,
  })

  // Whether the standalone chat window is open (Expand then just brings it forward).
  const [chatWindowOpen, setChatWindowOpen] = useState(false)
  useEffect(() => {
    const cw = window.chatWindow
    if (!cw) return
    cw.isOpen().then(setChatWindowOpen).catch(() => {})
    return cw.onWindowStateChanged(setChatWindowOpen)
  }, [])

  // Focus the composer whenever the panel opens; hiding the panel closes the switcher too.
  useEffect(() => {
    if (open) requestAnimationFrame(() => composerRef.current?.focus())
    else setSwitcherOpen(false)
  }, [open])

  function onDragStart(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest('button')) return
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  function onDragMove(e: React.PointerEvent) {
    if (!dragRef.current) return
    setPos(clampPos({ x: dragRef.current.origX + e.clientX - dragRef.current.startX, y: dragRef.current.origY + e.clientY - dragRef.current.startY }, size))
  }
  function onDragEnd() {
    if (!dragRef.current) return
    dragRef.current = null
    setStoredPos(pos)
  }
  // Bottom-right resize handle — grows down/right; position re-clamped so it stays on screen.
  function onResizeStart(e: React.PointerEvent) {
    e.stopPropagation()
    resizeRef.current = { startX: e.clientX, startY: e.clientY, origW: size.width, origH: size.height }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  function onResizeMove(e: React.PointerEvent) {
    if (!resizeRef.current) return
    const next = clampSize({ width: resizeRef.current.origW + e.clientX - resizeRef.current.startX, height: resizeRef.current.origH + e.clientY - resizeRef.current.startY })
    setSize(next)
    setPos((p) => clampPos(p, next))
  }
  function onResizeEnd() {
    resizeRef.current = null
    setStoredSize(size)
    setStoredPos(pos)
  }

  // Expand: THIS conversation and draft move to the chat window (the draft isn't left behind twice).
  const expand = async () => {
    if (!window.chatWindow) return
    const draft = composerRef.current?.getDraft() ?? ''
    await window.chatWindow.open({ chatId: c.activeChatId, draft: draft || undefined })
    if (draft) composerRef.current?.setDraft('')
    setOpen(false)
  }

  // "Return to Main Window" from the chat window: show the conversation it was on.
  const cRef = useRef(c)
  cRef.current = c
  useEffect(() => {
    const onHandoff = (e: Event) => {
      const h = (e as CustomEvent<ChatHandoff>).detail
      if (h.chatId) cRef.current.openConversation(h.chatId)
      else cRef.current.newConversation()
      if (h.draft) composerRef.current?.setDraft(h.draft)
    }
    window.addEventListener(CHAT_HANDOFF_EVENT, onHandoff)
    return () => window.removeEventListener(CHAT_HANDOFF_EVENT, onHandoff)
  }, [])

  // Closing the switcher drops its search (the panel's transcript never shows search results).
  const setSwitcher = (next: boolean) => {
    setSwitcherOpen(next)
    if (!next && cRef.current.search) cRef.current.setSearch('')
  }
  const openSwitcherSearch = () => {
    setSwitcherOpen(true)
    requestAnimationFrame(() => requestAnimationFrame(() => searchRef.current?.focus()))
  }
  const title = viewTitle(c)

  return (
    <div
      // z-overlay: above ordinary chrome, below z-popover/z-menu so the switcher and menus paint above it.
      // `.no-drag` on the whole container — Electron's drag-region hit-testing ignores paint order.
      // While Settings is open, drop under the Sheet so its backdrop dims this panel too.
      className={cx(
        'chat-scope-panel no-drag fixed flex flex-col material-panel rounded-menu overflow-hidden',
        settingsOpen ? 'z-raised pointer-events-none' : 'z-overlay',
        !open && 'hidden',
      )}
      style={{ left: pos.x, top: pos.y, width: size.width, height: size.height }}
      role="dialog"
      aria-label="Berean Chat"
      onKeyDown={(e) => {
        // ⌘F finds in this conversation (never the Scripture find bar behind the panel);
        // ⌥⌘F searches every message (Mail's convention). `code`: ⌥F types "ƒ".
        if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.code === 'KeyF') {
          e.preventDefault(); e.stopPropagation()
          if (e.altKey || !composerRef.current?.openFind()) openSwitcherSearch()
        }
      }}
    >
      {/* One compact bar on the panel's own material — no nested bar material and no glass per
          button (BarMetrics off: these are the panel's 24px controls, not window-toolbar ones). */}
      <BarMetrics value={false}>
      <div
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        className="flex-shrink-0 h-[var(--chat-header-h)] flex items-center gap-[var(--chat-space-1)] px-[var(--chat-space-2)] cursor-grab active:cursor-grabbing select-none"
      >
        <Popover open={switcherOpen} onOpenChange={setSwitcher}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="no-drag min-w-0 max-w-[70%] h-[var(--chat-control)] inline-flex items-center gap-[var(--chat-space-1)] px-[var(--chat-space-2)] rounded-control-md text-text-primary hover:bg-control-hover active:bg-control-pressed data-[state=open]:bg-control-pressed focus-ring transition-colors duration-fast cursor-pointer"
              aria-label={`Conversations — ${title}`}
              aria-haspopup="dialog"
            >
              <span className="min-w-0 truncate text-footnote font-semibold">{title}</span>
              <ChevronDown size={12} strokeWidth={2} className="flex-shrink-0 text-text-muted" aria-hidden />
            </button>
          </PopoverTrigger>
          <PopoverSurface
            side="bottom"
            align="start"
            sideOffset={4}
            aria-label="Conversations"
            innerClassName="chat-scope-panel flex flex-col pt-[var(--chat-space-2)] w-[min(var(--chat-switcher-w),calc(100vw-32px))]"
            onOpenAutoFocus={(e) => {
              // Focus the current conversation's row (↑/↓ from there), else the search field.
              e.preventDefault()
              const sel = document.querySelector<HTMLElement>('[data-chat-switcher] [data-roving][aria-current="true"]')
              ;(sel ?? searchRef.current)?.focus()
            }}
            onCloseAutoFocus={(e) => {
              if (pickedRef.current) { e.preventDefault(); pickedRef.current = false; composerRef.current?.focus() }
            }}
            onEscapeKeyDown={(e) => {
              // Esc clears a search first, cancels an inline rename, and closes a row menu —
              // only then does it close the switcher (focus returns to the title button).
              const active = document.activeElement
              if (active === searchRef.current && cRef.current.search) { e.preventDefault(); cRef.current.setSearch('') }
              else if (active instanceof HTMLInputElement && active.getAttribute('aria-label') === 'Conversation name') e.preventDefault()
              else if (document.querySelector('[role="menu"]')) e.preventDefault()
            }}
            onInteractOutside={(e) => { if (ownedByOverlay(e.target)) e.preventDefault() }}
          >
            <div
              data-chat-switcher
              className="flex flex-col min-h-0"
              style={{ maxHeight: `min(${Math.round(size.height * 0.6)}px, var(--radix-popover-content-available-height, 100vh))` }}
            >
              <ChatHistoryList
                ref={searchRef}
                c={c}
                inlineResults
                className="flex-1"
                onNavigate={() => { pickedRef.current = true; setSwitcher(false) }}
                onRequestDialog={(d) => { setSwitcher(false); setListDialog(d) }}
              />
            </div>
          </PopoverSurface>
        </Popover>
        <div className="flex-1 self-stretch" aria-hidden />
        <IconButton icon={SquarePen} label="New Conversation" size={24} tooltip={{ side: 'bottom' }}
          onClick={() => { c.setSearch(''); c.newConversation(); composerRef.current?.focus() }} />
        {window.chatWindow && (
          <IconButton icon={Maximize2} label={chatWindowOpen ? 'Show in Chat Window' : 'Expand'} size={24} tooltip={{ side: 'bottom' }} onClick={() => void expand()} />
        )}
        <IconButton
          icon={X}
          label="Close"
          size={24}
          tooltip={{ side: 'bottom' }}
          // No unloadModel() here: the idle-unload timer in electron/ollama.ts reclaims the model;
          // unloading on every close made the next open pay a cold load.
          onClick={() => setOpen(false)}
        />
      </div>
      </BarMetrics>

      <div className="flex-1 min-h-0 flex flex-col">
        <ChatSurface ref={composerRef} c={c} navigate={performChatNav} searchInSidebar onShowConversations={() => setSwitcherOpen(true)} />
      </div>

      <ChatListDialogs c={c} dialog={listDialog} onClose={() => setListDialog(null)} />

      <div
        onPointerDown={onResizeStart}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        aria-hidden
        className="no-drag absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize touch-none z-raised"
      >
        <svg viewBox="0 0 16 16" className="w-full h-full text-text-quaternary">
          <path d="M14 2 L2 14 M14 8 L8 14" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  )
}
