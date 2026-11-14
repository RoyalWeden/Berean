import SwiftUI
import Foundation
import Observation
import CoreGraphics
import BereanCore
import BereanSQLite
import BereanStore
import BereanWorkspace
import BereanBible
import BereanReference
import BereanNotes

/// The texts the reader offers — the existing app's TRANSLATIONS list (src/lib/bibleTexts.ts): one KJV entry (KJV +
/// Apocrypha includes the KJV) and one Septuagint (Brenton; `lxx` is served from lxx_brenton.db, electron/db/bible.ts).
/// `kjv` is not listed but still opens for saved tabs and links.
struct TextInfo: Identifiable, Hashable { let id: String; let name: String; let short: String; var section = "Other writings" }
let availableTexts: [TextInfo] = [
    .init(id: "kjva", name: "KJV + Apocrypha", short: "KJVA", section: "Bible"),
    .init(id: "lxx", name: "Septuagint (Brenton)", short: "LXX", section: "Bible"),
    .init(id: "enoch", name: "1 Enoch", short: "1 Enoch"),
    .init(id: "jubilees", name: "Jubilees", short: "Jubilees"),
    .init(id: "apoc_elijah", name: "Apocalypse of Elijah", short: "Apoc. Elijah"),
    .init(id: "recog_clement", name: "Recognitions of Clement", short: "Recog. Clement"),
    .init(id: "hermas", name: "Shepherd of Hermas", short: "Hermas"),
    .init(id: "hermas_taylor", name: "Shepherd of Hermas (Taylor)", short: "Hermas (Taylor)"),
    .init(id: "asc_isaiah", name: "Ascension of Isaiah", short: "Asc. Isaiah"),
    .init(id: "ep_barnabas", name: "Epistle of Barnabas", short: "Ep. Barnabas"),
    .init(id: "t12p", name: "Testaments of the Twelve Patriarchs", short: "T12 Patriarchs"),
    .init(id: "gad", name: "Words of Gad the Seer", short: "Gad the Seer"),
    .init(id: "t_job", name: "Testament of Job", short: "T. Job"),
    .init(id: "1clement", name: "First Epistle of Clement", short: "1 Clement"),
    .init(id: "apoc_abraham", name: "Apocalypse of Abraham", short: "Apoc. Abraham"),
    .init(id: "didache_hoole", name: "Didache", short: "Didache"),
    .init(id: "t_jacob", name: "Testament of Jacob", short: "T. Jacob"),
    .init(id: "2baruch", name: "2 Baruch", short: "2 Baruch"),
]
/// Display info for any text id, including unlisted ones that saved tabs may still use.
func textInfo(_ id: String) -> TextInfo {
    availableTexts.first { $0.id == id } ?? (id == "kjv" ? TextInfo(id: "kjv", name: "KJV", short: "KJV", section: "Bible") : TextInfo(id: id, name: id, short: id))
}

/// Prevents two copies of the app opening the same library (DECISIONS OD-5: no simultaneous database access).
final class SingleInstanceLock {
    private var fd: Int32 = -1
    init?(path: String) {
        fd = open(path, O_CREAT | O_RDWR, 0o600)
        guard fd >= 0, flock(fd, LOCK_EX | LOCK_NB) == 0 else { if fd >= 0 { close(fd) }; return nil }
    }
    deinit { if fd >= 0 { flock(fd, LOCK_UN); close(fd) } }
}

/// The native development library. It lives in this app's own container (bundle id com.berean.native.*),
/// so it can never be a production or Capacitor/Electron Berean Dev database.
enum UserLibrary {
    static var directory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("BereanNative", isDirectory: true)
    }
}

/// Shared, platform-neutral application state: sessions → Spaces → tabs, persisted through the synced
/// `sessions`/`tabs` tables (BereanWorkspace) exactly as the existing apps store them.
@MainActor @Observable
final class AppModel {
    let bible = BibleService(resolvePath: { Corpora.path($0) })
    let lexicon = LexiconService(lexiconPath: { Corpora.path($0 == "H" ? "strongs_hebrew" : "strongs_greek") }, textPath: { Corpora.path($0) })
    let crossrefs = CrossrefsService(dataPath: { Corpora.path($0) })

    var sessions: [Session] = []
    var currentSessionId = ""
    var activeSpace: SpaceId = .scripture {
        didSet { rememberWorkspaceSpace() }
    }
    private var workspaceSpaces = UserDefaults.standard.dictionary(forKey: "nativeWorkspaceSpaces") as? [String: String] ?? [:]

    private func rememberWorkspaceSpace() {
        guard !currentSessionId.isEmpty, activeTab != nil,
              workspaceSpaces[currentSessionId] != activeSpace.rawValue else { return }
        workspaceSpaces[currentSessionId] = activeSpace.rawValue
        UserDefaults.standard.set(workspaceSpaces, forKey: "nativeWorkspaceSpaces")
    }
    private(set) var recentTabIDs = Array((UserDefaults.standard.stringArray(forKey: "nativeRecentTabIDs") ?? []).prefix(20))
    var displayOrders: [String: [String]] = [:]
    var archivedGroups: [ArchivedGroup] = []
    var books: [String: [BookRow]] = [:]
    var libraryError: String?
    var commandPaletteShown = false
    #if os(macOS)
    var commandPaletteCreatesTab = false

