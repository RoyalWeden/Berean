import SwiftUI
import Foundation
import Observation
import OSLog
import CoreGraphics
import BereanCore
import BereanSQLite
import BereanStore
import BereanWorkspace
import BereanBible
import BereanReference
import BereanNotes
import BereanText
#if os(macOS)
import AppKit
#else
import UIKit
#endif

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
    private static let profile: DevelopmentLibraryProfile? = {
        #if DEBUG && os(macOS)
        guard Bundle.main.bundleIdentifier == "com.berean.native.mac.dev" else { return nil }
        do { return try DevelopmentLibraryProfile.parse(arguments: ProcessInfo.processInfo.arguments) }
        catch { fatalError("Invalid QA profile. Refusing to open another library: \(error)") }
        #else
        return nil
        #endif
    }()

    /// @AppStorage and direct preference access must use the same isolated store.
    @MainActor static let defaults: UserDefaults = {
        guard let profile else { return .standard }
        guard let suite = UserDefaults(suiteName: "com.berean.native.mac.dev." + profile.preferencesSuffix) else {
            fatalError("Could not open isolated QA preferences")
        }
        return suite
    }()

    static var directory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        if let profile { return base.appendingPathComponent(profile.directoryName, isDirectory: true) }
        #if DEBUG && os(macOS)
        // Fixed, container-local scratch library for interactive QA while the regular Dev library is open.
        if ProcessInfo.processInfo.arguments.contains("--qa-library"),
           Bundle.main.bundleIdentifier == "com.berean.native.mac.dev" {
            return base.appendingPathComponent("BereanNativeQA", isDirectory: true)
        }
        #endif
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

    /// Shared canonical topology and the sole workspace persistence owner.
    private var workspaceStore = WorkspaceStore()
    var sessions: [Session] {
        get { workspaceStore.sessions }
        set { workspaceStore.sessions = newValue }
        _modify { yield &workspaceStore.sessions }
    }
    var currentSessionId = ""
    var activeSpace: SpaceId = .scripture {
        didSet { rememberWorkspaceSpace() }
    }
    private var workspaceSpaces = UserLibrary.defaults.dictionary(forKey: "nativeWorkspaceSpaces") as? [String: String] ?? [:]

    private func rememberWorkspaceSpace() {
        guard !currentSessionId.isEmpty, activeTab != nil,
              workspaceSpaces[currentSessionId] != activeSpace.rawValue else { return }
        workspaceSpaces[currentSessionId] = activeSpace.rawValue
        UserLibrary.defaults.set(workspaceSpaces, forKey: "nativeWorkspaceSpaces")
    }
    private(set) var recentTabIDs = Array((UserLibrary.defaults.stringArray(forKey: "nativeRecentTabIDs") ?? []).prefix(20))
    private var workspaceRecentTabIDs = UserLibrary.defaults.dictionary(forKey: "nativeWorkspaceRecentTabIDs") as? [String: [String]] ?? [:]

    /// Older installs have only the global recent list. Keep its entries until a workspace has
    /// enough locally recorded visits, and ignore references to tabs that have moved or closed.
    var recentCleanupTabIDs: Set<String> {
        let open = Set(orderedTabs.map(\.id))
        let recorded = workspaceRecentTabIDs[currentSessionId, default: []]
        var seen = Set<String>()
        return Set((recorded + recentTabIDs).filter { open.contains($0) && seen.insert($0).inserted }.prefix(5))
    }
    var displayOrders: [String: [String]] {
        get { workspaceStore.displayOrders }
        set { workspaceStore.displayOrders = newValue }
        _modify { yield &workspaceStore.displayOrders }
    }
    var archivedGroups: [ArchivedGroup] {
        get { workspaceStore.archivedGroups }
        set { workspaceStore.archivedGroups = newValue }
        _modify { yield &workspaceStore.archivedGroups }
    }
    var books: [String: [BookRow]] = [:]
    var libraryError: String?
    var commandPaletteShown = false {
        didSet {
            #if os(macOS)
            if !commandPaletteShown { cancelPaletteKeyboardCapture() }
            #endif
        }
    }
    #if os(macOS)
    var commandPaletteCreatesTab = false
    var commandPaletteActionsRequest = 0
    @ObservationIgnored private var paletteKeyMonitor: Any?
    @ObservationIgnored private weak var paletteKeyWindow: NSWindow?
    private enum PalettePendingInput {
        case key(NSEvent)
        case paste(String)
    }
    @ObservationIgnored private var palettePendingKeys: [PalettePendingInput] = []

    /// Keep fast typing with the location request while its overlay mounts.
    /// Events are replayed through AppKit only after the real query editor owns
    /// focus. No key can fall through into the previous reader or Notes editor.
    private func beginPaletteKeyboardCapture() {
        cancelPaletteKeyboardCapture()
        guard let window = NSApp.keyWindow else { return }
        paletteKeyWindow = window
        window.makeFirstResponder(nil)
        paletteKeyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            let captured = MainActor.assumeIsolated {
                guard let self, self.commandPaletteShown, event.window === self.paletteKeyWindow else { return false }
                if event.modifierFlags.contains(.command) {
                    let key = event.charactersIgnoringModifiers?.lowercased() ?? ""
                    // Location/app commands remain live; text-editing shortcuts
                    // belong to the pending query, including immediate paste.
                    guard ["a", "v", "x", "c", "z"].contains(key) else { return false }
                    if key == "v", let text = NSPasteboard.general.string(forType: .string) {
                        // Paste uses the clipboard at the user's keypress,
                        // even if a clipboard manager changes it before mount.
                        self.palettePendingKeys.append(.paste(text))
                        return true
                    }
                }
                self.palettePendingKeys.append(.key(event))
                return true
            }
            return captured ? nil : event
        }
    }

    private func cancelPaletteKeyboardCapture() {
        if let monitor = paletteKeyMonitor { NSEvent.removeMonitor(monitor) }
        paletteKeyMonitor = nil
        paletteKeyWindow = nil
        palettePendingKeys.removeAll()
    }

    func paletteQueryEditorReady(_ field: NSTextField, request: UUID?) {
        guard commandPaletteShown, commandPaletteLocationRequest?.id == request,
              let window = field.window, window === paletteKeyWindow,
              let editor = field.currentEditor() as? NSTextView, window.firstResponder === editor else { return }
        let keys = palettePendingKeys
        cancelPaletteKeyboardCapture()
        for input in keys {
            guard commandPaletteShown, commandPaletteLocationRequest?.id == request,
                  field.window === window, window.firstResponder === field.currentEditor() else { break }
            switch input {
            case .key(let event): NSApp.sendEvent(event)
            case .paste(let text): editor.insertText(text, replacementRange: NSRange(location: NSNotFound, length: 0))
            }
        }
    }

    struct LocationRequest: Equatable {
        let text: String
        let id = UUID()
    }
    private(set) var commandPaletteLocationRequest: LocationRequest?

    func showLocation() {
        let text: String
        if let tab = activeTab {
            switch tab.tabType {
            case .bible:
                text = tab.navigationLabel
            case .lexicon:
                let entry = tab.state["strongsNum"]?.stringValue?.string ?? ""
                text = entry.isEmpty ? lexiconSearches[tab.id]?.query ?? "" : entry
            case .search:
                text = tab.state["query"]?.stringValue?.string ?? ""
            case .note:
                text = tab.state["noteId"]?.stringValue != nil ? tab.title : notesBrowseOptions[tab.id]?.query ?? ""
            default:
                text = ""
            }
        } else {
            text = ""
        }
        commandPaletteCreatesTab = false
        commandPaletteLocationRequest = LocationRequest(text: text)
        commandPaletteShown = true
        beginPaletteKeyboardCapture()
    }

    func showCommandPalette(newTab: Bool = false) {
        let mountsField = !commandPaletteShown || commandPaletteLocationRequest != nil
        commandPaletteCreatesTab = newTab
        commandPaletteLocationRequest = nil
        commandPaletteShown = true
        if mountsField { beginPaletteKeyboardCapture() }
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
    var notesRevision = 0 { didSet { refreshIdiomsIfNeeded() } }
    @ObservationIgnored private var mountedNoteEditors: [String: Set<UUID>] = [:]
    @ObservationIgnored private var pendingNoteFinalizations: [String: Note] = [:]
    @ObservationIgnored private var strongsNotesIndex: (revision: Int, task: Task<NoteStrongsIndex, Never>)?

    /// One off-main parse per note revision, shared by the full entry and study inspector.
    /// Fetch the SQLite snapshot on the app actor, then keep parsing off the UI actor.
    func notesCitingStrongs(_ number: String) async throws -> [Note] {
        let revision = notesRevision
        let task: Task<NoteStrongsIndex, Never>
        if let cached = strongsNotesIndex, cached.revision == revision {
            task = cached.task
        } else {
            let snapshot = try notes?.all(limit: Int.max) ?? []
            task = Task.detached(priority: .utility) { NoteStrongsIndex(notes: snapshot) }
            strongsNotesIndex = (revision, task)
        }
        let index = await task.value
        try Task.checkCancellation()
        // An edit during parsing must not publish stale note titles or resurrect trashed notes.
        guard notesRevision == revision else { return try await notesCitingStrongs(number) }
        return index.notes(citing: number)
    }

    private(set) var notes: NotesService?
    private(set) var highlights: HighlightsService?
    var highlightsRevision = 0
    private(set) var settingsService: SettingsService?
    private(set) var workspaces: WorkspacesService?
    private(set) var verseTags: VerseTagsService?
    private(set) var tagGraph: TagGraphService?
    private(set) var pdfs: PdfService?
    private(set) var chats: ChatsService?
    /// Read-only YouTube transcripts (segments come from data packs / desktop; never fetched here).
    private(set) var transcripts: TranscriptService?
    /// Background transcript search (separate read-only connection).
    private(set) var transcriptSearcher: TranscriptSearcher?
    var chatsRevision = 0
    var chatShown = false   // iPhone sheet
    var pdfsRevision = 0
    var showStudyTrail = false
    /// A trail to open when the Study Trail sheet appears (deep link `trail/<id>`).
    var studyTrailOpenRequest: String?
    /// Mac: ask the main window to open the Berean Chat window (deep link `chat`).
    var chatWindowRequest = 0
    var studyTrailRecording: StudyTrailRecording?
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
    /// Original `idiomHighlightEnabled` (default on): underline idiom terms in Scripture.
    var idiomHighlightEnabled = true { didSet { saveSetting("idiomHighlightEnabled", .bool(idiomHighlightEnabled)) } }
    /// Live WebKit pages for open YouTube tabs (kept while the tab exists so playback and PiP survive tab switches).
    @ObservationIgnored var youtubePages: [String: AnyObject] = [:]
    /// ⇧⌘P (original Cmd+Shift+P): toggle Picture in Picture for the active YouTube tab.
    var pipToggleRequest = 0
    private(set) var idioms: [Idiom] = []
    private(set) var idiomMatcher = Idioms.Matcher([])
    private var idiomsRevisionLoaded = -1

    /// Reloads idiom notes when notes changed (cheap: one indexed query).
    func refreshIdiomsIfNeeded() {
        guard idiomsRevisionLoaded != notesRevision, let db = database?.connection else { return }
        idiomsRevisionLoaded = notesRevision
        let next = (try? Idioms.list(db: db)) ?? []
        if next != idioms { idioms = next; idiomMatcher = Idioms.Matcher(next) }
    }
    /// Persisted per-rule switches (`wordReplacerRules`, the original apps' array). Unknown fields survive.
    var wordReplacerRuleSet = WordReplacerRuleSet(stored: nil) {
        didSet { if wordReplacerRuleSet != oldValue { saveSetting("wordReplacerRules", wordReplacerRuleSet.stored) } }
    }
    /// The rules every Scripture surface applies (all of them, with their own `enabled` switches).
    var wordReplacerRules: [WordReplacerRule] { wordReplacerRuleSet.rules }
    /// Changes whenever rendered Scripture text could change — use in task/cache identities.
    var wordReplacerKey: String { wordReplacerEnabled ? "on:" + wordReplacerRuleSet.revisionKey : "off" }
    var theme = "system" { didSet { saveSetting("theme", .string(JSString(theme))) } }
    /// Original `themePreset` (a preset id, "" = Default). Natively: the Scripture page colours.
    var themePreset = "" { didSet { saveSetting("themePreset", .string(JSString(themePreset))) } }
    /// The existing apps' font-family settings ('system' = the platform UI font).
    var notesFontFamily = "system" { didSet { saveSetting("notesFontFamily", .string(JSString(notesFontFamily))) } }
    var scriptureFontFamily = "system" { didSet { saveSetting("scriptureFontFamily", .string(JSString(scriptureFontFamily))) } }
    var noteVerseRefsEnabled = true { didSet { saveSetting("noteVerseRefsEnabled", .bool(noteVerseRefsEnabled)) } }
    var noteLexiconRefsEnabled = true { didSet { saveSetting("noteLexiconRefsEnabled", .bool(noteLexiconRefsEnabled)) } }
    var noteStrongsBlockSuggest = true { didSet { saveSetting("noteStrongsBlockSuggest", .bool(noteStrongsBlockSuggest)) } }
    var noteVerseBlockSuggest = true { didSet { saveSetting("noteVerseBlockSuggest", .bool(noteVerseBlockSuggest)) } }
    var noteScriptureBlock = false { didSet { saveSetting("noteScriptureBlock", .bool(noteScriptureBlock)) } }
    var noteScriptureBlockThreshold = 0.9 {
        didSet {
            let safe = NoteScriptureSelection.threshold(noteScriptureBlockThreshold)
            if safe != noteScriptureBlockThreshold { noteScriptureBlockThreshold = safe }
            saveSetting("noteScriptureBlockThreshold", .number(safe))
        }
    }
    var autoCopyOnHighlight = false { didSet { saveSetting("autoCopyOnHighlight", .bool(autoCopyOnHighlight)) } }
    var confirmNoteDelete = false { didSet { saveSetting("confirmNoteDelete", .bool(confirmNoteDelete)) } }
    var noteSpellCheck = true { didSet { saveSetting("noteSpellCheck", .bool(noteSpellCheck)) } }
    var defaultNoteStatus = "none" { didSet { saveSetting("defaultNoteStatus", .string(JSString(defaultNoteStatus))) } }
    private var loadingSettings = false

    private(set) var database: UserDatabase?
    /// Bumps when Getting Started progress changes.
    var gettingStartedRevision = 0
    var gettingStartedShown = false
    var askBereanShown = false
    var askSettingsRevision = 0
    /// Original `aiLookupCollections` (Ask options): which collections Ask Berean searches.
    var askCollections: [ModelFreeAsk.Collection] {
        get {
            _ = askSettingsRevision   // re-read after a change
            let stored = (settingValue("aiLookupCollections")?.arrayValue ?? []).compactMap { $0.stringValue.flatMap { ModelFreeAsk.Collection(rawValue: $0.string) } }
            return stored.isEmpty ? ModelFreeAsk.defaultCollections : stored
        }
        set {
            let value = newValue.isEmpty ? [ModelFreeAsk.Collection.canon] : newValue   // original: never empty
            saveSetting("aiLookupCollections", .array(value.map { .string(JSString($0.rawValue)) }))
            askSettingsRevision += 1
        }
    }
    private var lock: SingleInstanceLock?
    private var saveTask: Task<Void, Never>?
    private let workspaceSaveSignposter = OSSignposter(subsystem: "com.berean.native", category: "WorkspacePersistence")
    private let workspaceSaveLogger = Logger(subsystem: "com.berean.native", category: "WorkspacePersistence")

    init() {
        openLibrary(); loadBookCatalog(); evaluateOnboarding(); refreshIdiomsIfNeeded()
        crashReport = CrashReporter.stored()
        crashReporter = CrashReporter(app: self)
    }

    /// Last crash (MetricKit) not yet dismissed — the original "App recovered from a crash" notice.
    var crashReport: CrashSummary?
    @ObservationIgnored private var crashReporter: CrashReporter?

    // MARK: onboarding (the original's per-device `onboardingCompleted` gate)

    var onboardingShown = false

    // MARK: presenter (Mac second window)
    var presenterOpen = false
    /// CC-05: where the main window's note editor is scrolled (0…1), for the Presenter to follow.
    /// Ephemeral — never persisted or synced; keyed by note so a switch never applies an old offset.
    var presenterNoteViewport: PresenterNoteViewport?
    struct PresenterAnchor: Equatable { var tabId: String; var edition: ChapterEdition; var verse: Int? }
    /// The main reader's top visible verse, published only while the presenter is open.
    var presenterAnchor: PresenterAnchor?
    struct PresenterSelection: Equatable {
        var tabId: String
        var edition: ChapterEdition
        var verses: Set<Int>
        var requestsFocus = true
    }
    /// The main reader's selected verses, published only while the presenter is open.
    var presenterSelection: PresenterSelection?
    #if os(macOS)
    struct ComparePresentation: Equatable {
        let owner: UUID
        let tabID: String
        let configuration: ComparePresentationConfiguration
        let columnID: Int
        let columnDestination: String
        let edition: ChapterEdition
        let verses: Set<Int>
        let focus: Int?
    }
    var comparePresentation: ComparePresentation?
    #endif
    var eSwordImportShown = false

    /// Shows the getting-started flow only for a genuinely new library: not completed on this
    /// device *and* no notes, highlights or tags yet — so existing libraries (and QA copies of
    /// them) are never interrupted by a first-launch sheet.
    private func evaluateOnboarding() {
        guard let db = database?.connection,
              (try? settingsService?.all())?["onboardingCompleted"]?.boolValue != true else { return }
        let used = (try? db.query("SELECT (SELECT COUNT(*) FROM notes) + (SELECT COUNT(*) FROM highlights) + (SELECT COUNT(*) FROM verse_tags) AS n"))?
            .first.flatMap { row -> Int64? in if case .integer(let n)? = row["n"] { return n } else { return nil } } ?? 1
        onboardingShown = used == 0
    }

    func completeOnboarding() {
        try? settingsService?.set("onboardingCompleted", .bool(true))
        onboardingShown = false
        // The starter tab was seeded before the choice; give it the chosen text if still untouched.
        let tabs = session.allTabs
        if tabs.count == 1, let tab = tabs.first, tab.tabType == .bible {
            var st = BibleState(tab.state)
            if st.bookId == "GEN", st.chapter == 1, st.translation != defaultText {
                st.translation = defaultText
                update(tab.id, recordHistory: false) { $0.state = st.merged(into: $0.state) }
            }
        }
    }

    func replayOnboarding() { onboardingShown = true }

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
            database = db
            notes = NotesService(db: db.connection, onChange: { [weak self] _, _, _ in Task { @MainActor in self?.notesRevision += 1 } })
            settingsService = SettingsService(db: db.connection)
            workspaces = WorkspacesService(db: db.connection, now: { Int64(Date().timeIntervalSince1970 * 1000) }, uuid: { Self.newId() }, onChange: { _ in })
            savedWorkspaces = (try? workspaces?.list()) ?? []
            historyService = HistoryService(db: db.connection)
            studyTrailService = StudyTrailService(db: db.connection)
            verseTags = VerseTagsService(db: db.connection, onChange: { [weak self] _, _, _ in Task { @MainActor in self?.tagsRevision += 1 } })
            pdfs = PdfService(db: db.connection, onChange: { [weak self] _, _, _ in Task { @MainActor in self?.pdfsRevision += 1 } })
            transcripts = TranscriptService(db: db.connection)
            transcriptSearcher = try? TranscriptSearcher(databasePath: db.connection.path)
            chats = ChatsService(db: db.connection, onChange: { [weak self] _, _, _ in Task { @MainActor in self?.chatsRevision += 1 } })
            if let verseTags {
                tagGraph = TagGraphService(db: db.connection, tags: verseTags,
                                           onChange: { [weak self] _, _, _ in Task { @MainActor in self?.tagsRevision += 1 } })
            }
            loadSettings()
            highlights = HighlightsService(db: db.connection, onChange: { [weak self] _, _, _, _ in Task { @MainActor in self?.highlightsRevision += 1 } })
            let rows = try svc.allRows()
            var local: [String: [String: String?]] = [:]
            for s in rows.sessions {
                let o = try svc.localState(sessionId: s.id)
                local[s.id] = Dictionary(uniqueKeysWithValues: o.entries.map { ($0.key.string, $0.value.stringValue?.string) })
            }
            let h = TabPersistence.hydrate(sessions: rows.sessions, tabs: rows.tabs, groups: rows.groups, localState: local)
            // Enable the durable writer only after every persisted workspace row
            // has been read successfully. A failed read must not save a seeded
            // fallback over the library's real tabs.
            workspaceStore = WorkspaceStore(service: svc,
                                            sessions: h.sessions.map { SearchOptionsStore.restoring(in: $0) },
                                            displayOrders: h.displayOrders, archivedGroups: h.archivedGroups,
                                            orderKeys: h.keys)
            if h.sessions.isEmpty { seedDefault() } else {
                currentSessionId = UserLibrary.defaults.string(forKey: "currentSessionId").flatMap { id in sessions.contains { $0.id == id } ? id : nil } ?? sessions[0].id
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
        if let v = all["idiomHighlightEnabled"]?.boolValue { idiomHighlightEnabled = v }
        if let v = all["themePreset"]?.stringValue?.string { themePreset = v }
        PrintPreferences.current = PrintPreferences(settings: all)
        wordReplacerRuleSet = WordReplacerRuleSet(stored: all["wordReplacerRules"])
        if let v = all["theme"]?.stringValue?.string { theme = v }
        if let v = all["notesFontFamily"]?.stringValue?.string, !v.isEmpty { notesFontFamily = v }
        if let v = all["scriptureFontFamily"]?.stringValue?.string { scriptureFontFamily = v }
        if let v = all["noteVerseRefsEnabled"]?.boolValue { noteVerseRefsEnabled = v }
        if let v = all["noteLexiconRefsEnabled"]?.boolValue { noteLexiconRefsEnabled = v }
        if let v = all["noteStrongsBlockSuggest"]?.boolValue { noteStrongsBlockSuggest = v }
        if let v = all["noteVerseBlockSuggest"]?.boolValue { noteVerseBlockSuggest = v }
        if let v = all["noteScriptureBlock"]?.boolValue { noteScriptureBlock = v }
        if let v = all["noteScriptureBlockThreshold"]?.numberValue {
            noteScriptureBlockThreshold = NoteScriptureSelection.threshold(v)
        }
        if let v = all["autoCopyOnHighlight"]?.boolValue { autoCopyOnHighlight = v }
        if let v = all["confirmNoteDelete"]?.boolValue { confirmNoteDelete = v }
        if let v = all["noteSpellCheck"]?.boolValue { noteSpellCheck = v }
        if let v = all["defaultNoteStatus"]?.stringValue?.string, !v.isEmpty { defaultNoteStatus = v }
        loadingSettings = false
    }

    /// One stored setting (original keys), for features that read settings on demand.
    func settingValue(_ key: String) -> JSValue? { (try? settingsService?.all())?[key] }

    func saveSetting(_ key: String, _ v: JSValue) {
        guard !loadingSettings else { return }
        try? settingsService?.set(key, v)
    }

    var lineSpacing: CGFloat { lineHeight == "compact" ? 2 : lineHeight == "spacious" ? 9 : 5 }


    func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            // A separate QA library can make the pending-save lifecycle race
            // deterministic without changing a user setting or persisted data.
            #if DEBUG && os(macOS)
            let arguments = ProcessInfo.processInfo.arguments
            let delay: Duration = arguments.contains("--qa-library") && arguments.contains("--qa-slow-workspace-save")
                ? .seconds(10) : .milliseconds(400)
            #else
            let delay: Duration = .milliseconds(400)
            #endif
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            _ = self?.saveNow()
        }
    }

    /// False means live workspace edits still need a successful retry. Mac Quit
    /// must keep the process alive so the existing library alert can be shown.
    @discardableResult func saveNow() -> Bool {
        // An explicit lifecycle flush covers the queued debounce as well.
        saveTask?.cancel()
        saveTask = nil
        guard workspaceStore.canPersist else { return true }
        flushCompareBookmarks()
        flushSearchViewports()
        let started = ContinuousClock.now
        let interval = workspaceSaveSignposter.beginInterval("Save workspace state")
        defer {
            workspaceSaveSignposter.endInterval("Save workspace state", interval)
            let elapsed = started.duration(to: .now)
            if elapsed >= .milliseconds(250) {
                workspaceSaveLogger.warning("Workspace save exceeded 250ms: \(String(describing: elapsed), privacy: .public)")
            }
        }
        do {
            if try workspaceStore.save() {
                UserLibrary.defaults.set(currentSessionId, forKey: "currentSessionId")
            }
            return true
        } catch {
            libraryError = "Saving tabs failed: \(error)"
            return false
        }
    }

    // MARK: sessions

    var sessionIndex: Int { sessions.firstIndex { $0.id == currentSessionId } ?? 0 }
    var session: Session { sessions.isEmpty ? Session(id: "", name: "") : sessions[sessionIndex] }

    func workspaceReadingSpace(_ id: String) -> SpaceId? {
        id == currentSessionId ? activeSpace : workspaceSpaces[id].flatMap(SpaceId.init(rawValue:))
    }

    func switchSession(_ id: String, preferredSpace: SpaceId? = nil, rememberPrevious: Bool = true) {
        guard id != currentSessionId, let destination = sessions.first(where: { $0.id == id }) else { return }
        if rememberPrevious { rememberActiveTab() }
        scriptureHistoryRestore = nil
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
    func newSession(named name: String = "New Workspace") {
        let s = Session(id: Self.newId(), name: name)
        sessions.append(s); switchSession(s.id)
        openTab(.bible, in: .scripture, title: "Genesis 1", state: BibleState(bookId: "GEN", chapter: 1).object)
    }
    /// Runs a user-initiated change and reports a failure instead of swallowing it (audit: silent `try?`).
    func attempt(_ failure: String, _ body: () throws -> Void) {
        do { try body() } catch { userMessage = "\(failure) (\(error.localizedDescription))" }
    }

    func highlightVerses(_ rows: [ChapterVerseRow], color: String, textID: String, copy: () -> Void) {
        guard let highlights, !rows.isEmpty else { return }
        attempt("Couldn’t highlight the verses") {
            for row in rows {
                try highlights.setVerseColor(bookId: row.bookId, chapter: row.chapter, verse: row.verseNum,
                                             color: color, textId: textID)
            }
            if autoCopyOnHighlight { copy() }
        }
    }

    func setSessionIcon(_ id: String, _ icon: String?) {
        guard let i = sessions.firstIndex(where: { $0.id == id }) else { return }
        sessions[i].icon = icon; scheduleSave()
    }
        func renameSession(_ id: String, to name: String) {
        guard let i = sessions.firstIndex(where: { $0.id == id }), !name.isEmpty else { return }
        sessions[i].name = name; scheduleSave()
    }
    func deleteSession(_ id: String) {
        guard sessions.count > 1, let i = sessions.firstIndex(where: { $0.id == id }) else { return }
        sessions.remove(at: i)
        workspaceSpaces.removeValue(forKey: id)
        workspaceRecentTabIDs.removeValue(forKey: id)
        UserLibrary.defaults.set(workspaceRecentTabIDs, forKey: "nativeWorkspaceRecentTabIDs")
        UserLibrary.defaults.set(workspaceSpaces, forKey: "nativeWorkspaceSpaces")
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
    /// Original `historyMaxEntries` (50–10,000). Unset keeps the native 5,000 so nothing already kept is pruned.
    var historyMaxEntries: Int {
        get { _ = historySettingsRevision; return settingValue("historyMaxEntries")?.numberValue.map { min(10_000, max(50, Int($0))) } ?? Self.historyEntryLimit }
        set { saveSetting("historyMaxEntries", .number(Double(min(10_000, max(50, newValue))))); historySettingsRevision += 1 }
    }
    /// Original `tabNavMaxStack` (10–1,000, default 100): back/forward pages remembered per tab.
    var tabNavMaxStack: Int {
        get { _ = historySettingsRevision; return settingValue("tabNavMaxStack")?.numberValue.map { min(1_000, max(10, Int($0))) } ?? 100 }
        set { saveSetting("tabNavMaxStack", .number(Double(min(1_000, max(10, newValue))))); historySettingsRevision += 1 }
    }
    var historySettingsRevision = 0
    var printSettingsRevision = 0
    var customThemesRevision = 0
    /// Original "Clear all tab nav history".
    func clearAllTabNavigation() { backStack = [:]; forwardStack = [:] }
    var tabNavEntryCount: Int { backStack.values.reduce(0) { $0 + $1.count } + forwardStack.values.reduce(0) { $0 + $1.count } }

    @discardableResult
    func recordHistory(type: String, title: String, bookId: String? = nil, chapter: Int? = nil, verse: Int? = nil, noteId: String? = nil, strongsNum: String? = nil, query: String? = nil, deduplicate: Bool = true) -> String? {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let e = HistoryEntry(id: "hist-\(now)-\(Self.newId().prefix(8))", type: type, title: title, timestamp: now, sessionId: currentSessionId, sessionName: session.name,
                             bookId: bookId, chapter: chapter, verse: verse, noteId: noteId, strongsNum: strongsNum, query: query)
        guard (try? historyService?.add(e, maxEntries: historyMaxEntries, deduplicate: deduplicate)) == true else { return nil }
        historyRevision += 1
        return e.id
    }

    func openHistory(newTab: Bool = false, preferActiveTab: Bool = false) {
        openUtilityTab(.history, in: .search, title: "History", newTab: newTab, preferActiveTab: preferActiveTab)
    }

    func openTags(newTab: Bool = false, preferActiveTab: Bool = false) {
        openUtilityTab(.tags, in: .notes, title: "Tags", newTab: newTab, preferActiveTab: preferActiveTab)
    }

    /// A YouTube tab (YouTube space, original `{videoId, playlistId}` state); reuses an open one.
    func openYouTube(newTab: Bool = false) {
        if !newTab, let tab = session.allTabs.first(where: { $0.tabType == .youtube }) { select(tab.id, in: tab.spaceId); return }
        var state = JSObject(); state["videoId"] = .null; state["playlistId"] = .null
        openTab(.youtube, in: .youtube, title: "YouTube", state: state)
    }

    /// Load request for a YouTube tab's live page (a transcript hit → video at that moment).
    var youtubeLoadRequest: (tabId: String, url: URL, nonce: Int)?

    /// Opens a video at `startMs` in the YouTube tab (reusing an open one).
    func openYouTubeVideo(_ videoId: String, startMs: Int = 0) {
        let secs = startMs / 1000
        guard let url = URL(string: "https://www.youtube.com/watch?v=\(videoId)" + (secs > 0 ? "&t=\(secs)s" : "")) else { return }
        if let tab = session.allTabs.first(where: { $0.tabType == .youtube }) {
            update(tab.id, recordHistory: false) { $0.state["url"] = .string(JSString(url.absoluteString)); $0.state["videoId"] = .string(JSString(videoId)) }
            youtubeLoadRequest = (tab.id, url, (youtubeLoadRequest?.nonce ?? 0) + 1)
            select(tab.id, in: tab.spaceId)
        } else {
            var state = JSObject(); state["videoId"] = .string(JSString(videoId)); state["playlistId"] = .null
            state["url"] = .string(JSString(url.absoluteString))
            openTab(.youtube, in: .youtube, title: "YouTube", state: state)
        }
    }

    /// The PDF library (a `pdf` tab without `pdfId`, as the original's picker).
    func openPdfLibrary(newTab: Bool = false, preferActiveTab: Bool = false) {
        if !newTab, let tab = session.allTabs.first(where: { $0.tabType == .pdf && $0.state["pdfId"]?.stringValue == nil }) {
            select(tab.id, in: tab.spaceId); return
        }
        if !newTab, preferActiveTab, replaceCurrentTab(.pdf, in: .scripture, title: "PDFs", state: JSObject()) { return }
        openTab(.pdf, in: .scripture, title: "PDFs", state: JSObject())
    }

    /// Opens a PDF (focusing an existing tab for it, as the original `openPdf`), optionally at a page.
    func openPdf(_ id: String, title: String, page: Int? = nil, replacing tabId: String? = nil) {
        if let tab = session.allTabs.first(where: { $0.tabType == .pdf && $0.state["pdfId"]?.stringValue?.string == id }) {
            if let page { update(tab.id) { $0.state["page"] = .number(Double(page)) } }
            select(tab.id, in: tab.spaceId); return
        }
        var state = JSObject()
        state["pdfId"] = .string(JSString(id)); state["title"] = .string(JSString(title))
        if let page { state["page"] = .number(Double(page)) }
        if let tabId, findTab(tabId) != nil {
            update(tabId) { $0.type = TabType.pdf.rawValue; $0.title = title; $0.state = state }
            return
        }
        openTab(.pdf, in: .scripture, title: title, state: state)
    }

    func openUtilityTab(_ type: TabType, in space: SpaceId, title: String, newTab: Bool, preferActiveTab: Bool = false) {
        if !newTab, preferActiveTab, replaceCurrentTab(type, in: space, title: title, state: JSObject()) { return }
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

    var activeReaderState: BibleState? {
        guard let tab = activeTab, tab.tabType == .bible else { return nil }
        return BibleState(tab.state)
    }

    func setReaderCompareMode(_ enabled: Bool, in tabId: String? = nil) {
        setReaderFlag(\.compareMode, to: enabled, in: tabId)
    }

    func setReaderStudyPanelOpen(_ enabled: Bool, in tabId: String? = nil) {
        setReaderFlag(\.rightPanelOpen, to: enabled, in: tabId)
    }

    private func setReaderFlag(_ flag: WritableKeyPath<BibleState, Bool>, to enabled: Bool, in tabId: String?) {
        guard let tab = activeTab, tab.tabType == .bible, tabId == nil || tab.id == tabId,
              BibleState(tab.state)[keyPath: flag] != enabled else { return }
        update(tab.id) { tab in
            var reader = BibleState(tab.state)
            reader[keyPath: flag] = enabled
            tab.state = reader.merged(into: tab.state)
        }
    }

    private func rememberActiveTab() {
        guard let id = activeTab?.id else { return }
        recentTabIDs.removeAll { $0 == id }
        recentTabIDs.insert(id, at: 0)
        if recentTabIDs.count > 20 { recentTabIDs.removeLast() }
        UserLibrary.defaults.set(recentTabIDs, forKey: "nativeRecentTabIDs")
        let open = Set(session.allTabs.map(\.id))
        let previous = workspaceRecentTabIDs[currentSessionId, default: []]
        workspaceRecentTabIDs[currentSessionId] = Array(([id] + previous.filter { $0 != id && open.contains($0) }).prefix(10))
        UserLibrary.defaults.set(workspaceRecentTabIDs, forKey: "nativeWorkspaceRecentTabIDs")
    }

    func select(_ tabId: String, in space: SpaceId, rememberPrevious: Bool = true) {
        if rememberPrevious, activeTab?.id != tabId { rememberActiveTab() }
        if let restore = scriptureHistoryRestore, restore.tabID != tabId { scriptureHistoryRestore = nil }
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

    private func insertTab(_ incoming: BereanWorkspace.Tab, after displayAnchor: String?, inSpaceAfter spaceAnchor: String?) {
        var tab = incoming
        if tab.tabType == .search { tab.state = SearchOptionsStore.capturing(SearchOptionsStore.restoring(tab.state)) }
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

    /// Tab-type switcher (original TabTypeSwitcher): turns the current tab into another kind of tab in its place.
    /// Implemented as open-new-then-close so it reuses the normal open paths and never mutates a tab's type in storage.
    enum TabKind: String, CaseIterable { case scripture = "Scripture", notes = "Notes", lexicon = "Lexicon", search = "Search", history = "History" }
    func switchTab(_ tabId: String, to kind: TabKind) {
        guard let old = findTab(tabId) else { return }
        switch kind {
        case .scripture: openScripture(bookId: recentPassages.first?.bookId ?? "GEN", chapter: recentPassages.first?.chapter ?? 1,
                                       textId: recentPassages.first?.textId, reuseTab: false)
        case .notes: openNotesHome(newTab: true)
        case .lexicon: openLexiconSearch(newTab: true)
        case .search: openSearch("", reuseTab: false)
        case .history: openHistory(newTab: true)
        }
        if activeTab?.id != old.id { close(old.id) }
    }

    /// Closes every unpinned tab in the current workspace except `tabId` (pinned tabs stay, as in the original).
    func closeOthers(_ tabId: String) {
        for t in orderedTabs where t.id != tabId && !t.isPinned { close(t.id) }
        if let keep = findTab(tabId) { select(keep.id, in: keep.spaceId) }
    }

    func close(_ tabId: String) {
        searchViewportRecords.removeValue(forKey: tabId)
        currentSearchVisits.removeValue(forKey: tabId)
        searchVisibleRows.removeValue(forKey: tabId)
        searchResultAnchors.removeValue(forKey: tabId)
        if searchHistoryRevision?.tabID == tabId { searchHistoryRevision = nil }
        compareScrollOffsets.removeValue(forKey: tabId)
        compareColumnScrollVerses.removeValue(forKey: tabId)
        compareIndependentVisitPositions.removeValue(forKey: tabId)
        compareVisitLayouts.removeValue(forKey: tabId)
        pendingCompareBookmarks.removeValue(forKey: tabId)
        compareBookmarkRecords.removeValue(forKey: tabId)
        compareSelections.removeValue(forKey: tabId)
        if compareHistoryRestore?.tabID == tabId { compareHistoryRestore = nil }
        studyVerseFocus.removeValue(forKey: tabId)
        dailyTimelinePositions.removeValue(forKey: tabId)
        // Closing the tab on screen selects its neighbour in the sidebar list (below, else above).
        let wasActive = activeTab?.id == tabId
        let ordered = orderedTabs
        let neighbour: BereanWorkspace.Tab? = ordered.firstIndex { $0.id == tabId }.flatMap { i in
            i + 1 < ordered.count ? ordered[i + 1] : (i > 0 ? ordered[i - 1] : nil)
        }
        defer { if wasActive, let n = neighbour, findTab(n.id) != nil { select(n.id, in: n.spaceId) } }
        for sp in SpaceId.allCases {
            guard var list = sessions[sessionIndex].tabs[sp], let idx = list.firstIndex(where: { $0.id == tabId }) else { continue }
            if scriptureHistoryRestore?.tabID == tabId { scriptureHistoryRestore = nil }
            let closed = list.remove(at: idx)
            sessions[sessionIndex].tabs[sp] = list
            if activeTabId(in: sp) == tabId { sessions[sessionIndex].activeTabId[sp] = list.isEmpty ? nil : list[min(idx, list.count - 1)].id }
            if closed.tabType == .note, let id = closed.state["noteId"]?.stringValue?.string {
                finalizeNoteIfClosed(id)
            }
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
        moveTabs([tabId], toSession: target)
    }

    @discardableResult
    func moveTabs(_ ids: [String], toSession target: String) -> Int {
        let sourceID = currentSessionId
        guard target != sourceID, let targetIndex = sessions.firstIndex(where: { $0.id == target }) else { return 0 }
        let sourceIndex = sessionIndex
        var source = sessions[sourceIndex]
        var destination = sessions[targetIndex]
        let requested = Set(ids).subtracting(destination.allTabs.map(\.id))
        let order = orderedTabs
        let moving = order.filter { requested.contains($0.id) }
        guard !moving.isEmpty else { return 0 }
        let movedIDs = Set(moving.map(\.id))
        let sourceOrder = displayOrder(for: sourceID).filter { !movedIDs.contains($0) }
        let targetOrder = displayOrder(for: target) + moving.map(\.id)

        for space in SpaceId.allCases {
            let original = source.tabs(in: space)
            let remaining = original.filter { !movedIDs.contains($0.id) }
            let additions = moving.filter { $0.spaceId == space }
            guard !additions.isEmpty else { continue }
            source.tabs[space] = remaining
            if let current = source.activeTabId[space] ?? nil, movedIDs.contains(current),
               let index = original.firstIndex(where: { $0.id == current }) {
                let next = original.dropFirst(index + 1).first { !movedIDs.contains($0.id) }
                    ?? original.prefix(index).last { !movedIDs.contains($0.id) }
                source.activeTabId[space] = next?.id
            }
            destination.tabs[space, default: []].append(contentsOf: additions)
            if (destination.activeTabId[space] ?? nil) == nil { destination.activeTabId[space] = additions.first?.id }
        }
        let next = activeTab.flatMap { active -> BereanWorkspace.Tab? in
            guard movedIDs.contains(active.id), let index = order.firstIndex(where: { $0.id == active.id }) else { return nil }
            return order.dropFirst(index + 1).first { !movedIDs.contains($0.id) }
                ?? order.prefix(index).last { !movedIDs.contains($0.id) }
        }
        var updated = sessions
        updated[sourceIndex] = source
        updated[targetIndex] = destination
        sessions = updated
        displayOrders[sourceID] = sourceOrder
        displayOrders[target] = targetOrder
        if let next { select(next.id, in: next.spaceId, rememberPrevious: false) }
        scheduleSave()
        return moving.count
    }

    func findTab(_ id: String) -> BereanWorkspace.Tab? { session.allTabs.first { $0.id == id } }

    func update(_ tabId: String, recordHistory: Bool = true, _ change: (inout BereanWorkspace.Tab) -> Void) {
        for sp in SpaceId.allCases {
            guard let idx = sessions[sessionIndex].tabs[sp]?.firstIndex(where: { $0.id == tabId }) else { continue }
            let before = sessions[sessionIndex].tabs[sp]![idx]
            change(&sessions[sessionIndex].tabs[sp]![idx])
            // Capture in the same mutation, before navigation/history or persistence can run.
            // A disappearing Search view must not cancel an options-save task.
            if sessions[sessionIndex].tabs[sp]![idx].tabType == .search {
                sessions[sessionIndex].tabs[sp]![idx].state = SearchOptionsStore.capturing(sessions[sessionIndex].tabs[sp]![idx].state)
            }
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
                if scriptureHistoryRestore?.tabID == tabId { scriptureHistoryRestore = nil }
                if let restore = compareHistoryRestore, restore.tabID == tabId {
                    let state = BibleState(after.state)
                    if !state.compareMode || restore.passage != CompareColumn.passageKey(state, CompareColumn.resolved(in: after.state)) {
                        compareHistoryRestore = nil
                    }
                }
                if let saved = after.state["nativeSelectedVerses"], saved == before.state["nativeSelectedVerses"],
                   Self.selectionLocation(before) != Self.selectionLocation(after) {
                    sessions[sessionIndex].tabs[sp]![idx].state.remove("nativeSelectedVerses")
                }
                backStack[tabId, default: []].append(.location(historyLocation(before)))
                if backStack[tabId]!.count > tabNavMaxStack { backStack[tabId]!.removeFirst() }
                forwardStack[tabId] = []
            }
            if recordHistory, after.tabType == .bible, BibleState(after.state).compareMode {
                let destination = CompareHistoryDestination(state: after.state)
                if !BibleState(before.state).compareMode || CompareHistoryDestination(state: before.state) != destination {
                    let passage = destination.passage
                    let encoder = JSONEncoder()
                    encoder.outputFormatting = .sortedKeys
                    let payload = (try? encoder.encode(destination)).map { String(decoding: $0, as: UTF8.self) }
                    self.recordHistory(type: "compare", title: "Compare · \(passage.label)",
                                       bookId: passage.bookId, chapter: passage.chapter, verse: passage.verse, query: payload)
                }
            }
            if Self.compareVisitContext(in: before) != Self.compareVisitContext(in: after) {
                compareVisitLayouts.removeValue(forKey: tabId)
                clearCompareActiveVisit(for: tabId, state: after.state)
                if compareHistoryRestore?.tabID == tabId { compareHistoryRestore = nil }
            }
            if before.tabType == .search, after.tabType == .search,
               SearchViewports.configuration(in: before.state) != SearchViewports.configuration(in: after.state) {
                currentSearchVisits.removeValue(forKey: tabId)
                if let record = searchViewportRecords[tabId] ?? SearchViewports.record(in: after.state) {
                    searchViewportRecords[tabId] = SearchViewports.settingActive(nil, in: record)
                }
            }
            scheduleSave(); return
        }
    }

    // MARK: in-tab history (⌘[ / ⌘]) — the place a tab shows, not presentation details like scroll or panels

    private struct TabHistoryLocation: Equatable {
        var tab: BereanWorkspace.Tab
        var notesOptions: NotesHomeView.BrowseOptions?
        var notesReturnTab: String?
        var compareSelection: CompareSelectionSnapshot?
        var compareViewport: CompareViewportSnapshot?
        var searchViewport: SearchViewportVisit?
    }

    private enum TabHistoryEntry: Equatable {
        case location(TabHistoryLocation)
        case tab(String)
    }

    private func historyLocation(_ tab: BereanWorkspace.Tab) -> TabHistoryLocation {
        var snapshot = tab
        if tab.tabType == .bible {
            snapshot.state = applyingCompareBookmarks(in: tab.state, tabID: tab.id)
        }
        var compareSelection: CompareSelectionSnapshot?
        var compareViewport: CompareViewportSnapshot?
        var searchViewport: SearchViewportVisit?
        if tab.tabType == .search {
            let configuration = SearchViewports.configuration(in: tab.state)
            let record = searchViewportRecords[tab.id] ?? SearchViewports.record(in: tab.state)
            if let record {
                searchViewportRecords[tab.id] = record
                snapshot.state = SearchViewports.installing(record, in: tab.state)
            }
            let live = currentSearchVisits[tab.id]
            let active = record.flatMap(SearchViewports.active)
            searchViewport = [live, active].compactMap { $0 }.first { $0.configuration == configuration }
                ?? SearchViewportVisit(configuration: configuration, context: nil, row: nil)
        }
        if tab.tabType == .bible {
            let state = BibleState(tab.state)
            let chapter = ChapterEdition(state).key
            if state.compareMode {
                let passage = CompareColumn.passageKey(state, CompareColumn.resolved(in: tab.state))
                if let saved = compareSelections[tab.id], saved.passage == passage { compareSelection = saved }
                var independent = compareIndependentVisitPositions[tab.id, default: [:]]
                let presentation = compareVisitPresentation(in: tab, state: snapshot.state)
                let context = Self.compareVisitContext(in: tab)
                let active = context.flatMap { CompareViewports.activeVisit(in: snapshot.state, context: $0) }
                if let active {
                    for (column, anchor) in active {
                        let key = CompareIndependentVisitKey(passage: passage, column: column)
                        if independent[key] == nil { independent[key] = anchor }
                    }
                }
                compareViewport = CompareViewportSnapshot(passage: passage,
                    context: presentation?.context, shared: presentation?.shared, coordinate: presentation?.coordinate,
                    sourceJump: Self.pendingCompareJump(in: tab, state: snapshot.state),
                    verses: compareColumnScrollVerses[tab.id, default: [:]], independent: independent)
            } else if let position = scriptureReadingPositions[tab.id]?[chapter]?.persisted,
                      position != ReaderViewports.position(in: tab.state, chapter: chapter) {
                snapshot.state = ReaderViewports.updating(tab.state, chapter: chapter, position: position)
            }
        }
        if tab.tabType == .lexicon, let search = lexiconSearches[tab.id] {
            snapshot.state["searchQuery"] = .string(JSString(search.query))
            snapshot.state["searchLang"] = .string(JSString(search.lang))
            let context = LexiconSearchView.ScrollContext(query: search.query.trimmingCharacters(in: .whitespacesAndNewlines), lang: search.lang)
            let saved = LexiconSearchView.ScrollContext(query: (tab.state["searchQuery"]?.stringValue?.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
                                                        lang: tab.state["searchLang"]?.stringValue?.string ?? "all")
            let offset = lexiconSearchPositions[tab.id]?[context]
                ?? (saved == context ? CGFloat(tab.state["searchScrollTop"]?.numberValue ?? 0) : 0)
            snapshot.state["searchScrollTop"] = .number(Double(offset))
        }
        return TabHistoryLocation(tab: snapshot, notesOptions: notesBrowseOptions[tab.id],
                                  notesReturnTab: noteListReturnTabs[tab.id], compareSelection: compareSelection,
                                  compareViewport: compareViewport, searchViewport: searchViewport)
    }

    /// Explicit location editing keeps this tab's identity, pin and sidebar position,
    /// including when the destination belongs to another Space or content type.
    @discardableResult
    private func replaceCurrentTab(_ type: TabType, in space: SpaceId, title: String, state: JSObject,
                                   origin: BereanWorkspace.Tab? = nil) -> Bool {
        guard let current = activeTab else { return false }
        if current.tabType == type, current.spaceId == space {
            update(current.id) { tab in
                for field in state.entries { tab.state[field.key.string] = field.value }
                tab.title = title
            }
            return true
        }
        let previous = historyLocation(current)
        let destination = BereanWorkspace.Tab(id: current.id, spaceId: space, type: type.rawValue,
                                              title: title, state: type == .search ? SearchOptionsStore.capturing(state) : state,
                                              originTabId: origin?.id, originSpaceId: origin?.spaceId)
        guard sessions[sessionIndex].replaceTabContent(current.id, with: destination) != nil else { return false }
        if scriptureHistoryRestore?.tabID == current.id { scriptureHistoryRestore = nil }
        if compareHistoryRestore?.tabID == current.id { compareHistoryRestore = nil }
        backStack[current.id, default: []].append(.location(previous))
        if backStack[current.id]!.count > tabNavMaxStack { backStack[current.id]!.removeFirst() }
        forwardStack[current.id] = []
        noteListReturnTabs.removeValue(forKey: current.id)
        notesBrowseOptions.removeValue(forKey: current.id)
        lexiconSearches.removeValue(forKey: current.id)
        studyVerseFocus.removeValue(forKey: current.id)
        activeSpace = space
        scheduleSave()
        return true
    }

    private func restoreLocation(_ location: TabHistoryLocation, for id: String) {
        var destination = location.tab
        if let current = findTab(id) {
            let bookmarks = applyingCompareBookmarks(in: current.state, tabID: id)
            if destination.tabType == .bible {
                destination.state = CompareViewports.clearingPendingSourceJump(
                    in: CompareViewports.merging(current: bookmarks, into: destination.state))
            }
        }
        var stagedSearch: JSObject?
        if destination.tabType == .search {
            let latest = searchViewportRecords[id] ?? findTab(id).flatMap { SearchViewports.record(in: $0.state) } ?? JSObject()
            let configuration = SearchViewports.configuration(in: destination.state)
            let visit = location.searchViewport.flatMap { $0.configuration == configuration ? $0 : nil }
                ?? SearchViewportVisit(configuration: configuration, context: nil, row: nil)
            let record = SearchViewports.settingActive(visit, in: latest)
            destination.state = SearchViewports.installing(record, in: destination.state)
            stagedSearch = record
        }
        guard sessions[sessionIndex].replaceTabContent(id, with: destination) != nil else { return }
        if destination.tabType == .bible { cacheCompareBookmarkState(destination.state, for: id) }
        currentSearchVisits.removeValue(forKey: id)
        if let stagedSearch {
            searchResultAnchors.removeValue(forKey: id)
            searchViewportRecords[id] = stagedSearch
            searchHistoryRevision = (id, UUID())
        } else if searchHistoryRevision?.tabID == id {
            searchHistoryRevision = nil
        }
        compareVisitLayouts.removeValue(forKey: id)
        var stagedVisit = false
        scriptureHistoryRestore = nil
        compareHistoryRestore = nil
        compareSelections[id] = location.compareSelection
        if scriptureJumpRequest?.tabID == id { scriptureJumpRequest = nil }
        scriptureEditionSources.removeValue(forKey: id)
        if location.tab.tabType == .bible {
            let state = BibleState(location.tab.state)
            if state.compareMode {
                let columns = CompareColumn.resolved(in: location.tab.state)
                let passage = CompareColumn.passageKey(state, columns)
                let viewport = location.compareViewport.flatMap { $0.passage == passage ? $0 : nil }
                    ?? CompareViewportSnapshot(passage: passage, context: nil, shared: nil, coordinate: nil,
                                               sourceJump: nil, verses: [:], independent: [:])
                let restored = viewport.restoring(verses: compareColumnScrollVerses[id, default: [:]],
                                                  independent: compareIndependentVisitPositions[id, default: [:]])
                compareScrollOffsets[id]?.removeValue(forKey: "aligned|" + passage)
                compareScrollOffsets[id]?.removeValue(forKey: "stacked|" + passage)
                compareColumnScrollVerses[id] = restored.verses
                compareIndependentVisitPositions[id] = restored.independent
                let context = viewport.context.flatMap { saved in
                    saved == Self.compareVisitContext(in: destination, layout: saved.layout) ? saved : nil
                }
                compareHistoryRestore = CompareHistoryRestore(tabID: id, passage: passage, layout: context?.layout,
                                                              sourceJump: viewport.sourceJump)
                // Stage the selected visit before the pane measures anything.
                // An immediate lifecycle save must already reopen this visit.
                if let context, context.layout == .independent {
                    var anchors: [CompareBookmarkColumn: CompareBookmarkAnchor] = [:]
                    for column in columns {
                        guard let identity = column.bookmarkColumn else { continue }
                        let key = CompareIndependentVisitKey(passage: passage, column: identity)
                        let verse = viewport.verses[passage + "|column:\(column.id)"]
                        anchors[identity] = viewport.independent[key] ?? verse.flatMap { CompareBookmarkAnchor(verse: $0) }
                    }
                    cacheCompareBookmarkState(CompareViewports.settingActiveVisit(in: destination.state, context: context,
                                                                                 anchors: anchors), for: id)
                    stagedVisit = true
                } else if let context, let shared = viewport.shared {
                    stageSharedCompareVisit(shared, for: id, context: context, coordinate: viewport.coordinate)
                    stagedVisit = true
                }
            } else {
                let edition = ChapterEdition(state)
                let position = ReaderViewports.position(in: location.tab.state, chapter: edition.key).map(ScriptureReadingPosition.init)
                scriptureReadingPositions[id, default: [:]][edition.key] = position
                if let position {
                    scriptureHistoryRestore = ScriptureHistoryRestore(tabID: id, edition: edition, position: position)
                }
            }
        }
        notesBrowseOptions[id] = location.notesOptions
        noteListReturnTabs[id] = location.notesReturnTab
        if !stagedVisit {
            clearCompareActiveVisit(for: id, state: destination.state)
        }
        if let sourceJump = location.compareViewport?.sourceJump,
           let context = Self.compareVisitContext(in: destination), BibleState(destination.state).verse == sourceJump {
            cacheCompareBookmarkState(CompareViewports.settingPendingSourceJump(
                in: compareBookmarkState(destination.state, for: id), context: context, verse: sourceJump), for: id)
        }
        if location.tab.tabType == .lexicon {
            lexiconSearches[id] = (location.tab.state["searchQuery"]?.stringValue?.string ?? "",
                                  location.tab.state["searchLang"]?.stringValue?.string ?? "all")
            let search = lexiconSearches[id]!
            let context = LexiconSearchView.ScrollContext(query: search.query.trimmingCharacters(in: .whitespacesAndNewlines), lang: search.lang)
            lexiconSearchPositions[id, default: [:]][context] = CGFloat(location.tab.state["searchScrollTop"]?.numberValue ?? 0)
            seedLexiconSearch(in: id)
        }
        notesSearchSeed += 1
        studyVerseFocus.removeValue(forKey: id)
        activeSpace = location.tab.spaceId
        scheduleSave()
    }

    @ObservationIgnored var historyBrowseOptions: [String: HistoryView.BrowseOptions] = [:]
    @ObservationIgnored var compareScrollOffsets: [String: [String: CGFloat]] = [:]
    @ObservationIgnored var compareColumnScrollVerses: [String: [String: Int]] = [:]
    struct CompareIndependentVisitKey: Hashable {
        let passage: String
        let column: CompareBookmarkColumn
    }

    // Each history entry owns a value snapshot, so old destination caches can
    // be discarded without losing any visits still on Back or Forward.
    nonisolated private static let compareIndependentVisitCapacity = 96
    @ObservationIgnored private(set) var compareIndependentVisitPositions: [String: [CompareIndependentVisitKey: CompareBookmarkAnchor]] = [:]

    func rememberCompareIndependentVisit(_ anchor: CompareBookmarkAnchor, for tabId: String, key: CompareIndependentVisitKey) {
        if compareIndependentVisitPositions[tabId]?[key] == nil,
           let existing = compareIndependentVisitPositions[tabId], existing.count >= Self.compareIndependentVisitCapacity,
           let stale = existing.keys.first(where: { $0.passage != key.passage }) ?? existing.keys.first {
            compareIndependentVisitPositions[tabId]?.removeValue(forKey: stale)
        }
        compareIndependentVisitPositions[tabId, default: [:]][key] = anchor
    }

    @ObservationIgnored var compareSelections: [String: CompareSelectionSnapshot] = [:]
    // Live semantic bookmarks stay out of SwiftUI observation while scrolling.
    // The bounded field is folded into local tab state once the existing save
    // debounce settles, and synchronously when a lifecycle flush is requested.
    private struct PendingCompareBookmark {
        let anchor: CompareBookmarkAnchor
        let order: UInt64
    }
    @ObservationIgnored private var compareBookmarkOrder: UInt64 = 0
    @ObservationIgnored private var pendingCompareBookmarks: [String: [CompareBookmarkScope: PendingCompareBookmark]] = [:]
    @ObservationIgnored private var compareBookmarkRecords: [String: JSObject] = [:]

    private struct CompareVisitPresentation {
        let context: CompareActiveVisitContext
        var shared: CompareViewports.SharedVisit?
        var coordinate: CompareSharedCoordinate?
    }
    @ObservationIgnored private var compareVisitLayouts: [String: CompareVisitPresentation] = [:]

    func rememberCompareVisitLayout(for tabId: String, layout: CompareActiveVisitContext.Layout) {
        guard activeTab?.id == tabId, let context = compareVisitContext(for: tabId, layout: layout),
              compareVisitLayouts[tabId]?.context != context else { return }
        compareVisitLayouts[tabId] = CompareVisitPresentation(context: context)
    }

    func compareVisitContext(for tabId: String, layout: CompareActiveVisitContext.Layout) -> CompareActiveVisitContext? {
        findTab(tabId).flatMap { Self.compareVisitContext(in: $0, layout: layout) }
    }

    private static func compareVisitContext(in tab: BereanWorkspace.Tab,
                                            layout: CompareActiveVisitContext.Layout = .independent) -> CompareActiveVisitContext? {
        guard tab.tabType == .bible else { return nil }
        let state = BibleState(tab.state)
        guard state.compareMode,
              let source = CompareBookmarkDestination(textID: state.translation, bookID: state.bookId, chapter: state.chapter)
        else { return nil }
        let columns = CompareColumn.resolved(in: tab.state)
        let identities = columns.compactMap(\.bookmarkColumn)
        guard identities.count == columns.count else { return nil }
        let pinned = Set(columns.filter(\.isPinned).compactMap { $0.bookmarkColumn?.id })
        return CompareActiveVisitContext(source: source, columns: identities,
                                         syncScrolling: tab.state["compareSyncScroll"]?.boolValue ?? true,
                                         pinnedColumnIDs: pinned, layout: layout)
    }

    private func compareVisitPresentation(in tab: BereanWorkspace.Tab, state: JSObject) -> CompareVisitPresentation? {
        if var observed = compareVisitLayouts[tab.id],
           observed.context == Self.compareVisitContext(in: tab, layout: observed.context.layout) {
            if observed.context.layout != .independent {
                observed.shared = observed.shared ?? CompareViewports.sharedActiveVisit(in: state, context: observed.context) ?? .empty
            }
            return observed
        }
        guard CompareViewports.hasActiveVisit(in: state) else { return nil }
        for layout in [CompareActiveVisitContext.Layout.aligned, .stacked] {
            if let context = Self.compareVisitContext(in: tab, layout: layout),
               let shared = CompareViewports.sharedActiveVisit(in: state, context: context) {
                return CompareVisitPresentation(context: context, shared: shared)
            }
        }
        if let context = Self.compareVisitContext(in: tab), CompareViewports.activeVisit(in: state, context: context) != nil {
            return CompareVisitPresentation(context: context)
        }
        return nil
    }

    private func compareBookmarkState(_ original: JSObject, for tabId: String) -> JSObject {
        guard let records = compareBookmarkRecords[tabId] else { return original }
        var state = original
        state[CompareViewports.field] = records.isEmpty ? nil : .object(records)
        return state
    }

    private func cacheCompareBookmarkState(_ state: JSObject, for tabId: String) {
        compareBookmarkRecords[tabId] = state[CompareViewports.field]?.objectValue ?? JSObject()
    }

    func compareActiveVisit(for tabId: String) -> [CompareBookmarkColumn: CompareBookmarkAnchor]? {
        guard let tab = findTab(tabId) else { return nil }
        let state = compareBookmarkState(tab.state, for: tabId)
        guard CompareViewports.hasActiveVisit(in: state), let context = Self.compareVisitContext(in: tab) else { return nil }
        return CompareViewports.activeVisit(in: state, context: context)
    }

    func recordCompareActiveVisitPane(_ anchor: CompareBookmarkAnchor, for tabId: String, column: CompareBookmarkColumn) {
        guard activeTab?.id == tabId, let tab = findTab(tabId) else { return }
        let state = compareBookmarkState(tab.state, for: tabId)
        guard CompareViewports.hasActiveVisit(in: state), let context = Self.compareVisitContext(in: tab),
              context.columns.contains(column), let anchors = CompareViewports.activeVisit(in: state, context: context),
              anchors[column] != anchor else { return }
        cacheCompareBookmarkState(
            CompareViewports.updatingActiveVisit(in: state, context: context, anchors: [column: anchor]), for: tabId)
        if saveTask == nil { scheduleSave() }
    }

    func compareSharedActiveVisit(for tabId: String, context: CompareActiveVisitContext) -> CompareViewports.SharedVisit? {
        guard let tab = findTab(tabId), context == Self.compareVisitContext(in: tab, layout: context.layout) else { return nil }
        return CompareViewports.sharedActiveVisit(in: compareBookmarkState(tab.state, for: tabId), context: context)
    }

    func compareSharedCoordinate(for tabId: String, context: CompareActiveVisitContext,
                                 anchor: CompareBookmarkAnchor) -> CompareSharedCoordinate? {
        guard let presentation = compareVisitLayouts[tabId], presentation.context == context,
              presentation.shared == .position(anchor) else { return nil }
        return presentation.coordinate
    }

    func rememberSharedCompareVisit(_ visit: CompareViewports.SharedVisit, for tabId: String, context: CompareActiveVisitContext,
                                    coordinate: CompareSharedCoordinate? = nil, updateActive: Bool = false) {
        guard activeTab?.id == tabId, context == compareVisitContext(for: tabId, layout: context.layout) else { return }
        if updateActive, let active = compareSharedActiveVisit(for: tabId, context: context), active != visit {
            stageSharedCompareVisit(visit, for: tabId, context: context)
        }
        compareVisitLayouts[tabId] = CompareVisitPresentation(context: context, shared: visit, coordinate: coordinate)
    }

    func stageSharedCompareVisit(_ visit: CompareViewports.SharedVisit, for tabId: String, context: CompareActiveVisitContext,
                                 coordinate: CompareSharedCoordinate? = nil, resolvingJump: Bool = false) {
        guard let tab = findTab(tabId), context == Self.compareVisitContext(in: tab, layout: context.layout) else { return }
        let state = compareBookmarkState(tab.state, for: tabId)
        let base = resolvingJump ? CompareViewports.clearingPendingSourceJump(in: state) : state
        let updated = CompareViewports.settingSharedActiveVisit(in: base, context: context, visit: visit)
        guard CompareViewports.sharedActiveVisit(in: updated, context: context) == visit else { return }
        compareVisitLayouts[tabId] = CompareVisitPresentation(context: context, shared: visit, coordinate: coordinate)
        if resolvingJump, let request = scriptureJumpRequest, request.tabID == tabId,
           request.chapter == ChapterEdition(BibleState(tab.state)) {
            resolvedSharedCompareJumpRevision = request.revision
        }
        if updated != state {
            cacheCompareBookmarkState(updated, for: tabId)
            if saveTask == nil { scheduleSave() }
        }
    }

    private func clearCompareActiveVisit(for tabId: String, state: JSObject) {
        let state = compareBookmarkState(state, for: tabId)
        if CompareViewports.hasActiveVisit(in: state) {
            cacheCompareBookmarkState(CompareViewports.clearingActiveVisit(in: state), for: tabId)
        }
    }

    func compareBookmarkPosition(for tabId: String, scope: CompareBookmarkScope) -> CompareBookmarkAnchor? {
        guard let tab = findTab(tabId), validCompareBookmarkScope(scope, in: tab) else { return nil }
        if let pending = pendingCompareBookmarks[tabId]?[scope] { return pending.anchor }
        return CompareViewports.position(in: compareBookmarkState(tab.state, for: tabId), scope: scope)
    }

    func recordCompareBookmark(for tabId: String, scope: CompareBookmarkScope, anchor: CompareBookmarkAnchor) {
        guard activeTab?.id == tabId, let tab = findTab(tabId),
              validCompareBookmarkScope(scope, in: tab),
              compareBookmarkPosition(for: tabId, scope: scope) != anchor else { return }
        guard scope.accepts(anchor) else { return }
        compareBookmarkOrder &+= 1
        pendingCompareBookmarks[tabId, default: [:]][scope] = PendingCompareBookmark(anchor: anchor, order: compareBookmarkOrder)
        // Pixel samples can arrive each frame; the queued save drains the
        // newest values without rebuilding its timer on every sample.
        if anchor.precision == nil || saveTask == nil {
            scheduleSave()
        }
    }

    private func validCompareBookmarkScope(_ scope: CompareBookmarkScope, in tab: BereanWorkspace.Tab) -> Bool {
        guard tab.tabType == .bible else { return false }
        let state = BibleState(tab.state)
        guard state.compareMode,
              let source = CompareBookmarkDestination(textID: state.translation, bookID: state.bookId, chapter: state.chapter) else { return false }
        let resolved = CompareColumn.resolved(in: tab.state)
        let columns = resolved.compactMap { column -> CompareBookmarkColumn? in
            guard let id = CompareViewports.columnID(in: column.record),
                  let destination = CompareBookmarkDestination(textID: column.text, bookID: column.book, chapter: column.chapter) else { return nil }
            return CompareBookmarkColumn(id: id, destination: destination)
        }
        guard columns.count == resolved.count, Set(columns.map(\.id)).count == columns.count else { return false }
        switch scope {
        case .independent(let column): return columns.contains(column)
        case .aligned(let anchor, let configured), .stacked(let anchor, let configured):
            return anchor == source && configured == columns
        }
    }

    private func applyingCompareBookmarks(in original: JSObject, tabID: String) -> JSObject {
        var state = compareBookmarkState(original, for: tabID)
        if let pending = pendingCompareBookmarks[tabID] {
            for (scope, value) in pending.sorted(by: { $0.value.order < $1.value.order }) {
                state = CompareViewports.updating(state, scope: scope, position: value.anchor)
            }
        }
        // Remember even an empty map so history cannot resurrect an evicted bookmark.
        cacheCompareBookmarkState(state, for: tabID)
        pendingCompareBookmarks.removeValue(forKey: tabID)
        return state
    }

    private func flushCompareBookmarks() {
        // History capture can drain the pending queue into the ignored records
        // before the next save. Include those records in the lifecycle flush too.
        let pendingIDs = Set(pendingCompareBookmarks.keys).union(compareBookmarkRecords.keys)
        guard !pendingIDs.isEmpty else { return }
        for workspace in sessions.indices {
            for space in SpaceId.allCases {
                guard var tabs = sessions[workspace].tabs[space] else { continue }
                var changed = false
                for index in tabs.indices where pendingIDs.contains(tabs[index].id) {
                    let state = applyingCompareBookmarks(in: tabs[index].state, tabID: tabs[index].id)
                    if tabs[index].tabType == .bible, state != tabs[index].state {
                        tabs[index].state = state
                        changed = true
                    }
                }
                if changed { sessions[workspace].tabs[space] = tabs }
            }
        }
    }
    private struct CompareViewportSnapshot: Equatable {
        let passage: String
        let context: CompareActiveVisitContext?
        let shared: CompareViewports.SharedVisit?
        let coordinate: CompareSharedCoordinate?
        let sourceJump: Int?
        let verses: [String: Int]
        let independent: [CompareIndependentVisitKey: CompareBookmarkAnchor]

        init(passage: String, context: CompareActiveVisitContext?, shared: CompareViewports.SharedVisit?,
             coordinate: CompareSharedCoordinate?, sourceJump: Int?,
             verses: [String: Int],
             independent: [CompareIndependentVisitKey: CompareBookmarkAnchor]) {
            self.passage = passage
            self.context = context
            self.shared = shared
            self.coordinate = coordinate
            self.sourceJump = sourceJump
            self.verses = verses.filter { Self.hasColumnKey($0.key, for: passage) }
            self.independent = independent.filter { $0.key.passage == passage }
        }

        // A visit with no bookmark clears the destination's later bookmark.
        func restoring(verses: [String: Int],
                       independent: [CompareIndependentVisitKey: CompareBookmarkAnchor])
            -> (verses: [String: Int], independent: [CompareIndependentVisitKey: CompareBookmarkAnchor]) {
            let otherVerses = verses.filter { !Self.hasColumnKey($0.key, for: passage) }
            let remaining = max(0, AppModel.compareIndependentVisitCapacity - self.independent.count)
            let otherIndependent = independent.lazy.filter { $0.key.passage != passage }.prefix(remaining)
            var restoredIndependent = self.independent
            for (key, anchor) in otherIndependent { restoredIndependent[key] = anchor }
            return (otherVerses.merging(self.verses) { _, restored in restored },
                    restoredIndependent)
        }

        private static func hasColumnKey(_ key: String, for passage: String) -> Bool {
            key.hasPrefix(passage + "|column:")
        }
    }

    struct CompareHistoryRestore: Equatable {
        let tabID: String
        let passage: String
        let layout: CompareActiveVisitContext.Layout?
        let sourceJump: Int?
        let revision = UUID()
    }

    struct CompareSharedCoordinate: Equatable {
        let rendering: String
        let offset: CGFloat
    }
    var compareHistoryRestore: CompareHistoryRestore?
    @ObservationIgnored private(set) var resolvedSharedCompareJumpRevision: UUID?

    /// Explicit verse commands jump to the requested selection. Ordinary Compare visits restore scrolling.
    func prepareCompareJump(in tabId: String, edition: ChapterEdition) {
        compareSelections.removeValue(forKey: tabId)
        if compareHistoryRestore?.tabID == tabId { compareHistoryRestore = nil }
        let prefix = edition.key + "|"
        compareScrollOffsets[tabId] = compareScrollOffsets[tabId]?.filter {
            !$0.key.hasPrefix("aligned|" + prefix) && !$0.key.hasPrefix("stacked|" + prefix)
        }
        compareColumnScrollVerses[tabId] = compareColumnScrollVerses[tabId]?.filter { !$0.key.hasPrefix(prefix) }
        compareIndependentVisitPositions[tabId] = compareIndependentVisitPositions[tabId]?.filter { !$0.key.passage.hasPrefix(prefix) }
    }
    @ObservationIgnored var lexiconScrollOffsets: [String: [String: CGFloat]] = [:]
    @ObservationIgnored var lexiconSearchPositions: [String: [LexiconSearchView.ScrollContext: CGFloat]] = [:]
    /// Live Lexicon query cache. Settled edits also use the legacy searchQuery/searchLang state fields.
    @ObservationIgnored var lexiconSearches: [String: (query: String, lang: String)] = [:]
    struct LexiconSearchRequest: Equatable {
        let tabID: String
        let query: String
        let lang: String
        let nonce = UUID()
    }
    var lexiconSearchRequest: LexiconSearchRequest?

    private func seedLexiconSearch(in tabID: String) {
        let saved = lexiconSearches[tabID] ?? (query: "", lang: "all")
        lexiconSearchRequest = LexiconSearchRequest(tabID: tabID, query: saved.query, lang: saved.lang)
    }
    /// A chapter step asked for outside the reader (command palette); the reader for `tabId` performs it.
    struct ChapterStepRequest: Equatable { let tabId: String; let delta: Int; let nonce = UUID() }
    var chapterStepRequest: ChapterStepRequest?
    /// iPhone: the reader scrolled down far enough to tuck its passage capsule and the dock away.
    var readerChromeHidden = false
    /// A reader opened from a note link shows a "‹ Note" pill back to it (original `noteBack`). In memory only.
    struct NoteReturn: Equatable { let readerTabId: String; let chapterKey: String; let noteId: String; let title: String }
    var noteReturn: NoteReturn?
    @ObservationIgnored var lexiconOccurrenceOptions: [String: [String: LexiconEntryView.OccurrenceOptions]] = [:]
    @ObservationIgnored var lexiconOccurrenceReturns: [String: [String: LexiconEntryView.OccurrenceKey]] = [:]
    @ObservationIgnored var historyReturnRows: [String: String] = [:]
    // Bounded read-only chapter preparation shared by readers and adjacent-page prefetch.
    var readerChapterRevision = 0
    @ObservationIgnored var readerPresentations: [ChapterEdition: ScriptureChapterPresentation] = [:]
    @ObservationIgnored var readerChapterCache: [ChapterEdition: PreparedReaderChapter] = [:]
    @ObservationIgnored var readerChapterOrder: [ChapterEdition] = []
    @ObservationIgnored var readerChapterLoads: [ChapterEdition: Task<PreparedReaderChapter, Never>] = [:]
    @ObservationIgnored var scriptureReadingPositions: [String: [String: ScriptureReadingPosition]] = [:]
    var scriptureJumpRequest: (tabID: String, chapter: ChapterEdition, revision: UUID)?
    var scriptureHistoryRestore: ScriptureHistoryRestore?
    @ObservationIgnored var scriptureEditionSources: [String: (source: ChapterEdition, target: ChapterEdition, position: ScriptureReadingPosition?)] = [:]
    @ObservationIgnored private var searchViewportRecords: [String: JSObject] = [:]
    @ObservationIgnored private var currentSearchVisits: [String: SearchViewportVisit] = [:]
    var searchHistoryRevision: (tabID: String, revision: UUID)?

    func isCurrentSearchViewport(tabId: String, context: ScriptureSearchScrollContext) -> Bool {
        guard let tab = activeTab, tab.id == tabId, tab.tabType == .search else { return false }
        return SearchViewports.configuration(in: tab.state) == context.configuration
    }

    func searchViewportAnchor(tabId: String, context: ScriptureSearchScrollContext) -> SearchViewportVisit? {
        guard let tab = findTab(tabId) else { return nil }
        if let live = currentSearchVisits[tabId], live.configuration == context.configuration,
           live.context == context.persistenceKey {
            return live.row == nil ? nil : live
        }
        guard let record = searchViewportRecords[tabId] ?? SearchViewports.record(in: tab.state) else { return nil }
        return SearchViewports.restoration(in: record, configuration: context.configuration, context: context.persistenceKey)
    }

    @discardableResult
    func rememberSearchViewport(tabId: String, context: ScriptureSearchScrollContext, row: String?,
                                alignment: SearchViewportAlignment = .top, persist: Bool) -> Bool {
        guard isCurrentSearchViewport(tabId: tabId, context: context),
              let visit = SearchViewportVisit(configuration: context.configuration, context: context.persistenceKey,
                                               row: row, alignment: alignment) else { return false }
        currentSearchVisits[tabId] = visit
        guard persist, let tab = findTab(tabId) else { return true }
        if alignment == .top {
            if row != nil, searchVisibleRows[tabId]?[context] == nil,
               let remembered = searchVisibleRows[tabId], remembered.count >= SearchViewports.capacity,
               let expired = remembered.keys.first {
                searchVisibleRows[tabId]?.removeValue(forKey: expired)
            }
            if let row {
                searchVisibleRows[tabId, default: [:]][context] = row
            } else {
                searchVisibleRows[tabId]?.removeValue(forKey: context)
            }
        }
        let record = searchViewportRecords[tabId] ?? SearchViewports.record(in: tab.state) ?? JSObject()
        let updated = alignment == .center ? SearchViewports.settingActive(visit, in: record)
            : SearchViewports.updating(record, visit: visit)
        guard updated != record else { return true }
        searchViewportRecords[tabId] = updated
        if saveTask == nil { scheduleSave() }
        return true
    }

    private func flushSearchViewports() {
        // Live samples are cheap and observation-ignored during momentum. A lifecycle save
        // still includes the latest sample even if scrolling has not reached idle yet.
        for session in sessions {
            for tab in session.allTabs where tab.tabType == .search {
                guard let visit = currentSearchVisits[tab.id], visit.configuration == SearchViewports.configuration(in: tab.state) else { continue }
                let record = searchViewportRecords[tab.id] ?? SearchViewports.record(in: tab.state) ?? JSObject()
                let updated = SearchViewports.settingActive(visit, in: SearchViewports.updating(record, visit: visit))
                if updated != record { searchViewportRecords[tab.id] = updated }
            }
        }
        guard !searchViewportRecords.isEmpty else { return }
        for workspace in sessions.indices {
            for space in SpaceId.allCases {
                guard var tabs = sessions[workspace].tabs[space] else { continue }
                var changed = false
                for index in tabs.indices {
                    guard tabs[index].tabType == .search, let record = searchViewportRecords[tabs[index].id] else { continue }
                    let state = SearchViewports.installing(record, in: tabs[index].state)
                    if state != tabs[index].state {
                        tabs[index].state = state
                        changed = true
                    }
                }
                if changed { sessions[workspace].tabs[space] = tabs }
            }
        }
    }

    @ObservationIgnored var searchResultAnchors: [String: [ScriptureSearchScrollContext: String]] = [:]
    @ObservationIgnored var notesSearchOffsets: [String: [NotesHomeView.SearchPosition: CGFloat]] = [:]
    @ObservationIgnored var notesSearchReturnRows: [String: [NotesHomeView.SearchPosition: String]] = [:]
    @ObservationIgnored var dailyTimelinePositions: [String: Date] = [:]
    @ObservationIgnored var notesBrowseOptions: [String: NotesHomeView.BrowseOptions] = [:]
    @ObservationIgnored var notesFolderPositions: [String: [NotesFolderScrollContext: String]] = [:]
    @ObservationIgnored var searchVisibleRows: [String: [ScriptureSearchScrollContext: String]] = [:]
    private var backStack: [String: [TabHistoryEntry]] = [:]
    private var forwardStack: [String: [TabHistoryEntry]] = [:]

    private static func selectionLocation(_ tab: BereanWorkspace.Tab) -> [JSValue?] {
        ["bookId", "chapter", "translation", "verse", "endVerse", "endChapter"].map { tab.state[$0] }
    }

    static func location(_ t: BereanWorkspace.Tab) -> String {
        let keys: [String]
        switch t.tabType {
        case .bible: keys = ["bookId", "chapter", "translation", "verse", "endVerse", "nativeSelectedVerses"]
        case .note:
            if let note = t.state["noteId"]?.stringValue?.string { return "editor:" + note }
            if let folder = t.state["listFolderId"]?.stringValue?.string { return "folder:" + folder }
            return "notes-home"
        case .lexicon: keys = ["strongsNum", "searchQuery", "searchLang"]
        case .search:
            keys = ["query", "scopeTexts", "bookIds", "wordMode", "testament",
                    "tagFilter", "tagFilterAll", "nativeSearchFocusText"]
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

    private func tabHistoryTarget(_ id: String) -> (workspaceID: String, tab: BereanWorkspace.Tab)? {
        if let local = findTab(id) { return (currentSessionId, local) }
        for workspace in sessions where workspace.id != currentSessionId {
            if let tab = workspace.allTabs.first(where: { $0.id == id }) { return (workspace.id, tab) }
        }
        return nil
    }

    private func isReachable(_ entry: TabHistoryEntry) -> Bool {
        if case .tab(let id) = entry { return tabHistoryTarget(id) != nil }
        return true
    }

    var canGoBack: Bool { activeTab.map { backStack[$0.id]?.contains(where: isReachable) == true } ?? false }
    var canGoForward: Bool { activeTab.map { forwardStack[$0.id]?.contains(where: isReachable) == true } ?? false }

    func goBack() { traverseHistory(forward: false) }
    func goForward() { traverseHistory(forward: true) }

    private func traverseHistory(forward: Bool) {
        guard let current = activeTab else { return }
        var entries = (forward ? forwardStack : backStack)[current.id] ?? []
        while let entry = entries.popLast() {
            if forward { forwardStack[current.id] = entries } else { backStack[current.id] = entries }
            let destination: String
            let reverse: TabHistoryEntry
            switch entry {
            case .location(let location):
                destination = current.id
                reverse = .location(historyLocation(current))
                restoreLocation(location, for: current.id)
            case .tab(let id):
                guard let target = tabHistoryTarget(id) else { continue }
                destination = id
                reverse = .tab(current.id)
                let sameWorkspace = target.workspaceID == currentSessionId
                if !sameWorkspace {
                    switchSession(target.workspaceID, preferredSpace: target.tab.spaceId)
                }
                select(id, in: target.tab.spaceId, rememberPrevious: sameWorkspace)
            }
            if forward {
                backStack[destination, default: []].append(reverse)
            } else {
                forwardStack[destination, default: []].append(reverse)
            }
            return
        }
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
                             preferActiveTab: Bool = false,
                             canReplace: (BereanWorkspace.Tab) -> Bool = { _ in true },
                             matches: ((BereanWorkspace.Tab) -> Bool)? = nil) {
        if preferActiveTab, replaceCurrentTab(type, in: space, title: title, state: state, origin: origin) { return }
        let candidates = tabs(in: space).filter { $0.tabType == type }
        let currentId = activeTabId(in: space)
        let writable = candidates.filter { !$0.isPinned && canReplace($0) }
        // The location command explicitly targets the active tab. Pinned and
        // specialized tabs remain protected from ordinary destination reuse.
        let preferred = preferActiveTab && activeSpace == space ? candidates.first(where: { $0.id == currentId }) : nil
        let exact = matches.map { candidates.filter($0) } ?? []
        let destination = preferred ?? exact.first(where: { $0.id == currentId }) ?? exact.first
            ?? writable.first(where: { $0.id == currentId }) ?? writable.first
        if let tab = destination {
            if !exact.contains(where: { $0.id == tab.id }) {
                update(tab.id) { tab in
                    for field in state.entries { tab.state[field.key.string] = field.value }
                    tab.title = title
                }
            }
            select(tab.id, in: space)
        } else {
            openTab(type, in: space, title: title, state: state, origin: origin)
        }
    }

    /// A plain search can reuse a tab only if it would show the same scope and results.
    private static func matchesPlainSearchFilters(_ state: JSObject, requested: JSObject) -> Bool {
        let tagIDs = state["tagFilter"]?.stringValue?.string.split(separator: ",") ?? []
        return state["scopeTexts"]?.arrayValue == requested["scopeTexts"]?.arrayValue
            && (state["bookIds"]?.arrayValue ?? []) == (requested["bookIds"]?.arrayValue ?? [])
            && state["nativeSearchFocusText"]?.stringValue == nil
            && (state["wordMode"]?.stringValue?.string ?? "all") == "all"
            && (state["testament"]?.stringValue?.string ?? "all") == "all"
            && tagIDs.isEmpty
    }

    /// A Search tab for `query` (words, a phrase or Strong's numbers), across the default scope (All Texts).
    /// Whole-book find (original Find on Page across the book): a Search tab scoped to one book and text.
    func openBookSearch(_ query: String, bookId: String, textId: String, reuseTab: Bool = false,
                        returningTo sourceTabID: String? = nil) {
        recordScriptureSearch("\(textId): \(query)", bookId: bookId)
        var o = JSObject()
        o["query"] = .string(JSString(query))
        o["bookIds"] = .array([.string(JSString(bookId))])
        o["scopeTexts"] = .array([.string(JSString(textId))])
        o["nativeSearchFocusText"] = .null
        if reuseTab, let match = tabs(in: .search).first(where: { tab in
            tab.tabType == .search && tab.state["query"] == o["query"]
                && Self.matchesPlainSearchFilters(tab.state, requested: o)
        }) {
            select(match.id, in: .search)
        } else {
            _ = openTab(.search, in: .search, title: "Search: \(query)", state: o, origin: activeTab)
        }
        recordTabReturn(to: sourceTabID)
    }

    func openSearch(_ rawQuery: String, reuseTab: Bool = false, returningTo sourceTabID: String? = nil,
                    preferActiveTab: Bool = false) {
        let qualified = editionQualifiedQuery(rawQuery)
        let query = qualified?.query ?? rawQuery
        let scope = qualified.map { JSValue.array([.string(JSString($0.text))]) }
        recordScriptureSearch(rawQuery)
        var o = JSObject()
        o["query"] = .string(JSString(query))
        o["scopeTexts"] = scope ?? .null
        o["nativeSearchFocusText"] = .null
        if preferActiveTab {
            // The palette describes a fresh search across the requested texts.
            // Explicit current-tab navigation can replace a filtered search too.
            for key in ["bookIds", "wordMode", "testament", "tagFilter", "tagFilterAll"] {
                o[key] = .null
            }
        }
        if reuseTab {
            let isCompatibleSearch: (BereanWorkspace.Tab) -> Bool = { tab in
                Self.matchesPlainSearchFilters(tab.state, requested: o)
            }
            openOrReuse(.search, in: .search, title: "Search: \(query)", state: o,
                        preferActiveTab: preferActiveTab, canReplace: isCompatibleSearch,
                        matches: { isCompatibleSearch($0) && $0.state["query"]?.stringValue?.string == query })
        } else { openTab(.search, in: .search, title: "Search: \(query)", state: o) }
        recordTabReturn(to: sourceTabID)
    }

    // Navigation history is device-local. Keep native search options with their history IDs
    // while leaving the legacy history query and library schema intact.
    private static var searchHistoryOptionsKey: String {
        "berean.native.searchHistoryOptions." + UserLibrary.directory.lastPathComponent
    }

    private static let searchHistoryStateKeys = [
        "scopeTexts", "bookIds", "wordMode", "testament",
        "tagFilter", "tagFilterAll", "sort", "grouping",
    ]

    private var historySearchOptions: [String: String] {
        get { UserLibrary.defaults.dictionary(forKey: Self.searchHistoryOptionsKey) as? [String: String] ?? [:] }
        set { UserLibrary.defaults.set(newValue, forKey: Self.searchHistoryOptionsKey) }
    }

    private static func scriptureSearchState(_ state: JSObject) -> JSObject {
        var result = JSObject()
        for key in searchHistoryStateKeys { result[key] = state[key] }
        return result
    }

    func recordScriptureSearch(_ query: String, bookId: String? = nil, tabState: JSObject? = nil) {
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        let bookSuffix = bookId.map { " · \(Reference.bookName($0))" } ?? ""
        var options = historySearchOptions
        let snapshot = tabState.map { JSON.stringify(.object(Self.scriptureSearchState($0))).string }
        let previousID = (try? historyService?.all(limit: 1))?.first?.id
        let previousSnapshot = previousID.flatMap { options[$0] }
        if let id = recordHistory(type: "search", title: "\"\(query)\"\(bookSuffix)", bookId: bookId, query: query,
                                  deduplicate: snapshot == previousSnapshot),
           let snapshot {
            options[id] = snapshot
            if options.count > Self.historyEntryLimit {
                for id in options.keys.sorted().prefix(options.count - Self.historyEntryLimit) { options.removeValue(forKey: id) }
            }
            historySearchOptions = options
        }
        SearchHistory.record(query)
    }

    func reopenSavedScriptureSearch(_ entry: HistoryEntry) -> Bool {
        guard let snapshot = historySearchOptions[entry.id],
              let state = (try? JSON.parse(snapshot))?.objectValue,
              let savedQuery = entry.query, !savedQuery.isEmpty else { return false }
        let query = editionQualifiedQuery(savedQuery)?.query ?? savedQuery
        var search = Self.scriptureSearchState(state)
        search["query"] = .string(JSString(query))
        if let existing = tabs(in: .search).first(where: { tab in
            tab.tabType == .search && tab.state["query"] == search["query"]
                && tab.state["nativeSearchFocusText"]?.stringValue == nil
                && Self.searchHistoryStateKeys.allSatisfy { key in tab.state[key] == search[key] }
        }) {
            select(existing.id, in: .search)
        } else {
            openTab(.search, in: .search, title: "Search: \(query)", state: search)
        }
        return true
    }

    func deleteHistoryEntry(_ id: String) throws {
        try historyService?.delete(id)
        var options = historySearchOptions
        if options.removeValue(forKey: id) != nil { historySearchOptions = options }
    }

    func clearHistory() throws {
        try historyService?.clear()
        UserLibrary.defaults.removeObject(forKey: Self.searchHistoryOptionsKey)
    }

    func recordTabReturn(to sourceTabID: String?, in workspaceID: String? = nil) {
        if let sourceTabID, let destination = activeTab?.id, sourceTabID != destination,
           let source = tabHistoryTarget(sourceTabID), source.workspaceID == (workspaceID ?? currentSessionId) {
            let returnEntry = TabHistoryEntry.tab(sourceTabID)
            if backStack[destination]?.last != returnEntry {
                backStack[destination, default: []].append(returnEntry)
                if backStack[destination, default: []].count > tabNavMaxStack { backStack[destination]?.removeFirst() }
            }
            forwardStack[destination] = []
            forwardStack[sourceTabID] = []
        }
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
        return ResolvedPassage.savedVerses(in: tab.state, reader: state).sorted()
    }

    func studyStrongsVerses(in tabId: String, state: BibleState) -> [Int] {
        let selected = studySelectedVerses(in: tabId, state: state)
        if !selected.isEmpty { return selected }
        return studyVerse(in: tabId, state: state).map { [$0] } ?? []
    }

    func inspectStrongs(_ id: String, in tabId: String, textId: String, bookId: String, chapter: Int, verse: Int? = nil) {
        guard !id.isEmpty else { return }
        let source = RecentPassage(textId: textId, bookId: bookId, chapter: chapter, verse: verse)
        let encoder = JSONEncoder()
        encoder.outputFormatting = .sortedKeys
        let payload = (try? encoder.encode(source)).map { String(decoding: $0, as: UTF8.self) }
        recordHistory(type: "strongs-click", title: id, bookId: bookId, chapter: chapter,
                      verse: verse, strongsNum: id, query: payload)
        update(tabId, recordHistory: false) { tab in
            var reader = BibleState(tab.state)
            #if os(macOS)
            if let layout = ScriptureLayout(rawValue: reader.scriptureLayout), !layout.showsLexicon {
                reader.scriptureLayout = ScriptureLayout.standard.rawValue
            }
            #endif
            reader.rightPanelOpen = true
            tab.state = reader.merged(into: tab.state)
            StudyPanelSlots.focus(.lexicon, in: &tab.state)
            tab.state[StudyPanelSlots.lexiconKey(in: tab.state)] = .string(JSString(id))
        }
    }

    func navigateLexicon(_ strongs: String, in tabId: String) {
        guard let tab = findTab(tabId) else { return }
        if tab.tabType == .bible {
            update(tabId, recordHistory: false) {
                $0.state[StudyPanelSlots.lexiconKey(in: $0.state)] = .string(JSString(strongs))
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

    /// A Lexicon tab on the search view (no entry yet), optionally seeded with a query.
    func openLexiconSearch(_ query: String = "", newTab: Bool = false, preferActiveTab: Bool = false) {
        if !newTab, preferActiveTab {
            var state = JSObject(); state["strongsNum"] = .string("")
            state["searchQuery"] = .string(JSString(query)); state["searchLang"] = .string("all")
            state["searchScrollTop"] = .number(0)
            if replaceCurrentTab(.lexicon, in: .lexicon, title: "Lexicon", state: state), let tab = activeTab {
                lexiconSearches[tab.id] = (query, "all")
                lexiconSearchPositions[tab.id, default: [:]][.init(query: query.trimmingCharacters(in: .whitespacesAndNewlines), lang: "all")] = 0
                seedLexiconSearch(in: tab.id)
                return
            }
        }
        if !newTab, let tab = activeTab, tab.tabType == .lexicon {
            update(tab.id) {
                $0.state["strongsNum"] = .string(""); $0.title = "Lexicon"
                if !query.isEmpty {
                    $0.state["searchQuery"] = .string(JSString(query))
                    $0.state["searchLang"] = .string("all")
                    $0.state["searchScrollTop"] = .number(0)
                }
            }
            if !query.isEmpty {
                lexiconSearches[tab.id] = (query, "all")
                lexiconSearchPositions[tab.id, default: [:]][.init(query: query.trimmingCharacters(in: .whitespacesAndNewlines), lang: "all")] = 0
            }
            seedLexiconSearch(in: tab.id)
            return
        }
        var o = JSObject(); o["strongsNum"] = .string("")
        let id = openTab(.lexicon, in: .lexicon, title: "Lexicon", state: o, origin: activeTab)
        if !query.isEmpty { lexiconSearches[id] = (query, "all") }
        seedLexiconSearch(in: id)
    }

    func openLexicon(_ strongs: String, from origin: BereanWorkspace.Tab? = nil, reuseTab: Bool = false,
                     preferActiveTab: Bool = false) {
        recordHistory(type: "lexicon", title: strongs, strongsNum: strongs)
        var o = JSObject(); o["strongsNum"] = .string(JSString(strongs))
        if reuseTab {
            openOrReuse(.lexicon, in: .lexicon, title: strongs, state: o, origin: origin,
                        preferActiveTab: preferActiveTab, canReplace: { $0.originTabId == origin?.id },
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
    /// Bumped when something outside Notes Home seeds its search (palette "Search Notes for …").
    var notesSearchSeed = 0

    /// Opens Notes Home searching every note for `query` (original Floating Search "Search Notes").
    func openNotesSearch(_ query: String, newTab: Bool = false, preferActiveTab: Bool = false) {
        let previous = !newTab ? activeTab.map(historyLocation) : nil
        openNotesHome(newTab: newTab, preferActiveTab: preferActiveTab, preserveSearch: true)
        guard let tab = activeTab else { return }
        var options = notesBrowseOptions[tab.id] ?? NotesHomeView.BrowseOptions()
        options.query = query
        options.searchEverywhere = true
        notesBrowseOptions[tab.id] = options
        notesSearchSeed += 1
        if let previous { recordAuxiliaryLocationChange(from: previous) }
    }

    /// Query/filter options live outside tab JSON, but still belong to in-tab history.
    private func recordAuxiliaryLocationChange(from previous: TabHistoryLocation) {
        guard let tab = activeTab, tab.id == previous.tab.id, previous != historyLocation(tab) else { return }
        let entry = TabHistoryEntry.location(previous)
        if backStack[tab.id]?.last != entry {
            backStack[tab.id, default: []].append(entry)
            if backStack[tab.id]!.count > tabNavMaxStack { backStack[tab.id]!.removeFirst() }
        }
        forwardStack[tab.id] = []
    }

    func openNotesHome(newTab: Bool = false, preferActiveTab: Bool = false, preserveSearch: Bool = false) {
        if !newTab, preferActiveTab {
            let previous = activeTab.map(historyLocation)
            var state = JSObject(); state["noteId"] = .null; state["listFolderId"] = .null
            if replaceCurrentTab(.note, in: .notes, title: "Notes", state: state) {
                if !preserveSearch, let tab = activeTab {
                    notesBrowseOptions[tab.id] = NotesHomeView.BrowseOptions()
                    notesSearchSeed += 1
                    if let previous { recordAuxiliaryLocationChange(from: previous) }
                }
                return
            }
        }
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

    @ObservationIgnored private var noteListReturnTabs: [String: String] = [:]

    var notesListReturnTitle: String {
        if let editor = activeTab, let source = noteListReturnTabs[editor.id],
           let tab = findTab(source), tab.id != editor.id {
            return tab.title
        }
        let location = activeTab?.state["listFolderId"]?.stringValue?.string
        return NotesHomeView.title(location, (try? notes?.folders()) ?? [])
    }

    func returnToNotesList() {
        if let editor = activeTab, let source = noteListReturnTabs.removeValue(forKey: editor.id),
           let tab = findTab(source), tab.id != editor.id {
            select(source, in: tab.spaceId)
            return
        }
        openNote(nil)
    }

    func mountNoteEditor(_ id: String, editor: UUID) {
        pendingNoteFinalizations.removeValue(forKey: id)
        mountedNoteEditors[id, default: []].insert(editor)
    }

    func leaveNoteEditor(_ id: String, editor: UUID, saved: Note?) {
        guard mountedNoteEditors[id]?.remove(editor) != nil,
              mountedNoteEditors[id]?.isEmpty == true else { return }
        mountedNoteEditors.removeValue(forKey: id)
        if let saved, saved.id == id, saved.deletedAt == nil,
           JSText.trim(saved.title).isEmpty, saved.type != "idiom", !NoteFinalize.isSystemNote(saved) {
            pendingNoteFinalizations[id] = saved
        }
        finalizeNoteIfClosed(id)
    }

    private func finalizeNoteIfClosed(_ id: String) {
        func showsNote(_ tab: BereanWorkspace.Tab) -> Bool {
            tab.tabType == .note && tab.state["noteId"]?.stringValue?.string == id
        }
        guard mountedNoteEditors[id] == nil, let baseline = pendingNoteFinalizations[id],
              !sessions.contains(where: { $0.allTabs.contains(where: showsNote) }) else { return }
        pendingNoteFinalizations.removeValue(forKey: id)
        // Archive restores the original destination. Keep its note available even when every live tab closes.
        guard !archivedGroups.contains(where: { $0.tabs.contains(where: showsNote) }) else { return }
        let storedFormat = settingValue("untitledNoteNameFormat")?.stringValue?.string
        let format = storedFormat.flatMap(NoteFinalize.NameFormat.init(rawValue:)) ?? .long
        attempt("Couldn’t finish the note") { _ = try notes?.finalizeUnchanged(baseline, format: format) }
    }

    func openNote(_ id: String?, newTab: Bool = false, fromList source: String? = nil, preferActiveTab: Bool = false) {
        let note = id.flatMap { try? notes?.one($0) }
        if let note {
            refreshNoteTabTitles(note)
            recordHistory(type: "note", title: note.displayTitle, noteId: note.id)
        }
        var o = JSObject(); o["noteId"] = id.map { .string(JSString($0)) } ?? .null; o["isNew"] = .bool(false)
        let title = note?.displayTitle ?? "Notes"
        if !newTab, preferActiveTab, replaceCurrentTab(.note, in: .notes, title: title, state: o) {
            if let tab = activeTab { noteListReturnTabs.removeValue(forKey: tab.id) }
            return
        }
        let writableActive = preferActiveTab && activeTab?.tabType == .note
        if !newTab, !writableActive, let id, let exact = tabs(in: .notes).first(where: { $0.tabType == .note && $0.state["noteId"]?.stringValue?.string == id }) {
            noteListReturnTabs[exact.id] = source == exact.id ? nil : source
            select(exact.id, in: .notes)
            recordTabReturn(to: source)
            return
        }
        if !newTab, let cur = activeTabId(in: .notes), let t = tabs(in: .notes).first(where: { $0.id == cur }),
           t.tabType == .note, (!t.isPinned || id == nil || writableActive), activeSpace == .notes {
            noteListReturnTabs.removeValue(forKey: t.id)
            // Keep the Notes home location, so closing the note returns to the same folder.
            var title = title
            if let loc = t.state["listFolderId"] {
                o["listFolderId"] = loc
                if id == nil { title = NotesHomeView.title(loc.stringValue?.string, (try? notes?.folders()) ?? []) }
            }
            update(t.id) { $0.state = o; $0.title = title }
        } else {
            openTab(.note, in: .notes, title: title, state: o)
            if let source, let editor = activeTab, editor.id != source {
                noteListReturnTabs[editor.id] = source
                recordTabReturn(to: source)
            }
        }
    }

    /// Creates a note, optionally opening the Notes space instead of leaving navigation to the caller.
    @discardableResult
    func newNote(verseRef: String? = nil, textId: String = "kjva", title: String? = nil, content: String = "",
                 openEditor: Bool = true) -> String? {
        guard let notes else { libraryError = "The library is not open."; return nil }
        do {
            let label = verseRef.flatMap { r -> String? in
                let p = r.split(separator: ".").map(String.init)
                guard p.count == 3, let c = Int(p[1]), let v = Int(p[2]) else { return nil }
                return ResolvedPassage(textId: textId, bookId: p[0], chapter: c, verse: v).label
            }
            let n = try notes.create(.init(type: verseRef == nil ? "general" : "verse", title: title ?? label ?? "", content: content, verseRef: verseRef, textId: textId)).note
            if openEditor { openNote(n.id) }
            return n.id
        } catch { libraryError = "Could not create the note: \(error)"; return nil }
    }

    /// New idiom note, as the original (title = term, `idiom_term` lowercased, meaning).
    var idiomDraft: (term: String, meaning: String)?

    @discardableResult
    func createIdiom(term: String, meaning: String) -> String? {
        let t = term.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, let notes else { return nil }
        guard let n = try? notes.create(.init(type: "idiom", title: t, content: "", idiomTerm: t.lowercased(),
                                              idiomMeaning: meaning.trimmingCharacters(in: .whitespacesAndNewlines))).note else { return nil }
        notesRevision += 1
        openNote(n.id)
        return n.id
    }

    /// Prints (or saves as PDF) every idiom note as a reference book, as the original's idiom export.
    func exportIdioms() {
        guard let db = database?.connection, let notes else { return }
        let ids = ((try? db.query("SELECT id FROM notes WHERE type = 'idiom' AND deleted_at IS NULL")) ?? []).compactMap { $0["id"]?.string }
        let all = ids.compactMap { try? notes.one($0) }
        guard !all.isEmpty else { userMessage = "There are no idiom notes to export yet."; return }
        printMarkup(title: "Idioms", markup: IdiomReferenceBook.html(all, hermas: hermasEdition))
    }

    func reopenComparison(bookId: String, chapter: Int, verse: Int?, destination: CompareHistoryDestination?) {
        var reader = BibleState(bookId: bookId, chapter: chapter)
        reader.translation = destination?.passage.textId ?? defaultText
        reader.verse = verse
        reader.endVerse = destination?.passage.endVerse
        reader.showStrongs = destination?.showStrongs == true
        reader.compareMode = true
        var state = reader.object
        state["compareColumns"] = .array(destination?.columns.map(\.value) ?? [])
        if destination?.independentScrolling == true { state["compareSyncScroll"] = .bool(false) }
        if let hidden = destination?.hiddenAnnotations, !hidden.isEmpty {
            state["hiddenAnnotations"] = .array(hidden.map { .string(JSString($0)) })
        }
        if let verse, reader.endVerse == nil,
           let groups = destination?.passage.verseGroups, groups.count > 1,
           groups.allSatisfy({ (1...999).contains($0.lowerBound) && (1...999).contains($0.upperBound) }),
           groups.contains(where: { $0.contains(verse) }) {
            let passage = ResolvedPassage(textId: reader.translation, bookId: bookId, chapter: chapter,
                                          verse: verse, verseGroups: groups)
            state["nativeSelectedVerses"] = passage.savedSelection
        }
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

    func openNativeDevURL(_ url: URL) {
        guard url.scheme?.lowercased() == DeepLink.nativeDevScheme else { return }
        openBereanLink(DeepLink.parse(url.absoluteString, hermas: hermasEdition))
    }

    static func isBereanLink(_ url: URL) -> Bool {
        let schemes = ["berean", "berean-dev", "berean-pdf", "berean-dev-pdf", DeepLink.nativeDevScheme]
        return schemes.contains(url.scheme?.lowercased() ?? "")
    }

    func openBereanLink(_ route: DeepLinkRoute?, returningTo sourceTabID: String? = nil) {
        switch route {
        case .verse:
            guard let passage = resolveLinkedPassage(route) else {
                userMessage = "This Scripture link is unavailable."
                return
            }
            visitScripture(passage, returningTo: sourceTabID)
        case .note(let id):
            guard (try? notes?.one(id)) != nil else {
                userMessage = "This note is unavailable."
                return
            }
            openNote(id, fromList: sourceTabID)
        case .lexicon(let id):
            openLexicon(id, reuseTab: true)
            recordTabReturn(to: sourceTabID)
        case .search(let query):
            openSearch(query, reuseTab: true)
            recordTabReturn(to: sourceTabID)
        case .daily:
            openTodayDailyNote()
        case .workspace(let name):
            guard let workspace = workspaceItems.first(where: { $0.name.localizedStandardCompare(name) == .orderedSame }) else {
                userMessage = "This workspace is unavailable."
                return
            }
            open(workspace)
        case .session(let id):
            guard sessions.contains(where: { $0.id == id }) else {
                userMessage = "This workspace is unavailable."
                return
            }
            switchSession(id)
        case .pdf(let id, let page):
            guard let pdf = try? pdfs?.get(id) else {
                userMessage = "This PDF isn’t in your library on this device."
                return
            }
            openPdf(pdf.id, title: pdf.title, page: page)
        case .video(let id, let start):
            openYouTubeVideo(id, startMs: Int((start ?? 0) * 1000))
        case .trail(let id):
            guard (try? studyTrailService?.trails())?.contains(where: { $0.id == id }) ?? false else {
                userMessage = "This study trail is unavailable."
                return
            }
            studyTrailOpenRequest = id
            showStudyTrail = true
        case .chat:
            #if os(iOS)
            chatShown = true
            #else
            chatWindowRequest += 1
            #endif
        default:
            userMessage = "This Berean link can’t be opened here."
        }
    }

    /// Opens a passage from a note and remembers the note for the reader's return pill.
    func visitScripture(_ passage: ResolvedPassage, fromNote noteId: String, title: String) {
        visitScripture(passage)
        if let tab = activeTab, tab.tabType == .bible {
            noteReturn = NoteReturn(readerTabId: tab.id, chapterKey: "\(passage.textId)|\(passage.bookId)|\(passage.chapter)",
                                    noteId: noteId, title: title.isEmpty ? "Note" : title)
        }
    }

    var canChangeCurrentTab: Bool {
        activeTab != nil
    }

    /// Go switches to an exact open passage without resetting that tab's saved scroll position.
    func goToScripture(_ passage: ResolvedPassage, newTab: Bool, preferActiveTab: Bool = false) {
        let sourceID = activeTab?.id
        let changeCurrent = preferActiveTab && activeTab != nil
        if !newTab, !changeCurrent {
            let matches = tabs(in: .scripture).filter(passage.isShown(in:))
            if let match = matches.first(where: { $0.id == sourceID }) ?? matches.first {
                select(match.id, in: .scripture)
                recordTabReturn(to: sourceID)
                recordRecent(textId: passage.textId, bookId: passage.bookId, chapter: passage.chapter,
                             verse: passage.verse, endVerse: passage.endVerse, verseGroups: passage.verseGroups)
                return
            }
        }
        visitScripture(passage, reuseTab: !newTab, returningTo: newTab ? nil : sourceID,
                       preferActiveTab: changeCurrent)
    }

    func visitScripture(_ passage: ResolvedPassage, reuseTab: Bool = true, returningTo sourceTabID: String? = nil,
                        preferActiveTab: Bool = false) {
        openScripture(bookId: passage.bookId, chapter: passage.chapter, verse: passage.verse,
                      endVerse: passage.endVerse, textId: passage.textId, reuseTab: reuseTab, verseGroups: passage.verseGroups,
                      preferActiveTab: preferActiveTab)
        recordTabReturn(to: sourceTabID)
        recordRecent(textId: passage.textId, bookId: passage.bookId, chapter: passage.chapter,
                     verse: passage.verse, endVerse: passage.endVerse, verseGroups: passage.verseGroups)
    }

    func openScripture(bookId: String, chapter: Int, verse: Int? = nil, endVerse: Int? = nil, textId: String? = nil, reuseTab: Bool = false, verseGroups: [ClosedRange<Int>] = [],
                       preferActiveTab: Bool = false) {
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
                        preferActiveTab: preferActiveTab, canReplace: { !BibleState($0.state).compareMode && $0.state["endChapter"]?.numberValue == nil },
                        matches: passage.isShown(in:))
        } else {
            var state = st.object
            if !verseGroups.isEmpty { state["nativeSelectedVerses"] = passage.savedSelection }
            // New reader tabs start in the chosen default layout (original `defaultScriptureLayout`, Mac).
            if let layout = UserLibrary.defaults.string(forKey: "defaultScriptureLayout"), !layout.isEmpty {
                state["scriptureLayout"] = .string(JSString(layout))
            }
            openTab(.bible, in: .scripture, title: title, state: state)
        }
        if verse != nil, let tab = activeTab, tab.tabType == .bible, passage.isShown(in: tab, allowCompare: true) {
            requestScriptureJump(in: tab.id, to: ChapterEdition(st))
        }
    }

    private func stageCompareJump(in tabID: String, to chapter: ChapterEdition) {
        guard let tab = findTab(tabID), let context = Self.compareVisitContext(in: tab) else { return }
        let source = BibleState(tab.state)
        guard ChapterEdition(source) == chapter, let verse = source.verse else { return }
        if compareHistoryRestore?.tabID == tabID { compareHistoryRestore = nil }
        let state = compareBookmarkState(tab.state, for: tabID)
        cacheCompareBookmarkState(CompareViewports.settingPendingSourceJump(in: state, context: context, verse: verse), for: tabID)
        if saveTask == nil { scheduleSave() }
    }

    private static func pendingCompareJump(in tab: BereanWorkspace.Tab, state: JSObject) -> Int? {
        guard let context = compareVisitContext(in: tab) else { return nil }
        return CompareViewports.pendingSourceJump(in: state, context: context, selectedVerse: BibleState(tab.state).verse)
    }

    func pendingCompareJump(for tabID: String) -> Int? {
        guard let tab = findTab(tabID) else { return nil }
        return Self.pendingCompareJump(in: tab, state: compareBookmarkState(tab.state, for: tabID))
    }

    func resolveIndependentCompareJump(for tabID: String) {
        guard let tab = findTab(tabID), let context = Self.compareVisitContext(in: tab),
              let verse = pendingCompareJump(for: tabID) else { return }
        let source = BibleState(tab.state)
        let columns = CompareColumn.resolved(in: tab.state)
        let state = compareBookmarkState(tab.state, for: tabID)
        let active = CompareViewports.activeVisit(in: state, context: context)
        var anchors: [CompareBookmarkColumn: CompareBookmarkAnchor] = [:]
        var stagedJump = false
        for column in columns {
            guard let identity = column.bookmarkColumn else { continue }
            if column.follows(source), let mapped = column.mappedVerse(verse, from: source),
               let anchor = CompareBookmarkAnchor(verse: mapped) {
                anchors[identity] = anchor
                stagedJump = true
            } else if active == nil {
                anchors[identity] = compareBookmarkPosition(for: tabID, scope: .independent(identity))
            }
        }
        let base = CompareViewports.clearingPendingSourceJump(in: state)
        let resolved = stagedJump ? CompareViewports.updatingActiveVisit(in: base, context: context, anchors: anchors) : base
        cacheCompareBookmarkState(resolved, for: tabID)
        if saveTask == nil { scheduleSave() }
    }

    func requestScriptureJump(in tabID: String, to chapter: ChapterEdition) {
        if scriptureHistoryRestore?.tabID == tabID { scriptureHistoryRestore = nil }
        scriptureReadingPositions[tabID]?.removeValue(forKey: chapter.key)
        update(tabID, recordHistory: false) {
            $0.state = ReaderViewports.updating($0.state, chapter: chapter.key, position: nil)
        }
        stageCompareJump(in: tabID, to: chapter)
        scriptureJumpRequest = (tabID, chapter, UUID())
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


/// Scripture and Notes font choices — the existing app's FONT_FAMILY_OPTIONS keys; web fonts the platform lacks map to the
/// nearest system face (system design for sans, New York for book serifs).
enum ScriptureFont {
    static let options: [(id: String, label: String)] = [
        ("system", "System (San Francisco)"), ("serif", "Serif (Georgia)"), ("palatino", "Palatino"), ("sourceserif", "Book serif (New York)"),
        ("sansserif", "Sans-serif"), ("mono", "Monospace"),
    ]
    #if os(macOS)
    static func nativeFont(_ family: String, size: CGFloat, weight: NSFont.Weight = .regular) -> NSFont {
        let system = NSFont.systemFont(ofSize: size, weight: weight)
        let custom: NSFont?
        switch family {
        case "serif": custom = NSFont(name: "Georgia", size: size)
        case "palatino": custom = NSFont(name: "Palatino", size: size)
        case "mono": return .monospacedSystemFont(ofSize: size, weight: weight)
        case "garamond", "crimson", "lora", "merriweather", "sourceserif":
            return system.fontDescriptor.withDesign(.serif).flatMap { NSFont(descriptor: $0, size: size) } ?? system
        default: return system
        }
        guard let custom else { return system }
        return weight == .regular ? custom : NSFontManager.shared.convert(custom, toHaveTrait: .boldFontMask)
    }
    #else
    static func nativeFont(_ family: String, size: CGFloat, weight: UIFont.Weight = .regular) -> UIFont {
        let system = UIFont.systemFont(ofSize: size, weight: weight)
        let custom: UIFont?
        switch family {
        case "serif": custom = UIFont(name: "Georgia", size: size)
        case "palatino": custom = UIFont(name: "Palatino-Roman", size: size)
        case "mono": return .monospacedSystemFont(ofSize: size, weight: weight)
        case "garamond", "crimson", "lora", "merriweather", "sourceserif":
            return system.fontDescriptor.withDesign(.serif).map { UIFont(descriptor: $0, size: size) } ?? system
        default: return system
        }
        guard let custom else { return system }
        guard weight != .regular,
              let descriptor = custom.fontDescriptor.withSymbolicTraits(custom.fontDescriptor.symbolicTraits.union(.traitBold))
        else { return custom }
        return UIFont(descriptor: descriptor, size: size)
    }
    #endif

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


/// The active note editor's proportional scroll position, published only while the Presenter is open.
struct PresenterNoteViewport: Equatable {
    let noteId: String
    let fraction: Double
}

