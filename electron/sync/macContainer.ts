import { join } from 'path'
import log from 'electron-log'

/**
 * iCloud ubiquity-container access for the Mac App Store build (docs/mac-app-store.md §3).
 *
 * The DMG (Developer ID) build is not sandboxed and reaches the container by path. The sandboxed
 * MAS build cannot: `os.homedir()` is its own container, the system only opens the ubiquity
 * container to the process after `URLForUbiquityContainerIdentifier`, and `brctl` cannot run in
 * the sandbox. The native helper (native/mac-icloud) makes those two calls. Outside the MAS build
 * every function here is inert, so the DMG path is untouched.
 */
interface MacICloudAddon {
  containerPath(identifier?: string): Promise<string | null>
  startDownloading(path: string): boolean
}

let addon: MacICloudAddon | null | undefined

export function isMasSandbox(): boolean {
  return process.platform === 'darwin' && process.mas === true
}

function loadAddon(): MacICloudAddon | null {
  if (addon !== undefined) return addon
  addon = null
  if (!isMasSandbox()) return addon
  const file = join(process.resourcesPath, 'native', 'berean_icloud.node')
  try {
    const mod = { exports: {} as MacICloudAddon }
    process.dlopen(mod, file)
    addon = mod.exports
  } catch (err) {
    log.error(`[sync] iCloud helper failed to load (${file})`, err)
  }
  return addon
}

/**
 * The container root (…/Mobile Documents/iCloud~com~berean~app) for the MAS build, or null when
 * iCloud is unavailable (signed out, iCloud Drive off) or this is not the MAS build. Calling it is
 * what extends the sandbox to the container, so it runs before any path access.
 */
export async function masContainerRoot(containerId: string): Promise<string | null> {
  const a = loadAddon()
  if (!a) return null
  try {
    return await a.containerPath(containerId)
  } catch (err) {
    log.warn('[sync] iCloud container lookup failed', err)
    return null
  }
}

/** Ask iCloud to download an evicted file (MAS replacement for `brctl download`). */
export function masStartDownloading(path: string): boolean {
  const a = loadAddon()
  if (!a) return false
  try { return a.startDownloading(path) } catch { return false }
}
