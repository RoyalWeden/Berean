import { app, safeStorage, type IpcMain } from 'electron'
import { createProviderKeyStore, type ProviderKeyStore } from '../secrets/providerKeys'

// BYO cloud keys (spec §7.4). The renderer can save, check and remove a key — it can never read
// one back. Keys are only decrypted in this process, for an outgoing provider request.
let store: ProviderKeyStore | null = null
export function providerKeys(): ProviderKeyStore {
  store ??= createProviderKeyStore(app.getPath('userData'), safeStorage)
  return store
}

export function registerAiProviderHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('aiProviders:saveKey', (_e, providerId: unknown, key: unknown) =>
    typeof providerId === 'string' && typeof key === 'string' ? providerKeys().save(providerId, key) : { ok: false, reason: 'Invalid input.' })
  ipcMain.handle('aiProviders:hasKey', (_e, providerId: unknown) => typeof providerId === 'string' && providerKeys().has(providerId))
  ipcMain.handle('aiProviders:removeKey', (_e, providerId: unknown) => {
    if (typeof providerId === 'string') providerKeys().remove(providerId)
    return { success: true }
  })
}
