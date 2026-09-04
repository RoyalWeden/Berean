import { app, BrowserWindow, ipcMain, session, dialog, shell, nativeImage, Menu, nativeTheme, screen, systemPreferences } from 'electron'
import type Electron from 'electron'
import { join } from 'path'
import { mkdirSync, openSync, writeSync } from 'fs'
import os from 'os'
import { is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'
import { setupPowerAwareness, getResourceMode } from './powerAwareness'
import { buildCSP } from './csp'

// Write to a known container path before anything else — captures crashes that happen
// before app.ready (before electron-log knows its path).
const EARLY_LOG_DIR = join(os.homedir(), 'Library', 'Containers', 'com.berean.app', 'Data')
const EARLY_LOG = join(EARLY_LOG_DIR, 'berean-startup.log')
// Still write synchronously (so a crash moments later can't lose the last line —
// electron-log isn't usable this early, so these breadcrumbs are the only on-disk
// record of a pre-ready native crash). But hold ONE append-mode fd for the whole
// process instead of re-opening the file on every line: appendFileSync does
// open()+write()+close() every call, so a persistent fd + writeSync keeps the exact
// same synchronous durability while dropping the redundant open/close syscalls from
// each of the ~20 boot breadcrumbs.
// systemPreferences.getAccentColor() is macOS/Windows-only and can throw on other
// platforms or when no accent color is available — treat any failure as "unknown".
function safeGetAccentColor(): string | null {
  try {
    return systemPreferences.getAccentColor?.() ?? null
  } catch {
    return null
  }
}

// Electron returns accent color as hex ("rrggbb" or "rrggbbaa") — convert to the "r g b"
// decimal-triple string the rest of the app's palette (--color-accent etc.) uses.
function hexToRgbTriple(hex: string | null): string | null {
  if (!hex || hex.length < 6) return null
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  if ([r, g, b].some((n) => Number.isNaN(n))) return null
  return `${r} ${g} ${b}`
}

let earlyLogFd: number | null = null
function earlyLog(msg: string) {
  try {
    if (earlyLogFd === null) {
      mkdirSync(EARLY_LOG_DIR, { recursive: true })
      earlyLogFd = openSync(EARLY_LOG, 'a')
    }
    writeSync(earlyLogFd, `[${new Date().toISOString()}] ${msg}\n`)
  } catch { /* sandbox may block this pre-ready; tolerate */ }
}
earlyLog('main.ts: module loaded')
// Dev-only: verify the early log is actually writing by reading it back, confirming
// the container path is correct. Pure development sanity check — skipped in packaged
// builds so production cold start doesn't pay a synchronous readFileSync every launch.
if (is.dev) {
  try {
    const { readFileSync } = require('fs') as typeof import('fs')
    const contents = readFileSync(EARLY_LOG, 'utf8')
    if (!contents.includes('module loaded')) {
      earlyLog('WARNING: log verify mismatch')
    }
  } catch { /* will be caught if file not yet created */ }
}
import { getBereanDb, closeBereanDb, mergeYouTubeSeed } from './db/berean'
import { closeAllTextDbs } from './db/bible'
import { closeLexiconDbs } from './db/lexicon'
import { registerBibleHandlers } from './ipc/bible'
import { registerNotesHandlers } from './ipc/notes'
import { registerPdfHandlers } from './ipc/pdf'
import { registerVaultHandlers, runExportAll, setupAutoExport, AUTO_EXPORT_INTERVAL_MINUTES, setupTrashPurge } from './ipc/vault'
import { registerSettingsHandlers } from './ipc/settings'
import { registerLexiconHandlers } from './ipc/lexicon'
import { registerHighlightHandlers } from './ipc/highlights'
import { registerVerseTagHandlers } from './ipc/verseTags'
import { registerYouTubeHandlers } from './ipc/youtube'
import { registerCrossRefsHandlers } from './ipc/crossrefs'
import { registerAiLookupHandlers } from './ipc/aiLookup'
import { registerBgImportHandlers } from './ipc/bgImport'
import { registerESwordImportHandlers } from './ipc/eSwordImport'
import { registerHistoryHandlers } from './ipc/history'
import { registerStudyTrailHandlers } from './ipc/studyTrail'
import { registerWorkspacesHandlers } from './ipc/workspaces'
import { registerPlaylistsHandlers } from './ipc/playlists'
import { registerTTSModelHandlers } from './ipc/ttsModel'
import { registerTTSAudioCacheHandlers } from './ipc/ttsAudioCache'
import { registerTTSModelScheme, registerTTSModelProtocolHandler } from './ttsModelProtocol'

// Must run before app.whenReady() — Electron ignores privileged-scheme registration once the
// app is ready (see ttsModelProtocol.ts's file header for why this scheme exists at all).
registerTTSModelScheme()

// Chromium's default autoplay policy requires a recent-enough user gesture before it'll play
// audible media — normally a sane default for a public web page, but wrong for a packaged
// desktop app with no ads/background tabs to guard against. Read Aloud (kokoroBackend.ts) plays
// each chapter's sentence chunks back-to-back via individual `<audio>` elements, most of them
// created and started many `await`s (and therefore well outside any single click handler's call
// stack) after the ORIGINAL "Read Aloud" button click — exactly the case Electron's own docs
// call out this switch for. Must also run before app.whenReady().
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

// Separate dev userData from prod — macOS HFS+/APFS is case-insensitive so
// 'berean' and 'Berean' resolve to the same directory without this.
if (!app.isPackaged) {
  app.setPath('userData', join(app.getPath('appData'), 'Berean-dev'))
}

if (app.isPackaged && process.mas) {
  // The Chromium Network Service utility process crashes in MAS with SIGTRAP
  // because it tries to register Mach bootstrap IPC endpoints that the App
  // Sandbox blocks. Disabling Chromium's own sandbox on the Network Service
  // lets Mojo IPC initialize via the channel the MAS sandbox does allow.
  app.commandLine.appendSwitch('disable-features', 'NetworkServiceSandbox')

  // GPU flags: run GPU in-process so the renderer never waits for a separate
  // GPU helper that might also fail in the sandbox.
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('in-process-gpu')
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-gpu-compositing')
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
  app.commandLine.appendSwitch('disable-hang-monitor')
  app.commandLine.appendSwitch('no-proxy-server')

  // Chromium internal log for future debugging.
  const chromiumLog = join(os.homedir(), 'Library', 'Containers', 'com.berean.app', 'Data', 'chromium-log.txt')
  earlyLog(`chromium log path: ${chromiumLog}`)
  app.commandLine.appendSwitch('enable-logging')
  app.commandLine.appendSwitch('log-level', '0')
  app.commandLine.appendSwitch('log-file', chromiumLog)
}

// Two-finger trackpad swipe begin/end, forwarded to every window's renderer — the real
// signal (macOS NSEventPhase-driven) for "fingers actually touched/lifted the trackpad,"
// used by BiblePanel.tsx's swipe-to-open/close side-panel gesture instead of guessing from
// a debounce on DOM `wheel`-event silence (which can't distinguish a genuine release from a
// brief pause mid-gesture). `scroll-touch-begin`/`scroll-touch-end` (the old BrowserWindow
// events that used to wrap this same NSEvent phase signal) were removed in Electron 23 —
// `webContents.on('input-event', ...)` with `gestureScrollBegin`/`gestureScrollEnd` types is
// their replacement (see electron/electron#35531). Hooked via `web-contents-created` so every
// window this app creates (main, viewer, floating panel, etc.) is covered generically rather
// than wiring each `new BrowserWindow(...)` call site individually. macOS-only in practice —
// NSEventPhase is only populated by phase-aware devices (trackpad/Magic Mouse), so a plain
// USB mouse wheel should never trigger these and this shouldn't affect mouse-wheel scrolling
// anywhere else in the app.
// Electron forwards EVERY input event (keystrokes, mousemoves, wheel) for a webContents to the
// browser process the moment anything subscribes to 'input-event' on it — regardless of what the
// handler itself does with them. The only consumer of the swipe signal is BiblePanel.tsx's
// side-panel gesture, which only runs in the main window, so attaching this to every window
// (viewer, floating search/panel, YouTube <webview>s) was pure overhead with no consumer. Deferred
// one tick via setImmediate because 'web-contents-created' fires synchronously during `new
// BrowserWindow(...)`, before that window's own `__isViewer`/`__isFloat` tag gets assigned right
// after the constructor returns — by the next tick every window created so far has its tag set.
app.on('web-contents-created', (_event, contents) => {
  setImmediate(() => {
    if (contents.isDestroyed()) return
    if (contents.getType() === 'webview') return // YouTube embeds — never the swipe consumer
    const owner = BrowserWindow.fromWebContents(contents)
    if (owner && ((owner as any).__isViewer || (owner as any).__isFloat)) return
    contents.on('input-event', (_e, inputEvent) => {
      if (inputEvent.type === 'gestureScrollBegin') contents.send('app:trackpadSwipeBegin')
      else if (inputEvent.type === 'gestureScrollEnd') contents.send('app:trackpadSwipeEnd')
    })
  })
})

// Track ALL child process exits with full detail.
app.on('child-process-gone', (_event, details) => {
  const msg = `[child-process-gone] type=${details.type} reason=${details.reason} exitCode=${details.exitCode} name=${details.name ?? '?'} pid=${(details as any).pid ?? '?'} serviceWorkerProcessType=${(details as any).serviceWorkerProcessType ?? '?'}`
  earlyLog(msg)
  log.error(msg)
  // If network service crashes: show a dialog so we can see the exact state
  if (details.name === 'Network Service' && details.reason === 'crashed') {
    earlyLog(`[NS-crash-detail] exitCode=${details.exitCode} — application-groups IPC fix applied`)
  }
})

// Crash logging — catches any uncaught error before Electron quits silently.
// Writes to the electron-log file so sandbox/TestFlight crashes are diagnosable.
log.transports.file.level = 'debug'
log.transports.console.level = is.dev ? 'debug' : false

process.on('uncaughtException', (err) => {
  earlyLog(`uncaughtException: ${err.message}\n${err.stack}`)
  log.error('[uncaughtException]', err.message, err.stack)
})
process.on('unhandledRejection', (reason) => {
  earlyLog(`unhandledRejection: ${String(reason)}`)
  log.error('[unhandledRejection]', reason)
})

earlyLog(`process handlers registered — packaged=${app.isPackaged} mas=${process.mas}`)
earlyLog(`versions: electron=${process.versions.electron} chrome=${process.versions.chrome} node=${process.versions.node} v8=${process.versions.v8}`)
earlyLog(`paths: exec=${process.execPath} resources=${process.resourcesPath}`)
log.info(`Berean starting — version=${app.getVersion()} packaged=${app.isPackaged} mas=${process.mas} platform=${process.platform}`)
log.info(`versions: electron=${process.versions.electron} chrome=${process.versions.chrome} node=${process.versions.node}`)

// On startup, surface any crash report left in the container from a previous run.
// These reports are from a PRIOR process already on disk, so reading them is not
// needed to start the app — only to log them. Run async + deferred (see the call in
// app.whenReady, after createWindow) so the readdir/stat/readFile scan never blocks
// cold boot. This process's own crashes are still captured synchronously by earlyLog
// and the uncaughtException/unhandledRejection handlers above.
async function reportPreviousCrashReports(): Promise<void> {
  try {
    const { readdir, readFile, stat } = await import('fs/promises')
    const crashDir = join(os.homedir(), 'Library', 'Containers', 'com.berean.app', 'Data', 'Library', 'Application Support', 'CrashReporter')
    const files = (await readdir(crashDir)).filter((f) => f.endsWith('.plist') || f.endsWith('.ips'))
    for (const f of files) {
      const full = join(crashDir, f)
      const age = Date.now() - (await stat(full)).mtimeMs
      if (age < 5 * 60 * 1000) { // only crashes from the last 5 min
        earlyLog(`[prev-crash-report] ${f}: ${(await readFile(full, 'utf8')).slice(0, 800)}`)
      }
    }
  } catch { /* dir may not exist yet */ }
}

// MAS builds: the App Store owns updates — electron-updater must be disabled entirely.
// process.mas is set to true by Electron when running inside the Mac App Store sandbox.
const isMasBuild = process.mas === true

if (!isMasBuild) {
  autoUpdater.logger = log
  // Default: don't auto-download — wait for user to confirm. Overridable via the
  // "Automatically download updates" setting (DB key 'autoDownloadUpdate') — see
  // applyAutoDownloadPref, called right before every checkForUpdates() the same way
  // allowPrerelease already is, so toggling the setting mid-session takes effect on
  // the very next check rather than needing a relaunch.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
}

// Re-reads the 'autoDownloadUpdate' setting and applies it to autoUpdater.autoDownload.
// Called at every point a check is about to run (startup, periodic interval, and the
// manual "Check for Updates" IPC handler) — same pattern as the beta-channel
// (allowPrerelease) preference just above/below each of those call sites.
function applyAutoDownloadPref(db: ReturnType<typeof getBereanDb>): void {
  const row = db.prepare("SELECT value FROM settings WHERE key='autoDownloadUpdate'").get() as { value: string } | undefined
  autoUpdater.autoDownload = row?.value === 'true'
}

// `mainWindow` is now "the app window that currently has focus" (or the first one
// created) rather than a hard singleton — see createWindow(). Synced-window
// (Phase 1) lets the user open several equal, peer main windows; `appWindows`
// tracks every live one. Single-target sends still use `mainWindow` (they want
// the focused window); anything that must reach every window uses
// `broadcastAppWindows()`.
let mainWindow: BrowserWindow | null = null
const appWindows = new Set<BrowserWindow>()
let viewerWindow: BrowserWindow | null = null
let studyTrailWindow: BrowserWindow | null = null

/** Send an IPC message to every live app window (not the viewer / Study Trail /
 *  float windows — those are `?viewer` / `?studyTrail` / `?float` and are not
 *  peers). Optionally skip one webContents (the sender of a relayed message). */
function broadcastAppWindows(channel: string, payload?: unknown, exceptWebContentsId?: number): void {
  for (const win of appWindows) {
    if (win.isDestroyed()) continue
    if (exceptWebContentsId != null && win.webContents.id === exceptWebContentsId) continue
    win.webContents.send(channel, payload)
  }
}

function sendUpdateStatus(status: string, extra?: Record<string, unknown>) {
  mainWindow?.webContents.send('app:updateStatus', { status, ...extra })
}

function setupAutoUpdater(): void {
  autoUpdater.on('checking-for-update', () => {
    sendUpdateStatus('checking')
  })
  autoUpdater.on('update-available', (info) => {
    sendUpdateStatus('available', { version: info.version })
  })
  autoUpdater.on('update-not-available', () => {
    sendUpdateStatus('current')
  })
  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus('downloading', { percent: Math.round(progress.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => {
    sendUpdateStatus('ready', { version: info.version })
  })
  autoUpdater.on('error', (err) => {
    log.error('Auto-updater error:', err.message)
    sendUpdateStatus('error', { message: err.message })
  })
}

// Helper: send a menu action to the focused window (or mainWindow as fallback)
function menuSend(channel: string, ...args: unknown[]) {
  const fw = BrowserWindow.getFocusedWindow() ?? mainWindow
  fw?.webContents.send(channel, ...args)
}

function buildAppMenu(): Electron.Menu {
  const isMac = process.platform === 'darwin'

  const template: Electron.MenuItemConstructorOptions[] = [
    // ── Berean (macOS) ────────────────────────────────────────────────────────
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        {
          label: 'Preferences…',
          accelerator: 'Cmd+,',
          click: () => menuSend('app:openSettings'),
        },
        { type: 'separator' as const },
        { role: 'services' as const },
        { type: 'separator' as const },
        // Custom hide — uses Cmd+Shift+H so Cmd+H is free for History
        {
          label: `Hide ${app.name}`,
          accelerator: 'CmdOrCtrl+Shift+H',
          click: () => { BrowserWindow.getFocusedWindow()?.hide() },
        },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const },
      ],
    }] : []),

    // ── Edit — keep standard roles for system clipboard + CodeMirror undo/redo ─
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const },
      ],
    },

    // ── View — dev tools only (all navigation handled by React shortcut layer) ─
    ...(is.dev ? [{
      label: 'View',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
      ],
    }] : []),

    // ── Window — OS-level actions; app navigation lives in the React layer ────
    {
      label: 'Window',
      submenu: [
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+N',
          // Opens another peer main window, synced to this one (shared tabs /
          // notes / settings; its own active tab, space, layout and scroll).
          click: () => {
            const from = BrowserWindow.getFocusedWindow()
            createWindow(from ? { mirrorFromWebContentsId: from.webContents.id } : undefined)
          },
        },
        { type: 'separator' as const },
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(isMac ? [
          { type: 'separator' as const },
          { role: 'front' as const },
        ] : []),
      ],
    },
  ]

  return Menu.buildFromTemplate(template)
}

