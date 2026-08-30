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
  // Trash
  restoreNote: (id: string) => ipcRenderer.invoke('notes:restore', id),
  listTrash: () => ipcRenderer.invoke('notes:listTrash'),
  purgeTrashItem: (id: string) => ipcRenderer.invoke('notes:purgeTrashItem', id),
  emptyTrash: () => ipcRenderer.invoke('notes:emptyTrash'),
  deleteAllNotes: () => ipcRenderer.invoke('notes:deleteAll'),
  deleteByTag: (tag: string) => ipcRenderer.invoke('notes:deleteByTag', tag),
  countTagRefs: (name: string) => ipcRenderer.invoke('notes:countTagRefs', name),
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
  setNotePinned: (noteId: string, pinned: boolean) =>
    ipcRenderer.invoke('notes:setPinned', noteId, pinned),
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
  // Heading collapse persistence (round 12 item 6)
  getCollapsedHeadings: (noteId: string) => ipcRenderer.invoke('notes:getCollapsedHeadings', noteId),
  setHeadingCollapsed: (noteId: string, headingKey: string, collapsed: boolean) =>
    ipcRenderer.invoke('notes:setHeadingCollapsed', noteId, headingKey, collapsed),
  // Thread collapse persistence
  getCollapsedThreads: (noteId: string) => ipcRenderer.invoke('notes:getCollapsedThreads', noteId),
  setThreadCollapsed: (noteId: string, threadId: string, collapsed: boolean) =>
    ipcRenderer.invoke('notes:setThreadCollapsed', noteId, threadId, collapsed),
  // Cross-window sync: main process broadcasts this to every OTHER window whenever
  // any note mutation succeeds, so each renderer's own noteChangeToken can bump.
  onChanged: (cb: () => void) => {
    ipcRenderer.removeAllListeners('notes:changed')
    ipcRenderer.on('notes:changed', () => cb())
  },
})

