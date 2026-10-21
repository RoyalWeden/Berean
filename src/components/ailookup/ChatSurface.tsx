import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { MessageCircle, CornerUpLeft, Copy, Pencil, Sparkles, Trash2, Inbox } from 'lucide-react'
import { EmptyState, AlertSheet, MenuItem, MenuSeparator, useContextMenu } from '@/components/ui'
import { useAppStore } from '@/store'
import { VerseCopyMenu, useVerseCopyMenu } from '@/components/bible/VerseCopyMenu'
import { ChatTranscript, type TranscriptFind } from './ChatTranscript'
import FindBar from '@/components/shell/FindBar'
import { ChatComposer, type ChatComposerHandle, type ChatEditTarget } from './ChatComposer'
import { ChatRowActionsContext, ChatEditingIdContext, ChatMenuOpenIdContext, type ChatRowActions } from './ChatMessageRow'
import { VerseMenuContext } from './AiReplyBody'
import { ChatNavContext, type ChatNavigate } from './chatNav'
import { formatDayHeading, type ChatMsg } from './chatModel'
import type { ChatController, ChatSendOptions } from './useChatController'
import { ConversationRow, SearchResults } from './ChatHistoryList'
import { ChatConversationPicker, type ChatDestination } from './ChatComposerControls'
import { UNFILED_CHAT_ID } from './chatModel'
import './chatTokens.css'
import './chatLayout.css'
import './chat.css'

export { SearchResults }

/** What hosts can do with a chat surface: the composer, plus Find in this conversation. */
export interface ChatSurfaceHandle extends ChatComposerHandle {
  /** ⌘F: open (or re-select) the find bar over this view. `query` / `messageId` pre-fill it and
   *  land on that message's match (a global-search result). Returns false when there is nothing
   *  to search (an empty new conversation) — the host then offers global search instead. */
  openFind: (query?: string, messageId?: string) => boolean
  closeFind: () => boolean
}

/**
 * Transcript + composer (or search results) for one chat surface, with the contexts its rows
 * need. The embedded panel and the standalone window wrap this in their own chrome (header,
 * sidebar placement); the iPhone page has its own layout but the same controller and rows.
 */