const VIEWER_BOUNDS_KEY = 'viewerWindowBounds'
const VIEWER_DEFAULT_BOUNDS = { width: 900, height: 700 }

interface WindowBounds { x?: number; y?: number; width: number; height: number }

/** Reads the last-saved viewer window bounds from the settings table (same table/
 *  pattern already used for `vaultSync` above), clamped to fit some currently-
 *  connected display so a bounds saved on a monitor that's no longer attached
 *  can't place the window off-screen. Falls back to the hardcoded default size
 *  with no x/y (Electron auto-positions) if nothing was saved or it doesn't fit. */
function loadViewerBounds(): WindowBounds {
  try {
    const row = getBereanDb().prepare('SELECT value FROM settings WHERE key = ?').get(VIEWER_BOUNDS_KEY) as { value: string } | undefined
    if (!row) return { ...VIEWER_DEFAULT_BOUNDS }
    const saved = JSON.parse(row.value) as Partial<WindowBounds>
    const width = Math.max(500, Math.round(saved.width ?? VIEWER_DEFAULT_BOUNDS.width))
    const height = Math.max(400, Math.round(saved.height ?? VIEWER_DEFAULT_BOUNDS.height))
    if (typeof saved.x !== 'number' || typeof saved.y !== 'number') {
      return { width, height }
    }
    // Only keep x/y if they'd place the window (at least partially) within some
    // currently-connected display's work area — otherwise let Electron auto-position.
    const candidate = { x: Math.round(saved.x), y: Math.round(saved.y), width, height }
    const fits = screen.getAllDisplays().some((d) => {
      const a = d.workArea
      return candidate.x < a.x + a.width && candidate.x + width > a.x &&
             candidate.y < a.y + a.height && candidate.y + height > a.y
    })
    return fits ? candidate : { width, height }
  } catch {
    return { ...VIEWER_DEFAULT_BOUNDS }
  }
}

