import { app, BrowserWindow, ipcMain, session, dialog, shell, nativeImage, Menu, nativeTheme } from 'electron'
import type Electron from 'electron'
import { join } from 'path'
import { appendFileSync, mkdirSync } from 'fs'
import os from 'os'
import { is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'

// Write to a known container path before anything else — captures crashes that happen
// before app.ready (before electron-log knows its path).
const EARLY_LOG = join(os.homedir(), 'Library', 'Containers', 'com.berean.app', 'Data', 'berean-startup.log')
function earlyLog(msg: string) {
  try {
    mkdirSync(join(os.homedir(), 'Library', 'Containers', 'com.berean.app', 'Data'), { recursive: true })
    appendFileSync(EARLY_LOG, `[${new Date().toISOString()}] ${msg}\n`)
  } catch { /* sandbox may block this pre-ready; tolerate */ }
}
earlyLog('main.ts: module loaded')
// Verify the early log is actually writing by immediately reading it back.
// If the file exists, we know the container path is correct.
try {
  const { readFileSync } = require('fs') as typeof import('fs')
  const contents = readFileSync(EARLY_LOG, 'utf8')
  if (!contents.includes('module loaded')) {
    appendFileSync(EARLY_LOG, `[${new Date().toISOString()}] WARNING: log verify mismatch\n`)
  }
} catch { /* will be caught if file not yet created */ }
import { getBereanDb, closeBereanDb, mergeYouTubeSeed } from './db/berean'
import { closeAllTextDbs } from './db/bible'
import { closeLexiconDbs } from './db/lexicon'
import { registerBibleHandlers } from './ipc/bible'
import { registerNotesHandlers } from './ipc/notes'
import { registerPdfHandlers } from './ipc/pdf'
import { registerVaultHandlers, runExportAll, setupAutoExport } from './ipc/vault'
import { registerSettingsHandlers } from './ipc/settings'
import { registerLexiconHandlers } from './ipc/lexicon'
import { registerHighlightHandlers } from './ipc/highlights'
import { registerYouTubeHandlers } from './ipc/youtube'
import { registerCrossRefsHandlers } from './ipc/crossrefs'
import { registerBgImportHandlers } from './ipc/bgImport'
import { registerESwordImportHandlers } from './ipc/eSwordImport'
import { registerHistoryHandlers } from './ipc/history'
import { registerWorkspacesHandlers } from './ipc/workspaces'

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
try {
  const { readdirSync, readFileSync, statSync } = require('fs') as typeof import('fs')
  const crashDir = join(os.homedir(), 'Library', 'Containers', 'com.berean.app', 'Data', 'Library', 'Application Support', 'CrashReporter')
  const files = readdirSync(crashDir).filter((f) => f.endsWith('.plist') || f.endsWith('.ips'))
  for (const f of files) {
    const full = join(crashDir, f)
    const age = Date.now() - statSync(full).mtimeMs
    if (age < 5 * 60 * 1000) { // only crashes from the last 5 min
      earlyLog(`[prev-crash-report] ${f}: ${readFileSync(full, 'utf8').slice(0, 800)}`)
    }
  }
} catch { /* dir may not exist yet */ }

// MAS builds: the App Store owns updates — electron-updater must be disabled entirely.
// process.mas is set to true by Electron when running inside the Mac App Store sandbox.
const isMasBuild = process.mas === true

if (!isMasBuild) {
  autoUpdater.logger = log
  // Don't auto-download — wait for user to confirm
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
}

let mainWindow: BrowserWindow | null = null
let viewerWindow: BrowserWindow | null = null

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
  viewerWindow = new BrowserWindow({
    width: 900,
    height: 700,
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

  viewerWindow.on('closed', () => {
    viewerWindow = null
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed() && !(win as any).__isViewer) {
        win.webContents.send('app:viewerWindowClosed')
      }
    })
  })
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

