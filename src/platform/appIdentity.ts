import identityConfig from '../../config/app-identity.json'

/**
 * Berean's two app identities (config/app-identity.json; docs/mobile/icloud-lifecycle.md §6).
 *
 * Production (`com.berean.app`) and development ("Berean Dev", `com.berean.app.dev`) are separate
 * apps: separate bundle ID (local data / sandbox boundary), iCloud container (sync data boundary —
 * iCloud Documents has no development/production split inside one container), App Group (Share
 * Extension boundary), URL schemes (no cross-launch) and local database folder. Everything that
 * needs one of these values derives it from here; nothing falls back to the other identity.
 */
export type AppIdentityName = 'production' | 'development'

export interface AppIdentity {
  name: AppIdentityName
  bundleId: string
  appName: string
  cloudContainer: string
  appGroup: string
  urlScheme: string
  pdfUrlScheme: string
  /** Folder under the OS app-data directory that holds berean.db (Electron `userData`). */
  userDataDir: string
}

export const TEAM_ID: string = identityConfig.teamId
const NAMES: readonly AppIdentityName[] = ['production', 'development']

export function appIdentity(name: AppIdentityName): AppIdentity {
  if (!NAMES.includes(name)) throw new Error(`unknown app identity: ${String(name)}`)
  return { name, ...identityConfig.identities[name] }
}

export function otherIdentity(name: AppIdentityName): AppIdentity {
  return appIdentity(name === 'production' ? 'development' : 'production')
}

export function parseIdentityName(value: unknown): AppIdentityName {
  if (value === 'production' || value === 'development') return value
  throw new Error(`BEREAN_IDENTITY must be "production" or "development", got ${JSON.stringify(value)}`)
}

/** Share Extension bundle ID — always the app's own bundle ID + `.share`. */
export function shareExtensionBundleId(id: AppIdentity): string {
  return `${id.bundleId}.share`
}

/** macOS sandbox application group Electron needs for its helper processes (TEAMID.bundle-id). */
export function macAppGroup(id: AppIdentity): string {
  return `${TEAM_ID}.${id.bundleId}`
}

/** Every URL scheme either identity registers — the in-app router understands all of them. */
export function allDeepLinkSchemes(): string[] {
  return NAMES.flatMap((n) => { const i = appIdentity(n); return [i.urlScheme, i.pdfUrlScheme] })
}

/** `iCloud.com.berean.app` → `iCloud~com~berean~app` (the folder name under Mobile Documents). */
export function containerFolderName(containerId: string): string {
  return containerId.replace(/\./g, '~')
}

/**
 * Refuses a container that is not this identity's own. Used by the sync hosts so a stale setting,
 * a copied database or a mis-built binary can never point one identity at the other's data.
 */
export function assertOwnContainer(id: AppIdentity, containerId: string): void {
  if (containerId !== id.cloudContainer) {
    throw new Error(`${id.appName} may only sync through ${id.cloudContainer}, not ${containerId}`)
  }
}

/**
 * True when `path` lies inside another identity's iCloud container folder
 * (…/Mobile Documents/iCloud~com~berean~app[~dev]/…), compared by whole path segment so the
 * production folder name is never mistaken for a prefix of the development one.
 */
export function isForeignContainerPath(id: AppIdentity, path: string): boolean {
  const segments = path.split('/').filter(Boolean)
  const foreign = NAMES.filter((n) => n !== id.name).map((n) => containerFolderName(appIdentity(n).cloudContainer))
  return segments.some((s) => foreign.includes(s))
}
