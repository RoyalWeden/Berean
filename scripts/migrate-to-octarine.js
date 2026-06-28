#!/usr/bin/env node
/**
 * One-time migration: relocate Berean note files into the Octarine-friendly vault
 * layout.
 *
 * Old layout (≤ 0.4.x):
 *   {vault}/berean-notes/verse-notes/*.md
 *   {vault}/berean-notes/general-notes/*.md      (held verse + general + daily + idiom)
 *   {vault}/berean-*.json                         (sidecars at the vault root)
 *
 * New layout (Octarine integration):
 *   {vault}/Verse Notes/{Book C.V}.md             (cssclasses: berean-verse)
 *   {vault}/Notes/{title}.md                      (general + journal; cssclasses: berean-note)
 *   {vault}/Daily/YYYY-MM-DD.md                   (ZERO frontmatter — Octarine daily convention)
 *   {vault}/Idioms/{term}.md                      (cssclasses: berean-idiom)
 *   {vault}/.berean/berean-*.json                 (sidecars — moved by DB migration v18 at app start)
 *
 * The app DB (berean.db) is the source of truth: every note is regenerated from it,
 * so the migration is idempotent and works whether or not old files exist. The old
 * berean-notes/ folder is deleted only after every note has been written.
 *
 * Usage:
 *   node scripts/migrate-to-octarine.js [--dry-run] [--db=PATH] [--vault=PATH]
 *     --dry-run   Print the planned moves; write nothing, delete nothing.
 *     --db=PATH   Path to berean.db (default: macOS userData app-support path).
 *     --vault=PATH  Override the vault root (default: read from settings.vaultPath).
 *
 * DB reads go through the `sqlite3` CLI (macOS ships /usr/bin/sqlite3) rather than
 * better-sqlite3: locally that native module is compiled for Electron's ABI and
 * can't be require()'d from plain Node.
 *
 * NOTE: noteToMarkdown()/resolveRelativePath() below mirror electron/ipc/vault.ts.
 * This standalone CommonJS script can't import the TS main-process module, so the
 * format is intentionally duplicated. The script writes a minimal-but-valid file
 * for each note; the app's next vault export enriches it (e.g. related_verses).
 * Keep the folder mapping + filename rules in sync with vault.ts.
 */

const { execFileSync } = require('child_process')
const { existsSync, mkdirSync, writeFileSync, unlinkSync, rmSync } = require('fs')
const { join, dirname } = require('path')
const os = require('os')

// ─── args ────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { dryRun: false, db: null, vault: null }
  for (const a of argv.slice(2)) {
    if (a === '--dry-run') out.dryRun = true
    else if (a.startsWith('--db=')) out.db = a.slice('--db='.length)
    else if (a.startsWith('--vault=')) out.vault = a.slice('--vault='.length)
    else { console.error(`Unknown argument: ${a}`); process.exit(2) }
  }
  return out
}

