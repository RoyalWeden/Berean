// BYO cloud API keys (spec §7.4, §8.5): encrypted with Electron safeStorage, whose key lives in
// the macOS Keychain. Never stored in plain JSON, SQLite, settings, logs or analytics, and never
// sent to the renderer — the renderer can only save, check and delete. If OS encryption is
// unavailable the key is refused rather than stored in plaintext.

import { existsSync, readFileSync, renameSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean
  encryptString(plain: string): Buffer
  decryptString(enc: Buffer): string
}

export interface ProviderKeyStore {
  save(providerId: string, key: string): { ok: true } | { ok: false; reason: string }
  has(providerId: string): boolean
  remove(providerId: string): void
  /** Main process only — for the outgoing request header. */
  read(providerId: string): string | null
}

const ID_RE = /^[a-z][a-z0-9-]{1,31}$/

export function createProviderKeyStore(dir: string, safe: SafeStorageLike): ProviderKeyStore {
  const file = join(dir, 'provider-keys.json')
  const load = (): Record<string, string> => {
    if (!existsSync(file)) return {}
    try { return JSON.parse(readFileSync(file, 'utf8')) as Record<string, string> } catch { return {} }
  }
  const store = (data: Record<string, string>) => {
    if (Object.keys(data).length === 0) { if (existsSync(file)) unlinkSync(file); return }
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 })
    renameSync(tmp, file)
  }
  return {
    save(providerId, key) {
      if (!ID_RE.test(providerId)) return { ok: false, reason: 'Unknown provider.' }
      const trimmed = key.trim()
      if (!trimmed || trimmed.length > 512 || /\s/.test(trimmed)) return { ok: false, reason: 'That doesn’t look like an API key.' }
      if (!safe.isEncryptionAvailable()) return { ok: false, reason: 'Secure storage is unavailable, so the key was not saved.' }
      const data = load()
      data[providerId] = safe.encryptString(trimmed).toString('base64')
      store(data)
      return { ok: true }
    },
    has(providerId) { return typeof load()[providerId] === 'string' },
    remove(providerId) { const data = load(); delete data[providerId]; store(data) },
    read(providerId) {
      const enc = load()[providerId]
      if (!enc || !safe.isEncryptionAvailable()) return null
      try { return safe.decryptString(Buffer.from(enc, 'base64')) } catch { return null }
    },
  }
}
