import type { IpcMain } from 'electron'
import { BrowserWindow, app } from 'electron'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, copyFileSync, unlinkSync } from 'fs'
import { join, extname, basename } from 'path'
import chokidar from 'chokidar'
import { getBereanDb } from '../db/berean'
import { getTextDb } from '../db/bible'
import { getResourceMode } from '../powerAwareness'

function getVaultPath(): string {
  const row = getBereanDb().prepare('SELECT value FROM settings WHERE key = ?').get('vaultPath') as { value: string } | undefined
  if (!row) return ''
  const val = JSON.parse(row.value) as string
  return typeof val === 'string' ? val : ''
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

// Build a map: folder_id → full relative path (e.g. "Old Testament/Genesis")
function buildFolderPathMap(): Map<string, string> {
  const db = getBereanDb()
  const folders = db.prepare('SELECT id, name, parent_id FROM note_folders').all() as Array<{ id: string; name: string; parent_id: string | null }>
  const byId = new Map(folders.map(f => [f.id, f]))
  const cache = new Map<string, string>()
  function getPath(id: string): string {
    if (cache.has(id)) return cache.get(id)!
    const f = byId.get(id)
    if (!f) return ''
    const path = f.parent_id ? `${getPath(f.parent_id)}/${f.name}` : f.name
    cache.set(id, path)
    return path
  }
  for (const f of folders) getPath(f.id)
  return cache
}

// Resolve the vault directory for a note (mirrors the user's Berean folder hierarchy).
// Notes without a folder go to the vault root.
function getNoteExportDir(note: { folder_id?: string | null }, vaultPath: string, folderPathMap: Map<string, string>): string {
  if (note.folder_id) {
    const rel = folderPathMap.get(note.folder_id)
    if (rel) return join(vaultPath, rel)
  }
  return vaultPath
}

// Recursively collect .md file paths under dir, skipping hidden directories.
function scanMdFiles(dir: string, depth = 0): string[] {
  if (depth > 10 || !existsSync(dir)) return []
  const results: string[] = []
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        results.push(...scanMdFiles(join(dir, entry.name), depth + 1))
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        results.push(join(dir, entry.name))
      }
    }
  } catch { /* skip unreadable */ }
  return results
}

// Static book-name map mirroring parseRef.ts so vault folder names match Berean's note titles.
const BOOK_ID_TO_NAME: Record<string, string> = {
  GEN:'Genesis', EXO:'Exodus', LEV:'Leviticus', NUM:'Numbers', DEU:'Deuteronomy',
  JOS:'Joshua', JDG:'Judges', RUT:'Ruth',
  '1SA':'1 Samuel', '2SA':'2 Samuel', '1KI':'1 Kings', '2KI':'2 Kings',
  '1CH':'1 Chronicles', '2CH':'2 Chronicles',
  EZR:'Ezra', NEH:'Nehemiah', JOB:'Job', PSA:'Psalms', PRO:'Proverbs',
  ECC:'Ecclesiastes', SNG:'Song of Songs', ISA:'Isaiah', JER:'Jeremiah',
  LAM:'Lamentations', EZK:'Ezekiel', DAN:'Daniel', HOS:'Hosea', JOL:'Joel',
  AMO:'Amos', OBA:'Obadiah', JON:'Jonah', MIC:'Micah', NAM:'Nahum',
  HAB:'Habakkuk', ZEP:'Zephaniah', HAG:'Haggai', ZEC:'Zechariah', MAL:'Malachi',
  MAT:'Matthew', MRK:'Mark', LUK:'Luke', JHN:'John', ACT:'Acts', ROM:'Romans',
  '1CO':'1 Corinthians', '2CO':'2 Corinthians', GAL:'Galatians', EPH:'Ephesians',
  PHP:'Philippians', COL:'Colossians',
  '1TH':'1 Thessalonians', '2TH':'2 Thessalonians',
  '1TI':'1 Timothy', '2TI':'2 Timothy', TIT:'Titus', PHM:'Philemon',
  HEB:'Hebrews', JAS:'James', '1PE':'1 Peter', '2PE':'2 Peter',
  '1JN':'1 John', '2JN':'2 John', '3JN':'3 John', JUD:'Jude', REV:'Revelation',
  TOB:'Tobit', JDT:'Judith', WIS:'Wisdom of Solomon', SIR:'Sirach', BAR:'Baruch',
  '1MA':'1 Maccabees', '2MA':'2 Maccabees', '3MA':'3 Maccabees', '4MA':'4 Maccabees',
  ESG:'Esther (Greek)', SUS:'Susanna', BEL:'Bel and the Dragon',
  PRA:'Prayer of Azariah', PRM:'Prayer of Manasseh',
  LJE:'Letter of Jeremiah', PSS:'Psalms of Solomon',
  '1ES':'1 Esdras', '2ES':'2 Esdras',
  ENO:'1 Enoch', JUB:'Jubilees',
  AEL:'Apocalypse of Elijah', ABR:'Apocalypse of Abraham',
  AIS:'Ascension of Isaiah', EPB:'Epistle of Barnabas',
  GAD:'Gad the Seer', '1CL':'1 Clement', TJOB:'Testament of Job',
  TASH:'Testament of Asher', TBEN:'Testament of Benjamin', TDAN:'Testament of Dan',
  TGAD:'Testament of Gad', TISS:'Testament of Issachar', TJOS:'Testament of Joseph',
  TJUD:'Testament of Judah', TLEV:'Testament of Levi', TNAP:'Testament of Naphtali',
  TREU:'Testament of Reuben', TSIM:'Testament of Simeon', TZEB:'Testament of Zebulun',
  HER_MAN:'Shepherd of Hermas — Mandates', HER_SIM:'Shepherd of Hermas — Similitudes', HER_VIS:'Shepherd of Hermas — Visions',
  RCL1:'Recognitions of Clement — Book I', RCL2:'Recognitions of Clement — Book II',
  RCL3:'Recognitions of Clement — Book III', RCL4:'Recognitions of Clement — Book IV',
  RCL5:'Recognitions of Clement — Book V', RCL6:'Recognitions of Clement — Book VI',
  RCL7:'Recognitions of Clement — Book VII', RCL8:'Recognitions of Clement — Book VIII',
  RCL9:'Recognitions of Clement — Book IX', RCL10:'Recognitions of Clement — Book X',
}

function getBookDisplayName(bookId: string): string {
  return BOOK_ID_TO_NAME[bookId] ?? bookId
}

// ─── Color system ─────────────────────────────────────────────────────────────
// Octarine identifies note colors by colored-circle emoji in the `color:` field.

