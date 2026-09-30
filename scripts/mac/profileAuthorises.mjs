import { execFileSync } from 'node:child_process'

// Does a provisioning profile's entitlement value authorise the values the app is signed with?
// Profiles list most keys as arrays (["iCloud.com.berean.app"], wildcards like "6C8RCZVUZR.*"
// stay literal), but Apple writes some as the bare string "*" — a Mac App Store profile with
// iCloud has `com.apple.developer.icloud-services = "*"` (any service). Used by verify-mas.mjs.
export function profileAuthorises(allowed, want) {
  if (allowed === '*') return true
  return Array.isArray(allowed) && want.every((v) => allowed.includes(v) || allowed.includes('*'))
}

// Read one value from a decoded profile plist. Arrays/dicts come out of `plutil -extract … json`;
// a plain string such as icloud-services "*" does not (plutil: "Invalid object in plist for JSON
// format"), so fall back to `raw`. Returns undefined when the key is absent.
export function readProfileValue(plistPath, keyPath) {
  const extract = (fmt) => execFileSync('plutil', ['-extract', keyPath, fmt, '-o', '-', plistPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  try { return JSON.parse(extract('json')) } catch { /* scalar value, or absent */ }
  try { return extract('raw').trim() } catch { return undefined }
}
