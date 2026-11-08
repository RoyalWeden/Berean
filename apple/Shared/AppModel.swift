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

/// The texts the native app offers, in compare/picker order.
struct TextInfo: Identifiable, Hashable { let id: String; let name: String }
let availableTexts: [TextInfo] = [
    .init(id: "kjva", name: "KJV + Apocrypha"), .init(id: "kjv", name: "KJV"), .init(id: "lxx", name: "Septuagint (LXX)"),
    .init(id: "lxx_brenton", name: "Brenton LXX"), .init(id: "enoch", name: "1 Enoch"), .init(id: "jubilees", name: "Jubilees"),
]

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
    var activeSpace: SpaceId = .scripture
    var displayOrders: [String: [String]] = [:]
    var archivedGroups: [ArchivedGroup] = []
    var books: [String: [BookRow]] = [:]
    var libraryError: String?
    var commandPaletteShown = false
    /// One-line result shown in an alert after a user action (export/import outcome, errors).
    var userMessage: String?
    /// Bumped on every note write so note lists and verse dots refresh.
    var notesRevision = 0
    private(set) var notes: NotesService?
    private(set) var highlights: HighlightsService?
    var highlightsRevision = 0
    private(set) var settingsService: SettingsService?
    private(set) var workspaces: WorkspacesService?
    /// Saved workspaces (newest first), shared with the existing apps' Settings → Layout list.
    var savedWorkspaces: [SavedWorkspace] = []
    /// Reading preferences (settings table keys shared with the existing apps where they exist).
    var fontSize: Double = 16 { didSet { saveSetting("fontSize", .number(fontSize)) } }
    var lineHeight = "comfortable" { didSet { saveSetting("lineHeight", .string(JSString(lineHeight))) } }
    var defaultText = "kjva" { didSet { saveSetting("defaultText", .string(JSString(defaultText))) } }
    var wordReplacerEnabled = true { didSet { saveSetting("wordReplacerEnabled", .bool(wordReplacerEnabled)) } }
    var theme = "system" { didSet { saveSetting("theme", .string(JSString(theme))) } }
    private var loadingSettings = false

    private var database: UserDatabase?
    private var sessionsService: SessionsService?
    private var lock: SingleInstanceLock?
    private var keys = TabPersistence.OrderKeyMaps()
    private var saveTask: Task<Void, Never>?

    init() { openLibrary() }

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
        if let v = all["wordReplacerEnabled"]?.boolValue { wordReplacerEnabled = v }
        if let v = all["theme"]?.stringValue?.string { theme = v }
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

    func switchSession(_ id: String) { currentSessionId = id; scheduleSave() }
    func newSession(named name: String = "New Session") {
        let s = Session(id: Self.newId(), name: name)
        sessions.append(s); currentSessionId = s.id
        openTab(.bible, in: .scripture, title: "Genesis 1", state: BibleState(bookId: "GEN", chapter: 1).object)
    }
    func renameSession(_ id: String, to name: String) {
        guard let i = sessions.firstIndex(where: { $0.id == id }), !name.isEmpty else { return }
        sessions[i].name = name; scheduleSave()
    }
    func deleteSession(_ id: String) {
        guard sessions.count > 1, let i = sessions.firstIndex(where: { $0.id == id }) else { return }
        sessions.remove(at: i)
        if currentSessionId == id { currentSessionId = sessions[0].id }
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

    // MARK: saved workspaces (same rows and state_json v2 as src/lib/workspaceSnapshot.ts)

    /// The existing desktop app restores this mosaic tree on load; the native reader keeps its
    /// layout preset per tab (BibleState.scriptureLayout), so a native save writes the desktop default.
    static let legacyDefaultPanelLayout = #"{"direction":"row","first":"bible-panel","second":"notes-panel","splitPercentage":58}"#

    func refreshWorkspaces() { savedWorkspaces = (try? workspaces?.list()) ?? [] }

    @discardableResult
    func saveWorkspace(named name: String) -> Bool {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, let workspaces else { return false }
        let state = WorkspaceSnapshot.stateJSON(for: session, displayOrder: displayOrders[currentSessionId])
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
        let open = Set(sessions.flatMap { $0.allTabs.map(\.id) })
        var idMap: [String: String] = [:]
        var tabs: [SpaceId: [BereanWorkspace.Tab]] = [:]
        var active: [SpaceId: String?] = [:]
        for sp in WorkspaceSnapshot.spaces {
            tabs[sp] = parsed.tabs(in: sp).compactMap { BereanWorkspace.Tab(jsObject: $0) }.map { t in
                guard open.contains(t.id) || idMap[t.id] != nil else { return t }
                var c = t; c.id = "\(t.type)-\(Int64(Date().timeIntervalSince1970 * 1000))-\(Self.newId().prefix(8))"
                idMap[t.id] = c.id; return c
            }
            active[sp] = ((parsed.activeTabId[sp] ?? nil).map { idMap[$0] ?? $0 }) ?? tabs[sp]?.first?.id
        }
        sessions.append(Session(id: sid, name: ws.name, icon: parsed.icon, tabs: tabs, activeTabId: active))
        displayOrders[sid] = parsed.displayOrder.map { idMap[$0] ?? $0 }
        currentSessionId = sid
        if let sp = WorkspaceSnapshot.spaces.first(where: { !(tabs[$0] ?? []).isEmpty }), tabs[activeSpace]?.isEmpty ?? true { activeSpace = sp }
        scheduleSave()
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

    func select(_ tabId: String, in space: SpaceId) {
        sessions[sessionIndex].activeTabId[space] = tabId
        activeSpace = space
        scheduleSave()
    }

    @discardableResult
    func openTab(_ type: TabType, in space: SpaceId, title: String, state: JSObject, origin: BereanWorkspace.Tab? = nil) -> String {
        let id = Self.newId()
        let tab = BereanWorkspace.Tab(id: id, spaceId: space, type: type.rawValue, title: title, state: state, originTabId: origin?.id, originSpaceId: origin?.spaceId)
        if sessions.isEmpty { seedDefault() }
        var list = sessions[sessionIndex].tabs[space] ?? []
        if let cur = activeTabId(in: space), let idx = list.firstIndex(where: { $0.id == cur }) { list.insert(tab, at: idx + 1) } else { list.append(tab) }
        sessions[sessionIndex].tabs[space] = list
        select(id, in: space)
        return id
    }

    func close(_ tabId: String) {
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
        guard let t = findTab(tabId) else { return }
        openTab(t.tabType ?? .bible, in: t.spaceId, title: t.title, state: t.state)
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
            let after = sessions[sessionIndex].tabs[sp]![idx]
            if recordHistory, Self.location(before) != Self.location(after) {
                backStack[tabId, default: []].append((before.title, before.state))
                if backStack[tabId]!.count > 100 { backStack[tabId]!.removeFirst() }
                forwardStack[tabId] = []
            }
            scheduleSave(); return
        }
    }

    // MARK: in-tab history (⌘[ / ⌘]) — the place a tab shows, not presentation details like scroll or panels

    private var backStack: [String: [(String, JSObject)]] = [:]
    private var forwardStack: [String: [(String, JSObject)]] = [:]

    static func location(_ t: BereanWorkspace.Tab) -> String {
        let keys: [String]
        switch t.tabType {
        case .bible: keys = ["bookId", "chapter", "translation"]
        case .note: keys = ["noteId"]
        case .lexicon: keys = ["strongsNum"]
        case .search: keys = ["query"]
        default: keys = []
        }
        return keys.map { k in t.state[k].map { JSON.stringify($0).string } ?? "-" }.joined(separator: "|")
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

    func selectNextTab(_ delta: Int) {
        let list = tabs(in: activeSpace)
        guard !list.isEmpty else { return }
        let cur = list.firstIndex { $0.id == activeTabId(in: activeSpace) } ?? 0
        select(list[(cur + delta + list.count) % list.count].id, in: activeSpace)
    }

    // MARK: opening content

    func books(for textId: String) async -> [BookRow] {
        if let b = books[textId] { return b }
        let b = await bible.getBooks(textId)
        books[textId] = b
        return b
    }

    /// The Cmd+T / Cmd+K command: a reference opens Scripture, a Strong's number the lexicon, anything else a search.
    func openQuery(_ q: String, newTab: Bool = true) {
        let query = q.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return }
        if let ref = Reference.parse(query) {
            var st = BibleState(bookId: ref.bookId, chapter: ref.chapter)
            st.verse = ref.verse
            st.translation = defaultText
            if let forced = ref.forcedTranslation, forced == "LXX" { st.translation = "lxx" }
            let title = Reference.bookChapterLabel(ref.bookId, chapter: Double(ref.chapter))
            if !newTab, let t = activeTab, t.tabType == .bible { update(t.id) { $0.state = st.merged(into: $0.state); $0.title = title } }
            else { openTab(.bible, in: .scripture, title: title, state: st.object) }
        } else if let id = StrongsId.normalize(query) {
            openLexicon(id)
        } else {
            var o = JSObject(); o["query"] = .string(JSString(query))
            openTab(.search, in: .search, title: "Search: \(query)", state: o)
        }
    }

    func openLexicon(_ strongs: String, from origin: BereanWorkspace.Tab? = nil) {
        var o = JSObject(); o["strongsNum"] = .string(JSString(strongs))
        openTab(.lexicon, in: .lexicon, title: strongs, state: o, origin: origin)
    }

    func openNote(_ id: String?) {
        var o = JSObject(); o["noteId"] = id.map { .string(JSString($0)) } ?? .null; o["isNew"] = .bool(false)
        let title = id.flatMap { try? notes?.one($0)?.displayTitle } ?? "Notes"
        if let cur = activeTabId(in: .notes), let t = tabs(in: .notes).first(where: { $0.id == cur }), t.tabType == .note, activeSpace == .notes {
            update(t.id) { $0.state = o; $0.title = title }
        } else { openTab(.note, in: .notes, title: title, state: o) }
    }

    /// New note (optionally attached to a verse, e.g. "GEN.1.1" in `textId`), opened in the Notes space.
    @discardableResult
    func newNote(verseRef: String? = nil, textId: String = "kjva", title: String? = nil) -> String? {
        guard let notes else { libraryError = "The library is not open."; return nil }
        do {
            let label = verseRef.flatMap { r -> String? in
                let p = r.split(separator: ".").map(String.init)
                guard p.count == 3, let c = Int(p[1]), let v = Int(p[2]) else { return nil }
                return Reference.bookChapterVerseLabel(p[0], chapter: c, verse: v)
            }
            let n = try notes.create(.init(type: verseRef == nil ? "general" : "verse", title: title ?? label ?? "", verseRef: verseRef, textId: textId)).note
            openNote(n.id)
            return n.id
        } catch { libraryError = "Could not create the note: \(error)"; return nil }
    }

    func openScripture(bookId: String, chapter: Int, verse: Int? = nil, textId: String? = nil) {
        var st = BibleState(bookId: bookId, chapter: chapter); st.verse = verse; st.translation = textId ?? defaultText
        openTab(.bible, in: .scripture, title: Reference.bookChapterLabel(bookId, chapter: Double(chapter)), state: st.object)
    }
}

/// Typed view over a Scripture tab's state object (`BibleTabState`); unknown keys are preserved.
struct BibleState: Equatable {
    var bookId: String
    var chapter: Int
    var verse: Int? = nil
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
        o["translation"] = .string(JSString(translation)); o["showStrongs"] = .bool(showStrongs)
        if o["scrollPosition"] == nil { o["scrollPosition"] = .number(0) }
        o["rightPanelOpen"] = .bool(rightPanelOpen); o["rightPanelTab"] = .string(JSString(rightPanelTab))
        if let e = rightPanelLexiconEntry { o["rightPanelLexiconEntry"] = .string(JSString(e)) } else { o.remove("rightPanelLexiconEntry") }
        if compareMode { o["compareMode"] = .bool(true) } else { o.remove("compareMode") }
        o["scriptureLayout"] = .string(JSString(scriptureLayout))
        return o
    }
}
