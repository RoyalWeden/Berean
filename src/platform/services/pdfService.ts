import type { ServiceContext } from './context'

/**
 * PDF library — DB-row logic extracted verbatim from electron/ipc/pdf.ts (Phase 1/3). File I/O
 * (dialog, copy/read/unlink under userData/pdfs) stays in the electron IPC handler — see the
 * header comment there. The SQL and result shapes here are unchanged; only the execution is
 * async through DatabaseAdapter.
 */

export interface PdfRow {
  id: string
  title: string
  filename: string
  page_count: number
  file_size: number
  imported_at: number
  file_hash?: string | null
}

export interface PdfBookmarkRow {
  id: string; pdf_id: string; page: number; label: string; created_at: number; updated_at: number
}

export interface PdfHighlightRow {
  id: string; pdf_id: string; page: number; rects_json: string
  color: string; text: string; note: string | null; created_at: number
}

function rowToPdf(r: PdfRow) {
  return {
    id: r.id, title: r.title, filename: r.filename,
    pageCount: r.page_count, fileSize: r.file_size, importedAt: r.imported_at,
    fileHash: r.file_hash ?? null,
  }
}

function rowToBookmark(r: PdfBookmarkRow) {
  return { id: r.id, pdfId: r.pdf_id, page: r.page, label: r.label, createdAt: r.created_at }
}

function rowToHl(r: PdfHighlightRow) {
  return {
    id: r.id, pdfId: r.pdf_id, page: r.page,
    rects: JSON.parse(r.rects_json) as Array<{ x: number; y: number; w: number; h: number }>,
    color: r.color, text: r.text, note: r.note, createdAt: r.created_at,
  }
}

