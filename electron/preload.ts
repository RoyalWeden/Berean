import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('bible', {
  queryChapter: (bookId: string, chapter: number, textId?: string) =>
    ipcRenderer.invoke('bible:queryChapter', bookId, chapter, textId),
  queryVerse: (bookId: string, chapter: number, verse: number, textId?: string) =>
    ipcRenderer.invoke('bible:queryVerse', bookId, chapter, verse, textId),
  searchText: (query: string, textId?: string, wordMode?: 'all' | 'any' | 'phrase', bookIds?: string[]) =>
    ipcRenderer.invoke('bible:searchText', query, textId, wordMode, bookIds),
  getBooks: (textId?: string) =>
    ipcRenderer.invoke('bible:getBooks', textId)
})

contextBridge.exposeInMainWorld('notes', {
  createNote: (data: unknown) => ipcRenderer.invoke('notes:create', data),
  updateNote: (id: string, data: unknown) => ipcRenderer.invoke('notes:update', id, data),
  deleteNote: (id: string) => ipcRenderer.invoke('notes:delete', id),
  deleteAllNotes: () => ipcRenderer.invoke('notes:deleteAll'),
  deleteByTag: (tag: string) => ipcRenderer.invoke('notes:deleteByTag', tag),
  getNotes: (limit?: number, offset?: number) =>
    ipcRenderer.invoke('notes:getAll', limit, offset),
  getVerseNotes: (verseRef: string, textId?: string) =>
    ipcRenderer.invoke('notes:getByVerse', verseRef, textId),
  getNote: (id: string) => ipcRenderer.invoke('notes:getOne', id),
  getChapterNotes: (bookId: string, chapter: number, textId?: string) =>
    ipcRenderer.invoke('notes:getByChapter', bookId, chapter, textId),
  getChapterCounts: (bookId: string, chapter: number, textId?: string) =>
    ipcRenderer.invoke('notes:getChapterCounts', bookId, chapter, textId),
  searchNotes: (query: string, limit?: number, mode?: 'all' | 'any' | 'phrase') =>
    ipcRenderer.invoke('notes:search', query, limit, mode),
  // Version history
  createNoteVersion: (noteId: string, title: string, content: string, kind?: string) =>
    ipcRenderer.invoke('notes:createVersion', noteId, title, content, kind),
  getNoteVersions: (noteId: string) => ipcRenderer.invoke('notes:getVersions', noteId),
  restoreNoteVersion: (noteId: string, versionId: string) =>
    ipcRenderer.invoke('notes:restoreVersion', noteId, versionId),
  setNoteFolder: (noteId: string, folderId: string | null) =>
    ipcRenderer.invoke('notes:setFolder', noteId, folderId),
  // Folders
  getFolders: () => ipcRenderer.invoke('folders:getAll'),
  createFolder: (name: string, parentId?: string | null) =>
    ipcRenderer.invoke('folders:create', name, parentId ?? null),
  renameFolder: (id: string, name: string) => ipcRenderer.invoke('folders:rename', id, name),
  deleteFolder: (id: string) => ipcRenderer.invoke('folders:delete', id),
  deleteFolderDeep: (id: string) => ipcRenderer.invoke('folders:deleteDeep', id),
  setFolderParent: (id: string, parentId: string | null) =>
    ipcRenderer.invoke('folders:setParent', id, parentId),
  listIdioms: () => ipcRenderer.invoke('notes:listIdioms'),
  // Cross-window sync: main process broadcasts this to every OTHER window whenever
  // any note mutation succeeds, so each renderer's own noteChangeToken can bump.
  onChanged: (cb: () => void) => {
    ipcRenderer.removeAllListeners('notes:changed')
    ipcRenderer.on('notes:changed', () => cb())
  },
})

contextBridge.exposeInMainWorld('lexicon', {
  getEntry: (strongsNum: string) => ipcRenderer.invoke('lexicon:getEntry', strongsNum),
  getOccurrences: (strongsNum: string) =>
    ipcRenderer.invoke('lexicon:getOccurrences', strongsNum),
  getRelated: (strongsNum: string) => ipcRenderer.invoke('lexicon:getRelated', strongsNum),
  search: (query: string, lang: 'H' | 'G' | 'all') =>
    ipcRenderer.invoke('lexicon:search', query, lang)
})

contextBridge.exposeInMainWorld('highlights', {
  getChapter: (bookId: string, chapter: number, textId?: string) =>
    ipcRenderer.invoke('highlights:getChapter', bookId, chapter, textId),
  toggle: (params: unknown) => ipcRenderer.invoke('highlights:toggle', params),
  remove: (bookId: string, chapter: number, verseNum: number, textId?: string) =>
    ipcRenderer.invoke('highlights:remove', bookId, chapter, verseNum, textId)
})

