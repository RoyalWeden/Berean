import { useEffect, useRef, useState } from 'react'
import { PanelLeft, SquarePen, PanelBottomOpen } from 'lucide-react'
import { useAppStore } from '@/store'
import { applyThemeToDocument } from '@/lib/applyTheme'
import { TRAFFIC_LIGHT_INSET } from '@/lib/windowChrome'
import { IconButton, cx } from '@/components/ui'
import { ChatSurface, type ChatSurfaceHandle } from './ChatSurface'
import { ChatSidebar } from './ChatSidebar'
import { useChatController } from './useChatController'
import { ChatTitle } from './ChatTitle'
import type { ChatHandoff, ChatNavPayload } from '@/types/electron'

export const SIDEBAR_KEY = 'berean-chat-window-sidebar'
const readSidebarPref = () => { try { return localStorage.getItem(SIDEBAR_KEY) !== '0' } catch { return true } }
const writeSidebarPref = (open: boolean) => { try { localStorage.setItem(SIDEBAR_KEY, open ? '1' : '0') } catch { /* per-window convenience only */ } }

/** Below this window width the sidebar collapses on its own (the remembered preference is kept)
 *  and the toggle shows it as an overlay instead — 480 (min width) − 264 would leave no column. */
export const SIDEBAR_AUTO_COLLAPSE_WIDTH = 640
/** Title-bar geometry: 52px bar, 28px controls centred on it — the traffic lights sit on the same
 *  centre line (electron/main.ts trafficLightPosition y 20), and the sidebar toggle sits just
 *  right of them at the same x whether the sidebar is shown or not (Notes / Mail). */
const HEADER_H = 52
const CONTROL = 28
const TOGGLE_TOP = (HEADER_H - CONTROL) / 2
const TITLE_INSET_COLLAPSED = TRAFFIC_LIGHT_INSET + CONTROL + 12

/** ⌃⌘S (Apple's "Show/Hide Sidebar") and ⌘⇧S (Berean's main-window sidebar shortcut). */
export function isToggleSidebarKey(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>): boolean {
  if (e.altKey || e.key.toLowerCase() !== 's') return false
  return (e.metaKey && e.ctrlKey && !e.shiftKey) || (e.metaKey && e.shiftKey && !e.ctrlKey)
}

function useNarrowWindow(maxWidth: number) {
  const [narrow, setNarrow] = useState(() => window.innerWidth < maxWidth)
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < maxWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [maxWidth])
  return narrow
}

/**
 * The standalone Berean Chat window (`?chat=1`, electron/main.ts createChatWindow): a Messages-
 * like layout — source list on the left (search, All Messages, Days, conversations by date),
 * the transcript and a floating composer sharing one centred column on the right, hiddenInset
 * title bar. The sidebar toggle (⌃⌘S) is remembered across launches; narrow windows collapse
 * the sidebar without forgetting that choice.
 *
 * Its renderer has its own store (read-only over the shared persisted blob — see
 * IS_SECONDARY_WINDOW in src/store/index.ts), so anything about the MAIN window's tabs goes
 * through window.chatWindow: results open there (openInMain), and "This Tab" asks it for its
 * active tab (getMainTabContext). Conversations are the same ai_chats rows the embedded panel
 * uses; `ailookup:chatsChanged` keeps the two live.
 */
