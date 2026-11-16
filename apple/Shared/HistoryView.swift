import SwiftUI
import BereanNotes
import BereanCore
import BereanReference

struct CompareHistoryDestination: Codable, Equatable {
    struct Column: Codable, Equatable {
        let textId: String
        let bookId: String
        let chapter: Int
        let pinned: Bool

        var label: String {
            "\(Reference.readerChapterLabel(bookId, chapter, textId: textId)) · \(textInfo(textId).short)"
        }

        var value: JSValue {
            var record = JSObject()
            record["textId"] = .string(JSString(textId))
            record["bookId"] = .string(JSString(bookId))
            record["chapter"] = .number(Double(chapter))
            if pinned { record["nativePinnedPassage"] = .bool(true) }
            return .object(record)
        }
    }

    let passage: RecentPassage
    let columns: [Column]
    // Missing in older entries; the reader’s default is synchronized scrolling.
    let independentScrolling: Bool?

    init(state: JSObject) {
        let reader = BibleState(state)
        let groups = consecutiveVerseRuns(ResolvedPassage.savedVerses(in: state, reader: reader))
        passage = RecentPassage(textId: reader.translation, bookId: reader.bookId, chapter: reader.chapter,
                                verse: reader.verse, endVerse: reader.endVerse,
                                verseGroups: groups.count > 1 ? groups : nil)
        independentScrolling = state["compareSyncScroll"]?.boolValue == false ? true : nil
        columns = CompareColumn.resolved(in: state).map {
            Column(textId: $0.text, bookId: $0.book, chapter: $0.chapter, pinned: $0.isPinned)
        }
    }
}

/// History (the existing History tab / sheet): everything you opened — passages, notes, Strong's numbers, searches — newest
/// first, grouped by day, filterable; tap to reopen. Device-local (`history` table).
struct HistoryView: View {
    @Environment(AppModel.self) private var app
    let tabId: String
    @State private var entries: [HistoryEntry] = []
    /// Current titles of notes in history (a note renamed or titled after it was opened shows its real name).
    @State private var noteTitles: [String: String] = [:]
    @State private var options = BrowseOptions()
    @State private var restoreEntryID: String?
    @State private var visibleEntries: Set<String> = []
    @State private var restoredOnLoad = false

    struct BrowseOptions {
        var filter = ""
        var visibleLimit = 300
        var visibleEntryID: String?
    }
    private enum Category: String, CaseIterable, Identifiable {
        case all, scripture, notes, lexicon, youtube, search, imports
        var id: String { rawValue }
        var label: String {
            switch self {
            case .all: "All"
            case .scripture: "Scripture"
            case .notes: "Notes"
            case .lexicon: "Lexicon"
            case .youtube: "YouTube"
            case .search: "Search"
            case .imports: "Imports"
            }
        }

        func includes(_ type: String) -> Bool {
            switch self {
            case .all: true
            case .scripture: type == "bible" || type == "compare"
            case .notes: type == "note"
            case .lexicon: type == "lexicon" || type == "strongs-click"
            case .youtube: type == "youtube"
            case .search: type == "search"
            case .imports: type == "import"
            }
        }
    }

    private var category: Category {
        app.findTab(tabId)?.state["category"]?.stringValue.flatMap { Category(rawValue: $0.string) } ?? .all
    }

    private var studyOnly: Bool { app.findTab(tabId)?.state["studyOnly"]?.boolValue ?? false }
    @State private var confirmClear = false

    var shown: [HistoryEntry] {
        let query = options.filter.trimmingCharacters(in: .whitespacesAndNewlines)
        return entries.filter { e in
            category.includes(e.type)
                && !(category == .scripture && studyOnly && e.type == "bible" && (e.verse ?? 0) == 0)
                && (query.isEmpty || displayTitle(e).localizedStandardContains(query)
                    || (strongsSourceLabel(e)?.localizedStandardContains(query) ?? false)
                    || (e.type == "search" && (e.query ?? "").localizedStandardContains(query))
                    || (compareDestination(e)?.columns.contains { $0.label.localizedStandardContains(query) } ?? false))
        }
    }

