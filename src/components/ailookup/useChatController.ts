import { readDraft } from './composer/chatDrafts'
import { readReplyTarget, writeReplyTarget, onReplyTargetsChanged } from './composer/chatReplies'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AiLookupChat, AiLookupChatDaySummary, AiLookupChatSummary, AiLookupResponse, AiLookupTabContextRef, AiLookupChatAiMode } from '@/types/electron'
import {
  type ChatMsg, type TranscriptItem, UNFILED_CHAT_ID, UNFILED_CHAT_TITLE, cleanFolder, newMessageId, normalizeForUi, aiHistoryFor, mergeServerMessages,
  mergeStreamItems, mentionsCurrentTab, deriveChatTitle, pickNewMessageTarget,
} from './chatModel'

/**
 * Berean Chat controller — one instance per chat surface (embedded panel, chat window, iPhone
 * page). Owns which conversation is active, what the transcript shows (one conversation, every
 * message as one long stream, or a single day), search, and every write.
 *
 * Invariants it exists to keep:
 *  - A plain message is saved straight to the conversation; nothing reaches the AI unless the
 *    caller sends with `ai` set (and the AI history only ever contains AI turns — aiHistoryFor).
 *  - Writes are serialized (`queue`) and resolve the target conversation at run time, so two
 *    quick sends into a brand-new conversation create ONE conversation, not two.
 *  - Every write merges by message id in the service, and every reload merges the stored copy
 *    with this window's unsaved messages (mergeServerMessages) — no drops, no duplicates, across
 *    windows too.
 *  - Async results are applied only if their conversation is still the one on screen
 *    (`isActive`), so switching conversations never mixes state; the in-flight AI reply still
 *    lands in the conversation that asked.
 *  - One AI request at a time per surface (`aiBusy`): no duplicate submissions.
 */

export type ChatView = { kind: 'conversation' } | { kind: 'all' } | { kind: 'day'; dayKey: string }

export interface ChatSendOptions {
  ai?: { commentary: boolean; deepSearch: boolean; tabContext: boolean }
  /** Reply to this message (defaults to the conversation's current reply target; null = none). */
  inReplyTo?: string | null
  wordReplacerRules?: Array<{ queries: string[]; replacement: string }>
}

interface Target { chatId: string | null; draftKey: string }

const STREAM_PAGE = 80

function messageFieldsFrom(res: AiLookupResponse): Partial<ChatMsg> {
  return {
    results: res.results, visibleCount: res.visibleCount, keywords: res.keywords, related: res.related,
    relatedNote: res.relatedNote, summary: res.summary, strongsCard: res.strongsCard, notes: res.notes,
    notesAreThePrimaryAnswer: res.notesAreThePrimaryAnswer, videos: res.videos,
  }
}

const newDraftKey = () => `d-${Math.random().toString(36).slice(2, 10)}`