export default function ChatWindowApp() {
  useFollowAppTheme()
  const [sidebarPref, setSidebarPref] = useState(readSidebarPref)
  const narrow = useNarrowWindow(SIDEBAR_AUTO_COLLAPSE_WIDTH)
  const [overlayOpen, setOverlayOpen] = useState(false)
  useEffect(() => { if (!narrow) setOverlayOpen(false) }, [narrow])
  const docked = !narrow && sidebarPref
  const composerRef = useRef<ChatSurfaceHandle | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  const c = useChatController({
    initialChatId: null,
    getTabContext: async () => (await window.chatWindow?.getMainTabContext()) ?? undefined,
    aiSupported: true,
    resumeLatest: true,
  })

  const navigate = (payload: ChatNavPayload) => { void window.chatWindow?.openInMain(payload) }

  // Open on the conversation (and draft) the embedded panel had — on load, and when re-targeted.
  const cRef = useRef(c)
  cRef.current = c
  useEffect(() => {
    const apply = (h: ChatHandoff | null) => {
      if (!h) return
      cRef.current.setSearch('')
      if (h.chatId) cRef.current.openConversation(h.chatId)
      else cRef.current.newConversation()
      if (h.draft) composerRef.current?.setDraft(h.draft)
    }
    void window.chatWindow?.takeHandoff().then(apply).catch(() => {})
    return window.chatWindow?.onHandoff(apply)
  }, [])
  const returnToMain = () => {
    const draft = composerRef.current?.getDraft() ?? ''
    void window.chatWindow?.returnToMain({ chatId: c.activeChatId, draft: draft || undefined })
  }

  // ⌘N (routed by the app menu while this window is key) → New Conversation.
  const newConversationRef = useRef(() => {})
  newConversationRef.current = () => { c.setSearch(''); c.newConversation(); composerRef.current?.focus() }
  useEffect(() => window.chatWindow?.onNewConversation(() => newConversationRef.current()), [])

  // Sidebar commands, through refs so the one key listener never goes stale.
  const commands = useRef<{ toggle: () => void; reveal: () => void; find: () => void; search: () => void; dismissOverlay: () => boolean }>({ toggle: () => {}, reveal: () => {}, find: () => {}, search: () => {}, dismissOverlay: () => false })
  commands.current = {
    // A narrow window shows the sidebar as an overlay and leaves the remembered choice alone.
    toggle: () => {
      if (narrow) { setOverlayOpen((v) => !v); return }
      const next = !sidebarPref
      setSidebarPref(next)
      writeSidebarPref(next)
    },
    // Reveal for search / "Show All Conversations" without persisting.
    reveal: () => { if (narrow) setOverlayOpen(true); else setSidebarPref(true) },
    // ⌘F / Edit ▸ Find: find in this conversation; with nothing to search, search everything.
    find: () => { if (!composerRef.current?.openFind()) commands.current.search() },
    // ⌥⌘F: search every message (the sidebar's field).
    search: () => { commands.current.reveal(); requestAnimationFrame(() => searchRef.current?.focus()) },
    dismissOverlay: () => { if (!overlayOpen) return false; setOverlayOpen(false); return true },
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isToggleSidebarKey(e)) { e.preventDefault(); commands.current.toggle() }
      // ⌘F → find in this conversation, ⌥⌘F → search all messages (the menu's Find item leaves
      // ⌘F to the renderer). `code`, not `key`: ⌥F types "ƒ".
      else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.code === 'KeyF') { e.preventDefault(); if (e.altKey) commands.current.search(); else commands.current.find() }
      else if (e.key === 'Escape' && !e.defaultPrevented && commands.current.dismissOverlay()) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    // View → Toggle Sidebar / Find clicked in the menu bar while this window is key.
    window.app?.onAppCommand?.((id) => {
      if (id === 'toggle-sidebar') commands.current.toggle()
      else if (id === 'find') commands.current.find()
    })
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => { requestAnimationFrame(() => composerRef.current?.focus()) }, [])
  useEffect(() => { document.title = 'Berean Chat' }, [])

  const subtitle = c.view.kind === 'conversation'
    ? (c.activeChatId ? `${c.messages.length} message${c.messages.length === 1 ? '' : 's'}` : 'New Conversation')
    : 'Every conversation, oldest to newest'

  const sidebarShown = docked || (narrow && overlayOpen)

  return (
    <div className="h-screen w-screen flex bg-surface-1 text-text-primary overflow-hidden relative">
      {docked && (
        <aside className="w-[var(--chat-sidebar-w)] flex-shrink-0 flex flex-col bg-surface-2 border-r border-separator">
          <div className="app-drag-region h-[var(--chat-header-h)] flex-shrink-0" aria-hidden />
          <ChatSidebar ref={searchRef} c={c} className="flex-1" />
        </aside>
      )}

      <main className="flex-1 min-w-0 flex flex-col">
        <header
          className="app-drag-region h-[var(--chat-header-h)] flex-shrink-0 flex items-center gap-[var(--chat-space-1)] pr-[var(--chat-space-3)] border-b border-separator"
          style={{ paddingLeft: docked ? 'var(--chat-gutter)' : TITLE_INSET_COLLAPSED }}
        >
          {c.search.trim() ? (
            // Searching is its own state: the header says so (Esc in the field, or ×, returns).
            <div className="flex-1 min-w-0 pr-[var(--chat-space-2)] select-none">
              <div className="text-footnote font-semibold leading-tight truncate">Search</div>
              <div className="text-caption2 text-text-muted truncate">Results for “{c.search.trim()}” · conversations and messages</div>
            </div>
          ) : <ChatTitle c={c} align="left" subtitle={subtitle} className="pr-[var(--chat-space-2)]" />}
          <IconButton icon={SquarePen} label="New Conversation" variant="ghost" tooltip={{ shortcut: '⌘N', side: 'bottom' }} size={28} onClick={() => newConversationRef.current()} />
          <IconButton icon={PanelBottomOpen} label="Return to Main Window" variant="ghost" tooltip={{ side: 'bottom' }} size={28} onClick={returnToMain} />
        </header>
        <ChatSurface ref={composerRef} c={c} navigate={navigate} floatingComposer onShowConversations={() => commands.current.search()} />
      </main>

      {/* Narrow window: the sidebar slides over the content instead of squeezing it. */}
      {narrow && (
        <>
          <div
            className={cx('absolute inset-0 z-raised scrim-light transition-opacity duration-base', overlayOpen ? 'opacity-100' : 'opacity-0 pointer-events-none')}
            onClick={() => setOverlayOpen(false)}
            aria-hidden
          />
          <aside
            className={cx(
              'absolute top-0 bottom-0 left-0 z-raised w-[var(--chat-sidebar-w)] max-w-[85%] flex flex-col bg-surface-2 border-r border-separator shadow-2',
              'transition-transform duration-base ease-mac',
              overlayOpen ? 'translate-x-0' : '-translate-x-full',
            )}
            aria-hidden={!overlayOpen}
          >
            <div className="app-drag-region h-[var(--chat-header-h)] flex-shrink-0" aria-hidden />
            {overlayOpen && <ChatSidebar ref={searchRef} c={c} onNavigate={() => setOverlayOpen(false)} className="flex-1" />}
          </aside>
        </>
      )}

      {/* The one sidebar toggle: fixed beside the traffic lights in both states, so it never jumps.
          Rendered LAST: Electron resolves overlapping app-region rects in document order, so a
          no-drag placed before the header / sidebar drag regions is swallowed by them. */}
      <div className="absolute z-overlay no-drag" style={{ left: TRAFFIC_LIGHT_INSET, top: TOGGLE_TOP }}>
        <IconButton
          icon={PanelLeft}
          label={sidebarShown ? 'Hide Sidebar' : 'Show Sidebar'}
          size={28}
          variant="ghost"
          tooltip={{ shortcut: '⌃⌘S', side: 'bottom' }}
          aria-expanded={sidebarShown}
          onClick={() => commands.current.toggle()}
        />
      </div>
    </div>
  )
}

