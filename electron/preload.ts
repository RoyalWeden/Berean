import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('bible', {
  queryChapter: (bookId: string, chapter: number, textId?: string) =>
    ipcRenderer.invoke('bible:queryChapter', bookId, chapter, textId),
  queryVerse: (bookId: string, chapter: number, verse: number, textId?: string) =>
    ipcRenderer.invoke('bible:queryVerse', bookId, chapter, verse, textId),
  searchText: (query: string, textId?: string) =>
    ipcRenderer.invoke('bible:searchText', query, textId),
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
  getVerseNotes: (verseRef: string) =>
    ipcRenderer.invoke('notes:getByVerse', verseRef),
  getNote: (id: string) => ipcRenderer.invoke('notes:getOne', id),
  getChapterNotes: (bookId: string, chapter: number) =>
    ipcRenderer.invoke('notes:getByChapter', bookId, chapter),
  getChapterCounts: (bookId: string, chapter: number) =>
    ipcRenderer.invoke('notes:getChapterCounts', bookId, chapter),
  searchNotes: (query: string, limit?: number) =>
    ipcRenderer.invoke('notes:search', query, limit),
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

contextBridge.exposeInMainWorld('app', {
  onCloseTab: (cb: () => void) => {
    ipcRenderer.removeAllListeners('app:closeTab')
    ipcRenderer.on('app:closeTab', (_evt) => {
      console.log('[preload] app:closeTab IPC received')
      cb()
    })
  },
  onOpenSettings: (cb: () => void) => {
    ipcRenderer.removeAllListeners('app:openSettings')
    ipcRenderer.on('app:openSettings', cb)
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
  openFloatingTab: (type: string, state: unknown) => ipcRenderer.invoke('app:openFloatingTab', type, state),
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
  onUpdateStatus: (cb: (status: unknown) => void) => {
    ipcRenderer.removeAllListeners('app:updateStatus')
    ipcRenderer.on('app:updateStatus', (_, status) => cb(status))
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
  status: () => ipcRenderer.invoke('crossrefs:status'),
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
})

contextBridge.exposeInMainWorld('vault', {
  syncNote: (noteId: string) => ipcRenderer.invoke('vault:syncNote', noteId),
  readVaultNote: (title: string) => ipcRenderer.invoke('vault:readNote', title),
  watchVault: () => ipcRenderer.invoke('vault:watch'),
  reconcile: () => ipcRenderer.invoke('vault:reconcile'),
  onVaultChange: (callback: (event: unknown) => void) => {
    ipcRenderer.on('vault:changed', (_, event) => callback(event))
  }
})

contextBridge.exposeInMainWorld('appHistory', {
  add: (entry: unknown) => ipcRenderer.invoke('history:add', entry),
  getAll: () => ipcRenderer.invoke('history:getAll'),
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