// ─── sqlite3 CLI read helper ───────────────────────────────────────────────────
function sqlReadJson(dbPath, query) {
  // stderr is piped (not inherited) so sqlite errors don't spam the console; the
  // thrown error still carries them for the caller's message.
  const raw = execFileSync('sqlite3', ['-json', dbPath, query], { encoding: 'utf-8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
  const trimmed = raw.trim()
  if (!trimmed) return []
  return JSON.parse(trimmed)
}

// ─── book id → display name ────────────────────────────────────────────────────
// MUST match ID_TO_NAME in src/lib/parseRef.ts exactly: the app humanizes verse
// refs with parseRef.bookName(), so any divergence here would make this script
// write filenames the app's next vault export wouldn't match — producing duplicate
// files. Sourcing names from the bundled DBs is wrong (they use "I Chronicles",
// "Revelation of John", "Song of Solomon", etc.).
const BOOK_NAMES = {
  GEN: 'Genesis', EXO: 'Exodus', LEV: 'Leviticus', NUM: 'Numbers', DEU: 'Deuteronomy',
  JOS: 'Joshua', JDG: 'Judges', RUT: 'Ruth', '1SA': '1 Samuel', '2SA': '2 Samuel',
  '1KI': '1 Kings', '2KI': '2 Kings', '1CH': '1 Chronicles', '2CH': '2 Chronicles',
  EZR: 'Ezra', NEH: 'Nehemiah', JOB: 'Job', PSA: 'Psalms', PRO: 'Proverbs',
  ECC: 'Ecclesiastes', SNG: 'Song of Songs', ISA: 'Isaiah', JER: 'Jeremiah',
  LAM: 'Lamentations', EZK: 'Ezekiel', DAN: 'Daniel', HOS: 'Hosea', JOL: 'Joel',
  AMO: 'Amos', OBA: 'Obadiah', JON: 'Jonah', MIC: 'Micah', NAM: 'Nahum', HAB: 'Habakkuk',
  ZEP: 'Zephaniah', HAG: 'Haggai', ZEC: 'Zechariah', MAL: 'Malachi', MAT: 'Matthew',
  MRK: 'Mark', LUK: 'Luke', JHN: 'John', ACT: 'Acts', ROM: 'Romans',
  '1CO': '1 Corinthians', '2CO': '2 Corinthians', GAL: 'Galatians', EPH: 'Ephesians',
  PHP: 'Philippians', COL: 'Colossians', '1TH': '1 Thessalonians', '2TH': '2 Thessalonians',
  '1TI': '1 Timothy', '2TI': '2 Timothy', TIT: 'Titus', PHM: 'Philemon', HEB: 'Hebrews',
  JAS: 'James', '1PE': '1 Peter', '2PE': '2 Peter', '1JN': '1 John', '2JN': '2 John',
  '3JN': '3 John', JUD: 'Jude', REV: 'Revelation', TOB: 'Tobit', JDT: 'Judith',
  WIS: 'Wisdom of Solomon', SIR: 'Sirach', BAR: 'Baruch', '1MA': '1 Maccabees',
  '2MA': '2 Maccabees', '3MA': '3 Maccabees', '4MA': '4 Maccabees', ESG: 'Esther (Greek)',
  SUS: 'Susanna', BEL: 'Bel and the Dragon', PRA: 'Prayer of Azariah', PRM: 'Prayer of Manasseh',
  LJE: 'Letter of Jeremiah', PSS: 'Psalms of Solomon', '1ES': '1 Esdras', '2ES': '2 Esdras',
  ENO: '1 Enoch', JUB: 'Jubilees', AEL: 'Apocalypse of Elijah', ABR: 'Apocalypse of Abraham',
  RCL1: 'Recognitions - Book 1', RCL2: 'Recognitions - Book 2', RCL3: 'Recognitions - Book 3',
  RCL4: 'Recognitions - Book 4', RCL5: 'Recognitions - Book 5', RCL6: 'Recognitions - Book 6',
  RCL7: 'Recognitions - Book 7', RCL8: 'Recognitions - Book 8', RCL9: 'Recognitions - Book 9',
  RCL10: 'Recognitions - Book 10', HER_VIS: 'Hermas - Visions', HER_MAN: 'Hermas - Mandates',
  HER_SIM: 'Hermas - Similitudes', AIS: 'Ascension of Isaiah', EPB: 'Epistle of Barnabas',
  TREU: 'Testament of Reuben', TSIM: 'Testament of Simeon', TLEV: 'Testament of Levi',
  TJUD: 'Testament of Judah', TISS: 'Testament of Issachar', TZEB: 'Testament of Zebulun',
  TDAN: 'Testament of Dan', TNAP: 'Testament of Naphtali', TGAD: 'Testament of Gad',
  TASH: 'Testament of Asher', TJOS: 'Testament of Joseph', TBEN: 'Testament of Benjamin',
  GAD: 'Gad the Seer', TJOB: 'Testament of Job', '1CL': '1 Clement',
}

// ─── filename / path helpers (mirror vault.ts) ─────────────────────────────────
function safeName(str) {
  let name = String(str ?? '').trim()
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[/\\:*?"<>|]/g, '-')
  name = name.replace(/\s+/g, ' ')
  name = name.replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '')
  name = name.slice(0, 80).trim()
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name)) name = `_${name}`
  return name
}

// "1CH.16.22" → "1 Chronicles 16.22"  (filename-safe: chapter.verse, no colon)
function verseFilename(verseRef) {
  const parts = String(verseRef ?? '').split('.')
  if (parts.length < 2) return safeName(verseRef || 'verse')
  const bookId = parts[0]
  const rest = parts.slice(1).join('.')
  return safeName(`${BOOK_NAMES[bookId] ?? bookId} ${rest}`)
}

function dailyDate(note) {
  const m = String(note.title ?? '').match(/(\d{4}-\d{2}-\d{2})/)
  if (m) return m[1]
  const d = note.created_at ? new Date(Number(note.created_at)) : new Date()
  return d.toISOString().slice(0, 10)
}

function resolveRelativePath(note) {
  switch (note.type) {
    case 'verse':
      return join('Verse Notes', verseFilename(note.verse_ref) + '.md')
    case 'daily':
      return join('Daily', dailyDate(note) + '.md')
    case 'idiom':
      return join('Idioms', (safeName(note.idiom_term || note.title) || note.id.slice(0, 8)) + '.md')
    case 'journal':
    case 'general':
    default:
      return join('Notes', (safeName(note.title) || note.id.slice(0, 8)) + '.md')
  }
}

// ─── markdown generation (mirror vault.ts; minimal — app export enriches later) ─
function yamlList(arr) {
  return '[' + arr.map((s) => JSON.stringify(String(s))).join(', ') + ']'
}

