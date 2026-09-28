import type { IpcMain } from 'electron'
import { services } from '../services'

/**
 * Thin IPC layer (Phase 1/3): every channel delegates to the shared workspacesService
 * (src/platform/services/workspacesService.ts), which carries the SQL that used to live here.
 */
export function registerWorkspacesHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('workspaces:list', () => services().workspaces.list())

  ipcMain.handle('workspaces:save', (_e, name: string, layoutJson: string, stateJson: string) =>
    services().workspaces.save(name, layoutJson, stateJson))

  ipcMain.handle('workspaces:load', (_e, id: string) => services().workspaces.load(id))

  ipcMain.handle('workspaces:delete', (_e, id: string) => services().workspaces.delete(id))

  ipcMain.handle('workspaces:rename', (_e, id: string, name: string) => services().workspaces.rename(id, name))
}
