import type { IpcMain } from 'electron'
import { dialog, app } from 'electron'
import { randomUUID } from 'crypto'
import { services } from '../services'
import { existsSync, mkdirSync, copyFileSync, readFileSync, statSync, unlinkSync } from 'fs'
import { join, basename, extname } from 'path'

// PDFs are stored under {userData}/pdfs/{id}.pdf
function pdfsDir(): string {
  const dir = join(app.getPath('userData'), 'pdfs')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Thin IPC layer (Phase 1/3): the `pdfs` / `pdf_highlights` rows live in the shared pdfService
 * (src/platform/services/pdfService.ts). File IO — the import dialog, copying into
 * userData/pdfs, reading bytes for the viewer, unlinking on delete — stays here because it is
 * Electron/Node-specific; iOS does the equivalent with a document picker + the app container.
 */
export function registerPdfHandlers(ipcMain: IpcMain): void {

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
      return { error: String(err) }
    }
    const size = statSync(destPath).size
    const title = basename(srcPath, '.pdf')
    const now = Date.now()
    const pdf = await services().pdf.insert({ id, title, filename: storedName, fileSize: size, importedAt: now })
    return { success: true, pdf }
  })

  ipcMain.handle('pdf:list', () => services().pdf.list())
  ipcMain.handle('pdf:get', (_e, id: string) => services().pdf.get(id))

  // Read the raw bytes for rendering in the renderer (avoids file:// CSP issues)
  ipcMain.handle('pdf:readBytes', async (_e, id: string) => {
    const row = await services().pdf.get(id)
    if (!row) { return null }
    const path = join(pdfsDir(), row.filename)
    if (!existsSync(path)) { return null }
    const buf = readFileSync(path)
    // Return as a transferable Uint8Array
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  })

  // Record the page count once the renderer has loaded the document
  ipcMain.handle('pdf:setPageCount', (_e, id: string, pageCount: number) => services().pdf.setPageCount(id, pageCount))
  ipcMain.handle('pdf:rename', (_e, id: string, title: string) => services().pdf.rename(id, title))

  ipcMain.handle('pdf:delete', async (_e, id: string) => {
    const row = await services().pdf.deleteRow(id)
    if (row) {
      const path = join(pdfsDir(), row.filename)
      try { if (existsSync(path)) unlinkSync(path) } catch { /* ignore */ }
    }
    return { success: true }
  })

  // ── Highlights ───────────────────────────────────────────────────────────────
  ipcMain.handle('pdf:highlights:list', (_e, pdfId: string) => services().pdf.highlightsList(pdfId))
  ipcMain.handle('pdf:highlights:add', (_e, data: {
    pdfId: string; page: number; rects: Array<{ x: number; y: number; w: number; h: number }>
    color: string; text: string; note?: string | null
  }) => services().pdf.highlightsAdd(data))
  ipcMain.handle('pdf:highlights:remove', (_e, id: string) => services().pdf.highlightsRemove(id))
  ipcMain.handle('pdf:highlights:setNote', (_e, id: string, note: string) => services().pdf.highlightsSetNote(id, note))
}