export function createPdfService(ctx: ServiceContext) {
  const db = () => ctx.userDb

  /** Inserts the `pdfs` row for a file the electron handler has already copied into
   *  userData/pdfs (pdf:import) — file IO and id/timestamp generation stay there, since the
   *  copied file's on-disk name is derived from the same id before this is ever called. Returns
   *  the same `{ id, title, filename, pageCount: 0, fileSize, importedAt }` shape the old inline
   *  handler constructed by hand. */
  async function insert(row: { id: string; title: string; filename: string; fileSize: number; importedAt: number; fileHash?: string | null }) {
    await db().run(
      `INSERT INTO pdfs (id, title, filename, page_count, file_size, imported_at, file_hash) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [row.id, row.title, row.filename, 0, row.fileSize, row.importedAt, row.fileHash ?? null],
    )
    ctx.events.emit('data:changed', { entity: 'pdf', id: row.id, op: 'upsert' })
    return { id: row.id, title: row.title, filename: row.filename, pageCount: 0, fileSize: row.fileSize, importedAt: row.importedAt, fileHash: row.fileHash ?? null }
  }

  /** The `pdfs` row (if any) whose bytes hash to `fileHash` — metadata that arrived from another
   *  device and is waiting for the same file to be imported here. */
  async function findByHash(fileHash: string) {
    const row = await db().get<PdfRow>('SELECT * FROM pdfs WHERE file_hash = ?', [fileHash])
    return row ? rowToPdf(row) : null
  }

  /** Records that this device now has the file for an existing (synced) row. Only the local
   *  filename changes; the synced fields are untouched unless the hash was unknown. */
  async function attachFile(id: string, filename: string, fileSize: number, fileHash: string) {
    await db().run('UPDATE pdfs SET filename = ?, file_size = CASE WHEN file_size > 0 THEN file_size ELSE ? END, file_hash = COALESCE(file_hash, ?) WHERE id = ?', [filename, fileSize, fileHash, id])
    ctx.events.emit('data:changed', { entity: 'pdf', id, op: 'upsert' })
    const row = await db().get<PdfRow>('SELECT * FROM pdfs WHERE id = ?', [id])
    return row ? rowToPdf(row) : null
  }

  async function list() {
    const rows = await db().all<PdfRow>('SELECT * FROM pdfs ORDER BY imported_at DESC')
    return rows.map(rowToPdf)
  }

  async function get(id: string) {
    const row = await db().get<PdfRow>('SELECT * FROM pdfs WHERE id = ?', [id])
    return row ? rowToPdf(row) : null
  }

  async function setPageCount(id: string, pageCount: number) {
    await db().run('UPDATE pdfs SET page_count = ? WHERE id = ?', [pageCount, id])
    ctx.events.emit('data:changed', { entity: 'pdf', id, op: 'upsert' })
    return { success: true }
  }

  async function rename(id: string, title: string) {
    await db().run('UPDATE pdfs SET title = ? WHERE id = ?', [title || 'Untitled', id])
    ctx.events.emit('data:changed', { entity: 'pdf', id, op: 'upsert' })
    return { success: true }
  }

  /** Deletes the `pdfs` row and its highlights. Returns the filename it had (or null if the id
   *  didn't exist) so the electron handler (pdf:delete) can unlink the file on disk after this
   *  resolves — the file itself is never touched here. */
  async function deleteRow(id: string): Promise<{ filename: string } | null> {
    const row = await db().get<{ filename: string }>('SELECT filename FROM pdfs WHERE id = ?', [id])
    await db().transaction(async (tx) => {
      await tx.run('DELETE FROM pdf_highlights WHERE pdf_id = ?', [id])
      await tx.run('DELETE FROM pdf_bookmarks WHERE pdf_id = ?', [id])
      await tx.run('DELETE FROM pdfs WHERE id = ?', [id])
    })
    ctx.events.emit('data:changed', { entity: 'pdf', id, op: 'delete' })
    return row ?? null
  }

  async function highlightsList(pdfId: string) {
    const rows = await db().all<PdfHighlightRow>('SELECT * FROM pdf_highlights WHERE pdf_id = ? ORDER BY page ASC, created_at ASC', [pdfId])
    return rows.map(rowToHl)
  }

  async function highlightsAdd(data: {
    pdfId: string; page: number; rects: Array<{ x: number; y: number; w: number; h: number }>
    color: string; text: string; note?: string | null
  }) {
    const id = ctx.uuid()
    const now = ctx.now()
    await db().run(
      `INSERT INTO pdf_highlights (id, pdf_id, page, rects_json, color, text, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, data.pdfId, data.page, JSON.stringify(data.rects), data.color, data.text ?? '', data.note ?? null, now],
    )
    ctx.events.emit('data:changed', { entity: 'pdf_highlight', id, op: 'upsert', scope: data.pdfId })
    return { success: true, id }
  }

  async function highlightsRemove(id: string) {
    await db().run('DELETE FROM pdf_highlights WHERE id = ?', [id])
    ctx.events.emit('data:changed', { entity: 'pdf_highlight', id, op: 'delete' })
    return { success: true }
  }

  async function highlightsSetNote(id: string, note: string) {
    await db().run('UPDATE pdf_highlights SET note = ? WHERE id = ?', [note, id])
    ctx.events.emit('data:changed', { entity: 'pdf_highlight', id, op: 'upsert' })
    return { success: true }
  }

  // ── Bookmarks (v46; previously localStorage `berean:pdfBookmarks:<id>`) ─────────────────────
  async function bookmarksList(pdfId: string) {
    const rows = await db().all<PdfBookmarkRow>('SELECT * FROM pdf_bookmarks WHERE pdf_id = ? ORDER BY page ASC, created_at ASC', [pdfId])
    return rows.map(rowToBookmark)
  }

  async function bookmarksAdd(pdfId: string, page: number, label: string, createdAt?: number) {
    const id = ctx.uuid()
    const now = ctx.now()
    await db().run('INSERT INTO pdf_bookmarks (id, pdf_id, page, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [id, pdfId, page, label, createdAt ?? now, now])
    ctx.events.emit('data:changed', { entity: 'pdf_bookmark', id, op: 'upsert', scope: pdfId })
    return { id, pdfId, page, label, createdAt: createdAt ?? now }
  }

  async function bookmarksRemove(id: string) {
    await db().run('DELETE FROM pdf_bookmarks WHERE id = ?', [id])
    ctx.events.emit('data:changed', { entity: 'pdf_bookmark', id, op: 'delete' })
    return { success: true }
  }

  /** One-time import of the pre-v46 localStorage list for a PDF (called by the viewer with the
   *  parsed entries); a no-op when the PDF already has bookmarks in the database. */
  async function bookmarksImport(pdfId: string, entries: Array<{ page: number; label: string; createdAt?: number }>) {
    const existing = await db().get<{ n: number }>('SELECT COUNT(*) AS n FROM pdf_bookmarks WHERE pdf_id = ?', [pdfId])
    if ((existing?.n ?? 0) > 0 || entries.length === 0) return { imported: 0 }
    for (const e of entries) await bookmarksAdd(pdfId, e.page, e.label, e.createdAt)
    return { imported: entries.length }
  }

  return {
    insert, findByHash, attachFile, list, get, setPageCount, rename, deleteRow,
    highlightsList, highlightsAdd, highlightsRemove, highlightsSetNote,
    bookmarksList, bookmarksAdd, bookmarksRemove, bookmarksImport,
  }
}

export type PdfService = ReturnType<typeof createPdfService>
