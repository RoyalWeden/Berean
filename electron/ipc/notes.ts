import type { IpcMain, WebContents } from 'electron'
import { BrowserWindow } from 'electron'
import { getBereanDb } from '../db/berean'
import { randomUUID } from 'crypto'
import { numberTokenAlternates } from './numberWords'
import { moveNoteToVaultTrash, restoreNoteFromVaultTrash, purgeNoteFromVaultTrash, type NoteRow as VaultNoteRow } from './vault'
import { equivalentChapters } from '@/lib/translationChapterMap'

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
  icon: string | null
  status: string | null
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
  deleted_at: number | null
  pinned: number | null
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
    icon:         row.icon ?? undefined,
    status:       row.status ?? undefined,
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
    deletedAt:         row.deleted_at ?? undefined,
    pinned:            row.pinned === 1,
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
    type?: string; title?: string; content?: string; verseRef?: string; color?: string; icon?: string; status?: string | null; tags?: string[]; textId?: string; folderId?: string | null; idiomTerm?: string; idiomMeaning?: string; idiomAliases?: string[]; idiomAutoVariants?: boolean
  }) => {
    const db = getBereanDb()
    const id = randomUUID()
    const now = Date.now()
    // Apply the user's configured default only when the caller didn't explicitly pass a
    // status (including explicitly passing null/'' to mean "no status") — centralized here
    // rather than at each of the ~7 note-creation call sites in the renderer.
    let status = data.status ?? null
    if (data.status === undefined) {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('defaultNoteStatus') as { value: string } | undefined
      const defaultStatus = row ? (JSON.parse(row.value) as string) : 'none'
      status = defaultStatus && defaultStatus !== 'none' ? defaultStatus : null
    }
    db.prepare(`
      INSERT INTO notes (id, type, title, content, verse_ref, color, icon, status, created_at, updated_at, tags, text_id, folder_id, idiom_term, idiom_meaning, idiom_aliases, idiom_auto_variants)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      data.type ?? 'general',
      data.title ?? null,
      data.content ?? '',
      data.verseRef ?? null,
      data.color ?? 'blue',
      data.icon ?? null,
      status,
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
    title?: string; content?: string; color?: string; icon?: string | null; status?: string | null; tags?: string[]; idiomTerm?: string; idiomMeaning?: string; idiomAliases?: string[]; idiomAutoVariants?: boolean; idiomData?: unknown
  }) => {
    const db = getBereanDb()
    const existing = db.prepare('SELECT id FROM notes WHERE id = ?').get(id)
    if (!existing) return { success: false, error: 'Note not found' }

    const fields: string[] = ['updated_at = ?']
    const values: unknown[] = [Date.now()]

    if (data.title !== undefined) { fields.push('title = ?'); values.push(data.title) }
    if (data.content !== undefined) { fields.push('content = ?'); values.push(data.content) }
    if (data.color !== undefined) { fields.push('color = ?'); values.push(data.color) }
    if (data.icon !== undefined) { fields.push('icon = ?'); values.push(data.icon || null) }
    if (data.status !== undefined) { fields.push('status = ?'); values.push(data.status || null) }
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
      .prepare(`SELECT id, title, idiom_term, idiom_meaning, idiom_aliases, idiom_auto_variants FROM notes WHERE type = 'idiom' AND idiom_term IS NOT NULL AND deleted_at IS NULL ORDER BY idiom_term COLLATE NOCASE ASC`)
      .all() as Array<{ id: string; title: string | null; idiom_term: string; idiom_meaning: string | null; idiom_aliases: string | null; idiom_auto_variants: number | null }>
    return rows.map(r => ({
      id: r.id,
      term: r.idiom_term,
      meaning: r.idiom_meaning ?? '',
      aliases: r.idiom_aliases ? (JSON.parse(r.idiom_aliases) as string[]) : [],
      autoVariants: r.idiom_auto_variants === 1,
    }))
  })

  // Soft-delete — moves the note to Trash rather than removing it. `note_versions` is left
  // alone (was previously hard-deleted alongside the note here) so version history survives
  // until the note is actually purged. See notes:restore/listTrash/purgeTrashItem/emptyTrash
  // below for the rest of the trash lifecycle, and vault.ts for the matching vault-file move.
  ipcMain.handle('notes:delete', (event, id: string) => {
    const db = getBereanDb()
    const before = db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as NoteRow | undefined
    db.prepare('UPDATE notes SET deleted_at = ? WHERE id = ?').run(Date.now(), id)
    if (before) moveNoteToVaultTrash(before as unknown as VaultNoteRow)
    broadcastNotesChanged(event.sender)
    return { success: true }
  })

  // Undo a soft-delete. If the note's own folder was itself hard-deleted in the meantime
  // (folders:deleteDeep removes folder rows outright — see below), fall back to root (NULL)
  // rather than restoring into a folder_id that no longer exists.
  ipcMain.handle('notes:restore', (event, id: string) => {
    const db = getBereanDb()
    const note = db.prepare('SELECT folder_id FROM notes WHERE id = ?').get(id) as { folder_id: string | null } | undefined
    if (!note) return { success: false, error: 'Note not found' }
    let folderId = note.folder_id
    if (folderId) {
      const exists = db.prepare('SELECT 1 FROM note_folders WHERE id = ?').get(folderId)
      if (!exists) folderId = null
    }
    db.prepare('UPDATE notes SET deleted_at = NULL, folder_id = ? WHERE id = ?').run(folderId, id)
    const after = db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as NoteRow
    restoreNoteFromVaultTrash(after as unknown as VaultNoteRow)
    broadcastNotesChanged(event.sender)
    return { success: true }
  })

  ipcMain.handle('notes:listTrash', () => {
    const rows = getBereanDb()
      .prepare('SELECT * FROM notes WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC')
      .all() as NoteRow[]
    return rows.map(rowToNote)
  })

  // Permanent, real DELETE — used by both the manual "Empty Trash" action and the 30-day
  // auto-purge timer (electron/ipc/vault.ts's setupTrashPurge). Only ever operates on rows
  // that are ALREADY soft-deleted, as a defensive belt-and-suspenders check (a stray call with
  // a live note's id should never permanently destroy it outside the normal delete flow).
  ipcMain.handle('notes:purgeTrashItem', (event, id: string) => {
    const db = getBereanDb()
    const row = db.prepare('SELECT deleted_at FROM notes WHERE id = ?').get(id) as { deleted_at: number | null } | undefined
    if (!row || row.deleted_at == null) return { success: false, error: 'Note is not in trash' }
    db.prepare('DELETE FROM note_versions WHERE note_id = ?').run(id)
    db.prepare('DELETE FROM note_heading_collapse WHERE note_id = ?').run(id)
    db.prepare('DELETE FROM note_thread_collapse WHERE note_id = ?').run(id)
    db.prepare('DELETE FROM notes WHERE id = ?').run(id)
    purgeNoteFromVaultTrash(id)
    broadcastNotesChanged(event.sender)
    return { success: true }
  })

  ipcMain.handle('notes:emptyTrash', (event) => {
    const db = getBereanDb()
    const ids = (db.prepare('SELECT id FROM notes WHERE deleted_at IS NOT NULL').all() as Array<{ id: string }>).map((r) => r.id)
    const tx = db.transaction(() => {
      for (const id of ids) {
        db.prepare('DELETE FROM note_versions WHERE note_id = ?').run(id)
        db.prepare('DELETE FROM note_heading_collapse WHERE note_id = ?').run(id)
        db.prepare('DELETE FROM note_thread_collapse WHERE note_id = ?').run(id)
        db.prepare('DELETE FROM notes WHERE id = ?').run(id)
      }
    })
    tx()
    for (const id of ids) purgeNoteFromVaultTrash(id)
    broadcastNotesChanged(event.sender)
    return { success: true, purged: ids }
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

  // Delete a folder AND its contents: recursively removes all descendant folders (hard-deleted
  // — folders themselves aren't trash items in this design) and moves every note contained in
  // any of them to Trash (soft-deleted, same as a normal notes:delete) rather than destroying
  // them outright. Restoring one of these notes later falls back to root, since its folder_id
  // no longer resolves to a real folder — see notes:restore above.
  ipcMain.handle('folders:deleteDeep', (event, id: string) => {
    const db = getBereanDb()
    let trashedNotes: NoteRow[] = []
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
      const getNotes = db.prepare('SELECT * FROM notes WHERE folder_id = ? AND deleted_at IS NULL')
      const trashNotes = db.prepare('UPDATE notes SET deleted_at = ? WHERE folder_id = ?')
      const delFolder = db.prepare('DELETE FROM note_folders WHERE id = ?')
      const now = Date.now()
      for (const fid of toDelete) {
        trashedNotes.push(...(getNotes.all(fid) as NoteRow[]))
        trashNotes.run(now, fid)
        delFolder.run(fid)
      }
    })
    tx()
    for (const note of trashedNotes) moveNoteToVaultTrash(note as unknown as VaultNoteRow)
    broadcastNotesChanged(event.sender)
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

  // Pin/unpin a note — pinned notes sort to the top of NotesList.tsx.
  ipcMain.handle('notes:setPinned', (event, noteId: string, pinned: boolean) => {
    getBereanDb().prepare('UPDATE notes SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, noteId)
    broadcastNotesChanged(event.sender)
    return { success: true }
  })

  ipcMain.handle('notes:deleteAll', (event) => {
    getBereanDb().prepare('DELETE FROM notes').run()
    broadcastNotesChanged(event.sender)
    return { success: true }
  })

  ipcMain.handle('notes:getAll', (_event, limit = 200, offset = 0) => {
    const rows = prep(getBereanDb(), 'SELECT * FROM notes WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT ? OFFSET ?')
      .all(limit, offset) as NoteRow[]
    return rows.map(rowToNote)
  })

  ipcMain.handle('notes:getByVerse', (_event, verseRef: string, textId = 'kjva') => {
    // KJV and LXX are cross-linked: each shows the other's notes with a translation badge
    // so study connections are always visible. Own-translation notes come first, then cross.
    //
    // Psalms is the one book where KJV and LXX chapter numbers diverge (merges/splits
    // around Pss 9-10, 114-118, 146-147 — see translationChapterMap.ts), so the OTHER
    // translation's cross-linked notes must be looked up under ITS OWN equivalent
    // chapter number(s), not the literal chapter typed into `verseRef`. `equivalentChapters`
    // is the identity mapping for every other book, so this is a no-op there.
    const parts = verseRef.split('.')
    const bookId = parts[0]
    const chapter = parseInt(parts[1] ?? '', 10)
    const verseNum = parts[2]
    const db = getBereanDb()

    if (textId !== 'kjva' && textId !== 'lxx') {
      const rows = prep(db, 'SELECT * FROM notes WHERE verse_ref = ? AND text_id = ? AND deleted_at IS NULL ORDER BY created_at ASC')
        .all(verseRef, textId) as NoteRow[]
      return rows.map(rowToNote)
    }

    const otherTextId = textId === 'kjva' ? 'lxx' : 'kjva'
    const ownRows = prep(db,
      textId === 'kjva'
        ? "SELECT * FROM notes WHERE verse_ref = ? AND (text_id = 'kjva' OR text_id IS NULL) AND deleted_at IS NULL ORDER BY created_at ASC"
        : "SELECT * FROM notes WHERE verse_ref = ? AND text_id = 'lxx' AND deleted_at IS NULL ORDER BY created_at ASC"
    ).all(verseRef) as NoteRow[]

    const otherRows: NoteRow[] = []
    if (bookId && Number.isFinite(chapter) && verseNum) {
      const otherChapters = equivalentChapters(bookId, chapter, textId, otherTextId)
      const otherTidClause = otherTextId === 'kjva' ? "(text_id = 'kjva' OR text_id IS NULL)" : "text_id = 'lxx'"
      const stmt = prep(db, `SELECT * FROM notes WHERE verse_ref = ? AND ${otherTidClause} AND deleted_at IS NULL ORDER BY created_at ASC`)
      const seen = new Set<string>()
      for (const ch of otherChapters) {
        const otherRef = `${bookId}.${ch}.${verseNum}`
        for (const row of stmt.all(otherRef) as NoteRow[]) {
          if (!seen.has(row.id)) { seen.add(row.id); otherRows.push(row) }
        }
      }
    }

    const combined = [...ownRows, ...otherRows]
    combined.sort((a, b) => a.created_at - b.created_at)
    return combined.map(rowToNote)
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
    return prep(db, `SELECT * FROM notes WHERE title = '' AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?`).all(limit) as NoteRow[]
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
          WHERE notes_fts MATCH ? AND n.deleted_at IS NULL
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
          WHERE notes_fts MATCH ? AND n.deleted_at IS NULL
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

  // How many live notes contain an inline "#<name>" verse-tag reference in their body.
  // Used to warn before deleting a verse tag (Tag Manager). Simple substring match — a
  // slight over-count (e.g. "#name" inside a code span) is acceptable for a confirm prompt.
  ipcMain.handle('notes:countTagRefs', (_event, name: string) => {
    const db = getBereanDb()
    const row = db.prepare(
      `SELECT COUNT(*) AS n FROM notes WHERE deleted_at IS NULL AND content LIKE '%#' || ? || '%'`,
    ).get(name) as { n: number }
    return { count: row.n }
  })

  // Returns all notes for a chapter. KJV and LXX are cross-linked (each sees the other's notes).
  //
  // Psalms is the one book where KJV and LXX chapter numbers diverge (merges/splits around
  // Pss 9-10, 114-118, 146-147 — see translationChapterMap.ts), so the cross-linked
  // translation's notes are looked up under ITS OWN equivalent chapter(s) via
  // `equivalentChapters`, not the literal chapter number on screen. That mapping is a
  // no-op for every other book, so non-Psalms behavior is unchanged.
  function notesForChapterAndTid(db: ReturnType<typeof getBereanDb>, bookId: string, chapter: number, tidClause: string, tidParam?: string): NoteRow[] {
    const chapterRef = `${bookId}.${chapter}`
    const prefix = `${chapterRef}.`
    // verse_ref is either the exact chapter-level form ("BOOK.CH", no verse segment —
    // e.g. a whole-chapter note) or a verse-specific form under it ("BOOK.CH.verse")
    // but NOT a deeper sub-range ("BOOK.CH.verse.something").
    const stmt = prep(db,
      `SELECT * FROM notes WHERE (verse_ref = ? OR (verse_ref LIKE ? AND verse_ref NOT LIKE ?)) AND deleted_at IS NULL AND ${tidClause}`
    )
    return (tidParam
      ? stmt.all(chapterRef, `${prefix}%`, `${prefix}%.%`, tidParam)
      : stmt.all(chapterRef, `${prefix}%`, `${prefix}%.%`)
    ) as NoteRow[]
  }

  ipcMain.handle('notes:getByChapter', (_event, bookId: string, chapter: number, textId = 'kjva') => {
    const db = getBereanDb()

    if (textId !== 'kjva' && textId !== 'lxx') {
      const rows = notesForChapterAndTid(db, bookId, chapter, 'text_id = ?', textId)
      rows.sort((a, b) => (a.verse_ref ?? '').localeCompare(b.verse_ref ?? ''))
      return rows.map(rowToNote)
    }

    const ownTid = textId === 'kjva' ? "(text_id = 'kjva' OR text_id IS NULL)" : "text_id = 'lxx'"
    const ownRows = notesForChapterAndTid(db, bookId, chapter, ownTid)

    const otherTextId = textId === 'kjva' ? 'lxx' : 'kjva'
    const otherTid = otherTextId === 'kjva' ? "(text_id = 'kjva' OR text_id IS NULL)" : "text_id = 'lxx'"
    const seen = new Set(ownRows.map((r) => r.id))
    const otherRows: NoteRow[] = []
    for (const ch of equivalentChapters(bookId, chapter, textId, otherTextId)) {
      for (const row of notesForChapterAndTid(db, bookId, ch, otherTid)) {
        if (!seen.has(row.id)) { seen.add(row.id); otherRows.push(row) }
      }
    }

    const combined = [...ownRows, ...otherRows]
    combined.sort((a, b) => (a.verse_ref ?? '').localeCompare(b.verse_ref ?? ''))
    return combined.map(rowToNote)
  })

  // Returns { [verseNum]: count } for all verses in a chapter that have notes.
  // KJV and LXX are cross-linked so dots appear for both translations' notes. Same
  // equivalent-chapter mapping as notes:getByChapter above; verse numbers within a merge
  // chapter are used as-is (verse-level splits are ignored — same simplification
  // translationChapterMap.ts's navigation mapping already makes).
  function chapterVerseRefsForTid(db: ReturnType<typeof getBereanDb>, bookId: string, chapter: number, tidClause: string, tidParam?: string): string[] {
    const prefix = `${bookId}.${chapter}.`
    const stmt = prep(db,
      `SELECT verse_ref FROM notes WHERE verse_ref LIKE ? AND verse_ref NOT LIKE ? AND deleted_at IS NULL AND ${tidClause}`
    )
    const rows = (tidParam
      ? stmt.all(`${prefix}%`, `${prefix}%.%`, tidParam)
      : stmt.all(`${prefix}%`, `${prefix}%.%`)
    ) as Array<{ verse_ref: string }>
    return rows.map((r) => r.verse_ref)
  }

  ipcMain.handle('notes:getChapterCounts', (_event, bookId: string, chapter: number, textId = 'kjva') => {
    const db = getBereanDb()
    let verseRefs: string[]

    if (textId !== 'kjva' && textId !== 'lxx') {
      verseRefs = chapterVerseRefsForTid(db, bookId, chapter, 'text_id = ?', textId)
    } else {
      const ownTid = textId === 'kjva' ? "(text_id = 'kjva' OR text_id IS NULL)" : "text_id = 'lxx'"
      const otherTextId = textId === 'kjva' ? 'lxx' : 'kjva'
      const otherTid = otherTextId === 'kjva' ? "(text_id = 'kjva' OR text_id IS NULL)" : "text_id = 'lxx'"
      verseRefs = chapterVerseRefsForTid(db, bookId, chapter, ownTid)
      for (const ch of equivalentChapters(bookId, chapter, textId, otherTextId)) {
        verseRefs.push(...chapterVerseRefsForTid(db, bookId, ch, otherTid))
      }
    }

    const counts: Record<number, number> = {}
    for (const verse_ref of verseRefs) {
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

  // ── Heading collapse persistence (round 12 item 6) ─────────────────────────
  // See berean.ts's v24 migration comment for why this is keyed by a stable `heading_key`
  // string rather than a document position, and why it's a separate table rather than
  // markdown content. Every row is scoped to one note_id — no cross-note leakage possible
  // even if two notes happen to compute the same heading_key.
  ipcMain.handle('notes:getCollapsedHeadings', (_event, noteId: string) => {
    const rows = getBereanDb()
      .prepare('SELECT heading_key FROM note_heading_collapse WHERE note_id = ? AND collapsed = 1')
      .all(noteId) as Array<{ heading_key: string }>
    return rows.map((r) => r.heading_key)
  })

  ipcMain.handle('notes:setHeadingCollapsed', (_event, noteId: string, headingKey: string, collapsed: boolean) => {
    const db = getBereanDb()
    if (collapsed) {
      db.prepare('INSERT OR REPLACE INTO note_heading_collapse (note_id, heading_key, collapsed) VALUES (?, ?, 1)')
        .run(noteId, headingKey)
    } else {
      // Un-collapsing just deletes the row rather than writing collapsed=0 — a note with
      // every heading expanded (the common case) then has ZERO rows instead of one per
      // heading, keeping this table's steady-state size proportional to "how much is
      // actually collapsed right now," not "how many headings have ever existed."
      db.prepare('DELETE FROM note_heading_collapse WHERE note_id = ? AND heading_key = ?').run(noteId, headingKey)
    }
    return { success: true }
  })

  // ── Thread collapse persistence (notes editor threads feature) ────────────
  // Thread-node counterpart of the heading-collapse handlers just above — see berean.ts's v27
  // migration comment for why `threadKey` here is simply the thread's own `threadId` attr
  // rather than a derived key. Same per-note_id scoping, same "un-collapsing deletes the row"
  // steady-state-size rationale.
  ipcMain.handle('notes:getCollapsedThreads', (_event, noteId: string) => {
    const rows = getBereanDb()
      .prepare('SELECT thread_key FROM note_thread_collapse WHERE note_id = ? AND collapsed = 1')
      .all(noteId) as Array<{ thread_key: string }>
    return rows.map((r) => r.thread_key)
  })

  ipcMain.handle('notes:setThreadCollapsed', (_event, noteId: string, threadKey: string, collapsed: boolean) => {
    const db = getBereanDb()
    if (collapsed) {
      db.prepare('INSERT OR REPLACE INTO note_thread_collapse (note_id, thread_key, collapsed) VALUES (?, ?, 1)')
        .run(noteId, threadKey)
    } else {
      db.prepare('DELETE FROM note_thread_collapse WHERE note_id = ? AND thread_key = ?').run(noteId, threadKey)
    }
    return { success: true }
  })

}