function createWindow(): void {
  const iconPath = is.dev
    ? join(app.getAppPath(), 'assets/icon.icns')
    : join(process.resourcesPath, 'assets/icon.icns')
  const appIcon = nativeImage.createFromPath(iconPath)

  const isMacWin = process.platform === 'darwin'
  const isWinWin = process.platform === 'win32'
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
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

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  if (is.dev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  }

  // Notify renderer when window is maximized/unmaximized (for Windows title bar button state)
  mainWindow.on('maximize',   () => mainWindow?.webContents.send('window:maximizeChanged', true))
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximizeChanged', false))

  // Intercept Cmd+W so the renderer can close a tab instead of quitting.
  // IMPORTANT: capture the window reference now — do NOT use `mainWindow` inside the
  // handler, because createWindow() can be called again for a second window and would
  // overwrite `mainWindow`, causing this handler to send to the wrong window.
  const thisWin = mainWindow
  thisWin.webContents.on('before-input-event', (event, input) => {
    if (input.meta && !input.shift && !input.alt && input.key.toLowerCase() === 'w') {
      event.preventDefault()
      thisWin.webContents.send('app:closeTab')
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    const msg = `reason: ${details.reason}  exitCode: ${details.exitCode}`
    earlyLog(`[renderer-process-gone] ${msg}`)
    log.error('[renderer-process-gone]', JSON.stringify(details))
    dialog.showErrorBox('Renderer crashed', msg)
  })
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    earlyLog(`[did-fail-load] ${code} ${desc} ${url}`)
    log.error('[did-fail-load]', code, desc, url)
  })
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const lvl = ['verbose', 'info', 'warning', 'error'][level] ?? 'unknown'
    earlyLog(`[renderer-console:${lvl}] ${message}  (${sourceId}:${line})`)
    log.info(`[renderer:${lvl}] ${message}`)
  })
  mainWindow.webContents.on('did-start-loading', () => {
    earlyLog('[did-start-loading]')
    log.info('[did-start-loading]')
  })
  mainWindow.webContents.on('did-start-navigation', (_e, url) => {
    earlyLog(`[did-start-navigation] ${url}`)
    log.info('[did-start-navigation]', url)
  })
  mainWindow.webContents.on('dom-ready', () => {
    earlyLog('[dom-ready]')
    log.info('[dom-ready]')
  })
  mainWindow.webContents.on('did-finish-load', () => {
    earlyLog('[did-finish-load] renderer HTML loaded OK')
    log.info('[did-finish-load] renderer loaded')
  })
  mainWindow.webContents.on('unresponsive', () => {
    earlyLog('[unresponsive] renderer is not responding')
    log.warn('[unresponsive]')
  })
  mainWindow.webContents.on('responsive', () => {
    earlyLog('[responsive]')
    log.info('[responsive]')
  })
  // Show a native spell-check context menu when the user right-clicks a misspelled word.
  mainWindow.webContents.on('context-menu', (_e, params) => {
    const { misspelledWord, dictionarySuggestions } = params
    if (!misspelledWord) return
    const items: Electron.MenuItemConstructorOptions[] = dictionarySuggestions.length > 0
      ? dictionarySuggestions.slice(0, 8).map(s => ({
          label: s,
          click: () => mainWindow!.webContents.replaceMisspelling(s),
        }))
      : [{ label: 'No suggestions', enabled: false }]
    items.push(
      { type: 'separator' },
      {
        label: 'Add to Dictionary',
        click: () => mainWindow!.session.addWordToSpellCheckerDictionary(misspelledWord),
      },
    )
    Menu.buildFromTemplate(items).popup({ window: mainWindow! })
  })
  log.info('mainWindow created, loading renderer...')
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
    const db = getBereanDb()
    earlyLog('berean.db opened OK')
    log.info('berean.db opened')
    mergeYouTubeSeed(db)
  } catch (err) {
    earlyLog(`berean.db FAILED: ${err}`)
    log.error('Failed to open berean.db:', err)
    throw err
  }

  // Persistent session for YouTube webview
  session.fromPartition('persist:youtube')
  log.info('youtube session created')

  // ── Content-Security-Policy (default session = main app window only) ─────────
  // The YouTube <webview> uses the separate 'persist:youtube' session, so this
  // does not touch it. Dev needs 'unsafe-eval' + ws: for Vite HMR; the packaged
  // build is locked down (script-src 'self', no eval) — which resolves Electron's
  // "Insecure Content-Security-Policy" warning for production users.
  const cspValue = [
    "default-src 'self'",
    is.dev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "media-src 'self' blob: data: https:",
    is.dev ? "connect-src 'self' ws: http: https:" : "connect-src 'self' https:",
    "frame-src 'self' https://www.youtube.com data:",
    "worker-src 'self' blob:",
  ].join('; ')

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

  registerBibleHandlers(ipcMain)
  registerNotesHandlers(ipcMain)
  log.info('[berean-main] Notes handlers registered')
  registerPdfHandlers(ipcMain)
  log.info('[berean-main] PDF handlers registered')
  registerVaultHandlers(ipcMain)
  // Read saved auto-export interval and start the timer (0 = off)
  try {
    const row = getBereanDb().prepare('SELECT value FROM settings WHERE key = ?').get('vaultAutoExportMinutes') as { value: string } | undefined
    const saved = row ? (JSON.parse(row.value) as number) : 0
    setupAutoExport(saved)
  } catch { /* ignore — timer stays off if setting unreadable */ }
  registerSettingsHandlers(ipcMain)
  registerLexiconHandlers(ipcMain)
  registerHighlightHandlers(ipcMain)
  registerYouTubeHandlers(ipcMain)
  registerCrossRefsHandlers(ipcMain)
  registerBgImportHandlers(ipcMain, () => mainWindow)
  registerESwordImportHandlers(ipcMain, () => mainWindow)
  registerHistoryHandlers(ipcMain)
  registerWorkspacesHandlers(ipcMain)

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
  ipcMain.handle('app:newWindow', () => { createWindow() })
  ipcMain.handle('app:openFloatingTab', (_e, type: string, state: Record<string, unknown>) => {
    createFloatingWindow(type, state ?? {})
  })
  ipcMain.handle('app:openViewerWindow', () => {
    if (viewerWindow && !viewerWindow.isDestroyed()) {
      viewerWindow.focus()
      return true
    }
    createViewerWindow()
    return true
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
    console.log('[Viewer IPC] app:pushViewerContent received — viewerWindow:', !!viewerWindow, '— payload:', JSON.stringify(payload))
    if (viewerWindow && !viewerWindow.isDestroyed()) {
      viewerWindow.webContents.send('viewer:content', payload)
      console.log('[Viewer IPC] viewer:content sent to viewer window')
    } else {
      console.log('[Viewer IPC] NO viewer window to send to')
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

  // Print a note: load its HTML into an offscreen window and invoke the print dialog.
  ipcMain.handle('app:printNote', async (_e, html: string) => {
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
        win.webContents.print({ silent: false, printBackground: true, margins: { marginType: 'none' } }, () => resolve())
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
  ipcMain.handle('app:exportNotePDF', async (_e, html: string, suggestedName: string, downloadLocation?: string) => {
    const { writeFile, unlink, mkdtemp, access } = await import('fs/promises')
    const { tmpdir } = await import('os')
    const tmpDir = await mkdtemp(join(tmpdir(), 'berean-pdf-'))
    const tmpFile = join(tmpDir, 'note.html')
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: false } })
    try {
      await writeFile(tmpFile, html, 'utf8')
      await win.loadURL(`file://${tmpFile}`)
      await new Promise<void>((resolve) => setTimeout(resolve, 300))
      // marginType 'none' — body padding (set per the chosen margin preset) is the sole margin,
      // so the exported PDF matches the on-screen preview exactly.
      const pdf = await win.webContents.printToPDF({ printBackground: true, margins: { marginType: 'none' } })
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
    } finally {
      if (!win.isDestroyed()) win.close()
      try { await unlink(tmpFile) } catch { /* ignore */ }
    }
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
  // ── Window controls (frameless Windows title bar) ────────────────────────
  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => {
    if (!mainWindow) return
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
  })
  ipcMain.on('window:close', () => mainWindow?.close())
  ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() ?? false)

  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('app:isMasBuild', () => isMasBuild)
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
      // Apply beta channel preference at check time
      const db = getBereanDb()
      const ch = db.prepare("SELECT value FROM settings WHERE key='updateChannel'").get() as { value: string } | undefined
      autoUpdater.allowPrerelease = ch?.value === 'beta'
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
    autoUpdater.quitAndInstall(false, true)
  })

  earlyLog('all IPC handlers registered — calling createWindow()')
  log.info('all IPC handlers registered — calling createWindow()')
  createWindow()
  earlyLog('createWindow() returned')
  log.info('createWindow() returned')

  // Wire up auto-updater events now that mainWindow exists.
  // Skip entirely for MAS — the App Store handles all updates.
  if (app.isPackaged && !isMasBuild) {
    setupAutoUpdater()

    // Check for updates on startup if the user has auto-check enabled (default: on)
    const db = getBereanDb()
    const row = db.prepare("SELECT value FROM settings WHERE key='autoUpdate'").get() as { value: string } | undefined
    const autoCheckEnabled = !row || row.value !== 'false'

    // Apply beta channel preference before the first check
    const channelRow = db.prepare("SELECT value FROM settings WHERE key='updateChannel'").get() as { value: string } | undefined
    if (channelRow?.value === 'beta') autoUpdater.allowPrerelease = true

    if (autoCheckEnabled) {
      // Delay so the window finishes rendering before we fire the network request
      setTimeout(() => {
        autoUpdater.checkForUpdates().catch((err: unknown) => {
          log.warn('Startup update check failed:', err)
        })
      }, 6000)
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
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
  // Final vault export before shutdown (honours vaultAutoExportMinutes > 0 or any path set)
  try { runExportAll() } catch { /* never block shutdown */ }
  closeBereanDb()
  closeAllTextDbs()
  closeLexiconDbs()
})
