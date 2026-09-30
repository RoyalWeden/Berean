import { app } from 'electron'
import { readFileSync } from 'fs'
import { join } from 'path'
import { appIdentity, parseIdentityName, type AppIdentity } from '../src/platform/appIdentity'

/**
 * The identity this Mac process runs as (src/platform/appIdentity.ts). One decision, made here:
 *  - not packaged (`npm run dev`, `electron-vite preview`) → development, always;
 *  - packaged → the identity the bundle was built for (`BEREAN_IDENTITY` at `npm run build`,
 *    compiled in by electron.vite.config.ts; production unless `build:mas:dev` set it).
 */
declare const __BEREAN_IDENTITY__: string
export const BUILD_IDENTITY: string = __BEREAN_IDENTITY__
export const APP_IDENTITY: AppIdentity = appIdentity(app.isPackaged ? parseIdentityName(BUILD_IDENTITY) : 'development')

let bundleCheck: string | null | undefined

/**
 * Null when the running app's real bundle ID matches the identity it was compiled for, otherwise
 * why not (e.g. a development JavaScript bundle packaged into the production app). The sync host
 * refuses to start on a mismatch. Only packaged macOS builds have a bundle to check.
 */
export function identityProblem(): string | null {
  if (bundleCheck !== undefined) return bundleCheck
  bundleCheck = null
  if (!app.isPackaged || process.platform !== 'darwin') return bundleCheck
  try {
    const plist = readFileSync(join(process.resourcesPath, '..', 'Info.plist'), 'utf8')
    const bundleId = /<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1]
    if (bundleId !== APP_IDENTITY.bundleId) {
      bundleCheck = `this app (${bundleId ?? 'unknown bundle ID'}) was built as ${APP_IDENTITY.appName} (${APP_IDENTITY.bundleId})`
    }
  } catch (err) {
    bundleCheck = `could not read the app's bundle ID: ${err instanceof Error ? err.message : String(err)}`
  }
  return bundleCheck
}