export const ChatSurface = forwardRef<ChatSurfaceHandle, {
  c: ChatController
  navigate: ChatNavigate
  floatingComposer?: boolean
  aiUnavailableReason?: string
  /** Search results render in the (slide-over) sidebar instead of replacing the transcript. */
  searchInSidebar?: boolean
  /** Reveal the conversation list (empty state's "All Conversations"). */
  onShowConversations?: () => void
}>(function ChatSurface({ c, navigate, floatingComposer, aiUnavailableReason, searchInSidebar, onShowConversations }, composerRef) {
  const verseCopy = useVerseCopyMenu()
  const [stickToken, setStickToken] = useState(0)
  const [editingId, setEditingId] = useState<string | null>(null)
  const inner = useRef<ChatComposerHandle | null>(null)
  const msgMenu = useContextMenu<{ m: ChatMsg; chatId: string | null; more?: boolean }>()
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; chatId: string | null } | null>(null)
  // ── Find in this conversation ──
  const [find, setFind] = useState<{ open: boolean; query: string; index: number; count: number; target: string | null; token: number }>({ open: false, query: '', index: 0, count: 0, target: null, token: 0 })
  const findStateRef = useRef(find)
  findStateRef.current = find
  const transcriptLen = c.transcript.length
  const transcriptLenRef = useRef(transcriptLen)
  transcriptLenRef.current = transcriptLen
  const openFind = useCallback((query?: string, messageId?: string) => {
    if (!transcriptLenRef.current && !messageId) return false
    setFind((f) => ({ open: true, query: query ?? f.query, index: 0, count: f.count, target: messageId ?? null, token: f.token + 1 }))
    // A new token remounts the bar: ⌘F while it is open focuses it and selects its text again.
    return true
  }, [])
  const closeFind = useCallback(() => {
    if (!findStateRef.current.open) return false
    setFind((f) => ({ ...f, open: false, index: 0, target: null }))
    requestAnimationFrame(() => inner.current?.focus()) // focus goes back to the composer
    return true
  }, [])
  const onFindMatches = useCallback((count: number, index: number) => {
    setFind((f) => (f.count === count && f.index === index ? f : { ...f, count, index }))
  }, [])
  // A different conversation / view: same query, from its first match.
  useEffect(() => { setFind((f) => (f.open ? { ...f, index: 0, target: null } : f)) }, [c.activeChatId, c.view.kind]) // eslint-disable-line react-hooks/exhaustive-deps
  const step = (d: 1 | -1) => setFind((f) => (f.count ? { ...f, index: (f.index + d + f.count) % f.count, target: null } : f))
  // A global-search result opened here: find its query, landing on that message.
  useEffect(() => { if (c.findRequest) openFind(c.findRequest.query, c.findRequest.messageId) }, [c.findRequest?.token]) // eslint-disable-line react-hooks/exhaustive-deps
  const transcriptFind: TranscriptFind | null = find.open ? { query: find.query, index: find.index, onMatches: onFindMatches, targetMessageId: find.target } : null

  useImperativeHandle(composerRef, () => ({
    focus: () => inner.current?.focus(),
    beginEdit: (t) => inner.current?.beginEdit(t),
    askAbout: (text) => inner.current?.askAbout(text),
    getDraft: () => inner.current?.getDraft() ?? '',
    setDraft: (text) => inner.current?.setDraft(text),
    openFind,
    closeFind,
  }), [openFind, closeFind])

  const editAndReask = (id: string, text: string) => {
    const st = useAppStore.getState()
    const rules = st.wordReplacerEnabled ? st.wordReplacerRules.filter((r) => r.enabled && !r.strongsNum).map((r) => ({ queries: r.queries, replacement: r.replacement })) : []
    void c.editAndReask(id, text, { wordReplacerRules: rules })
  }
  const cRef = useRef(c)
  cRef.current = c
  const editAndReaskRef = useRef(editAndReask)
  editAndReaskRef.current = editAndReask

  const rowActions: ChatRowActions = useMemo(() => ({
    editNote: c.editNote,
    editAndReask: (id, text) => editAndReaskRef.current(id, text),
    deleteMessage: c.deleteMessage,
    openConversation: c.openConversation,
    canAsk: c.ai.available,
    startEdit: (m, chatId) => {
      // Asking again replaces the rest of THAT conversation — show it first.
      const cur = cRef.current
      if (m.kind === 'ai-request' && chatId && (cur.view.kind !== 'conversation' || cur.activeChatId !== chatId)) cur.openConversation(chatId, m.id)
      inner.current?.beginEdit({ id: m.id, chatId, text: m.content, isRequest: m.kind === 'ai-request' })
    },
    askAbout: (m) => inner.current?.askAbout(m.content),
    startReply: (m, chatId) => { cRef.current.startReply(m.id, chatId); requestAnimationFrame(() => inner.current?.focus()) },
    jumpTo: (id) => cRef.current.jumpToMessage(id),
    openMenu: (m, chatId, at, o) => msgMenu.openAt(at, { m, chatId, more: o?.more }),
  }), [c.editNote, c.deleteMessage, c.openConversation, c.ai.available]) // eslint-disable-line react-hooks/exhaustive-deps

  const onEditSubmit = (t: ChatEditTarget, text: string) => {
    if (t.isRequest) editAndReaskRef.current(t.id, text)
    else c.editNote(t.id, text, t.chatId)
  }

  const onSend = async (text: string, opts: ChatSendOptions) => {
    setStickToken((t) => t + 1)
    return c.send(text, opts)
  }

  const crossConversation = c.view.kind !== 'conversation'
  const resetKey = c.view.kind === 'conversation' ? `c:${c.activeChatId ?? 'draft'}` : c.view.kind === 'day' ? `d:${c.view.dayKey}` : 'all'
  const typing = c.aiBusy ? (c.progress || 'Thinking…') : null

  const recent = c.summaries.slice(0, 5)
  const empty = c.loadingChat || c.stream.loading ? null : c.view.kind === 'conversation' && !c.activeChatId && recent.length > 0 ? (
    // A new, empty conversation: put the history right here so it is never hidden.
    <div className="w-full max-w-[360px] px-[var(--chat-gutter)] py-[var(--chat-space-4)]">
      <div className="text-center text-subhead font-semibold text-text-primary">New Conversation</div>
      <p className="text-center text-caption text-text-muted pt-[var(--chat-space-1)] pb-[var(--chat-space-4)]">Type below to start one, or pick up where you left off.</p>
      <div className="chat-hist-heading">Recent Conversations</div>
      <div role="list" className="flex flex-col gap-[var(--chat-row-gap)]">
        {recent.map((s) => <ConversationRow key={s.id} s={s} selected={false} onOpen={() => c.openConversation(s.id)} />)}
      </div>
      {onShowConversations && c.summaries.length > recent.length && (
        <div className="pt-[var(--chat-space-2)] px-[var(--chat-row-px)]">
          <button type="button" className="text-caption text-accent hover:underline focus-ring rounded-chip" onClick={onShowConversations}>
            Show All {c.summaries.length} Conversations
          </button>
        </div>
      )}
    </div>
  ) : c.view.kind === 'conversation' && c.activeChatId === UNFILED_CHAT_ID ? (
    <EmptyState icon={Inbox} title="No Unfiled Messages" hint="Messages you send from All Messages without choosing a conversation are kept here." />
  ) : c.view.kind === 'conversation' ? (
    <EmptyState
      icon={MessageCircle}
      title="No Messages Yet"
      hint={c.ai.available
        ? 'Jot a quick note, or tap the sparkle to Ask Berean about Scripture. Plain messages are never sent on their own — when you ask Berean something, it reads this conversation for context.'
        : 'Jot a quick note — it’s saved to this conversation and synced with your other devices.'}
    />
  ) : c.view.kind === 'day' ? (
    <EmptyState icon={MessageCircle} title={`Nothing on ${formatDayHeading(c.view.dayKey)}`} />
  ) : (
    <EmptyState icon={MessageCircle} title="No Messages" hint="Everything you send appears here as one long conversation." />
  )

  // What This Tab would send — re-read on open, on window focus and whenever Ask Berean is armed.
  const [tabLabel, setTabLabel] = useState<string | null | undefined>(undefined)
  const readTab = c.readTabContext
  const refreshTab = useCallback(() => { void readTab().then((r) => setTabLabel(r?.label ?? (r ? 'This Tab' : null))).catch(() => setTabLabel(null)) }, [readTab])
  useEffect(() => {
    refreshTab()
    window.addEventListener('focus', refreshTab)
    return () => window.removeEventListener('focus', refreshTab)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // The composer's conversation selector: the open conversation, a new one, or (All Messages /
  // a day) Unfiled unless one is picked.
  const dest: ChatDestination = crossConversation
    ? (c.crossDestination
      ? { kind: 'conversation', chatId: c.crossDestination, title: c.summaries.find((s) => s.id === c.crossDestination)?.title ?? c.activeTitle }
      : { kind: 'unfiled', chatId: UNFILED_CHAT_ID, title: '' })
    : c.activeChatId === UNFILED_CHAT_ID
      ? { kind: 'unfiled', chatId: UNFILED_CHAT_ID, title: '' }
      : { kind: 'conversation', chatId: c.activeChatId, title: c.activeTitle }
  const startNew = () => {
    // From All Messages the unsent text moves along into the new conversation.
    const carry = crossConversation ? inner.current?.getDraft() ?? '' : ''
    if (carry) inner.current?.setDraft('')
    c.newConversation()
    if (carry) requestAnimationFrame(() => inner.current?.setDraft(carry))
    requestAnimationFrame(() => inner.current?.focus())
  }
  const destination = (
    <ChatConversationPicker
      destination={dest}
      summaries={c.summaries}
      allowUnfiled
      onPick={(id) => { if (crossConversation) c.setCrossDestination(id); else c.openConversation(id); requestAnimationFrame(() => inner.current?.focus()) }}
      onPickUnfiled={() => { if (crossConversation) c.setCrossDestination(null); else c.openConversation(UNFILED_CHAT_ID); requestAnimationFrame(() => inner.current?.focus()) }}
      onNew={startNew}
    />
  )
  const searchView = !!c.search.trim() && !searchInSidebar

  return (
    <ChatNavContext.Provider value={navigate}>
      <ChatRowActionsContext.Provider value={rowActions}>
        <ChatEditingIdContext.Provider value={editingId}>
        <ChatMenuOpenIdContext.Provider value={msgMenu.state?.payload.m.id ?? null}>
        <VerseMenuContext.Provider value={verseCopy.open}>
          <div className="flex-1 min-h-0 flex flex-col relative">
            {searchView ? (
              <div className="chat-column flex-1 min-h-0 flex flex-col pt-[var(--chat-space-2)]"><SearchResults c={c} /></div>
            ) : (
              <ChatTranscript
                items={c.transcript}
                resetKey={resetKey}
                crossConversation={crossConversation}
                hasOlder={c.stream.hasMore}
                loadingOlder={c.stream.loading}
                onLoadOlder={c.loadOlder}
                typing={typing}
                failedIds={c.failedIds}
                focusMessageId={c.focusMessageId}
                onFocusHandled={() => c.setFocusMessageId(null)}
                stickToken={stickToken}
                empty={empty}
                find={transcriptFind}
              />
            )}
            {!searchView && (
              <FindBar
                key={find.token}
                visible={find.open}
                query={find.query}
                onQueryChange={(q) => setFind((f) => ({ ...f, query: q, index: 0, target: null }))}
                onClose={closeFind}
                matchCount={find.count}
                currentMatch={find.index}
                onPrev={() => step(-1)}
                onNext={() => step(1)}
                placeholder="Find in Conversation"
                selectAllEvent="berean:chatFindSelectAll"
              />
            )}
            {/* Searching is not composing: no composer under search results. */}
            <div className="chat-column flex-shrink-0" hidden={searchView}>
            <ChatComposer
              ref={inner}
              onEditSubmit={onEditSubmit}
              draftKey={crossConversation ? 'cross' : c.activeChatId ?? 'new'}
              onEditingChange={setEditingId}
              onSend={onSend}
              aiAvailable={c.ai.available}
              aiUnavailableReason={aiUnavailableReason ?? (c.ai.checked ? 'Ask Berean needs Ollama running on this Mac (ollama.com)' : 'Checking for Ask Berean…')}
              aiBusy={c.aiBusy}
              destination={destination}
              destinationAlwaysVisible={crossConversation}
              tabContextLabel={tabLabel}
              onRefreshTabContext={refreshTab}
              floating={floatingComposer}
              replyingTo={c.replyingTo}
              onCancelReply={c.cancelReply}
            />
            </div>
          </div>
          <VerseCopyMenu target={verseCopy.target} onClose={verseCopy.close} />
          {/* Right-click on a message: every action it has, Messages-style. */}
          <msgMenu.Menu label="Message actions" className="!min-w-[140px]">
            {({ m, chatId, more }) => {
              const editable = !!chatId && (m.kind === 'note' || (m.kind === 'ai-request' && c.ai.available))
              const askable = m.kind === 'note' && c.ai.available
              return (
                <>
                  {/* "…" beside the message leaves out Reply / Copy — they are buttons right there. */}
                  {!more && chatId && <MenuItem icon={CornerUpLeft} label="Reply" onClick={() => rowActions.startReply!(m, chatId)} />}
                  {!more && <MenuItem icon={Copy} label="Copy" onClick={() => { void navigator.clipboard.writeText(m.content || m.summary || '').catch(() => {}) }} />}
                  {askable && <MenuItem icon={Sparkles} label="Ask Berean" onClick={() => rowActions.askAbout!(m)} />}
                  {editable && <MenuItem icon={Pencil} label={m.kind === 'ai-request' ? 'Edit and Ask Again' : 'Edit'} onClick={() => rowActions.startEdit!(m, chatId)} />}
                  {(!more || askable || editable) && <MenuSeparator />}
                  <MenuItem icon={Trash2} label="Delete" danger onClick={() => setConfirmDelete({ id: m.id, chatId })} />
                </>
              )
            }}
          </msgMenu.Menu>
          <AlertSheet
            open={!!confirmDelete}
            onOpenChange={(o) => { if (!o) setConfirmDelete(null) }}
            icon={Trash2}
            title="Delete this message?"
            message="It is removed from this conversation on all your devices."
            confirmLabel="Delete"
            destructive
            defaultIsCancel
            onConfirm={() => { if (confirmDelete) c.deleteMessage(confirmDelete.id, confirmDelete.chatId); setConfirmDelete(null) }}
          />
        </VerseMenuContext.Provider>
        </ChatMenuOpenIdContext.Provider>
        </ChatEditingIdContext.Provider>
      </ChatRowActionsContext.Provider>
    </ChatNavContext.Provider>
  )
})
