import type { IpcMain } from 'electron'
import { services } from '../services'

/**
 * Thin IPC layer (Phase 1/3): delegates to the shared settingsService
 * (src/platform/services/settingsService.ts). main.ts still reads/writes window-bounds keys
 * through the raw better-sqlite3 handle; those are desktop-window-only and unaffected.
 */
export function registerSettingsHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('settings:get', (_event, key: string) => services().settings.get(key))
  ipcMain.handle('settings:set', (_event, key: string, value: unknown) => services().settings.set(key, value))
  ipcMain.handle('settings:getAll', () => services().settings.getAll())
}
