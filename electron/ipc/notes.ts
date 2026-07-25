import type { IpcMain, WebContents } from 'electron'
import { BrowserWindow } from 'electron'
import { getBereanDb } from '../db/berean'
import { randomUUID } from 'crypto'
import { numberTokenAlternates } from './numberWords'

/** Notify every OTHER open window (including floating/detached ones) that notes
 *  changed, so each window's own `noteChangeToken` bumps and any open Scripture/
 *  Notes tab refetches. Each renderer has its own in-memory store, so a note edit
 *  in one window otherwise never reaches another window's side panels. The
 *  originating window already bumps its own token locally after a successful save,
 *  so it's excluded here to avoid a redundant refetch. */
function broadcastNotesChanged(exclude?: WebContents): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.webContents !== exclude) win.webContents.send('notes:changed')
  }
}

// Cache compiled statements per DB instance so hot IPC handlers don't re-compile
// the same SQL on every call. Keyed by the db object so a close/reopen (new
// instance) transparently gets a fresh statement set.
const _stmtCache = new WeakMap<object, Map<string, any>>()
function prep(db: ReturnType<typeof getBereanDb>, sql: string): any {
  let m = _stmtCache.get(db as unknown as object)
  if (!m) { m = new Map(); _stmtCache.set(db as unknown as object, m) }
  let s = m.get(sql)
  if (!s) { s = (db as any).prepare(sql); m.set(sql, s) }
  return s
}

type NotesWordMode = 'all' | 'any' | 'phrase'

/** Split a raw query into cleaned, FTS5-safe word tokens. Splits on the same
 *  punctuation classes the `unicode61` tokenizer splits on (whitespace, colons,
 *  hyphens, periods, etc.) rather than stripping punctuation and gluing the
 *  surrounding digits together — verse-reference-shaped titles like
 *  "Genesis 1:1-3" must tokenize as ["Genesis","1","1","3"], matching how
 *  notes_fts itself indexes that same text, not as a single glued "113" token
 *  that never appears in the index. */
