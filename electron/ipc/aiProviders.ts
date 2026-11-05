import { app, net, safeStorage, type IpcMain } from 'electron'
import { createProviderKeyStore, type ProviderKeyStore } from '../secrets/providerKeys'
import { createCloudSettingsStore, type CloudSettingsStore } from '../secrets/providerSettings'
import { anthropicProvider, checkAnthropicKey, chooseProvider, type HttpRequest, type ModelProvider } from '../../src/lib/research/providers'
import { decide, DEFAULT_PERMISSIONS } from '../../src/lib/research/policy'
import type { CloudRoute } from '../modelGateway'

// BYO cloud keys (spec §7.4). The renderer can save, check and remove a key — it can never read
// one back. Keys are only decrypted in this process, for an outgoing provider request.
let store: ProviderKeyStore | null = null
export function providerKeys(): ProviderKeyStore {
  store ??= createProviderKeyStore(app.getPath('userData'), safeStorage)
  return store
}

let settingsStore: CloudSettingsStore | null = null
function cloudSettings(): CloudSettingsStore {
  settingsStore ??= createCloudSettingsStore(app.getPath('userData'))
  return settingsStore
}

const httpRequest: HttpRequest = async (url, init) => {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs)
  try {
    const res = await net.fetch(url, { method: init.method ?? 'POST', headers: init.headers, body: init.body, signal: init.signal ? AbortSignal.any([ctrl.signal, init.signal]) : ctrl.signal })
    return { status: res.status, json: () => res.json() }
  } finally {
    clearTimeout(timer)
  }
}

// Only stands in for "a local model path exists"; the lookup keeps calling Ollama directly.
const LOCAL: ModelProvider = {
  id: 'ollama', label: 'Local model', kind: 'local', capabilities: { json: true, tools: false, streaming: true },
  generate: async () => { throw new Error('Local calls go through electron/ollama.ts') },
}

export interface LookupRoute {
  route: CloudRoute | null
  /** May notes, conversation and profile instructions go into this request's prompts? */
  privateContext: boolean
  /** Shown on the reply: where the question went, or why the cloud wasn't used. */
  notice?: string
}

/** Decides one lookup's provider from the saved settings. Local unless the user enabled the cloud,
 *  a key and model exist, and the policy allows it — and never as a response to a local failure. */
export function routeForLookup(): LookupRoute {
  const s = cloudSettings().get()
  if (!s.cloudEnabled) return { route: null, privateContext: true }
  const key = providerKeys().read('anthropic')
  const cloud = key && s.cloudModel ? anthropicProvider(key, httpRequest) : null
  const settings = { ...DEFAULT_PERMISSIONS, cloudEnabled: true, cloudPrivateContext: s.cloudPrivateContext }
  if (!cloud) return { route: null, privateContext: true, notice: 'Cloud model not used: add an API key and model in Settings → Ask Berean. This answer used your local model.' }
  const choice = chooseProvider({ local: LOCAL, cloud, settings, preferCloud: true, offline: !net.isOnline() })
  if (choice.provider !== cloud) return { route: null, privateContext: true, notice: `Cloud model not used: ${choice.reason ?? 'not allowed.'} This answer used your local model.` }
  const context = decide('cloud-private-context', settings)
  return {
    route: { provider: cloud, model: s.cloudModel },
    privateContext: context.allowed,
    notice: `${cloud.label}, ${s.cloudModel}. ${choice.disclose}${context.allowed ? ` ${context.disclose}` : ''}`,
  }
}

export function registerAiProviderHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('aiProviders:saveKey', (_e, providerId: unknown, key: unknown) =>
    typeof providerId === 'string' && typeof key === 'string' ? providerKeys().save(providerId, key) : { ok: false, reason: 'Invalid input.' })
  ipcMain.handle('aiProviders:hasKey', (_e, providerId: unknown) => typeof providerId === 'string' && providerKeys().has(providerId))
  ipcMain.handle('aiProviders:removeKey', (_e, providerId: unknown) => {
    if (typeof providerId !== 'string') return { success: true }
    providerKeys().remove(providerId)
    // Without a key there is nothing left to be enabled.
    cloudSettings().set({ cloudEnabled: false })
    return { success: true }
  })
  ipcMain.handle('aiProviders:getSettings', () => cloudSettings().get())
  ipcMain.handle('aiProviders:setSettings', (_e, patch: unknown) => {
    const wantsOn = !!patch && typeof patch === 'object' && (patch as { cloudEnabled?: unknown }).cloudEnabled === true
    if (wantsOn && !providerKeys().has('anthropic')) return cloudSettings().get()
    return cloudSettings().set(patch)
  })
  // Lists models (free, no tokens billed) — only when the user presses Check key.
  ipcMain.handle('aiProviders:checkKey', async () => {
    const key = providerKeys().read('anthropic')
    if (!key) return { ok: false, reason: 'No key is saved.' }
    if (!net.isOnline()) return { ok: false, reason: 'You are offline.' }
    return checkAnthropicKey(key, httpRequest)
  })
}
