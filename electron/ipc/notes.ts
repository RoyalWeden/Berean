import type { IpcMain } from 'electron'

export function registerNotesHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('notes:create', (_event, _data: unknown) => {
    return { success: false, error: 'Notes DB not initialized in Phase 1' }
  })

  ipcMain.handle('notes:update', (_event, _id: string, _data: unknown) => {
    return { success: false, error: 'Notes DB not initialized in Phase 1' }
  })

  ipcMain.handle('notes:delete', (_event, _id: string) => {
    return { success: false, error: 'Notes DB not initialized in Phase 1' }
  })

  ipcMain.handle('notes:getAll', (_event, _limit?: number, _offset?: number) => {
    return []
  })

  ipcMain.handle('notes:getByVerse', (_event, _verseRef: string) => {
    return []
  })

  ipcMain.handle('notes:getOne', (_event, _id: string) => {
    return null
  })
}