    func showCommandPalette(newTab: Bool = false) {
        commandPaletteCreatesTab = newTab
        commandPaletteShown = true
    }
    #endif
    /// Bumped by View ▸ Toggle Sidebar (the window's split view observes it).
    var sidebarToggleRequest = 0
    /// Every book of every text (passage navigator search, reference resolution).
    var bookCatalog: [CatalogBook] = []
    var explicitKJVBooks: [BookRow]?
    /// One-line result shown in an alert after a user action (export/import outcome, errors).
    var userMessage: String?
    /// Bumped on every note write so note lists and verse dots refresh.
    var notesRevision = 0
    private(set) var notes: NotesService?
    private(set) var highlights: HighlightsService?
    var highlightsRevision = 0
    private(set) var settingsService: SettingsService?
    private(set) var workspaces: WorkspacesService?
    private(set) var verseTags: VerseTagsService?
    var showStudyTrail = false
    private(set) var studyTrailService: StudyTrailService?
    private(set) var historyService: HistoryService?
    var historyRevision = 0
    /// Bumped on every verse-tag write so chips and tag lists refresh.
    var tagsRevision = 0
    /// Saved workspaces (newest first), shared with the existing apps' Settings → Layout list.
    var savedWorkspaces: [SavedWorkspace] = []
    /// Reading preferences (settings table keys shared with the existing apps where they exist).
    var fontSize: Double = ScriptureTextSize.standard { didSet { saveSetting("fontSize", .number(fontSize)) } }
    var lineHeight = "comfortable" { didSet { saveSetting("lineHeight", .string(JSString(lineHeight))) } }
    var defaultText = "kjva" { didSet { saveSetting("defaultText", .string(JSString(defaultText))) } }
    var hermasEdition = HermasText.taylor { didSet { saveSetting("hermasTranslation", .string(JSString(hermasEdition.rawValue))) } }
    var wordReplacerEnabled = true { didSet { saveSetting("wordReplacerEnabled", .bool(wordReplacerEnabled)) } }
    var theme = "system" { didSet { saveSetting("theme", .string(JSString(theme))) } }
    /// The existing apps' `scriptureFontFamily` setting ('system' = the platform UI font).
    var scriptureFontFamily = "system" { didSet { saveSetting("scriptureFontFamily", .string(JSString(scriptureFontFamily))) } }
    private var loadingSettings = false

    private var database: UserDatabase?
    private var sessionsService: SessionsService?
    private var lock: SingleInstanceLock?
    private var keys = TabPersistence.OrderKeyMaps()
    private var saveTask: Task<Void, Never>?

    init() { openLibrary(); loadBookCatalog() }

    // MARK: library

    private func openLibrary() {
        do {
            try FileManager.default.createDirectory(at: UserLibrary.directory, withIntermediateDirectories: true)
            guard let lock = SingleInstanceLock(path: UserLibrary.directory.appendingPathComponent("berean.lock").path) else {
                libraryError = "Berean is already open in another window or process using this library."
                seedDefault(); return
            }
            self.lock = lock
            let db = try UserDatabase(path: UserLibrary.directory.appendingPathComponent("berean.db").path)
            try Migrator.migrate(db.connection, backup: { from, _ in try Self.backup(db.connection, from: from) })
            let svc = SessionsService(db: db.connection, now: { Int64(Date().timeIntervalSince1970 * 1000) })
            database = db; sessionsService = svc
            notes = NotesService(db: db.connection, onChange: { [weak self] _, _, _ in Task { @MainActor in self?.notesRevision += 1 } })
            settingsService = SettingsService(db: db.connection)
            workspaces = WorkspacesService(db: db.connection, now: { Int64(Date().timeIntervalSince1970 * 1000) }, uuid: { Self.newId() }, onChange: { _ in })
            savedWorkspaces = (try? workspaces?.list()) ?? []
            historyService = HistoryService(db: db.connection)
            studyTrailService = StudyTrailService(db: db.connection)
            verseTags = VerseTagsService(db: db.connection, onChange: { [weak self] _, _, _ in Task { @MainActor in self?.tagsRevision += 1 } })
            loadSettings()
            highlights = HighlightsService(db: db.connection, onChange: { [weak self] _, _, _, _ in Task { @MainActor in self?.highlightsRevision += 1 } })
            let rows = try svc.allRows()
            var local: [String: [String: String?]] = [:]
            for s in rows.sessions {
                let o = try svc.localState(sessionId: s.id)
                local[s.id] = Dictionary(uniqueKeysWithValues: o.entries.map { ($0.key.string, $0.value.stringValue?.string) })
            }
            let h = TabPersistence.hydrate(sessions: rows.sessions, tabs: rows.tabs, groups: rows.groups, localState: local)
            if h.sessions.isEmpty { seedDefault() } else {
                sessions = h.sessions; displayOrders = h.displayOrders; archivedGroups = h.archivedGroups; keys = h.keys
                currentSessionId = UserDefaults.standard.string(forKey: "currentSessionId").flatMap { id in sessions.contains { $0.id == id } ? id : nil } ?? sessions[0].id
                if let space = workspaceSpaces[currentSessionId].flatMap(SpaceId.init(rawValue:)),
                   let id = activeTabId(in: space), tabs(in: space).contains(where: { $0.id == id }) {
                    activeSpace = space
                }
            }
        } catch {
            libraryError = "Could not open the library: \(error)"
            seedDefault()
        }
    }

