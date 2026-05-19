import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('bible', {
  queryChapter: (bookId: string, chapter: number) =>
    ipcRenderer.invoke('bible:queryChapter', bookId, chapter),
  queryVerse: (bookId: string, chapter: number, verse: number) =>
    ipcRenderer.invoke('bible:queryVerse', bookId, chapter, verse),
  searchText: (query: string, textId?: string) =>
    ipcRenderer.invoke('bible:searchText', query, textId),
  getBooks: (textId?: string) =>
    ipcRenderer.invoke('bible:getBooks', textId)
})

contextBridge.exposeInMainWorld('notes', {
  createNote: (data: unknown) => ipcRenderer.invoke('notes:create', data),
  updateNote: (id: string, data: unknown) => ipcRenderer.invoke('notes:update', id, data),
  deleteNote: (id: string) => ipcRenderer.invoke('notes:delete', id),
  getNotes: (limit?: number, offset?: number) =>
    ipcRenderer.invoke('notes:getAll', limit, offset),
  getVerseNotes: (verseRef: string) =>
    ipcRenderer.invoke('notes:getByVerse', verseRef),
  getNote: (id: string) => ipcRenderer.invoke('notes:getOne', id)
})

contextBridge.exposeInMainWorld('lexicon', {
  getEntry: (strongsNum: string) => ipcRenderer.invoke('lexicon:getEntry', strongsNum),
  getOccurrences: (strongsNum: string) =>
    ipcRenderer.invoke('lexicon:getOccurrences', strongsNum)
})

contextBridge.exposeInMainWorld('settings', {
  get: (key: string) => ipcRenderer.invoke('settings:get', key),
  set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),
  getAll: () => ipcRenderer.invoke('settings:getAll')
})

contextBridge.exposeInMainWorld('vault', {
  syncNote: (noteId: string) => ipcRenderer.invoke('vault:syncNote', noteId),
  readVaultNote: (title: string) => ipcRenderer.invoke('vault:readNote', title),
  watchVault: () => ipcRenderer.invoke('vault:watch'),
  onVaultChange: (callback: (event: unknown) => void) => {
    ipcRenderer.on('vault:changed', (_, event) => callback(event))
  }
})