contextBridge.exposeInMainWorld('settings', {
  get: (key: string) => ipcRenderer.invoke('settings:get', key),
  set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),
  getAll: () => ipcRenderer.invoke('settings:getAll')
})

contextBridge.exposeInMainWorld('pdf', {
  import: () => ipcRenderer.invoke('pdf:import'),
  list: () => ipcRenderer.invoke('pdf:list'),
  get: (id: string) => ipcRenderer.invoke('pdf:get', id),
  readBytes: (id: string) => ipcRenderer.invoke('pdf:readBytes', id),
  setPageCount: (id: string, n: number) => ipcRenderer.invoke('pdf:setPageCount', id, n),
  rename: (id: string, title: string) => ipcRenderer.invoke('pdf:rename', id, title),
  delete: (id: string) => ipcRenderer.invoke('pdf:delete', id),
  highlightsList: (pdfId: string) => ipcRenderer.invoke('pdf:highlights:list', pdfId),
  highlightsAdd: (data: unknown) => ipcRenderer.invoke('pdf:highlights:add', data),
  highlightsRemove: (id: string) => ipcRenderer.invoke('pdf:highlights:remove', id),
  highlightsSetNote: (id: string, note: string) => ipcRenderer.invoke('pdf:highlights:setNote', id, note),
})

