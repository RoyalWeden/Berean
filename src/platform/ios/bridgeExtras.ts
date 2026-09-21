import { Browser } from '@capacitor/browser'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import type { Services } from '../services'
import { iosServiceContext } from './services'
import type { UpdateStatus } from '../../types/electron'

/**
 * The remaining `window.*` namespaces for the phone (installed next to bridge.ts's):
 *
 *  - `app`        the desktop AppAPI is mostly multi-window / menu / updater plumbing. The
 *                 methods shared components actually call get real iOS behaviour
 *                 (`openExternal` → SFSafariViewController, `getVersion`, `isDev`, theme/accent
 *                 stubs, `printNote`/`exportNotePDF` → share sheet later); everything that only
 *                 makes sense with a second window resolves harmlessly and says so once in the
 *                 console, so a hosted desktop panel never throws on the phone.
 *  - `studyTrail` the shared service, one-to-one with the preload.
 *  - `youtube`    the DB subset (stars, positions, history, transcripts) — channel fetching /
 *                 search need the network layer ported in Phase 17 and reject clearly until then.
 *  - `pdf`        rows from the shared service; bytes in the app container via Filesystem
 *                 (`Library/Berean/pdfs/<id>.pdf`), import through a file input (Phase 18 adds
 *                 the Files/Share Sheet routes), hash-matched to synced metadata like desktop.
 *  - `aiLookup`   not available on the phone (desktop-only local model); rejects clearly.
 */
const warned = new Set<string>()
function unavailable(name: string, why = 'not available on iPhone'): never {
  throw new Error(`${name}: ${why}`)
}
function noop(name: string): () => void {
  return () => { if (!warned.has(name)) { warned.add(name); console.info(`[ios-bridge] window.app.${name} is a no-op on iPhone`) } }
}

const PDF_DIR = 'Berean/pdfs'

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
function toBase64(bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes)
  let s = ''
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000))
  return btoa(s)
}
function fromBase64(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const u8 = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
  return u8.buffer
}
async function pdfExists(filename: string): Promise<boolean> {
  try { await Filesystem.stat({ path: `${PDF_DIR}/${filename}`, directory: Directory.Library }); return true } catch { return false }
}

/** Opens the system file picker for a PDF (a real user gesture is required on iOS). */
function pickPdfFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/pdf,.pdf'
    input.style.display = 'none'
    document.body.appendChild(input)
    let settled = false
    const done = (f: File | null) => { if (settled) return; settled = true; input.remove(); resolve(f) }
    input.addEventListener('change', () => done(input.files?.[0] ?? null))
    window.addEventListener('focus', () => setTimeout(() => done(input.files?.[0] ?? null), 800), { once: true })
    input.click()
  })
}

