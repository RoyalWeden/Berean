import type { IpcMain } from 'electron'
import { services } from '../services'
import type { HistoryEntryInput } from '../../src/platform/services/historyService'

/**
 * Thin IPC layer (Phase 1/3): delegates to the shared historyService
 * (src/platform/services/historyService.ts), which carries the SQL that used to live here.
 */
export function registerHistoryHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('history:add', (_e, entry: HistoryEntryInput, maxEntries?: number) => services().history.add(entry, maxEntries))
  ipcMain.handle('history:getAll', (_e, limit = 300) => services().history.getAll(limit))
  ipcMain.handle('history:getPage', (_e, beforeTs: number, limit = 300) => services().history.getPage(beforeTs, limit))
  ipcMain.handle('history:delete', (_e, id: string) => services().history.delete(id))
  ipcMain.handle('history:clear', () => services().history.clear())
}
