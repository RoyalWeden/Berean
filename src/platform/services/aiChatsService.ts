import type { ServiceContext } from './context'
import type { AiLookupResult, AiLookupNoteResult, AiLookupStrongsCard, AiLookupVideoResult } from '../../types/electron'

/**
 * Berean Chat persistence — the `ai_chats` table (one row per conversation, messages as a JSON
 * array). Originally extracted verbatim from the four `ailookup:*Chat` handlers in
 * electron/ipc/aiLookup.ts; the AI pipeline itself stays in electron.
 *
 * Messaging redesign (2026-10): a conversation now mixes plain messages ("notes" — never sent
 * to the AI) with AI requests and replies. Every new field is OPTIONAL and additive, so an older
 * client reading the same synced JSON still sees a valid `{ role, content, createdAt }` message:
 *
 *   kind     'note' | 'ai-request' | 'ai-reply'. Absent = legacy: user → ai-request,
 *            assistant → ai-reply (every pre-redesign message was an AI exchange).
 *   id       stable per-message id (legacy: `${chatId}:${index}`, frozen the next time the chat
 *            is written). Lets two windows append to the same conversation without clobbering
 *            each other (upsertMessages merges by id).
 *   aiMode   on an ai-request: which AI options were used for that one send.
 *   replyTo  on an ai-reply: the ai-request it answers.
 *   inReplyTo  on a note / ai-request: the message (same conversation) the user replied to —
 *            shown as a quote above the bubble. An older client just shows the message.
 *   editedAt set when a note's text was edited in place.
 *
 * `createdAt` stays an ISO string (the field already existed in that format); a missing or
 * unparseable value falls back to the previous message's time, else the chat's created_at.
 */

export type AiChatMessageKind = 'note' | 'ai-request' | 'ai-reply'

/**
 * Messages written in All Messages / a day without choosing a conversation live in one reserved
 * row with this fixed id (every device converges on the same row; its messages merge by id like
 * any conversation). It is never listed as a conversation — only its messages appear, in the
 * cross-conversation views and search.
 */
export const UNFILED_CHAT_ID = 'berean-unfiled'
export const UNFILED_CHAT_TITLE = 'Unfiled'

export interface AiChatAiMode {
  commentary: boolean
  deepSearch: boolean
  /** The active tab's content was sent as context (toggle on, or an inline "this chapter"). */
  tabContext: boolean
}

export interface AiChatMessage {
  role: 'user' | 'assistant'
  content: string
  results?: AiLookupResult[]
  visibleCount?: number
  keywords?: string[]
  related?: AiLookupResult[]
  relatedNote?: string
  summary?: string
  strongsCard?: AiLookupStrongsCard
  notes?: AiLookupNoteResult[]
  notesAreThePrimaryAnswer?: boolean
  videos?: AiLookupVideoResult[]
  createdAt: string
  id?: string
  kind?: AiChatMessageKind
  aiMode?: AiChatAiMode
  replyTo?: string
  inReplyTo?: string
  editedAt?: string
}

/** A message after normalizeChatMessages — id/kind always present. */
export type NormalizedChatMessage = AiChatMessage & { id: string; kind: AiChatMessageKind }

export interface AiChatSummary {
  id: string
  title: string
  created_at: string
  updated_at: string
  /** Extras (redesign) — derived from the messages, never stored separately. */
  messageCount?: number
  lastMessageAt?: string
  preview?: string
  /** Pinned (ISO time of the pin) — pinned conversations list first, newest pin first. */
  pinnedAt?: string | null
  /** The folder the conversation is filed in (its name), or null. */
  folder?: string | null
}

export interface AiChatDetail {
  id: string
  title: string
  messages: AiChatMessage[]
  createdAt: string
  updatedAt: string
}

export interface AiChatStreamItem {
  chatId: string
  chatTitle: string
  message: NormalizedChatMessage
  /** Sort key — `time|chatId|messageId`, lexicographically ordered (see sortKeyOf). */
  key: string
}

export interface AiChatDaySummary {
  /** Local calendar day, `YYYY-MM-DD`. */
  dayKey: string
  count: number
  notes: number
  ai: number
}

export interface AiChatMessageQuery {
  chatId?: string
  dayKey?: string
  /** Case-insensitive substring over message text (content + AI summary). */
  search?: string
  /** Return only items whose key sorts before this (paging backwards from the newest). */
  before?: string
  limit?: number
}

