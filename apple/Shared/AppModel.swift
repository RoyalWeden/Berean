import Foundation
import Observation
import BereanCore
import BereanSQLite
import BereanStore
import BereanWorkspace
import BereanBible
import BereanReference

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

    func update(_ tabId: String, _ change: (inout BereanWorkspace.Tab) -> Void) {
        for sp in SpaceId.allCases {
            guard let idx = sessions[sessionIndex].tabs[sp]?.firstIndex(where: { $0.id == tabId }) else { continue }
            change(&sessions[sessionIndex].tabs[sp]![idx])
            scheduleSave(); return
        }
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

    func openScripture(bookId: String, chapter: Int, verse: Int? = nil, textId: String = "kjva") {
        var st = BibleState(bookId: bookId, chapter: chapter); st.verse = verse; st.translation = textId
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
        return o
    }
}
