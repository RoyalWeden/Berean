import type { Services } from '../services'
import { iosServiceContext } from './services'

/**
 * Installs the `window.<namespace>` objects the renderer already calls (typed in
 * src/types/electron.d.ts, implemented on desktop by electron/preload.ts over IPC) — backed
 * in-process by the shared services. This is the iOS counterpart of the preload script
 * (docs/mobile/architecture.md §2).
 *
 * Only the namespaces that have meaning on the phone are installed. Desktop-only ones
 * (`vault`, `bgImport`, `eSwordImport`, `ttsModel`, `ttsAudioCache`, `viewer`, `windowControls`,
 * `crossWindow`) are deliberately absent; the mobile shell consults `platform.capabilities`
 * (Phase 10) and never renders the affordances that would call them.
 *
 * Type-safety: each object is annotated with the corresponding `Window[...]` type, so any drift
 * between the shared service surface and the renderer contract fails `npm run typecheck`.
 */
type Fn = (...args: never[]) => unknown
/** Registers `cb` for `data:changed` events of the given entities; mirrors preload's on* helpers
 *  (which replace the previous listener rather than stacking — same here). */
function makeChangeSubscription(entities: (e: string) => boolean): (cb: (scope?: string) => void) => void {
  let off: (() => void) | null = null
  return (cb) => {
    off?.()
    off = iosServiceContext().events.on('data:changed', (c) => { if (entities(c.entity)) cb(c.scope) })
  }
}

