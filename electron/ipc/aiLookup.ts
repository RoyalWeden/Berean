import type { IpcMain } from 'electron'
import { randomUUID } from 'crypto'
import { getBereanDb } from '../db/berean'
import { queryVerse, searchVerses } from './bible'
import { getTextDb } from '../db/bible'
import { getCrossRefsForVerse, getTskeForVerse } from './crossrefs'
import { checkOllamaAvailable, runOllamaJson, runOllamaText, DEFAULT_OLLAMA_MODEL } from '../ollama'

export type ResultSource = 'keyword' | 'ai-guess' | 'cross-ref'

export interface AiLookupResult {
  textId: string
  bookId: string
  chapter: number
  verse: number
  text: string
  source: ResultSource
  commentary?: string
}

export interface AiLookupResponse {
  results: AiLookupResult[]
  summary?: string
  error?: string
}

interface AiExtraction {
  keywords: string[]
  guesses: Array<{ book: string; chapter: number; verse: number }>
}

const MAX_RESULTS = 25
const DEFAULT_TEXT_ID = 'kjva'

// Every text DB's `books` table uses short 3-4 letter ids (GEN, EXO, MAT...) — the model
// is asked to use those directly, but it won't always comply, so book-name resolution
// falls back to a simple normalized-name lookup built from bible:getBooks-equivalent data
// the first time it's needed.
let bookNameToId: Map<string, string> | null = null
function resolveBookId(raw: string): string | null {
  const upper = raw.trim().toUpperCase()
  if (upper.length <= 4 && /^[A-Z0-9]+$/.test(upper)) return upper // looks like an id already
  if (!bookNameToId) {
    bookNameToId = new Map()
    try {
      const db = getTextDb(DEFAULT_TEXT_ID)
      if (db) {
        const rows = db.prepare('SELECT id, name, short_name FROM books').all() as Array<{ id: string; name: string; short_name: string }>
        for (const r of rows) {
          bookNameToId!.set(r.name.toUpperCase(), r.id)
          bookNameToId!.set(r.short_name.toUpperCase(), r.id)
        }
      }
    } catch { /* leave map empty — every raw guess just won't resolve */ }
  }
  return bookNameToId.get(upper) ?? null
}

function extractionPrompt(question: string): string {
  return `You are a Bible search-term extractor for a KJV/LXX study app. A user asked a question about where to find a passage in Scripture. Your ONLY job is to produce search input for a database — do not answer the question yourself, do not add commentary.

User question: "${question}"

Respond with ONLY a JSON object of this exact shape:
{
  "keywords": ["short phrase or name", "..."],
  "guesses": [{"book": "Genesis", "chapter": 12, "verse": 1}]
}

Rules:
- "keywords": 3-6 short search phrases or proper names (people, places, concepts) likely to appear in the actual verse text. Prefer specific words over generic ones.
- "guesses": 0-5 direct verse references you recall as relevant, if any. Use full English book names. Omit "guesses" (empty array) if unsure — do not fabricate.
- No explanation, no markdown, JSON only.`
}

function commentaryPrompt(question: string, verses: AiLookupResult[]): string {
  const list = verses.slice(0, 12).map((v) => `${v.bookId} ${v.chapter}:${v.verse} — ${v.text}`).join('\n')
  return `A user asked: "${question}"

Here are verses already found and verified against the actual Bible text (do not add, remove, or renumber any of them):
${list}

For each verse above, write ONE brief sentence (max ~20 words) explaining how it relates to the question. Keep it terse — this is a reference tool, not a sermon. Then write a 1-2 sentence overall summary.

Respond with ONLY a JSON object of this exact shape:
{
  "perVerse": {"GEN 12:1": "..."},
  "summary": "..."
}
Keys in "perVerse" must be exactly "BOOKID CHAPTER:VERSE" matching the list above. JSON only, no markdown.`
}

function dedupeKey(r: Pick<AiLookupResult, 'textId' | 'bookId' | 'chapter' | 'verse'>): string {
  return `${r.textId}|${r.bookId}|${r.chapter}|${r.verse}`
}

