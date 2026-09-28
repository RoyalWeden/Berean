import type { ServiceContext } from './context'
import type { AiLookupResult, AiLookupNoteResult, AiLookupStrongsCard } from '../../types/electron'

/**
 * AI Lookup chat persistence — extracted verbatim from the four `ailookup:*Chat` handlers in
 * electron/ipc/aiLookup.ts (Phase 1/3). Everything else in that file (the actual lookup/search
 * pipeline, Ollama plumbing) stays in electron — this service only owns the `ai_chats` table.
 */

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
  createdAt: string
}

export interface AiChatSummary {
  id: string
  title: string
  created_at: string
  updated_at: string
}

export interface AiChatDetail {
  id: string
  title: string
  messages: AiChatMessage[]
  createdAt: string
  updatedAt: string
}

interface ChatRow {
  id: string
  title: string
  messages: string // JSON
  created_at: string
  updated_at: string
}

export function createAiChatsService(ctx: ServiceContext) {
  const db = () => ctx.userDb

  async function listChats(): Promise<AiChatSummary[]> {
    return db().all<AiChatSummary>('SELECT id, title, created_at, updated_at FROM ai_chats ORDER BY updated_at DESC')
  }

  async function getChat(id: string): Promise<AiChatDetail | null> {
    const row = await db().get<ChatRow>('SELECT * FROM ai_chats WHERE id = ?', [id])
    if (!row) return null
    return { id: row.id, title: row.title, messages: JSON.parse(row.messages) as AiChatMessage[], createdAt: row.created_at, updatedAt: row.updated_at }
  }

  async function saveChat(chat: { id?: string; title: string; messages: AiChatMessage[] }): Promise<{ id: string }> {
    const now = new Date(ctx.now()).toISOString()
    if (chat.id) {
      await db().run('UPDATE ai_chats SET title = ?, messages = ?, updated_at = ? WHERE id = ?', [chat.title, JSON.stringify(chat.messages), now, chat.id])
      ctx.events.emit('data:changed', { entity: 'ai_chat', id: chat.id, op: 'upsert' })
      return { id: chat.id }
    }
    const id = ctx.uuid()
    await db().run('INSERT INTO ai_chats (id, title, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [id, chat.title, JSON.stringify(chat.messages), now, now])
    ctx.events.emit('data:changed', { entity: 'ai_chat', id, op: 'upsert' })
    return { id }
  }

  async function deleteChat(id: string): Promise<{ success: true }> {
    await db().run('DELETE FROM ai_chats WHERE id = ?', [id])
    ctx.events.emit('data:changed', { entity: 'ai_chat', id, op: 'delete' })
    return { success: true }
  }

  return { listChats, getChat, saveChat, deleteChat }
}

export type AiChatsService = ReturnType<typeof createAiChatsService>
