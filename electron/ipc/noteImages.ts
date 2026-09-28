import { BrowserWindow, Menu, clipboard, dialog, nativeImage, type IpcMain } from 'electron'
import { writeFile } from 'fs/promises'

export type NoteImageMenuAction = 'copy' | 'saveAs' | 'delete'

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/gif': 'gif',
  'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/bmp': 'bmp', 'image/avif': 'avif',
}

/** Decodes a `data:<mime>;base64,<payload>` URL (the notes editor's image storage format — see
 *  src/components/notes/pm/imageInsert.ts) into its mime type, file extension and bytes. */
export function decodeImageDataUrl(dataUrl: string): { mime: string; ext: string; bytes: Buffer } | null {
  const m = /^data:([^;,]+)?((?:;[^;,]*)*?);base64,(.*)$/s.exec(dataUrl)
  if (!m) return null
  const mime = (m[1] || 'image/png').toLowerCase()
  if (!mime.startsWith('image/')) return null
  return { mime, ext: EXT_BY_MIME[mime] ?? 'png', bytes: Buffer.from(m[3], 'base64') }
}

/** Safe default file name for Save As: the image's alt text (else "image") + its real extension. */
export function imageSaveName(alt: string | undefined, ext: string): string {
  const base = (alt ?? '').replace(/[/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'image'
  return `${base}.${ext}`
}

/**
 * Notes-editor image actions (MAC-IMG): a native macOS contextual menu for an image plus the
 * two actions that need the main process — copying the real bitmap to the system clipboard and
 * a native Save As. Delete is a ProseMirror transaction, so it stays in the renderer.
 */
export function registerNoteImageHandlers(ipcMain: IpcMain): void {
  // Pops the native menu at the pointer; resolves with the chosen action, or null if dismissed.
  ipcMain.handle('app:noteImageMenu', (e) => new Promise<NoteImageMenuAction | null>((resolve) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    let chosen: NoteImageMenuAction | null = null
    const pick = (a: NoteImageMenuAction) => () => { chosen = a }
    Menu.buildFromTemplate([
      { label: 'Copy Image', click: pick('copy') },
      { label: 'Save Image As…', click: pick('saveAs') },
      { type: 'separator' },
      { label: 'Delete Image', click: pick('delete') },
    ]).popup({ window: win, callback: () => resolve(chosen) })
  }))

  ipcMain.handle('app:copyNoteImage', (_e, dataUrl: string) => {
    const img = nativeImage.createFromDataURL(dataUrl)
    if (img.isEmpty()) return { success: false }
    clipboard.writeImage(img)
    return { success: true }
  })

  ipcMain.handle('app:saveNoteImageAs', async (e, dataUrl: string, alt?: string) => {
    const decoded = decodeImageDataUrl(dataUrl)
    if (!decoded) return { success: false }
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.SaveDialogOptions = {
      defaultPath: imageSaveName(alt, decoded.ext),
      filters: [{ name: 'Image', extensions: [decoded.ext] }],
    }
    const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (result.canceled || !result.filePath) return { success: false, canceled: true }
    await writeFile(result.filePath, decoded.bytes)
    return { success: true }
  })
}
