import type { IpcMain } from 'electron'
import { BrowserWindow } from 'electron'
import Database from 'better-sqlite3'
import { getBereanDb } from '../db/berean'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ESwordProgress {
  phase: 'idle' | 'reading' | 'review' | 'saving' | 'done' | 'error'
  done: number
  total: number
  message: string
  reviewNotes?: ESwordReviewNote[]
}

export interface ESwordReviewNote {
  id: string
  type: 'verse' | 'topic' | 'daily'
  title: string
  passage?: string   // verse_ref for verse type
  body: string
  createdAt: number
  status: 'new' | 'updated' | 'duplicate'
  existingId?: string
}

// ── Constants ──────────────────────────────────────────────────────────────────

const LOG = (..._args: unknown[]) => {}

// Berean book IDs → full English names (for human-readable titles)
const BEREAN_ID_TO_NAME: Record<string, string> = {
  GEN:'Genesis', EXO:'Exodus', LEV:'Leviticus', NUM:'Numbers', DEU:'Deuteronomy',
  JOS:'Joshua', JDG:'Judges', RUT:'Ruth', '1SA':'1 Samuel', '2SA':'2 Samuel',
  '1KI':'1 Kings', '2KI':'2 Kings', '1CH':'1 Chronicles', '2CH':'2 Chronicles',
  EZR:'Ezra', NEH:'Nehemiah', EST:'Esther', JOB:'Job', PSA:'Psalms',
  PRO:'Proverbs', ECC:'Ecclesiastes', SNG:'Song of Solomon',
  ISA:'Isaiah', JER:'Jeremiah', LAM:'Lamentations', EZK:'Ezekiel', DAN:'Daniel',
  HOS:'Hosea', JOL:'Joel', AMO:'Amos', OBA:'Obadiah', JON:'Jonah', MIC:'Micah',
  NAM:'Nahum', HAB:'Habakkuk', ZEP:'Zephaniah', HAG:'Haggai', ZEC:'Zechariah',
  MAL:'Malachi', MAT:'Matthew', MRK:'Mark', LUK:'Luke', JHN:'John',
  ACT:'Acts', ROM:'Romans', '1CO':'1 Corinthians', '2CO':'2 Corinthians',
  GAL:'Galatians', EPH:'Ephesians', PHP:'Philippians', COL:'Colossians',
  '1TH':'1 Thessalonians', '2TH':'2 Thessalonians', '1TI':'1 Timothy', '2TI':'2 Timothy',
  TIT:'Titus', PHM:'Philemon', HEB:'Hebrews', JAS:'James',
  '1PE':'1 Peter', '2PE':'2 Peter', '1JN':'1 John', '2JN':'2 John', '3JN':'3 John',
  JUD:'Jude', REV:'Revelation',
}

function bereanRefToTitle(bookId: string, chapter: number, verse: number): string {
  const name = BEREAN_ID_TO_NAME[bookId] ?? bookId
  return `${name} ${chapter}:${verse}`
}

function isoDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Standard e-Sword book numbers → Berean book IDs (from kjva.db books table)
const ESWORD_BOOK_MAP: Record<number, string> = {
  1: 'GEN', 2: 'EXO', 3: 'LEV', 4: 'NUM', 5: 'DEU', 6: 'JOS', 7: 'JDG', 8: 'RUT',
  9: '1SA', 10: '2SA', 11: '1KI', 12: '2KI', 13: '1CH', 14: '2CH', 15: 'EZR',
  16: 'NEH', 17: 'EST', 18: 'JOB', 19: 'PSA', 20: 'PRO', 21: 'ECC', 22: 'SNG',
  23: 'ISA', 24: 'JER', 25: 'LAM', 26: 'EZK', 27: 'DAN', 28: 'HOS', 29: 'JOL',
  30: 'AMO', 31: 'OBA', 32: 'JON', 33: 'MIC', 34: 'NAM', 35: 'HAB', 36: 'ZEP',
  37: 'HAG', 38: 'ZEC', 39: 'MAL', 40: 'MAT', 41: 'MRK', 42: 'LUK', 43: 'JHN',
  44: 'ACT', 45: 'ROM', 46: '1CO', 47: '2CO', 48: 'GAL', 49: 'EPH', 50: 'PHP',
  51: 'COL', 52: '1TH', 53: '2TH', 54: '1TI', 55: '2TI', 56: 'TIT', 57: 'PHM',
  58: 'HEB', 59: 'JAS', 60: '1PE', 61: '2PE', 62: '1JN', 63: '2JN', 64: '3JN',
  65: 'JUD', 66: 'REV',
}