const OCTARINE_COLOR_EMOJI: Record<string, string> = {
  yellow: '🟡', orange: '🟠', amber:  '🟡',
  red:    '🔴', rose:   '🔴', pink:   '💗',
  violet: '🟣', purple: '🟣', indigo: '🔵',
  blue:   '🔵', sky:    '🔵', cyan:   '🔵',
  teal:   '🟢', green:  '🟢', lime:   '🟢',
}

const EMOJI_TO_COLOR: Record<string, string> = {
  '🟡': 'yellow', '🟠': 'orange', '🔴': 'red',
  '🟢': 'green',  '🔵': 'blue',   '🟣': 'purple',
  '💗': 'pink',   '🩷': 'pink',
}

function toOctarineEmoji(color: string | null | undefined): string {
  return OCTARINE_COLOR_EMOJI[color ?? 'blue'] ?? '🔵'
}

// Handle both legacy text colors ("blue") and emoji colors ("🔵") from vault files.
function parseVaultColor(raw: string | null | undefined): string {
  if (!raw) return 'blue'
  return EMOJI_TO_COLOR[raw.trim()] ?? raw.trim()
}

// ─── Note serialization ────────────────────────────────────────────────────────

export type NoteRow = {
  id: string; type: string; title: string | null; content: string;
  verse_ref: string | null; color: string; status?: string | null; created_at: number; updated_at: number;
  tags: string; folder_id?: string | null
}

// overrideColor: verse highlight color (takes precedence over note.color for Octarine dot)
// highlightedVerseText: pre-formatted verse text with ==emoji== spans (embedded for Octarine display)
export function noteToMarkdown(note: NoteRow, overrideColor?: string, highlightedVerseText?: string): string {
  const tags = JSON.parse(note.tags || '[]') as string[]
  const createdIso = new Date(note.created_at).toISOString()
  const updatedIso = new Date(note.updated_at).toISOString()
  const isVerseType = ['verse', 'esword', 'biblegateway'].includes(note.type)
  const typeLabel = isVerseType ? 'verse-note' : note.type === 'daily' ? 'daily-note' : 'general-note'

  // Color: only include when explicitly set (not null / not default blue)
  const effectiveColor = overrideColor ?? note.color
  const colorLine = (effectiveColor && effectiveColor !== 'blue')
    ? `color: ${toOctarineEmoji(effectiveColor)}`
    : null

  // One-way export only (status is a purely in-app organizational field — editing this line
  // in Obsidian/Octarine does not flow back into Berean; see vault:watch/vault:reconcile,
  // which only ever read berean_id + body content from external edits).
  const statusLine = note.status ? `status: ${note.status}` : null

  // Verse-specific properties derived from verse_ref / title
  let verseProps: (string | null)[] = []
  let displayTitle = note.title ?? 'Untitled'
  if (isVerseType && note.verse_ref) {
    const parts = note.verse_ref.split('.')
    const bookId = parts[0] ?? ''
    const chapter = parts[1] ?? ''
    const bookDisplay = getBookDisplayName(bookId)
    const verseNum = parts[2] ?? ''
    const ref = `${bookDisplay} ${chapter}:${verseNum}`
    displayTitle = ref
    verseProps = [
      `verse: "[[${ref}]]"`,
      `book: ${bookDisplay}`,
      `chapter: ${chapter}`,
    ]
  }

  // Date property for daily notes
  const dateMatch = note.type === 'daily' ? note.title?.match(/(\d{4}-\d{2}-\d{2})/) : null
  const dateLine = dateMatch ? `date: ${dateMatch[1]}` : null

  // Wikilinks referenced in note content → links property
  const contentLinks = [...(note.content ?? '').matchAll(/\[\[([^\]]+)\]\]/g)]
    .map((m) => m[1])
    .filter((v, i, a) => a.indexOf(v) === i)
  const linksLines = contentLinks.length
    ? ['links:', ...contentLinks.map((l) => `  - "[[${l}]]"`)]
    : []

  const frontmatter = [
    '---',
    `type: ${typeLabel}`,
    note.verse_ref ? `ref: ${note.verse_ref}` : null,
    note.type === 'esword' ? 'source: esword' : note.type === 'biblegateway' ? 'source: biblegateway' : null,
    `title: ${JSON.stringify(displayTitle)}`,
    `created: ${createdIso}`,
    `updated: ${updatedIso}`,
    `tags: [${tags.join(', ')}]`,
    colorLine,
    statusLine,
    ...verseProps,
    dateLine,
    ...linksLines,
    `berean_id: ${note.id}`,
    note.folder_id ? `folder_id: ${note.folder_id}` : null,
    '---',
  ].filter((l) => l !== null).join('\n')

  let body = note.content ?? ''
  if (highlightedVerseText) {
    // Wrap in a marker block stripped on re-import so round-trips don't pollute note content.
    const preview = `<!-- berean:highlight-preview -->\n> ${highlightedVerseText}\n<!-- /berean:highlight-preview -->`
    body = preview + (body ? '\n\n' + body : '')
  }

  return frontmatter + '\n\n' + body
}

// ─── Path helpers ──────────────────────────────────────────────────────────────

