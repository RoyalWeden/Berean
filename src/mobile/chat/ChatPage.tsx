import React, { useEffect, useMemo, useRef, useState } from 'react'
import { SquarePen, MessagesSquare, MessageCircle, Search, X, ArrowUp, Sparkles, Copy, Trash2, Pencil, Check, CornerUpLeft, Pin, PinOff, Folder, FolderPlus, FolderMinus, FolderInput, ChevronDown, MoreHorizontal, Inbox, TextSearch } from 'lucide-react'
import { Page, ListSection, Row, IconTap } from '../primitives/Page'
import { useActionSheet } from '../primitives/ActionSheet'
import type { EditorState } from 'prosemirror-state'
import { useLongPress } from '../primitives/useLongPress'
import { usePopoverMenu } from '../primitives/PopoverMenu'
import { useSwipeToReply } from './useSwipeToReply'
import { haptic } from '../primitives/haptics'
import { NavigationStack, useNavigation } from '../navigation/NavigationStack'
import { useChatController, type ChatController } from '@/components/ailookup/useChatController'
import { ChatTranscript } from '@/components/ailookup/ChatTranscript'
import { ChatRowActionsContext, ChatEditingIdContext, type ChatRowActions } from '@/components/ailookup/ChatMessageRow'
import { ChatNavContext, performChatNav, type ChatNavigate } from '@/components/ailookup/chatNav'
import { formatDayHeading, formatListTime, messagePreviewText } from '@/components/ailookup/chatModel'
import { organizeConversations, highlightAll, type SearchFilter } from '@/components/ailookup/ChatHistoryList'
import { filterConversations } from '@/components/ailookup/ChatComposerControls'
import { PhoneFindBar } from './PhoneFindBar'
import { UNFILED_CHAT_ID, UNFILED_CHAT_TITLE } from '@/components/ailookup/chatModel'
import type { AiLookupChatSummary } from '@/types/electron'
import { ChatReplyBar } from '@/components/ailookup/ChatReplyQuote'
import { ChatEditor, type ChatEditorHandle } from '@/components/ailookup/composer/ChatEditor'
import { FormatToolbar, type FormatItem } from '@/components/ailookup/composer/FormatToolbar'
import { activeFormats, NO_FORMATS, sameFormats, isDocEmpty, type ActiveFormats } from '@/components/ailookup/composer/chatEditorState'
import { useComposerDraft } from '@/components/ailookup/composer/useComposerDraft'
import '@/components/ailookup/chat.css'
import './chat.css'

/** Shown when the (disabled) sparkle is tapped — the local model runs on the Mac only. */
export const ASK_BEREAN_PHONE_HINT = 'Ask Berean is available on the Mac'

export interface ChatPageProps {
  /** Leaves the page (back to wherever it was opened from). */
  onBack?: () => void
  /**
   * "New Message" entry: any truthy value opens straight into the composer — today's
   * conversation if one was used today, otherwise a new, unsaved one (nothing is created until a
   * message is sent, so repeated entries never leave empty duplicates). Bump the number to
   * trigger it again while the page is mounted (e.g. a second tap on a "New Message" button).
   */
  newMessageToken?: number
  /** Open a result from a (Mac-made) AI reply. Defaults to the shared store navigation. */
  onNavigate?: ChatNavigate
  /** The left-edge swipe on the list finished (the page is already off screen). Defaults to onBack. */
  onEdgeClose?: () => void
}

/**
 * Berean Chat on iPhone — a Messages-style page for quick notes: a source list (search, All
 * Messages, Days, Conversations) and a conversation view with a composer. It reads and writes the
 * same synced ai_chats rows as the Mac (src/platform/ios/bridgeExtras.ts → aiChatsService), so
 * notes typed here show up in Berean Chat on the Mac and vice versa, along with the history of
 * Ask Berean answers. Ask Berean itself needs the Mac's local model, so the sparkle is shown
 * but disabled with an explanation.
 *
 * Self-contained: not wired into navigation. Mount it as a page (see the lane report):
 *   <ChatPage onBack={pop} />                     // conversation list
 *   <ChatPage onBack={pop} newMessageToken={n} /> // straight into "New Message"
 */
