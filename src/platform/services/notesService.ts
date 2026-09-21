import { placeholders } from '../db/DatabaseAdapter'
import type { ServiceContext } from './context'
import { numberTokenAlternates } from '../../lib/numberWords'
import { equivalentChapters } from '../../lib/translationChapterMap'

/**
 * Notes + note-folders access — extracted verbatim from electron/ipc/notes.ts (Phase 1/3). The
 * SQL and the result shapes are unchanged; only the execution is async through DatabaseAdapter.
 *
 * The old `broadcastNotesChanged(exclude)` BrowserWindow fan-out is replaced by
 * `ctx.events.emit('data:changed', { entity, id, op })` after every mutation (electron/servicesHost.ts
 * turns `note`/`note_folder`/`note_version` entities back into the `notes:changed` broadcast, still
 * skipping the originating window via `withSender`). Vault file side effects
 * (moveNoteToVaultTrash/restoreNoteFromVaultTrash/purgeNoteFromVaultTrash) are NOT DB logic and stay
 * in electron/ipc/notes.ts, wrapped around the relevant service calls below.
 */

export type NotesWordMode = 'all' | 'any' | 'phrase'

export interface NoteRow {
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

export interface VersionRow { id: string; note_id: string; title: string | null; content: string | null; kind: string; created_at: number }
function rowToVersion(r: VersionRow) {
  return { id: r.id, noteId: r.note_id, title: r.title ?? '', content: r.content ?? '', kind: r.kind, createdAt: r.created_at }
}

/** Split a raw query into cleaned, FTS5-safe word tokens. Splits on the same
 *  punctuation classes the `unicode61` tokenizer splits on (whitespace, colons,
 *  hyphens, periods, etc.) rather than stripping punctuation and gluing the
 *  surrounding digits together — verse-reference-shaped titles like
 *  "Genesis 1:1-3" must tokenize as ["Genesis","1","1","3"], matching how
 *  notes_fts itself indexes that same text, not as a single glued "113" token
 *  that never appears in the index. */
export function cleanNotesWords(query: string): string[] {
  return query.trim().split(/[^a-zA-Z0-9']+/).filter(w => w.length >= 1)
}

// Build an FTS5 MATCH expression for a notes search. `mode` is passed explicitly by
// the caller rather than sniffed from the query string, mirroring bibleService's
// safeFtsQuery — same reasoning: a literal "OR" or quote mark typed as part of the
// user's own query text must not silently flip the mode the UI shows as selected.
//   'all'    (default) — every word must appear (prefix-matched), the original/only
//            behavior this function had before word-modes existed.
//   'phrase' — the words as one exact contiguous phrase (no per-word prefix).
//   'any'    — handled by the caller, not here (see search() below): FTS5 OR with
//            prefix wildcards is unreliable for common/short tokens, so 'any' mode
//            runs one query per word and unions results in JS instead, same
//            approach bibleService's searchText already uses for the same reason.
export function safeNotesFts(query: string, mode: 'all' | 'phrase' = 'all'): string {
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

export function createNotesService(ctx: ServiceContext) {
  const db = () => ctx.userDb

  /**
   * Prune a note's version history: keep everything from the last 7 days, then keep only
   * one (the newest) version per calendar day older than that, capped at 50 total. Always
   * keep the most recent version and any 'pre-restore'/'manual' snapshots within the cap.
   */
  async function pruneNoteVersions(noteId: string): Promise<void> {
    const rows = await db().all<{ id: string; kind: string; created_at: number }>(
      'SELECT id, kind, created_at FROM note_versions WHERE note_id = ? ORDER BY created_at DESC', [noteId])
    if (rows.length <= 50) return
    const weekAgo = ctx.now() - 7 * 24 * 60 * 60 * 1000
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
      await db().run(`DELETE FROM note_versions WHERE id IN (${placeholders(toDelete.length)})`, toDelete)
    }
  }

  async function create(data: {
    type?: string; title?: string; content?: string; verseRef?: string; color?: string; icon?: string; status?: string | null; tags?: string[]; textId?: string; folderId?: string | null; idiomTerm?: string; idiomMeaning?: string; idiomAliases?: string[]; idiomAutoVariants?: boolean
  }) {
    const id = ctx.uuid()
    const now = ctx.now()
    // Apply the user's configured default only when the caller didn't explicitly pass a
    // status (including explicitly passing null/'' to mean "no status") — centralized here
    // rather than at each of the ~7 note-creation call sites in the renderer.
    let status = data.status ?? null
    if (data.status === undefined) {
      const row = await db().get<{ value: string }>('SELECT value FROM settings WHERE key = ?', ['defaultNoteStatus'])
      const defaultStatus = row ? (JSON.parse(row.value) as string) : 'none'
      status = defaultStatus && defaultStatus !== 'none' ? defaultStatus : null
    }
    await db().run(`
      INSERT INTO notes (id, type, title, content, verse_ref, color, icon, status, created_at, updated_at, tags, text_id, folder_id, idiom_term, idiom_meaning, idiom_aliases, idiom_auto_variants)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
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
      data.idiomAutoVariants ? 1 : 0,
    ])
    const row = await db().get<NoteRow>('SELECT * FROM notes WHERE id = ?', [id])
    ctx.events.emit('data:changed', { entity: 'note', id, op: 'upsert' })
    return { success: true, note: rowToNote(row!) }
  }

  async function update(id: string, data: {
    title?: string; content?: string; color?: string; icon?: string | null; status?: string | null; tags?: string[]; idiomTerm?: string; idiomMeaning?: string; idiomAliases?: string[]; idiomAutoVariants?: boolean; idiomData?: unknown
  }) {
    const existing = await db().get<{ id: string }>('SELECT id FROM notes WHERE id = ?', [id])
    if (!existing) return { success: false, error: 'Note not found' }

    const fields: string[] = ['updated_at = ?']
    const values: Array<string | number | null> = [ctx.now()]

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
    await db().run(`UPDATE notes SET ${fields.join(', ')} WHERE id = ?`, values)
    ctx.events.emit('data:changed', { entity: 'note', id, op: 'upsert' })
    return { success: true }
  }

  async function listIdioms() {
    const rows = await db().all<{ id: string; title: string | null; idiom_term: string; idiom_meaning: string | null; idiom_aliases: string | null; idiom_auto_variants: number | null }>(
      `SELECT id, title, idiom_term, idiom_meaning, idiom_aliases, idiom_auto_variants FROM notes WHERE type = 'idiom' AND idiom_term IS NOT NULL AND deleted_at IS NULL ORDER BY idiom_term COLLATE NOCASE ASC`)
    return rows.map(r => ({
      id: r.id,
      term: r.idiom_term,
      meaning: r.idiom_meaning ?? '',
      aliases: r.idiom_aliases ? (JSON.parse(r.idiom_aliases) as string[]) : [],
      autoVariants: r.idiom_auto_variants === 1,
    }))
  }

  // Soft-delete — moves the note to Trash rather than removing it. `note_versions` is left
  // alone (was previously hard-deleted alongside the note here) so version history survives
  // until the note is actually purged. See restore/listTrash/purgeTrashItem/emptyTrash below
  // for the rest of the trash lifecycle. The matching vault-file move
  // (moveNoteToVaultTrash) is not DB logic and is done by the caller in electron/ipc/notes.ts.
  async function del(id: string) {
    await db().run('UPDATE notes SET deleted_at = ? WHERE id = ?', [ctx.now(), id])
    ctx.events.emit('data:changed', { entity: 'note', id, op: 'delete' })
    return { success: true }
  }

  // Undo a soft-delete. If the note's own folder was itself hard-deleted in the meantime
  // (folderDeleteDeep removes folder rows outright — see below), fall back to root (NULL)
  // rather than restoring into a folder_id that no longer exists.
  async function restore(id: string) {
    const note = await db().get<{ folder_id: string | null }>('SELECT folder_id FROM notes WHERE id = ?', [id])
    if (!note) return { success: false, error: 'Note not found' }
    let folderId = note.folder_id
    if (folderId) {
      const exists = await db().get('SELECT 1 FROM note_folders WHERE id = ?', [folderId])
      if (!exists) folderId = null
    }
    await db().run('UPDATE notes SET deleted_at = NULL, folder_id = ? WHERE id = ?', [folderId, id])
    ctx.events.emit('data:changed', { entity: 'note', id, op: 'upsert' })
    return { success: true }
  }

  async function listTrash() {
    const rows = await db().all<NoteRow>('SELECT * FROM notes WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC')
    return rows.map(rowToNote)
  }

  // Permanent, real DELETE — used by both the manual "Empty Trash" action and the 30-day
  // auto-purge timer. Only ever operates on rows that are ALREADY soft-deleted, as a defensive
  // belt-and-suspenders check (a stray call with a live note's id should never permanently
  // destroy it outside the normal delete flow).
  async function purgeTrashItem(id: string) {
    const row = await db().get<{ deleted_at: number | null }>('SELECT deleted_at FROM notes WHERE id = ?', [id])
    if (!row || row.deleted_at == null) return { success: false, error: 'Note is not in trash' }
    await db().run('DELETE FROM note_versions WHERE note_id = ?', [id])
    await db().run('DELETE FROM note_heading_collapse WHERE note_id = ?', [id])
    await db().run('DELETE FROM note_thread_collapse WHERE note_id = ?', [id])
    await db().run('DELETE FROM notes WHERE id = ?', [id])
    ctx.events.emit('data:changed', { entity: 'note', id, op: 'delete' })
    return { success: true }
  }

  async function emptyTrash() {
    const idRows = await db().all<{ id: string }>('SELECT id FROM notes WHERE deleted_at IS NOT NULL')
    const ids = idRows.map(r => r.id)
    await db().transaction(async (tx) => {
      for (const id of ids) {
        await tx.run('DELETE FROM note_versions WHERE note_id = ?', [id])
        await tx.run('DELETE FROM note_heading_collapse WHERE note_id = ?', [id])
        await tx.run('DELETE FROM note_thread_collapse WHERE note_id = ?', [id])
        await tx.run('DELETE FROM notes WHERE id = ?', [id])
      }
    })
    ctx.events.emit('data:changed', { entity: 'note', op: 'bulk' })
    return { success: true, purged: ids }
  }

  // ── Note folders (user-created, nestable) ──────────────────────────────────
  async function folderList() {
    const rows = await db().all<{ id: string; name: string; parent_id: string | null; created_at: number }>(
      'SELECT id, name, parent_id, created_at FROM note_folders ORDER BY name COLLATE NOCASE')
    return rows.map((r) => ({ id: r.id, name: r.name, parentId: r.parent_id ?? null, createdAt: r.created_at }))
  }

  async function folderCreate(name: string, parentId: string | null = null) {
    const id = ctx.uuid()
    await db().run('INSERT INTO note_folders (id, name, parent_id, created_at) VALUES (?, ?, ?, ?)', [id, name || 'New Folder', parentId, ctx.now()])
    ctx.events.emit('data:changed', { entity: 'note_folder', id, op: 'upsert' })
    return { success: true, id }
  }

  async function folderRename(id: string, name: string) {
    await db().run('UPDATE note_folders SET name = ? WHERE id = ?', [name, id])
    ctx.events.emit('data:changed', { entity: 'note_folder', id, op: 'upsert' })
    return { success: true }
  }

  // Delete a folder: reparent child folders to this folder's parent, and move
  // contained notes to root (folder_id = NULL). Never deletes notes.
  async function folderDelete(id: string) {
    const folder = await db().get<{ parent_id: string | null }>('SELECT parent_id FROM note_folders WHERE id = ?', [id])
    const parentId = folder?.parent_id ?? null
    await db().transaction(async (tx) => {
      await tx.run('UPDATE note_folders SET parent_id = ? WHERE parent_id = ?', [parentId, id])
      await tx.run('UPDATE notes SET folder_id = NULL WHERE folder_id = ?', [id])
      await tx.run('DELETE FROM note_folders WHERE id = ?', [id])
    })
    ctx.events.emit('data:changed', { entity: 'note_folder', id, op: 'delete' })
    return { success: true }
  }

  // Delete a folder AND its contents: recursively removes all descendant folders (hard-deleted
  // — folders themselves aren't trash items in this design) and moves every note contained in
  // any of them to Trash (soft-deleted, same as a normal delete()) rather than destroying them
  // outright. Restoring one of these notes later falls back to root, since its folder_id no
  // longer resolves to a real folder — see restore() above. Returns the trashed note rows (raw
  // DB shape) so the caller in electron/ipc/notes.ts can move each one's vault file to trash —
  // that vault side effect is not DB logic and stays there.
  async function folderDeleteDeep(id: string) {
    const trashedNotes: NoteRow[] = []
    await db().transaction(async (tx) => {
      const all = await tx.all<{ id: string; parent_id: string | null }>('SELECT id, parent_id FROM note_folders')
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
      const now = ctx.now()
      for (const fid of toDelete) {
        const notes = await tx.all<NoteRow>('SELECT * FROM notes WHERE folder_id = ? AND deleted_at IS NULL', [fid])
        trashedNotes.push(...notes)
        await tx.run('UPDATE notes SET deleted_at = ? WHERE folder_id = ?', [now, fid])
        await tx.run('DELETE FROM note_folders WHERE id = ?', [fid])
      }
    })
    ctx.events.emit('data:changed', { entity: 'note_folder', id, op: 'delete' })
    if (trashedNotes.length) ctx.events.emit('data:changed', { entity: 'note', op: 'bulk' })
    return { success: true, trashedNotes }
  }

  // Set a folder's parent (for nesting). Guards against cycles.
  async function folderSetParent(id: string, parentId: string | null) {
    // Walk up from the proposed parent; if we reach `id`, it would create a cycle.
    let cur: string | null = parentId
    while (cur) {
      if (cur === id) return { success: false, error: 'cycle' }
      const row = await db().get<{ parent_id: string | null }>('SELECT parent_id FROM note_folders WHERE id = ?', [cur])
      cur = row?.parent_id ?? null
    }
    await db().run('UPDATE note_folders SET parent_id = ? WHERE id = ?', [parentId, id])
    ctx.events.emit('data:changed', { entity: 'note_folder', id, op: 'upsert' })
    return { success: true }
  }

  // Assign a note to a user folder (or NULL for root).
  async function setFolder(noteId: string, folderId: string | null) {
    await db().run('UPDATE notes SET folder_id = ? WHERE id = ?', [folderId, noteId])
    ctx.events.emit('data:changed', { entity: 'note', id: noteId, op: 'upsert' })
    return { success: true }
  }

  // Pin/unpin a note — pinned notes sort to the top of NotesList.tsx.
  async function setPinned(noteId: string, pinned: boolean) {
    await db().run('UPDATE notes SET pinned = ? WHERE id = ?', [pinned ? 1 : 0, noteId])
    ctx.events.emit('data:changed', { entity: 'note', id: noteId, op: 'upsert' })
    return { success: true }
  }

  async function deleteAll() {
    await db().run('DELETE FROM notes')
    ctx.events.emit('data:changed', { entity: 'note', op: 'bulk' })
    return { success: true }
  }

  async function getAll(limit = 200, offset = 0) {
    const rows = await db().all<NoteRow>('SELECT * FROM notes WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT ? OFFSET ?', [limit, offset])
    return rows.map(rowToNote)
  }

  async function getByVerse(verseRef: string, textId = 'kjva') {
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

    if (textId !== 'kjva' && textId !== 'lxx') {
      const rows = await db().all<NoteRow>('SELECT * FROM notes WHERE verse_ref = ? AND text_id = ? AND deleted_at IS NULL ORDER BY created_at ASC', [verseRef, textId])
      return rows.map(rowToNote)
    }

    const otherTextId = textId === 'kjva' ? 'lxx' : 'kjva'
    const ownRows = await db().all<NoteRow>(
      textId === 'kjva'
        ? "SELECT * FROM notes WHERE verse_ref = ? AND (text_id = 'kjva' OR text_id IS NULL) AND deleted_at IS NULL ORDER BY created_at ASC"
        : "SELECT * FROM notes WHERE verse_ref = ? AND text_id = 'lxx' AND deleted_at IS NULL ORDER BY created_at ASC",
      [verseRef],
    )

    const otherRows: NoteRow[] = []
    if (bookId && Number.isFinite(chapter) && verseNum) {
      const otherChapters = equivalentChapters(bookId, chapter, textId, otherTextId)
      const otherTidClause = otherTextId === 'kjva' ? "(text_id = 'kjva' OR text_id IS NULL)" : "text_id = 'lxx'"
      const seen = new Set<string>()
      for (const ch of otherChapters) {
        const otherRef = `${bookId}.${ch}.${verseNum}`
        const rows = await db().all<NoteRow>(`SELECT * FROM notes WHERE verse_ref = ? AND ${otherTidClause} AND deleted_at IS NULL ORDER BY created_at ASC`, [otherRef])
        for (const row of rows) {
          if (!seen.has(row.id)) { seen.add(row.id); otherRows.push(row) }
        }
      }
    }

    const combined = [...ownRows, ...otherRows]
    combined.sort((a, b) => a.created_at - b.created_at)
    return combined.map(rowToNote)
  }

  async function getOne(id: string) {
    const row = await db().get<NoteRow>('SELECT * FROM notes WHERE id = ?', [id])
    return row ? rowToNote(row) : null
  }

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
  async function untitledNoteRows(limit: number): Promise<NoteRow[]> {
    // A note created without a title stores NULL; treat it as untitled too (K8).
    return db().all<NoteRow>(`SELECT * FROM notes WHERE (title = '' OR title IS NULL) AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?`, [limit])
  }

  async function search(query: string, limit = 20, mode: NotesWordMode = 'all') {
    const includeUntitled = matchesUntitledQuery(query)

    // 'any' mode: one FTS5 query per word, union + de-dupe in JS — see safeNotesFts's
    // comment for why this can't just be an FTS5 OR expression.
    if (mode === 'any') {
      const terms = cleanNotesWords(query)
      const seen = new Set<string>()
      const rows: NoteRow[] = []
      for (const term of terms) {
        const ftsQ = safeNotesFts(term, 'all')
        if (!ftsQ) continue
        try {
          const termRows = await db().all<NoteRow>(`
            SELECT n.* FROM notes_fts f
            JOIN notes n ON n.rowid = f.rowid
            WHERE notes_fts MATCH ? AND n.deleted_at IS NULL
            ORDER BY n.updated_at DESC
            LIMIT ?
          `, [ftsQ, Math.max(limit * 3, 100)])
          for (const row of termRows) {
            if (!seen.has(row.id)) { seen.add(row.id); rows.push(row) }
          }
        } catch { /* skip terms that FTS5 rejects */ }
      }
      if (includeUntitled) {
        for (const row of await untitledNoteRows(limit)) {
          if (!seen.has(row.id)) { seen.add(row.id); rows.push(row) }
        }
      }
      return rows.slice(0, limit).map(rowToNote)
    }

    const match = safeNotesFts(query, mode === 'phrase' ? 'phrase' : 'all')
    let rows: NoteRow[] = []
    if (match) {
      try {
        rows = await db().all<NoteRow>(`
          SELECT n.* FROM notes_fts f
          JOIN notes n ON n.rowid = f.rowid
          WHERE notes_fts MATCH ? AND n.deleted_at IS NULL
          ORDER BY n.updated_at DESC
          LIMIT ?
        `, [match, limit])
      } catch {
        rows = []
      }
    }
    if (includeUntitled) {
      const seen = new Set(rows.map((r) => r.id))
      for (const row of await untitledNoteRows(limit)) {
        if (!seen.has(row.id)) { seen.add(row.id); rows.push(row) }
      }
    }
    return rows.slice(0, limit).map(rowToNote)
  }

  async function deleteByTag(tag: string) {
    const result = await db().run(`DELETE FROM notes WHERE tags LIKE ?`, [`%"${tag}"%`])
    ctx.events.emit('data:changed', { entity: 'note', op: 'bulk' })
    return { success: true, deleted: result.changes }
  }

  // How many live notes contain an inline "#<name>" verse-tag reference in their body.
  // Used to warn before deleting a verse tag (Tag Manager). Simple substring match — a
  // slight over-count (e.g. "#name" inside a code span) is acceptable for a confirm prompt.
  async function countTagRefs(name: string) {
    const row = await db().get<{ n: number }>(
      `SELECT COUNT(*) AS n FROM notes WHERE deleted_at IS NULL AND content LIKE '%#' || ? || '%'`, [name])
    return { count: row!.n }
  }

  // Returns all notes for a chapter. KJV and LXX are cross-linked (each sees the other's notes).
  //
  // Psalms is the one book where KJV and LXX chapter numbers diverge (merges/splits around
  // Pss 9-10, 114-118, 146-147 — see translationChapterMap.ts), so the cross-linked
  // translation's notes are looked up under ITS OWN equivalent chapter(s) via
  // `equivalentChapters`, not the literal chapter number on screen. That mapping is a
  // no-op for every other book, so non-Psalms behavior is unchanged.
  async function notesForChapterAndTid(bookId: string, chapter: number, tidClause: string, tidParam?: string): Promise<NoteRow[]> {
    const chapterRef = `${bookId}.${chapter}`
    const prefix = `${chapterRef}.`
    // verse_ref is either the exact chapter-level form ("BOOK.CH", no verse segment —
    // e.g. a whole-chapter note) or a verse-specific form under it ("BOOK.CH.verse")
    // but NOT a deeper sub-range ("BOOK.CH.verse.something").
    const sql = `SELECT * FROM notes WHERE (verse_ref = ? OR (verse_ref LIKE ? AND verse_ref NOT LIKE ?)) AND deleted_at IS NULL AND ${tidClause}`
    const params = tidParam
      ? [chapterRef, `${prefix}%`, `${prefix}%.%`, tidParam]
      : [chapterRef, `${prefix}%`, `${prefix}%.%`]
    return db().all<NoteRow>(sql, params)
  }

  async function getByChapter(bookId: string, chapter: number, textId = 'kjva') {
    if (textId !== 'kjva' && textId !== 'lxx') {
      const rows = await notesForChapterAndTid(bookId, chapter, 'text_id = ?', textId)
      rows.sort((a, b) => (a.verse_ref ?? '').localeCompare(b.verse_ref ?? ''))
      return rows.map(rowToNote)
    }

    const ownTid = textId === 'kjva' ? "(text_id = 'kjva' OR text_id IS NULL)" : "text_id = 'lxx'"
    const ownRows = await notesForChapterAndTid(bookId, chapter, ownTid)

    const otherTextId = textId === 'kjva' ? 'lxx' : 'kjva'
    const otherTid = otherTextId === 'kjva' ? "(text_id = 'kjva' OR text_id IS NULL)" : "text_id = 'lxx'"
    const seen = new Set(ownRows.map((r) => r.id))
    const otherRows: NoteRow[] = []
    for (const ch of equivalentChapters(bookId, chapter, textId, otherTextId)) {
      for (const row of await notesForChapterAndTid(bookId, ch, otherTid)) {
        if (!seen.has(row.id)) { seen.add(row.id); otherRows.push(row) }
      }
    }

    const combined = [...ownRows, ...otherRows]
    combined.sort((a, b) => (a.verse_ref ?? '').localeCompare(b.verse_ref ?? ''))
    return combined.map(rowToNote)
  }

  // Returns { [verseNum]: count } for all verses in a chapter that have notes.
  // KJV and LXX are cross-linked so dots appear for both translations' notes. Same
  // equivalent-chapter mapping as getByChapter above; verse numbers within a merge
  // chapter are used as-is (verse-level splits are ignored — same simplification
  // translationChapterMap.ts's navigation mapping already makes).
  async function chapterVerseRefsForTid(bookId: string, chapter: number, tidClause: string, tidParam?: string): Promise<string[]> {
    const prefix = `${bookId}.${chapter}.`
    const sql = `SELECT verse_ref FROM notes WHERE verse_ref LIKE ? AND verse_ref NOT LIKE ? AND deleted_at IS NULL AND ${tidClause}`
    const params = tidParam ? [`${prefix}%`, `${prefix}%.%`, tidParam] : [`${prefix}%`, `${prefix}%.%`]
    const rows = await db().all<{ verse_ref: string }>(sql, params)
    return rows.map((r) => r.verse_ref)
  }

  async function getChapterCounts(bookId: string, chapter: number, textId = 'kjva') {
    let verseRefs: string[]

    if (textId !== 'kjva' && textId !== 'lxx') {
      verseRefs = await chapterVerseRefsForTid(bookId, chapter, 'text_id = ?', textId)
    } else {
      const ownTid = textId === 'kjva' ? "(text_id = 'kjva' OR text_id IS NULL)" : "text_id = 'lxx'"
      const otherTextId = textId === 'kjva' ? 'lxx' : 'kjva'
      const otherTid = otherTextId === 'kjva' ? "(text_id = 'kjva' OR text_id IS NULL)" : "text_id = 'lxx'"
      verseRefs = await chapterVerseRefsForTid(bookId, chapter, ownTid)
      for (const ch of equivalentChapters(bookId, chapter, textId, otherTextId)) {
        verseRefs.push(...await chapterVerseRefsForTid(bookId, ch, otherTid))
      }
    }

    const counts: Record<number, number> = {}
    for (const verse_ref of verseRefs) {
      const verseNum = parseInt(verse_ref.split('.')[2] ?? '0')
      if (verseNum) counts[verseNum] = (counts[verseNum] ?? 0) + 1
    }
    return counts
  }

  // ── Note version history (Google-Docs-style snapshots) ─────────────────────
  async function createVersion(noteId: string, title: string, content: string, kind = 'auto') {
    // Skip if identical to the latest snapshot (avoid duplicate consecutive versions).
    const last = await db().get<{ content: string }>('SELECT content FROM note_versions WHERE note_id = ? ORDER BY created_at DESC LIMIT 1', [noteId])
    if (last && last.content === content) return { success: true, skipped: true }
    const id = ctx.uuid()
    await db().run(`INSERT INTO note_versions (id, note_id, title, content, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)`, [id, noteId, title ?? null, content, kind, ctx.now()])
    await pruneNoteVersions(noteId)
    ctx.events.emit('data:changed', { entity: 'note_version', id, op: 'upsert' })
    return { success: true, id }
  }

  async function getVersions(noteId: string) {
    const rows = await db().all<VersionRow>('SELECT * FROM note_versions WHERE note_id = ? ORDER BY created_at DESC', [noteId])
    return rows.map(rowToVersion)
  }

  async function restoreVersion(noteId: string, versionId: string) {
    const ver = await db().get<VersionRow>('SELECT * FROM note_versions WHERE id = ?', [versionId])
    if (!ver) return { success: false, error: 'Version not found' }
    const cur = await db().get<{ title: string | null; content: string }>('SELECT title, content FROM notes WHERE id = ?', [noteId])
    if (!cur) return { success: false, error: 'Note not found' }
    // Snapshot current content first so the restore can be undone with one click.
    if (cur.content !== ver.content) {
      const preId = ctx.uuid()
      await db().run(`INSERT INTO note_versions (id, note_id, title, content, kind, created_at) VALUES (?, ?, ?, ?, 'pre-restore', ?)`, [preId, noteId, cur.title ?? null, cur.content, ctx.now()])
      ctx.events.emit('data:changed', { entity: 'note_version', id: preId, op: 'upsert' })
    }
    await db().run('UPDATE notes SET content = ?, updated_at = ? WHERE id = ?', [ver.content, ctx.now(), noteId])
    await pruneNoteVersions(noteId)
    ctx.events.emit('data:changed', { entity: 'note', id: noteId, op: 'upsert' })
    return { success: true, content: ver.content }
  }

  // ── Heading collapse persistence (round 12 item 6) ─────────────────────────
  // See berean.ts's v24 migration comment for why this is keyed by a stable `heading_key`
  // string rather than a document position, and why it's a separate table rather than
  // markdown content. Every row is scoped to one note_id — no cross-note leakage possible
  // even if two notes happen to compute the same heading_key. Not a synced entity (no
  // `note_heading_collapse` in docs/mobile/icloud.md §5), so no data:changed emit here —
  // matches the original, which never broadcast for this either.
  async function getCollapsedHeadings(noteId: string) {
    const rows = await db().all<{ heading_key: string }>('SELECT heading_key FROM note_heading_collapse WHERE note_id = ? AND collapsed = 1', [noteId])
    return rows.map((r) => r.heading_key)
  }

  async function setHeadingCollapsed(noteId: string, headingKey: string, collapsed: boolean) {
    if (collapsed) {
      await db().run('INSERT OR REPLACE INTO note_heading_collapse (note_id, heading_key, collapsed) VALUES (?, ?, 1)', [noteId, headingKey])
    } else {
      // Un-collapsing just deletes the row rather than writing collapsed=0 — a note with
      // every heading expanded (the common case) then has ZERO rows instead of one per
      // heading, keeping this table's steady-state size proportional to "how much is
      // actually collapsed right now," not "how many headings have ever existed."
      await db().run('DELETE FROM note_heading_collapse WHERE note_id = ? AND heading_key = ?', [noteId, headingKey])
    }
    return { success: true }
  }

  // ── Thread collapse persistence (notes editor threads feature) ────────────
  // Thread-node counterpart of the heading-collapse handlers just above — see berean.ts's v27
  // migration comment for why `threadKey` here is simply the thread's own `threadId` attr
  // rather than a derived key. Same per-note_id scoping, same "un-collapsing deletes the row"
  // steady-state-size rationale, and same no-emit reasoning (not a synced entity).
  async function getCollapsedThreads(noteId: string) {
    const rows = await db().all<{ thread_key: string }>('SELECT thread_key FROM note_thread_collapse WHERE note_id = ? AND collapsed = 1', [noteId])
    return rows.map((r) => r.thread_key)
  }

  async function setThreadCollapsed(noteId: string, threadKey: string, collapsed: boolean) {
    if (collapsed) {
      await db().run('INSERT OR REPLACE INTO note_thread_collapse (note_id, thread_key, collapsed) VALUES (?, ?, 1)', [noteId, threadKey])
    } else {
      await db().run('DELETE FROM note_thread_collapse WHERE note_id = ? AND thread_key = ?', [noteId, threadKey])
    }
    return { success: true }
  }

  return {
    create, update, listIdioms, delete: del, restore, listTrash, purgeTrashItem, emptyTrash,
    folderList, folderCreate, folderRename, folderDelete, folderDeleteDeep, folderSetParent,
    setFolder, setPinned, deleteAll, getAll, getByVerse, getOne, search, deleteByTag, countTagRefs,
    getByChapter, getChapterCounts,
    createVersion, getVersions, restoreVersion,
    getCollapsedHeadings, setHeadingCollapsed, getCollapsedThreads, setThreadCollapsed,
  }
}

export type NotesService = ReturnType<typeof createNotesService>
