import { describe, it, expect } from 'vitest'
import { profileAuthorises } from '../profileAuthorises.mjs'

// Values as they appear in "Berean MAS Distribution 2026" (Mac App Store, iCloud enabled).
describe('verify-mas: provisioning profile authorisation', () => {
  it('accepts Apple\'s bare "*" for icloud-services', () => {
    expect(profileAuthorises('*', ['CloudDocuments'])).toBe(true)
  })
  it('accepts arrays that list the value, or "*" inside the array', () => {
    expect(profileAuthorises(['iCloud.com.berean.app'], ['iCloud.com.berean.app'])).toBe(true)
    expect(profileAuthorises(['*'], ['CloudDocuments'])).toBe(true)
  })
  it('rejects a missing key, a different container or another single string', () => {
    expect(profileAuthorises(undefined, ['CloudDocuments'])).toBe(false)
    expect(profileAuthorises(['iCloud.com.other'], ['iCloud.com.berean.app'])).toBe(false)
    expect(profileAuthorises('CloudKit', ['CloudDocuments'])).toBe(false)
  })
})
