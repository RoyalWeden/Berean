import { describe, it, expect } from 'vitest'
import { decide, DEFAULT_PERMISSIONS as D } from '../policy'

// One test per row of the spec §7.3 permission matrix.
describe('permission policy (spec §7.3)', () => {
  it('local Scripture is always allowed, offline too', () => {
    expect(decide('local-scripture', D, { offline: true })).toEqual({ allowed: true })
  })

  it('verse-note metadata: allowed unless the profile turns it off or the note is excluded', () => {
    expect(decide('verse-note-metadata', D).allowed).toBe(true)
    expect(decide('verse-note-metadata', { ...D, useVerseNotes: false }).allowed).toBe(false)
    expect(decide('verse-note-metadata', D, { excluded: true }).allowed).toBe(false)
  })

  it('full note content for the local model: allowed and disclosed; never for excluded notes', () => {
    expect(decide('note-content-local', D)).toMatchObject({ allowed: true, disclose: expect.stringMatching(/this device only/) })
    expect(decide('note-content-local', D, { excluded: true }).allowed).toBe(false)
  })

  it('standalone notes: off by default, on by profile opt-in or an explicit ask', () => {
    expect(decide('standalone-notes', D).allowed).toBe(false)
    expect(decide('standalone-notes', { ...D, useStandaloneNotes: true }).allowed).toBe(true)
    expect(decide('standalone-notes', D, { explicitRequest: true }).allowed).toBe(true)
  })

  it('web: off by default; ask needs consent; auto allowed with disclosure; offline denied', () => {
    expect(decide('web-search', D)).toMatchObject({ allowed: false, needsConsent: false })
    expect(decide('web-search', { ...D, web: 'ask' })).toMatchObject({ allowed: false, needsConsent: true })
    expect(decide('web-search', { ...D, web: 'ask' }, { explicitRequest: true }).allowed).toBe(true)
    expect(decide('web-search', { ...D, web: 'auto' })).toMatchObject({ allowed: true, disclose: expect.stringMatching(/never your notes/) })
    expect(decide('web-search', { ...D, web: 'auto' }, { offline: true }).allowed).toBe(false)
  })

  it('cloud question: only with a cloud model enabled, disclosed with billing', () => {
    expect(decide('cloud-question', D).allowed).toBe(false)
    expect(decide('cloud-question', { ...D, cloudEnabled: true })).toMatchObject({ allowed: true, disclose: expect.stringMatching(/billed to your key/) })
  })

  it('private context to the cloud: denied even with cloud enabled, unless separately consented', () => {
    expect(decide('cloud-private-context', { ...D, cloudEnabled: true })).toMatchObject({ allowed: false, needsConsent: true })
    expect(decide('cloud-private-context', { ...D, cloudEnabled: true, cloudPrivateContext: true }).allowed).toBe(true)
    expect(decide('cloud-private-context', { ...D, cloudEnabled: true, cloudPrivateContext: true }, { excluded: true }).allowed).toBe(false)
  })

  it('logging prompts, notes or keys: always denied', () => {
    expect(decide('log-content', { ...D, web: 'auto', cloudEnabled: true, cloudPrivateContext: true }).allowed).toBe(false)
  })
})