function saveViewerBounds(bounds: WindowBounds): void {
  try {
    getBereanDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run(VIEWER_BOUNDS_KEY, JSON.stringify(bounds))
  } catch { /* best-effort — never block window close/resize on a settings-write failure */ }
}

// ── Main window bounds — same settings-table persistence as the viewer window above,
//    so the app reopens at the size and position it was last closed at. ──────────────
const MAIN_BOUNDS_KEY = 'mainWindowBounds'
const MAIN_DEFAULT_BOUNDS = { width: 1280, height: 800 }

function loadMainBounds(): WindowBounds & { maximized?: boolean } {
  try {
    const row = getBereanDb().prepare('SELECT value FROM settings WHERE key = ?').get(MAIN_BOUNDS_KEY) as { value: string } | undefined
    if (!row) return { ...MAIN_DEFAULT_BOUNDS }
    const saved = JSON.parse(row.value) as Partial<WindowBounds> & { maximized?: boolean }
    const width = Math.max(800, Math.round(saved.width ?? MAIN_DEFAULT_BOUNDS.width))
    const height = Math.max(600, Math.round(saved.height ?? MAIN_DEFAULT_BOUNDS.height))
    if (typeof saved.x !== 'number' || typeof saved.y !== 'number') {
      return { width, height, maximized: saved.maximized }
    }
    const candidate = { x: Math.round(saved.x), y: Math.round(saved.y), width, height }
    const fits = screen.getAllDisplays().some((d) => {
      const a = d.workArea
      return candidate.x < a.x + a.width && candidate.x + width > a.x &&
             candidate.y < a.y + a.height && candidate.y + height > a.y
    })
    return fits ? { ...candidate, maximized: saved.maximized } : { width, height, maximized: saved.maximized }
  } catch {
    return { ...MAIN_DEFAULT_BOUNDS }
  }
}

function saveMainBounds(win: BrowserWindow): void {
  try {
    // While maximized/fullscreen, getBounds() returns the screen-filling size — persist the
    // pre-maximize "normal" bounds instead (getNormalBounds()) plus a maximized flag, so a
    // restart both re-fills the screen AND remembers a sane size for when the user un-maximizes.
    const maximized = win.isMaximized() || win.isFullScreen()
    const b = maximized ? win.getNormalBounds() : win.getBounds()
    getBereanDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run(MAIN_BOUNDS_KEY, JSON.stringify({ x: b.x, y: b.y, width: b.width, height: b.height, maximized }))
  } catch { /* best-effort — never block window close/resize on a settings-write failure */ }
}

function createViewerWindow(): void {
  if (viewerWindow && !viewerWindow.isDestroyed()) {
    viewerWindow.focus()
    return
  }
  const iconPath = is.dev
    ? join(app.getAppPath(), 'assets/icon.icns')
    : join(process.resourcesPath, 'assets/icon.icns')
  const appIcon = nativeImage.createFromPath(iconPath)
  const isWin = process.platform === 'win32'
  const bounds = loadViewerBounds()
  viewerWindow = new BrowserWindow({
    ...bounds,
    minWidth: 500,
    minHeight: 400,
    titleBarStyle: isWin ? 'default' : 'hiddenInset',
    ...(isWin ? {} : { trafficLightPosition: { x: 12, y: 14 } }),
    backgroundColor: '#111114',
    icon: appIcon,
    title: is.dev ? 'Berean Viewer [Dev]' : 'Berean Viewer',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  ;(viewerWindow as any).__isViewer = true

  viewerWindow.setAlwaysOnTop(true, 'floating')
  viewerWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  const paramStr = 'viewer=1'
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    viewerWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${paramStr}`)
  } else {
    viewerWindow.loadFile(join(__dirname, '../renderer/index.html'), { query: { viewer: '1' } })
  }

  // viewer:ready is now sent from viewer:signalReady (fired by React after onContent listener is registered)

  // Persist bounds live (debounced) so an ungraceful full-app-quit (e.g. Cmd+Q
  // while this window is open) still captures the latest position/size, not just
  // a clean window close — the window is fully destroyed+recreated each time
  // (never hidden/reused), so there's no other point bounds would naturally
  // survive from.
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      if (viewerWindow && !viewerWindow.isDestroyed()) saveViewerBounds(viewerWindow.getBounds())
    }, 400)
  }
  viewerWindow.on('resize', scheduleSave)
  viewerWindow.on('move', scheduleSave)
  // 'close' (not 'closed') — the window still exists here, so getBounds() is safe;
  // by 'closed' it's already destroyed and getBounds() would throw.
  viewerWindow.on('close', () => {
    if (saveTimer) clearTimeout(saveTimer)
    if (viewerWindow && !viewerWindow.isDestroyed()) saveViewerBounds(viewerWindow.getBounds())
  })

  viewerWindow.on('closed', () => {
    viewerWindow = null
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed() && !(win as any).__isViewer) {
        win.webContents.send('app:viewerWindowClosed')
      }
    })
  })
}

// Study Trail — a third dedicated singleton window (not the generic createFloatingWindow
// mechanism below): its persistent rail + bespoke title-bar chrome (Sessions/Everything
// toggle, pause/resume, +New session) matches the Viewer window's shape, not FloatingShell's
// "one existing full-size panel fills an undifferentiated frame" model. There is only ever
// one Study Trail window — the note-embed block's "open in a window" action (a later phase)
// focuses this same singleton on a given session rather than opening a new one.
function createStudyTrailWindow(trailSessionId?: string): void {
  if (studyTrailWindow && !studyTrailWindow.isDestroyed()) {
    studyTrailWindow.focus()
    if (trailSessionId) studyTrailWindow.webContents.send('studyTrail:focusSession', trailSessionId)
    return
  }
  const iconPath = is.dev
    ? join(app.getAppPath(), 'assets/icon.icns')
    : join(process.resourcesPath, 'assets/icon.icns')
  const appIcon = nativeImage.createFromPath(iconPath)
  const isWin = process.platform === 'win32'
  studyTrailWindow = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 640,
    minHeight: 420,
    titleBarStyle: isWin ? 'default' : 'hiddenInset',
    ...(isWin ? {} : { trafficLightPosition: { x: 12, y: 14 } }),
    backgroundColor: '#17151a',
    icon: appIcon,
    title: is.dev ? 'Study Trail [Dev]' : 'Study Trail',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })
  ;(studyTrailWindow as any).__isStudyTrail = true
  studyTrailWindow.setAlwaysOnTop(true, 'floating')
  studyTrailWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  const query: Record<string, string> = { studyTrail: '1' }
  if (trailSessionId) query.trailSessionId = trailSessionId
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    studyTrailWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${new URLSearchParams(query).toString()}`)
  } else {
    studyTrailWindow.loadFile(join(__dirname, '../renderer/index.html'), { query })
  }

  // Auto-open in dev, same as mainWindow already does — this window's own alwaysOnTop +
  // visibleOnAllWorkspaces make it easy to lose track of which window actually has OS focus,
  // and there's no custom right-click "Inspect Element" wired up in this app at all (Electron
  // doesn't add one by default), so manually reaching this window's own DevTools required going
  // through the app's top menu bar (View → Toggle Developer Tools) with it focused — a real,
  // reported point of friction ("i cant get the logs for the study trail...").
  if (is.dev) {
    studyTrailWindow.webContents.openDevTools({ mode: 'detach' })
  }

  studyTrailWindow.on('closed', () => { studyTrailWindow = null })
}