// Convert a string to a safe filesystem segment (spaces → underscores, strip forbidden chars).
function toSafeSegment(s: string): string {
  return s.replace(/[/\\:*?"<>|]+/g, '').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '')
}

// Extract book name from a verse note's title (e.g. "Genesis 1:1" → "Genesis").
// Falls back to the static BOOK_ID_TO_NAME map, then bare bookId.
function extractBookName(note: { title: string | null; verse_ref: string | null }): string {
  if (note.title) {
    const m = note.title.match(/^(.+?)\s+\d+[:.]/i)
    if (m) return m[1].trim()
  }
  const bookId = note.verse_ref?.split('.')[0]
  return bookId ? getBookDisplayName(bookId) : 'Unknown'
}

// Build a safe title-based filename for non-verse, non-daily notes.
function safeFallbackFilename(note: { id: string; title: string | null }): string {
  const idFallback = note.id.slice(0, 8)
  let name = (note.title ?? '').trim()
  // Strip characters forbidden in filenames; keep spaces (macOS supports them, Octarine links work)
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[/\\:*?"<>|\x00-\x1f]/g, '')
  name = name.replace(/\.+$/, '').slice(0, 100)
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name.trim())) name = `_${name}`
  return `${name.trim() || idFallback}.md`
}

// Apply highlight spans to verse text, producing ==🟡text== markup.
// Handles char-level (start_char/end_char), word-level (start_word/end_word), and verse-level (all null).
function applyHighlightMarkdown(
  text: string,
  spans: Array<{ start_char: number | null; end_char: number | null; start_word?: number | null; end_word?: number | null; color: string }>
): string {
  // Lazy word-boundary list for word-level spans
  let wordBoundaries: Array<{ start: number; end: number }> | null = null
  const getWordBoundaries = () => {
    if (!wordBoundaries) {
      wordBoundaries = []
      const re = /\S+/g
      let m: RegExpExecArray | null
      while ((m = re.exec(text)) !== null) wordBoundaries.push({ start: m.index, end: m.index + m[0].length })
    }
    return wordBoundaries
  }

  // Normalise to char ranges
  const charSpans: Array<{ start_char: number; end_char: number; color: string }> = []
  for (const span of spans) {
    if (span.start_char !== null && span.start_char !== undefined &&
        span.end_char !== null && span.end_char !== undefined) {
      charSpans.push({ start_char: span.start_char, end_char: span.end_char, color: span.color })
    } else if ((span.start_word ?? null) !== null && (span.end_word ?? null) !== null) {
      const wb = getWordBoundaries()
      const sw = wb[span.start_word!], ew = wb[span.end_word!]
      if (sw && ew) charSpans.push({ start_char: sw.start, end_char: ew.end, color: span.color })
    } else {
      // Verse-level: entire text
      charSpans.push({ start_char: 0, end_char: text.length, color: span.color })
    }
  }

  const sorted = charSpans
    .filter((s) => s.start_char >= 0 && s.end_char > s.start_char && s.end_char <= text.length)
    .sort((a, b) => a.start_char - b.start_char)

  let result = ''
  let pos = 0
  for (const span of sorted) {
    if (span.start_char < pos) continue
    result += text.slice(pos, span.start_char)
    const emoji = OCTARINE_COLOR_EMOJI[span.color] ?? '🔵'
    result += `==${emoji}${text.slice(span.start_char, span.end_char)}==`
    pos = span.end_char
  }
  result += text.slice(pos)
  return result
}

type NotePath = { dir: string; filename: string }

// Resolve the correct vault directory + filename for any note type.
function resolveNotePath(note: NoteRow, vaultPath: string, folderPathMap: Map<string, string>): NotePath {
  // Daily notes → Daily/YYYY-MM-DD.md
  if (note.type === 'daily') {
    const dateMatch = note.title?.match(/(\d{4}-\d{2}-\d{2})/)
    const filename = dateMatch ? `${dateMatch[1]}.md` : safeFallbackFilename(note)
    return { dir: join(vaultPath, 'Daily'), filename }
  }

  // Verse-type notes → Verse Notes/{Book}/{Chapter}/Book_Chapter_Verse.md
  if (['verse', 'esword', 'biblegateway'].includes(note.type) && note.verse_ref) {
    const parts = note.verse_ref.split('.')
    const chapter = parts[1] ?? '0'
    const verse   = parts[2] ?? '0'
    const bookName = extractBookName(note)
    const filename = `${toSafeSegment(bookName)}_${chapter}_${verse}.md`
    return { dir: join(vaultPath, 'Verse Notes', bookName, chapter), filename }
  }

  // YouTube notes → YouTube/
  if (note.type === 'youtube') {
    return { dir: join(vaultPath, 'YouTube'), filename: safeFallbackFilename(note) }
  }

  // Idiom notes → Idioms/
  if (note.type === 'idiom') {
    return { dir: join(vaultPath, 'Idioms'), filename: safeFallbackFilename(note) }
  }

  // General notes: user folder hierarchy, or vault root
  return {
    dir: getNoteExportDir({ folder_id: note.folder_id }, vaultPath, folderPathMap),
    filename: safeFallbackFilename(note),
  }
}

// Extract note body text from a full vault .md file's contents: strips the YAML
// frontmatter block, strips the generated highlight-preview block (re-derived from
// highlights on every export, never part of user content), and trims surrounding
// whitespace. Shared by vault:watch's 'change' handler, vault:reconcile, and
// runImportAll so all three treat "what counts as the note body" identically —
// previously each had a subtly different trim() call (one skipped trimEnd()
// entirely), which meant a live-edit-detected save and a startup reconcile of the
// exact same file could disagree on the stored body's trailing whitespace.
export function extractNoteBody(content: string): string {
  const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n\n?([\s\S]*)$/)
  let body = bodyMatch ? bodyMatch[1] : content
  body = body.replace(/<!-- berean:highlight-preview -->[\s\S]*?<!-- \/berean:highlight-preview -->\n?\n?/, '')
  return body.trim()
}

let watcher: ReturnType<typeof chokidar.watch> | null = null

// Suppresses the watcher's 'change' handler from treating Berean's own writes
// (vault:syncNote, runExportAll) as external edits. Without this, every save
// while sync is on round-trips through the watcher and re-fires vault:changed
// for a file Berean itself just wrote, cascading into constant note-list/
// cross-ref refetches in the renderer — a self-triggered feedback loop, not
// real external activity. 3s is comfortably longer than the watcher's own
// 1500ms poll interval.
const recentSelfWrites = new Map<string, number>()
const SELF_WRITE_SUPPRESS_MS = 3000
function markSelfWrite(filePath: string) {
  recentSelfWrites.set(filePath, Date.now())
  // Opportunistic cleanup so this map never grows unbounded over a long session.
  if (recentSelfWrites.size > 500) {
    const cutoff = Date.now() - SELF_WRITE_SUPPRESS_MS
    for (const [p, t] of recentSelfWrites) if (t < cutoff) recentSelfWrites.delete(p)
  }
}
function isRecentSelfWrite(filePath: string): boolean {
  const t = recentSelfWrites.get(filePath)
  return t !== undefined && Date.now() - t < SELF_WRITE_SUPPRESS_MS
}