function noteToMarkdown(note) {
  const tags = (() => { try { return JSON.parse(note.tags || '[]') } catch { return [] } })()
  const body = note.content ?? ''

  // Daily notes carry ZERO frontmatter (Octarine convention; reconciled by filename date).
  if (note.type === 'daily') return body

  const createdIso = new Date(Number(note.created_at) || Date.now()).toISOString()
  const updatedIso = new Date(Number(note.updated_at) || Date.now()).toISOString()
  const cssclass = note.type === 'verse' ? 'berean-verse' : note.type === 'idiom' ? 'berean-idiom' : 'berean-note'

  const lines = ['---', `cssclasses: ${yamlList([cssclass])}`]
  if (note.type === 'verse') {
    if (note.verse_ref) lines.push(`ref: ${note.verse_ref}`)
    lines.push(`text_id: ${note.text_id || 'kjva'}`)
  }
  if (note.type === 'idiom' && note.idiom_meaning) lines.push(`description: ${JSON.stringify(note.idiom_meaning)}`)
  lines.push(`tags: ${yamlList(tags)}`)
  lines.push(`created_at: ${createdIso}`)
  lines.push(`updated_at: ${updatedIso}`)
  lines.push(`berean_id: ${note.id}`)
  lines.push(`berean_color: ${note.color || 'blue'}`)
  lines.push('---')
  return lines.join('\n') + '\n\n' + body
}

// ─── main ──────────────────────────────────────────────────────────────────────
function main() {
  const args = parseArgs(process.argv)

  const dbPath = args.db || join(os.homedir(), 'Library', 'Application Support', 'Berean', 'berean.db')
  if (!existsSync(dbPath)) {
    console.error(`berean.db not found at: ${dbPath}\nPass --db=PATH to point at it.`)
    process.exit(1)
  }

  // Vault path: CLI override, else settings.vaultPath (JSON-encoded string).
  let vaultPath = args.vault
  if (!vaultPath) {
    const rows = sqlReadJson(dbPath, "SELECT value FROM settings WHERE key='vaultPath'")
    try { vaultPath = rows.length ? JSON.parse(rows[0].value) : '' } catch { vaultPath = '' }
  }
  if (!vaultPath || !existsSync(vaultPath)) {
    console.error(`Vault path not set or missing: ${vaultPath || '(empty)'}\nPass --vault=PATH.`)
    process.exit(1)
  }

  console.log(`Source DB : ${dbPath}`)
  console.log(`Vault     : ${vaultPath}`)
  console.log(`Mode      : ${args.dryRun ? 'DRY RUN (no writes)' : 'WRITE'}`)
  console.log('')

  const notes = sqlReadJson(dbPath, `SELECT id, type, title, content, verse_ref, color, created_at, updated_at, tags, text_id, idiom_term, idiom_meaning FROM notes`)
  console.log(`Notes to migrate: ${notes.length}\n`)

  const ownerByPath = new Map() // relPath → berean_id (collision tracking)
  const created = []            // absolute paths written (for rollback)
  let written = 0
  const warnings = []

  try {
    for (const note of notes) {
      let rel = resolveRelativePath(note)

      // Collision: a different note already claims this path. Disambiguate with a
      // short id suffix so neither note is lost. (Daily collisions are reported but
      // also suffixed — duplicate dates are a data anomaly, not the norm.)
      const existingOwner = ownerByPath.get(rel)
      if (existingOwner && existingOwner !== note.id) {
        const dot = rel.lastIndexOf('.md')
        rel = rel.slice(0, dot) + ` (${note.id.slice(0, 6)})` + rel.slice(dot)
        warnings.push(`collision → ${rel} (note ${note.id})`)
      }
      ownerByPath.set(rel, note.id)

      const abs = join(vaultPath, rel)
      const md = noteToMarkdown(note)

      if (args.dryRun) {
        console.log(`  would write  ${rel}`)
      } else {
        mkdirSync(dirname(abs), { recursive: true })
        writeFileSync(abs, md, 'utf-8')
        created.push(abs)
        if (written % 200 === 0) console.log(`  ...${written}/${notes.length}`)
      }
      written++
    }
  } catch (err) {
    console.error(`\nERROR after ${written} notes: ${err && err.message ? err.message : err}`)
    if (!args.dryRun) {
      console.error('Rolling back: removing files written by this run...')
      for (const f of created) { try { unlinkSync(f) } catch { /* ignore */ } }
    }
    process.exit(1)
  }

  for (const w of warnings) console.log(`  WARN: ${w}`)

  // Remove the old berean-notes/ folder only after every note wrote successfully.
  const oldNotesDir = join(vaultPath, 'berean-notes')
  if (args.dryRun) {
    console.log(`\nDRY RUN complete. ${written} note(s) would be written.`)
    if (existsSync(oldNotesDir)) console.log(`Would delete old folder: ${oldNotesDir}`)
  } else {
    console.log(`\nWrote ${written} note(s).`)
    if (existsSync(oldNotesDir)) {
      rmSync(oldNotesDir, { recursive: true, force: true })
      console.log(`Deleted old folder: ${oldNotesDir}`)
    }
    console.log('Sidecar JSON files are moved to .berean/ by the app on next launch (DB migration v18).')
    console.log('Done.')
  }
}

main()