    var days: [(String, [HistoryEntry])] {
        var order: [String] = [], map: [String: [HistoryEntry]] = [:]
        for e in shown.prefix(options.visibleLimit) {
            let d = Date(timeIntervalSince1970: Double(e.timestamp) / 1000)
            let label = Calendar.current.isDateInToday(d) ? "Today" : Calendar.current.isDateInYesterday(d) ? "Yesterday" : d.formatted(date: .complete, time: .omitted)
            if map[label] == nil { order.append(label) }
            map[label, default: []].append(e)
        }
        return order.map { ($0, map[$0]!) }
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    TextField("Filter history", text: Binding(get: { options.filter }, set: {
                        options.filter = $0
                        resetPageLimit()
                    })).textFieldStyle(.plain)
                }
                .padding(.horizontal, 10).padding(.vertical, 7).background(.quaternary.opacity(0.5), in: .rect(cornerRadius: 9))
                Picker("Show", selection: Binding(get: { category }, set: { value in
                    app.update(tabId, recordHistory: false) { $0.state["category"] = .string(.init(value.rawValue)) }
                })) {
                    ForEach(Category.allCases) { Text($0.label).tag($0) }
                }.fixedSize()
                if category == .scripture {
                    Toggle(isOn: Binding(get: { studyOnly }, set: { value in
                        app.update(tabId, recordHistory: false) { $0.state["studyOnly"] = .bool(value) }
                    })) {
                        Label("Study Only", systemImage: "line.3.horizontal.decrease")
                    }
                    .toggleStyle(.button).clickableCursor()
                    .labelStyle(.iconOnly)
                    .help("Hide chapter-only reading visits")
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
            Divider()
            ScrollViewReader { proxy in
                List {
                    if entries.isEmpty {
                        ContentUnavailableView("No History", systemImage: "clock",
                                               description: Text("Passages, notes, Strong's numbers and searches you open appear here."))
                    } else if shown.isEmpty {
                        ContentUnavailableView("No Matching History", systemImage: "magnifyingglass",
                                               description: Text("Try another category or search term."))
                    }
                    ForEach(days, id: \.0) { day, items in
                        Section(day) {
                            ForEach(items) { e in
                                row(e).id(e.id)
                                    .onScrollVisibilityChange(threshold: 0.5) { isVisible in
                                        if isVisible { visibleEntries.insert(e.id) }
                                        else { visibleEntries.remove(e.id) }
                                    }
                            }
                        }
                    }
                    if shown.count > options.visibleLimit {
                        Button("Show Older") {
                            options.visibleLimit += 300
                            app.historyBrowseOptions[tabId] = options
                        }
                        .frame(maxWidth: .infinity)
                    }
                }
                .onScrollPhaseChange { old, new in
                    guard old != .idle, new == .idle, app.activeTab?.id == tabId,
                          let first = shown.prefix(options.visibleLimit).first(where: { visibleEntries.contains($0.id) })
                    else { return }
                    options.visibleEntryID = first.id
                    app.historyBrowseOptions[tabId] = options
                }
                .task(id: restoreEntryID) {
                    guard !Task.isCancelled, let id = restoreEntryID else { return }
                    proxy.scrollTo(id, anchor: options.visibleEntryID == id ? .top : .center)
                    restoreEntryID = nil
                }
            }
        }
        .navigationTitle("History")
        .toolbar {
            ToolbarItem {
                Button("Clear History…", systemImage: "trash", role: .destructive) { confirmClear = true }
                    #if os(iOS)
                    .labelStyle(.iconOnly)
                    #else
                    .labelStyle(.titleOnly)
                    #endif
                    .disabled(entries.isEmpty).clickableCursor(!entries.isEmpty)
            }
        }
        .confirmationDialog("Clear all history on this device?", isPresented: $confirmClear, titleVisibility: .visible) {
            Button("Clear History", role: .destructive) { app.attempt("Couldn’t clear history") { try app.clearHistory() }; load() }
        } message: { Text("Your notes, highlights and tabs are not affected.") }
        .task(id: app.historyRevision) {
            load()
            guard !restoredOnLoad else { return }
            restoredOnLoad = true
            options = app.historyBrowseOptions[tabId] ?? BrowseOptions()
            if let id = app.historyReturnRows.removeValue(forKey: tabId),
               let index = shown.firstIndex(where: { $0.id == id }) {
                options.visibleLimit = max(options.visibleLimit, index + 1)
                options.visibleEntryID = nil
                app.historyBrowseOptions[tabId] = options
                restoreEntryID = id
            } else if let id = options.visibleEntryID,
                      let index = shown.firstIndex(where: { $0.id == id }) {
                options.visibleLimit = max(options.visibleLimit, index + 1)
                restoreEntryID = id
            }
        }
        .onChange(of: category) { resetPageLimit() }
        .onChange(of: studyOnly) { resetPageLimit() }
    }

    private func resetPageLimit() {
        options.visibleLimit = 300
        options.visibleEntryID = nil
        app.historyBrowseOptions[tabId] = options
    }

    func load() {
        entries = (try? app.historyService?.all(limit: AppModel.historyEntryLimit)) ?? []
        var titles: [String: String] = [:]
        for id in Set(entries.compactMap(\.noteId)) {
            if let n = try? app.notes?.one(id) { titles[id] = n.displayTitle }
        }
        noteTitles = titles
    }

    private func displayTitle(_ e: HistoryEntry) -> String {
        e.noteId.flatMap { noteTitles[$0] } ?? e.title
    }

    static func symbol(_ type: String) -> String {
        switch type { case "bible": "book"; case "compare": "rectangle.split.2x1"; case "note": "note.text"; case "lexicon", "strongs-click": "character.book.closed"; case "search": "magnifyingglass"; case "youtube": "play.rectangle"; case "import": "square.and.arrow.down"; default: "clock" }
    }

    private func strongsSourceLabel(_ entry: HistoryEntry) -> String? {
        guard entry.type == "strongs-click", let book = entry.bookId, let chapter = entry.chapter else { return nil }
        if let source = savedPassage(entry) {
            return "\(source.label) · \(textInfo(source.textId).short)"
        }
        return Reference.bookChapterVerseLabel(book, chapter: chapter, verse: entry.verse)
    }

    private func rowLabel(_ e: HistoryEntry) -> some View {
        HStack(spacing: 10) {
            Image(systemName: Self.symbol(e.type)).frame(width: 20).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Text(displayTitle(e)).lineLimit(1)
                    if let passage = scriptureDestination(e) ?? compareDestination(e)?.passage {
                        let text = textInfo(passage.textId)
                        Text(text.short)
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.secondary)
                            .accessibilityLabel(text.name)
                    }
                }
                if let comparison = compareDestination(e), !comparison.columns.isEmpty {
                    Text(comparison.columns.map(\.label).joined(separator: "  /  "))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
                if let source = strongsSourceLabel(e) {
                    Text(source).font(.caption).foregroundStyle(.secondary)
                }
                if let s = e.sessionName, s != app.session.name { Text(s).font(.caption2).foregroundStyle(.tertiary) }
            }
            Spacer()
            Text(Date(timeIntervalSince1970: Double(e.timestamp) / 1000).formatted(date: .omitted, time: .shortened)).font(.caption).foregroundStyle(.secondary).monospacedDigit()
        }
        .contentShape(.rect)
    }

    private func canOpen(_ entry: HistoryEntry) -> Bool {
        switch entry.type {
        case "bible", "compare": entry.bookId != nil && entry.chapter != nil
        case "note": entry.noteId != nil
        case "lexicon", "strongs-click": entry.strongsNum?.isEmpty == false
        case "search": entry.query?.isEmpty == false
        default: false
        }
    }

    func row(_ entry: HistoryEntry) -> some View {
        Group {
            if canOpen(entry) {
                Button { open(entry) } label: { rowLabel(entry) }
                    .buttonStyle(.interactivePlain)
            } else {
                rowLabel(entry)
            }
        }
        .contextMenu {
            if canOpen(entry) {
                if entry.type == "strongs-click" {
                    Button("Open Lexicon Entry", systemImage: "character.book.closed") { open(entry) }
                } else {
                    Button("Open") { open(entry) }
                }
            }
            if entry.type == "strongs-click", let source = savedPassage(entry) {
                Button("Open Source Passage", systemImage: "book") {
                    let passage = ResolvedPassage(textId: source.textId, bookId: source.bookId,
                                                  chapter: source.chapter, verse: source.verse)
                    app.visitScripture(passage)
                    rememberReturn(to: entry)
                }
            }
            Button("Remove from History", role: .destructive) {
                try? app.deleteHistoryEntry(entry.id)
                load()
            }
        }
        #if os(iOS)
        .swipeActions {
            Button("Remove", role: .destructive) {
                try? app.deleteHistoryEntry(entry.id)
                load()
            }
        }
        #endif
    }

    private func scriptureDestination(_ entry: HistoryEntry) -> RecentPassage? {
        entry.type == "bible" ? savedPassage(entry) : nil
    }

    private func savedPassage(_ entry: HistoryEntry) -> RecentPassage? {
        guard let payload = entry.query,
              let passage = try? JSONDecoder().decode(RecentPassage.self, from: Data(payload.utf8)),
              passage.bookId == entry.bookId, passage.chapter == entry.chapter, passage.verse == entry.verse,
              passage.textId == "kjv" || availableTexts.contains(where: { $0.id == passage.textId }) else { return nil }
        return passage
    }

    private func compareDestination(_ entry: HistoryEntry) -> CompareHistoryDestination? {
        guard entry.type == "compare", let payload = entry.query,
              let destination = try? JSONDecoder().decode(CompareHistoryDestination.self, from: Data(payload.utf8)),
              destination.passage.bookId == entry.bookId, destination.passage.chapter == entry.chapter,
              destination.passage.verse == entry.verse else { return nil }
        return destination
    }

    func open(_ e: HistoryEntry) {
        switch e.type {
        case "bible":
            guard let book = e.bookId, let chapter = e.chapter else { return }
            if let destination = scriptureDestination(e) {
                app.openScripture(bookId: book, chapter: chapter, verse: e.verse, endVerse: destination.endVerse,
                                  textId: destination.textId, reuseTab: true, verseGroups: destination.verseGroups ?? [])
            } else {
                app.openScripture(bookId: book, chapter: chapter, verse: e.verse, reuseTab: true)
            }
        case "compare":
            guard let book = e.bookId, let chapter = e.chapter else { return }
            app.reopenComparison(bookId: book, chapter: chapter, verse: e.verse, destination: compareDestination(e))
        case "note":
            guard let n = e.noteId else { return }
            app.openNote(n)
        case "lexicon", "strongs-click":
            guard let s = e.strongsNum, !s.isEmpty else { return }
            app.openLexicon(s, reuseTab: true)
        case "search":
            guard let q = e.query, !q.isEmpty else { return }
            if app.reopenSavedScriptureSearch(e) {
                break
            }
            if let book = e.bookId, let qualified = app.editionQualifiedQuery(q) {
                app.openBookSearch(qualified.query, bookId: book, textId: qualified.text, reuseTab: true)
            } else {
                app.openSearch(q, reuseTab: true)
            }
        default: return
        }
        rememberReturn(to: e)
    }

    private func rememberReturn(to entry: HistoryEntry) {
        guard let destination = app.activeTab?.id, destination != tabId else { return }
        app.historyReturnRows[tabId] = entry.id
        app.recordTabReturn(to: tabId)
    }
}