contextBridge.exposeInMainWorld('app', {
  onCloseTab: (cb: () => void) => {
    ipcRenderer.removeAllListeners('app:closeTab')
    ipcRenderer.on('app:closeTab', (_evt) => {
      cb()
    })
  },
  onOpenSettings: (cb: () => void) => {
    ipcRenderer.removeAllListeners('app:openSettings')
    ipcRenderer.on('app:openSettings', cb)
  },
  // Real trackpad finger-down/finger-up signal (main process, see main.ts's
  // 'web-contents-created'/'input-event' hook) — used by BiblePanel.tsx's
  // swipe-to-open/close side-panel gesture instead of guessing from wheel-event silence.
  onTrackpadSwipeBegin: (cb: () => void) => {
    ipcRenderer.removeAllListeners('app:trackpadSwipeBegin')
    ipcRenderer.on('app:trackpadSwipeBegin', () => cb())
  },
  onTrackpadSwipeEnd: (cb: () => void) => {
    ipcRenderer.removeAllListeners('app:trackpadSwipeEnd')
    ipcRenderer.on('app:trackpadSwipeEnd', () => cb())
  },
  onMenuAction: (cb: (action: string, payload?: unknown) => void) => {
    ipcRenderer.removeAllListeners('berean:menuAction')
    ipcRenderer.on('berean:menuAction', (_, action, payload) => cb(action, payload))
  },
  openFolderDialog: () => ipcRenderer.invoke('app:openFolderDialog'),
  openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
  isDev: () => ipcRenderer.invoke('app:isDev'),
  youTubeSignOut: () => ipcRenderer.invoke('app:youTubeSignOut'),
  newWindow: () => ipcRenderer.invoke('app:newWindow'),
  moveWindowBy: (dx: number, dy: number) => ipcRenderer.send('app:moveWindowBy', dx, dy),
  openFloatingTab: (type: string, state: unknown) => ipcRenderer.invoke('app:openFloatingTab', type, state),
  openViewerWindow: () => ipcRenderer.invoke('app:openViewerWindow'),
  closeViewerWindow: () => ipcRenderer.invoke('app:closeViewerWindow'),
  isViewerWindowOpen: () => ipcRenderer.invoke('app:isViewerWindowOpen'),
  pushViewerContent: (payload: unknown) => ipcRenderer.send('app:pushViewerContent', payload),
  // Push display/format settings (word replacer, note blocks, theme…) to the viewer window
  pushViewerSettings: (settings: unknown) => ipcRenderer.send('app:pushViewerSettings', settings),
  // Push ephemeral overlays (text selection mirror + laser pointer) to the viewer window
  pushViewerOverlay: (payload: unknown) => ipcRenderer.send('app:pushViewerOverlay', payload),
  // Receive the viewer's currently-visible verse region (for the main-window outline)
  onViewerVisibleRegion: (cb: (region: unknown) => void) => {
    ipcRenderer.removeAllListeners('viewer:visibleRegion')
    ipcRenderer.on('viewer:visibleRegion', (_, region) => cb(region))
  },
  // Ask the presenter to re-report its visible region even if its content hasn't changed
  // (e.g. after unpausing live sync, so a stale region can't permanently hide the outline band)
  requestViewerVisibleRegion: () => ipcRenderer.send('app:requestViewerVisibleRegion'),
  onViewerWindowClosed: (cb: () => void) => {
    ipcRenderer.removeAllListeners('app:viewerWindowClosed')
    ipcRenderer.on('app:viewerWindowClosed', () => cb())
  },
  onViewerReady: (cb: () => void) => {
    ipcRenderer.removeAllListeners('viewer:ready')
    ipcRenderer.on('viewer:ready', () => cb())
  },
  // Print / export a rendered note (full HTML document string)
  printNote: (html: string) => ipcRenderer.invoke('app:printNote', html),
  exportNotePDF: (html: string, suggestedName: string, downloadLocation?: string) => ipcRenderer.invoke('app:exportNotePDF', html, suggestedName, downloadLocation ?? ''),
  // Cross-window tab sync
  broadcastTabState: (payload: unknown) => ipcRenderer.send('app:broadcastTabState', payload),
  onTabStateUpdate: (cb: (payload: unknown) => void) => {
    ipcRenderer.removeAllListeners('app:tabStateUpdate')
    ipcRenderer.on('app:tabStateUpdate', (_, payload) => cb(payload))
  },
  // Return a floating tab back to the main window
  returnFloatTab: (payload: { type: string; state: Record<string, unknown> }) =>
    ipcRenderer.send('app:returnFloatTab', payload),
  // Auto-updater
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  isMasBuild: () => ipcRenderer.invoke('app:isMasBuild'),
  checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),
  downloadUpdate: () => ipcRenderer.invoke('app:downloadUpdate'),
  installUpdate: () => ipcRenderer.invoke('app:installUpdate'),
  onNativeThemeChanged: (cb: (isDark: boolean) => void) => {
    ipcRenderer.removeAllListeners('app:nativeThemeChanged')
    ipcRenderer.on('app:nativeThemeChanged', (_, isDark) => cb(isDark as boolean))
  },
  getAccentColor: () => ipcRenderer.invoke('app:getAccentColor') as Promise<string | null>,
  onAccentColorChanged: (cb: (rgb: string | null) => void) => {
    ipcRenderer.removeAllListeners('app:accentColorChanged')
    ipcRenderer.on('app:accentColorChanged', (_, rgb) => cb(rgb as string | null))
  },
  // 'normal' | 'throttled' — on battery power or under macOS thermal pressure. Consumers
  // (e.g. YouTubeTab's polling intervals) use this to back off non-essential background
  // work during a long session or when the system is under sustained load.
  getResourceMode: () => ipcRenderer.invoke('app:getResourceMode') as Promise<'normal' | 'throttled'>,
  onResourceModeChanged: (cb: (mode: 'normal' | 'throttled') => void) => {
    ipcRenderer.removeAllListeners('app:resourceModeChanged')
    ipcRenderer.on('app:resourceModeChanged', (_, mode) => cb(mode as 'normal' | 'throttled'))
  },
  onUpdateStatus: (cb: (status: unknown) => void) => {
    ipcRenderer.removeAllListeners('app:updateStatus')
    ipcRenderer.on('app:updateStatus', (_, status) => cb(status))
  },
})

contextBridge.exposeInMainWorld('viewer', {
  onContent: (cb: (payload: unknown) => void) => {
    ipcRenderer.removeAllListeners('viewer:content')
    ipcRenderer.on('viewer:content', (_, payload) => {
      console.log('[Viewer preload] viewer:content received:', JSON.stringify(payload))
      cb(payload)
    })
  },
  // Receive display/format settings from the main window
  onSettings: (cb: (settings: unknown) => void) => {
    ipcRenderer.removeAllListeners('viewer:settings')
    ipcRenderer.on('viewer:settings', (_, settings) => cb(settings))
  },
  // Receive ephemeral overlays (selection mirror + laser pointer)
  onOverlay: (cb: (payload: unknown) => void) => {
    ipcRenderer.removeAllListeners('viewer:overlay')
    ipcRenderer.on('viewer:overlay', (_, payload) => cb(payload))
  },
  // Report which verses are currently visible in the viewer (drives the main-window outline)
  reportVisibleRegion: (region: unknown) => ipcRenderer.send('viewer:reportVisibleRegion', region),
  // Main window asking us to re-report our visible region right now (see requestViewerVisibleRegion)
  onRequestVisibleRegion: (cb: () => void) => {
    ipcRenderer.removeAllListeners('viewer:requestVisibleRegion')
    ipcRenderer.on('viewer:requestVisibleRegion', () => cb())
  },
  signalReady: () => {
    console.log('[Viewer preload] signalReady called — sending viewer:signalReady to main')
    ipcRenderer.send('viewer:signalReady')
  },
})