export function registerVaultHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('vault:syncNote', (_event, noteId: string) => {
    try {
      const db = getBereanDb()
      const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId) as NoteRow | undefined
      if (!row) return { success: false, reason: 'Note not found' }

      const vaultPath = getVaultPath()
      if (!vaultPath) return { success: false, reason: 'No vault folder configured' }
      const folderPathMap = buildFolderPathMap()
      const { dir, filename } = resolveNotePath(row, vaultPath, folderPathMap)
      ensureDir(dir)

      // For verse notes, embed highlighted text so Octarine can display it with ==emoji== markup.
      let overrideColor: string | undefined
      let highlightedVerseText: string | undefined
      if (row.verse_ref && ['verse', 'esword', 'biblegateway'].includes(row.type)) {
        const [bookId, chStr, vnStr] = row.verse_ref.split('.')
        const chapter = Number(chStr)
        const verseNum = Number(vnStr)
        const spans = db.prepare(
          'SELECT color, start_char, end_char FROM highlights WHERE book_id = ? AND chapter = ? AND verse_num = ?'
        ).all(bookId, chapter, verseNum) as Array<{ color: string; start_char: number; end_char: number }>
        if (spans.length > 0) {
          overrideColor = spans[0].color
          const bibleDb = getTextDb(row.type === 'biblegateway' || row.type === 'verse' ? 'kjva' : 'lxx')
          const verseRow = bibleDb?.prepare(
            'SELECT text FROM verses WHERE book_id = ? AND chapter = ? AND verse_num = ? LIMIT 1'
          ).get(bookId, chapter, verseNum) as { text: string } | undefined
          if (verseRow?.text) highlightedVerseText = applyHighlightMarkdown(verseRow.text, spans)
        }
      }

      const filePath = join(dir, filename)
      markSelfWrite(filePath)
      writeFileSync(filePath, noteToMarkdown(row, overrideColor, highlightedVerseText), 'utf-8')
      return { success: true }
    } catch (err) {
      return { success: false, reason: String(err) }
    }
  })

  ipcMain.handle('vault:readNote', (_event, title: string) => {
    try {
      const vaultPath = getVaultPath()
      if (!vaultPath) return null
      for (const filePath of scanMdFiles(vaultPath)) {
        const content = readFileSync(filePath, 'utf-8')
        if (content.includes(`title: "${title}"`) || content.includes(`title: '${title}'`)) {
          return content
        }
      }
      return null
    } catch {
      return null
    }
  })

  ipcMain.handle('vault:watch', (event) => {
    try {
      const vaultPath = getVaultPath()
      if (!vaultPath) return { success: false, reason: 'No vault folder configured' }
      ensureDir(vaultPath)

      if (watcher) {
        watcher.close()
        watcher = null
      }

      // Use polling to avoid native FSEvents ABI issues in Electron.
      // Watch the vault root so changes in any user folder are detected.
      // Doubled if the system is already under load when the watcher starts (on battery /
      // macOS thermal pressure — see powerAwareness.ts) — a depth-10 polling scan of the whole
      // vault every 1.5s is real, ongoing CPU/disk-I/O cost for as long as sync stays on, so
      // there's no reason to run it at full cadence while something else (e.g. a video call)
      // is already competing for the machine. Read once at watcher-(re)creation time rather
      // than kept live for a running watcher — chokidar doesn't support changing an active
      // watcher's poll interval, and this only gets re-evaluated on the next
      // vault:watch/reconfigure call, which is an acceptable trade-off for the added
      // complexity a live-swap would need.
      watcher = chokidar.watch(vaultPath, {
        ignoreInitial: true,
        persistent: true,
        depth: 10,
        usePolling: true,
        interval: getResourceMode() === 'throttled' ? 3000 : 1500,
        ignored: /\.json$|[/\\]\.(berean|git)[/\\]/,
      })

      const win = BrowserWindow.fromWebContents(event.sender)

      watcher.on('change', (filePath) => {
        if (!filePath.endsWith('.md')) return
        if (isRecentSelfWrite(filePath)) return
        try {
          const content = readFileSync(filePath, 'utf-8')
          const match = content.match(/^berean_id:\s*(.+)$/m)
          if (!match) return
          const noteId = match[1].trim()
          const body = extractNoteBody(content)
          getBereanDb().prepare('UPDATE notes SET content = ?, updated_at = ? WHERE id = ?').run(body, Date.now(), noteId)
          win?.webContents.send('vault:changed', noteId)
        } catch { /* ignore parse errors */ }
      })

      return { success: true }
    } catch (err) {
      return { success: false, reason: String(err) }
    }
  })

  // Stops the vault-sync watcher. Without this, turning vault sync off in Settings left the
  // polling chokidar watcher (1.5s interval, depth 10) running for the rest of the app's
  // life — a real source of session-long CPU/battery drag, since the only prior close-point
  // was re-invoking vault:watch itself.
  ipcMain.handle('vault:unwatch', () => {
    if (watcher) {
      watcher.close()
      watcher = null
    }
    return { success: true }
  })

  // Startup reconciliation: scan all .md files in the vault and sync any newer than DB
  ipcMain.handle('vault:reconcile', () => {
    try {
      const vaultPath = getVaultPath()
      if (!vaultPath || !existsSync(vaultPath)) return { success: true, updated: 0, skipped: 0 }

      const db = getBereanDb()
      let updated = 0
      let skipped = 0

      for (const filePath of scanMdFiles(vaultPath)) {
        try {
          const content = readFileSync(filePath, 'utf-8')
          const idMatch = content.match(/^berean_id:\s*(.+)$/m)
          if (!idMatch) { skipped++; continue }
          const noteId = idMatch[1].trim()

          const dbRow = db.prepare('SELECT content, updated_at FROM notes WHERE id = ?').get(noteId) as { content: string; updated_at: number } | undefined
          if (!dbRow) { skipped++; continue }

          const fileMtime = statSync(filePath).mtimeMs
          if (fileMtime > dbRow.updated_at + 1000) {
            const body = extractNoteBody(content)
            // A newer mtime doesn't mean a genuine external edit — Berean's OWN export
            // (runExportAll, especially a forced "Export All" or the very first export)
            // rewrites every note's .md file unconditionally, giving every file a fresh
            // mtime with no content change at all. That previously stamped updated_at =
            // now for essentially the whole vault on the next app launch, which is what
            // made every note appear "edited today." Comparing the actual body text
            // catches this regardless of mtime/watermark timing: only a REAL content
            // difference counts as an edit worth importing.
            if (body === dbRow.content.trimEnd()) {
              skipped++
            } else {
              db.prepare('UPDATE notes SET content = ?, updated_at = ? WHERE id = ?')
                .run(body, Date.now(), noteId)
              updated++
            }
          } else {
            skipped++
          }
        } catch {
          skipped++
        }
      }

      return { success: true, updated, skipped }
    } catch (err) {
      return { success: false, reason: String(err), updated: 0, skipped: 0 }
    }
  })

  ipcMain.handle('vault:exportAll', (_e, tabState?: string) => runExportAll({ tabState, force: true }))
  ipcMain.handle('vault:importAll', () => runImportAll())
  ipcMain.handle('vault:hasData', () => vaultHasData())

  // Configure the auto-export timer from the renderer (called when the setting changes).
  ipcMain.handle('vault:setAutoExport', (_e, intervalMinutes: number) => {
    setupAutoExport(intervalMinutes)
    return { success: true }
  })
}

// ─── Notes trash — vault-file side ─────────────────────────────────────────────
//
// A trashed note's .md file moves into `<vaultPath>/.trash/` (leading dot — scanMdFiles above
// already skips any directory starting with '.', so trashed files are automatically invisible
// to import/reconcile/export without any extra filtering there) instead of being left in place
// or deleted outright. Filenames are prefixed with the note's own id so two notes that happened
// to resolve to the same filename (e.g. same title, different folders) can't collide once both
// land in the same flat trash folder. The chokidar watcher (registered in vault:watch above)
// only listens for 'change' events, never 'add'/'unlink', so moving a file in or out of .trash/
// doesn't risk triggering any watcher-driven reconcile/import logic — confirmed by reading the
// watcher setup above before relying on that.
function trashFilePath(vaultPath: string, noteId: string): string {
  return join(vaultPath, '.trash', `${noteId}.md`)
}