async function runLookup(question: string, opts: { commentary: boolean; model?: string; textId?: string }): Promise<AiLookupResponse> {
  const model = opts.model || DEFAULT_OLLAMA_MODEL
  const textId = opts.textId || DEFAULT_TEXT_ID

  const { available } = await checkOllamaAvailable()
  if (!available) return { results: [], error: 'ollama-unavailable' }

  let extraction: AiExtraction
  try {
    extraction = await runOllamaJson<AiExtraction>(extractionPrompt(question), model)
  } catch {
    return { results: [], error: 'ollama-request-failed' }
  }

  const seen = new Set<string>()
  const results: AiLookupResult[] = []

  function add(row: { book_id: string; chapter: number; verse_num: number; text: string }, source: ResultSource) {
    const r: AiLookupResult = { textId, bookId: row.book_id, chapter: row.chapter, verse: row.verse_num, text: row.text, source }
    const key = dedupeKey(r)
    if (seen.has(key)) return
    seen.add(key)
    results.push(r)
  }

  // 1. Keyword search via FTS5 — the primary, most trustworthy path.
  for (const kw of (extraction.keywords ?? []).slice(0, 6)) {
    if (results.length >= MAX_RESULTS) break
    const rows = searchVerses(kw, textId, 'phrase')
    const finalRows = rows.length > 0 ? rows : searchVerses(kw, textId, 'all')
    for (const row of finalRows.slice(0, 8)) {
      if (results.length >= MAX_RESULTS) break
      add(row, 'keyword')
    }
  }

  // 2. AI direct guesses — verified against the real DB, dropped if they don't resolve.
  for (const g of (extraction.guesses ?? []).slice(0, 5)) {
    if (results.length >= MAX_RESULTS) break
    const bookId = resolveBookId(g.book)
    if (!bookId) continue
    const verse = queryVerse(bookId, g.chapter, g.verse, textId)
    if (!verse) continue
    add({ book_id: bookId, chapter: g.chapter, verse_num: g.verse, text: verse.text }, 'ai-guess')
  }

  // 3. Cross-reference expansion — for every verse found so far, pull TSK / classic
  // cross-references and merge in their linked verses too.
  const seedRefs = results.slice()
  for (const seed of seedRefs) {
    if (results.length >= MAX_RESULTS) break
    const classic = getCrossRefsForVerse(seed.bookId, seed.chapter, seed.verse)
    for (const ref of classic.refs.slice(0, 4)) {
      if (results.length >= MAX_RESULTS) break
      if (!ref.text) continue
      add({ book_id: ref.bookId, chapter: ref.chapter, verse_num: ref.verse, text: ref.text }, 'cross-ref')
    }
    const tske = getTskeForVerse(seed.bookId, seed.chapter, seed.verse)
    for (const group of tske.groups.slice(0, 2)) {
      if (results.length >= MAX_RESULTS) break
      if (!group.text) continue
      add({ book_id: group.bookId, chapter: group.chapter, verse_num: group.verse, text: group.text }, 'cross-ref')
    }
  }

  if (results.length === 0) return { results: [] }

  // 4. Optional commentary — a second pass over the now-verified, final result set.
  // The model explains; it never gets to introduce a new reference at this stage.
  if (opts.commentary) {
    try {
      const raw = await runOllamaJson<{ perVerse?: Record<string, string>; summary?: string }>(
        commentaryPrompt(question, results), model
      )
      for (const r of results) {
        const key = `${r.bookId} ${r.chapter}:${r.verse}`
        if (raw.perVerse?.[key]) r.commentary = raw.perVerse[key]
      }
      return { results, summary: raw.summary }
    } catch {
      // Commentary is best-effort — a failed second call shouldn't drop the verified verses.
      return { results }
    }
  }

  return { results }
}

interface StoredChat {
  id: string
  title: string
  messages: string // JSON
  created_at: string
  updated_at: string
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  results?: AiLookupResult[]
  summary?: string
  createdAt: string
}

export function registerAiLookupHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('ailookup:checkAvailable', () => checkOllamaAvailable())

  ipcMain.handle('ailookup:query', (_e, question: string, opts: { commentary: boolean; model?: string; textId?: string }) =>
    runLookup(question, opts))

  ipcMain.handle('ailookup:listChats', () => {
    const rows = getBereanDb()
      .prepare('SELECT id, title, created_at, updated_at FROM ai_chats ORDER BY updated_at DESC')
      .all() as Array<{ id: string; title: string; created_at: string; updated_at: string }>
    return rows
  })

  ipcMain.handle('ailookup:getChat', (_e, id: string) => {
    const row = getBereanDb().prepare('SELECT * FROM ai_chats WHERE id = ?').get(id) as StoredChat | undefined
    if (!row) return null
    return { id: row.id, title: row.title, messages: JSON.parse(row.messages) as ChatMessage[], createdAt: row.created_at, updatedAt: row.updated_at }
  })

  ipcMain.handle('ailookup:saveChat', (_e, chat: { id?: string; title: string; messages: ChatMessage[] }) => {
    const db = getBereanDb()
    const now = new Date().toISOString()
    if (chat.id) {
      db.prepare('UPDATE ai_chats SET title = ?, messages = ?, updated_at = ? WHERE id = ?')
        .run(chat.title, JSON.stringify(chat.messages), now, chat.id)
      return { id: chat.id }
    }
    const id = randomUUID()
    db.prepare('INSERT INTO ai_chats (id, title, messages, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, chat.title, JSON.stringify(chat.messages), now, now)
    return { id }
  })

  ipcMain.handle('ailookup:deleteChat', (_e, id: string) => {
    getBereanDb().prepare('DELETE FROM ai_chats WHERE id = ?').run(id)
    return { success: true }
  })
}

// Exported for potential reuse (e.g. a future "explain this verse" entry point
// elsewhere in the app) without going through IPC.
export { runOllamaText }
