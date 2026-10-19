/**
 * Which message the composer is replying to, per conversation — device-local next to the drafts
 * (chatDrafts.ts) so a half-written reply keeps its quote across switching conversations,
 * relaunching, and the Mac panel ⇄ chat window handoff. Not synced, for the same reason drafts
 * aren't. Every access is guarded — storage can be missing, full or blocked.
 */
export const CHAT_REPLIES_KEY = 'berean-chat-replies-v1'
const MAX_REPLIES = 50

type ReplyMap = Record<string, { id: string; at: number }>

function readAll(): ReplyMap {
  try {
    const raw = localStorage.getItem(CHAT_REPLIES_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: ReplyMap = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const r = v as { id?: unknown; at?: unknown } | null
      if (r && typeof r.id === 'string' && r.id) out[k] = { id: r.id, at: Number(r.at) || 0 }
    }
    return out
  } catch {
    return {}
  }
}

function writeAll(map: ReplyMap) {
  try {
    const keys = Object.keys(map)
    if (!keys.length) { localStorage.removeItem(CHAT_REPLIES_KEY); return }
    if (keys.length > MAX_REPLIES) keys.sort((a, b) => map[b].at - map[a].at).slice(MAX_REPLIES).forEach((k) => { delete map[k] })
    localStorage.setItem(CHAT_REPLIES_KEY, JSON.stringify(map))
  } catch { /* storage unavailable — the reply just isn't durable */ }
}

export function readReplyTarget(chatId: string): string | null {
  return readAll()[chatId]?.id ?? null
}

/** Remember (or with null, forget) the message being replied to in `chatId`. */
export function writeReplyTarget(chatId: string, messageId: string | null) {
  const map = readAll()
  if (!messageId) {
    if (!(chatId in map)) return
    delete map[chatId]
  } else {
    if (map[chatId]?.id === messageId) return
    map[chatId] = { id: messageId, at: Date.now() }
  }
  writeAll(map)
}

/** Another renderer (panel ⇄ chat window) changed a reply target. */
export function onReplyTargetsChanged(fn: () => void): () => void {
  const handler = (e: StorageEvent) => { if (e.key === CHAT_REPLIES_KEY || e.key === null) fn() }
  try { window.addEventListener('storage', handler) } catch { return () => {} }
  return () => { try { window.removeEventListener('storage', handler) } catch { /* */ } }
}