// ── RTF hyperlink pre-processor ────────────────────────────────────────────────
// Converts RTF \field HYPERLINK groups to Markdown [text](url) before stripping.
// Handles the standard e-Sword pattern:
//   {\field{\*\fldinst HYPERLINK "url"}{\fldrslt display text}}
// One level of nested braces inside fldrslt is supported (e.g. formatting runs).
function preprocessHyperlinks(rtf: string): string {
  return rtf.replace(
    /\{\\field(?:[^{}]|\{[^{}]*\})*?HYPERLINK\s+"([^"]+)"(?:[^{}]|\{[^{}]*\})*?\{\\fldrslt((?:[^{}]|\{[^{}]*\})*)\}(?:[^{}]|\{[^{}]*\})*\}/g,
    (_match: string, url: string, rawDisplay: string) => {
      // Strip RTF control words and braces from display text
      const text = rawDisplay
        .replace(/\\[a-zA-Z]+-?\d*\s?/g, '')
        .replace(/[{}]/g, '')
        .trim()
      return text ? `[${text}](${url})` : url
    }
  )
}

// ── RTF stripper ───────────────────────────────────────────────────────────────

// Windows-1252 code points 0x80–0x9F that differ from Unicode
const CP1252: Record<number, number> = {
  0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6, 0x89: 0x2030, 0x8A: 0x0160,
  0x8B: 0x2039, 0x8C: 0x0152, 0x8E: 0x017D, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A, 0x9C: 0x0153,
  0x9E: 0x017E, 0x9F: 0x0178,
}

function cp1252Char(hex: string): string {
  const code = parseInt(hex, 16)
  if (isNaN(code)) return ''
  return String.fromCharCode(CP1252[code] ?? code)
}