    /// Consistent online backup (VACUUM INTO) before upgrading an existing library.
    nonisolated static func backup(_ c: SQLiteConnection, from version: Int) throws {
        let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
        let url = UserLibrary.directory.appendingPathComponent("Backups", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        try c.run("VACUUM INTO ?", [.text(url.appendingPathComponent("berean-v\(version)-\(stamp).db").path)])
    }

    private func seedDefault() {
        let s = Session(id: Self.newId(), name: "Study")
        sessions = [s]; currentSessionId = s.id
        openTab(.bible, in: .scripture, title: "Genesis 1", state: BibleState(bookId: "GEN", chapter: 1).object)
    }

    nonisolated static func newId() -> String { UUID().uuidString.lowercased() }

    private func loadSettings() {
        guard let all = try? settingsService?.all() else { return }
        loadingSettings = true
        if let v = all["fontSize"]?.numberValue { fontSize = v }
        if let v = all["lineHeight"]?.stringValue?.string { lineHeight = v }
        if let v = all["defaultText"]?.stringValue?.string { defaultText = v }
        if let v = all["hermasTranslation"]?.stringValue?.string, let edition = HermasText(rawValue: v) { hermasEdition = edition }
        if let v = all["wordReplacerEnabled"]?.boolValue { wordReplacerEnabled = v }
        if let v = all["theme"]?.stringValue?.string { theme = v }
        if let v = all["scriptureFontFamily"]?.stringValue?.string { scriptureFontFamily = v }
        loadingSettings = false
    }

    private func saveSetting(_ key: String, _ v: JSValue) {
        guard !loadingSettings else { return }
        try? settingsService?.set(key, v)
    }

    var lineSpacing: CGFloat { lineHeight == "compact" ? 2 : lineHeight == "spacious" ? 9 : 5 }


    func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            self?.saveNow()
        }
    }

    func saveNow() {
        guard let svc = sessionsService else { return }
        UserDefaults.standard.set(currentSessionId, forKey: "currentSessionId")
        let built = TabPersistence.buildSnapshot(sessions: sessions, displayOrders: displayOrders, archivedGroups: archivedGroups, previous: keys)
        keys = built.keys
        do {
            try svc.applySnapshot(built.snapshot)
            for (sid, active) in built.localState {
                var o = JSObject()
                for sp in SpaceId.allCases { if let v = active[sp] { o[JSString(sp.rawValue)] = v.map { .string(JSString($0)) } ?? .null } }
                try svc.setLocalState(sessionId: sid, activeTab: o)
            }
        } catch { libraryError = "Saving tabs failed: \(error)" }
    }

    // MARK: sessions

    var sessionIndex: Int { sessions.firstIndex { $0.id == currentSessionId } ?? 0 }
    var session: Session { sessions.isEmpty ? Session(id: "", name: "") : sessions[sessionIndex] }

    func switchSession(_ id: String, preferredSpace: SpaceId? = nil, rememberPrevious: Bool = true) {
        guard id != currentSessionId, let destination = sessions.first(where: { $0.id == id }) else { return }
        if rememberPrevious { rememberActiveTab() }
        currentSessionId = id
        let remembered = workspaceSpaces[id].flatMap(SpaceId.init(rawValue:))
        if let space = preferredSpace ?? remembered, !destination.tabs(in: space).isEmpty {
            activeSpace = space
        }
        if activeTab == nil {
            let ordered = destination.workspacePreviewTabs
            if let tab = ordered.first(where: { $0.spaceId == activeSpace }) ?? ordered.first {
                select(tab.id, in: tab.spaceId, rememberPrevious: false)
                return
            }
        }
        rememberWorkspaceSpace()
        scheduleSave()
    }
    func newSession(named name: String = "New Session") {
        let s = Session(id: Self.newId(), name: name)
        sessions.append(s); switchSession(s.id)
        openTab(.bible, in: .scripture, title: "Genesis 1", state: BibleState(bookId: "GEN", chapter: 1).object)
    }
    func renameSession(_ id: String, to name: String) {
        guard let i = sessions.firstIndex(where: { $0.id == id }), !name.isEmpty else { return }
        sessions[i].name = name; scheduleSave()
    }
    func deleteSession(_ id: String) {
        guard sessions.count > 1, let i = sessions.firstIndex(where: { $0.id == id }) else { return }
        sessions.remove(at: i)
        workspaceSpaces.removeValue(forKey: id)
        UserDefaults.standard.set(workspaceSpaces, forKey: "nativeWorkspaceSpaces")
        if currentSessionId == id {
            switchSession(sessions[0].id, rememberPrevious: false)
        }
        scheduleSave()
    }

    // MARK: Markdown files

    /// The note shown by the active tab (Notes space), if any.
    var activeNoteId: String? {
        guard let t = activeTab, t.tabType == .note else { return nil }
        return t.state["noteId"]?.stringValue?.string
    }

    func exportActiveNote() { if let id = activeNoteId { exportNote(id) } }

    /// File ▸ Export Note as Markdown… / the note Share menu: native save panel → .md in the vault format.
    func exportNote(_ id: String) {
        guard let note = try? notes?.one(id) else { userMessage = "This note could not be read."; return }
        NoteFileTransfer.exportMarkdown(NoteMarkdownFile.markdown(for: note), suggestedName: NoteMarkdownFile.fileName(title: note.title, id: note.id)) { [weak self] outcome in
            switch outcome {
            case .saved(let url): self?.lastExportURL = url
            case .cancelled: break
            case .failed(let why): self?.userMessage = "The note could not be exported. \(why)"
            }
        }
    }
    /// Where the last export was written (shown nowhere; kept for tests and diagnostics).
    var lastExportURL: URL?

    /// File ▸ Import Markdown… / Notes home: open panel → notes (berean_id updates, otherwise new notes).
    func importMarkdownFiles() {
        NoteFileTransfer.chooseMarkdownFiles { [weak self] files in
            guard let self, !files.isEmpty else { return }
            var created = 0, updated = 0, failed = 0, lastId: String?
            for f in files {
                switch Result(catching: { try self.notes?.importMarkdown(f.text, fileName: f.name) }) {
                case .success(.created(let id)?): created += 1; lastId = id
                case .success(.updated(let id)?): updated += 1; lastId = id
                default: failed += 1
                }
            }
            if files.count == 1, let lastId { self.openNote(lastId) }
            self.userMessage = "Imported \(created) new note\(created == 1 ? "" : "s")\(updated > 0 ? ", updated \(updated)" : "")\(failed > 0 ? ". \(failed) could not be imported." : ".")"
        }
    }

    // MARK: history (device-local `history` table, as the existing apps)

    static let historyEntryLimit = 5_000

    func recordHistory(type: String, title: String, bookId: String? = nil, chapter: Int? = nil, verse: Int? = nil, noteId: String? = nil, strongsNum: String? = nil, query: String? = nil) {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let e = HistoryEntry(id: "hist-\(now)-\(Self.newId().prefix(8))", type: type, title: title, timestamp: now, sessionId: currentSessionId, sessionName: session.name,
                             bookId: bookId, chapter: chapter, verse: verse, noteId: noteId, strongsNum: strongsNum, query: query)
        if (try? historyService?.add(e, maxEntries: Self.historyEntryLimit)) == true { historyRevision += 1 }
    }

    func openHistory(newTab: Bool = false) {
        openUtilityTab(.history, in: .search, title: "History", newTab: newTab)
    }

    func openTags(newTab: Bool = false) {
        openUtilityTab(.tags, in: .notes, title: "Tags", newTab: newTab)
    }

    func openUtilityTab(_ type: TabType, in space: SpaceId, title: String, newTab: Bool) {
        if !newTab {
            let matching = session.allTabs.filter { $0.tabType == type }
            if let tab = matching.first(where: { activeTabId(in: $0.spaceId) == $0.id }) ?? matching.first {
                select(tab.id, in: tab.spaceId)
                return
            }
        }
        openTab(type, in: space, title: title, state: JSObject())
    }

    // MARK: saved workspaces (same rows and state_json v2 as src/lib/workspaceSnapshot.ts)

    /// The existing desktop app restores this mosaic tree on load; the native reader keeps its
    /// layout preset per tab (BibleState.scriptureLayout), so a native save writes the desktop default.
    static let legacyDefaultPanelLayout = #"{"direction":"row","first":"bible-panel","second":"notes-panel","splitPercentage":58}"#

    func refreshWorkspaces() { savedWorkspaces = (try? workspaces?.list()) ?? [] }

    @discardableResult
    func saveWorkspace(named name: String) -> Bool {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, let workspaces else { return false }
        let state = WorkspaceSnapshot.stateJSON(for: session, displayOrder: displayOrders[currentSessionId], preferredSpace: activeSpace)
        guard (try? workspaces.save(name: name, layoutJSON: Self.legacyDefaultPanelLayout, stateJSON: state)) != nil else { return false }
        refreshWorkspaces(); return true
    }

    /// Opens (or switches to) the workspace's session `ws:<id>`, as `openWorkspaceSession` does:
    /// tab ids already open in another session get fresh ids so per-session tab rows stay distinct.
    func openWorkspace(_ id: String) {
        let sid = WorkspaceSnapshot.sessionId(id)
        if sessions.contains(where: { $0.id == sid }) { switchSession(sid); return }
        guard let ws = try? workspaces?.load(id) else { return }
        let parsed = WorkspaceSnapshot.parse(ws.stateJSON)
        let restored = parsed.restoreSession(id: sid, name: ws.name,
                                             reservedIDs: Set(sessions.flatMap { $0.allTabs.map(\.id) }),
                                             makeID: Self.newId)
        sessions.append(restored.session)
        displayOrders[sid] = restored.displayOrder
        switchSession(sid, preferredSpace: parsed.preferredSpace)
    }

    func renameWorkspace(_ id: String, to name: String) {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        try? workspaces?.rename(id, to: name); refreshWorkspaces()
    }

    func deleteWorkspace(_ id: String) { try? workspaces?.delete(id); refreshWorkspaces() }

    // MARK: tabs

    func tabs(in space: SpaceId) -> [BereanWorkspace.Tab] { session.tabs(in: space) }
    func activeTabId(in space: SpaceId) -> String? { session.activeTabId[space] ?? nil }
    var activeTab: BereanWorkspace.Tab? { activeTabId(in: activeSpace).flatMap { id in tabs(in: activeSpace).first { $0.id == id } } }

    private func rememberActiveTab() {
        guard let id = activeTab?.id else { return }
        recentTabIDs.removeAll { $0 == id }
        recentTabIDs.insert(id, at: 0)
        if recentTabIDs.count > 20 { recentTabIDs.removeLast() }
        UserDefaults.standard.set(recentTabIDs, forKey: "nativeRecentTabIDs")
    }

    func select(_ tabId: String, in space: SpaceId, rememberPrevious: Bool = true) {
        if rememberPrevious, activeTab?.id != tabId { rememberActiveTab() }
        sessions[sessionIndex].activeTabId[space] = tabId
        activeSpace = space
        scheduleSave()
    }

    @discardableResult
    func openTab(_ type: TabType, in space: SpaceId, title: String, state: JSObject, origin: BereanWorkspace.Tab? = nil) -> String {
        if sessions.isEmpty { seedDefault() }
        let id = Self.newId()
        let tab = BereanWorkspace.Tab(id: id, spaceId: space, type: type.rawValue, title: title, state: state, originTabId: origin?.id, originSpaceId: origin?.spaceId)
        insertTab(tab, after: activeTab?.id, inSpaceAfter: activeTabId(in: space))
        return id
    }

    private func insertTab(_ tab: BereanWorkspace.Tab, after displayAnchor: String?, inSpaceAfter spaceAnchor: String?) {
        let space = tab.spaceId
        insertInDisplayOrder(tab.id, after: displayAnchor)
        var list = sessions[sessionIndex].tabs[space] ?? []
        if let spaceAnchor, let idx = list.firstIndex(where: { $0.id == spaceAnchor }) {
            list.insert(tab, at: idx + 1)
        } else {
            list.append(tab)
        }
        sessions[sessionIndex].tabs[space] = list
        select(tab.id, in: space)
    }

    func close(_ tabId: String) {
        studyVerseFocus.removeValue(forKey: tabId)
        // Closing the tab on screen selects its neighbour in the sidebar list (below, else above).
        let wasActive = activeTab?.id == tabId
        let ordered = orderedTabs
        let neighbour: BereanWorkspace.Tab? = ordered.firstIndex { $0.id == tabId }.flatMap { i in
            i + 1 < ordered.count ? ordered[i + 1] : (i > 0 ? ordered[i - 1] : nil)
        }
        defer { if wasActive, let n = neighbour, findTab(n.id) != nil { select(n.id, in: n.spaceId) } }
        for sp in SpaceId.allCases {
            guard var list = sessions[sessionIndex].tabs[sp], let idx = list.firstIndex(where: { $0.id == tabId }) else { continue }
            list.remove(at: idx)
            sessions[sessionIndex].tabs[sp] = list
            if activeTabId(in: sp) == tabId { sessions[sessionIndex].activeTabId[sp] = list.isEmpty ? nil : list[min(idx, list.count - 1)].id }
            scheduleSave(); return
        }
    }

    func closeActiveTab() { if let t = activeTab { close(t.id) } }

    func duplicate(_ tabId: String) {
        guard var copy = findTab(tabId) else { return }
        copy.id = Self.newId()
        copy.isPinned = false
        insertTab(copy, after: tabId, inSpaceAfter: tabId)
    }

    func togglePin(_ tabId: String) { update(tabId) { $0.isPinned.toggle() } }

    func move(in space: SpaceId, from: IndexSet, to: Int) {
        var list = sessions[sessionIndex].tabs[space] ?? []
        list.move(fromOffsets: from, toOffset: to)
        sessions[sessionIndex].tabs[space] = list
        scheduleSave()
    }

    func moveTab(_ tabId: String, toSession target: String) {
        guard target != currentSessionId, let t = findTab(tabId), let ti = sessions.firstIndex(where: { $0.id == target }) else { return }
        close(tabId)
        sessions[ti].tabs[t.spaceId, default: []].append(t)
        if (sessions[ti].activeTabId[t.spaceId] ?? nil) == nil { sessions[ti].activeTabId[t.spaceId] = t.id }
        scheduleSave()
    }

    func findTab(_ id: String) -> BereanWorkspace.Tab? { session.allTabs.first { $0.id == id } }

    func update(_ tabId: String, recordHistory: Bool = true, _ change: (inout BereanWorkspace.Tab) -> Void) {
        for sp in SpaceId.allCases {
            guard let idx = sessions[sessionIndex].tabs[sp]?.firstIndex(where: { $0.id == tabId }) else { continue }
            let before = sessions[sessionIndex].tabs[sp]![idx]
            change(&sessions[sessionIndex].tabs[sp]![idx])
            if recordHistory, before.tabType == .bible {
                let updated = sessions[sessionIndex].tabs[sp]![idx].state
                if let columns = updated["compareColumns"], columns == before.state["compareColumns"] {
                    let moved = CompareColumn.followPassageChange(columns, from: BibleState(before.state), to: BibleState(updated))
                    if moved != columns { sessions[sessionIndex].tabs[sp]![idx].state["compareColumns"] = moved }
                }
            }
            let after = sessions[sessionIndex].tabs[sp]![idx]
            let locationChanged = (recordHistory || studyVerseFocus[tabId] != nil)
                && Self.location(before) != Self.location(after)
            if locationChanged, studyVerseFocus[tabId] != nil {
                studyVerseFocus.removeValue(forKey: tabId)
            }
            if recordHistory, locationChanged {
                if let saved = after.state["nativeSelectedVerses"], saved == before.state["nativeSelectedVerses"],
                   Self.selectionLocation(before) != Self.selectionLocation(after) {
                    sessions[sessionIndex].tabs[sp]![idx].state.remove("nativeSelectedVerses")
                }
                backStack[tabId, default: []].append((before.title, before.state))
                if backStack[tabId]!.count > 100 { backStack[tabId]!.removeFirst() }
                forwardStack[tabId] = []
            }
            if recordHistory, after.tabType == .bible, BibleState(after.state).compareMode {
                let destination = CompareHistoryDestination(state: after.state)
                if !BibleState(before.state).compareMode || CompareHistoryDestination(state: before.state) != destination {
                    let passage = destination.passage
                    let payload = (try? JSONEncoder().encode(destination)).flatMap { String(data: $0, encoding: .utf8) }
                    self.recordHistory(type: "compare", title: "Compare · \(passage.label)",
                                       bookId: passage.bookId, chapter: passage.chapter, verse: passage.verse, query: payload)
                }
            }
            scheduleSave(); return
        }
    }

    // MARK: in-tab history (⌘[ / ⌘]) — the place a tab shows, not presentation details like scroll or panels

    private var backStack: [String: [(String, JSObject)]] = [:]
    private var forwardStack: [String: [(String, JSObject)]] = [:]

    private static func selectionLocation(_ tab: BereanWorkspace.Tab) -> [JSValue?] {
        ["bookId", "chapter", "translation", "verse", "endVerse", "endChapter"].map { tab.state[$0] }
    }

    static func location(_ t: BereanWorkspace.Tab) -> String {
        let keys: [String]
        switch t.tabType {
        case .bible: keys = ["bookId", "chapter", "translation", "verse", "endVerse", "nativeSelectedVerses"]
        case .note: keys = ["noteId"]
        case .lexicon: keys = ["strongsNum"]
        case .search: keys = ["query"]
        default: keys = []
        }
        let base = keys.map { k in t.state[k].flatMap { $0 == .null ? nil : JSON.stringify($0).string } ?? "-" }.joined(separator: "|")
        guard t.tabType == .bible else { return base }
        let anchor = BibleState(t.state)
        guard anchor.compareMode else { return base }
        let columns = (t.state["compareColumns"]?.arrayValue ?? []).enumerated().compactMap { index, value in
            value.objectValue.flatMap { CompareColumn(id: index, record: $0, anchor: anchor) }?.historyKey
        }
        return base + "|compare|" + columns.joined(separator: ",")
    }

    var canGoBack: Bool { activeTab.map { !(backStack[$0.id] ?? []).isEmpty } ?? false }
    var canGoForward: Bool { activeTab.map { !(forwardStack[$0.id] ?? []).isEmpty } ?? false }

    func goBack() {
        guard let t = activeTab, let prev = backStack[t.id]?.popLast() else { return }
        forwardStack[t.id, default: []].append((t.title, t.state))
        update(t.id, recordHistory: false) { $0.title = prev.0; $0.state = prev.1 }
    }

    func goForward() {
        guard let t = activeTab, let next = forwardStack[t.id]?.popLast() else { return }
        backStack[t.id, default: []].append((t.title, t.state))
        update(t.id, recordHistory: false) { $0.title = next.0; $0.state = next.1 }
    }

    /// ⌃Tab / ⌃⇧Tab: the next / previous tab in the sidebar list (all tab types, the user's order).
    func selectNextTab(_ delta: Int) {
        let list = orderedTabs
        guard !list.isEmpty else { return }
        let cur = list.firstIndex { $0.id == activeTab?.id } ?? 0
        let t = list[(cur + delta + list.count) % list.count]
        select(t.id, in: t.spaceId)
    }

    // MARK: opening content

    func books(for textId: String) async -> [BookRow] {
        if let b = books[textId] { return b }
        let b = await bible.getBooks(textId)
        books[textId] = b
        return b
    }

    /// A reference opens Scripture, a Strong's number opens the lexicon, and words open search.
    func openQuery(_ q: String, newTab: Bool = true) {
        let query = q.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return }
        if let passage = resolvePassage(query, preferring: activeTab.flatMap({ $0.tabType == .bible ? BibleState($0.state).translation : nil })) {
            visitScripture(passage, reuseTab: !newTab)
        } else if let id = StrongsId.normalize(query) {
            openLexicon(id, reuseTab: !newTab)
        } else {
            openSearch(query, reuseTab: !newTab)
        }
    }

    private func openOrReuse(_ type: TabType, in space: SpaceId, title: String, state: JSObject, origin: BereanWorkspace.Tab? = nil,
                             canReplace: (BereanWorkspace.Tab) -> Bool = { _ in true },
                             matches: ((BereanWorkspace.Tab) -> Bool)? = nil) {
        let candidates = tabs(in: space).filter { $0.tabType == type }
        let currentId = activeTabId(in: space)
        if let matches {
            let exact = candidates.filter(matches)
            if let tab = exact.first(where: { $0.id == currentId }) ?? exact.first {
                select(tab.id, in: space)
                return
            }
        }
        let writable = candidates.filter { !$0.isPinned && canReplace($0) }
        if let tab = writable.first(where: { $0.id == currentId }) ?? writable.first {
            update(tab.id) { tab in
                for field in state.entries { tab.state[field.key.string] = field.value }
                tab.title = title
            }
            select(tab.id, in: space)
        } else {
            openTab(type, in: space, title: title, state: state, origin: origin)
        }
    }

    /// A Search tab for `query` (words, a phrase or Strong's numbers), across the default scope (All Texts).
    func openSearch(_ query: String, reuseTab: Bool = false) {
        recordHistory(type: "search", title: "\"\(query)\"", query: query)
        var o = JSObject(); o["query"] = .string(JSString(query))
        if reuseTab {
            let isAllTextsSearch: (BereanWorkspace.Tab) -> Bool = { tab in
                let state = tab.state
                return state["scopeTexts"]?.arrayValue == nil
                    && (state["wordMode"]?.stringValue?.string ?? "all") == "all"
                    && (state["testament"]?.stringValue?.string ?? "all") == "all"
                    && (state["bookIds"]?.arrayValue?.isEmpty ?? true)
            }
            openOrReuse(.search, in: .search, title: "Search: \(query)", state: o,
                        canReplace: isAllTextsSearch,
                        matches: { isAllTextsSearch($0) && $0.state["query"]?.stringValue?.string == query })
        } else { openTab(.search, in: .search, title: "Search: \(query)", state: o) }
        SearchHistory.record(query)
    }

    private struct StudyVerseFocus {
        let state: BibleState
        let verse: Int?
        let selectedVerses: [Int]
    }

    private var studyVerseFocus: [String: StudyVerseFocus] = [:]

    func focusStudyVerse(_ verse: Int?, in tabId: String, selectedVerses: [Int] = []) {
        guard let tab = findTab(tabId) else { return }
        studyVerseFocus[tabId] = StudyVerseFocus(state: BibleState(tab.state), verse: verse, selectedVerses: selectedVerses)
    }

    private func studyFocus(in tabId: String, state: BibleState) -> StudyVerseFocus? {
        guard let focus = studyVerseFocus[tabId],
              focus.state.bookId == state.bookId, focus.state.chapter == state.chapter,
              focus.state.translation == state.translation else { return nil }
        return focus
    }

    func studyVerse(in tabId: String, state: BibleState) -> Int? {
        if let focus = studyFocus(in: tabId, state: state) { return focus.verse }
        return state.verse
    }

    func studySelectedVerses(in tabId: String, state: BibleState) -> [Int] {
        if let focus = studyFocus(in: tabId, state: state) { return focus.selectedVerses }
        return readerSelectedVerses(in: tabId, state: state)
    }

    func readerSelectedVerses(in tabId: String, state: BibleState) -> [Int] {
        guard !state.compareMode, let tab = findTab(tabId),
              let first = state.verse, (1...999).contains(first) else { return [] }
        if let last = state.endVerse, (first...999).contains(last),
           tab.state["endChapter"]?.numberValue == nil {
            return Array(first...last)
        }
        return ResolvedPassage.savedVerses(in: tab, reader: state).sorted()
    }

    func inspectStrongs(_ id: String, in tabId: String, bookId: String, chapter: Int, verse: Int? = nil) {
        guard !id.isEmpty else { return }
        recordHistory(type: "strongs-click", title: id, bookId: bookId, chapter: chapter, verse: verse, strongsNum: id)
        update(tabId, recordHistory: false) { tab in
            var reader = BibleState(tab.state)
            reader.rightPanelOpen = true
            reader.rightPanelTab = "lexicon"
            reader.rightPanelLexiconEntry = id
            tab.state = reader.merged(into: tab.state)
        }
    }

    func navigateLexicon(_ strongs: String, in tabId: String) {
        guard let tab = findTab(tabId) else { return }
        if tab.tabType == .bible {
            update(tabId, recordHistory: false) {
                $0.state["rightPanelLexiconEntry"] = .string(JSString(strongs))
            }
        } else if tab.tabType == .lexicon {
            update(tabId) {
                $0.state["strongsNum"] = .string(JSString(strongs))
                $0.title = strongs
            }
        } else {
            return
        }
        recordHistory(type: "lexicon", title: strongs, strongsNum: strongs)
    }

    func openLexicon(_ strongs: String, from origin: BereanWorkspace.Tab? = nil, reuseTab: Bool = false) {
        recordHistory(type: "lexicon", title: strongs, strongsNum: strongs)
        var o = JSObject(); o["strongsNum"] = .string(JSString(strongs))
        if reuseTab {
            openOrReuse(.lexicon, in: .lexicon, title: strongs, state: o, origin: origin,
                        canReplace: { $0.originTabId == origin?.id },
                        matches: { $0.state["strongsNum"]?.stringValue?.string == strongs && $0.originTabId == origin?.id })
        } else { openTab(.lexicon, in: .lexicon, title: strongs, state: o, origin: origin) }
    }

    func refreshNoteTabTitles(_ note: Note) {
        for tab in tabs(in: .notes) where tab.tabType == .note
            && tab.state["noteId"]?.stringValue?.string == note.id && tab.title != note.displayTitle {
            update(tab.id, recordHistory: false) { $0.title = note.displayTitle }
        }
    }

    /// Global Notes navigation leaves existing editors and their folder return paths intact.
    func openNotesHome(newTab: Bool = false) {
        if !newTab {
            let homeTabs = tabs(in: .notes).filter {
                $0.tabType == .note && $0.state["noteId"]?.stringValue == nil
            }
            if let existing = homeTabs.first(where: { $0.id == activeTabId(in: .notes) }) ?? homeTabs.first {
                select(existing.id, in: .notes)
                return
            }
        }
        openNote(nil, newTab: true)
    }

    func openNote(_ id: String?, newTab: Bool = false) {
        let note = id.flatMap { try? notes?.one($0) }
        if let note {
            refreshNoteTabTitles(note)
            recordHistory(type: "note", title: note.displayTitle, noteId: note.id)
        }
        var o = JSObject(); o["noteId"] = id.map { .string(JSString($0)) } ?? .null; o["isNew"] = .bool(false)
        let title = note?.displayTitle ?? "Notes"
        if !newTab, let id, let exact = tabs(in: .notes).first(where: { $0.tabType == .note && $0.state["noteId"]?.stringValue?.string == id }) {
            select(exact.id, in: .notes)
            return
        }
        if !newTab, let cur = activeTabId(in: .notes), let t = tabs(in: .notes).first(where: { $0.id == cur }),
           t.tabType == .note, (!t.isPinned || id == nil), activeSpace == .notes {
            // Keep the Notes home location, so closing the note returns to the same folder.
            var title = title
            if let loc = t.state["listFolderId"] {
                o["listFolderId"] = loc
                if id == nil { title = NotesHomeView.title(loc.stringValue?.string, (try? notes?.folders()) ?? []) }
            }
            update(t.id) { $0.state = o; $0.title = title }
        } else { openTab(.note, in: .notes, title: title, state: o) }
    }

    /// New note (optionally attached to a verse, e.g. "GEN.1.1" in `textId`), opened in the Notes space.
    @discardableResult
    func newNote(verseRef: String? = nil, textId: String = "kjva", title: String? = nil, content: String = "") -> String? {
        guard let notes else { libraryError = "The library is not open."; return nil }
        do {
            let label = verseRef.flatMap { r -> String? in
                let p = r.split(separator: ".").map(String.init)
                guard p.count == 3, let c = Int(p[1]), let v = Int(p[2]) else { return nil }
                return Reference.bookChapterVerseLabel(p[0], chapter: c, verse: v)
            }
            let n = try notes.create(.init(type: verseRef == nil ? "general" : "verse", title: title ?? label ?? "", content: content, verseRef: verseRef, textId: textId)).note
            openNote(n.id)
            return n.id
        } catch { libraryError = "Could not create the note: \(error)"; return nil }
    }

    func reopenComparison(bookId: String, chapter: Int, verse: Int?, destination: CompareHistoryDestination?) {
        var reader = BibleState(bookId: bookId, chapter: chapter)
        reader.translation = destination?.passage.textId ?? defaultText
        reader.verse = verse
        reader.endVerse = destination?.passage.endVerse
        reader.compareMode = true
        var state = reader.object
        state["compareColumns"] = .array(destination?.columns.map(\.value) ?? [])
        let comparison = CompareHistoryDestination(state: state)
        let title = Reference.readerChapterLabel(bookId, chapter, textId: reader.translation)
        // Keep other open comparisons intact when a History entry has a different destination.
        if let existing = tabs(in: .scripture).first(where: {
            $0.tabType == .bible && BibleState($0.state).compareMode && CompareHistoryDestination(state: $0.state) == comparison
        }) {
            select(existing.id, in: .scripture)
        } else {
            openTab(.bible, in: .scripture, title: title, state: state)
        }
    }

    func visitScripture(_ passage: ResolvedPassage, reuseTab: Bool = true) {
        openScripture(bookId: passage.bookId, chapter: passage.chapter, verse: passage.verse,
                      endVerse: passage.endVerse, textId: passage.textId, reuseTab: reuseTab, verseGroups: passage.verseGroups)
        recordRecent(textId: passage.textId, bookId: passage.bookId, chapter: passage.chapter,
                     verse: passage.verse, endVerse: passage.endVerse, verseGroups: passage.verseGroups)
    }

    func openScripture(bookId: String, chapter: Int, verse: Int? = nil, endVerse: Int? = nil, textId: String? = nil, reuseTab: Bool = false, verseGroups: [ClosedRange<Int>] = []) {
        var st = BibleState(bookId: bookId, chapter: chapter)
        st.verse = verse
        if let verse, let endVerse, endVerse > verse { st.endVerse = endVerse }
        st.translation = textId ?? defaultText
        let title = Reference.readerChapterLabel(bookId, chapter, textId: st.translation)
        let passage = ResolvedPassage(textId: st.translation, bookId: bookId, chapter: chapter, verse: verse,
                                      endVerse: st.endVerse, verseGroups: verseGroups)
        if reuseTab {
            var location = JSObject()
            location["bookId"] = .string(JSString(bookId))
            location["chapter"] = .number(Double(chapter))
            location["translation"] = .string(JSString(st.translation))
            location["verse"] = verse.map { .number(Double($0)) } ?? .null
            location["endVerse"] = st.endVerse.map { .number(Double($0)) } ?? .null
            location["endChapter"] = .null
            location["nativeSelectedVerses"] = passage.savedSelection
            openOrReuse(.bible, in: .scripture, title: title, state: location,
                        canReplace: { !BibleState($0.state).compareMode && $0.state["endChapter"]?.numberValue == nil },
                        matches: passage.isShown(in:))
        } else {
            var state = st.object
            if !verseGroups.isEmpty { state["nativeSelectedVerses"] = passage.savedSelection }
            openTab(.bible, in: .scripture, title: title, state: state)
        }
    }
}

