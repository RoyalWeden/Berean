import type { ServiceContext } from './context'
import { parseStrongsIds } from '../../lib/research/strongsId'

/**
 * Explicitly saved research context (spec §7.2, decision 17): verified references, Strong's ids,
 * the topic and a short human-readable summary the user chose to keep and reuse in another chat.
 * Visible, editable by deletion, synced (schema v49 `ai_saved_contexts`, tombstoned). There is no
 * automatic or hidden memory — nothing is saved unless the user saves it.
 */

export interface SavedResearchContent {
  topic: string
  refs: string[]       // "JHN 3:16"
  strongs: string[]    // "G5485"
  summary: string      // what the user sees in the list
  sourceChatId?: string
}

export interface SavedResearchContext {
  id: string
  title: string
  content: SavedResearchContent
  createdAt: string
  updatedAt: string
}

interface Row { id: string; title: string; content: string; created_at: string; updated_at: string; deleted_at: string | null }

const REF_KEY_RE = /^[1-3]?[A-Z]{2,4}\d? \d{1,3}:\d{1,3}(?:-\d{1,3})?$/

function clean(c: Partial<SavedResearchContent>): SavedResearchContent {
  return {
    topic: String(c.topic ?? '').slice(0, 200),
    refs: (Array.isArray(c.refs) ? c.refs : []).filter((r) => typeof r === 'string' && REF_KEY_RE.test(r)).slice(0, 50),
    strongs: (Array.isArray(c.strongs) ? c.strongs : []).flatMap((s) => parseStrongsIds(String(s)).map((m) => m.id)).slice(0, 30),
    summary: String(c.summary ?? '').slice(0, 1000),
    ...(c.sourceChatId ? { sourceChatId: String(c.sourceChatId) } : {}),
  }
}

function toContext(r: Row): SavedResearchContext {
  let parsed: Partial<SavedResearchContent> = {}
  try { parsed = JSON.parse(r.content) } catch { /* damaged row */ }
  return { id: r.id, title: r.title, content: clean(parsed), createdAt: r.created_at, updatedAt: r.updated_at }
}

/** The synthetic conversation turn a saved context contributes to follow-up resolution. */
export function savedContextTurn(c: SavedResearchContext): { role: 'assistant'; content: string } {
  const parts = [`Saved research: ${c.content.topic || c.title}`]
  if (c.content.refs.length) parts.push(`Passages: ${c.content.refs.join('; ')}`)
  if (c.content.strongs.length) parts.push(`Strong's ${c.content.strongs.join(' · ')}`)
  return { role: 'assistant', content: parts.join(' — ') }
}

export function createSavedContextsService(ctx: ServiceContext) {
  const db = () => ctx.userDb
  const iso = () => new Date(ctx.now()).toISOString()

  async function list(): Promise<SavedResearchContext[]> {
    try {
      return (await db().all<Row>('SELECT * FROM ai_saved_contexts WHERE deleted_at IS NULL ORDER BY updated_at DESC')).map(toContext)
    } catch { return [] }
  }

  async function get(id: string): Promise<SavedResearchContext | null> {
    const row = await db().get<Row>('SELECT * FROM ai_saved_contexts WHERE id = ? AND deleted_at IS NULL', [id]).catch(() => undefined)
    return row ? toContext(row) : null
  }

  async function save(title: string, content: Partial<SavedResearchContent>): Promise<SavedResearchContext> {
    const id = ctx.uuid()
    const now = iso()
    await db().run('INSERT INTO ai_saved_contexts (id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [id, title.trim().slice(0, 120) || 'Saved research', JSON.stringify(clean(content)), now, now])
    ctx.events.emit('data:changed', { entity: 'ai_saved_context', id, op: 'upsert' })
    return (await get(id))!
  }

  async function remove(id: string): Promise<{ success: boolean }> {
    const now = iso()
    const r = await db().run('UPDATE ai_saved_contexts SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', [now, now, id])
    if (r.changes) ctx.events.emit('data:changed', { entity: 'ai_saved_context', id, op: 'delete' })
    return { success: r.changes > 0 }
  }

  return { list, get, save, remove }
}

export type SavedContextsService = ReturnType<typeof createSavedContextsService>