contextBridge.exposeInMainWorld('lexicon', {
  getEntry: (strongsNum: string) => ipcRenderer.invoke('lexicon:getEntry', strongsNum),
  getOccurrences: (strongsNum: string, quickLimit?: number) =>
    ipcRenderer.invoke('lexicon:getOccurrences', strongsNum, quickLimit),
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

contextBridge.exposeInMainWorld('verseTags', {
  list: () => ipcRenderer.invoke('verseTags:list'),
  create: (name: string, color?: string | null) => ipcRenderer.invoke('verseTags:create', name, color),
  rename: (id: string, name: string) => ipcRenderer.invoke('verseTags:rename', id, name),
  setColor: (id: string, color: string | null) => ipcRenderer.invoke('verseTags:setColor', id, color),
  reorder: (orderedIds: string[]) => ipcRenderer.invoke('verseTags:reorder', orderedIds),
  merge: (fromId: string, intoId: string) => ipcRenderer.invoke('verseTags:merge', fromId, intoId),
  delete: (id: string, force?: boolean) => ipcRenderer.invoke('verseTags:delete', id, force),
  addMembers: (args: unknown) => ipcRenderer.invoke('verseTags:addMembers', args),
  removeMember: (memberId: string) => ipcRenderer.invoke('verseTags:removeMember', memberId),
  updateMemberRanges: (memberId: string, ranges: unknown, label: string) =>
    ipcRenderer.invoke('verseTags:updateMemberRanges', memberId, ranges, label),
  getForChapter: (bookId: string, chapter: number) => ipcRenderer.invoke('verseTags:getForChapter', bookId, chapter),
  getMembers: (tagIds: string[]) => ipcRenderer.invoke('verseTags:getMembers', tagIds),
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
  openStudyTrailWindow: (trailSessionId?: string) => ipcRenderer.invoke('app:openStudyTrailWindow', trailSessionId),
  closeStudyTrailWindow: () => ipcRenderer.invoke('app:closeStudyTrailWindow'),
  isStudyTrailWindowOpen: () => ipcRenderer.invoke('app:isStudyTrailWindowOpen'),
  onFocusTrailSession: (cb: (trailSessionId: string) => void) => {
    ipcRenderer.removeAllListeners('studyTrail:focusSession')
    ipcRenderer.on('studyTrail:focusSession', (_e, id: string) => cb(id))
  },
  // Study Trail (or any secondary window) → main window navigation. See main.ts's
  // app:navigateMainToRef handler comment for why this round-trips through the main process
  // instead of a direct store call.
  navigateMainToRef: (payload: unknown) => ipcRenderer.invoke('app:navigateMainToRef', payload),
  getActiveScriptureRef: () => ipcRenderer.invoke('app:getActiveScriptureRef'),
  onRequestActiveScriptureRef: (cb: () => { bookId: string; chapter: number } | null) => {
    ipcRenderer.removeAllListeners('app:requestActiveScriptureRef')
    ipcRenderer.on('app:requestActiveScriptureRef', () => {
      ipcRenderer.send('app:activeScriptureRefReply', cb())
    })
  },
  onNavigateToRef: (cb: (payload: unknown) => void) => {
    ipcRenderer.removeAllListeners('app:navigateToRef')
    ipcRenderer.on('app:navigateToRef', (_e, payload) => cb(payload))
  },
  // The main window and the Study Trail window are separate renderer processes, each with its
  // OWN in-memory useStudyTrailStore instance — starting/pausing/resuming a session in one
  // window's UI never reached the other's local store, so the main window's recorder always
  // saw currentTrailSessionId: null and silently never recorded anything, no matter which
  // window the session was actually started from. This is the cross-window broadcast that
  // closes that gap (see src/store/studyTrailSlice.ts's installStudyTrailStateSync).
  broadcastStudyTrailState: (state: unknown) => ipcRenderer.send('app:broadcastStudyTrailState', state),
  onStudyTrailStateChanged: (cb: (state: unknown) => void) => {
    ipcRenderer.removeAllListeners('app:studyTrailStateChanged')
    ipcRenderer.on('app:studyTrailStateChanged', (_e, state) => cb(state))
  },
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
  // Print / export a rendered note (full HTML document string). `pageSize` is one of
  // Electron's own accepted pageSize strings ('Letter'|'A4'|'Legal'|...) — see
  // PAPER_SIZE_ELECTRON in notePreviewRender.ts, the single source of truth for that mapping.
  printNote: (html: string, pageSize?: string) => ipcRenderer.invoke('app:printNote', html, pageSize),
  exportNotePDF: (html: string, suggestedName: string, downloadLocation?: string, pageSize?: string) => ipcRenderer.invoke('app:exportNotePDF', html, suggestedName, downloadLocation ?? '', pageSize),
  // Real PDF bytes for the on-screen preview (rendered via pdf.js in PrintPreviewModal) —
  // the exact same generation path as exportNotePDF, so the preview is never an approximation.
  renderPreviewPDF: (html: string, pageSize?: string) => ipcRenderer.invoke('app:renderPreviewPDF', html, pageSize),
  // Cross-window tab sync
  broadcastTabState: (payload: unknown) => ipcRenderer.send('app:broadcastTabState', payload),
  onTabStateUpdate: (cb: (payload: unknown) => void) => {
    ipcRenderer.removeAllListeners('app:tabStateUpdate')
    ipcRenderer.on('app:tabStateUpdate', (_, payload) => cb(payload))
  },
  // Cross-window Read Aloud (TTS) playback sync — mirrors broadcastTabState/onTabStateUpdate
  // exactly. Throttled to verse-level granularity by the sender (useTTSPlayback.ts), not here.
  broadcastAudioState: (payload: unknown) => ipcRenderer.send('app:broadcastAudioState', payload),
  onAudioStateUpdate: (cb: (payload: unknown) => void) => {
    ipcRenderer.removeAllListeners('app:audioStateUpdate')
    ipcRenderer.on('app:audioStateUpdate', (_, payload) => cb(payload))
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
  getForVerse: (bookId: string, chapter: number, verse: number, textId?: string) =>
    ipcRenderer.invoke('crossrefs:getForVerse', bookId, chapter, verse, textId),
  getTSKeForVerse: (bookId: string, chapter: number, verse: number, textId?: string) =>
    ipcRenderer.invoke('crossrefs:getTSKeForVerse', bookId, chapter, verse, textId),
  getForChapter: (bookId: string, chapter: number, textId?: string) =>
    ipcRenderer.invoke('crossrefs:getForChapter', bookId, chapter, textId),
  getTSKeForChapter: (bookId: string, chapter: number, textId?: string) =>
    ipcRenderer.invoke('crossrefs:getTSKeForChapter', bookId, chapter, textId),
  getHermasTaylorChapter: (bookId: string, chapter: number) =>
    ipcRenderer.invoke('crossrefs:getHermasTaylorChapter', bookId, chapter),
  status: () => ipcRenderer.invoke('crossrefs:status'),
})

contextBridge.exposeInMainWorld('aiLookup', {
  checkAvailable: () => ipcRenderer.invoke('ailookup:checkAvailable'),
  unloadModel: () => ipcRenderer.invoke('ailookup:unloadModel'),
  query: (question: string, opts: { commentary: boolean; agentic?: boolean; model?: string; textId?: string; wordReplacerRules?: Array<{ queries: string[]; replacement: string }>; history?: Array<{ role: 'user' | 'assistant'; content: string }>; tabContext?: { type: 'bible' | 'note' | 'lexicon' | 'youtube'; bookId?: string; chapter?: number; translation?: string; noteId?: string; strongsNum?: string; videoId?: string } }) =>
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
  // Speed round: fires once retrieval is done, before Commentary (if on) runs its own slower
  // Ollama call — same request/response `query()` call still resolves with the final result as
  // normal afterward. See AiLookupAPI['onPartial'] in src/types/electron.d.ts for the full why.
  onPartial: (cb: (partial: unknown) => void) => {
    ipcRenderer.removeAllListeners('ailookup:partial')
    ipcRenderer.on('ailookup:partial', (_, partial) => cb(partial))
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
  add: (entry: unknown, maxEntries?: number) => ipcRenderer.invoke('history:add', entry, maxEntries),
  getAll: (limit?: number) => ipcRenderer.invoke('history:getAll', limit),
  getPage: (beforeTs: number, limit?: number) => ipcRenderer.invoke('history:getPage', beforeTs, limit),
  delete: (id: string) => ipcRenderer.invoke('history:delete', id),
  clear: () => ipcRenderer.invoke('history:clear'),
})

contextBridge.exposeInMainWorld('studyTrail', {
  startSession: (name: string) => ipcRenderer.invoke('studyTrail:startSession', name),
  pauseSession: (trailSessionId: string) => ipcRenderer.invoke('studyTrail:pauseSession', trailSessionId),
  resumeSession: (trailSessionId: string) => ipcRenderer.invoke('studyTrail:resumeSession', trailSessionId),
  renameSession: (trailSessionId: string, name: string) => ipcRenderer.invoke('studyTrail:renameSession', trailSessionId, name),
  endSession: (trailSessionId: string) => ipcRenderer.invoke('studyTrail:endSession', trailSessionId),
  deleteSession: (trailSessionId: string) => ipcRenderer.invoke('studyTrail:deleteSession', trailSessionId),
  deleteSessions: (trailSessionIds: string[]) => ipcRenderer.invoke('studyTrail:deleteSessions', trailSessionIds),
  listSessions: () => ipcRenderer.invoke('studyTrail:listSessions'),
  listAllSessions: () => ipcRenderer.invoke('studyTrail:listAllSessions'),
  ensureLooseSession: () => ipcRenderer.invoke('studyTrail:ensureLooseSession'),
  getSession: (trailSessionId: string) => ipcRenderer.invoke('studyTrail:getSession', trailSessionId),
  addNode: (node: unknown) => ipcRenderer.invoke('studyTrail:addNode', node),
  reopenNode: (nodeId: string, at?: number) => ipcRenderer.invoke('studyTrail:reopenNode', nodeId, at),
  promoteRevisit: (args: unknown) => ipcRenderer.invoke('studyTrail:promoteRevisit', args),
  updateNodeSubnote: (nodeId: string, subnote: string) => ipcRenderer.invoke('studyTrail:updateNodeSubnote', nodeId, subnote),
  setNodeTopicBreak: (nodeId: string, isTopicBreak: boolean) => ipcRenderer.invoke('studyTrail:setNodeTopicBreak', nodeId, isTopicBreak),
  deleteNode: (nodeId: string) => ipcRenderer.invoke('studyTrail:deleteNode', nodeId),
  moveNodes: (nodeIds: string[], targetSessionId: string) => ipcRenderer.invoke('studyTrail:moveNodes', nodeIds, targetSessionId),
  addConnection: (conn: unknown) => ipcRenderer.invoke('studyTrail:addConnection', conn),
  deleteConnection: (connectionId: string) => ipcRenderer.invoke('studyTrail:deleteConnection', connectionId),
  markGlance: (connectionId: string) => ipcRenderer.invoke('studyTrail:markGlance', connectionId),
  updateConnectionReason: (connectionId: string, update: unknown) => ipcRenderer.invoke('studyTrail:updateConnectionReason', connectionId, update),
  dismissPrompt: (connectionId: string) => ipcRenderer.invoke('studyTrail:dismissPrompt', connectionId),
  clearConnectionNote: (connectionId: string) => ipcRenderer.invoke('studyTrail:clearConnectionNote', connectionId),
  updateRecap: (trailSessionId: string, recapText: string) => ipcRenderer.invoke('studyTrail:updateRecap', trailSessionId, recapText),
  getBacklinks: (bookId: string, chapter: number, excludeSessionId: string) => ipcRenderer.invoke('studyTrail:getBacklinks', bookId, chapter, excludeSessionId),
  search: (query: string) => ipcRenderer.invoke('studyTrail:search', query),
  // Push-based live update — see broadcastDataChanged's comment in electron/ipc/studyTrail.ts.
  // Fires in every window immediately after any node/connection/session write, so the Study
  // Trail window can refetch right away instead of waiting on its own poll interval. Unlike
  // this file's other on*Changed helpers, more than one call site in the SAME window needs its
  // own independent listener at once (the session-list poll and the selected-session poll both
  // react to this) — `removeAllListeners` would silently clobber whichever registered first, so
  // this adds/removes its own listener specifically and hands back an unsubscribe function.
  onDataChanged: (cb: (trailSessionId: string | undefined) => void) => {
    const listener = (_e: unknown, trailSessionId: string | undefined) => cb(trailSessionId)
    ipcRenderer.on('studyTrail:dataChanged', listener)
    return () => ipcRenderer.removeListener('studyTrail:dataChanged', listener)
  },
})

contextBridge.exposeInMainWorld('workspaces', {
  list: () => ipcRenderer.invoke('workspaces:list'),
  save: (name: string, layoutJson: string, stateJson: string) =>
    ipcRenderer.invoke('workspaces:save', name, layoutJson, stateJson),
  load: (id: string) => ipcRenderer.invoke('workspaces:load', id),
  delete: (id: string) => ipcRenderer.invoke('workspaces:delete', id),
  rename: (id: string, name: string) => ipcRenderer.invoke('workspaces:rename', id, name),
})

contextBridge.exposeInMainWorld('playlists', {
  list: () => ipcRenderer.invoke('playlists:list'),
  save: (name: string, items: unknown[], existingId?: string) =>
    ipcRenderer.invoke('playlists:save', name, items, existingId),
  rename: (id: string, name: string) => ipcRenderer.invoke('playlists:rename', id, name),
  delete: (id: string) => ipcRenderer.invoke('playlists:delete', id),
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

contextBridge.exposeInMainWorld('ttsModel', {
  getStatus: () => ipcRenderer.invoke('ttsModel:getStatus'),
  download: () => ipcRenderer.invoke('ttsModel:download'),
  downloadRuntimeFile: () => ipcRenderer.invoke('ttsModel:downloadRuntimeFile'),
  cancelDownload: () => ipcRenderer.invoke('ttsModel:cancelDownload'),
  clearModelCache: () => ipcRenderer.invoke('ttsModel:clearModelCache'),
  getModelId: () => ipcRenderer.invoke('ttsModel:getModelId'),
  onDownloadProgress: (cb: (p: { receivedBytes: number; totalBytes: number }) => void) => {
    ipcRenderer.removeAllListeners('ttsModel:downloadProgress')
    ipcRenderer.on('ttsModel:downloadProgress', (_, p) => cb(p))
  },
  onDownloadVerifying: (cb: () => void) => {
    ipcRenderer.removeAllListeners('ttsModel:downloadVerifying')
    ipcRenderer.on('ttsModel:downloadVerifying', () => cb())
  },
})

contextBridge.exposeInMainWorld('ttsAudioCache', {
  get: (key: string) => ipcRenderer.invoke('ttsAudioCache:get', key),
  put: (key: string, data: ArrayBuffer) => ipcRenderer.invoke('ttsAudioCache:put', key, data),
  clear: () => ipcRenderer.invoke('ttsAudioCache:clear'),
  stats: () => ipcRenderer.invoke('ttsAudioCache:stats'),
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