/// Typed view over a Scripture tab's state object (`BibleTabState`); unknown keys are preserved.
struct BibleState: Equatable {
    var bookId: String
    var chapter: Int
    var verse: Int? = nil
    var endVerse: Int? = nil
    var translation = "kjva"
    var showStrongs = false
    var rightPanelOpen = false
    var rightPanelTab = "lexicon"
    var rightPanelLexiconEntry: String? = nil
    var compareMode = false
    var scriptureLayout = "standard"

    init(bookId: String, chapter: Int) { self.bookId = bookId; self.chapter = chapter }

    init(_ o: JSObject) {
        bookId = o["bookId"]?.stringValue?.string ?? "GEN"
        chapter = o["chapter"]?.numberValue.map { Int($0) } ?? 1
        verse = o["verse"]?.numberValue.map { Int($0) }
        endVerse = o["endVerse"]?.numberValue.flatMap { Int(exactly: $0) }
        translation = o["translation"]?.stringValue?.string ?? "kjva"
        showStrongs = o["showStrongs"]?.boolValue ?? false
        rightPanelOpen = o["rightPanelOpen"]?.boolValue ?? false
        rightPanelTab = o["rightPanelTab"]?.stringValue?.string ?? "lexicon"
        rightPanelLexiconEntry = o["rightPanelLexiconEntry"]?.stringValue?.string
        compareMode = o["compareMode"]?.boolValue ?? false
        scriptureLayout = o["scriptureLayout"]?.stringValue?.string ?? "standard"
    }