contextBridge.exposeInMainWorld('crossrefs', {
  getForVerse: (bookId: string, chapter: number, verse: number) =>
    ipcRenderer.invoke('crossrefs:getForVerse', bookId, chapter, verse),
  getTSKeForVerse: (bookId: string, chapter: number, verse: number) =>
    ipcRenderer.invoke('crossrefs:getTSKeForVerse', bookId, chapter, verse),
  getForChapter: (bookId: string, chapter: number) =>
    ipcRenderer.invoke('crossrefs:getForChapter', bookId, chapter),
  getTSKeForChapter: (bookId: string, chapter: number) =>
    ipcRenderer.invoke('crossrefs:getTSKeForChapter', bookId, chapter),
  getHermasTaylorChapter: (bookId: string, chapter: number) =>
    ipcRenderer.invoke('crossrefs:getHermasTaylorChapter', bookId, chapter),
  status: () => ipcRenderer.invoke('crossrefs:status'),
})

contextBridge.exposeInMainWorld('aiLookup', {
  checkAvailable: () => ipcRenderer.invoke('ailookup:checkAvailable'),
  query: (question: string, opts: { commentary: boolean; agentic?: boolean; model?: string; textId?: string; wordReplacerRules?: Array<{ queries: string[]; replacement: string }> }) =>
    ipcRenderer.invoke('ailookup:query', question, opts),
  listChats: () => ipcRenderer.invoke('ailookup:listChats'),
  getChat: (id: string) => ipcRenderer.invoke('ailookup:getChat', id),
  saveChat: (chat: unknown) => ipcRenderer.invoke('ailookup:saveChat', chat),
  deleteChat: (id: string) => ipcRenderer.invoke('ailookup:deleteChat', id),
  // Live status text during a single query() call (e.g. "Searching Jubilees…") — the main
  // process handler sends these via event.sender.send while the async work is still in
  // flight, same request/response call still resolves with the final result as normal.
  onProgress: (cb: (status: string) => void) => {
    ipcRenderer.removeAllListeners('ailookup:progress')
    ipcRenderer.on('ailookup:progress', (_, status) => cb(status))
  },
})

contextBridge.exposeInMainWorld('youtube', {
  loadAll: () => ipcRenderer.invoke('youtube:loadAll'),
  refresh: () => ipcRenderer.invoke('youtube:refresh'),
  fullSync: () => ipcRenderer.invoke('youtube:fullSync'),
  clearAll: () => ipcRenderer.invoke('youtube:clearAll'),
  onProgress: (cb: (p: { done: number; total: number; phase: string }) => void) => {
    ipcRenderer.removeAllListeners('youtube:progress')
    ipcRenderer.on('youtube:progress', (_, p) => cb(p))
  },
  toggleStar: (videoId: string) => ipcRenderer.invoke('youtube:toggleStar', videoId),
  savePosition: (videoId: string, seconds: number, meta: { title: string; channelName: string; thumbnailUrl: string }) =>
    ipcRenderer.invoke('youtube:savePosition', videoId, seconds, meta),
  getPosition: (videoId: string) => ipcRenderer.invoke('youtube:getPosition', videoId),
  getWatchHistory: () => ipcRenderer.invoke('youtube:getWatchHistory'),
  removeFromHistory: (videoId: string) => ipcRenderer.invoke('youtube:removeFromHistory', videoId),
  clearWatchHistory: () => ipcRenderer.invoke('youtube:clearWatchHistory'),
  fetchDescription: (videoId: string) => ipcRenderer.invoke('youtube:fetchDescription', videoId),
  searchVideos: (query: string, limit?: number) => ipcRenderer.invoke('youtube:searchVideos', query, limit),
  fetchTranscripts: (batchSize?: number, workerCount?: number) => ipcRenderer.invoke('youtube:fetchTranscripts', batchSize, workerCount),
  clearTranscripts: () => ipcRenderer.invoke('youtube:clearTranscripts'),
  getTranscriptStatus: () => ipcRenderer.invoke('youtube:getTranscriptStatus'),
  getTranscript: (videoId: string) => ipcRenderer.invoke('youtube:getTranscript', videoId),
  searchTranscripts: (query: string, videoLimit?: number, perVideoLimit?: number) => ipcRenderer.invoke('youtube:searchTranscripts', query, videoLimit, perVideoLimit),
  buildSeed: () => ipcRenderer.invoke('youtube:buildSeed'),
})