export function installIosBridge(s: Services): void {
  const bible: Window['bible'] = {
    queryChapter: (bookId, chapter, textId) => s.bible.queryChapter(bookId, chapter, textId) as ReturnType<Window['bible']['queryChapter']>,
    queryVerse: (bookId, chapter, verse, textId) => s.bible.queryVerse(bookId, chapter, verse, textId) as ReturnType<Window['bible']['queryVerse']>,
    queryVerses: (refs, textId) => s.bible.queryVerses(refs, textId),
    // The declared SearchResult[] type is aspirational on desktop too: the IPC handler has always
    // returned raw verse rows and every consumer re-casts (see ScriptureSearchView's RawResult).
    searchText: (query, textId, wordMode, bookIds) => s.bible.searchText(query, textId, wordMode, bookIds) as unknown as ReturnType<Window['bible']['searchText']>,
    getBooks: (textId) => s.bible.getBooks(textId) as ReturnType<Window['bible']['getBooks']>,
  }

  const onNotesChanged = makeChangeSubscription((e) => e === 'note' || e === 'note_folder' || e === 'note_version')
  const notes: Window['notes'] = {
    createNote: (data) => s.notes.create(data as Parameters<Services['notes']['create']>[0]) as ReturnType<Window['notes']['createNote']>,
    updateNote: (id, data) => s.notes.update(id, data as Parameters<Services['notes']['update']>[1]),
    deleteNote: (id) => s.notes.delete(id),
    restoreNote: (id) => s.notes.restore(id),
    listTrash: () => s.notes.listTrash() as ReturnType<Window['notes']['listTrash']>,
    purgeTrashItem: (id) => s.notes.purgeTrashItem(id),
    emptyTrash: () => s.notes.emptyTrash(),
    deleteAllNotes: () => s.notes.deleteAll(),
    deleteByTag: (tag) => s.notes.deleteByTag(tag),
    countTagRefs: (name) => s.notes.countTagRefs(name),
    getNotes: (limit, offset) => s.notes.getAll(limit, offset) as ReturnType<Window['notes']['getNotes']>,
    getVerseNotes: (verseRef, textId) => s.notes.getByVerse(verseRef, textId) as ReturnType<Window['notes']['getVerseNotes']>,
    getNote: (id) => s.notes.getOne(id) as ReturnType<Window['notes']['getNote']>,
    getChapterNotes: (bookId, chapter, textId) => s.notes.getByChapter(bookId, chapter, textId) as ReturnType<Window['notes']['getChapterNotes']>,
    getChapterCounts: (bookId, chapter, textId) => s.notes.getChapterCounts(bookId, chapter, textId),
    searchNotes: (query, limit, mode) => s.notes.search(query, limit, mode) as ReturnType<Window['notes']['searchNotes']>,
    setNoteFolder: (noteId, folderId) => s.notes.setFolder(noteId, folderId),
    setNotePinned: (noteId, pinned) => s.notes.setPinned(noteId, pinned),
    createNoteVersion: (noteId, title, content, kind) => s.notes.createVersion(noteId, title, content, kind),
    getNoteVersions: (noteId) => s.notes.getVersions(noteId) as ReturnType<Window['notes']['getNoteVersions']>,
    restoreNoteVersion: (noteId, versionId) => s.notes.restoreVersion(noteId, versionId) as ReturnType<Window['notes']['restoreNoteVersion']>,
    getFolders: () => s.notes.folderList() as ReturnType<Window['notes']['getFolders']>,
    createFolder: (name, parentId) => s.notes.folderCreate(name, parentId ?? null),
    renameFolder: (id, name) => s.notes.folderRename(id, name),
    deleteFolder: (id) => s.notes.folderDelete(id),
    deleteFolderDeep: async (id) => { const { trashedNotes: _t, ...r } = await s.notes.folderDeleteDeep(id); return r },
    setFolderParent: (id, parentId) => s.notes.folderSetParent(id, parentId),
    listIdioms: () => s.notes.listIdioms(),
    getCollapsedHeadings: (noteId) => s.notes.getCollapsedHeadings(noteId),
    setHeadingCollapsed: (noteId, headingKey, collapsed) => s.notes.setHeadingCollapsed(noteId, headingKey, collapsed),
    getCollapsedThreads: (noteId) => s.notes.getCollapsedThreads(noteId),
    setThreadCollapsed: (noteId, threadId, collapsed) => s.notes.setThreadCollapsed(noteId, threadId, collapsed),
    onChanged: (cb) => onNotesChanged(() => cb()),
  }

  const highlights: Window['highlights'] = {
    getChapter: (bookId, chapter, textId) => s.highlights.getChapter(bookId, chapter, textId),
    toggle: (params) => s.highlights.toggle(params),
    remove: (bookId, chapter, verseNum, textId) => s.highlights.remove(bookId, chapter, verseNum, textId),
  }

  const verseTags: Window['verseTags'] = {
    list: () => s.verseTags.list(),
    create: (name, color) => s.verseTags.create(name, color),
    rename: (id, name) => s.verseTags.rename(id, name),
    setColor: (id, color) => s.verseTags.setColor(id, color),
    setColorSlot: (id, slot) => s.verseTags.setColorSlot(id, slot),
    reorder: (ids) => s.verseTags.reorder(ids),
    merge: (fromId, intoId) => s.verseTags.merge(fromId, intoId),
    delete: (id, force) => s.verseTags.delete(id, force) as ReturnType<Window['verseTags']['delete']>,
    addMembers: (args) => s.verseTags.addMembers(args),
    removeMember: (memberId) => s.verseTags.removeMember(memberId),
    updateMemberRanges: (memberId, ranges, label, kind) => s.verseTags.updateMemberRanges(memberId, ranges, label, kind),
    getForChapter: (bookId, chapter) => s.verseTags.getForChapter(bookId, chapter),
    getMembers: (tagIds) => s.verseTags.getMembers(tagIds),
  }

  const tagGraph: Window['tagGraph'] = {
    getGraph: () => s.tagGraph.getGraph(),
    createEdge: (source, target) => s.tagGraph.createEdge(source, target) as ReturnType<Window['tagGraph']['createEdge']>,
    updateEdge: (id, patch) => s.tagGraph.updateEdge(id, patch),
    deleteEdge: (id) => s.tagGraph.deleteEdge(id),
    setTagPosition: (tagId, x, y, pinned) => s.tagGraph.setTagPosition(tagId, x, y, pinned),
  }

  const lexicon: Window['lexicon'] = {
    getEntry: (num) => s.lexicon.getEntry(num) as ReturnType<Window['lexicon']['getEntry']>,
    getOccurrences: (num, quickLimit) => s.lexicon.getOccurrences(num, undefined, quickLimit) as ReturnType<Window['lexicon']['getOccurrences']>,
    getRelated: (num) => s.lexicon.getRelated(num),
    search: (query, lang) => s.lexicon.search(query, lang) as ReturnType<Window['lexicon']['search']>,
  }

  const settings: Window['settings'] = {
    get: (key) => s.settings.get(key),
    set: (key, value) => s.settings.set(key, value),
    getAll: () => s.settings.getAll(),
  }

  const crossrefs: Window['crossrefs'] = {
    getForVerse: (bookId, chapter, verse, textId) => s.crossrefs.getForVerse(bookId, chapter, verse, textId),
    getTSKeForVerse: (bookId, chapter, verse, textId) => s.crossrefs.getTSKeForVerse(bookId, chapter, verse, textId),
    getForChapter: (bookId, chapter, textId) => s.crossrefs.getForChapter(bookId, chapter, textId),
    getTSKeForChapter: (bookId, chapter, textId) => s.crossrefs.getTSKeForChapter(bookId, chapter, textId),
    getHermasTaylorChapter: (bookId, chapter) => s.crossrefs.getHermasTaylorChapter(bookId, chapter),
    status: () => s.crossrefs.status(),
  }

  const appHistory: Window['appHistory'] = {
    add: (entry, maxEntries) => s.history.add(entry, maxEntries),
    getAll: (limit) => s.history.getAll(limit) as ReturnType<Window['appHistory']['getAll']>,
    getPage: (beforeTs, limit) => s.history.getPage(beforeTs, limit) as ReturnType<Window['appHistory']['getPage']>,
    delete: (id) => s.history.delete(id),
    clear: () => s.history.clear(),
  }

  const workspaces: Window['workspaces'] = {
    list: () => s.workspaces.list(),
    save: (name, layoutJson, stateJson) => s.workspaces.save(name, layoutJson, stateJson),
    load: (id) => s.workspaces.load(id),
    delete: (id) => s.workspaces.delete(id),
    rename: (id, name) => s.workspaces.rename(id, name),
  }

  const playlists: Window['playlists'] = {
    list: () => s.playlists.list(),
    save: (name, items, existingId) => s.playlists.save(name, items, existingId),
    rename: (id, name) => s.playlists.rename(id, name),
    delete: (id) => s.playlists.delete(id),
  }

  const sessions: Window['sessions'] = {
    hasAny: () => s.sessions.hasAny(),
    listSessions: () => s.sessions.listSessions(),
    listTabs: (sessionId) => s.sessions.listTabs(sessionId),
    listArchivedGroups: () => s.sessions.listArchivedGroups(),
    getLocalState: (sessionId) => s.sessions.getLocalState(sessionId),
    setLocalState: (sessionId, activeTab) => s.sessions.setLocalState(sessionId, activeTab),
    applySnapshot: (snap) => s.sessions.applySnapshot(snap),
    upsertSession: (row) => s.sessions.upsertSession(row),
    upsertTab: (row) => s.sessions.upsertTab(row),
    deleteSession: (id) => s.sessions.deleteSession(id),
    deleteTab: (id) => s.sessions.deleteTab(id),
  }

  Object.assign(window, { bible, notes, highlights, verseTags, tagGraph, lexicon, settings, crossrefs, appHistory, workspaces, playlists, sessions })
  ;(window as unknown as { __berean_platform: string }).__berean_platform = 'ios'
}

// Keep the helper type referenced so a future namespace can reuse it without an unused-type lint.
export type { Fn as _BridgeFn }
