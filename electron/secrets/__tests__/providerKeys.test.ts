import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProviderKeyStore, type SafeStorageLike } from '../providerKeys'

// A reversible stand-in for safeStorage: output never contains the plaintext.
const fakeSafe = (available = true): SafeStorageLike => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from([...s].reverse().join('') + '#enc'),
  decryptString: (b) => [...b.toString().replace(/#enc$/, '')].reverse().join(''),
})

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'berean-keys-')) })

describe('provider key store (spec §7.4)', () => {
  it('stores keys encrypted, never in plaintext, with owner-only permissions', () => {
    const s = createProviderKeyStore(dir, fakeSafe())
    expect(s.save('anthropic', 'sk-ant-secret-123')).toEqual({ ok: true })
    const raw = readFileSync(join(dir, 'provider-keys.json'), 'utf8')
    expect(raw).not.toContain('sk-ant-secret-123')
    expect(statSync(join(dir, 'provider-keys.json')).mode & 0o777).toBe(0o600)
    expect(s.has('anthropic')).toBe(true)
    expect(s.read('anthropic')).toBe('sk-ant-secret-123')
  })

  it('refuses to save when OS encryption is unavailable (no plaintext fallback)', () => {
    const s = createProviderKeyStore(dir, fakeSafe(false))
    expect(s.save('anthropic', 'sk-x')).toMatchObject({ ok: false })
    expect(existsSync(join(dir, 'provider-keys.json'))).toBe(false)
  })

  it('rejects malformed input and unknown ids; remove deletes the file when empty', () => {
    const s = createProviderKeyStore(dir, fakeSafe())
    expect(s.save('anthropic', 'has space').ok).toBe(false)
    expect(s.save('../evil', 'sk-x').ok).toBe(false)
    s.save('anthropic', 'sk-x')
    s.remove('anthropic')
    expect(s.has('anthropic')).toBe(false)
    expect(existsSync(join(dir, 'provider-keys.json'))).toBe(false)
  })
})