export function ChatPage({ onBack, newMessageToken, onNavigate, onEdgeClose }: ChatPageProps) {
  const c = useChatController({ aiSupported: false, startWithNewMessage: !!newMessageToken })
  const composerRef = useRef<ChatEditorHandle | null>(null)
  const firstToken = useRef(newMessageToken)
  const navigate = onNavigate ?? performChatNav
  const live = { c, composerRef, onBack, token: newMessageToken, firstToken: firstToken.current }

  // The list is the root and a conversation is PUSHED on the app's own NavigationStack (TEST
  // 2026-10-18 "allow the user to backwards navigate by swiping when in the berean chat"): the same
  // slide-in, ‹ and left-edge swipe as every other page. A swipe on the list closes Chat itself.
  // Stack entries are fixed elements, so they read the live controller through ChatLiveContext.
  return (
    <ChatNavContext.Provider value={navigate}>
      <ChatLiveContext.Provider value={live}>
        <NavigationStack
          rootKey="chat-list"
          root={<ChatListRoot />}
          onEdgeBack={onEdgeClose ?? onBack}
          canEdgeBack={() => !!onBack}
          initialStack={newMessageToken ? [{ key: THREAD_KEY, element: <ChatThreadEntry /> }] : undefined}
        />
      </ChatLiveContext.Provider>
    </ChatNavContext.Provider>
  )
}

const THREAD_KEY = 'chat-thread'
interface ChatLive { c: ChatController; composerRef: React.MutableRefObject<ChatEditorHandle | null>; onBack?: () => void; token?: number; firstToken?: number }
const ChatLiveContext = React.createContext<ChatLive | null>(null)
const useChatLive = () => React.useContext(ChatLiveContext)!

