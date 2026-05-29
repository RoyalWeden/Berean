import type { IpcMain } from 'electron'
import { getBereanDb } from '../db/berean'
import { randomUUID } from 'crypto'

export function registerWorkspacesHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('workspaces:list', () => {
    return getBereanDb()
      .prepare('SELECT id, name, created_at FROM workspaces ORDER BY created_at DESC')
      .all()
  })

  ipcMain.handle('workspaces:save', (_e, name: string, layoutJson: string, stateJson: string) => {
    const id = randomUUID()
    const now = Date.now()
    getBereanDb().prepare(
      'INSERT INTO workspaces (id, name, layout_json, state_json, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(id, name, layoutJson, stateJson, now)
    return { id, name, created_at: now }
  })

  ipcMain.handle('workspaces:load', (_e, id: string) => {
    return getBereanDb()
      .prepare('SELECT * FROM workspaces WHERE id = ?')
      .get(id) ?? null
  })

  ipcMain.handle('workspaces:delete', (_e, id: string) => {
    getBereanDb().prepare('DELETE FROM workspaces WHERE id = ?').run(id)
    return { success: true }
  })

  ipcMain.handle('workspaces:rename', (_e, id: string, name: string) => {
    getBereanDb().prepare('UPDATE workspaces SET name = ? WHERE id = ?').run(name, id)
    return { success: true }
  })
}
