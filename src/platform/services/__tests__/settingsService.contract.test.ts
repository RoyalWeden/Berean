import { describe, it, expect } from 'vitest'
import { makeContext, migratedUserDb } from '../../db/__tests__/testDb'
import { createSettingsService } from '../settingsService'

describe('settingsService', () => {
  it('round-trips JSON values, returns null for missing keys, and lists all', async () => {
    const svc = createSettingsService(makeContext({ userDb: await migratedUserDb() }))
    expect(await svc.get('nope')).toBeNull()
    // v1 migration seeds defaults as JSON
    expect(await svc.get('defaultText')).toBe('kjva')
    expect(await svc.get('showStrongs')).toBe(false)
    expect(await svc.set('fontSize', 18)).toEqual({ success: true })
    expect(await svc.get('fontSize')).toBe(18)
    await svc.set('obj', { a: [1, 2], b: null })
    expect(await svc.get('obj')).toEqual({ a: [1, 2], b: null })
    const all = await svc.getAll()
    expect(all.fontSize).toBe(18)
    expect(all.obj).toEqual({ a: [1, 2], b: null })
    expect(all.vaultSync).toBe(false)
  })
})