export function installIosBridgeExtras(s: Services, appVersion: string): void {
  const ctx = iosServiceContext()

  const app: Window['app'] = {
    onCloseTab: noop('onCloseTab'), onOpenSettings: noop('onOpenSettings'), onMenuAction: noop('onMenuAction'),
    openFolderDialog: async () => null,
    openExternal: async (url) => { await Browser.open({ url }) },
    isDev: async () => ctx.isDev,
    youTubeSignOut: async () => ({ success: false }),
    newWindow: async () => { noop('newWindow')() },
    moveWindowBy: noop('moveWindowBy'),
    openFloatingTab: async () => { noop('openFloatingTab')() },
    printNote: async () => { noop('printNote')(); return { success: false } },
    exportNotePDF: async () => { noop('exportNotePDF')(); return { success: false, canceled: true } },
    renderPreviewPDF: async () => unavailable('renderPreviewPDF'),
    broadcastTabState: noop('broadcastTabState'), onTabStateUpdate: noop('onTabStateUpdate'),
    broadcastAudioState: noop('broadcastAudioState'), onAudioStateUpdate: noop('onAudioStateUpdate'),
    returnFloatTab: noop('returnFloatTab'),
    getVersion: async () => appVersion,
    isMasBuild: async () => false,
    checkForUpdates: async () => { /* App Store / TestFlight handle updates */ },
    downloadUpdate: async () => {},
    installUpdate: noop('installUpdate'),
    onNativeThemeChanged: noop('onNativeThemeChanged'),
    getAccentColor: async () => null,
    onAccentColorChanged: noop('onAccentColorChanged'),
    getResourceMode: async () => 'normal',
    onResourceModeChanged: noop('onResourceModeChanged'),
    onUpdateStatus: (cb: (status: UpdateStatus) => void) => { cb({ status: 'mas' } as UpdateStatus) },
    openViewerWindow: async () => false, closeViewerWindow: async () => false, isViewerWindowOpen: async () => false,
    openStudyTrailWindow: async () => { window.dispatchEvent(new CustomEvent('berean:openStudyTrailPage')); return true },
    closeStudyTrailWindow: async () => false, isStudyTrailWindowOpen: async () => false,
    onFocusTrailSession: noop('onFocusTrailSession'),
    navigateMainToRef: async () => false,
    getActiveScriptureRef: async () => null,
    onRequestActiveScriptureRef: noop('onRequestActiveScriptureRef'),
    onNavigateToRef: noop('onNavigateToRef'),
    broadcastStudyTrailState: noop('broadcastStudyTrailState'), onStudyTrailStateChanged: noop('onStudyTrailStateChanged'),
    pushViewerContent: noop('pushViewerContent'), pushViewerSettings: noop('pushViewerSettings'), pushViewerOverlay: noop('pushViewerOverlay'),
    onViewerVisibleRegion: noop('onViewerVisibleRegion'), onViewerWindowClosed: noop('onViewerWindowClosed'), onViewerReady: noop('onViewerReady'),
    openVersePicker: noop('openVersePicker'), signalVersePickerReady: noop('signalVersePickerReady'), onVersePickerInit: noop('onVersePickerInit'),
    pushVersePickerSelectionChange: noop('pushVersePickerSelectionChange'), onVersePickerSelectionChanged: noop('onVersePickerSelectionChanged'),
    requestViewerVisibleRegion: noop('requestViewerVisibleRegion'),
  } as Window['app']

  const t = s.studyTrail
  const trailListeners = new Set<(id: string | undefined) => void>()
  ctx.events.on('data:changed', (c) => { if (c.entity.startsWith('trail_')) for (const cb of trailListeners) cb(c.scope) })
  const studyTrail: Window['studyTrail'] = {
    startSession: (name) => t.startSession(name), pauseSession: (id) => t.pauseSession(id), resumeSession: (id) => t.resumeSession(id),
    renameSession: (id, name) => t.renameSession(id, name), endSession: (id) => t.endSession(id), deleteSession: (id) => t.deleteSession(id),
    deleteSessions: (ids) => t.deleteSessions(ids), listSessions: () => t.listSessions(), listAllSessions: () => t.listAllSessions(),
    ensureLooseSession: () => t.ensureLooseSession(), getSession: (id) => t.getSession(id),
    addNode: (node) => t.addNode(node as Parameters<typeof t.addNode>[0]), reopenNode: (id, at) => t.reopenNode(id, at),
    promoteRevisit: (args) => t.promoteRevisit(args as Parameters<typeof t.promoteRevisit>[0]),
    updateNodeSubnote: (id, sub) => t.updateNodeSubnote(id, sub), setNodeTopicBreak: (id, v) => t.setNodeTopicBreak(id, v),
    deleteNode: (id) => t.deleteNode(id), moveNodes: (ids, target) => t.moveNodes(ids, target),
    addConnection: (conn) => t.addConnection(conn as Parameters<typeof t.addConnection>[0]), deleteConnection: (id) => t.deleteConnection(id),
    markGlance: (id) => t.markGlance(id), updateConnectionReason: (id, u) => t.updateConnectionReason(id, u as Parameters<typeof t.updateConnectionReason>[1]),
    dismissPrompt: (id) => t.dismissPrompt(id), clearConnectionNote: (id) => t.clearConnectionNote(id), updateRecap: (id, text) => t.updateRecap(id, text),
    getBacklinks: (b, c, ex) => t.getBacklinks(b, c, ex), search: (q, opts) => t.search(q, opts as Parameters<typeof t.search>[1]),
    listThreads: () => t.listThreads(), listSessionsPage: (cursor, limit) => t.listSessionsPage(cursor, limit),
    getCollapse: (scope) => t.getCollapse(scope), setCollapse: (scope, key, v) => t.setCollapse(scope, key, v),
    listNotes: (id) => t.listNotes(id), createNote: (input) => t.createNote(input as Parameters<typeof t.createNote>[0]),
    updateNote: (id, patch) => t.updateNote(id, patch as Parameters<typeof t.updateNote>[1]), deleteNote: (id) => t.deleteNote(id),
    listTags: () => t.listTags(), createTag: (name, color) => t.createTag(name, color), updateTag: (id, patch) => t.updateTag(id, patch as Parameters<typeof t.updateTag>[1]),
    deleteTag: (id) => t.deleteTag(id), setSessionTags: (id, tags) => t.setSessionTags(id, tags),
    mergeSessions: (into, from) => t.mergeSessions(into, from), splitSession: (id, at, name) => t.splitSession(id, at, name),
    reorderSessions: (ids) => t.reorderSessions(ids),
    onDataChanged: (cb) => { trailListeners.add(cb); return () => { trailListeners.delete(cb) } },
  } as Window['studyTrail']

  const y = s.youtube
  const youtube: Window['youtube'] = {
    loadAll: () => y.loadAll(),
    refresh: async () => unavailable('youtube.refresh', 'channel fetching arrives with the YouTube phase (Phase 17)'),
    fullSync: async () => unavailable('youtube.fullSync', 'channel fetching arrives with the YouTube phase (Phase 17)'),
    clearAll: async () => { await y.clearAll(); return { success: true } },
    toggleStar: (id: string) => y.toggleStar(id),
    savePosition: (id: string, sec: number, meta: { title: string; channelName: string; thumbnailUrl: string }) => y.savePosition(id, sec, meta),
    getPosition: (id: string) => y.getPosition(id),
    getWatchHistory: () => y.getWatchHistory(), removeFromHistory: (id: string) => y.removeFromHistory(id), clearWatchHistory: () => y.clearWatchHistory(),
    fetchDescription: async () => unavailable('youtube.fetchDescription', 'Phase 17'),
    searchVideos: async () => unavailable('youtube.searchVideos', 'Phase 17'),
    // Dev-only on every platform (R143): production never fetches transcripts.
    fetchTranscripts: async () => unavailable('youtube.fetchTranscripts', 'dev-only, and transcripts on the phone come from downloaded packs'),
    clearTranscripts: async () => unavailable('youtube.clearTranscripts', 'dev-only'),
    getTranscriptStatus: () => y.getTranscriptStatus(), getTranscript: (id: string) => y.getTranscript(id),
    searchTranscripts: (q: string, a?: number, b?: number) => y.searchTranscripts(q, a, b),
    buildSeed: async () => unavailable('youtube.buildSeed', 'dev-only'),
  } as unknown as Window['youtube']

  const p = s.pdf
  const withPresence = async <T extends { filename: string }>(row: T): Promise<T & { fileMissing: boolean }> => ({ ...row, fileMissing: !(await pdfExists(row.filename)) })
  const pdf: Window['pdf'] = {
    import: async () => {
      const file = await pickPdfFile()
      if (!file) return { canceled: true }
      const bytes = await file.arrayBuffer()
      const fileHash = await sha256Hex(bytes)
      const existing = await p.findByHash(fileHash)
      if (existing && !(await pdfExists(existing.filename))) {
        const filename = `${existing.id}.pdf`
        await Filesystem.writeFile({ path: `${PDF_DIR}/${filename}`, directory: Directory.Library, data: toBase64(bytes), recursive: true })
        const row = await p.attachFile(existing.id, filename, bytes.byteLength, fileHash)
        return { success: true, pdf: row ?? existing }
      }
      const id = ctx.uuid()
      const filename = `${id}.pdf`
      await Filesystem.writeFile({ path: `${PDF_DIR}/${filename}`, directory: Directory.Library, data: toBase64(bytes), recursive: true })
      const row = await p.insert({ id, title: file.name.replace(/\.pdf$/i, ''), filename, fileSize: bytes.byteLength, importedAt: ctx.now(), fileHash })
      return { success: true, pdf: row }
    },
    list: async () => Promise.all((await p.list()).map(withPresence)),
    get: async (id) => { const r = await p.get(id); return r ? withPresence(r) : null },
    readBytes: async (id) => {
      const row = await p.get(id)
      if (!row || !(await pdfExists(row.filename))) return null
      const r = await Filesystem.readFile({ path: `${PDF_DIR}/${row.filename}`, directory: Directory.Library })
      return typeof r.data === 'string' ? fromBase64(r.data) : await (r.data as Blob).arrayBuffer()
    },
    setPageCount: (id, n) => p.setPageCount(id, n), rename: (id, title) => p.rename(id, title),
    delete: async (id) => {
      const row = await p.deleteRow(id)
      if (row) await Filesystem.deleteFile({ path: `${PDF_DIR}/${row.filename}`, directory: Directory.Library }).catch(() => {})
      return { success: true }
    },
    highlightsList: (pdfId) => p.highlightsList(pdfId), highlightsAdd: (data) => p.highlightsAdd(data), highlightsRemove: (id) => p.highlightsRemove(id), highlightsSetNote: (id, note) => p.highlightsSetNote(id, note),
    bookmarksList: (pdfId) => p.bookmarksList(pdfId), bookmarksAdd: (pdfId, page, label) => p.bookmarksAdd(pdfId, page, label), bookmarksRemove: (id) => p.bookmarksRemove(id), bookmarksImport: (pdfId, entries) => p.bookmarksImport(pdfId, entries),
  }

  const aiLookup: Window['aiLookup'] = {
    checkAvailable: async () => ({ available: false, models: [] }),   // local Ollama model is desktop-only
    unloadModel: async () => ({ success: true }),
    query: async () => unavailable('aiLookup.query', 'AI lookup runs a local model on the Mac'),
    commentary: async () => unavailable('aiLookup.commentary', 'AI lookup runs a local model on the Mac'),
  } as unknown as Window['aiLookup']

  Object.assign(window, { app, studyTrail, youtube, pdf, aiLookup })
  void Encoding
}
