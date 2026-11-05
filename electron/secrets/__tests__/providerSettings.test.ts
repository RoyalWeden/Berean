import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCloudSettingsStore, DEFAULT_CLOUD_SETTINGS } from '../providerSettings'

const dir = () => mkdtempSync(join(tmpdir(), 'berean-cloud-'))

describe('cloud settings', () => {
  it('defaults to everything off', () => {
    expect(createCloudSettingsStore(dir()).get()).toEqual(DEFAULT_CLOUD_SETTINGS)
    expect(DEFAULT_CLOUD_SETTINGS).toEqual({ cloudEnabled: false, cloudPrivateContext: false, cloudModel: '', web: 'off' })
  })
  it('persists a change and ignores unknown or malformed values', () => {
    const d = dir()
    const s = createCloudSettingsStore(d)
    s.set({ cloudEnabled: true, cloudModel: ' claude-haiku-5-5 ', apiKey: 'sk-should-not-persist' })
    expect(s.get()).toEqual({ cloudEnabled: true, cloudPrivateContext: false, cloudModel: 'claude-haiku-5-5', web: 'off' })
    expect(readFileSync(join(d, 'ai-cloud-settings.json'), 'utf8')).not.toContain('sk-should-not-persist')
    expect(s.set({ cloudPrivateContext: 'yes', cloudModel: 'bad model!', web: 'always' })).toMatchObject({ cloudPrivateContext: false, cloudModel: '', web: 'off' })
  })
  it('reads a corrupt file as off', () => {
    const d = dir()
    writeFileSync(join(d, 'ai-cloud-settings.json'), '{nope')
    expect(createCloudSettingsStore(d).get()).toEqual(DEFAULT_CLOUD_SETTINGS)
  })
})