function cleanNotesWords(query: string): string[] {
  return query.trim().split(/[^a-zA-Z0-9']+/).filter(w => w.length >= 1)
}

// Build an FTS5 MATCH expression for a notes search. `mode` is passed explicitly by
// the caller rather than sniffed from the query string, mirroring bible.ts's
// safeFtsQuery — same reasoning: a literal "OR" or quote mark typed as part of the
// user's own query text must not silently flip the mode the UI shows as selected.
//   'all'    (default) — every word must appear (prefix-matched), the original/only
//            behavior this function had before word-modes existed.
//   'phrase' — the words as one exact contiguous phrase (no per-word prefix).
//   'any'    — handled by the caller, not here (see notes:search below): FTS5 OR with
//            prefix wildcards is unreliable for common/short tokens, so 'any' mode
//            runs one query per word and unions results in JS instead, same
//            approach bible.ts's searchText already uses for the same reason.
function safeNotesFts(query: string, mode: 'all' | 'phrase' = 'all'): string {
  const words = cleanNotesWords(query)
  if (words.length === 0) return ''
  if (mode === 'phrase') return `"${words.join(' ')}"`
  // Expand a number-shaped word into "(digits OR words)" so a query in either
  // form finds notes written in the other (e.g. a verse note referencing
  // "seven" is still found searching "7"). Only in 'all' mode — an exact
  // phrase shouldn't get fuzzed.
  // Joined with explicit AND (not just whitespace) — FTS5's implicit-AND parser
  // throws a syntax error when a bare term is immediately followed by a
  // parenthesized OR-group (e.g. `"Daily"* ("07"* OR "seven"*)`), which every
  // number-bearing query hits once a term expands to alternates below. That
  // silently failed (caught by the caller's try/catch → empty results), which
  // for daily notes meant the existing note was never found and a duplicate
  // blank one got created on every open.
  return words.map(w => {
    const alts = numberTokenAlternates(w)
    return alts.length > 1 ? `(${alts.map(a => `"${a}"*`).join(' OR ')})` : `"${w}"*`
  }).join(' AND ')
}

interface NoteRow {
  id: string
  type: string
  title: string | null
  content: string | null
  verse_ref: string | null
  color: string
  created_at: number
  updated_at: number
  tags: string
  imported_at: number | null
  folder_id: string | null
  text_id: string | null
  idiom_term: string | null
  idiom_meaning: string | null
  idiom_aliases: string | null
  idiom_auto_variants: number | null
  idiom_data: string | null
}

function rowToNote(row: NoteRow) {
  return {
    id:           row.id,
    type:         row.type,
    title:        row.title ?? '',
    // A NULL content column (seen on some notes carried over from an older
    // schema/import path, before `content` had a reliable NOT NULL
    // guarantee) used to flow straight through as `null` here — the
    // ProseMirror editor's markdown parser throws on a null/undefined
    // input, which silently killed the EditorView's construction and made
    // the note appear completely non-editable (blank, no cursor, nothing
    // happens) with no visible error. Coerce to '' at the source so this
    // failure mode is categorically impossible regardless of what's
    // actually stored.
    content:      row.content ?? '',
    verseRef:     row.verse_ref,
    color:        row.color,
    createdAt:    row.created_at,
    updatedAt:    row.updated_at,
    tags:         JSON.parse(row.tags) as string[],
    importedAt:   row.imported_at ?? undefined,
    folderId:     row.folder_id ?? null,
    textId:       row.text_id ?? 'kjva',
    idiomTerm:         row.idiom_term ?? undefined,
    idiomMeaning:      row.idiom_meaning ?? undefined,
    idiomAliases:      row.idiom_aliases ? (JSON.parse(row.idiom_aliases) as string[]) : undefined,
    idiomAutoVariants: row.idiom_auto_variants === 1 ? true : undefined,
    idiomData:         row.idiom_data ? safeParse(row.idiom_data) : undefined,
  }
}

function safeParse(s: string): unknown { try { return JSON.parse(s) } catch { return undefined } }

interface VersionRow { id: string; note_id: string; title: string | null; content: string | null; kind: string; created_at: number }
function rowToVersion(r: VersionRow) {
  return { id: r.id, noteId: r.note_id, title: r.title ?? '', content: r.content ?? '', kind: r.kind, createdAt: r.created_at }
}

/**
 * Prune a note's version history: keep everything from the last 7 days, then keep only
 * one (the newest) version per calendar day older than that, capped at 50 total. Always
 * keep the most recent version and any 'pre-restore'/'manual' snapshots within the cap.
 */
function pruneNoteVersions(db: ReturnType<typeof getBereanDb>, noteId: string): void {
  const rows = db.prepare('SELECT id, kind, created_at FROM note_versions WHERE note_id = ? ORDER BY created_at DESC')
    .all(noteId) as Array<{ id: string; kind: string; created_at: number }>
  if (rows.length <= 50) return
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  const keep = new Set<string>()
  const seenDay = new Set<string>()
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (i === 0 || r.kind === 'manual' || r.kind === 'pre-restore' || r.created_at >= weekAgo) { keep.add(r.id); continue }
    const day = new Date(r.created_at).toISOString().slice(0, 10)
    if (!seenDay.has(day)) { seenDay.add(day); keep.add(r.id) }
  }
  // Enforce the overall cap (keep the newest `keep` up to 50).
  const ordered = rows.filter(r => keep.has(r.id)).slice(0, 50)
  const finalKeep = new Set(ordered.map(r => r.id))
  const toDelete = rows.filter(r => !finalKeep.has(r.id)).map(r => r.id)
  if (toDelete.length) {
    const placeholders = toDelete.map(() => '?').join(',')
    db.prepare(`DELETE FROM note_versions WHERE id IN (${placeholders})`).run(...toDelete)
  }
}

export function registerNotesHandlers(ipcMain: IpcMain): void {

  ipcMain.handle('notes:create', (event, data: {
    type?: string; title?: string; content?: string; verseRef?: string; color?: string; tags?: string[]; textId?: string; folderId?: string | null; idiomTerm?: string; idiomMeaning?: string; idiomAliases?: string[]; idiomAutoVariants?: boolean
  }) => {
    const db = getBereanDb()
    const id = randomUUID()
    const now = Date.now()
    db.prepare(`
      INSERT INTO notes (id, type, title, content, verse_ref, color, created_at, updated_at, tags, text_id, folder_id, idiom_term, idiom_meaning, idiom_aliases, idiom_auto_variants)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.type ?? 'general',
      data.title ?? null,
      data.content ?? '',
      data.verseRef ?? null,
      data.color ?? 'blue',
      now, now,
      JSON.stringify(data.tags ?? []),
      data.textId ?? 'kjva',
      data.folderId ?? null,
      data.idiomTerm ?? null,
      data.idiomMeaning ?? null,
      data.idiomAliases ? JSON.stringify(data.idiomAliases) : null,
      data.idiomAutoVariants ? 1 : 0
    )
    const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as NoteRow
    broadcastNotesChanged(event.sender)
    return { success: true, note: rowToNote(row) }
  })

  ipcMain.handle('notes:update', (event, id: string, data: {
    title?: string; content?: string; color?: string; tags?: string[]; idiomTerm?: string; idiomMeaning?: string; idiomAliases?: string[]; idiomAutoVariants?: boolean; idiomData?: unknown
  }) => {
    const db = getBereanDb()
    const existing = db.prepare('SELECT id FROM notes WHERE id = ?').get(id)
    if (!existing) return { success: false, error: 'Note not found' }

    const fields: string[] = ['updated_at = ?']
    const values: unknown[] = [Date.now()]

    if (data.title !== undefined) { fields.push('title = ?'); values.push(data.title) }
    if (data.content !== undefined) { fields.push('content = ?'); values.push(data.content) }
    if (data.color !== undefined) { fields.push('color = ?'); values.push(data.color) }
    if (data.tags !== undefined) { fields.push('tags = ?'); values.push(JSON.stringify(data.tags)) }
    if (data.idiomTerm !== undefined) { fields.push('idiom_term = ?'); values.push(data.idiomTerm || null) }
    if (data.idiomMeaning !== undefined) { fields.push('idiom_meaning = ?'); values.push(data.idiomMeaning || null) }
    if (data.idiomAliases !== undefined) { fields.push('idiom_aliases = ?'); values.push(data.idiomAliases.length ? JSON.stringify(data.idiomAliases) : null) }
    if (data.idiomAutoVariants !== undefined) { fields.push('idiom_auto_variants = ?'); values.push(data.idiomAutoVariants ? 1 : 0) }
    if (data.idiomData !== undefined) { fields.push('idiom_data = ?'); values.push(data.idiomData ? JSON.stringify(data.idiomData) : null) }

    values.push(id)
    db.prepare(`UPDATE notes SET ${fields.join(', ')} WHERE id = ?`).run(...values)
    broadcastNotesChanged(event.sender)
    return { success: true }
  })

  ipcMain.handle('notes:listIdioms', () => {
    const rows = getBereanDb()
      .prepare(`SELECT id, title, idiom_term, idiom_meaning, idiom_aliases, idiom_auto_variants FROM notes WHERE type = 'idiom' AND idiom_term IS NOT NULL ORDER BY idiom_term COLLATE NOCASE ASC`)
      .all() as Array<{ id: string; title: string | null; idiom_term: string; idiom_meaning: string | null; idiom_aliases: string | null; idiom_auto_variants: number | null }>
    return rows.map(r => ({
      id: r.id,
      term: r.idiom_term,
      meaning: r.idiom_meaning ?? '',
      aliases: r.idiom_aliases ? (JSON.parse(r.idiom_aliases) as string[]) : [],
      autoVariants: r.idiom_auto_variants === 1,
    }))
  })

  ipcMain.handle('notes:delete', (event, id: string) => {
    const db = getBereanDb()
    db.prepare('DELETE FROM note_versions WHERE note_id = ?').run(id)
    db.prepare('DELETE FROM notes WHERE id = ?').run(id)
    broadcastNotesChanged(event.sender)
    return { success: true }
  })

  // ── Note folders (user-created, nestable) ──────────────────────────────────
  ipcMain.handle('folders:getAll', () => {
    const rows = getBereanDb()
      .prepare('SELECT id, name, parent_id, created_at FROM note_folders ORDER BY name COLLATE NOCASE')
      .all() as Array<{ id: string; name: string; parent_id: string | null; created_at: number }>
    return rows.map((r) => ({ id: r.id, name: r.name, parentId: r.parent_id ?? null, createdAt: r.created_at }))
  })

  ipcMain.handle('folders:create', (_event, name: string, parentId: string | null = null) => {
    const db = getBereanDb()
    const id = randomUUID()
    db.prepare('INSERT INTO note_folders (id, name, parent_id, created_at) VALUES (?, ?, ?, ?)')
      .run(id, name || 'New Folder', parentId, Date.now())
    return { success: true, id }
  })

  ipcMain.handle('folders:rename', (_event, id: string, name: string) => {
    getBereanDb().prepare('UPDATE note_folders SET name = ? WHERE id = ?').run(name, id)
    return { success: true }
  })

  // Delete a folder: reparent child folders to this folder's parent, and move
  // contained notes to root (folder_id = NULL). Never deletes notes.
  ipcMain.handle('folders:delete', (_event, id: string) => {
    const db = getBereanDb()
    const folder = db.prepare('SELECT parent_id FROM note_folders WHERE id = ?').get(id) as { parent_id: string | null } | undefined
    const parentId = folder?.parent_id ?? null
    const tx = db.transaction(() => {
      db.prepare('UPDATE note_folders SET parent_id = ? WHERE parent_id = ?').run(parentId, id)
      db.prepare('UPDATE notes SET folder_id = NULL WHERE folder_id = ?').run(id)
      db.prepare('DELETE FROM note_folders WHERE id = ?').run(id)
    })
    tx()
    return { success: true }
  })

  // Delete a folder AND its contents: recursively removes all descendant
  // folders and every note contained in any of them. Destructive.
  ipcMain.handle('folders:deleteDeep', (_event, id: string) => {
    const db = getBereanDb()
    const tx = db.transaction(() => {
      const all = db.prepare('SELECT id, parent_id FROM note_folders').all() as Array<{ id: string; parent_id: string | null }>
      const childrenOf = new Map<string | null, string[]>()
      for (const f of all) {
        const arr = childrenOf.get(f.parent_id) ?? []
        arr.push(f.id); childrenOf.set(f.parent_id, arr)
      }
      const toDelete: string[] = []
      const stack = [id]
      while (stack.length) {
        const cur = stack.pop()!
        toDelete.push(cur)
        for (const c of childrenOf.get(cur) ?? []) stack.push(c)
      }
      const delNotes = db.prepare('DELETE FROM notes WHERE folder_id = ?')
      const delFolder = db.prepare('DELETE FROM note_folders WHERE id = ?')
      for (const fid of toDelete) { delNotes.run(fid); delFolder.run(fid) }
    })
    tx()
    return { success: true }
  })

  // Set a folder's parent (for nesting). Guards against cycles.
  ipcMain.handle('folders:setParent', (_event, id: string, parentId: string | null) => {
    const db = getBereanDb()
    // Walk up from the proposed parent; if we reach `id`, it would create a cycle.
    let cur: string | null = parentId
    while (cur) {
      if (cur === id) return { success: false, error: 'cycle' }
      const row = db.prepare('SELECT parent_id FROM note_folders WHERE id = ?').get(cur) as { parent_id: string | null } | undefined
      cur = row?.parent_id ?? null
    }
    db.prepare('UPDATE note_folders SET parent_id = ? WHERE id = ?').run(parentId, id)
    return { success: true }
  })

  // Assign a note to a user folder (or NULL for root).
  ipcMain.handle('notes:setFolder', (event, noteId: string, folderId: string | null) => {
    getBereanDb().prepare('UPDATE notes SET folder_id = ? WHERE id = ?').run(folderId, noteId)
    broadcastNotesChanged(event.sender)
    return { success: true }
  })

  ipcMain.handle('notes:deleteAll', (event) => {
    getBereanDb().prepare('DELETE FROM notes').run()
    broadcastNotesChanged(event.sender)
    return { success: true }
  })

  ipcMain.handle('notes:getAll', (_event, limit = 200, offset = 0) => {
    const rows = prep(getBereanDb(), 'SELECT * FROM notes ORDER BY updated_at DESC LIMIT ? OFFSET ?')
      .all(limit, offset) as NoteRow[]
    return rows.map(rowToNote)
  })

  ipcMain.handle('notes:getByVerse', (_event, verseRef: string, textId = 'kjva') => {
    // KJV and LXX are cross-linked: each shows the other's notes with a translation badge
    // so study connections are always visible. Own-translation notes come first, then cross.
    let sql: string
    if (textId === 'kjva') {
      // Reading KJV → own notes first, then LXX notes
      sql = `SELECT * FROM notes WHERE verse_ref = ?
               AND (text_id = 'kjva' OR text_id IS NULL OR text_id = 'lxx')
             ORDER BY CASE WHEN text_id = 'lxx' THEN 1 ELSE 0 END, created_at ASC`
    } else if (textId === 'lxx') {
      // Reading LXX → own notes first, then KJV notes
      sql = `SELECT * FROM notes WHERE verse_ref = ?
               AND (text_id = 'lxx' OR text_id = 'kjva' OR text_id IS NULL)
             ORDER BY CASE WHEN text_id != 'lxx' THEN 1 ELSE 0 END, created_at ASC`
    } else {
      sql = 'SELECT * FROM notes WHERE verse_ref = ? AND text_id = ? ORDER BY created_at ASC'
    }
    const db = getBereanDb()
    const rows = (textId === 'kjva' || textId === 'lxx'
      ? prep(db, sql).all(verseRef)
      : prep(db, sql).all(verseRef, textId)
    ) as NoteRow[]
    return rows.map(rowToNote)
  })

  ipcMain.handle('notes:getOne', (_event, id: string) => {
    const row = prep(getBereanDb(), 'SELECT * FROM notes WHERE id = ?')
      .get(id) as NoteRow | undefined
    return row ? rowToNote(row) : null
  })

  // Untitled notes store title as '' (schema: `title TEXT NOT NULL DEFAULT ''`) — the
  // "Untitled" text a user sees is only a client-side placeholder (NotesPanel.tsx etc.),
  // never actually written to the DB or indexed in notes_fts. So typing "untitled" to
  // find a blank-titled note matched nothing at all, even though that's the one label
  // the user actually has to go on for a note with no other distinguishing text.
  // Special-cased here rather than indexing a literal "Untitled" string into notes_fts,
  // since that would permanently pollute the index (and get out of sync if the disambig
  // wording ever changes) for something that's purely a UI-layer label.
  function matchesUntitledQuery(query: string): boolean {
    return cleanNotesWords(query).some((w) => w.toLowerCase() === 'untitled')
  }
  function untitledNoteRows(db: ReturnType<typeof getBereanDb>, limit: number): NoteRow[] {
    return prep(db, `SELECT * FROM notes WHERE title = '' ORDER BY updated_at DESC LIMIT ?`).all(limit) as NoteRow[]
  }

  ipcMain.handle('notes:search', (_event, query: string, limit = 20, mode: NotesWordMode = 'all') => {
    const db = getBereanDb()
    const includeUntitled = matchesUntitledQuery(query)

    // 'any' mode: one FTS5 query per word, union + de-dupe in JS — see safeNotesFts's
    // comment for why this can't just be an FTS5 OR expression.
    if (mode === 'any') {
      const terms = cleanNotesWords(query)
      const seen = new Set<string>()
      const rows: NoteRow[] = []
      let stmt: any
      try {
        stmt = prep(db, `
          SELECT n.* FROM notes_fts f
          JOIN notes n ON n.rowid = f.rowid
          WHERE notes_fts MATCH ?
          ORDER BY n.updated_at DESC
          LIMIT ?
        `)
      } catch {
        return []
      }
      for (const term of terms) {
        const ftsQ = safeNotesFts(term, 'all')
        if (!ftsQ) continue
        try {
          const termRows = stmt.all(ftsQ, Math.max(limit * 3, 100)) as NoteRow[]
          for (const row of termRows) {
            if (!seen.has(row.id)) { seen.add(row.id); rows.push(row) }
          }
        } catch { /* skip terms that FTS5 rejects */ }
      }
      if (includeUntitled) {
        for (const row of untitledNoteRows(db, limit)) {
          if (!seen.has(row.id)) { seen.add(row.id); rows.push(row) }
        }
      }
      return rows.slice(0, limit).map(rowToNote)
    }

    const match = safeNotesFts(query, mode === 'phrase' ? 'phrase' : 'all')
    let rows: NoteRow[] = []
    if (match) {
      try {
        rows = prep(db, `
          SELECT n.* FROM notes_fts f
          JOIN notes n ON n.rowid = f.rowid
          WHERE notes_fts MATCH ?
          ORDER BY n.updated_at DESC
          LIMIT ?
        `).all(match, limit) as NoteRow[]
      } catch {
        rows = []
      }
    }
    if (includeUntitled) {
      const seen = new Set(rows.map((r) => r.id))
      for (const row of untitledNoteRows(db, limit)) {
        if (!seen.has(row.id)) { seen.add(row.id); rows.push(row) }
      }
    }
    return rows.slice(0, limit).map(rowToNote)
  })

  ipcMain.handle('notes:deleteByTag', (event, tag: string) => {
    const db = getBereanDb()
    const result = db.prepare(`DELETE FROM notes WHERE tags LIKE ?`).run(`%"${tag}"%`)
    broadcastNotesChanged(event.sender)
    return { success: true, deleted: (result as { changes: number }).changes }
  })

  // Returns all notes for a chapter. KJV and LXX are cross-linked (each sees the other's notes).
  ipcMain.handle('notes:getByChapter', (_event, bookId: string, chapter: number, textId = 'kjva') => {
    const chapterRef = `${bookId}.${chapter}`
    const prefix = `${chapterRef}.`
    const tidClause = textId === 'kjva'
      ? "(text_id = 'kjva' OR text_id IS NULL OR text_id = 'lxx')"
      : textId === 'lxx'
      ? "(text_id = 'lxx' OR text_id = 'kjva' OR text_id IS NULL)"
      : 'text_id = ?'
    // verse_ref is either the exact chapter-level form ("BOOK.CH", no verse segment —
    // e.g. a whole-chapter note) or a verse-specific form under it ("BOOK.CH.verse")
    // but NOT a deeper sub-range ("BOOK.CH.verse.something").
    const stmt = prep(getBereanDb(),
      `SELECT * FROM notes WHERE (verse_ref = ? OR (verse_ref LIKE ? AND verse_ref NOT LIKE ?)) AND ${tidClause}
       ORDER BY verse_ref ASC`
    )
    const rows = (textId === 'kjva' || textId === 'lxx'
      ? stmt.all(chapterRef, `${prefix}%`, `${prefix}%.%`)
      : stmt.all(chapterRef, `${prefix}%`, `${prefix}%.%`, textId)
    ) as NoteRow[]
    return rows.map(rowToNote)
  })

  // Returns { [verseNum]: count } for all verses in a chapter that have notes.
  // KJV and LXX are cross-linked so dots appear for both translations' notes.
  ipcMain.handle('notes:getChapterCounts', (_event, bookId: string, chapter: number, textId = 'kjva') => {
    const prefix = `${bookId}.${chapter}.`
    const tidClause = textId === 'kjva'
      ? "(text_id = 'kjva' OR text_id IS NULL OR text_id = 'lxx')"
      : textId === 'lxx'
      ? "(text_id = 'lxx' OR text_id = 'kjva' OR text_id IS NULL)"
      : 'text_id = ?'
    const stmt = prep(getBereanDb(),
      `SELECT verse_ref FROM notes WHERE verse_ref LIKE ? AND verse_ref NOT LIKE ? AND ${tidClause}`
    )
    const rows = (textId === 'kjva' || textId === 'lxx'
      ? stmt.all(`${prefix}%`, `${prefix}%.%`)
      : stmt.all(`${prefix}%`, `${prefix}%.%`, textId)
    ) as Array<{ verse_ref: string }>
    const counts: Record<number, number> = {}
    for (const { verse_ref } of rows) {
      const verseNum = parseInt(verse_ref.split('.')[2] ?? '0')
      if (verseNum) counts[verseNum] = (counts[verseNum] ?? 0) + 1
    }
    return counts
  })

  // ── Note version history (Google-Docs-style snapshots) ─────────────────────
  ipcMain.handle('notes:createVersion', (_event, noteId: string, title: string, content: string, kind = 'auto') => {
    const db = getBereanDb()
    // Skip if identical to the latest snapshot (avoid duplicate consecutive versions).
    const last = db.prepare('SELECT content FROM note_versions WHERE note_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(noteId) as { content: string } | undefined
    if (last && last.content === content) return { success: true, skipped: true }
    const id = randomUUID()
    db.prepare(`INSERT INTO note_versions (id, note_id, title, content, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, noteId, title ?? null, content, kind, Date.now())
    pruneNoteVersions(db, noteId)
    return { success: true, id }
  })

  ipcMain.handle('notes:getVersions', (_event, noteId: string) => {
    const rows = getBereanDb()
      .prepare('SELECT * FROM note_versions WHERE note_id = ? ORDER BY created_at DESC')
      .all(noteId) as VersionRow[]
    return rows.map(rowToVersion)
  })

  ipcMain.handle('notes:restoreVersion', (event, noteId: string, versionId: string) => {
    const db = getBereanDb()
    const ver = db.prepare('SELECT * FROM note_versions WHERE id = ?').get(versionId) as VersionRow | undefined
    if (!ver) return { success: false, error: 'Version not found' }
    const cur = db.prepare('SELECT title, content FROM notes WHERE id = ?').get(noteId) as { title: string | null; content: string } | undefined
    if (!cur) return { success: false, error: 'Note not found' }
    // Snapshot current content first so the restore can be undone with one click.
    if (cur.content !== ver.content) {
      db.prepare(`INSERT INTO note_versions (id, note_id, title, content, kind, created_at) VALUES (?, ?, ?, ?, 'pre-restore', ?)`)
        .run(randomUUID(), noteId, cur.title ?? null, cur.content, Date.now())
    }
    db.prepare('UPDATE notes SET content = ?, updated_at = ? WHERE id = ?').run(ver.content, Date.now(), noteId)
    pruneNoteVersions(db, noteId)
    broadcastNotesChanged(event.sender)
    return { success: true, content: ver.content }
  })

}
