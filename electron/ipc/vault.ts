import type { IpcMain } from 'electron'

export function registerVaultHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('vault:syncNote', (_event, _noteId: string) => {
    return { success: false, reason: 'Vault sync not configured in Phase 1' }
  })

  ipcMain.handle('vault:readNote', (_event, _title: string) => {
    return null
  })

  ipcMain.handle('vault:watch', (_event) => {
    return { success: false, reason: 'Vault watch not configured in Phase 1' }
  })
}
