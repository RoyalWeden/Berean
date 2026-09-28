import type { IpcMain } from 'electron'
import { services } from '../services'
import type { ToggleHighlightParams } from '../../src/platform/services/highlightsService'

/**
 * Thin IPC layer (Phase 1/3): every channel delegates to the shared highlightsService
 * (src/platform/services/highlightsService.ts), which carries the SQL that used to live here.
 */
export function registerHighlightHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('highlights:getChapter', (_e, bookId: string, chapter: number, textId = 'kjva') =>
    services().highlights.getChapter(bookId, chapter, textId))
  ipcMain.handle('highlights:toggle', (_e, params: ToggleHighlightParams) => services().highlights.toggle(params))
  ipcMain.handle('highlights:remove', (_e, bookId: string, chapter: number, verseNum: number, textId = 'kjva') =>
    services().highlights.remove(bookId, chapter, verseNum, textId))
}