/** Same theme plumbing as StudyTrailApp: apply the persisted theme to THIS document, follow the
 *  system scheme and accent, and re-read the shared blob when the main window saves it. */
function useFollowAppTheme() {
  const theme = useAppStore((s) => s.theme)
  const themePreset = useAppStore((s) => s.themePreset)
  const systemAccentColor = useAppStore((s) => s.systemAccentColor)
  const backgroundAnimationEnabled = useAppStore((s) => s.backgroundAnimationEnabled)
  const backgroundAnimationStyle = useAppStore((s) => s.backgroundAnimationStyle)
  const backgroundAnimationIntensity = useAppStore((s) => s.backgroundAnimationIntensity)
  const glassAppearance = useAppStore((s) => s.glassAppearance)
  const customThemes = useAppStore((s) => s.customThemes)
  const [systemIsDark, setSystemIsDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemIsDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  useEffect(() => {
    const set = useAppStore.getState().setSystemAccentColor
    window.app?.getAccentColor?.().then((rgb) => set(rgb)).catch(() => {})
    window.app?.onAccentColorChanged?.((rgb) => set(rgb))
  }, [])
  // The main window owns the persisted blob; when it writes (theme change, Ask Berean options),
  // pick the new values up here. This window never writes it back.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === 'berean-app-state') void useAppStore.persist.rehydrate() }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  useEffect(() => {
    applyThemeToDocument({
      theme, themePreset, systemIsDark, systemAccentColor,
      backgroundAnimationEnabled, backgroundAnimationStyle, backgroundAnimationIntensity, glassAppearance, customThemes,
    })
  }, [theme, themePreset, systemIsDark, systemAccentColor, backgroundAnimationEnabled, backgroundAnimationStyle, backgroundAnimationIntensity, glassAppearance, customThemes])
}
