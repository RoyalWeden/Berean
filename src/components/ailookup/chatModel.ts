import type { AiLookupChatMessage, AiLookupChatMessageKind, AiLookupChatSummary } from '@/types/electron'
import {
  normalizeChatMessages, messageTime, dayKeyOf, sortKeyOf, messagePreviewText, deriveChatTitle, mergeMessagesById,
  UNFILED_CHAT_ID, UNFILED_CHAT_TITLE, cleanFolder,
} from '@/platform/services/aiChatsService'

/**
 * Berean Chat — the pure model the embedded panel, the standalone window and the iPhone page share.
 * Storage rules (message kinds, legacy fallbacks) live with the service in aiChatsService.ts; this
 * file adds the presentation rules: transcript rows (day separators, bubble grouping), the AI
 * history a request may see (never plain notes), and the "new message" target.
 */

export { normalizeChatMessages, messageTime, dayKeyOf, sortKeyOf, messagePreviewText, deriveChatTitle, mergeMessagesById, UNFILED_CHAT_ID, UNFILED_CHAT_TITLE, cleanFolder }

/** A message as the UI holds it: id/kind always present. */
export type ChatMsg = AiLookupChatMessage & { id: string; kind: AiLookupChatMessageKind }

/** One message on screen, with the conversation it belongs to (null = an unsaved new conversation). */
export interface TranscriptItem {
  key: string
  chatId: string | null
  chatTitle: string
  message: ChatMsg
}