contextBridge.exposeInMainWorld('vault', {
  syncNote: (noteId: string) => ipcRenderer.invoke('vault:syncNote', noteId),
  readVaultNote: (title: string) => ipcRenderer.invoke('vault:readNote', title),
  watchVault: () => ipcRenderer.invoke('vault:watch'),
  unwatchVault: () => ipcRenderer.invoke('vault:unwatch'),
  reconcile: () => ipcRenderer.invoke('vault:reconcile'),
  exportAll: () => ipcRenderer.invoke('vault:exportAll', localStorage.getItem('berean-app-state') ?? undefined),
  setAutoExport: (intervalMinutes: number) => ipcRenderer.invoke('vault:setAutoExport', intervalMinutes),
  importAll: () => ipcRenderer.invoke('vault:importAll'),
  hasData: () => ipcRenderer.invoke('vault:hasData'),
  onVaultChange: (callback: (event: unknown) => void) => {
    ipcRenderer.on('vault:changed', (_, event) => callback(event))
  }
})

contextBridge.exposeInMainWorld('appHistory', {
  add: (entry: unknown) => ipcRenderer.invoke('history:add', entry),
  getAll: (limit?: number) => ipcRenderer.invoke('history:getAll', limit),
  getPage: (beforeTs: number, limit?: number) => ipcRenderer.invoke('history:getPage', beforeTs, limit),
  delete: (id: string) => ipcRenderer.invoke('history:delete', id),
  clear: () => ipcRenderer.invoke('history:clear'),
})

contextBridge.exposeInMainWorld('workspaces', {
  list: () => ipcRenderer.invoke('workspaces:list'),
  save: (name: string, layoutJson: string, stateJson: string) =>
    ipcRenderer.invoke('workspaces:save', name, layoutJson, stateJson),
  load: (id: string) => ipcRenderer.invoke('workspaces:load', id),
  delete: (id: string) => ipcRenderer.invoke('workspaces:delete', id),
  rename: (id: string, name: string) => ipcRenderer.invoke('workspaces:rename', id, name),
})

contextBridge.exposeInMainWorld('eSwordImport', {
  detectFolder: () => ipcRenderer.invoke('eSwordImport:detectFolder'),
  start: (opts: unknown) => ipcRenderer.invoke('eSwordImport:start', opts),
  importSelected: (notes: unknown[]) => ipcRenderer.invoke('eSwordImport:importSelected', notes),
  cancel: () => ipcRenderer.invoke('eSwordImport:cancel'),
  onProgress: (cb: (p: unknown) => void) => {
    ipcRenderer.removeAllListeners('eSwordImport:progress')
    ipcRenderer.on('eSwordImport:progress', (_, p) => cb(p))
  },
})

// Expose platform so renderer can adapt window chrome without Node access
contextBridge.exposeInMainWorld('__berean_platform', process.platform)

// Window controls for the custom frameless title bar (Windows), and reused by
// the note editor's Focus-mode floating toolbar (any platform) for its own
// close/minimize/maximize buttons + hiding the native macOS traffic lights.
contextBridge.exposeInMainWorld('windowControls', {
  minimize:  () => ipcRenderer.send('window:minimize'),
  maximize:  () => ipcRenderer.send('window:maximize'),
  close:     () => ipcRenderer.send('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onMaximizeChange: (cb: (v: boolean) => void) => {
    ipcRenderer.removeAllListeners('window:maximizeChanged')
    ipcRenderer.on('window:maximizeChanged', (_, v) => cb(v as boolean))
  },
  setButtonsVisible: (visible: boolean) => ipcRenderer.send('window:setButtonsVisible', visible),
})

contextBridge.exposeInMainWorld('bgImport', {
  start: (credentials: { username: string; password: string }) =>
    ipcRenderer.invoke('bgImport:start', credentials),
  importSelected: (notes: unknown[]) =>
    ipcRenderer.invoke('bgImport:importSelected', notes),
  cancel: () => ipcRenderer.invoke('bgImport:cancel'),
  clearSession: () => ipcRenderer.invoke('bgImport:clearSession'),
  debugOpen: () => ipcRenderer.invoke('bgImport:debugOpen'),
  onProgress: (cb: (p: unknown) => void) => {
    ipcRenderer.removeAllListeners('bgImport:progress')
    ipcRenderer.on('bgImport:progress', (_, p) => cb(p))
  },
})