function stripRtf(rtf: string): string {
  if (!rtf || typeof rtf !== 'string') return ''
  const trimmed = rtf.trimStart()
  if (!trimmed.startsWith('{\\rtf')) return rtf

  // Convert hyperlinks to Markdown before character-by-character stripping
  const withLinks = preprocessHyperlinks(trimmed)

  let result = ''
  let i = 0
  let depth = 0
  let skipDepth = -1

  const IGNORABLE = new Set(['fonttbl', 'colortbl', 'stylesheet', 'info', 'pict',
    'fldinst', 'fldtype', 'lsdstyles', 'themedata', 'colorschememapping',
    'datastore', 'wgrffmtfilter'])

  while (i < withLinks.length) {
    const ch = withLinks[i]

    if (ch === '{') {
      depth++
      // Only detect new skip groups when not already inside a skip group —
      // prevents nested {\* \panose...} from overwriting the outer fonttbl's skipDepth
      if (skipDepth < 0) {
        if (withLinks[i + 1] === '\\' && withLinks[i + 2] === '*') {
          skipDepth = depth
        } else if (withLinks[i + 1] === '\\') {
          let j = i + 2
          let name = ''
          while (j < withLinks.length && /[a-z]/.test(withLinks[j])) { name += withLinks[j]; j++ }
          if (IGNORABLE.has(name)) skipDepth = depth
        }
      }
      i++
    } else if (ch === '}') {
      if (skipDepth === depth) skipDepth = -1
      depth--
      i++
    } else if (ch === '\\') {
      i++
      if (i >= withLinks.length) break
      const nc = withLinks[i]

      if (nc === '\\' || nc === '{' || nc === '}') {
        if (skipDepth < 0) result += nc
        i++
      } else if (nc === '\'') {
        // Hex-encoded character \'xx (Windows-1252)
        i++
        const hex = withLinks.slice(i, i + 2)
        if (skipDepth < 0) result += cp1252Char(hex)
        i += 2
      } else if (nc === '\n' || nc === '\r') {
        if (skipDepth < 0) result += '\n'
        i++
      } else if (nc === '~') {
        if (skipDepth < 0) result += ' '
        i++
      } else if (nc === '-' || nc === '_') {
        i++
      } else if (nc === '*') {
        i++
      } else if (/[a-zA-Z]/.test(nc)) {
        let word = ''
        while (i < withLinks.length && /[a-zA-Z]/.test(withLinks[i])) { word += withLinks[i]; i++ }
        let param = ''
        let negative = false
        if (i < trimmed.length && withLinks[i] === '-') { negative = true; i++ }
        while (i < withLinks.length && /[0-9]/.test(withLinks[i])) { param += withLinks[i]; i++ }
        if (i < trimmed.length && withLinks[i] === ' ') i++ // consume space delimiter

        if (skipDepth < 0) {
          if (word === 'par' || word === 'sect') result += '\n'
          else if (word === 'line') result += '\n'
          else if (word === 'tab') result += '\t'
          else if (word === 'u' && param) {
            const code = negative ? -parseInt(param) : parseInt(param)
            result += String.fromCharCode(code < 0 ? code + 65536 : code)
            // Skip ANSI fallback char
            if (i < trimmed.length && withLinks[i] !== '\\' && withLinks[i] !== '}' && withLinks[i] !== '{') i++
          }
          // All other control words (loch, hich, dbch, af, ai, cf, b, i, fs, etc.) are formatting — skip
        }
      } else {
        i++
      }
    } else {
      if (skipDepth < 0) result += ch
      i++
    }
  }

  return result
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ── e-Sword verse ref abbreviation → full book name ────────────────────────────

const ESWORD_ABBR_MAP: Record<string, string> = {
  Gen: 'Genesis', Exo: 'Exodus', Lev: 'Leviticus', Num: 'Numbers', Deu: 'Deuteronomy',
  Jos: 'Joshua', Jdg: 'Judges', Rut: 'Ruth', '1Sa': '1 Samuel', '2Sa': '2 Samuel',
  '1Ki': '1 Kings', '2Ki': '2 Kings', '1Ch': '1 Chronicles', '2Ch': '2 Chronicles',
  Ezr: 'Ezra', Neh: 'Nehemiah', Est: 'Esther', Job: 'Job', Psa: 'Psalms',
  Pro: 'Proverbs', Ecc: 'Ecclesiastes', Sng: 'Song of Solomon',
  Isa: 'Isaiah', Jer: 'Jeremiah', Lam: 'Lamentations', Eze: 'Ezekiel', Dan: 'Daniel',
  Hos: 'Hosea', Joe: 'Joel', Amo: 'Amos', Oba: 'Obadiah', Jon: 'Jonah', Mic: 'Micah',
  Nah: 'Nahum', Hab: 'Habakkuk', Zep: 'Zephaniah', Hag: 'Haggai', Zec: 'Zechariah',
  Mal: 'Malachi', Mat: 'Matthew', Mar: 'Mark', Luk: 'Luke', Joh: 'John',
  Act: 'Acts', Rom: 'Romans', '1Co': '1 Corinthians', '2Co': '2 Corinthians',
  Gal: 'Galatians', Eph: 'Ephesians', Php: 'Philippians', Col: 'Colossians',
  '1Th': '1 Thessalonians', '2Th': '2 Thessalonians', '1Ti': '1 Timothy', '2Ti': '2 Timothy',
  Tit: 'Titus', Phm: 'Philemon', Heb: 'Hebrews', Jas: 'James',
  '1Pe': '1 Peter', '2Pe': '2 Peter', '1Jo': '1 John', '2Jo': '2 John', '3Jo': '3 John',
  Jde: 'Jude', Rev: 'Revelation',
}

// Convert Exo_17:6 or 2Pe_3:16 → Exodus 17:6 / 2 Peter 3:16
function expandVerseRefs(text: string): string {
  return text.replace(
    /\b([1-3]?[A-Z][a-z]{1,2})_(\d+:\d+(?:-\d+)?)\b/g,
    (_match: string, abbr: string, ref: string) => {
      const full = ESWORD_ABBR_MAP[abbr]
      return full ? `${full} ${ref}` : `${abbr} ${ref}`
    }
  )
}

// ── OLE Automation date → Unix timestamp (ms) ─────────────────────────────────

function oleToMs(oaDate: number): number {
  // OLE date: days since Dec 30, 1899 (midnight local time)
  const epochMs = new Date(1899, 11, 30).getTime()
  return epochMs + oaDate * 24 * 60 * 60 * 1000
}

// ── Auto-detect e-Sword folder ─────────────────────────────────────────────────

export function detectESwordFolder(): string | null {
  const home = homedir()
  const candidates = [
    join(home, 'Library', 'CloudStorage', 'OneDrive-Personal', 'Documents', 'e-Sword'),
    join(home, 'OneDrive', 'Documents', 'e-Sword'),
    join(home, 'Documents', 'e-Sword'),
    join(home, 'Desktop', 'e-Sword'),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

// ── Read helpers ───────────────────────────────────────────────────────────────

interface RawVerseRow  { Book: number; Chapter: number; Verse: number; Notes: string }
interface RawTopicRow  { Title: string; Notes: string }
interface RawDateRow   { Date: number; Notes: string }

function readStudyNotes(folder: string): Array<{ bookId: string; chapter: number; verse: number; body: string; displayTitle: string }> {
  const path = join(folder, 'study.notx')
  if (!existsSync(path)) return []
  let db: InstanceType<typeof Database> | null = null
  try {
    db = new Database(path, { readonly: true, fileMustExist: true })
    const rows = db.prepare('SELECT Book, Chapter, Verse, Notes FROM Verses').all() as RawVerseRow[]
    const out: Array<{ bookId: string; chapter: number; verse: number; body: string; displayTitle: string }> = []
    for (const row of rows) {
      const bookId = ESWORD_BOOK_MAP[row.Book]
      if (!bookId) continue
      const body = expandVerseRefs(stripRtf(row.Notes))
      if (!body.trim()) continue
      out.push({ bookId, chapter: row.Chapter, verse: row.Verse, body, displayTitle: bereanRefToTitle(bookId, row.Chapter, row.Verse) })
    }
    return out
  } finally {
    db?.close()
  }
}

function readTopicNotes(folder: string): Array<{ title: string; body: string }> {
  const path = join(folder, 'topic.topx')
  if (!existsSync(path)) return []
  let db: InstanceType<typeof Database> | null = null
  try {
    db = new Database(path, { readonly: true, fileMustExist: true })
    const rows = db.prepare('SELECT Title, Notes FROM Topics').all() as RawTopicRow[]
    const out: Array<{ title: string; body: string }> = []
    for (const row of rows) {
      const body = expandVerseRefs(stripRtf(row.Notes))
      if (!body.trim()) continue
      out.push({ title: row.Title || 'Untitled Topic', body })
    }
    return out
  } finally {
    db?.close()
  }
}

function readJournalNotes(folder: string): Array<{ date: number; body: string }> {
  const path = join(folder, 'journal.jnlx')
  if (!existsSync(path)) return []
  let db: InstanceType<typeof Database> | null = null
  try {
    db = new Database(path, { readonly: true, fileMustExist: true })
    const rows = db.prepare('SELECT Date, Notes FROM Dates').all() as RawDateRow[]
    const out: Array<{ date: number; body: string }> = []
    for (const row of rows) {
      const body = expandVerseRefs(stripRtf(row.Notes))
      if (!body.trim()) continue
      out.push({ date: oleToMs(row.Date), body })
    }
    return out
  } finally {
    db?.close()
  }
}

// ── Categorize: compare against existing esword notes ─────────────────────────

interface CandidateNote {
  type: 'verse' | 'topic' | 'daily'
  title: string
  passage?: string
  body: string
  createdAt: number
}

function categorize(candidates: CandidateNote[]): ESwordReviewNote[] {
  const db = getBereanDb()
  const rows = db.prepare(`
    SELECT id, type, title, verse_ref, content FROM notes WHERE tags LIKE '%"esword"%'
  `).all() as Array<{ id: string; type: string; title: string | null; verse_ref: string | null; content: string }>

  // Build lookup: key → [{ id, core }]
  const byKey = new Map<string, { id: string; core: string }[]>()
  for (const row of rows) {
    const key = row.verse_ref ?? row.title ?? ''
    const core = row.content
      .replace(/\n\n---\n\*Imported from e-Sword[^*]*\*\s*$/s, '')
      .trim()
    const list = byKey.get(key) ?? []
    list.push({ id: row.id, core })
    byKey.set(key, list)
  }

  return candidates.map(c => {
    const key = c.passage ?? c.title
    const existing = key ? byKey.get(key) : undefined

    if (!existing?.length) {
      return { id: randomUUID(), type: c.type, title: c.title, passage: c.passage, body: c.body, createdAt: c.createdAt, status: 'new' as const }
    }
    const dup = existing.find(e => e.core === c.body.trim())
    if (dup) {
      return { id: randomUUID(), type: c.type, title: c.title, passage: c.passage, body: c.body, createdAt: c.createdAt, status: 'duplicate' as const, existingId: dup.id }
    }
    return { id: randomUUID(), type: c.type, title: c.title, passage: c.passage, body: c.body, createdAt: c.createdAt, status: 'updated' as const, existingId: existing[0].id }
  })
}

// ── Save selected notes ────────────────────────────────────────────────────────

function saveNotes(
  notes: ESwordReviewNote[],
  onProgress: (done: number, total: number) => void
): { imported: number; updated: number } {
  const db = getBereanDb()
  const nowMs = Date.now()
  let imported = 0, updated = 0

  const insert = db.prepare(`
    INSERT INTO notes (id, type, title, content, verse_ref, color, created_at, updated_at, tags, imported_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const update = db.prepare(`
    UPDATE notes SET content = ?, updated_at = ? WHERE id = ?
  `)

  const toProcess = notes.filter(n => n.status !== 'duplicate')

  db.transaction(() => {
    for (const note of toProcess) {
      const content = note.body.trim()

      if (note.status === 'updated' && note.existingId) {
        update.run(content, nowMs, note.existingId)
        updated++
      } else {
        // created_at = import time (not the original e-Sword note date); imported_at records the same
        const bereanType = note.type === 'verse' ? 'verse' : note.type === 'daily' ? 'daily' : 'general'
        insert.run(
          `esw-${randomUUID()}`,
          bereanType,
          note.title,
          content,
          note.passage ?? null,
          'blue',
          nowMs,
          nowMs,
          JSON.stringify(['esword']),
          nowMs
        )
        imported++
      }
      onProgress(imported + updated, toProcess.length)
    }
  })()

  return { imported, updated }
}

// ── Cancel flag ────────────────────────────────────────────────────────────────

let cancelFlag = false

// ── Register handlers ──────────────────────────────────────────────────────────

export function registerESwordImportHandlers(
  ipcMain: IpcMain,
  getMainWindow: () => BrowserWindow | null
): void {
  function send(p: ESwordProgress) {
    getMainWindow()?.webContents.send('eSwordImport:progress', p)
  }

  ipcMain.handle('eSwordImport:detectFolder', () => detectESwordFolder())

  ipcMain.handle('eSwordImport:start', async (_e, opts: { folder: string; study: boolean; topics: boolean; journal: boolean }) => {
    LOG('eSwordImport:start', opts)
    cancelFlag = false

    const { folder, study, topics, journal } = opts
    if (!existsSync(folder)) {
      send({ phase: 'error', done: 0, total: 0, message: 'Folder not found: ' + folder })
      return { success: false, error: 'Folder not found' }
    }

    try {
      send({ phase: 'reading', done: 0, total: 0, message: 'Reading e-Sword files…' })

      const candidates: CandidateNote[] = []
      const now = Date.now()

      if (study) {
        send({ phase: 'reading', done: 0, total: 0, message: 'Reading study notes (study.notx)…' })
        const rows = readStudyNotes(folder)
        for (const r of rows) {
          const passage = `${r.bookId}.${r.chapter}.${r.verse}`
          candidates.push({ type: 'verse', title: r.displayTitle, passage, body: r.body, createdAt: now })
        }
        LOG(`Read ${rows.length} study notes`)
      }

      if (topics) {
        send({ phase: 'reading', done: candidates.length, total: 0, message: 'Reading topic notes (topic.topx)…' })
        const rows = readTopicNotes(folder)
        for (const r of rows) {
          candidates.push({ type: 'topic', title: r.title, body: r.body, createdAt: now })
        }
        LOG(`Read ${rows.length} topic notes`)
      }

      if (journal) {
        send({ phase: 'reading', done: candidates.length, total: 0, message: 'Reading journal notes (journal.jnlx)…' })
        const rows = readJournalNotes(folder)
        for (const r of rows) {
          const d = new Date(r.date)
          const title = `Daily — ${isoDateStr(d)}`
          candidates.push({ type: 'daily', title, body: r.body, createdAt: r.date })
        }
        LOG(`Read ${rows.length} journal notes`)
      }

      if (candidates.length === 0) {
        send({ phase: 'done', done: 0, total: 0, message: 'No notes found in selected files.' })
        return { success: true }
      }

      send({ phase: 'reading', done: candidates.length, total: candidates.length, message: `Found ${candidates.length} notes — checking for duplicates…` })

      const reviewNotes = categorize(candidates)
      const newCount = reviewNotes.filter(n => n.status === 'new').length
      const updatedCount = reviewNotes.filter(n => n.status === 'updated').length
      const dupCount = reviewNotes.filter(n => n.status === 'duplicate').length

      send({
        phase: 'review',
        done: candidates.length,
        total: candidates.length,
        message: `${newCount} new · ${updatedCount} updated · ${dupCount} already imported`,
        reviewNotes,
      })

      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      LOG('eSwordImport:start error:', msg)
      send({ phase: 'error', done: 0, total: 0, message: msg })
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('eSwordImport:importSelected', (_e, selected: ESwordReviewNote[]) => {
    LOG(`eSwordImport:importSelected — ${selected.length} notes`)
    if (!selected?.length) {
      send({ phase: 'done', done: 0, total: 0, message: 'No notes selected.' })
      return { success: true, imported: 0, updated: 0 }
    }
    try {
      send({ phase: 'saving', done: 0, total: selected.length, message: `Saving ${selected.length} notes…` })
      const { imported, updated } = saveNotes(selected, (done, total) => {
        send({ phase: 'saving', done, total, message: `Saving… ${done}/${total}` })
      })
      const parts = []
      if (imported > 0) parts.push(`${imported} imported`)
      if (updated > 0) parts.push(`${updated} updated`)
      send({ phase: 'done', done: imported + updated, total: selected.length, message: `Done — ${parts.join(', ')}` })
      return { success: true, imported, updated }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      send({ phase: 'error', done: 0, total: 0, message: msg })
      return { success: false, error: msg }
    }
  })

  ipcMain.handle('eSwordImport:cancel', () => { cancelFlag = true })
}
