import { app, BrowserWindow, ipcMain, session, dialog, shell, nativeImage, Menu } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import log from 'electron-log'
import { getBereanDb, closeBereanDb } from './db/berean'
import { closeAllTextDbs } from './db/bible'
import { closeLexiconDbs } from './db/lexicon'
import { registerBibleHandlers } from './ipc/bible'
import { registerNotesHandlers } from './ipc/notes'
import { registerVaultHandlers } from './ipc/vault'
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

// Redirect electron-updater logs to file so they don't clutter the console
log.transports.file.level = 'info'

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

    // ── Edit ──────────────────────────────────────────────────────────────────
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
        { type: 'separator' as const },
        {
          label: 'Find…',
          accelerator: 'CmdOrCtrl+F',
          click: () => menuSend('berean:menuAction', 'find'),
        },
      ],
    },

    // ── Bible ─────────────────────────────────────────────────────────────────
    {
      label: 'Bible',
      submenu: [
        {
          label: 'Open Reference…',
          accelerator: 'CmdOrCtrl+T',
          click: () => menuSend('berean:menuAction', 'openRef'),
        },
        {
          label: 'Command Bar…',
          accelerator: 'CmdOrCtrl+K',
          click: () => menuSend('berean:menuAction', 'openSearchInPanel'),
        },
        {
          label: 'Search All Texts…',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => menuSend('berean:menuAction', 'searchTexts'),
        },
        { type: 'separator' as const },
        {
          label: 'Previous Chapter',
          click: () => menuSend('berean:menuAction', 'prevChapter'),
        },
        {
          label: 'Next Chapter',
          click: () => menuSend('berean:menuAction', 'nextChapter'),
        },
        { type: 'separator' as const },
        {
          label: 'Navigate Back',
          accelerator: 'CmdOrCtrl+[',
          click: () => menuSend('berean:menuAction', 'navBack'),
        },
        {
          label: 'Navigate Forward',
          accelerator: 'CmdOrCtrl+]',
          click: () => menuSend('berean:menuAction', 'navForward'),
        },
        { type: 'separator' as const },
        {
          label: 'Focus Reference Bar',
          accelerator: 'CmdOrCtrl+L',
          click: () => menuSend('berean:menuAction', 'focusRefBar'),
        },
        {
          label: 'Toggle Strong\'s Numbers',
          accelerator: 'CmdOrCtrl+G',
          click: () => menuSend('berean:menuAction', 'toggleStrongs'),
        },
        {
          label: 'Compare This Verse',
          click: () => menuSend('berean:menuAction', 'compareVerse'),
        },
        { type: 'separator' as const },
        {
          label: 'New Verse Note',
          accelerator: 'CmdOrCtrl+Shift+V',
          click: () => menuSend('berean:menuAction', 'newVerseNote'),
        },
      ],
    },

    // ── Notes ─────────────────────────────────────────────────────────────────
    {
      label: 'Notes',
      submenu: [
        {
          label: 'New Note',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => menuSend('berean:menuAction', 'newNote'),
        },
        {
          label: 'New Verse Note',
          click: () => menuSend('berean:menuAction', 'newVerseNote'),
        },
        {
          label: 'Open Today\'s Daily Note',
          click: () => menuSend('berean:menuAction', 'openDailyNote'),
        },
        { type: 'separator' as const },
        {
          label: 'Toggle Markdown Preview',
          accelerator: 'CmdOrCtrl+Shift+M',
          click: () => menuSend('berean:menuAction', 'toggleMarkdown'),
        },
        {
          label: 'Insert Video Timestamp',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => menuSend('berean:menuAction', 'insertTimestamp'),
        },
        { type: 'separator' as const },
        {
          label: 'Import from BibleGateway…',
          click: () => menuSend('berean:menuAction', 'openImportBibleGateway'),
        },
        {
          label: 'Import from e-Sword…',
          click: () => menuSend('berean:menuAction', 'openImportESword'),
        },
      ],
    },

    // ── View ──────────────────────────────────────────────────────────────────
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => menuSend('berean:menuAction', 'toggleSidebar'),
        },
        {
          label: 'History',
          accelerator: 'CmdOrCtrl+H',
          click: () => menuSend('berean:menuAction', 'openHistory'),
        },
        { type: 'separator' as const },
        ...(is.dev ? [
          { role: 'reload' as const },
          { role: 'forceReload' as const },
          { role: 'toggleDevTools' as const },
          { type: 'separator' as const },
        ] : []),
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
      ],
    },

    // ── Window ────────────────────────────────────────────────────────────────
    {
      label: 'Window',
      submenu: [
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+N',
          click: () => createWindow(),
        },
        {
          label: 'Pop Out Current Tab',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => menuSend('berean:menuAction', 'popOutTab'),
        },
        { type: 'separator' as const },
        // Close Tab intercepts Cmd+W before macOS closes the window
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => menuSend('app:closeTab'),
        },
        { type: 'separator' as const },
        {
          label: 'Scripture',
          accelerator: 'CmdOrCtrl+1',
          click: () => menuSend('berean:menuAction', 'switchSpace', 'scripture'),
        },
        {
          label: 'Notes',
          accelerator: 'CmdOrCtrl+2',
          click: () => menuSend('berean:menuAction', 'switchSpace', 'notes'),
        },
        {
          label: 'Lexicon',
          accelerator: 'CmdOrCtrl+3',
          click: () => menuSend('berean:menuAction', 'switchSpace', 'lexicon'),
        },
        {
          label: 'YouTube',
          accelerator: 'CmdOrCtrl+4',
          click: () => menuSend('berean:menuAction', 'switchSpace', 'youtube'),
        },
        {
          label: 'Search',
          accelerator: 'CmdOrCtrl+5',
          click: () => menuSend('berean:menuAction', 'switchSpace', 'search'),
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

function createFloatingWindow(type: string, state: Record<string, unknown>): void {
  const iconPath = is.dev
    ? join(app.getAppPath(), 'assets/icon.icns')
    : join(process.resourcesPath, 'assets/icon.icns')
  const appIcon = nativeImage.createFromPath(iconPath)

  const paramStr = new URLSearchParams({ float: '1', type, ...Object.fromEntries(
    Object.entries(state).map(([k, v]) => [k, String(v)])
  )}).toString()

  const floatWin = new BrowserWindow({
    width: 700,
    height: 700,
    minWidth: 400,
    minHeight: 400,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 14 },
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
  console.log('[main] Float window created — id:', floatWin.id, '| alwaysOnTop:', floatWin.isAlwaysOnTop(), '| level: screen-saver | type:', type)

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

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 14 },
    backgroundColor: '#111114',
    icon: appIcon,
    // Show [Dev] in the window title (visible in macOS app switcher / dock tooltip)
    title: is.dev ? 'Berean [Dev]' : 'Berean',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
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

  // Intercept Cmd+W so the renderer can close a tab instead of quitting.
  // IMPORTANT: capture the window reference now — do NOT use `mainWindow` inside the
  // handler, because createWindow() can be called again for a second window and would
  // overwrite `mainWindow`, causing this handler to send to the wrong window.
  const thisWin = mainWindow
  thisWin.webContents.on('before-input-event', (event, input) => {
    if (input.meta && !input.shift && !input.alt && input.key.toLowerCase() === 'w') {
      console.log('[main] Cmd+W before-input-event — sending app:closeTab to window id:', thisWin.id)
      event.preventDefault()
      thisWin.webContents.send('app:closeTab')
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
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

  // Open app DB and run migrations before registering IPC handlers
  getBereanDb()

  // Persistent session for YouTube webview
  session.fromPartition('persist:youtube')

  registerBibleHandlers(ipcMain)
  registerNotesHandlers(ipcMain)
  registerVaultHandlers(ipcMain)
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

  // Cross-window tab sync: one window broadcasts a store state snapshot,
  // main process fans it out to all OTHER windows (not the sender).
  ipcMain.on('app:broadcastTabState', (event, payload: unknown) => {
    const sender = event.sender
    const allWins = BrowserWindow.getAllWindows()
    console.log('[main] app:broadcastTabState — total windows:', allWins.length, '| sender id:', sender.id)
    allWins.forEach((win) => {
      if (win.webContents !== sender) {
        console.log('[main]   → forwarding to window id:', win.id)
        win.webContents.send('app:tabStateUpdate', payload)
      }
    })
  })

  // Return a floating tab back to the main window tab bar
  ipcMain.on('app:returnFloatTab', (event, payload: { type: string; state: Record<string, unknown> }) => {
    console.log('[main] app:returnFloatTab — type:', payload.type, '| returning to main windows')
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

  createWindow()

  // Wire up auto-updater events now that mainWindow exists.
  // Skip entirely for MAS — the App Store handles all updates.
  if (app.isPackaged && !isMasBuild) {
    setupAutoUpdater()

    // Check for updates on startup if the user has auto-check enabled (default: on)
    const db = getBereanDb()
    const row = db.prepare("SELECT value FROM settings WHERE key='autoUpdate'").get() as { value: string } | undefined
    const autoCheckEnabled = !row || row.value !== 'false'
    if (autoCheckEnabled) {
      // Delay so the window finishes rendering before we fire the network request
      setTimeout(() => {
        autoUpdater.checkForUpdates().catch((err: unknown) => {
          log.warn('Startup update check failed:', err)
        })
      }, 6000)
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  closeBereanDb()
  closeAllTextDbs()
  closeLexiconDbs()
})
