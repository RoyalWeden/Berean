/**
 * Durable, device-local Berean Chat drafts — one unsent markdown draft per conversation key
 * (a chat id, or 'new' for a conversation that has no row yet). Kept in localStorage so a draft
 * survives switching conversations and relaunching, and is shared by the Mac's panel and chat
 * window (same origin; each listens to `storage` events). Deliberately NOT synced to iCloud: a
 * half-typed draft jumping between devices (and conflicting) is worse than Messages' per-device
 * drafts. Every access is guarded — storage can be missing, full or blocked.
 */
export const CHAT_DRAFTS_KEY = 'berean-chat-drafts-v1'
export const MAX_DRAFTS = 50

export interface ChatDraft { md: string; updatedAt: number }
type DraftMap = Record<string, ChatDraft>

function readAll(): DraftMap {
  try {
    const raw = localStorage.getItem(CHAT_DRAFTS_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: DraftMap = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const d = v as Partial<ChatDraft> | null
      if (d && typeof d.md === 'string' && d.md) out[k] = { md: d.md, updatedAt: Number(d.updatedAt) || 0 }
    }
    return out
  } catch {
    return {}
  }
}

function writeAll(map: DraftMap) {
  try {
    const keys = Object.keys(map)
    if (!keys.length) { localStorage.removeItem(CHAT_DRAFTS_KEY); return }
    if (keys.length > MAX_DRAFTS) {
      keys.sort((a, b) => map[b].updatedAt - map[a].updatedAt).slice(MAX_DRAFTS).forEach((k) => { delete map[k] })
    }
    localStorage.setItem(CHAT_DRAFTS_KEY, JSON.stringify(map))
  } catch { /* storage unavailable / full — the draft just isn't durable */ }
}

export function readDraft(key: string): string {
  return readAll()[key]?.md ?? ''
}

/** Save (or, for an empty / whitespace-only draft, clear) the draft for `key`. */
export function writeDraft(key: string, md: string) {
  const map = readAll()
  if (!md.trim()) {
    if (!(key in map)) return
    delete map[key]
  } else {
    if (map[key]?.md === md) return
    map[key] = { md, updatedAt: Date.now() }
  }
  writeAll(map)
}

export function clearDraft(key: string) { writeDraft(key, '') }

/** Another renderer (panel ⇄ chat window) changed the drafts. */
export function onDraftsChanged(fn: () => void): () => void {
  const handler = (e: StorageEvent) => { if (e.key === CHAT_DRAFTS_KEY || e.key === null) fn() }
  try { window.addEventListener('storage', handler) } catch { return () => {} }
  return () => { try { window.removeEventListener('storage', handler) } catch { /* */ } }
}
