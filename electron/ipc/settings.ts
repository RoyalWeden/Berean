import type { IpcMain } from 'electron'

const store: Record<string, unknown> = {
  theme: 'dark',
  defaultText: 'kjv',
  showStrongs: false,
  showStrongsTooltips: true,
  strongsClickOpensTab: true,
  fontSize: 16,
  lineHeight: 'comfortable',
  vaultPath: '/Users/roywe/Library/Mobile Documents/com~apple~CloudDocs/Octarine/workspaces/bible',
  vaultSync: false
}

export function registerSettingsHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('settings:get', (_event, key: string) => {
    return store[key] ?? null
  })

  ipcMain.handle('settings:set', (_event, key: string, value: unknown) => {
    store[key] = value
    return { success: true }
  })

  ipcMain.handle('settings:getAll', (_event) => {
    return { ...store }
  })
}