/** A later "New Message" while mounted: same target rule, straight to the composer. */
function NewMessageWatcher() {
  const { c, token, firstToken } = useChatLive()
  const nav = useNavigation()
  useEffect(() => {
    if (!token || token === firstToken) return
    void c.startNewMessage().then(() => nav.push(THREAD_KEY, <ChatThreadEntry />))
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

function ChatListRoot() {
  const { c, onBack } = useChatLive()
  const nav = useNavigation()
  return (
    <>
      <ChatListScreen c={c} onBack={onBack} onOpen={(fn) => { fn(); nav.push(THREAD_KEY, <ChatThreadEntry />) }} />
      <NewMessageWatcher />
    </>
  )
}

function ChatThreadEntry() {
  const { c, composerRef, token } = useChatLive()
  const nav = useNavigation()
  // The keyboard comes up for a NEW message (pencil / widget "New Message"), not when reading an
  // existing conversation (Messages) — it used to cover half of the answer you opened.
  const wantsKeyboard = useRef(!c.activeChatId || !!token)
  useEffect(() => { if (wantsKeyboard.current) requestAnimationFrame(() => composerRef.current?.focus()) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return <ChatThreadScreen c={c} composerRef={composerRef} onBack={nav.pop} />
}

const FOLDER_KEY = (name: string) => `chat-folder:${name}`
/** A menu row label on one line (long conversation titles crowded the popup). */
const oneLine = (t: string, max = 34) => (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t)

/** Press-and-hold on a conversation or folder row: its actions as a popup next to the row. */
function useConversationActions(c: ChatController) {
  const popover = usePopoverMenu()
  const moveMenu = (anchor: Element, s: AiLookupChatSummary) => popover(anchor, 'Move to Folder', [
    ...c.folders.map((f) => ({ id: `f:${f}`, label: oneLine(f), icon: Folder, checked: s.folder === f, onSelect: () => { void c.moveToFolder(s.id, f) } })),
    { id: 'new', label: 'New Folder…', icon: FolderPlus, section: c.folders.length > 0, onSelect: () => { const name = window.prompt('New Folder', ''); if (name?.trim()) void c.moveToFolder(s.id, name) } },
    ...(s.folder ? [{ id: 'out', label: 'Remove from Folder', icon: FolderMinus, onSelect: () => { void c.moveToFolder(s.id, null) } }] : []),
  ])
  return useLongPress(({ target }) => {
    const row = (target as HTMLElement | null)?.closest?.('[data-row-id]') as HTMLElement | null
    const id = row?.dataset.rowId
    if (!row || !id) return
    try { window.getSelection()?.removeAllRanges() } catch { /* */ }
    void haptic.medium()
    if (id.startsWith('folder:')) {
      const folder = id.slice(7)
      popover(row, undefined, [
        { id: 'rename', label: 'Rename Folder…', icon: Pencil, onSelect: () => { const name = window.prompt('Rename Folder', folder); if (name?.trim() && name.trim() !== folder) void c.renameFolder(folder, name) } },
        { id: 'delete', label: 'Delete Folder', icon: Trash2, destructive: true, section: true, onSelect: () => { if (window.confirm(`Delete the folder “${folder}”? Its conversations are kept.`)) void c.renameFolder(folder, null) } },
      ], { haptic: false })
      return
    }
    const s = c.summaries.find((x) => x.id === id)
    if (!s) return
    popover(row, undefined, [
      { id: 'pin', label: s.pinnedAt ? 'Unpin' : 'Pin', icon: s.pinnedAt ? PinOff : Pin, onSelect: () => { void c.pinChat(s.id, !s.pinnedAt) } },
      { id: 'move', label: 'Move to Folder…', icon: FolderInput, onSelect: () => { requestAnimationFrame(() => moveMenu(row, s)) } },
      { id: 'delete', label: 'Delete Conversation', icon: Trash2, destructive: true, section: true, onSelect: () => { if (window.confirm(`Delete “${s.title}”? Its messages are removed from all your devices.`)) void c.deleteChat(s.id) } },
    ], { haptic: false })
  })
}

function ConversationListRow({ s, onOpen }: { s: AiLookupChatSummary; onOpen: () => void }) {
  return (
    <Row rowId={s.id} title={s.title} subtitle={s.preview || undefined} leading={s.pinnedAt ? <Pin size={18} /> : <MessageCircle size={20} />}
      right={<span className="m-chat-time">{formatListTime(s.lastMessageAt ?? s.updated_at)}</span>}
      onClick={onOpen} />
  )
}

/** One folder's conversations (pushed from the list). */
function ChatFolderEntry({ name }: { name: string }) {
  const { c } = useChatLive()
  const nav = useNavigation()
  const lp = useConversationActions(c)
  const items = useMemo(() => organizeConversations(c.summaries).folders.find((f) => f.name === name)?.items ?? [], [c.summaries, name])
  return (
    <Page title={name} onBack={nav.pop} backLabel="Messages" className="m-chat-list">
      <div onPointerDown={lp.onPointerDown} onPointerMove={lp.onPointerMove} onPointerUp={lp.onPointerUp} onPointerCancel={lp.onPointerCancel} onClickCapture={lp.onClickCapture}>
        <ListSection>
          {items.length === 0 && <div className="mobile-empty">This folder is empty.</div>}
          {items.map((s) => <ConversationListRow key={s.id} s={s} onOpen={() => { c.openConversation(s.id); nav.push(THREAD_KEY, <ChatThreadEntry />) }} />)}
        </ListSection>
      </div>
    </Page>
  )
}

function ChatListScreen({ c, onBack, onOpen }: { c: ChatController; onBack?: () => void; onOpen: (fn: () => void) => void }) {
  const [allDays, setAllDays] = useState(false)
  const nav = useNavigation()
  const lp = useConversationActions(c)
  const days = (c.days ?? []).slice(0, allDays ? 60 : 3)
  // Same organisation as the Mac's history list: Pinned, Folders, then Today / Yesterday / …
  const { pinned, folders, groups } = useMemo(() => organizeConversations(c.summaries), [c.summaries])
  useEffect(() => { void c.refreshDays() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const q = c.search.trim()

  const search = (
    <div className="mobile-search-field m-chat-search">
      <Search size={17} aria-hidden />
      <input className="mobile-search-input" type="search" inputMode="text" autoCorrect="off" enterKeyHint="search"
        placeholder="Search Messages" aria-label="Search messages" value={c.search} onChange={(e) => c.setSearch(e.target.value)} />
      {c.search && <button type="button" className="m-chat-search-clear" aria-label="Clear search" onClick={() => c.setSearch('')}><X size={16} /></button>}
    </div>
  )

  return (
    <Page
      title="Messages"
      onBack={onBack}
      right={<IconTap icon={SquarePen} label="New Message" onClick={() => onOpen(() => { c.setSearch(''); c.newConversation() })} />}
      headerBelow={search}
      className="m-chat-list"
    >
      {q ? (
        // Global search: conversations and messages (filterable), every match marked. Opening a
        // message lands on it with Find set to the query (useChatController.openSearchResult).
        <PhoneSearchResults c={c} q={q} onOpen={onOpen} />
      ) : (
        <>
          <ListSection>
            <Row title="All Messages" leading={<MessagesSquare size={20} />} chevron onClick={() => onOpen(() => c.setView({ kind: 'all' }))} />
            <Row title={UNFILED_CHAT_TITLE} leading={<Inbox size={20} />} chevron onClick={() => onOpen(() => c.openConversation(UNFILED_CHAT_ID))} />
          </ListSection>
          {days.length > 0 && (
            <ListSection title="Days">
              {days.map((d) => (
                <Row key={d.dayKey} title={formatDayHeading(d.dayKey)}
                  right={<span className="m-chat-time" aria-label={`${d.count} message${d.count === 1 ? '' : 's'}`}>{d.count}</span>} chevron
                  onClick={() => onOpen(() => c.setView({ kind: 'day', dayKey: d.dayKey }))} />
              ))}
              {(c.days?.length ?? 0) > 3 && (
                <Row title={<span className="m-chat-more">{allDays ? 'Show Fewer Days' : `Show All ${c.days!.length} Days`}</span>} onClick={() => setAllDays((v) => !v)} />
              )}
            </ListSection>
          )}
          <div className="m-chat-org" onPointerDown={lp.onPointerDown} onPointerMove={lp.onPointerMove} onPointerUp={lp.onPointerUp} onPointerCancel={lp.onPointerCancel} onClickCapture={lp.onClickCapture}>
          {pinned.length > 0 && (
            <ListSection title="Pinned">
              {pinned.map((s) => <ConversationListRow key={s.id} s={s} onOpen={() => onOpen(() => c.openConversation(s.id))} />)}
            </ListSection>
          )}
          {folders.length > 0 && (
            <ListSection title="Folders">
              {folders.map((f) => (
                <Row key={f.name} rowId={`folder:${f.name}`} title={f.name} leading={<Folder size={20} />}
                  right={<span className="m-chat-time">{f.items.length}</span>} chevron
                  onClick={() => nav.push(FOLDER_KEY(f.name), <ChatFolderEntry name={f.name} />)} />
              ))}
            </ListSection>
          )}
          {c.summariesLoaded && c.summaries.length === 0 && (
            <ListSection title="Conversations">
              <div className="mobile-empty">No conversations yet. Tap the pencil to write a note.</div>
            </ListSection>
          )}
          {groups.map((g) => (
            <ListSection key={g.key} title={g.label}>
              {g.items.map((s) => <ConversationListRow key={s.id} s={s} onOpen={() => onOpen(() => c.openConversation(s.id))} />)}
            </ListSection>
          ))}
          </div>
        </>
      )}
    </Page>
  )
}

function ChatThreadScreen({ c, composerRef, onBack }: { c: ChatController; composerRef: React.MutableRefObject<ChatEditorHandle | null>; onBack: () => void }) {
  const [empty, setEmpty] = useState(true)
  const [formats, setFormats] = useState<ActiveFormats>(NO_FORMATS)
  const [focused, setFocused] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const [hint, setHint] = useState(false)
  const [stickToken, setStickToken] = useState(0)
  // Find in this conversation (… → Find in Conversation): the bar takes the composer's place.
  const [find, setFind] = useState<{ open: boolean; query: string; index: number; count: number; target: string | null }>({ open: false, query: '', index: 0, count: 0, target: null })
  const openFind = (query?: string, target?: string) => setFind((f) => ({ open: true, query: query ?? f.query, index: 0, count: f.count, target: target ?? null }))
  const closeFind = () => setFind((f) => ({ ...f, open: false, index: 0, target: null }))
  const stepFind = (d: 1 | -1) => setFind((f) => (f.count ? { ...f, index: (f.index + d + f.count) % f.count, target: null } : f))
  const onFindMatches = React.useCallback((count: number, index: number) => setFind((f) => (f.count === count && f.index === index ? f : { ...f, count, index })), [])
  useEffect(() => { if (c.findRequest) openFind(c.findRequest.query, c.findRequest.messageId) }, [c.findRequest?.token]) // eslint-disable-line react-hooks/exhaustive-deps
  const nav = useNavigation()
  /** A note being edited in the composer (the draft is put aside meanwhile). */
  const [editing, setEditingState] = useState<{ id: string; chatId: string | null; stash: string } | null>(null)
  const editingRef = useRef(editing)
  const setEditing = (e: typeof editing) => { editingRef.current = e; setEditingState(e) }
  const sheet = useActionSheet()
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (hintTimer.current) clearTimeout(hintTimer.current); if (blurTimer.current) clearTimeout(blurTimer.current) }, [])

  // Durable per-conversation drafts — the same store as the Mac (composer/chatDrafts.ts).
  const drafts = useComposerDraft({
    draftKey: c.view.kind !== 'conversation' ? 'cross' : c.activeChatId ?? 'new',
    editor: composerRef,
    isEditing: () => !!editingRef.current,
    leaveEdit: () => { const e = editingRef.current; if (!e) return null; setEditing(null); return e.stash },
  })
  const [initialDraft] = useState(drafts.initial)

  const startReply = (id: string, chatId: string | null) => {
    if (editingRef.current) endEdit()
    c.startReply(id, chatId)
    void haptic.light()
    requestAnimationFrame(() => composerRef.current?.focus())
  }
  const startReplyRef = useRef(startReply)
  startReplyRef.current = startReply

  const rowActions: ChatRowActions = useMemo(() => ({
    editNote: c.editNote, editAndReask: () => {}, deleteMessage: c.deleteMessage, openConversation: c.openConversation, canAsk: false,
    startReply: (m, chatId) => startReplyRef.current(m.id, chatId),
    jumpTo: c.jumpToMessage,
  }), [c.editNote, c.deleteMessage, c.openConversation, c.jumpToMessage])

  // Touch has no hover: a long press on a message opens its actions as a popup menu next to it
  // (Messages), not a bottom sheet. The pressed message lifts while the menu is open.
  const popover = usePopoverMenu()
  const lp = useLongPress(({ target, clientX, clientY }) => {
    const row = (target as HTMLElement | null)?.closest?.('[data-message-id]') as HTMLElement | null
    const id = row?.dataset.messageId
    const item = id ? c.transcript.find((it) => it.message.id === id) : undefined
    if (!row || !item || item.message.pending) return
    // The OS may have started a text selection under the finger — never leave one behind.
    try { window.getSelection()?.removeAllRanges() } catch { /* */ }
    void haptic.medium()
    const bubble = row.querySelector<HTMLElement>('.group > div:not(.order-first):not(.order-last)') ?? row
    const r = bubble.getBoundingClientRect()
    // A message taller than most of the screen anchors at the finger instead of its own edges.
    const anchor = r.height > window.innerHeight * 0.45
      ? { getBoundingClientRect: () => new DOMRect(clientX, clientY, 1, 1) }
      : bubble
    row.dataset.pressed = 'true'
    const m = item.message
    const canReply = !!item.chatId && (m.kind !== 'ai-reply' || !!(m.content || m.summary || m.results?.length || m.strongsCard))
    popover(anchor, undefined, [
      ...(canReply ? [{ id: 'reply', label: 'Reply', icon: CornerUpLeft, onSelect: () => startReply(m.id, item.chatId) }] : []),
      { id: 'copy', label: 'Copy', icon: Copy, onSelect: () => { void navigator.clipboard?.writeText(m.content || m.summary || '') } },
      ...(m.kind === 'note' && item.chatId ? [{ id: 'edit', label: 'Edit', icon: Pencil, onSelect: () => startEdit(m.id, item.chatId, m.content) }] : []),
      { id: 'delete', label: 'Delete', icon: Trash2, destructive: true, section: true, onSelect: () => c.deleteMessage(m.id, item.chatId) },
    ], { haptic: false, onClose: () => { delete row.dataset.pressed } })
  })
  // Swipe a message to the right to reply (Messages).
  const swipeRef = useSwipeToReply((id) => {
    const item = c.transcript.find((it) => it.message.id === id)
    if (item?.chatId && !item.message.pending) startReply(id, item.chatId)
  })

  const load = (md: string, focus = true) => composerRef.current?.setMarkdown(md, { focus })
  const startEdit = (id: string, chatId: string | null, content: string) => {
    const cur = editingRef.current
    if (!cur) drafts.flush()
    setEditing({ id, chatId, stash: cur ? cur.stash : composerRef.current?.getMarkdown() ?? '' })
    load(content)
  }
  const endEdit = () => {
    const stash = editingRef.current?.stash ?? ''
    setEditing(null)
    load(stash)
  }
  const send = () => {
    const v = composerRef.current?.getMarkdown().trim() ?? ''
    const e = editingRef.current
    if (e) {
      if (v) c.editNote(e.id, v, e.chatId)
      void haptic.light()
      endEdit()
      return
    }
    if (!v) return
    load('', false) // the field keeps focus (Send never takes it), so the keyboard stays up
    drafts.sent()
    setLinkOpen(false)
    setStickToken((t) => t + 1)
    void haptic.light()
    void c.send(v)
  }
  const onChange = (state: EditorState, docChanged: boolean) => {
    const f = activeFormats(state)
    setFormats((prev) => (sameFormats(prev, f) ? prev : f))
    setEmpty(isDocEmpty(state.doc))
    if (docChanged) drafts.changed()
  }
  const onFocusChange = (f: boolean) => {
    if (blurTimer.current) clearTimeout(blurTimer.current)
    if (f) { setFocused(true); setLinkOpen(false) } else blurTimer.current = setTimeout(() => setFocused(false), 150)
  }
  const escape = () => {
    if (linkOpen) { setLinkOpen(false); return true }
    if (editingRef.current) { endEdit(); return true }
    if (c.replyingTo) { c.cancelReply(); return true }
    return false
  }
  const openMore = (items: FormatItem[]) => {
    sheet('chat-format-more', 'Formatting', items.map((item) => ({
      id: item.id, label: item.label, icon: item.icon,
      onSelect: () => { if (composerRef.current) item.run(composerRef.current) },
    })))
  }
  const showHint = () => {
    setHint(true)
    if (hintTimer.current) clearTimeout(hintTimer.current)
    hintTimer.current = setTimeout(() => setHint(false), 2600)
  }

  const title = c.view.kind === 'all' ? 'All Messages' : c.view.kind === 'day' ? formatDayHeading(c.view.dayKey) : c.activeTitle
  const resetKey = c.view.kind === 'conversation' ? `c:${c.activeChatId ?? 'draft'}` : c.view.kind === 'day' ? `d:${c.view.dayKey}` : 'all'
  const cross = c.view.kind !== 'conversation'

  return (
    // Floating chrome (TEST 2026-10-18 "make the top bar feel completely floating"): no bar — the
    // back circle and the title capsule float on their own glass, messages scroll beneath them.
    <Page title={<span className="m-chat-title-pill">{title}</span>} onBack={onBack} backLabel="Messages" noScroll header="floating" className="m-chat-page"
      right={(
        <button type="button" className="m-chat-more-btn" aria-label="Conversation Options" onClick={(e) => {
          popover(e.currentTarget, undefined, [
            { id: 'find', label: 'Find in Conversation', icon: TextSearch, disabled: c.transcript.length === 0, onSelect: () => openFind() },
            { id: 'search', label: 'Search All Messages', icon: Search, onSelect: () => { onBack(); setTimeout(() => document.querySelector<HTMLInputElement>('.m-chat-list .mobile-search-input')?.focus(), 360) } },
          ])
        }}><MoreHorizontal size={20} aria-hidden /></button>
      )}>
      <div className="m-chat-layout" data-finding={find.open || undefined}>
      <ChatRowActionsContext.Provider value={rowActions}>
      <ChatEditingIdContext.Provider value={editing?.id ?? null}>
        <div className="m-chat-body" ref={swipeRef} onPointerDown={lp.onPointerDown} onPointerMove={lp.onPointerMove} onPointerUp={lp.onPointerUp} onPointerCancel={lp.onPointerCancel} onClickCapture={lp.onClickCapture}>
          <ChatTranscript
            items={c.transcript}
            resetKey={resetKey}
            crossConversation={cross}
            hasOlder={c.stream.hasMore}
            loadingOlder={c.stream.loading}
            onLoadOlder={c.loadOlder}
            typing={null}
            failedIds={c.failedIds}
            focusMessageId={c.focusMessageId}
            onFocusHandled={() => c.setFocusMessageId(null)}
            stickToken={stickToken}
            empty={c.loadingChat ? null : <div className="mobile-empty">{cross ? 'No messages here yet.' : 'No messages yet. Write a quick note below.'}</div>}
            find={find.open ? { query: find.query, index: find.index, onMatches: onFindMatches, targetMessageId: find.target } : null}
            onRevealLock={() => { void haptic.light() }}
          />
        </div>
      </ChatEditingIdContext.Provider>
      </ChatRowActionsContext.Provider>
      {find.open ? (
        <div className="m-chat-composer-wrap">
          <PhoneFindBar query={find.query} onQuery={(q) => setFind((f) => ({ ...f, query: q, index: 0, target: null }))} count={find.count} index={find.index}
            onPrev={() => stepFind(-1)} onNext={() => stepFind(1)} onDone={closeFind} />
        </div>
      ) : (
      <div className="m-chat-composer-wrap">
        {editing ? (
          <div className="m-chat-destination m-chat-editing">
            <Pencil size={12} aria-hidden /> <span>Editing Message</span>
            <button type="button" className="m-chat-edit-cancel" onClick={endEdit} onPointerDown={(e) => e.preventDefault()}>Cancel</button>
          </div>
        ) : c.replyingTo ? (
          <ChatReplyBar quoted={c.replyingTo} compact onCancel={() => { c.cancelReply(); composerRef.current?.focus() }} />
        ) : cross && (
          // All Messages / a day: a message belongs to no conversation unless one is picked here.
          <button type="button" className="m-chat-destination m-chat-destination-pick" onPointerDown={(e) => e.preventDefault()}
            aria-label={`Conversation: ${c.crossDestination ? c.activeTitle : UNFILED_CHAT_TITLE}`}
            onClick={() => nav.push(PICKER_KEY, <ChatPickerEntry />)}>
            {c.crossDestination ? <MessageCircle size={12} aria-hidden /> : <Inbox size={12} aria-hidden />}
            <span className={c.crossDestination ? 'is-set' : undefined}>{c.crossDestination ? c.activeTitle : UNFILED_CHAT_TITLE}</span> <ChevronDown size={11} aria-hidden />
          </button>
        )}
        {hint && <div className="m-chat-hint" role="status">{ASK_BEREAN_PHONE_HINT}</div>}
        <div className="m-chat-composer" data-toolbar={focused || linkOpen ? 'true' : 'false'}>
          {(focused || linkOpen) && (
            <div className="m-chat-format">
              <FormatToolbar editor={composerRef} active={formats} variant="phone" linkOpen={linkOpen} onLinkOpenChange={setLinkOpen} onMoreSheet={openMore} />
            </div>
          )}
          <div className="m-chat-composer-row">
            <button type="button" className="m-chat-ask" aria-disabled="true" aria-label={`Ask Berean — ${ASK_BEREAN_PHONE_HINT}`} onClick={showHint}
              onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()}>
              <Sparkles size={18} aria-hidden />
            </button>
            {/* Return is a new line (Messages); the Send button sends. */}
            <ChatEditor
              ref={composerRef}
              className="m-chat-input"
              initialMarkdown={initialDraft}
              returnSends={false}
              enterKeyHint="enter"
              placeholder={editing ? 'Edit Message' : 'Message'}
              ariaLabel={editing ? 'Edit message' : 'Message'}
              onSubmit={() => send()}
              onEscape={escape}
              onOpenLink={() => setLinkOpen(true)}
              onChange={onChange}
              onFocusChange={onFocusChange}
            />
            {/* Keeps the keyboard up (Messages): a press that blurred the field first re-laid out the
                composer under the finger, and the real tap missed Send (simulator, 2026-10-17). */}
            <button type="button" className="m-chat-send" aria-label={editing ? 'Save Edit' : 'Send'} disabled={!editing && empty} onClick={send}
              onPointerDown={(e) => e.preventDefault()} onMouseDown={(e) => e.preventDefault()}>
              {editing ? <Check size={18} strokeWidth={2.5} aria-hidden /> : <ArrowUp size={18} strokeWidth={2.5} aria-hidden />}
            </button>
          </div>
        </div>
      </div>
      )}
      </div>
    </Page>
  )
}

const PICKER_KEY = 'chat-picker'

/** All Messages / a day: choose which conversation new messages go to — a full page (iPhone),
 *  never a squeezed popover: search, New Conversation, Unfiled, recent conversations. */
function ChatPickerEntry() {
  const { c, composerRef } = useChatLive()
  const nav = useNavigation()
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(60)
  const results = useMemo(() => filterConversations(c.summaries, query), [c.summaries, query])
  const done = () => { nav.pop(); requestAnimationFrame(() => composerRef.current?.focus()) }
  const current = c.crossDestination
  const search = (
    <div className="mobile-search-field m-chat-search">
      <Search size={17} aria-hidden />
      <input className="mobile-search-input" type="search" inputMode="text" autoCorrect="off" enterKeyHint="search" autoComplete="off"
        placeholder="Search Conversations" aria-label="Search conversations" value={query} onChange={(e) => setQuery(e.target.value)} />
      {query && <button type="button" className="m-chat-search-clear" aria-label="Clear search" onClick={() => setQuery('')}><X size={16} /></button>}
    </div>
  )
  return (
    <Page title="Send To" onBack={nav.pop} backLabel="Back" headerBelow={search} className="m-chat-list">
      <ListSection>
        <Row title={<span className="m-chat-more">New Conversation</span>} leading={<SquarePen size={20} />} onClick={() => {
          // The unsent text moves along into the new conversation.
          const carry = composerRef.current?.getMarkdown() ?? ''
          if (carry) composerRef.current?.setMarkdown('', { focus: false })
          c.newConversation()
          nav.pop()
          requestAnimationFrame(() => { if (carry) composerRef.current?.setMarkdown(carry, { focus: true }); else composerRef.current?.focus() })
        }} />
        <Row title={UNFILED_CHAT_TITLE} subtitle="Messages that aren’t in a conversation" leading={<Inbox size={20} />}
          selected={!current}
          onClick={() => { c.setCrossDestination(null); done() }} />
      </ListSection>
      <ListSection title={query.trim() ? `${results.length} Conversation${results.length === 1 ? '' : 's'}` : 'Recent Conversations'}>
        {results.length === 0 && <div className="mobile-empty">{c.summaries.length ? `No conversations match “${query.trim()}”.` : 'No conversations yet.'}</div>}
        {results.slice(0, shown).map((s) => (
          <Row key={s.id} title={s.title} subtitle={s.preview || undefined} leading={s.pinnedAt ? <Pin size={18} /> : <MessageCircle size={20} />}
            selected={current === s.id}
            right={<span className="m-chat-time">{formatListTime(s.lastMessageAt ?? s.updated_at)}</span>}
            onClick={() => { c.setCrossDestination(s.id); done() }} />
        ))}
        {results.length > shown && <Row title={<span className="m-chat-more">Show More</span>} onClick={() => setShown((n) => n + 60)} />}
      </ListSection>
    </Page>
  )
}

/** iPhone global search results: a filter, conversations, then messages. */
function PhoneSearchResults({ c, q, onOpen }: { c: ChatController; q: string; onOpen: (fn: () => void) => void }) {
  const [filter, setFilter] = useState<SearchFilter>('all')
  const convs = useMemo(() => filterConversations(c.summaries, q), [c.summaries, q])
  const msgs = c.searchResults
  const showC = filter !== 'messages'
  const showM = filter !== 'conversations'
  const none = msgs !== null && (showC ? convs.length : 0) + (showM ? msgs.length : 0) === 0
  return (
    <>
      <div className="m-chat-filters" role="radiogroup" aria-label="Show">
        {(['all', 'conversations', 'messages'] as const).map((f) => (
          <button key={f} type="button" role="radio" aria-checked={filter === f} className={filter === f ? 'is-on' : undefined} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : f === 'conversations' ? 'Conversations' : 'Messages'}
          </button>
        ))}
      </div>
      {none && <div className="mobile-empty">Nothing matches “{q}”.</div>}
      {showC && convs.length > 0 && (
        <ListSection title="Conversations">
          {convs.slice(0, filter === 'all' ? 5 : 100).map((s) => (
            <Row key={s.id} title={highlightAll(s.title, q, 1000)} subtitle={s.preview ? highlightAll(s.preview, q) : undefined} leading={<MessageCircle size={20} />}
              right={<span className="m-chat-time">{formatListTime(s.lastMessageAt ?? s.updated_at)}</span>}
              onClick={() => onOpen(() => c.openSearchResult(s.id, undefined, q))} />
          ))}
          {filter === 'all' && convs.length > 5 && <Row title={<span className="m-chat-more">Show All {convs.length} Conversations</span>} onClick={() => setFilter('conversations')} />}
        </ListSection>
      )}
      {showM && (
        <ListSection title={msgs ? `${msgs.length === 200 ? '200+' : msgs.length} Message${msgs.length === 1 ? '' : 's'}` : 'Searching…'}>
          {(msgs ?? []).map((it) => (
            <Row key={it.key} title={it.chatTitle}
              subtitle={<>{it.message.role === 'assistant' ? 'Berean: ' : ''}{highlightAll(messagePreviewText(it.message), q)}</>}
              right={<span className="m-chat-time">{formatListTime(it.message.createdAt)}</span>}
              onClick={() => { const id = it.chatId; if (id) onOpen(() => c.openSearchResult(id, it.message.id, q)) }} />
          ))}
        </ListSection>
      )}
    </>
  )
}