/** Moves a note's current vault file into .trash/, if it has one and a vault is configured.
 *  Called right after the note's own `deleted_at` is set in the DB (electron/ipc/notes.ts). */
export function moveNoteToVaultTrash(note: NoteRow): void {
  try {
    const vaultPath = getVaultPath()
    if (!vaultPath) return
    const folderPathMap = buildFolderPathMap()
    const { dir, filename } = resolveNotePath(note, vaultPath, folderPathMap)
    const src = join(dir, filename)
    if (!existsSync(src)) return
    const dest = trashFilePath(vaultPath, note.id)
    ensureDir(join(vaultPath, '.trash'))
    copyFileSync(src, dest)
    unlinkSync(src)
  } catch { /* vault-file move is best-effort — the DB soft-delete is the source of truth */ }
}

/** Moves a note's file back out of .trash/ to its normal resolved location. Called right after
 *  `deleted_at` is cleared (restore). `note` should be the row AFTER restore (fresh folder_id). */
export function restoreNoteFromVaultTrash(note: NoteRow): void {
  try {
    const vaultPath = getVaultPath()
    if (!vaultPath) return
    const src = trashFilePath(vaultPath, note.id)
    if (!existsSync(src)) return
    const folderPathMap = buildFolderPathMap()
    const { dir, filename } = resolveNotePath(note, vaultPath, folderPathMap)
    ensureDir(dir)
    copyFileSync(src, join(dir, filename))
    unlinkSync(src)
  } catch { /* best-effort, same reasoning as moveNoteToVaultTrash */ }
}

/** Permanently deletes a note's file from .trash/ — called on manual purge/empty-trash and by
 *  the 30-day auto-purge timer, alongside the real DB DELETE (electron/ipc/notes.ts). */
export function purgeNoteFromVaultTrash(noteId: string): void {
  try {
    const vaultPath = getVaultPath()
    if (!vaultPath) return
    const p = trashFilePath(vaultPath, noteId)
    if (existsSync(p)) unlinkSync(p)
  } catch { /* best-effort */ }
}

// ─── Standalone export function (callable from main process too) ──────────────

// Cached tab state from the last renderer-initiated export.
// Used by the auto-export timer and will-quit handler (no renderer access then).
let cachedTabState: string | null = null

