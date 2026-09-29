// Does a provisioning profile's entitlement value authorise the values the app is signed with?
// Profiles list most keys as arrays (["iCloud.com.berean.app"], wildcards like "6C8RCZVUZR.*"
// stay literal), but Apple writes some as the bare string "*" — a Mac App Store profile with
// iCloud has `com.apple.developer.icloud-services = "*"` (any service). Used by verify-mas.mjs.
export function profileAuthorises(allowed, want) {
  if (allowed === '*') return true
  return Array.isArray(allowed) && want.every((v) => allowed.includes(v) || allowed.includes('*'))
}
