import type { IpcMain } from 'electron'
import { getBereanDb } from '../db/berean'

export function registerSettingsHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('settings:get', (_event, key: string) => {
    const row = getBereanDb()
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get(key) as { value: string } | undefined
    return row ? JSON.parse(row.value) : null
  })

  ipcMain.handle('settings:set', (_event, key: string, value: unknown) => {
    getBereanDb()
      .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run(key, JSON.stringify(value))
    return { success: true }
  })

  ipcMain.handle('settings:getAll', () => {
    const rows = getBereanDb()
      .prepare('SELECT key, value FROM settings')
      .all() as Array<{ key: string; value: string }>
    return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]))
  })
}
