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
  bookName: string
  chapter: number
  verse: number
  endVerse?: number
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
  guesses: Array<{ book: string; chapter: number; verse: number; endVerse?: number }>
}

const MAX_RESULTS = 25
// Canonical Bible texts — the only ones the AI's own book/chapter/verse guesses (English
// book names, standard Bible versification) can meaningfully resolve against. Pseudepigrapha
// (Jubilees, Enoch, etc.) each have their own book/chapter shape, so guesses are skipped
// there — only the FTS5 keyword search (step 1) applies to those.
const CANONICAL_TEXT_IDS = new Set(['kjva', 'kjv', 'lxx'])
const DEFAULT_TEXT_ID = 'kjva'

// Aliases a user might type for a specific work, mapped to its textId (see TEXT_FILES in
// electron/db/bible.ts). Checked longest-first against the raw question so "1 enoch" doesn't
// get shadowed by a shorter, unrelated substring. Deliberately covers the texts most likely to
// come up by name in a lookup question — not exhaustive of every text/alias combination.
const TEXT_ALIASES: Array<[string, string]> = [
  ['book of jubilees', 'jubilees'], ['jubilees', 'jubilees'],
  ['1 enoch', 'enoch'], ['book of enoch', 'enoch'], ['enoch', 'enoch'],
  ['septuagint', 'lxx'], ['brenton', 'lxx'], [' lxx', 'lxx'],
  ['shepherd of hermas', 'hermas'], ['hermas', 'hermas'],
  ['epistle of barnabas', 'ep_barnabas'], ['barnabas', 'ep_barnabas'],
  ['first clement', '1clement'], ['1 clement', '1clement'], ['clement', 'recog_clement'],
  ['testaments of the twelve patriarchs', 't12p'], ['twelve patriarchs', 't12p'],
  ['testament of job', 't_job'],
  ['ascension of isaiah', 'asc_isaiah'],
  ['2 baruch', '2baruch'], ['second baruch', '2baruch'],
  ['didache', 'didache_hoole'],
  ['apocalypse of abraham', 'apoc_abraham'],
  ['testament of jacob', 't_jacob'],
]

function detectFocusTextId(question: string): string | null {
  const lower = ` ${question.toLowerCase()} `
  for (const [alias, textId] of TEXT_ALIASES) {
    if (lower.includes(alias)) return textId
  }
  return null
}

// Per-text book id<->name maps, built from that text's own `books` table (each text DB —
// including pseudepigrapha — has one). Cached per textId since it never changes at runtime.
const _bookMaps = new Map<string, { toId: Map<string, string>; toName: Map<string, string> }>()
function getBookMaps(textId: string): { toId: Map<string, string>; toName: Map<string, string> } {
  let maps = _bookMaps.get(textId)
  if (maps) return maps
  maps = { toId: new Map(), toName: new Map() }
  try {
    const db = getTextDb(textId)
    if (db) {
      const rows = db.prepare('SELECT id, name, short_name FROM books').all() as Array<{ id: string; name: string; short_name: string }>
      for (const r of rows) {
        maps.toId.set(r.name.toUpperCase(), r.id)
        maps.toId.set(r.short_name.toUpperCase(), r.id)
        maps.toName.set(r.id, r.name)
      }
    }
  } catch { /* leave maps empty — lookups against this text just won't resolve */ }
  _bookMaps.set(textId, maps)
  return maps
}

function resolveBookId(raw: string, textId: string): string | null {
  const upper = raw.trim().toUpperCase()
  const { toId, toName } = getBookMaps(textId)
  if (toName.has(upper)) return upper // already a valid id for this text
  return toId.get(upper) ?? null
}

function bookNameFor(bookId: string, textId: string): string {
  return getBookMaps(textId).toName.get(bookId) ?? bookId
}

function extractionPrompt(question: string): string {
  return `You are a Bible search-term extractor for a KJV/LXX/pseudepigrapha study app. A user asked a question about where to find a passage in Scripture. Your ONLY job is to produce search input for a database — do not answer the question yourself, do not add commentary.

User question: "${question}"

Respond with ONLY a JSON object of this exact shape:
{
  "keywords": ["short phrase or name", "..."],
  "guesses": [{"book": "Genesis", "chapter": 12, "verse": 1, "endVerse": 3}]
}

Rules:
- "keywords": 3-6 short search phrases or proper names (people, places, concepts) likely to appear in the actual verse text. Prefer specific words over generic ones.
- "guesses": 0-5 direct verse references you recall as relevant, if any. Use full English Bible book names only (not Jubilees/Enoch/etc — those aren't searchable by reference this way). "endVerse" is optional, only include it for a real multi-verse range you recall. Omit "guesses" (empty array) if unsure — do not fabricate.
- No explanation, no markdown, JSON only.`
}

function commentaryPrompt(question: string, verses: AiLookupResult[]): string {
  const list = verses.slice(0, 12).map((v) => `${v.bookId} ${v.chapter}:${v.verse}${v.endVerse ? '-' + v.endVerse : ''} — ${v.text}`).join('\n')
  return `A user asked: "${question}"

Here are verses already found and verified against the actual Bible text (do not add, remove, or renumber any of them):
${list}

For each verse above, write ONE brief sentence (max ~20 words) explaining how it relates to the question. Keep it terse — this is a reference tool, not a sermon. Then write a 1-2 sentence overall summary.

Respond with ONLY a JSON object of this exact shape:
{
  "perVerse": {"GEN 12:1": "..."},
  "summary": "..."
}
Keys in "perVerse" must be exactly "BOOKID CHAPTER:VERSE" (the start verse only, matching the list above). JSON only, no markdown.`
}