export function runExportAll(opts?: { tabState?: string; force?: boolean }): { success: boolean; notes?: number; highlights?: number; history?: number; pdfs?: number; reason?: string } {
  try {
    if (opts?.tabState) cachedTabState = opts.tabState
    const vaultPath = getVaultPath()
    if (!vaultPath) return { success: false, reason: 'No vault path set' }

    const db = getBereanDb()
    ensureDir(vaultPath)

    // Dirty-tracking watermark: only re-write note .md files whose updated_at is
    // newer than the last successful export. `force` (manual "export all") skips
    // the optimization and rewrites everything. First run (no watermark yet) also
    // exports everything, matching the original full-dump behavior.
    // Captured before reading notes so edits made mid-export are caught next run.
    const exportStartedAt = Date.now()
    const watermarkRow = db.prepare("SELECT value FROM settings WHERE key = 'lastVaultExportAt'").get() as { value: string } | undefined
    let lastExportAt: number | null = null
    if (!opts?.force && watermarkRow) {
      const parsed = Number(JSON.parse(watermarkRow.value))
      if (Number.isFinite(parsed)) lastExportAt = parsed
    }

    // ── 1. Notes (written into the vault folder hierarchy by type) ──────────
    const folderPathMap = buildFolderPathMap()
    // Trashed notes are never exported — see moveNoteToVaultTrash below, which moves their
    // vault file into .trash/ (and out of the normal per-type/folder tree) the moment they're
    // soft-deleted, so there's nothing left here to skip on subsequent runs either.
    const noteRows = db.prepare('SELECT * FROM notes WHERE deleted_at IS NULL').all() as NoteRow[]

    // Build per-verse highlight span groups for embedding ==emoji== markup in verse notes.
    type HlSpan = { color: string; start_char: number; end_char: number; text_id: string }
    const hlSpans: Record<string, HlSpan[]> = {}
    const hlAll = db.prepare('SELECT book_id, chapter, verse_num, color, start_char, end_char, text_id FROM highlights').all() as Array<HlSpan & { book_id: string; chapter: number; verse_num: number }>
    for (const hl of hlAll) {
      const key = `${hl.book_id}.${hl.chapter}.${hl.verse_num}`
      ;(hlSpans[key] = hlSpans[key] ?? []).push({ color: hl.color, start_char: hl.start_char, end_char: hl.end_char, text_id: hl.text_id })
    }

    // Cache verse text lookups to avoid duplicate DB queries.
    const verseTextCache: Record<string, string | null> = {}
    function lookupVerseText(textId: string, bookId: string, chapter: number, verseNum: number): string | null {
      const cacheKey = `${textId}.${bookId}.${chapter}.${verseNum}`
      if (cacheKey in verseTextCache) return verseTextCache[cacheKey]
      const bibleDb = getTextDb(textId)
      const row = bibleDb?.prepare('SELECT text FROM verses WHERE book_id = ? AND chapter = ? AND verse_num = ? LIMIT 1').get(bookId, chapter, verseNum) as { text: string } | undefined
      return (verseTextCache[cacheKey] = row?.text ?? null)
    }

    let noteCount = 0
    for (const note of noteRows) {
      const { dir, filename } = resolveNotePath(note, vaultPath, folderPathMap)
      const exportFilePath = join(dir, filename)

      // Verse notes whose verse has highlights embed live ==emoji== markup that
      // isn't reflected in the note's updated_at, so they must always re-export.
      const hasEmbeddedHighlight = !!(
        note.verse_ref &&
        ['verse', 'esword', 'biblegateway'].includes(note.type) &&
        hlSpans[note.verse_ref]?.length
      )

      // Skip unchanged notes already on disk (dirty-tracking). A missing target
      // file is always (re)written so a cleared/relocated vault re-populates.
      if (
        lastExportAt !== null &&
        note.updated_at <= lastExportAt &&
        !hasEmbeddedHighlight &&
        existsSync(exportFilePath)
      ) {
        continue
      }

      ensureDir(dir)

      let overrideColor: string | undefined
      let highlightedVerseText: string | undefined
      if (note.verse_ref && ['verse', 'esword', 'biblegateway'].includes(note.type)) {
        const spans = hlSpans[note.verse_ref]
        if (spans?.length) {
          overrideColor = spans[0].color
          const textId = spans[0].text_id ?? 'kjva'
          const [bookId, chStr, vnStr] = note.verse_ref.split('.')
          const vText = lookupVerseText(textId, bookId, Number(chStr), Number(vnStr))
          if (vText) highlightedVerseText = applyHighlightMarkdown(vText, spans)
        }
      }

      markSelfWrite(exportFilePath)
      writeFileSync(exportFilePath, noteToMarkdown(note, overrideColor, highlightedVerseText), 'utf-8')
      noteCount++
    }

    // For highlighted verses that have NO verse note: write a display-only vault file.
    // These lack berean_id so they are skipped on import — Octarine display only.
    const versesWithNotes = new Set(
      noteRows.filter((n) => ['verse', 'esword', 'biblegateway'].includes(n.type) && n.verse_ref).map((n) => n.verse_ref!)
    )
    for (const [verseKey, spans] of Object.entries(hlSpans)) {
      if (versesWithNotes.has(verseKey)) continue
      const [bookId, chapter, verseNum] = verseKey.split('.')
      const textId = spans[0]?.text_id ?? 'kjva'
      const vText = lookupVerseText(textId, bookId, Number(chapter), Number(verseNum))
      if (!vText) continue
      const highlighted = applyHighlightMarkdown(vText, spans)
      const bookName = getBookDisplayName(bookId)
      const filename = `${toSafeSegment(bookName)}_${chapter}_${verseNum}.md`
      const hlDir = join(vaultPath, 'Verse Notes', bookName, chapter)
      ensureDir(hlDir)
      const frontmatter = [
        '---',
        'type: verse-note',
        `ref: ${verseKey}`,
        `title: "${bookName} ${chapter}:${verseNum}"`,
        `verse: "[[${bookName} ${chapter}:${verseNum}]]"`,
        `book: ${bookName}`,
        `chapter: ${chapter}`,
        `color: ${toOctarineEmoji(spans[0]?.color)}`,
        '---',
      ].join('\n')
      writeFileSync(join(hlDir, filename), frontmatter + '\n\n> ' + highlighted + '\n', 'utf-8')
    }

    // Lightweight sidecar: id → folder_id mapping (not in .md for Octarine compat)
    const notesMeta = noteRows.map((n) => ({ id: n.id, folder_id: n.folder_id ?? null }))
    writeFileSync(join(vaultPath, 'berean-notes-meta.json'), JSON.stringify(notesMeta, null, 2), 'utf-8')

    // ── 2. Highlights ─────────────────────────────────────────────────────────
    const highlights = db.prepare('SELECT * FROM highlights').all()
    writeFileSync(join(vaultPath, 'berean-highlights.json'), JSON.stringify(highlights, null, 2), 'utf-8')

    // ── 3. App history ────────────────────────────────────────────────────────
    const history = db.prepare('SELECT * FROM history ORDER BY timestamp DESC').all()
    writeFileSync(join(vaultPath, 'berean-history.json'), JSON.stringify(history, null, 2), 'utf-8')

    // ── 4. Settings ───────────────────────────────────────────────────────────
    const settingsRows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>
    const settingsObj: Record<string, unknown> = {}
    for (const row of settingsRows) {
      try { settingsObj[row.key] = JSON.parse(row.value) } catch { settingsObj[row.key] = row.value }
    }
    writeFileSync(join(vaultPath, 'berean-settings.json'), JSON.stringify(settingsObj, null, 2), 'utf-8')

    // ── 5. PDFs (exported to .attachments/ per Octarine convention) ──────────
    const pdfRows = db.prepare('SELECT * FROM pdfs').all() as Array<{ id: string; title: string; filename: string; page_count: number; file_size: number; imported_at: number }>
    const pdfStorageDir = join(app.getPath('userData'), 'pdfs')
    const pdfExportDir = join(vaultPath, '.attachments')
    ensureDir(pdfExportDir)
    let pdfCount = 0
    const pdfMeta: Array<{ id: string; title: string; filename: string; page_count: number; file_size: number; imported_at: number; exportedAs: string }> = []
    for (const pdf of pdfRows) {
      const src = join(pdfStorageDir, pdf.filename)
      if (!existsSync(src)) continue
      const ext = extname(pdf.filename) || '.pdf'
      const safeName = (pdf.title || pdf.id).replace(/[/\\:*?"<>|]/g, '-').slice(0, 100) + ext
      try {
        copyFileSync(src, join(pdfExportDir, safeName))
        pdfMeta.push({ ...pdf, exportedAs: safeName })
        pdfCount++
      } catch { /* skip unreadable file */ }
    }
    writeFileSync(join(vaultPath, 'berean-pdfs-meta.json'), JSON.stringify(pdfMeta, null, 2), 'utf-8')

    // ── 6. Note version history ───────────────────────────────────────────────
    const noteVersions = db.prepare('SELECT * FROM note_versions ORDER BY note_id, created_at').all()
    writeFileSync(join(vaultPath, 'berean-note-versions.json'), JSON.stringify(noteVersions, null, 2), 'utf-8')

    // ── 7. Note folders ───────────────────────────────────────────────────────
    const noteFolders = db.prepare('SELECT * FROM note_folders').all()
    writeFileSync(join(vaultPath, 'berean-note-folders.json'), JSON.stringify(noteFolders, null, 2), 'utf-8')

    // ── 8. PDF highlights ─────────────────────────────────────────────────────
    const pdfHighlights = db.prepare('SELECT * FROM pdf_highlights').all()
    writeFileSync(join(vaultPath, 'berean-pdf-highlights.json'), JSON.stringify(pdfHighlights, null, 2), 'utf-8')

    // ── 9. YouTube starred videos ──────────────────────────────────────────────
    const starred = db.prepare('SELECT * FROM youtube_videos WHERE is_starred = 1').all()
    writeFileSync(join(vaultPath, 'berean-youtube-starred.json'), JSON.stringify(starred, null, 2), 'utf-8')

    // ── 10. Workspaces ────────────────────────────────────────────────────────
    const workspaces = db.prepare('SELECT * FROM workspaces').all()
    writeFileSync(join(vaultPath, 'berean-workspaces.json'), JSON.stringify(workspaces, null, 2), 'utf-8')

    // ── 11. Tab state (from renderer localStorage, passed or cached) ──────────
    const tabState = opts?.tabState ?? cachedTabState
    if (tabState) {
      writeFileSync(join(vaultPath, 'berean-tab-state.json'), tabState, 'utf-8')
    }

    // Advance the dirty-tracking watermark only after a fully successful pass.
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('lastVaultExportAt', ?)").run(JSON.stringify(exportStartedAt))

    return {
      success: true,
      notes: noteCount,
      highlights: highlights.length,
      history: history.length,
      pdfs: pdfCount,
    }
  } catch (err) {
    return { success: false, reason: String(err) }
  }
}

// ─── Import (vault → DB) ─────────────────────────────────────────────────────

export interface ImportAllResult {
  success: boolean
  notes?: number
  highlights?: number
  noteVersions?: number
  noteFolders?: number
  pdfHighlights?: number
  workspaces?: number
  pdfs?: number
  tabState?: string
  reason?: string
}

/**
 * Import ALL exported vault data back into the app DB.
 * Vault always takes precedent: existing rows with the same primary key are replaced.
 * Missing files are silently skipped so a partial vault still works.
 */
export function runImportAll(): ImportAllResult {
  try {
    const vaultPath = getVaultPath()
    if (!vaultPath || !existsSync(vaultPath)) {
      return { success: false, reason: 'No vault path set or folder not found' }
    }

    const db = getBereanDb()
    let notes = 0, highlights = 0, noteVersions = 0, noteFolders = 0, pdfHighlights = 0, workspaces = 0, pdfs = 0

    function readJson<T>(filename: string): T[] {
      const p = join(vaultPath, filename)
      if (!existsSync(p)) return []
      try { return JSON.parse(readFileSync(p, 'utf-8')) as T[] } catch { return [] }
    }

    // ── 1. Note folders (import before notes so foreign keys resolve) ─────────
    type FolderRow = { id: string; name: string; parent_id: string | null; created_at: number }
    const folderRows = readJson<FolderRow>('berean-note-folders.json')
    if (folderRows.length) {
      const ins = db.prepare('INSERT OR REPLACE INTO note_folders (id, name, parent_id, created_at) VALUES (@id, @name, @parent_id, @created_at)')
      db.transaction(() => { for (const r of folderRows) { try { ins.run(r); noteFolders++ } catch { /* skip */ } } })()
    }

    // ── 2. Notes (all .md files in vault, recursively) ────────────────────────
    for (const filePath of scanMdFiles(vaultPath)) {
      try {
        const content = readFileSync(filePath, 'utf-8')
        const get = (re: RegExp) => content.match(re)?.[1]?.trim() ?? null
        const noteId = get(/^berean_id:\s*(.+)$/m)
        if (!noteId) continue

        const body = extractNoteBody(content)

        const rawType   = get(/^type:\s*(.+)$/m) ?? ''
        const noteType  = rawType === 'verse-note' ? 'verse'
                        : rawType === 'daily-note'   ? 'daily'
                        : rawType === 'general-note' ? 'general'
                        : rawType.replace('-note', '') || 'general'
        const verseRef  = get(/^ref:\s*(.+)$/m)
        const titleRaw  = get(/^title:\s*(.+)$/m) ?? 'Untitled'
        const title     = titleRaw.replace(/^["']|["']$/g, '')
        const color     = parseVaultColor(get(/^color:\s*(.+)$/m))
        const folderId  = get(/^folder_id:\s*(.+)$/m)
        const tagsRaw   = get(/^tags:\s*\[([^\]]*)]$/m) ?? ''
        const tags      = JSON.stringify(tagsRaw.split(',').map((t) => t.trim()).filter(Boolean))
        const createdAt = Date.parse(get(/^created:\s*(.+)$/m) ?? '') || Date.now()
        const updatedAt = Date.parse(get(/^updated:\s*(.+)$/m) ?? '') || Date.now()
        // Upsert rather than INSERT OR REPLACE: the latter deletes+reinserts the row,
        // which silently nulls out every column the vault file doesn't carry (status,
        // idiom_term/meaning/aliases/auto_variants/data, text_id, ...) on every re-import
        // of an already-known note. status in particular is intentionally one-way
        // export-only (see noteToMarkdown) and must never be clobbered from a file re-read.
        db.prepare(`INSERT INTO notes
          (id, type, title, content, verse_ref, color, created_at, updated_at, tags, folder_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            type = excluded.type, title = excluded.title, content = excluded.content,
            verse_ref = excluded.verse_ref, color = excluded.color,
            created_at = excluded.created_at, updated_at = excluded.updated_at,
            tags = excluded.tags, folder_id = excluded.folder_id`)
          .run(noteId, noteType, title, body, verseRef, color, createdAt, updatedAt, tags, folderId)
        notes++
      } catch { /* skip malformed file */ }
    }

    // Apply folder_id from berean-notes-meta.json (written separately so .md stays Octarine-compatible)
    type NoteMetaRow = { id: string; folder_id: string | null }
    const notesMeta = readJson<NoteMetaRow>('berean-notes-meta.json')
    if (notesMeta.length) {
      const upd = db.prepare('UPDATE notes SET folder_id = ? WHERE id = ?')
      db.transaction(() => { for (const m of notesMeta) { try { upd.run(m.folder_id, m.id) } catch { /* skip */ } } })()
    }

    // ── 3. Highlights ─────────────────────────────────────────────────────────
    type HighlightRow = Record<string, unknown>
    const hlRows = readJson<HighlightRow>('berean-highlights.json')
    if (hlRows.length) {
      const ins = db.prepare(`INSERT OR REPLACE INTO highlights
        (id, text_id, book_id, chapter, verse_num, start_word, end_word, start_char, end_char, color, label, created_at)
        VALUES (@id, @text_id, @book_id, @chapter, @verse_num, @start_word, @end_word, @start_char, @end_char, @color, @label, @created_at)`)
      db.transaction(() => { for (const r of hlRows) { try { ins.run(r); highlights++ } catch { /* skip */ } } })()
    }

    // ── 4. Note version history ───────────────────────────────────────────────
    type VersionRow = { id: string; note_id: string; title: string | null; content: string; kind: string; created_at: number }
    const versionRows = readJson<VersionRow>('berean-note-versions.json')
    if (versionRows.length) {
      const ins = db.prepare('INSERT OR IGNORE INTO note_versions (id, note_id, title, content, kind, created_at) VALUES (@id, @note_id, @title, @content, @kind, @created_at)')
      db.transaction(() => { for (const r of versionRows) { try { ins.run(r); noteVersions++ } catch { /* skip */ } } })()
    }

    // ── 5. PDF highlights ─────────────────────────────────────────────────────
    type PdfHlRow = { id: string; pdf_id: string; page: number; rects_json: string; color: string; text: string; note: string | null; created_at: number }
    const pdfHlRows = readJson<PdfHlRow>('berean-pdf-highlights.json')
    if (pdfHlRows.length) {
      const ins = db.prepare(`INSERT OR REPLACE INTO pdf_highlights
        (id, pdf_id, page, rects_json, color, text, note, created_at)
        VALUES (@id, @pdf_id, @page, @rects_json, @color, @text, @note, @created_at)`)
      db.transaction(() => { for (const r of pdfHlRows) { try { ins.run(r); pdfHighlights++ } catch { /* skip */ } } })()
    }

    // ── 6. Workspaces ─────────────────────────────────────────────────────────
    type WsRow = { id: string; name: string; layout_json: string; state_json: string | null; created_at: number }
    const wsRows = readJson<WsRow>('berean-workspaces.json')
    if (wsRows.length) {
      const ins = db.prepare('INSERT OR REPLACE INTO workspaces (id, name, layout_json, state_json, created_at) VALUES (@id, @name, @layout_json, @state_json, @created_at)')
      db.transaction(() => { for (const r of wsRows) { try { ins.run(r); workspaces++ } catch { /* skip */ } } })()
    }

    // ── 7. PDFs (files + metadata) ────────────────────────────────────────────
    type PdfMetaRow = { id: string; title: string; filename: string; page_count: number; file_size: number; imported_at: number; exportedAs: string }
    const pdfMeta = readJson<PdfMetaRow>('berean-pdfs-meta.json')
    const pdfExportDir = join(vaultPath, '.attachments')
    const pdfStorageDir = join(app.getPath('userData'), 'pdfs')
    if (pdfMeta.length && existsSync(pdfExportDir)) {
      ensureDir(pdfStorageDir)
      const ins = db.prepare('INSERT OR REPLACE INTO pdfs (id, title, filename, page_count, file_size, imported_at) VALUES (?, ?, ?, ?, ?, ?)')
      for (const meta of pdfMeta) {
        try {
          const srcFile = meta.exportedAs || basename(meta.filename)
          const src = join(pdfExportDir, srcFile)
          if (!existsSync(src)) continue
          const dest = join(pdfStorageDir, meta.filename)
          if (!existsSync(dest)) copyFileSync(src, dest)
          ins.run(meta.id, meta.title, meta.filename, meta.page_count, meta.file_size, meta.imported_at)
          pdfs++
        } catch { /* skip */ }
      }
    }

    // ── 8. YouTube starred ────────────────────────────────────────────────────
    type StarredRow = { video_id: string }
    const starredRows = readJson<StarredRow>('berean-youtube-starred.json')
    if (starredRows.length) {
      const upd = db.prepare('UPDATE youtube_videos SET is_starred = 1 WHERE video_id = ?')
      db.transaction(() => { for (const r of starredRows) { try { upd.run(r.video_id) } catch { /* skip */ } } })()
    }

    // ── 9. Tab state (returned to renderer to apply to localStorage) ──────────
    let tabState: string | undefined
    const tsPath = join(vaultPath, 'berean-tab-state.json')
    if (existsSync(tsPath)) {
      try { tabState = readFileSync(tsPath, 'utf-8') } catch { /* skip */ }
    }

    return { success: true, notes, highlights, noteVersions, noteFolders, pdfHighlights, workspaces, pdfs, tabState }
  } catch (err) {
    return { success: false, reason: String(err) }
  }
}

/** Returns true if the vault path contains at least one exported data file. */
export function vaultHasData(): boolean {
  try {
    const vaultPath = getVaultPath()
    if (!vaultPath || !existsSync(vaultPath)) return false
    const markers = ['berean-highlights.json', 'berean-note-versions.json', 'berean-notes-meta.json']
    return markers.some((f) => existsSync(join(vaultPath, f)))
  } catch { return false }
}

// ─── Auto-export timer (main-process interval) ────────────────────────────────

// Fixed safety-net export interval — not user-configurable. Per-note content
// syncs immediately on save (vault:syncNote); this just periodically re-exports
// the less-frequently-changed sidecar data (highlights/settings/PDFs/etc).
export const AUTO_EXPORT_INTERVAL_MINUTES = 5

let autoExportTimer: ReturnType<typeof setInterval> | null = null

/**
 * Configure the recurring auto-export interval.
 * `intervalMinutes` = 0 (or negative) disables the timer.
 * Can be called at startup (with the saved setting) or at runtime when the
 * user changes the setting from the renderer.
 */
export function setupAutoExport(intervalMinutes: number): void {
  if (autoExportTimer) {
    clearInterval(autoExportTimer)
    autoExportTimer = null
  }
  if (intervalMinutes > 0) {
    autoExportTimer = setInterval(() => {
      runExportAll()
    }, intervalMinutes * 60 * 1000)
    // NodeJS setInterval keeps the process alive; unref() so it doesn't prevent app exit.
    if (autoExportTimer && typeof (autoExportTimer as NodeJS.Timeout).unref === 'function') {
      (autoExportTimer as NodeJS.Timeout).unref()
    }
  }
}

// ─── Notes trash — 30-day auto-purge timer ────────────────────────────────────
//
// Same shape as setupAutoExport above (module-level setInterval handle, unref()'d, callable
// once at startup) — checked hourly rather than every few minutes since a day-granularity
// deadline doesn't need finer polling, and permanently purges any note trashed more than 30
// days ago. Not user-configurable, same as the export interval.
const TRASH_PURGE_CHECK_INTERVAL_MINUTES = 60
const TRASH_RETENTION_DAYS = 30

let trashPurgeTimer: ReturnType<typeof setInterval> | null = null

function purgeExpiredTrash(): void {
  try {
    const db = getBereanDb()
    const cutoff = Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000
    const expired = db.prepare('SELECT id FROM notes WHERE deleted_at IS NOT NULL AND deleted_at < ?').all(cutoff) as Array<{ id: string }>
    if (expired.length === 0) return
    const tx = db.transaction(() => {
      for (const { id } of expired) {
        db.prepare('DELETE FROM note_versions WHERE note_id = ?').run(id)
        db.prepare('DELETE FROM notes WHERE id = ?').run(id)
      }
    })
    tx()
    for (const { id } of expired) purgeNoteFromVaultTrash(id)
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('notes:changed')
    console.log(`[vault] purged ${expired.length} note(s) from trash (>${TRASH_RETENTION_DAYS} days)`)
  } catch { /* best-effort background job — a failed sweep just retries next interval */ }
}

/** Starts the recurring trash-purge check. Called once at startup (electron/main.ts) —
 *  unlike auto-export, this isn't gated by any user setting; trash always ages out. */
export function setupTrashPurge(): void {
  if (trashPurgeTimer) { clearInterval(trashPurgeTimer); trashPurgeTimer = null }
  purgeExpiredTrash() // catch up on anything that expired while the app was closed
  trashPurgeTimer = setInterval(purgeExpiredTrash, TRASH_PURGE_CHECK_INTERVAL_MINUTES * 60 * 1000)
  if (trashPurgeTimer && typeof (trashPurgeTimer as NodeJS.Timeout).unref === 'function') {
    (trashPurgeTimer as NodeJS.Timeout).unref()
  }
}
