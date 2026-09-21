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
}

export interface PdfHighlightRow {
  id: string; pdf_id: string; page: number; rects_json: string
  color: string; text: string; note: string | null; created_at: number
}

function rowToPdf(r: PdfRow) {
  return {
    id: r.id, title: r.title, filename: r.filename,
    pageCount: r.page_count, fileSize: r.file_size, importedAt: r.imported_at,
  }
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
  async function insert(row: { id: string; title: string; filename: string; fileSize: number; importedAt: number }) {
    await db().run(
      `INSERT INTO pdfs (id, title, filename, page_count, file_size, imported_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [row.id, row.title, row.filename, 0, row.fileSize, row.importedAt],
    )
    ctx.events.emit('data:changed', { entity: 'pdf', id: row.id, op: 'upsert' })
    return { id: row.id, title: row.title, filename: row.filename, pageCount: 0, fileSize: row.fileSize, importedAt: row.importedAt }
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

  return { insert, list, get, setPageCount, rename, deleteRow, highlightsList, highlightsAdd, highlightsRemove, highlightsSetNote }
}

export type PdfService = ReturnType<typeof createPdfService>