export function newMessageId(): string {
  try { return crypto.randomUUID() } catch { return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` }
}

export function normalizeForUi(messages: readonly AiLookupChatMessage[], chat: { id: string; createdAt: string; updatedAt?: string }): ChatMsg[] {
  return normalizeChatMessages(messages, chat) as ChatMsg[]
}

// Best-effort inline trigger for "use the current tab as context" without turning the toggle
// on — not exhaustive NLP, just the handful of phrasings someone would naturally reach for.
// The composer shows "Includes this tab" whenever one matches, so the extra context is never sent
// silently, and the request bubble records it (aiMode.tabContext).
export const TAB_CONTEXT_PHRASES = [
  'this chapter', 'this verse', 'this passage', 'this note', 'this entry', 'this video',
  'this page', 'current tab', 'currently viewing', 'currently open', "what i'm looking at",
  'what i am looking at', 'on screen',
]
export function mentionsCurrentTab(message: string): boolean {
  const lower = message.toLowerCase()
  return TAB_CONTEXT_PHRASES.some((p) => lower.includes(p))
}

/** The recent turns an AI request may see: AI requests and settled AI replies only — a plain
 *  note is never sent to the model — capped to the last `max` turns. */
export function aiHistoryFor(messages: readonly ChatMsg[], max = 8, inReplyTo?: string): Array<{ role: 'user' | 'assistant'; content: string }> {
  // The conversation as Ask Berean's context (TEST 2026-10-18 "make sure ai can interact with the
  // regular messages"): plain notes ride along as the user's own lines, marked so the model can
  // tell them from questions. Nothing is ever SENT for a plain message — this is only read when
  // the user explicitly asks Berean something.
  const turn = (m: ChatMsg) => ({ role: m.role, content: m.kind === 'note' ? `(my note) ${m.content}` : m.kind === 'ai-reply' ? replyContext(m) : m.content })
  const usable = (m: ChatMsg) => !m.pending && (m.kind === 'note' || m.kind === 'ai-request' || m.kind === 'ai-reply')
  // A question sent as a reply: the quoted message is what "this" / "that verse" means, however
  // old it is — it goes LAST (the pipeline keeps only the most recent turns), marked as quoted.
  const quoted = inReplyTo ? messages.find((m) => m.id === inReplyTo && usable(m)) : undefined
  const turns = messages
    .filter((m) => usable(m) && m !== quoted)
    .map(turn)
    .filter((t) => t.content.trim())
    .slice(-(quoted ? max - 1 : max))
  if (quoted) {
    const q = turn(quoted)
    if (q.content.trim()) turns.push({ role: q.role, content: `(the message I am replying to) ${q.content}` })
  }
  return turns
}

/** One line quoting a message (reply chips and the composer's "Replying to" bar). */
export function quoteSnippet(m: ChatMsg): string {
  const text = messagePreviewText({ ...m, results: undefined })
  if (text) return text
  const refs = (m.results ?? []).filter((r) => r.source !== 'cross-ref').slice(0, 3)
    .map((r) => `${r.bookName} ${r.chapter}:${r.verse}${r.endVerse ? `-${r.endVerse}` : ''}`)
  if (refs.length) return refs.join(', ') + ((m.results?.length ?? 0) > refs.length ? ', …' : '')
  return messagePreviewText(m) || (m.kind === 'ai-reply' ? 'Berean’s answer' : 'Message')
}

/** Who a quoted message is from, as the reply chip names it. */
export function quoteAuthor(m: ChatMsg): string {
  return m.role === 'assistant' ? 'Berean' : 'You'
}

/** What an AI reply said, as plain text (replies are often verse cards with no prose). */
function replyContext(m: ChatMsg): string {
  const text = (m.content || m.summary || '').trim()
  const refs = (m.results ?? []).filter((r) => r.source !== 'cross-ref').slice(0, 5)
    .map((r) => `${r.bookName} ${r.chapter}:${r.verse}${r.endVerse ? `-${r.endVerse}` : ''}`)
  return [text, refs.length ? `Passages: ${refs.join('; ')}` : '', m.strongsCard ? `Strong's ${m.strongsCard.strongsNum}` : ''].filter(Boolean).join(' — ')
}

/** An AI reply placeholder that has nothing to show yet (the typing indicator covers it). */
export function isEmptyPlaceholder(m: AiLookupChatMessage): boolean {
  return m.role === 'assistant' && !!m.pending && !m.content && !m.summary &&
    !m.results?.length && !m.strongsCard && !m.notes?.length && !m.videos?.length
}

/**
 * Merge the stored conversation (`server`) with what this window shows (`local`): the server's
 * order and content win, and only messages this window has not finished saving (`unsaved`) or
 * the live AI placeholder (`pending`) are kept on top — so a reload can never drop a just-typed
 * message, and nothing is ever shown twice.
 */
export function mergeServerMessages(server: readonly ChatMsg[], local: readonly ChatMsg[], unsaved: ReadonlySet<string>): ChatMsg[] {
  const ids = new Set(server.map((m) => m.id))
  const extra = local.filter((m) => !ids.has(m.id) && (unsaved.has(m.id) || m.pending))
  return extra.length ? [...server, ...extra] : [...server]
}

/** Interleaves other conversations' loaded stream items with the active conversation's live
 *  messages (oldest → newest). With older pages still unloaded, active messages older than the
 *  oldest loaded item stay hidden until that page loads, so ordering never has a gap. */
export function mergeStreamItems(
  loaded: readonly TranscriptItem[],
  active: { chatId: string | null; chatTitle: string; messages: readonly ChatMsg[] },
  opts: { dayKey?: string; hasMore: boolean },
): TranscriptItem[] {
  const others = active.chatId ? loaded.filter((it) => it.chatId !== active.chatId) : [...loaded]
  const floor = opts.hasMore && loaded.length ? loaded[0].key : ''
  const own: TranscriptItem[] = []
  for (const m of active.messages) {
    if (opts.dayKey && dayKeyOf(messageTime(m)) !== opts.dayKey) continue
    const key = sortKeyOf(active.chatId ?? '~draft', m)
    if (floor && key < floor) continue
    own.push({ key, chatId: active.chatId, chatTitle: active.chatTitle, message: m })
  }
  if (!own.length) return others
  return [...others, ...own].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

export type TranscriptRow =
  | { type: 'day'; key: string; dayKey: string; label: string }
  | {
      type: 'message'; key: string; item: TranscriptItem
      /** Side the bubble sits on — the user's notes/requests right, Berean's replies left. */
      side: 'me' | 'berean'
      /** First / last bubble of a run from the same side + conversation (corner rounding, labels). */
      groupStart: boolean; groupEnd: boolean
      /** A Messages-style time stamp above this bubble (first of the day, or after a long pause). */
      timeLabel?: string
      /** Show which conversation this run belongs to (cross-conversation views). */
      showConversation: boolean
    }

const GROUP_GAP_MS = 5 * 60_000
const TIME_GAP_MS = 60 * 60_000

/** Transcript rows: day separators, bubble runs and time stamps. Pure; tested. */
export function buildTranscriptRows(items: readonly TranscriptItem[], opts: { crossConversation: boolean; now?: number }): TranscriptRow[] {
  const rows: TranscriptRow[] = []
  let prevDay = ''
  let prev: { side: 'me' | 'berean'; chatId: string | null; t: number; row: Extract<TranscriptRow, { type: 'message' }> } | null = null
  for (const it of items) {
    if (isEmptyPlaceholder(it.message)) continue
    const t = messageTime(it.message)
    const day = dayKeyOf(t)
    const side: 'me' | 'berean' = it.message.role === 'assistant' ? 'berean' : 'me'
    let newDay = false
    if (day !== prevDay) {
      rows.push({ type: 'day', key: `day-${day}-${it.key}`, dayKey: day, label: formatDayHeading(day, opts.now) })
      prevDay = day
      newDay = true
    }
    const longPause = !!prev && t - prev.t > TIME_GAP_MS
    const groupStart = newDay || !prev || prev.side !== side || prev.chatId !== it.chatId || t - prev.t > GROUP_GAP_MS
    const showConversation = opts.crossConversation && (newDay || !prev || prev.chatId !== it.chatId)
    const row: Extract<TranscriptRow, { type: 'message' }> = {
      type: 'message', key: it.key, item: it, side, groupStart, groupEnd: true,
      timeLabel: !newDay && longPause ? formatTime(t) : undefined,
      showConversation,
    }
    // A bubble that continues a run means the previous one no longer ends it.
    if (!groupStart && prev) prev.row.groupEnd = false
    rows.push(row)
    prev = { side, chatId: it.chatId, t, row }
  }
  return rows
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

/** "Today", "Yesterday", a weekday within the last week, else "Mon, Oct 6" (+ year when not this year). */
export function formatDayHeading(dayKey: string, now = Date.now()): string {
  const [y, m, d] = dayKey.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const today = dayKeyOf(now)
  if (dayKey === today) return 'Today'
  if (dayKey === dayKeyOf(now - 86_400_000)) return 'Yesterday'
  const nowDate = new Date(now)
  const startOfToday = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime()
  if (startOfToday - date.getTime() < 6 * 86_400_000 && date.getTime() < startOfToday) return date.toLocaleDateString([], { weekday: 'long' })
  return date.toLocaleDateString([], date.getFullYear() === nowDate.getFullYear()
    ? { weekday: 'short', month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Sidebar time for a conversation: a time today, "Yesterday", a weekday this week, else a date. */
export function formatListTime(iso: string | undefined, now = Date.now()): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  if (dayKeyOf(t) === dayKeyOf(now)) return formatTime(t)
  const label = formatDayHeading(dayKeyOf(t), now)
  return label
}

/**
 * Where "New Message" (iPhone quick entry, or a fresh open) should write: today's most recent
 * conversation when it was last used today, else a new, unsaved conversation (null) — which
 * only becomes a row once something is sent, so repeated "new message" taps never create empty
 * duplicates.
 */
export function pickNewMessageTarget(summaries: readonly AiLookupChatSummary[], now = Date.now()): string | null {
  const latest = [...summaries].sort((a, b) => (b.lastMessageAt ?? b.updated_at).localeCompare(a.lastMessageAt ?? a.updated_at))[0]
  if (!latest) return null
  const at = Date.parse(latest.lastMessageAt ?? latest.updated_at)
  return Number.isFinite(at) && dayKeyOf(at) === dayKeyOf(now) ? latest.id : null
}

/** Caption for an AI request bubble: which options it was sent with. */
export function aiModeCaption(mode: AiLookupChatMessage['aiMode']): string {
  const parts = ['Ask Berean']
  if (mode?.commentary) parts.push('Commentary')
  if (mode?.deepSearch) parts.push('Deep Search')
  if (mode?.tabContext) parts.push('This Tab')
  return parts.join(' · ')
}
