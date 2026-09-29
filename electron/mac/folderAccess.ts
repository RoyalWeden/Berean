import { app, dialog, type BrowserWindow, type OpenDialogOptions } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import log from 'electron-log'

/**
 * Folder access that survives relaunch in the Mac App Store build (docs/mac-app-store.md §4).
 *
 * The sandbox only grants access to a folder the user picked for the rest of that session. With
 * `com.apple.security.files.bookmarks.app-scope`, the picker returns a security-scoped bookmark;
 * it is kept in userData (local to this Mac, never synced) and re-opened at startup, so the vault
 * folder and a custom sync folder keep working. In the DMG build (not sandboxed) this is a plain
 * folder picker and nothing is stored.
 */
const MAX_BOOKMARKS = 32

function file(): string {
  return join(app.getPath('userData'), 'sandbox-bookmarks.json')
}

function load(): Record<string, string> {
  try {
    const parsed = JSON.parse(readFileSync(file(), 'utf8')) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {}
  } catch {
    return {}
  }
}

function save(map: Record<string, string>): void {
  try { writeFileSync(file(), JSON.stringify(map), 'utf8') } catch (err) { log.warn('[sandbox] could not store folder bookmark', err) }
}

/** Show a folder picker; in the MAS build keep access to the chosen folder across launches. */
export async function pickFolder(opts: OpenDialogOptions, parent?: BrowserWindow | null): Promise<string | null> {
  const mas = process.mas === true
  const options: OpenDialogOptions = { ...opts, securityScopedBookmarks: mas }
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
  const chosen = result.canceled ? null : (result.filePaths[0] ?? null)
  if (!chosen || !mas) return chosen
  const bookmark = result.bookmarks?.[0]
  if (bookmark) {
    try { app.startAccessingSecurityScopedResource(bookmark) } catch (err) { log.warn('[sandbox] could not open folder bookmark', err) }
    const map = load()
    delete map[chosen]
    map[chosen] = bookmark
    const keys = Object.keys(map)
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_BOOKMARKS))) delete map[k]
    save(map)
  } else {
    log.warn('[sandbox] folder picker returned no bookmark — access ends when Berean quits')
  }
  return chosen
}

/** MAS build: re-open every folder the user picked before (call once at startup, before use). */
export function restoreFolderAccess(): void {
  if (process.mas !== true) return
  const map = load()
  let opened = 0
  for (const bookmark of Object.values(map)) {
    try { app.startAccessingSecurityScopedResource(bookmark); opened++ } catch { /* stale bookmark */ }
  }
  if (opened) log.info(`[sandbox] restored access to ${opened} folder(s)`)
}
