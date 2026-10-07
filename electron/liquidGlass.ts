import { app, BrowserWindow, ipcMain, nativeTheme, systemPreferences } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import log from 'electron-log/main'

/**
 * macOS Liquid Glass — main-process side of the Berean semantic glass API
 * (src/platform/liquidGlass). The renderer describes WHAT it wants (a sidebar pane, a grouped
 * control cluster); this file owns HOW: real AppKit views through the native bridge
 * (native/mac-liquid-glass → build/native/berean_glass.node).
 *
 *   NSGlassEffectView / NSGlassEffectContainerView   macOS 26+
 *   NSVisualEffectView                                older macOS
 *   nothing (renderer keeps its CSS material)          bridge missing / not macOS / failed
 *
 * Every native view is owned by one BrowserWindow and destroyed with it ('close'), and any
 * failure turns the bridge off for the session — the renderer then falls back to CSS, so a glass
 * problem can never leave an invisible native layer or a broken control behind.
 */

interface GlassAddon {
  capabilities(): string
  describe(handle: Buffer): string
  group(handle: Buffer, json: string): boolean
  surface(handle: Buffer, json: string): boolean
  destroy(handle: Buffer, id?: string, kind?: 'surface' | 'group'): boolean
  count(): number
  debugVibrancy(handle: Buffer, visible: boolean, cls?: string): boolean
}

export interface NativeGlassCapabilities {
  native: boolean
  glass: boolean
  container: boolean
  interactive: boolean
  reduceTransparency: boolean
  increaseContrast: boolean
  reduceMotion: boolean
  os: string
}

let addon: GlassAddon | null | undefined
let failed = false

function addonPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'native', 'berean_glass.node')
    : join(app.getAppPath(), 'build', 'native', 'berean_glass.node')
}

function load(): GlassAddon | null {
  if (addon !== undefined) return addon
  addon = null
  if (process.platform !== 'darwin' || process.env.BEREAN_NATIVE_GLASS === '0') return addon
  const file = addonPath()
  if (!existsSync(file)) { log.info(`[glass] native bridge not built (${file}) — CSS materials`); return addon }
  try {
    const mod = { exports: {} as GlassAddon }
    process.dlopen(mod, file)
    addon = mod.exports
    log.info(`[glass] native bridge loaded: ${addon.capabilities()}`)
  } catch (err) {
    log.error(`[glass] native bridge failed to load (${file})`, err)
  }
  return addon
}

export function nativeGlassCapabilities(): NativeGlassCapabilities {
  const a = failed ? null : load()
  const base = {
    reduceTransparency: nativeTheme.prefersReducedTransparency,
    increaseContrast: nativeTheme.shouldUseHighContrastColors,
    reduceMotion: process.platform === 'darwin' ? !systemPreferences.getAnimationSettings().shouldRenderRichAnimation : false,
  }
  if (!a) return { native: false, glass: false, container: false, interactive: false, os: '', ...base }
  try {
    const c = JSON.parse(a.capabilities()) as Omit<NativeGlassCapabilities, 'native'>
    return { ...c, native: true }
  } catch {
    return { native: false, glass: false, container: false, interactive: false, os: '', ...base }
  }
}

// Windows that have native glass, with the handle captured while the window is alive (the
// handle is useless after 'closed').
const tracked = new Map<number, Buffer>()

function handleFor(win: BrowserWindow): Buffer | null {
  if (win.isDestroyed()) return null
  let h = tracked.get(win.id)
  if (!h) {
    h = win.getNativeWindowHandle()
    tracked.set(win.id, h)
    const id = win.id
    win.once('close', () => {
      const handle = tracked.get(id)
      tracked.delete(id)
      if (handle && addon) { try { addon.destroy(handle) } catch { /* window already torn down */ } }
    })
  }
  return h
}

function guarded<T>(fn: (a: GlassAddon) => T, fallback: T): T {
  const a = failed ? null : load()
  if (!a) return fallback
  try {
    return fn(a)
  } catch (err) {
    // One failure turns native glass off for the session; the renderer falls back to CSS.
    failed = true
    log.error('[glass] native call failed — native glass disabled for this session', err)
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send('glass:disabled')
    return fallback
  }
}

export interface GlassSurfaceMessage {
  id: string
  rect: { x: number; y: number; width: number; height: number }
  variant?: 'regular' | 'clear'
  role?: string
  cornerRadius?: number
  tint?: string | null
  interactive?: boolean
  group?: string | null
  pin?: { top?: boolean; bottom?: boolean; left?: boolean; right?: boolean }
  visible?: boolean
  placement?: 'behind' | 'above'
}

export interface GlassGroupMessage {
  id: string
  rect: { x: number; y: number; width: number; height: number }
  spacing?: number
  pin?: { top?: boolean; bottom?: boolean; left?: boolean; right?: boolean }
  visible?: boolean
}

export function registerLiquidGlassIpc(): void {
  ipcMain.handle('glass:capabilities', () => nativeGlassCapabilities())

  // Berean's own Light / Dark / System setting drives the NATIVE appearance too, so native glass,
  // vibrancy, menus, context menus, dialogs and scrollbars all match the app's theme rather than
  // the system's (a dark Berean on a light Mac used to get light native surfaces).
  ipcMain.on('app:setThemeSource', (_event, source: unknown) => {
    if (source === 'light' || source === 'dark' || source === 'system') nativeTheme.themeSource = source
  })

  ipcMain.handle('glass:surface', (event, msg: GlassSurfaceMessage) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const h = win && handleFor(win)
    if (!h || !win) return false
    const zoom = event.sender.getZoomFactor()
    return guarded((a) => a.surface(h, JSON.stringify({ ...msg, zoom })), false)
  })

  ipcMain.handle('glass:group', (event, msg: GlassGroupMessage) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const h = win && handleFor(win)
    if (!h || !win) return false
    const zoom = event.sender.getZoomFactor()
    return guarded((a) => a.group(h, JSON.stringify({ ...msg, zoom })), false)
  })

  ipcMain.handle('glass:destroy', (event, id?: string, kind?: 'surface' | 'group') => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const h = win && tracked.get(win.id)
    if (!h) return false
    return guarded((a) => a.destroy(h, id, kind), false)
  })

  // Diagnostics for visual QA (dev builds only): live native view count + the window's view tree;
  // `vibrancy` / `hide` / `show` toggle the window's own backdrop / web view to isolate layering.
  ipcMain.handle('glass:debug', (event, opts?: { vibrancy?: boolean; hide?: string; show?: string }) => {
    if (app.isPackaged) return null
    const win = BrowserWindow.fromWebContents(event.sender)
    const h = win && handleFor(win)
    if (h && typeof opts?.vibrancy === 'boolean') guarded((a) => a.debugVibrancy(h, opts.vibrancy!), false)
    if (h && opts?.hide) guarded((a) => a.debugVibrancy(h, false, opts.hide), false)
    if (h && opts?.show) guarded((a) => a.debugVibrancy(h, true, opts.show), false)
    return guarded((a) => ({ count: a.count(), tree: h ? a.describe(h) : '' }), null)
  })
}