export interface AiChatMessagePage {
  /** Oldest → newest. */
  items: AiChatStreamItem[]
  hasMore: boolean
  /** Pass as `before` to fetch the next-older page. */
  cursor: string | null
}

interface ChatRow {
  id: string
  title: string
  messages: string // JSON
  created_at: string
  updated_at: string
}

// ── Pure helpers (shared with the UI; tested in __tests__/aiChatModel.test.ts) ───────────────

function validTime(iso: unknown): number | null {
  if (typeof iso !== 'string' || !iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

export function messageKind(m: Pick<AiChatMessage, 'role' | 'kind'>): AiChatMessageKind {
  if (m.kind === 'note' || m.kind === 'ai-request' || m.kind === 'ai-reply') return m.kind
  return m.role === 'assistant' ? 'ai-reply' : 'ai-request'
}

/** Fills id/kind/createdAt on every message without mutating the stored objects. */
export function normalizeChatMessages(raw: unknown, chat: { id: string; createdAt: string; updatedAt?: string }): NormalizedChatMessage[] {
  const list = Array.isArray(raw) ? raw : []
  let prevTime = validTime(chat.createdAt) ?? validTime(chat.updatedAt) ?? 0
  const seen = new Set<string>()
  const out: NormalizedChatMessage[] = []
  list.forEach((m, i) => {
    if (!m || typeof m !== 'object') return
    const msg = m as AiChatMessage
    const role: AiChatMessage['role'] = msg.role === 'assistant' ? 'assistant' : 'user'
    const t = validTime(msg.createdAt)
    const time = t ?? prevTime
    prevTime = Math.max(prevTime, time)
    let id = typeof msg.id === 'string' && msg.id ? msg.id : `${chat.id}:${i}`
    if (seen.has(id)) id = `${id}:${i}`
    seen.add(id)
    out.push({
      ...msg,
      role,
      content: typeof msg.content === 'string' ? msg.content : '',
      id,
      kind: messageKind({ role, kind: msg.kind }),
      createdAt: t != null ? msg.createdAt : new Date(time).toISOString(),
    })
  })
  return out
}

export function messageTime(m: Pick<AiChatMessage, 'createdAt'>): number {
  return validTime(m.createdAt) ?? 0
}

/** Local calendar day of a timestamp, `YYYY-MM-DD` (same machine/time zone as the UI). */
export function dayKeyOf(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function sortKeyOf(chatId: string, m: { id: string; createdAt: string }): string {
  return `${String(messageTime(m)).padStart(15, '0')}|${chatId}|${m.id}`
}

/** Message text without the chat's markdown (**bold**, <u>…</u>, list / quote markers…) — for
 *  titles and previews, which are plain text. */
export function plainChatText(text: string): string {
  return text
    .replace(/^[ \t]*(?:```|~~~).*$/gm, '')                       // code fence lines
    .replace(/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/gm, '') // table separator rows
    .replace(/^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)+\|?[ \t]*$/gm, '')   // …with single dashes (`| :-: |`)
    .replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, (_, row: string) => row.split('|').map((c) => c.trim()).filter(Boolean).join(' · '))
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')                           // heading markers
    .replace(/^[ \t]*(?:[-*•]|\d{1,3}[.)]|>)[ \t]+/gm, '')
    .replace(/<\/?u>/g, '')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1')
    .replace(/(\*\*|~~|==|`)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]*?\S)\*(?!\w)/g, '$1$2')
    .replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1$2')
}

/** Plain text the sidebar/search shows for a message (AI replies often have no `content`). */
export function messagePreviewText(m: AiChatMessage): string {
  const text = plainChatText(m.content || m.summary || '').trim()
  if (text) return text.replace(/\s+/g, ' ')
  const n = m.results?.length ?? 0
  if (n > 0) return `${n} passage${n === 1 ? '' : 's'}`
  if (m.strongsCard) return m.strongsCard.strongsNum
  if (m.notes?.length) return `${m.notes.length} note${m.notes.length === 1 ? '' : 's'}`
  if (m.videos?.length) return `${m.videos.length} video${m.videos.length === 1 ? '' : 's'}`
  return ''
}

/** Counts per local day, newest day first. */
export function groupDays(items: Array<{ message: NormalizedChatMessage }>): AiChatDaySummary[] {
  const byDay = new Map<string, AiChatDaySummary>()
  for (const { message } of items) {
    const key = dayKeyOf(messageTime(message))
    let d = byDay.get(key)
    if (!d) { d = { dayKey: key, count: 0, notes: 0, ai: 0 }; byDay.set(key, d) }
    d.count++
    if (message.kind === 'note') d.notes++
    else d.ai++
  }
  return [...byDay.values()].sort((a, b) => (a.dayKey < b.dayKey ? 1 : a.dayKey > b.dayKey ? -1 : 0))
}

/** Merge `incoming` into `current` by id: same id replaces in place, new ids append (in order). */
export function mergeMessagesById<T extends { id: string }>(current: readonly T[], incoming: readonly T[], removeIds: readonly string[] = []): T[] {
  const remove = new Set(removeIds)
  const out = current.filter((m) => !remove.has(m.id))
  const index = new Map(out.map((m, i) => [m.id, i]))
  for (const m of incoming) {
    if (remove.has(m.id)) continue
    const at = index.get(m.id)
    if (at != null) out[at] = m
    else { index.set(m.id, out.length); out.push(m) }
  }
  return out
}

/** A folder name as stored: trimmed, single-spaced, at most 60 characters; empty → no folder. */
export function cleanFolder(name: string | null | undefined): string | null {
  const t = (name ?? '').trim().replace(/\s+/g, ' ').slice(0, 60)
  return t || null
}

/** Default conversation title: the first message's text, trimmed. */
export function deriveChatTitle(messages: ReadonlyArray<Pick<AiChatMessage, 'content' | 'role'>>): string {
  const first = messages.find((m) => m.role === 'user' && m.content.trim())
  const text = plainChatText(first?.content ?? '').trim().replace(/\s+/g, ' ')
  if (!text) return 'New Conversation'
  return text.length > 60 ? `${text.slice(0, 57).trimEnd()}…` : text
}

// ── Service ───────────────────────────────────────────────────────────────────────────────

export function createAiChatsService(ctx: ServiceContext) {
  const db = () => ctx.userDb

  // Parsed + normalized messages per chat. A cached entry is valid only while BOTH its updated_at
  // and the stored JSON's length match the row, and it is dropped on every ai_chat change event —
  // including remote (iCloud) applies, whose merged row can keep the local updated_at (that field
  // merges last-writer-wins while `messages` merges by id), so updated_at alone is not a version.
  const cache = new Map<string, { version: string; messages: NormalizedChatMessage[] }>()
  const versionOf = (updatedAt: string, length: number) => `${updatedAt}#${length}`
  ctx.events.on('data:changed', (c) => {
    if (c.entity !== 'ai_chat') return
    if (c.id) cache.delete(c.id); else cache.clear()
  })

  function cacheRow(row: ChatRow): NormalizedChatMessage[] {
    let parsed: unknown = []
    try { parsed = JSON.parse(row.messages) } catch { parsed = [] }
    const messages = normalizeChatMessages(parsed, { id: row.id, createdAt: row.created_at, updatedAt: row.updated_at })
    cache.set(row.id, { version: versionOf(row.updated_at, row.messages?.length ?? 0), messages })
    return messages
  }

  async function allChats() {
    const heads = await db().all<{ id: string; title: string; created_at: string; updated_at: string; n: number; pinned_at: string | null; folder: string | null }>(
      'SELECT id, title, created_at, updated_at, length(messages) AS n, pinned_at, folder FROM ai_chats ORDER BY updated_at DESC')
    const live = new Set(heads.map((h) => h.id))
    for (const id of [...cache.keys()]) if (!live.has(id)) cache.delete(id)
    const stale = heads.filter((h) => cache.get(h.id)?.version !== versionOf(h.updated_at, h.n ?? 0)).map((h) => h.id)
    for (let i = 0; i < stale.length; i += 200) {
      const chunk = stale.slice(i, i + 200)
      const rows = await db().all<ChatRow>(`SELECT * FROM ai_chats WHERE id IN (${chunk.map(() => '?').join(',')})`, chunk)
      for (const r of rows) cacheRow(r)
    }
    return heads.map((h) => ({ id: h.id, title: h.id === UNFILED_CHAT_ID ? UNFILED_CHAT_TITLE : h.title, createdAt: h.created_at, updatedAt: h.updated_at, pinnedAt: h.pinned_at, folder: h.folder, messages: cache.get(h.id)?.messages ?? [] }))
  }

  async function listChats(): Promise<AiChatSummary[]> {
    const chats = await allChats()
    return chats.filter((c) => c.id !== UNFILED_CHAT_ID).map((c) => {
      const last = c.messages[c.messages.length - 1]
      return {
        id: c.id, title: c.title, created_at: c.createdAt, updated_at: c.updatedAt,
        messageCount: c.messages.length,
        lastMessageAt: last?.createdAt,
        preview: last ? messagePreviewText(last).slice(0, 140) : '',
        pinnedAt: c.pinnedAt ?? null,
        folder: c.folder ?? null,
      }
    })
  }

  async function getChat(id: string): Promise<AiChatDetail | null> {
    const row = await db().get<ChatRow>('SELECT * FROM ai_chats WHERE id = ?', [id])
    if (!row) return null
    const hit = cache.get(row.id)
    const messages = hit && hit.version === versionOf(row.updated_at, row.messages?.length ?? 0) ? hit.messages : cacheRow(row)
    return { id: row.id, title: row.id === UNFILED_CHAT_ID ? UNFILED_CHAT_TITLE : row.title, messages, createdAt: row.created_at, updatedAt: row.updated_at }
  }

  async function writeRow(id: string | undefined, title: string, messages: AiChatMessage[], newId = ctx.uuid()): Promise<{ id: string; createdAt: string; updatedAt: string }> {
    const now = new Date(ctx.now()).toISOString()
    if (id) {
      await db().run('UPDATE ai_chats SET title = ?, messages = ?, updated_at = ? WHERE id = ?', [title, JSON.stringify(messages), now, id])
      ctx.events.emit('data:changed', { entity: 'ai_chat', id, op: 'upsert' })
      const row = await db().get<{ created_at: string }>('SELECT created_at FROM ai_chats WHERE id = ?', [id])
      return { id, createdAt: row?.created_at ?? now, updatedAt: now }
    }
    await db().run('INSERT INTO ai_chats (id, title, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [newId, title, JSON.stringify(messages), now, now])
    ctx.events.emit('data:changed', { entity: 'ai_chat', id: newId, op: 'upsert' })
    return { id: newId, createdAt: now, updatedAt: now }
  }

  async function saveChat(chat: { id?: string; title: string; messages: AiChatMessage[] }): Promise<{ id: string }> {
    const { id } = await writeRow(chat.id, chat.title, chat.messages)
    cache.delete(id)
    return { id }
  }

  /**
   * The redesign's write path: merges `messages` into the stored conversation by message id
   * (replace same id, append new) and drops `removeIds`, then writes the row through the same
   * UPDATE/INSERT + `data:changed` as saveChat — so iCloud sync and the cross-window broadcast see
   * an ordinary ai_chat upsert. Merging against the row as it is NOW (not a renderer's possibly
   * stale copy) is what keeps two windows appending to one conversation from overwriting each
   * other. A missing `chatId` (or one deleted meanwhile) creates a new conversation.
   */
  async function upsertMessages(input: { chatId?: string | null; title?: string; messages: AiChatMessage[]; removeIds?: string[] }): Promise<AiChatDetail> {
    const existing = input.chatId ? await getChat(input.chatId) : null
    const incoming = normalizeChatMessages(input.messages, { id: existing?.id ?? 'new', createdAt: new Date(ctx.now()).toISOString() })
    const current = existing ? (existing.messages as NormalizedChatMessage[]) : []
    const merged = mergeMessagesById(current, incoming, input.removeIds ?? [])
    const unfiled = input.chatId === UNFILED_CHAT_ID
    const title = unfiled ? UNFILED_CHAT_TITLE : input.title?.trim() || existing?.title || deriveChatTitle(merged)
    // The reserved "no conversation" row is created under its fixed id, never a new one.
    const written = await writeRow(existing?.id, title, merged, unfiled ? UNFILED_CHAT_ID : undefined)
    const messages = cacheRow({ id: written.id, title, messages: JSON.stringify(merged), created_at: written.createdAt, updated_at: written.updatedAt })
    return { id: written.id, title, messages, createdAt: written.createdAt, updatedAt: written.updatedAt }
  }

  async function renameChat(id: string, title: string): Promise<{ success: boolean }> {
    const clean = title.trim()
    if (!clean) return { success: false }
    const now = new Date(ctx.now()).toISOString()
    await db().run('UPDATE ai_chats SET title = ?, updated_at = ? WHERE id = ?', [clean, now, id])
    ctx.events.emit('data:changed', { entity: 'ai_chat', id, op: 'upsert' })
    cache.delete(id)
    return { success: true }
  }

  /** Pin / unpin and file / unfile one conversation (`folder: null` takes it out of its folder). */
  async function organizeChat(id: string, change: { pinned?: boolean; folder?: string | null }): Promise<{ success: boolean }> {
    if (id === UNFILED_CHAT_ID) return { success: false }
    const sets: string[] = []
    const args: Array<string | null> = []
    if (change.pinned !== undefined) { sets.push('pinned_at = ?'); args.push(change.pinned ? new Date(ctx.now()).toISOString() : null) }
    if (change.folder !== undefined) { sets.push('folder = ?'); args.push(cleanFolder(change.folder)) }
    if (!sets.length) return { success: false }
    await db().run(`UPDATE ai_chats SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`, [...args, new Date(ctx.now()).toISOString(), id])
    ctx.events.emit('data:changed', { entity: 'ai_chat', id, op: 'upsert' })
    cache.delete(id)
    return { success: true }
  }

  /** Rename a folder (every conversation in it moves along), or with `to: null` remove the folder —
   *  its conversations stay, just unfiled. */
  async function renameFolder(from: string, to: string | null): Promise<{ success: boolean; moved: number }> {
    const target = to === null ? null : cleanFolder(to)
    if (to !== null && !target) return { success: false, moved: 0 }
    const ids = (await db().all<{ id: string }>('SELECT id FROM ai_chats WHERE folder = ?', [from])).map((r) => r.id)
    const now = new Date(ctx.now()).toISOString()
    for (const id of ids) {
      await db().run('UPDATE ai_chats SET folder = ?, updated_at = ? WHERE id = ?', [target, now, id])
      ctx.events.emit('data:changed', { entity: 'ai_chat', id, op: 'upsert' })
      cache.delete(id)
    }
    return { success: true, moved: ids.length }
  }

  async function deleteChat(id: string): Promise<{ success: true }> {
    await db().run('DELETE FROM ai_chats WHERE id = ?', [id])
    ctx.events.emit('data:changed', { entity: 'ai_chat', id, op: 'delete' })
    cache.delete(id)
    return { success: true }
  }

  async function streamItems(filter: { chatId?: string }): Promise<AiChatStreamItem[]> {
    const chats = await allChats()
    const items: AiChatStreamItem[] = []
    for (const c of chats) {
      if (filter.chatId && c.id !== filter.chatId) continue
      for (const m of c.messages) items.push({ chatId: c.id, chatTitle: c.title, message: m, key: sortKeyOf(c.id, m) })
    }
    items.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    return items
  }

  /** One page of messages across conversations (All Messages / a day / search), newest page first. */
  async function queryMessages(q: AiChatMessageQuery = {}): Promise<AiChatMessagePage> {
    const limit = Math.max(1, Math.min(q.limit ?? 100, 500))
    const needle = q.search?.trim().toLowerCase()
    let items = await streamItems({ chatId: q.chatId })
    if (q.dayKey) items = items.filter((it) => dayKeyOf(messageTime(it.message)) === q.dayKey)
    if (needle) items = items.filter((it) => `${it.message.content}\n${it.message.summary ?? ''}`.toLowerCase().includes(needle))
    if (q.before) items = items.filter((it) => it.key < q.before!)
    const page = items.slice(Math.max(0, items.length - limit))
    return { items: page, hasMore: items.length > page.length, cursor: page[0]?.key ?? null }
  }

  async function listDays(): Promise<AiChatDaySummary[]> {
    return groupDays(await streamItems({}))
  }

  return { listChats, getChat, saveChat, upsertMessages, renameChat, organizeChat, renameFolder, deleteChat, queryMessages, listDays }
}

export type AiChatsService = ReturnType<typeof createAiChatsService>