function createFloatingWindow(type: string, state: Record<string, unknown>): void {
  const iconPath = is.dev
    ? join(app.getAppPath(), 'assets/icon.icns')
    : join(process.resourcesPath, 'assets/icon.icns')
  const appIcon = nativeImage.createFromPath(iconPath)

  const paramStr = new URLSearchParams({ float: '1', type, ...Object.fromEntries(
    Object.entries(state).map(([k, v]) => [k, String(v)])
  )}).toString()

  const isWin = process.platform === 'win32'
  const floatWin = new BrowserWindow({
    width: 700,
    height: 700,
    minWidth: 400,
    minHeight: 400,
    titleBarStyle: isWin ? 'default' : 'hiddenInset',
    ...(isWin ? {} : { trafficLightPosition: { x: 12, y: 14 } }),
    backgroundColor: '#111114',
    icon: appIcon,
    title: is.dev ? 'Berean Float [Dev]' : 'Berean',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      sandbox: false,
    },
  }) as BrowserWindow & { __isFloat?: boolean }
  // Mark this window as a float so returnFloatTab can distinguish it
  ;(floatWin as any).__isFloat = true
  // 'screen-saver' level on macOS keeps it above ALL other app windows including those
  // from other applications. 'floating' is insufficient — it only beats normal-level windows
  // within the same app tier. 'screen-saver' is the highest well-supported level before
  // system overlays. Falls back gracefully on Win/Linux.
  floatWin.setAlwaysOnTop(true, 'screen-saver')
  // Show on all macOS Spaces so it follows the user across desktops
  floatWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    floatWin.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${paramStr}`)
  } else {
    floatWin.loadFile(join(__dirname, '../renderer/index.html'), { query: { float: '1', type, ...Object.fromEntries(Object.entries(state).map(([k, v]) => [k, String(v)])) } })
  }

  // Intercept Cmd+W in floating windows too
  floatWin.webContents.on('before-input-event', (event, input) => {
    if (input.meta && !input.shift && !input.alt && input.key.toLowerCase() === 'w') {
      event.preventDefault()
      floatWin.close()
    }
  })
}

function createWindow(opts?: { mirrorFromWebContentsId?: number }): void {
  const iconPath = is.dev
    ? join(app.getAppPath(), 'assets/icon.icns')
    : join(process.resourcesPath, 'assets/icon.icns')
  const appIcon = nativeImage.createFromPath(iconPath)

  const isMacWin = process.platform === 'darwin'
  const isWinWin = process.platform === 'win32'
  // The first window restores its saved bounds; each extra synced window opens
  // cascaded down-right from the currently-focused one so they don't stack
  // exactly on top of each other.
  const isFirst = appWindows.size === 0
  const savedBounds = loadMainBounds()
  const focused = BrowserWindow.getFocusedWindow()
  const cascade = !isFirst && focused && !focused.isDestroyed() ? focused.getBounds() : null
  const win = new BrowserWindow({
    width: cascade ? cascade.width : savedBounds.width,
    height: cascade ? cascade.height : savedBounds.height,
    ...(cascade
      ? { x: cascade.x + 36, y: cascade.y + 36 }
      : (typeof savedBounds.x === 'number' && typeof savedBounds.y === 'number'
        ? { x: savedBounds.x, y: savedBounds.y }
        : {})),
    minWidth: 800,
    minHeight: 600,
    // On Windows: frameless so we draw our own title bar in React
    frame: !isWinWin,
    titleBarStyle: isMacWin ? 'hiddenInset' : 'default',
    ...(isMacWin ? { trafficLightPosition: { x: 12, y: 14 } } : {}),
    // macOS: transparent + native vibrancy so the sidebar column can show a true
    // frosted-glass effect against the desktop (CSS backdrop-blur alone can't do
    // this in an opaque window — it only blurs the app's own content, not what's
    // behind the window). The renderer is responsible for keeping the main
    // content column opaque via CSS (see .app-opaque-base in global.css) since
    // the whole window surface is transparent now, not just the sidebar strip.
    // Windows keeps the original opaque background — vibrancy is mac-only.
    ...(isMacWin
      ? { transparent: true, backgroundColor: '#00000000', vibrancy: 'sidebar' as const, visualEffectState: 'active' as const }
      : { backgroundColor: '#111114' }),
    icon: appIcon,
    // Show [Dev] in the window title (visible in macOS app switcher / dock tooltip)
    title: is.dev ? 'Berean [Dev]' : 'Berean',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // webviewTag disabled in MAS to prevent Network Service crash on webview
      // infrastructure init. YouTube uses a dedicated BrowserWindow instead.
      webviewTag: true,
      sandbox: false,
    },
  })

  appWindows.add(win)
  mainWindow = win
  win.on('focus', () => { mainWindow = win })

  // `?mirrorFrom=<webContentsId>` tells the renderer to seed its per-window view
  // state (active space / session / tab / panel layout) from the window that
  // spawned it, via a cross-window:requestMirror round-trip. The first window
  // has nothing to mirror.
  const mirrorId = opts?.mirrorFromWebContentsId
  const mirrorQuery = typeof mirrorId === 'number' ? `mirrorFrom=${mirrorId}` : ''

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(mirrorQuery ? `${process.env['ELECTRON_RENDERER_URL']}?${mirrorQuery}` : process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), mirrorQuery ? { search: `?${mirrorQuery}` } : undefined)
  }

  if (is.dev) {
    win.webContents.openDevTools({ mode: 'detach' })
  }

  if (isFirst && savedBounds.maximized) win.maximize()

  // Persist size/position so the app reopens where it was last closed. Only the
  // first/primary window drives the saved bounds — extra synced windows cascade
  // from it and shouldn't fight over the single saved-bounds key.
  const boundsWin = win
  let boundsSaveTimer: ReturnType<typeof setTimeout> | null = null
  const scheduleBoundsSave = () => {
    if (!isFirst) return
    if (boundsSaveTimer) clearTimeout(boundsSaveTimer)
    boundsSaveTimer = setTimeout(() => {
      if (!boundsWin.isDestroyed()) saveMainBounds(boundsWin)
    }, 400)
  }
  boundsWin.on('resize', scheduleBoundsSave)
  boundsWin.on('move', scheduleBoundsSave)
  boundsWin.on('close', () => {
    if (boundsSaveTimer) clearTimeout(boundsSaveTimer)
    if (isFirst && !boundsWin.isDestroyed()) saveMainBounds(boundsWin)
  })

  // Notify renderer when window is maximized/unmaximized (for Windows title bar button state)
  win.on('maximize',   () => { win.webContents.send('window:maximizeChanged', true); scheduleBoundsSave() })
  win.on('unmaximize', () => { win.webContents.send('window:maximizeChanged', false); scheduleBoundsSave() })

  // Intercept Cmd+W so the renderer can close a tab instead of quitting. Captures
  // `win` (never the mutable `mainWindow`) so it always targets its own window.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.meta && !input.shift && !input.alt && input.key.toLowerCase() === 'w') {
      event.preventDefault()
      win.webContents.send('app:closeTab')
    }
  })

  win.on('closed', () => {
    appWindows.delete(win)
    if (mainWindow === win) {
      mainWindow = null
      for (const w of appWindows) { if (!w.isDestroyed()) { mainWindow = w; break } }
    }
  })

  win.webContents.on('render-process-gone', (_e, details) => {
    const msg = `reason: ${details.reason}  exitCode: ${details.exitCode}`
    earlyLog(`[renderer-process-gone] ${msg}`)
    log.error('[renderer-process-gone]', JSON.stringify(details))
    dialog.showErrorBox('Renderer crashed', msg)
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    earlyLog(`[did-fail-load] ${code} ${desc} ${url}`)
    log.error('[did-fail-load]', code, desc, url)
  })
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const lvl = ['verbose', 'info', 'warning', 'error'][level] ?? 'unknown'
    earlyLog(`[renderer-console:${lvl}] ${message}  (${sourceId}:${line})`)
    log.info(`[renderer:${lvl}] ${message}`)
  })
  win.webContents.on('did-start-loading', () => {
    earlyLog('[did-start-loading]')
    log.info('[did-start-loading]')
  })
  win.webContents.on('did-start-navigation', (_e, url) => {
    earlyLog(`[did-start-navigation] ${url}`)
    log.info('[did-start-navigation]', url)
  })
  win.webContents.on('dom-ready', () => {
    earlyLog('[dom-ready]')
    log.info('[dom-ready]')
  })
  win.webContents.on('did-finish-load', () => {
    earlyLog('[did-finish-load] renderer HTML loaded OK')
    log.info('[did-finish-load] renderer loaded')
  })
  win.webContents.on('unresponsive', () => {
    earlyLog('[unresponsive] renderer is not responding')
    log.warn('[unresponsive]')
  })
  win.webContents.on('responsive', () => {
    earlyLog('[responsive]')
    log.info('[responsive]')
  })
  // Show a native spell-check context menu when the user right-clicks a misspelled word.
  win.webContents.on('context-menu', (_e, params) => {
    const { misspelledWord, dictionarySuggestions } = params
    if (!misspelledWord) return
    const items: Electron.MenuItemConstructorOptions[] = dictionarySuggestions.length > 0
      ? dictionarySuggestions.slice(0, 8).map(s => ({
          label: s,
          click: () => win.webContents.replaceMisspelling(s),
        }))
      : [{ label: 'No suggestions', enabled: false }]
    items.push(
      { type: 'separator' },
      {
        label: 'Add to Dictionary',
        click: () => win.webContents.session.addWordToSpellCheckerDictionary(misspelledWord),
      },
    )
    Menu.buildFromTemplate(items).popup({ window: win })
  })
  log.info(`app window created (${appWindows.size} open), loading renderer...`)
}

app.whenReady().then(async () => {
  earlyLog('app.whenReady fired')
  log.info('app.whenReady fired')

  // Log GPU status so we know what Chromium sees inside the sandbox.
  try {
    const gpuInfo = await app.getGPUInfo('basic') as Record<string, unknown>
    const gpuSummary = JSON.stringify(gpuInfo).slice(0, 500)
    earlyLog(`[gpu-info] ${gpuSummary}`)
    log.info('[gpu-info]', gpuSummary)
  } catch (e) {
    earlyLog(`[gpu-info-error] ${e}`)
    log.warn('[gpu-info-error]', e)
  }

  // Log all active command-line switches so we can verify flags are applied.
  try {
    const switches = app.commandLine
    const knownSwitches = ['in-process-gpu','disable-gpu','disable-gpu-compositing','disable-hang-monitor','enable-logging','log-level','no-sandbox']
    const active = knownSwitches.filter(s => switches.hasSwitch(s)).join(', ')
    earlyLog(`[active-switches] ${active || 'none'}`)
    log.info('[active-switches]', active || 'none')
  } catch (e) {
    earlyLog(`[switches-error] ${e}`)
  }

  // Dock icon for dev — packaged app uses the bundled icns automatically
  if (is.dev && process.platform === 'darwin') {
    const icnsPath = join(app.getAppPath(), 'assets/icon.icns')
    const appIcon = nativeImage.createFromPath(icnsPath)
    if (!appIcon.isEmpty()) app.dock.setIcon(appIcon)
  }

  // About panel (macOS native — used by the Berean > About Berean menu item)
  if (process.platform === 'darwin') {
    app.setAboutPanelOptions({
      applicationName: 'Berean',
      applicationVersion: app.getVersion(),
      version: '',
      copyright: "© 2026 RoyalWeden\n\nDesktop Bible study for Yehovah's servants.",
    })
  }

  // Native app menu
  Menu.setApplicationMenu(buildAppMenu())
  log.info('menu built')

  // Open app DB and run migrations before registering IPC handlers
  try {
    getBereanDb()
    earlyLog('berean.db opened OK')
    log.info('berean.db opened')
    // NOTE: mergeYouTubeSeed is intentionally NOT run here. On a fresh install /
    // seed-version bump it attaches a 196MB seed DB and runs bulk inserts
    // synchronously, which would block first paint. It's deferred until after
    // the window has rendered (see below, following createWindow()).
  } catch (err) {
    earlyLog(`berean.db FAILED: ${err}`)
    log.error('Failed to open berean.db:', err)
    throw err
  }

  // Persistent session for YouTube webview
  session.fromPartition('persist:youtube')
  log.info('youtube session created')

  // ── Geolocation + clipboard permissions (default session = main app window only) ──
  // Daily notes begin at sunrise, not midnight (src/lib/dailyNoteUtils.ts) — the
  // renderer requests the device's location once per launch to compute it. No
  // handler existed before this, so explicitly allow only 'geolocation' and deny
  // everything else, rather than assume Electron's implicit default for other
  // permission types. The YouTube <webview> uses its own 'persist:youtube' session
  // (above) and never requests geolocation, so it's untouched by this handler.
  //
  // Also allow clipboard permissions here — 'geolocation'-only denied everything
  // else by default, which silently broke every "Copy verse"/"Copy reference"
  // button app-wide (VerseCopyMenu.tsx, VerseRow.tsx, etc — all call
  // navigator.clipboard.writeText(), which Chromium gates behind a permission
  // request in Electron 32). Both the modern 'clipboard-sanitized-write' name and
  // the older 'clipboard-write' are allowed since which one Chromium actually
  // requests can vary by call site; 'clipboard-read' is allowed too for any future
  // paste-from-clipboard feature. ('clipboard-write' isn't a value Electron's own
  // permission-string union recognizes in this version — 'clipboard-sanitized-write' is the
  // one Chromium actually requests for navigator.clipboard.writeText().)
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(
      permission === 'geolocation' ||
      permission === 'clipboard-sanitized-write' ||
      permission === 'clipboard-read'
    )
  })

  // ── Content-Security-Policy (default session = main app window only) ─────────
  // The YouTube <webview> uses the separate 'persist:youtube' session, so this
  // does not touch it. Dev needs 'unsafe-eval' + ws: for Vite HMR; the packaged
  // build is locked down (script-src 'self', no eval) — which resolves Electron's
  // "Insecure Content-Security-Policy" warning for production users.
  //
  // Built by the SHARED `buildCSP()` (see csp.ts's header) rather than inline here — a packaged
  // build never reaches this handler at all (onHeadersReceived doesn't fire for file://), so
  // src/index.html's own <meta> CSP tag is the actual production policy; buildCSP() is what keeps
  // that tag and this handler from drifting out of sync the way they previously did.
  const cspValue = buildCSP(is.dev)

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders }
    // Drop any existing CSP header (any case) so we don't emit duplicates
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === 'content-security-policy') delete headers[k]
    }
    headers['Content-Security-Policy'] = [cspValue]
    callback({ responseHeaders: headers })
  })
  log.info('CSP header handler registered')

  registerTTSModelProtocolHandler()
  registerTTSModelHandlers(ipcMain)
  registerTTSAudioCacheHandlers(ipcMain)
  registerBibleHandlers(ipcMain)
  registerNotesHandlers(ipcMain)
  log.info('[berean-main] Notes handlers registered')
  registerPdfHandlers(ipcMain)
  log.info('[berean-main] PDF handlers registered')
  registerVaultHandlers(ipcMain)
  // Start the safety-net export timer whenever vault sync is on — fixed interval,
  // not user-configurable. Per-note content already syncs immediately on save
  // (vault:syncNote); this just periodically re-exports the less-frequently-changed
  // sidecar data (highlights/settings/PDFs/etc).
  try {
    const row = getBereanDb().prepare('SELECT value FROM settings WHERE key = ?').get('vaultSync') as { value: string } | undefined
    const enabled = row ? (JSON.parse(row.value) as boolean) : false
    setupAutoExport(enabled ? AUTO_EXPORT_INTERVAL_MINUTES : 0)
  } catch { /* ignore — timer stays off if setting unreadable */ }
  // Trash auto-purge — always on, not gated by vault sync (trash is a core-app-DB concept;
  // the vault-file side of it is just one more thing purgeExpiredTrash cleans up alongside).
  setupTrashPurge()
  registerSettingsHandlers(ipcMain)
  registerLexiconHandlers(ipcMain)
  registerHighlightHandlers(ipcMain)
  registerVerseTagHandlers(ipcMain)
  registerYouTubeHandlers(ipcMain)
  registerCrossRefsHandlers(ipcMain)
  registerAiLookupHandlers(ipcMain)
  registerBgImportHandlers(ipcMain, () => mainWindow)
  registerESwordImportHandlers(ipcMain, () => mainWindow)
  registerHistoryHandlers(ipcMain)
  registerStudyTrailHandlers(ipcMain)
  registerWorkspacesHandlers(ipcMain)
  registerPlaylistsHandlers(ipcMain)

  // Core app IPC
  // Diagnostic: renderer can call this to verify handler registration at runtime
  ipcMain.handle('app:listHandlers', () => {
    // ipcMain doesn't expose a built-in list; we enumerate known channels
    const known = [
      'notes:create','notes:update','notes:delete','notes:setFolder',
      'folders:create','folders:getAll','folders:rename','folders:delete','folders:deleteDeep','folders:setParent',
    ]
    log.info('[berean-main] Handler list requested:', known.join(', '))
    return known
  })
  ipcMain.handle('app:isDev', () => is.dev)
  ipcMain.handle('app:openExternal', (_e, url: string) => shell.openExternal(url))
  ipcMain.handle('app:youTubeSignOut', async () => {
    await session.fromPartition('persist:youtube').clearStorageData()
    return { success: true }
  })
  ipcMain.handle('app:openFolderDialog', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle('app:newWindow', (e) => { createWindow({ mirrorFromWebContentsId: e.sender.id }) })

  // ── Cross-window sync (Phase 1: synced peer windows) ──────────────────────
  // A dumb relay: whatever a renderer broadcasts is forwarded verbatim to every
  // OTHER app window. The renderer layer (src/lib/crossWindowSync.ts) owns the
  // semantics — which store keys are synced, echo suppression, and the
  // request/response used to mirror a freshly-spawned window's view state.
  ipcMain.on('cross-window:broadcast', (e, message: unknown) => {
    broadcastAppWindows('cross-window:message', message, e.sender.id)
  })
  // Targeted reply (used for the mirror handshake): send only to one webContents.
  ipcMain.on('cross-window:sendTo', (_e, targetWebContentsId: number, message: unknown) => {
    for (const w of appWindows) {
      if (!w.isDestroyed() && w.webContents.id === targetWebContentsId) {
        w.webContents.send('cross-window:message', message)
        break
      }
    }
  })
  ipcMain.handle('cross-window:list', () => [...appWindows].filter((w) => !w.isDestroyed()).map((w) => w.webContents.id))
  ipcMain.handle('cross-window:selfId', (e) => e.sender.id)
  // Manual, JS-driven window move — used by Sidebar.tsx's empty tab-list space, which needs to
  // support BOTH window-drag AND double-click-to-search on the exact same screen area. A real
  // `-webkit-app-region: drag` CSS region can't do this: Electron intercepts the mousedown at
  // the OS/browser-process level before any renderer listener runs once an element is a drag
  // region, so a double-click there never reliably reaches the renderer either (four prior CSS-
  // only attempts documented in Sidebar.tsx all failed for exactly this reason). Keeping the
  // area `no-drag` and instead tracking mousedown+mousemove in the renderer, calling this once
  // real movement is detected, sidesteps that limitation entirely — dblclick still fires
  // natively and reliably since the region was never marked as a drag region in the first place.
  ipcMain.on('app:moveWindowBy', (event, dx: number, dy: number) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) return
    const [x, y] = win.getPosition()
    win.setPosition(x + dx, y + dy)
  })
  ipcMain.handle('app:openFloatingTab', (_e, type: string, state: Record<string, unknown>) => {
    try {
      createFloatingWindow(type, state ?? {})
    } catch (err) {
      console.error('[main] app:openFloatingTab failed', err)
      throw err
    }
  })
  ipcMain.handle('app:openViewerWindow', () => {
    if (viewerWindow && !viewerWindow.isDestroyed()) {
      viewerWindow.focus()
      return true
    }
    createViewerWindow()
    return true
  })
  ipcMain.handle('app:openStudyTrailWindow', (_e, trailSessionId?: string) => {
    createStudyTrailWindow(trailSessionId)
    return true
  })
  ipcMain.handle('app:isStudyTrailWindowOpen', () => !!studyTrailWindow && !studyTrailWindow.isDestroyed())
  ipcMain.handle('app:closeStudyTrailWindow', () => { studyTrailWindow?.close(); return true })
  // Study Trail (and any other secondary window) has its own independent renderer store — a
  // click on a chapter/Strong's label there can't just call the main window's own tab-state
  // setters directly, since those would only mutate THIS window's store. This focuses the real
  // main window and hands it the ref; App.tsx's onNavigateToRef listener does the actual
  // navigateToVerse/addTab/openLexiconEntry call against the main window's own live state.
  // Study Trail's "+New session" wants to seed the first spine node from whatever chapter is
  // ACTUALLY open right now in the main window — but the main window's tab state lives in ITS
  // OWN renderer's store, invisible to the Study Trail window's separate renderer. Round-trips
  // through the main process: ask the main window's renderer, wait for its one-shot reply.
  ipcMain.handle('app:getActiveScriptureRef', (_e) => {
    if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve(null)
    return new Promise((resolve) => {
      const timer = setTimeout(() => { ipcMain.removeAllListeners('app:activeScriptureRefReply'); resolve(null) }, 1500)
      ipcMain.once('app:activeScriptureRefReply', (_e2, ref) => { clearTimeout(timer); resolve(ref) })
      mainWindow!.webContents.send('app:requestActiveScriptureRef')
    })
  })

  ipcMain.handle('app:navigateMainToRef', (_e, payload: unknown) => {
    if (!mainWindow || mainWindow.isDestroyed()) return false
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.send('app:navigateToRef', payload)
    return true
  })
  // Broadcasts the live-session id/status to every open window (main + Study Trail) —
  // see preload.ts's broadcastStudyTrailState comment for why this exists at all: each
  // window's useStudyTrailStore is a separate in-memory instance, so this is the only way
  // a session started in one window's UI is ever known to the other's recorder.
  ipcMain.on('app:broadcastStudyTrailState', (_e, state) => {
    const allWins = BrowserWindow.getAllWindows()
    allWins.forEach((win) => {
      if (!win.isDestroyed()) win.webContents.send('app:studyTrailStateChanged', state)
    })
  })
  ipcMain.handle('app:isViewerWindowOpen', () => {
    return viewerWindow !== null && !viewerWindow.isDestroyed()
  })
  ipcMain.handle('app:closeViewerWindow', () => {
    if (viewerWindow && !viewerWindow.isDestroyed()) viewerWindow.close()
    return true
  })
  // Viewer React app signals ready after registering its onContent listener
  ipcMain.on('viewer:signalReady', () => {
    console.log('[Viewer IPC] viewer:signalReady received — broadcasting viewer:ready to main windows')
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed() && !(win as any).__isViewer) {
        win.webContents.send('viewer:ready')
      }
    })
  })

  ipcMain.on('app:pushViewerContent', (_e, payload: unknown) => {
    if (viewerWindow && !viewerWindow.isDestroyed()) {
      viewerWindow.webContents.send('viewer:content', payload)
    }
  })

  // Relay display/format settings from the main window to the viewer window
  ipcMain.on('app:pushViewerSettings', (_e, settings: unknown) => {
    if (viewerWindow && !viewerWindow.isDestroyed()) {
      viewerWindow.webContents.send('viewer:settings', settings)
    }
  })

  // Relay ephemeral overlays (selection mirror + laser pointer) to the viewer window
  ipcMain.on('app:pushViewerOverlay', (_e, payload: unknown) => {
    if (viewerWindow && !viewerWindow.isDestroyed()) {
      viewerWindow.webContents.send('viewer:overlay', payload)
    }
  })

  // Relay the viewer's visible verse region back to the main (non-viewer) windows
  ipcMain.on('viewer:reportVisibleRegion', (_e, region: unknown) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed() && !(win as any).__isViewer) {
        win.webContents.send('viewer:visibleRegion', region)
      }
    })
  })

  // Ask the viewer window to re-report its visible region right now, even if its content
  // hasn't changed since the last report. Needed after unpausing live sync / "Re-sync now":
  // the presenter can go several tab switches "behind" while paused (main window navigation
  // isn't paused, only the presenter push is), and if the user lands back on the same chapter
  // the presenter was already frozen on, pushing content again is a no-op for the viewer (no
  // reload → no fresh report) — so the outline band's stale region never gets corrected without
  // this explicit nudge.
  ipcMain.on('app:requestViewerVisibleRegion', () => {
    if (viewerWindow && !viewerWindow.isDestroyed()) {
      viewerWindow.webContents.send('viewer:requestVisibleRegion')
    }
  })

  // Render a note's print HTML to a real PDF buffer in an offscreen window — shared by
  // app:exportNotePDF (writes it to disk) and app:renderPreviewPDF (hands the bytes straight
  // to the renderer for a pdf.js preview). Extracted so both use the EXACT same generation
  // path — the whole point of the preview change this supports is that what's shown on
  // screen is the literal same PDF bytes that would be saved, not an approximation of it.
  //
  // Used by the real Export-PDF/Print buttons: a fresh window + temp file every call (large
  // notes can exceed data: URL comfort, and correctness of the actually-SAVED file matters
  // more than shaving latency here), plus a flat 300ms settle delay as a simple, conservative
  // safety margin for web-font/layout completion before printToPDF snapshots the page.
  async function renderHtmlToPdfBuffer(html: string, pageSize?: string): Promise<Buffer> {
    const { writeFile, unlink, mkdtemp } = await import('fs/promises')
    const { tmpdir } = await import('os')
    const tmpDir = await mkdtemp(join(tmpdir(), 'berean-pdf-'))
    const tmpFile = join(tmpDir, 'note.html')
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: false } })
    try {
      await writeFile(tmpFile, html, 'utf8')
      await win.loadURL(`file://${tmpFile}`)
      await new Promise<void>((resolve) => setTimeout(resolve, 300))
      // marginType 'none' — body padding (set per the chosen margin preset) is the sole margin.
      return await win.webContents.printToPDF({ printBackground: true, margins: { marginType: 'none' }, pageSize: (pageSize as any) || 'Letter' })
    } finally {
      if (!win.isDestroyed()) win.close()
      try { await unlink(tmpFile) } catch { /* ignore */ }
    }
  }

  // Fast path used ONLY by the on-screen preview (app:renderPreviewPDF below), which
  // regenerates on nearly every settings tweak while the Print Preview modal is open —
  // repeated ~1s round trips there read as visible lag ("shows a block for a second").
  // Two changes from renderHtmlToPdfBuffer, both preview-only (the real Export-PDF/Print
  // path above is untouched, so output-file correctness never trades away for this):
  //   1. ONE hidden BrowserWindow is created lazily and reused for every subsequent preview
  //      generation, instead of a fresh `new BrowserWindow()` + temp-file write/unlink each
  //      time — window construction and disk I/O were a real, avoidable chunk of the delay.
  //   2. A `data:` URL instead of a temp file (skips the mkdtemp/writeFile/unlink round trip
  //      entirely), and `document.fonts.ready` (actual readiness) instead of a blind 300ms
  //      guess — usually resolves in a few ms once fonts are cached, only falling back to a
  //      short timeout if something is unexpectedly slow to load.
  let previewWin: BrowserWindow | null = null
  function getPreviewWindow(): BrowserWindow {
    if (previewWin && !previewWin.isDestroyed()) return previewWin
    previewWin = new BrowserWindow({ show: false, webPreferences: { sandbox: false } })
    previewWin.on('closed', () => { previewWin = null })
    return previewWin
  }
  async function renderPreviewPdfFast(html: string, pageSize?: string): Promise<Buffer> {
    const win = getPreviewWindow()
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    try {
      await Promise.race([
        win.webContents.executeJavaScript('document.fonts.ready.then(() => true)'),
        new Promise((resolve) => setTimeout(resolve, 400)),
      ])
    } catch { /* executeJavaScript failing is not fatal — just skip the wait */ }
    return win.webContents.printToPDF({ printBackground: true, margins: { marginType: 'none' }, pageSize: (pageSize as any) || 'Letter' })
  }

  // Print a note: load its HTML into an offscreen window and invoke the print dialog.
  // `pageSize` is one of Electron's own accepted strings ('Letter'|'A4'|'Legal'|...) — see
  // PAPER_SIZE_ELECTRON in src/lib/notePreviewRender.ts. Passed alongside the HTML's own
  // @page CSS `size` (set to the same paper size) as belt-and-suspenders: the CSS covers
  // preview-accuracy and any consumer that doesn't go through this handler, this covers the
  // case where Chromium's print pipeline doesn't infer page size from @page CSS on its own.
  ipcMain.handle('app:printNote', async (_e, html: string, pageSize?: string) => {
    const { writeFile, unlink, mkdtemp } = await import('fs/promises')
    const { tmpdir } = await import('os')
    // Write to a temp file so large notes work without data-URL size limits
    const tmpDir = await mkdtemp(join(tmpdir(), 'berean-print-'))
    const tmpFile = join(tmpDir, 'note.html')
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: false } })
    try {
      await writeFile(tmpFile, html, 'utf8')
      await win.loadURL(`file://${tmpFile}`)
      // Small delay to ensure full render before print dialog opens
      await new Promise<void>((resolve) => setTimeout(resolve, 300))
      await new Promise<void>((resolve) => {
        // marginType 'none' — the note's body padding is the single source of margin truth
        // (matches the on-screen preview). The user can still override in the print dialog.
        win.webContents.print({ silent: false, printBackground: true, margins: { marginType: 'none' }, pageSize: (pageSize as any) || 'Letter' }, () => resolve())
      })
      return { success: true }
    } finally {
      // Delay close so print dialog can read; then clean up temp file
      setTimeout(async () => {
        if (!win.isDestroyed()) win.close()
        try { await unlink(tmpFile) } catch { /* ignore */ }
      }, 60000)
    }
  })

  // Export a note to PDF: render HTML offscreen, printToPDF, save via dialog.
  // `pageSize` — see app:printNote's matching comment just above.
  ipcMain.handle('app:exportNotePDF', async (_e, html: string, suggestedName: string, downloadLocation?: string, pageSize?: string) => {
    const { writeFile, access } = await import('fs/promises')
    const pdf = await renderHtmlToPdfBuffer(html, pageSize)
    const parent = BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined
    const safeName = `${(suggestedName || 'note').replace(/[/\\:*?"<>|]/g, '-')}.pdf`
    // Use the configured download location as the default directory if set and exists
    let defaultDir = ''
    if (downloadLocation) {
      try { await access(downloadLocation); defaultDir = downloadLocation } catch { /* ignore — dir may not exist */ }
    }
    const result = await dialog.showSaveDialog(parent!, {
      defaultPath: defaultDir ? join(defaultDir, safeName) : safeName,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    })
    if (result.canceled || !result.filePath) return { success: false, canceled: true }
    await writeFile(result.filePath, pdf)
    return { success: true }
  })

  // Render a note's print HTML to real PDF bytes for the on-screen preview (PrintPreviewModal
  // renders these via pdf.js — src/lib/pdfjs.ts, same convention as pdf:readBytes below).
  //
  // Regression this replaces: the preview used to be a client-side approximation — one
  // continuous scaled iframe, sliced into fixed-height "page" windows purely by dividing
  // pixel height, with no real per-page margin reservation and no awareness of
  // `page-break-inside: avoid`. That's why margins looked wrong on interior pages and why
  // content could get visually chopped mid-element at a fake break point that didn't match
  // where the real PDF actually breaks. Generating and previewing the REAL PDF bytes makes
  // this a non-issue by construction — the preview IS the exact document that gets saved.
  ipcMain.handle('app:renderPreviewPDF', async (_e, html: string, pageSize?: string) => {
    const pdf = await renderPreviewPdfFast(html, pageSize)
    // Same transferable-ArrayBuffer convention as pdf:readBytes (electron/ipc/pdf.ts).
    return pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength)
  })

  // Cross-window tab sync: one window broadcasts a store state snapshot,
  // main process fans it out to all OTHER windows (not the sender).
  ipcMain.on('app:broadcastTabState', (event, payload: unknown) => {
    const sender = event.sender
    const allWins = BrowserWindow.getAllWindows()
    allWins.forEach((win) => {
      if (win.webContents !== sender) {
        win.webContents.send('app:tabStateUpdate', payload)
      }
    })
  })

  // Read Aloud (TTS) cross-window playback sync — same fan-out-to-others pattern as
  // app:broadcastTabState above, on its own channel so it doesn't collide with tab-state syncing.
  ipcMain.on('app:broadcastAudioState', (event, payload: unknown) => {
    const sender = event.sender
    BrowserWindow.getAllWindows().forEach((win) => {
      if (win.webContents !== sender) {
        win.webContents.send('app:audioStateUpdate', payload)
      }
    })
  })

  // Return a floating tab back to the main window tab bar
  ipcMain.on('app:returnFloatTab', (event, payload: { type: string; state: Record<string, unknown> }) => {
    const sender = event.sender
    BrowserWindow.getAllWindows().forEach((win) => {
      // Send to all non-float windows that aren't the sender
      const isFloat = (win as any).__isFloat === true
      if (!isFloat && win.webContents !== sender) {
        win.webContents.send('berean:menuAction', 'addTab', payload)
      }
    })
    // Close the float window
    const floatWin = BrowserWindow.fromWebContents(sender)
    floatWin?.close()
  })

  // Update IPC
  // ── Window controls (frameless Windows title bar; also used by the note
  //    editor's floating toolbar for its Focus-mode close/minimize/maximize
  //    buttons, on any platform) — target whichever window actually sent the
  //    request, falling back to mainWindow, so this behaves correctly whether
  //    it's called from the main window or a floating note tab window. ──────
  ipcMain.on('window:minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
    win?.minimize()
  })
  ipcMain.on('window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
    if (!win) return
    win.isMaximized() ? win.unmaximize() : win.maximize()
  })
  ipcMain.on('window:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
    win?.close()
  })
  ipcMain.handle('window:isMaximized', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
    return win?.isMaximized() ?? false
  })
  // macOS-only native API (no-op elsewhere) to hide/show the native traffic-light
  // buttons — used so Focus mode's floating toolbar can show its own matching-style
  // close/minimize/maximize buttons instead of the OS-drawn ones, which otherwise
  // remain visible regardless of any DOM/TopBar visibility change (they aren't web
  // content at all, just window-frame chrome).
  ipcMain.on('window:setButtonsVisible', (event, visible: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow
    try { win?.setWindowButtonVisibility(visible) } catch { /* non-macOS: no-op */ }
  })

  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('app:isMasBuild', () => isMasBuild)
  // Live macOS accent color, for the "System" theme preset — converts Electron's hex
  // ("rrggbb[aa]") into the "r g b" decimal-triple string the rest of the palette uses.
  ipcMain.handle('app:getAccentColor', () => hexToRgbTriple(safeGetAccentColor()))
  // 'normal' | 'throttled' — see powerAwareness.ts. app:resourceModeChanged (registered
  // above, alongside setupPowerAwareness()) pushes subsequent changes.
  ipcMain.handle('app:getResourceMode', () => getResourceMode())
  ipcMain.handle('app:checkForUpdates', async () => {
    if (isMasBuild) {
      sendUpdateStatus('mas')   // renderer shows "updates via App Store"
      return
    }
    if (!app.isPackaged) {
      sendUpdateStatus('error', { message: 'Update checking only works in the installed app.' })
      return
    }
    try {
      // Apply beta channel + auto-download preferences at check time
      const db = getBereanDb()
      const ch = db.prepare("SELECT value FROM settings WHERE key='updateChannel'").get() as { value: string } | undefined
      autoUpdater.allowPrerelease = ch?.value === 'beta'
      applyAutoDownloadPref(db)
      await autoUpdater.checkForUpdates()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      sendUpdateStatus('error', { message: msg })
    }
  })
  ipcMain.handle('app:downloadUpdate', async () => {
    if (isMasBuild) return
    try {
      await autoUpdater.downloadUpdate()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      sendUpdateStatus('error', { message: msg })
    }
  })
  ipcMain.handle('app:installUpdate', () => {
    if (isMasBuild) return
    try {
      autoUpdater.quitAndInstall(false, true)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('Update install failed:', msg)
      sendUpdateStatus('error', { message: `Couldn't install: ${msg}` })
    }
  })

  earlyLog('all IPC handlers registered — calling createWindow()')
  log.info('all IPC handlers registered — calling createWindow()')
  createWindow()
  earlyLog('createWindow() returned')
  log.info('createWindow() returned')

  // Fire-and-forget: scan for and log any crash report from a previous run without
  // blocking boot (the scan is diagnostic-only — see reportPreviousCrashReports).
  void reportPreviousCrashReports()

  // Merge the bundled YouTube seed AFTER the window exists and has painted, so a
  // fresh install / seed-version bump (the only cases where this does real work —
  // it short-circuits to one cheap SELECT otherwise) doesn't block first paint.
  // Runs once, after the renderer's initial load.
  mainWindow?.webContents.once('did-finish-load', () => {
    try {
      mergeYouTubeSeed(getBereanDb())
      log.info('mergeYouTubeSeed completed (post-window)')
    } catch (err) {
      log.error('mergeYouTubeSeed failed (post-window):', err)
    }
  })

  // Wire up auto-updater events now that mainWindow exists.
  // Skip entirely for MAS — the App Store handles all updates.
  if (app.isPackaged && !isMasBuild) {
    setupAutoUpdater()

    // Check for updates on startup if the user has auto-check enabled (default: on)
    const db = getBereanDb()
    const row = db.prepare("SELECT value FROM settings WHERE key='autoUpdate'").get() as { value: string } | undefined
    const autoCheckEnabled = !row || row.value !== 'false'

    // Apply beta channel + auto-download preferences before the first check
    const channelRow = db.prepare("SELECT value FROM settings WHERE key='updateChannel'").get() as { value: string } | undefined
    if (channelRow?.value === 'beta') autoUpdater.allowPrerelease = true
    applyAutoDownloadPref(db)

    if (autoCheckEnabled) {
      // Delay so the window finishes rendering before we fire the network request.
      // One retry after a longer delay covers the common "network not up yet"
      // case right after boot/wake — a bare single attempt would otherwise
      // leave the update status silently stuck on an error the user never
      // asked about and has no reason to go looking for.
      const attemptStartupCheck = (isRetry: boolean) => {
        autoUpdater.checkForUpdates().catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err)
          log.warn(`Startup update check failed${isRetry ? ' (retry)' : ''}:`, msg)
          if (isRetry) {
            sendUpdateStatus('error', { message: msg })
          } else {
            setTimeout(() => attemptStartupCheck(true), 20000)
          }
        })
      }
      setTimeout(() => attemptStartupCheck(false), 6000)

      // Keep checking periodically while the app stays open, not just once at
      // startup — a user who leaves Berean running for hours/days previously
      // never learned about a new release until their next relaunch. Re-reads
      // the "autoUpdate" setting on every tick (not just once) so toggling it
      // off in Settings mid-session actually stops future checks, and re-reads
      // the beta-channel + auto-download preferences too in case those changed.
      // `checkForUpdates` itself is just a small metadata HTTPS request — an
      // actual download only starts if `autoDownload` is true (opt-in via
      // Settings → "Automatically download updates", applyAutoDownloadPref
      // above), so this stays negligible periodic network/CPU cost by default.
      const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000
      setInterval(() => {
        const enabledNow = db.prepare("SELECT value FROM settings WHERE key='autoUpdate'").get() as { value: string } | undefined
        if (enabledNow && enabledNow.value === 'false') return
        const channelNow = db.prepare("SELECT value FROM settings WHERE key='updateChannel'").get() as { value: string } | undefined
        autoUpdater.allowPrerelease = channelNow?.value === 'beta'
        applyAutoDownloadPref(db)
        autoUpdater.checkForUpdates().catch((err: unknown) => {
          log.warn('Periodic update check failed:', err instanceof Error ? err.message : String(err))
        })
      }, UPDATE_CHECK_INTERVAL_MS)
    }
  }

  // Relay OS-level dark/light changes to all renderer windows.
  // matchMedia 'change' events are unreliable in Electron; nativeTheme is authoritative.
  nativeTheme.on('updated', () => {
    const isDark = nativeTheme.shouldUseDarkColors
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) win.webContents.send('app:nativeThemeChanged', isDark)
    })
  })

  // Same pattern for the live macOS accent color (System theme preset).
  // systemPreferences.on is only available on macOS/Windows; guard for other platforms.
  systemPreferences.on?.('accent-color-changed', () => {
    const rgb = hexToRgbTriple(safeGetAccentColor())
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) win.webContents.send('app:accentColorChanged', rgb)
    })
  })

  // Broadcasts app:resourceModeChanged to all windows on battery/thermal-pressure changes —
  // see powerAwareness.ts for what "throttled" actually gates (vault watcher polling cadence,
  // YouTube tab's re-injection/transcript-sync polling).
  setupPowerAwareness()

  app.on('activate', () => {
    if (appWindows.size === 0) createWindow()
  })
}).catch((err: unknown) => {
  const msg = err instanceof Error ? `${err.message}\n\n${err.stack}` : String(err)
  earlyLog(`STARTUP FATAL: ${msg}`)
  log.error('[startup fatal]', msg)
  dialog.showErrorBox('Berean failed to start', msg)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  // Final vault export before shutdown (no-op if no vault path is set)
  try { runExportAll() } catch { /* never block shutdown */ }
  closeBereanDb()
  closeAllTextDbs()
  closeLexiconDbs()
})
