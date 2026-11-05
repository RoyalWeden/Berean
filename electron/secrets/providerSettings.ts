// Non-secret cloud provider preferences (the key itself lives in providerKeys.ts). Kept in the
// main process so a renderer can't grant itself cloud access per request: a lookup reads this file,
// never an option it was sent.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface CloudSettings {
  /** The user turned cloud inference on (spec §7.3: off until explicit opt-in). */
  cloudEnabled: boolean
  /** Separate consent to send notes, conversation and profile instructions (spec §7.3). */
  cloudPrivateContext: boolean
  /** Model id the user chose. Berean never picks a billed model for them. */
  cloudModel: string
  /** Online research (spec §7.3): separate from cloud inference, off until the user chooses. */
  web: 'off' | 'ask' | 'auto'
}

export const DEFAULT_CLOUD_SETTINGS: CloudSettings = { cloudEnabled: false, cloudPrivateContext: false, cloudModel: '', web: 'off' }

const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/

export interface CloudSettingsStore {
  get(): CloudSettings
  set(patch: unknown): CloudSettings
}

export function createCloudSettingsStore(dir: string): CloudSettingsStore {
  const file = join(dir, 'ai-cloud-settings.json')
  const get = (): CloudSettings => {
    if (!existsSync(file)) return DEFAULT_CLOUD_SETTINGS
    try { return clean(JSON.parse(readFileSync(file, 'utf8'))) } catch { return DEFAULT_CLOUD_SETTINGS }
  }
  return {
    get,
    set(patch) {
      const next = clean({ ...get(), ...(patch && typeof patch === 'object' ? patch : {}) })
      const tmp = `${file}.tmp`
      writeFileSync(tmp, JSON.stringify(next), { mode: 0o600 })
      renameSync(tmp, file)
      return next
    },
  }
}

/** Anything unrecognised reads as off. */
function clean(raw: unknown): CloudSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const cloudModel = typeof r.cloudModel === 'string' && MODEL_RE.test(r.cloudModel.trim()) ? r.cloudModel.trim() : ''
  const web = r.web === 'ask' || r.web === 'auto' ? r.web : 'off'
  return { cloudEnabled: r.cloudEnabled === true, cloudPrivateContext: r.cloudPrivateContext === true, cloudModel, web }
}
