import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { profileAuthorises, readProfileValue } from '../profileAuthorises.mjs'

// The real read path of verify-mas: a decoded Mac App Store profile keeps icloud-services as the
// plain string "*", which `plutil -extract … json` cannot output (the 2026-09-29 false failure).
const PROFILE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Name</key><string>Berean MAS Distribution 2026</string>
  <key>ExpirationDate</key><date>2027-05-29T19:06:54Z</date>
  <key>Entitlements</key><dict>
    <key>com.apple.application-identifier</key><string>6C8RCZVUZR.com.berean.app</string>
    <key>com.apple.developer.icloud-container-identifiers</key><array><string>iCloud.com.berean.app</string></array>
    <key>com.apple.developer.ubiquity-container-identifiers</key><array><string>iCloud.com.berean.app</string></array>
    <key>com.apple.developer.icloud-services</key><string>*</string>
  </dict>
</dict></plist>`

const key = (k) => `Entitlements.${k.replace(/\./g, '\\.')}`
let dir
let file
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'berean-profile-')); file = join(dir, 'profile.plist'); writeFileSync(file, PROFILE) })
afterAll(() => { rmSync(dir, { recursive: true, force: true }) })

describe.skipIf(process.platform !== 'darwin')('verify-mas: reading profile values', () => {
  it('reads the plain-string icloud-services "*" and it authorises CloudDocuments', () => {
    const services = readProfileValue(file, key('com.apple.developer.icloud-services'))
    expect(services).toBe('*')
    expect(profileAuthorises(services, ['CloudDocuments'])).toBe(true)
  })
  it('still reads list-valued fields as arrays', () => {
    for (const k of ['com.apple.developer.icloud-container-identifiers', 'com.apple.developer.ubiquity-container-identifiers']) {
      const v = readProfileValue(file, key(k))
      expect(v).toEqual(['iCloud.com.berean.app'])
      expect(profileAuthorises(v, ['iCloud.com.berean.app'])).toBe(true)
    }
  })
  it('returns undefined for a missing key, which is not authorised', () => {
    const v = readProfileValue(file, key('com.apple.developer.icloud-services-missing'))
    expect(v).toBeUndefined()
    expect(profileAuthorises(v, ['CloudDocuments'])).toBe(false)
  })
})
