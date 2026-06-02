import type { IpcMain } from 'electron'
import { dialog, app } from 'electron'
import { getBereanDb } from '../db/berean'
import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, copyFileSync, readFileSync, statSync, unlinkSync } from 'fs'
import { join, basename, extname } from 'path'

// PDFs are stored under {userData}/pdfs/{id}.pdf
function pdfsDir(): string {
  const dir = join(app.getPath('userData'), 'pdfs')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

interface PdfRow {
  id: string
  title: string
  filename: string
  page_count: number
  file_size: number
  imported_at: number
}

function rowToPdf(r: PdfRow) {
  return {
    id: r.id, title: r.title, filename: r.filename,
    pageCount: r.page_count, fileSize: r.file_size, importedAt: r.imported_at,
  }
}

interface HlRow {
  id: string; pdf_id: string; page: number; rects_json: string
  color: string; text: string; note: string | null; created_at: number
}

function rowToHl(r: HlRow) {
  return {
    id: r.id, pdfId: r.pdf_id, page: r.page,
    rects: JSON.parse(r.rects_json) as Array<{ x: number; y: number; w: number; h: number }>,
    color: r.color, text: r.text, note: r.note, createdAt: r.created_at,
  }
}

export function registerPdfHandlers(ipcMain: IpcMain): void {
  console.log('[berean-pdf] registering PDF IPC handlers')

  // Import: open a file dialog, copy the chosen PDF into userData/pdfs, insert a row.
  ipcMain.handle('pdf:import', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import PDF',
      properties: ['openFile'],
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return { canceled: true }

    const srcPath = result.filePaths[0]
    if (extname(srcPath).toLowerCase() !== '.pdf') return { error: 'Not a PDF file' }

    const id = randomUUID()
    const storedName = `${id}.pdf`
    const destPath = join(pdfsDir(), storedName)
    try {
      copyFileSync(srcPath, destPath)
    } catch (err) {
      console.error('[berean-pdf] copy failed', err)
      return { error: String(err) }
    }
    const size = statSync(destPath).size
    const title = basename(srcPath, '.pdf')
    const now = Date.now()
    getBereanDb().prepare(
      `INSERT INTO pdfs (id, title, filename, page_count, file_size, imported_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, title, storedName, 0, size, now)
    console.log('[berean-pdf] imported', title, id, size, 'bytes')
    return { success: true, pdf: { id, title, filename: storedName, pageCount: 0, fileSize: size, importedAt: now } }
  })

  ipcMain.handle('pdf:list', () => {
    const rows = getBereanDb().prepare('SELECT * FROM pdfs ORDER BY imported_at DESC').all() as PdfRow[]
    return rows.map(rowToPdf)
  })

  ipcMain.handle('pdf:get', (_e, id: string) => {
    const row = getBereanDb().prepare('SELECT * FROM pdfs WHERE id = ?').get(id) as PdfRow | undefined
    return row ? rowToPdf(row) : null
  })

  // Read the raw bytes for rendering in the renderer (avoids file:// CSP issues)
  ipcMain.handle('pdf:readBytes', (_e, id: string) => {
    const row = getBereanDb().prepare('SELECT filename FROM pdfs WHERE id = ?').get(id) as { filename: string } | undefined
    if (!row) { console.error('[berean-pdf] readBytes: no row for', id); return null }
    const path = join(pdfsDir(), row.filename)
    if (!existsSync(path)) { console.error('[berean-pdf] readBytes: file missing', path); return null }
    const buf = readFileSync(path)
    console.log('[berean-pdf] readBytes', id, buf.length, 'bytes')
    // Return as a transferable Uint8Array
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  })

  // Record the page count once the renderer has loaded the document
  ipcMain.handle('pdf:setPageCount', (_e, id: string, pageCount: number) => {
    getBereanDb().prepare('UPDATE pdfs SET page_count = ? WHERE id = ?').run(pageCount, id)
    return { success: true }
  })

  ipcMain.handle('pdf:rename', (_e, id: string, title: string) => {
    getBereanDb().prepare('UPDATE pdfs SET title = ? WHERE id = ?').run(title || 'Untitled', id)
    return { success: true }
  })

  ipcMain.handle('pdf:delete', (_e, id: string) => {
    const db = getBereanDb()
    const row = db.prepare('SELECT filename FROM pdfs WHERE id = ?').get(id) as { filename: string } | undefined
    if (row) {
      const path = join(pdfsDir(), row.filename)
      try { if (existsSync(path)) unlinkSync(path) } catch (err) { console.error('[berean-pdf] delete file err', err) }
    }
    db.transaction(() => {
      db.prepare('DELETE FROM pdf_highlights WHERE pdf_id = ?').run(id)
      db.prepare('DELETE FROM pdfs WHERE id = ?').run(id)
    })()
    return { success: true }
  })

  // ── Highlights ───────────────────────────────────────────────────────────────
  ipcMain.handle('pdf:highlights:list', (_e, pdfId: string) => {
    const rows = getBereanDb()
      .prepare('SELECT * FROM pdf_highlights WHERE pdf_id = ? ORDER BY page ASC, created_at ASC')
      .all(pdfId) as HlRow[]
    return rows.map(rowToHl)
  })

  ipcMain.handle('pdf:highlights:add', (_e, data: {
    pdfId: string; page: number; rects: Array<{ x: number; y: number; w: number; h: number }>
    color: string; text: string; note?: string | null
  }) => {
    const id = randomUUID()
    const now = Date.now()
    getBereanDb().prepare(
      `INSERT INTO pdf_highlights (id, pdf_id, page, rects_json, color, text, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, data.pdfId, data.page, JSON.stringify(data.rects), data.color, data.text ?? '', data.note ?? null, now)
    return { success: true, id }
  })

  ipcMain.handle('pdf:highlights:remove', (_e, id: string) => {
    getBereanDb().prepare('DELETE FROM pdf_highlights WHERE id = ?').run(id)
    return { success: true }
  })

  ipcMain.handle('pdf:highlights:setNote', (_e, id: string, note: string) => {
    getBereanDb().prepare('UPDATE pdf_highlights SET note = ? WHERE id = ?').run(note, id)
    return { success: true }
  })

  console.log('[berean-pdf] all PDF handlers registered')
}