function dedupeKey(r: Pick<AiLookupResult, 'textId' | 'bookId' | 'chapter' | 'verse'>): string {
  return `${r.textId}|${r.bookId}|${r.chapter}|${r.verse}`
}

async function runLookup(question: string, opts: { commentary: boolean; model?: string; textId?: string }): Promise<AiLookupResponse> {
  const model = opts.model || DEFAULT_OLLAMA_MODEL

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

  function add(textId: string, row: { book_id: string; chapter: number; verse_num: number; verse_end?: number; text: string }, source: ResultSource) {
    const r: AiLookupResult = {
      textId, bookId: row.book_id, bookName: bookNameFor(row.book_id, textId),
      chapter: row.chapter, verse: row.verse_num, endVerse: row.verse_end, text: row.text, source,
    }
    const key = dedupeKey(r)
    if (seen.has(key)) return
    seen.add(key)
    results.push(r)
  }

  // Text-focused search: a question naming a specific work (e.g. "in Jubilees...") searches
  // that text FIRST — its results come first in the list — then falls back to also searching
  // the default (kjva) as secondary results, so a focused question still surfaces related
  // canonical cross-references afterward instead of only ever searching kjva.
  const explicitFocus = opts.textId && opts.textId !== DEFAULT_TEXT_ID ? opts.textId : null
  const focusTextId = explicitFocus ?? detectFocusTextId(question)
  const textPasses = focusTextId && focusTextId !== DEFAULT_TEXT_ID
    ? [focusTextId, DEFAULT_TEXT_ID]
    : [DEFAULT_TEXT_ID]

  for (const textId of textPasses) {
    if (results.length >= MAX_RESULTS) break
    const db = getTextDb(textId)
    if (!db) continue

    // 1. Keyword search via FTS5 — the primary, most trustworthy path, works for any text.
    for (const kw of (extraction.keywords ?? []).slice(0, 6)) {
      if (results.length >= MAX_RESULTS) break
      const rows = searchVerses(kw, textId, 'phrase')
      const finalRows = rows.length > 0 ? rows : searchVerses(kw, textId, 'all')
      for (const row of finalRows.slice(0, 8)) {
        if (results.length >= MAX_RESULTS) break
        add(textId, { book_id: row.book_id, chapter: row.chapter, verse_num: row.verse_num, text: row.text }, 'keyword')
      }
    }

    // 2. AI direct guesses — only meaningful for canonical Bible texts (see CANONICAL_TEXT_IDS);
    // verified against the real DB and dropped if they don't resolve. Ranges (endVerse) are
    // fetched verse-by-verse and joined into a single result.
    if (CANONICAL_TEXT_IDS.has(textId)) {
      for (const g of (extraction.guesses ?? []).slice(0, 5)) {
        if (results.length >= MAX_RESULTS) break
        const bookId = resolveBookId(g.book, textId)
        if (!bookId) continue
        const endVerse = g.endVerse && g.endVerse > g.verse ? Math.min(g.endVerse, g.verse + 20) : undefined
        if (endVerse) {
          const parts: string[] = []
          for (let v = g.verse; v <= endVerse; v++) {
            const verse = queryVerse(bookId, g.chapter, v, textId)
            if (verse) parts.push(verse.text)
          }
          if (parts.length === 0) continue
          add(textId, { book_id: bookId, chapter: g.chapter, verse_num: g.verse, verse_end: endVerse, text: parts.join(' ') }, 'ai-guess')
        } else {
          const verse = queryVerse(bookId, g.chapter, g.verse, textId)
          if (!verse) continue
          add(textId, { book_id: bookId, chapter: g.chapter, verse_num: g.verse, text: verse.text }, 'ai-guess')
        }
      }
    }
  }

  // 3. Cross-reference expansion — TSK / classic cross-references are keyed to standard Bible
  // book ids, so only expand from canonical-text seeds (pseudepigrapha seeds are skipped; the
  // lookups would just come back empty for them anyway, but this avoids the wasted queries).
  const seedRefs = results.filter((r) => CANONICAL_TEXT_IDS.has(r.textId)).slice()
  for (const seed of seedRefs) {
    if (results.length >= MAX_RESULTS) break
    const classic = getCrossRefsForVerse(seed.bookId, seed.chapter, seed.verse)
    for (const ref of classic.refs.slice(0, 4)) {
      if (results.length >= MAX_RESULTS) break
      if (!ref.text) continue
      add(seed.textId, { book_id: ref.bookId, chapter: ref.chapter, verse_num: ref.verse, text: ref.text }, 'cross-ref')
    }
    const tske = getTskeForVerse(seed.bookId, seed.chapter, seed.verse)
    for (const group of tske.groups.slice(0, 2)) {
      for (const ref of group.refs.slice(0, 2)) {
        if (results.length >= MAX_RESULTS) break
        if (!ref.text) continue
        add(seed.textId, { book_id: ref.bookId, chapter: ref.chapter, verse_num: ref.verse, text: ref.text }, 'cross-ref')
      }
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