export function useChatController(opts: {
  initialChatId?: string | null
  onActiveChatIdChange?: (id: string | null) => void
  /** The active-tab pointer for "This Tab" (embedded: this window's store; chat window: asks main). */
  getTabContext?: () => Promise<AiLookupTabContextRef | undefined>
  /** false on iPhone (the local model runs on the Mac) — plain messaging still works. */
  aiSupported: boolean
  /** Start in "new message" mode: today's conversation if used today, else a fresh draft. */
  startWithNewMessage?: boolean
  /** With no initial conversation, open the most recently updated one (Messages-style resume)
   *  instead of an empty draft — so history is on screen the moment the chat opens. */
  resumeLatest?: boolean
}) {
  const api = window.aiLookup
  const optsRef = useRef(opts)
  optsRef.current = opts

  const [summaries, setSummaries] = useState<AiLookupChatSummary[]>([])
  const [summariesLoaded, setSummariesLoaded] = useState(false)
  const [activeChatId, setActiveChatIdState] = useState<string | null>(opts.initialChatId ?? null)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [loadingChat, setLoadingChat] = useState(false)
  const [view, setViewState] = useState<ChatView>({ kind: 'conversation' })
  const [stream, setStream] = useState<{ items: TranscriptItem[]; hasMore: boolean; cursor: string | null; loading: boolean }>({ items: [], hasMore: false, cursor: null, loading: false })
  const [days, setDays] = useState<AiLookupChatDaySummary[] | null>(null)
  const [search, setSearchState] = useState('')
  const [searchResults, setSearchResults] = useState<TranscriptItem[] | null>(null)
  const [ai, setAi] = useState<{ checked: boolean; available: boolean }>({ checked: !opts.aiSupported, available: false })
  const [aiBusy, setAiBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(new Set())
  /** A message to scroll to and flash (search result / jump from the stream). */
  const [focusMessageId, setFocusMessageId] = useState<string | null>(null)
  /** The message the composer replies to in the open conversation (chatReplies.ts keeps it per
   *  conversation, device-local, like the draft). */
  const [replyToId, setReplyToIdState] = useState<string | null>(() => (opts.initialChatId ? readReplyTarget(opts.initialChatId) : null))
  const replyToRef = useRef(replyToId)

  const activeRef = useRef<Target>({ chatId: opts.initialChatId ?? null, draftKey: newDraftKey() })
  const messagesRef = useRef<ChatMsg[]>([])
  messagesRef.current = messages
  const viewRef = useRef<ChatView>(view)
  viewRef.current = view
  const summariesRef = useRef(summaries)
  summariesRef.current = summaries
  const streamRef = useRef(stream)
  streamRef.current = stream
  const daysLoadedRef = useRef(false)
  const queueRef = useRef<Promise<unknown>>(Promise.resolve())
  const draftIdsRef = useRef(new Map<string, string>())
  const unsavedRef = useRef(new Set<string>())
  const loadSeqRef = useRef(0)
  const streamSeqRef = useRef(0)
  const aiBusyRef = useRef(false)
  const partialSeqRef = useRef(0)
  const inflightRef = useRef<{ target: Target; replyId: string; seq: number; placeholder: ChatMsg } | null>(null)
  const mountedRef = useRef(true)
  /** An explicit open/new before the initial load finished wins over resumeLatest. */
  const navigatedRef = useRef(false)
  // Set true on (re)mount too: StrictMode (dev) mounts → unmounts → remounts, and a ref that only
  // ever went false left every list/load result discarded — an empty sidebar and "0 messages".
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])

  const resolveTarget = (t: Target): string | null => t.chatId ?? draftIdsRef.current.get(t.draftKey) ?? null
  const isActive = (t: Target): boolean => {
    const a = activeRef.current
    return a.draftKey === t.draftKey || (!!a.chatId && a.chatId === resolveTarget(t))
  }

  const setActive = useCallback((t: Target) => {
    activeRef.current = t
    setActiveChatIdState(t.chatId)
    // The no-conversation row is never remembered as the last conversation.
    if (t.chatId === UNFILED_CHAT_ID) { replyToRef.current = readReplyTarget(t.chatId); setReplyToIdState(replyToRef.current); return }
    const r = t.chatId ? readReplyTarget(t.chatId) : null
    replyToRef.current = r
    setReplyToIdState(r)
    optsRef.current.onActiveChatIdChange?.(t.chatId)
  }, [])

  // ── Loading ──────────────────────────────────────────────────────────────────────────────
  const refreshSummaries = useCallback(async (): Promise<AiLookupChatSummary[]> => {
    try {
      const list = await api.listChats()
      if (!mountedRef.current) return list
      summariesRef.current = list
      setSummaries(list)
      setSummariesLoaded(true)
      // The active conversation was deleted elsewhere → fall back to a fresh draft.
      const a = activeRef.current
      if (a.chatId && a.chatId !== UNFILED_CHAT_ID && !list.some((c) => c.id === a.chatId) && !unsavedRef.current.size) {
        setActive({ chatId: null, draftKey: newDraftKey() })
        setMessages([])
      }
      return list
    } catch { return summariesRef.current /* keep the last list */ }
  }, [api, setActive])

  const withInflight = useCallback((list: ChatMsg[], chatId: string | null): ChatMsg[] => {
    const f = inflightRef.current
    if (!f || resolveTarget(f.target) !== chatId || list.some((m) => m.id === f.replyId)) return list
    return [...list, f.placeholder]
  }, [])

  const loadChat = useCallback(async (chatId: string, opts2: { replace: boolean }) => {
    const seq = ++loadSeqRef.current
    if (opts2.replace) setLoadingChat(true)
    try {
      const chat: AiLookupChat | null = await api.getChat(chatId)
      if (!mountedRef.current || seq !== loadSeqRef.current || activeRef.current.chatId !== chatId) return
      if (!chat) { setMessages((prev) => (opts2.replace ? [] : prev)); return }
      const server = normalizeForUi(chat.messages, chat)
      setMessages((prev) => withInflight(mergeServerMessages(server, opts2.replace ? [] : prev, unsavedRef.current), chatId))
    } catch { /* leave what is shown */ } finally {
      if (seq === loadSeqRef.current) setLoadingChat(false)
    }
  }, [api, withInflight])

  const refreshStream = useCallback(async (mode: 'reset' | 'older' | 'refresh') => {
    const v = viewRef.current
    if (v.kind === 'conversation') return
    const seq = ++streamSeqRef.current
    setStream((s) => ({ ...s, loading: true, ...(mode === 'reset' ? { items: [], hasMore: false, cursor: null } : {}) }))
    try {
      const prev = mode === 'reset' ? null : streamRef.current
      const limit = mode === 'refresh' ? Math.min(500, Math.max(STREAM_PAGE, prev?.items.length ?? 0)) : STREAM_PAGE
      const page = await api.queryMessages({
        dayKey: v.kind === 'day' ? v.dayKey : undefined,
        before: mode === 'older' ? prev?.cursor ?? undefined : undefined,
        limit,
      })
      if (!mountedRef.current || seq !== streamSeqRef.current) return
      const items: TranscriptItem[] = page.items.map((it) => ({ key: it.key, chatId: it.chatId, chatTitle: it.chatTitle, message: it.message as ChatMsg }))
      setStream((s) => mode === 'older'
        ? { items: [...items, ...s.items], hasMore: page.hasMore, cursor: page.cursor, loading: false }
        : { items, hasMore: page.hasMore, cursor: page.cursor, loading: false })
    } catch {
      if (seq === streamSeqRef.current) setStream((s) => ({ ...s, loading: false }))
    }
  }, [api])

  const refreshDays = useCallback(async () => {
    daysLoadedRef.current = true
    try { const d = await api.listDays(); if (mountedRef.current) setDays(d) } catch { /* keep */ }
  }, [api])

  // Initial load.
  useEffect(() => {
    void (async () => {
      const list = await refreshSummaries()
      const startNew = optsRef.current.startWithNewMessage
      if (startNew) {
        const target = pickNewMessageTarget(list)
        setActive({ chatId: target, draftKey: newDraftKey() })
        if (target) await loadChat(target, { replace: true })
        return
      }
      let id = activeRef.current.chatId
      if (id && !list.some((c) => c.id === id)) id = null // deleted since (or never synced here)
      if (!id && navigatedRef.current) return
      // An unsent draft in a new conversation means the user explicitly started one: reopen there,
      // never in an older conversation it would then be sent to.
      const newDraftPending = !id && !!readDraft('new').trim()
      if (!id && !newDraftPending && optsRef.current.resumeLatest && list[0] && !messagesRef.current.length) {
        // The conversation with the newest MESSAGE (a rename also bumps updated_at).
        const last = (s: AiLookupChatSummary) => s.lastMessageAt ?? s.updated_at
        id = list.reduce((best, s) => (last(s) > last(best) ? s : best), list[0]).id
        setActive({ chatId: id, draftKey: newDraftKey() })
      }
      if (id) await loadChat(id, { replace: true })
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // AI availability (desktop only).
  useEffect(() => {
    if (!opts.aiSupported) return
    api.checkAvailable().then((r) => setAi({ checked: true, available: r.available })).catch(() => setAi({ checked: true, available: false }))
  }, [api, opts.aiSupported])

  // Live AI progress / partial results for THIS surface's request (the main process sends them
  // to the requesting window only). Registered once.
  useEffect(() => {
    if (!opts.aiSupported) return
    api.onProgress?.((status) => setProgress(status))
    api.onPartial?.((partial) => {
      const f = inflightRef.current
      if (!f || f.seq !== partialSeqRef.current) return
      f.placeholder = { ...f.placeholder, ...messageFieldsFrom(partial), pending: true }
      if (!isActive(f.target)) return
      setMessages((prev) => prev.map((m) => (m.id === f.replyId && m.pending ? f.placeholder : m)))
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Changes made elsewhere: another window (ailookup:chatsChanged), or iCloud (sync:applied).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let touched = new Set<string>()
    let all = false
    const flush = () => {
      timer = null
      const ids = touched; const everything = all
      touched = new Set(); all = false
      void refreshSummaries()
      const a = activeRef.current
      if (a.chatId && (everything || ids.has(a.chatId))) void loadChat(a.chatId, { replace: false })
      if (viewRef.current.kind !== 'conversation') void refreshStream('refresh')
      if (daysLoadedRef.current) void refreshDays()
    }
    const schedule = (id?: string) => {
      if (id) touched.add(id); else all = true
      if (!timer) timer = setTimeout(flush, 120)
    }
    const offs: Array<(() => void) | undefined> = []
    offs.push(api.onChatsChanged?.((c) => schedule(c.id)))
    offs.push(window.sync?.onApplied?.((entities) => { if (entities.includes('ai_chat')) schedule() }))
    return () => { offs.forEach((off) => off?.()); if (timer) clearTimeout(timer) }
  }, [api, loadChat, refreshDays, refreshStream, refreshSummaries])

  // ── Writes ───────────────────────────────────────────────────────────────────────────────
  const enqueue = useCallback((target: Target, write: (chatId: string | null) => Promise<AiLookupChat>, ids: string[]) => {
    const run = async () => {
      try {
        const detail = await write(resolveTarget(target))
        if (!target.chatId) draftIdsRef.current.set(target.draftKey, detail.id)
        ids.forEach((id) => unsavedRef.current.delete(id))
        if (!mountedRef.current) return
        if (ids.length) setFailedIds((s) => (ids.some((id) => s.has(id)) ? new Set([...s].filter((id) => !ids.includes(id))) : s))
        if (isActive(target)) {
          if (activeRef.current.chatId !== detail.id) setActive({ chatId: detail.id, draftKey: activeRef.current.draftKey })
          const server = normalizeForUi(detail.messages, detail)
          setMessages((prev) => withInflight(mergeServerMessages(server, prev, unsavedRef.current), detail.id))
        }
        void refreshSummaries()
        if (daysLoadedRef.current) void refreshDays()
      } catch (err) {
        console.error('[berean-chat] save failed', err)
        if (mountedRef.current) setFailedIds((s) => { const n = new Set(s); ids.forEach((id) => n.add(id)); return n })
      }
    }
    const p = queueRef.current.then(run, run)
    queueRef.current = p
    return p
  }, [refreshDays, refreshSummaries, setActive, withInflight]) // eslint-disable-line react-hooks/exhaustive-deps

  const titleFor = (target: Target, first: ChatMsg): string | undefined =>
    resolveTarget(target) ? undefined : deriveChatTitle([first])

  const appendLocal = (target: Target, msgs: ChatMsg[]) => {
    msgs.forEach((m) => { if (!m.pending) unsavedRef.current.add(m.id) })
    if (isActive(target)) setMessages((prev) => [...prev, ...msgs])
  }

  /** Sends one message. Returns false if it was refused (empty, or an AI request already running). */
  const send = useCallback(async (text: string, sendOpts: ChatSendOptions = {}): Promise<boolean> => {
    const content = text.trim()
    if (!content) return false
    const target: Target = { ...activeRef.current }
    const now = new Date().toISOString()
    // A reply only within the open conversation, to a message that is still there.
    const replyCandidate = sendOpts.inReplyTo === undefined ? replyToRef.current : sendOpts.inReplyTo
    const inReplyTo = replyCandidate && messagesRef.current.some((m) => m.id === replyCandidate && !m.pending)
      ? replyCandidate : undefined
    const clearReply = () => { if (replyToRef.current) setReply(null) }

    if (!sendOpts.ai) {
      const note: ChatMsg = { id: newMessageId(), role: 'user', kind: 'note', content, createdAt: now, ...(inReplyTo ? { inReplyTo } : {}) }
      clearReply()
      appendLocal(target, [note])
      void enqueue(target, (chatId) => api.upsertMessages({ chatId, title: titleFor(target, note), messages: [note] }), [note.id])
      return true
    }

    if (aiBusyRef.current || !optsRef.current.aiSupported) return false
    aiBusyRef.current = true
    setAiBusy(true)
    setProgress('Reading your question…')
    const aiMode: AiLookupChatAiMode = {
      commentary: sendOpts.ai.commentary,
      deepSearch: sendOpts.ai.deepSearch,
      tabContext: sendOpts.ai.tabContext || mentionsCurrentTab(content),
    }
    const request: ChatMsg = { id: newMessageId(), role: 'user', kind: 'ai-request', content, createdAt: now, aiMode, ...(inReplyTo ? { inReplyTo } : {}) }
    clearReply()
    const replyId = newMessageId()
    const placeholder: ChatMsg = { id: replyId, role: 'assistant', kind: 'ai-reply', content: '', pending: true, replyTo: request.id, createdAt: new Date(Date.parse(now) + 1).toISOString() }
    // History BEFORE this request: AI turns of this conversation only — notes never go to the model.
    const history = isActive(target) ? aiHistoryFor(messagesRef.current, 8, inReplyTo) : []
    appendLocal(target, [request, placeholder])
    const seq = ++partialSeqRef.current
    inflightRef.current = { target, replyId, seq, placeholder }
    void enqueue(target, (chatId) => api.upsertMessages({ chatId, title: titleFor(target, request), messages: [request] }), [request.id])

    let reply: ChatMsg
    try {
      const tabContext = aiMode.tabContext ? await optsRef.current.getTabContext?.() : undefined
      const res = await api.query(content, {
        commentary: aiMode.commentary,
        agentic: aiMode.deepSearch,
        wordReplacerRules: sendOpts.wordReplacerRules?.length ? sendOpts.wordReplacerRules : undefined,
        history,
        tabContext,
      })
      // "Nothing found" only when NOTHING came back — a Strong's card, notes, videos or a summary
      // line are complete answers on their own even with no verse chips.
      const hasAnyAnswer = res.results.length > 0 || !!res.strongsCard || (res.notes?.length ?? 0) > 0 || (res.videos?.length ?? 0) > 0 || !!res.summary
      reply = {
        id: replyId, role: 'assistant', kind: 'ai-reply', replyTo: request.id,
        content: res.error === 'ollama-unavailable'
          ? "Ollama isn't running — start it on this Mac to use Ask Berean."
          : !hasAnyAnswer ? 'No matching verses found — try rephrasing.' : '',
        ...messageFieldsFrom(res),
        createdAt: new Date().toISOString(),
      }
    } catch {
      reply = { id: replyId, role: 'assistant', kind: 'ai-reply', replyTo: request.id, content: 'Something went wrong reaching Ask Berean.', createdAt: new Date().toISOString() }
    }
    if (inflightRef.current?.replyId === replyId) inflightRef.current = null
    unsavedRef.current.add(replyId)
    if (isActive(target)) setMessages((prev) => prev.map((m) => (m.id === replyId ? reply : m)))
    void enqueue(target, (chatId) => api.upsertMessages({ chatId, messages: [reply] }), [replyId])
    aiBusyRef.current = false
    if (mountedRef.current) { setAiBusy(false); setProgress('') }
    return true
  }, [api, enqueue]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Edit a note in place — in the open conversation, or (All Messages / a day) in its own. */
  const editNote = useCallback((id: string, text: string, chatId?: string | null) => {
    const content = text.trim()
    if (!content) return
    const owner = chatId === undefined ? activeRef.current.chatId : chatId
    const inActive = !owner || owner === activeRef.current.chatId
    const m = inActive
      ? messagesRef.current.find((x) => x.id === id)
      : streamRef.current.items.find((it) => it.message.id === id && it.chatId === owner)?.message
    if (!m || m.kind !== 'note' || m.content === content) return
    const next: ChatMsg = { ...m, content, editedAt: new Date().toISOString() }
    unsavedRef.current.add(id)
    if (inActive) setMessages((prev) => prev.map((x) => (x.id === id ? next : x)))
    setStream((st) => ({ ...st, items: st.items.map((it) => (it.message.id === id ? { ...it, message: next } : it)) }))
    const target: Target = inActive ? { ...activeRef.current } : { chatId: owner, draftKey: '~edit' }
    void enqueue(target, (cid) => api.upsertMessages({ chatId: cid, messages: [next] }), [id])
  }, [api, enqueue])

  /** Edit an AI request and ask again: everything from that request on is replaced (the same
   *  single-thread behaviour the panel always had). */
  const editAndReask = useCallback(async (id: string, text: string, sendOpts: ChatSendOptions) => {
    if (aiBusyRef.current) return
    const list = messagesRef.current
    const at = list.findIndex((x) => x.id === id)
    if (at < 0 || !text.trim()) return
    const orig = list[at]
    // Asked again with the options the original request used, unless the caller overrides them.
    const aiOpts = sendOpts.ai ?? { commentary: !!orig.aiMode?.commentary, deepSearch: !!orig.aiMode?.deepSearch, tabContext: !!orig.aiMode?.tabContext }
    const removeIds = list.slice(at).map((x) => x.id)
    const target: Target = { ...activeRef.current }
    setMessages(list.slice(0, at))
    messagesRef.current = list.slice(0, at)
    await enqueue(target, (chatId) => api.upsertMessages({ chatId, messages: [], removeIds }), [])
    await send(text, { ...sendOpts, ai: aiOpts })
  }, [api, enqueue, send])

  const deleteMessage = useCallback((id: string, chatId?: string | null) => {
    const owner = chatId === undefined ? activeRef.current.chatId : chatId
    if (owner && owner === activeRef.current.chatId) setMessages((prev) => prev.filter((m) => m.id !== id))
    setStream((s) => ({ ...s, items: s.items.filter((it) => it.message.id !== id) }))
    if (!owner) return
    void enqueue({ chatId: owner, draftKey: '~delete' }, (c) => api.upsertMessages({ chatId: c, messages: [], removeIds: [id] }), [])
  }, [api, enqueue])

  // ── Replies ──────────────────────────────────────────────────────────────────────────────
  const setReply = useCallback((id: string | null) => {
    replyToRef.current = id
    setReplyToIdState(id)
    const chatId = activeRef.current.chatId
    if (chatId) writeReplyTarget(chatId, id)
  }, [])

  // ── Navigation between conversations / views ─────────────────────────────────────────────
  const setViewRef = useRef<(v: ChatView) => void>(() => {})
  const openConversation = useCallback((chatId: string, focusId?: string) => {
    // Unfiled (messages sent to no conversation) opens like one: only those messages, and what is
    // written there stays unfiled (TEST 2026-10-19 "have a conversation for all the unfiled messages").
    navigatedRef.current = true
    setViewState({ kind: 'conversation' })
    setFocusMessageId(focusId ?? null)
    if (activeRef.current.chatId === chatId) return
    setActive({ chatId, draftKey: newDraftKey() })
    setMessages([])
    void loadChat(chatId, { replace: true })
  }, [loadChat, setActive])

  const newConversation = useCallback(() => {
    navigatedRef.current = true
    setViewState({ kind: 'conversation' })
    setFocusMessageId(null)
    // A load still in flight is abandoned — and so is its "loading" (its own finally no longer
    // owns the flag once the sequence moved on; it stayed true and hid the empty state).
    loadSeqRef.current++
    setLoadingChat(false)
    if (!activeRef.current.chatId && messagesRef.current.length === 0) return // already a fresh draft
    setActive({ chatId: null, draftKey: newDraftKey() })
    setMessages([])
  }, [setActive])

  /** iPhone "New Message": today's conversation if used today, else a fresh draft — never a duplicate. */
  const startNewMessage = useCallback(async () => {
    const target = pickNewMessageTarget(await refreshSummaries())
    if (target) openConversation(target)
    else newConversation()
  }, [newConversation, openConversation, refreshSummaries])

  /** All Messages / a day: what is written there goes to no conversation (UNFILED_CHAT_ID) unless
   *  the user picks one (TEST 2026-10-18: "dont put it into a conversation unless the user selects
   *  a conversation"). */
  const setCrossDestination = useCallback((chatId: string | null) => {
    const id = chatId ?? UNFILED_CHAT_ID
    if (activeRef.current.chatId === id) return
    setActive({ chatId: id, draftKey: newDraftKey() })
    setMessages([])
    void loadChat(id, { replace: true })
  }, [loadChat, setActive])

  const setView = useCallback((v: ChatView) => {
    setFocusMessageId(null)
    const wasConversation = viewRef.current.kind === 'conversation'
    setViewState(v)
    viewRef.current = v
    if (v.kind !== 'conversation') {
      if (wasConversation) setCrossDestination(null)
      void refreshStream('reset')
    }
  }, [refreshStream, setCrossDestination])
  setViewRef.current = setView

  // ── Organising: pins and folders ─────────────────────────────────────────────────────────
  const organizeChat = useCallback(async (id: string, change: { pinned?: boolean; folder?: string | null }) => {
    const folder = change.folder === undefined ? undefined : cleanFolder(change.folder)
    setSummaries((list) => list.map((c) => (c.id !== id ? c : {
      ...c,
      ...(change.pinned !== undefined ? { pinnedAt: change.pinned ? new Date().toISOString() : null } : {}),
      ...(folder !== undefined ? { folder } : {}),
    })))
    await api.organizeChat?.(id, { ...change, ...(folder !== undefined ? { folder } : {}) })
    void refreshSummaries()
  }, [api, refreshSummaries])
  const pinChat = useCallback((id: string, pinned: boolean) => organizeChat(id, { pinned }), [organizeChat])
  const moveToFolder = useCallback((id: string, folder: string | null) => organizeChat(id, { folder }), [organizeChat])
  const renameFolder = useCallback(async (from: string, to: string | null) => {
    const target = to === null ? null : cleanFolder(to)
    if (to !== null && !target) return
    setSummaries((list) => list.map((c) => (c.folder === from ? { ...c, folder: target } : c)))
    await api.renameFolder?.(from, target)
    void refreshSummaries()
  }, [api, refreshSummaries])
  /** Every folder name in use, A to Z. */
  const folders = useMemo(() => [...new Set(summaries.map((x) => x.folder).filter((f): f is string => !!f))].sort((a, b) => a.localeCompare(b)), [summaries])

  const loadOlder = useCallback(() => {
    if (viewRef.current.kind === 'conversation') return
    const s = streamRef.current
    if (s.hasMore && !s.loading) void refreshStream('older')
  }, [refreshStream])

  const renameChat = useCallback(async (id: string, title: string) => {
    if (!title.trim()) return
    setSummaries((list) => list.map((c) => (c.id === id ? { ...c, title: title.trim() } : c)))
    await api.renameChat(id, title)
    void refreshSummaries()
  }, [api, refreshSummaries])

  const deleteChat = useCallback(async (id: string) => {
    setSummaries((list) => list.filter((c) => c.id !== id))
    if (activeRef.current.chatId === id) { setActive({ chatId: null, draftKey: newDraftKey() }); setMessages([]) }
    setStream((s) => ({ ...s, items: s.items.filter((it) => it.chatId !== id) }))
    await api.deleteChat(id)
    void refreshSummaries()
    if (daysLoadedRef.current) void refreshDays()
  }, [api, refreshDays, refreshSummaries, setActive])

  // Search (debounced; results newest first).
  const setSearch = useCallback((q: string) => setSearchState(q), [])
  useEffect(() => {
    const q = search.trim()
    if (!q) { setSearchResults(null); return }
    let cancelled = false
    const t = setTimeout(() => {
      api.queryMessages({ search: q, limit: 200 }).then((page) => {
        if (cancelled) return
        setSearchResults(page.items.slice().reverse().map((it) => ({ key: it.key, chatId: it.chatId, chatTitle: it.chatTitle, message: it.message as ChatMsg })))
      }).catch(() => { if (!cancelled) setSearchResults([]) })
    }, 180)
    return () => { cancelled = true; clearTimeout(t) }
  }, [api, search])

  /** A global-search message result was opened: the surface opens Find in that conversation
   *  with the query, on that message's match (the token makes a repeat open count). */
  const [findRequest, setFindRequest] = useState<{ query: string; messageId: string; token: number } | null>(null)
  const openSearchResult = useCallback((chatId: string, messageId: string | undefined, query: string) => {
    setSearchState('')
    openConversation(chatId, messageId)
    if (messageId && query.trim()) setFindRequest((r) => ({ query: query.trim(), messageId, token: (r?.token ?? 0) + 1 }))
  }, [openConversation])

  /** Reply to a message: from All Messages / a day, its own conversation opens first. */
  const startReply = useCallback((messageId: string, chatId: string | null) => {
    // In All Messages a message of the current destination (or of no conversation) is answered
    // right there; any other one opens its conversation first.
    if (chatId && viewRef.current.kind !== 'conversation' && (chatId === activeRef.current.chatId || chatId === UNFILED_CHAT_ID)) {
      if (chatId !== activeRef.current.chatId) setCrossDestination(null)
      writeReplyTarget(chatId, messageId)
      replyToRef.current = messageId
      setReplyToIdState(messageId)
      return
    }
    if (chatId && (viewRef.current.kind !== 'conversation' || activeRef.current.chatId !== chatId)) {
      openConversation(chatId, messageId)
      writeReplyTarget(chatId, messageId)
      replyToRef.current = messageId
      setReplyToIdState(messageId)
      return
    }
    setReply(messageId)
  }, [openConversation, setReply, setCrossDestination])
  const cancelReply = useCallback(() => setReply(null), [setReply])
  /** Scroll to (and flash) a message of the open view — a reply's quote was tapped. */
  const jumpToMessage = useCallback((id: string) => { setFocusMessageId(null); requestAnimationFrame(() => setFocusMessageId(id)) }, [])

  // The panel and the chat window share reply targets (same as drafts).
  useEffect(() => onReplyTargetsChanged(() => {
    const chatId = activeRef.current.chatId
    const r = chatId ? readReplyTarget(chatId) : null
    if (r !== replyToRef.current) { replyToRef.current = r; setReplyToIdState(r) }
  }), [])

  /** The message being replied to, while it is still in the open conversation. */
  const replyingTo = useMemo(() => (replyToId ? messages.find((m) => m.id === replyToId && !m.pending) ?? null : null), [replyToId, messages])

  // ── What the transcript shows ────────────────────────────────────────────────────────────
  const activeTitle = useMemo(() => {
    if (activeChatId === UNFILED_CHAT_ID) return UNFILED_CHAT_TITLE
    if (!activeChatId) return messages.length ? deriveChatTitle(messages) : 'New Conversation'
    return summaries.find((c) => c.id === activeChatId)?.title ?? deriveChatTitle(messages)
  }, [activeChatId, messages, summaries])

  const transcript: TranscriptItem[] = useMemo(() => {
    if (view.kind === 'conversation') {
      return messages.map((m) => ({ key: m.id, chatId: activeChatId, chatTitle: activeTitle, message: m }))
    }
    return mergeStreamItems(stream.items, { chatId: activeChatId, chatTitle: activeTitle, messages }, {
      dayKey: view.kind === 'day' ? view.dayKey : undefined,
      hasMore: stream.hasMore,
    })
  }, [view, messages, activeChatId, activeTitle, stream.items, stream.hasMore])

  return {
    // data
    summaries, summariesLoaded, days, activeChatId, activeTitle, messages, transcript, view, loadingChat,
    stream: { hasMore: view.kind !== 'conversation' && stream.hasMore, loading: stream.loading },
    search, searchResults, ai, aiBusy, progress, failedIds, focusMessageId, replyingTo,
    // actions
    startReply, cancelReply, jumpToMessage, findRequest, openSearchResult,
    folders, pinChat, moveToFolder, renameFolder, setCrossDestination,
    /** In All Messages / a day: the conversation new messages go to (null = none). */
    crossDestination: view.kind !== 'conversation' && activeChatId !== UNFILED_CHAT_ID ? activeChatId : null,
    /** The active tab's context right now (the This Tab toggle shows its label). */
    readTabContext: () => optsRef.current.getTabContext?.() ?? Promise.resolve(undefined),
    send, editNote, editAndReask, deleteMessage, openConversation, newConversation, startNewMessage,
    setView, loadOlder, renameChat, deleteChat, setSearch, refreshDays, setFocusMessageId,
  }
}

export type ChatController = ReturnType<typeof useChatController>