    var object: JSObject { merged(into: JSObject()) }

    func merged(into base: JSObject) -> JSObject {
        var o = base
        o["bookId"] = .string(JSString(bookId)); o["chapter"] = .number(Double(chapter))
        if let verse { o["verse"] = .number(Double(verse)) } else { o.remove("verse") }
        if let endVerse { o["endVerse"] = .number(Double(endVerse)) } else { o.remove("endVerse") }
        o["translation"] = .string(JSString(translation)); o["showStrongs"] = .bool(showStrongs)
        if o["scrollPosition"] == nil { o["scrollPosition"] = .number(0) }
        o["rightPanelOpen"] = .bool(rightPanelOpen); o["rightPanelTab"] = .string(JSString(rightPanelTab))
        if let e = rightPanelLexiconEntry { o["rightPanelLexiconEntry"] = .string(JSString(e)) } else { o.remove("rightPanelLexiconEntry") }
        if compareMode { o["compareMode"] = .bool(true) } else { o.remove("compareMode") }
        o["scriptureLayout"] = .string(JSString(scriptureLayout))
        return o
    }
}


/// Scripture font choices — the existing app's FONT_FAMILY_OPTIONS keys; web fonts the platform lacks map to the
/// nearest system face (system design for sans, New York for book serifs).
enum ScriptureFont {
    static let options: [(id: String, label: String)] = [
        ("system", "System (San Francisco)"), ("serif", "Serif (Georgia)"), ("palatino", "Palatino"), ("sourceserif", "Book serif (New York)"),
        ("sansserif", "Sans-serif"), ("mono", "Monospace"),
    ]
    static func font(_ family: String, size: Double) -> Font {
        switch family {
        case "serif": return .custom("Georgia", size: size)
        case "palatino": return .custom("Palatino", size: size)
        case "garamond", "crimson", "lora", "merriweather", "sourceserif": return .system(size: size, design: .serif)
        case "mono": return .system(size: size, design: .monospaced)
        default: return .system(size: size)
        }
    }
}
