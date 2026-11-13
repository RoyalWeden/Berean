import SwiftUI
import BereanNotes
import BereanCore

struct CompareHistoryDestination: Codable, Equatable {
    struct Column: Codable, Equatable {
        let textId: String
        let bookId: String
        let chapter: Int
        let pinned: Bool

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

    init(state: JSObject) {
        let reader = BibleState(state)
        passage = RecentPassage(textId: reader.translation, bookId: reader.bookId, chapter: reader.chapter,
                                verse: reader.verse, endVerse: reader.endVerse)
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
    @State private var filter = ""
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
    @State private var visibleLimit = 300

    var shown: [HistoryEntry] {
        let query = filter.trimmingCharacters(in: .whitespacesAndNewlines)
        return entries.filter { e in
            category.includes(e.type)
                && !(category == .scripture && studyOnly && e.type == "bible" && (e.verse ?? 0) == 0)
                && (query.isEmpty || e.title.localizedStandardContains(query) || (e.type == "search" && (e.query ?? "").localizedStandardContains(query)))
        }
    }

    var days: [(String, [HistoryEntry])] {
        var order: [String] = [], map: [String: [HistoryEntry]] = [:]
        for e in shown.prefix(visibleLimit) {
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
                    TextField("Filter history", text: $filter).textFieldStyle(.plain)
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
                    .toggleStyle(.button)
                    .labelStyle(.iconOnly)
                    .help("Hide chapter-only reading visits")
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
            Divider()
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
                        ForEach(items) { e in row(e) }
                    }
                }
                if shown.count > visibleLimit {
                    Button("Show Older") { visibleLimit += 300 }.frame(maxWidth: .infinity)
                }
            }
        }
        .navigationTitle("History")
        .toolbar {
            ToolbarItem { Button("Clear History…", role: .destructive) { confirmClear = true }.disabled(entries.isEmpty) }
        }
        .confirmationDialog("Clear all history on this device?", isPresented: $confirmClear, titleVisibility: .visible) {
            Button("Clear History", role: .destructive) { try? app.historyService?.clear(); load() }
        } message: { Text("Your notes, highlights and tabs are not affected.") }
        .task(id: app.historyRevision) { load() }
        .onChange(of: filter) { visibleLimit = 300 }
        .onChange(of: category) { visibleLimit = 300 }
        .onChange(of: studyOnly) { visibleLimit = 300 }
    }

    func load() {
        entries = (try? app.historyService?.all(limit: AppModel.historyEntryLimit)) ?? []
    }

    static func symbol(_ type: String) -> String {
        switch type { case "bible": "book"; case "compare": "rectangle.split.2x1"; case "note": "note.text"; case "lexicon", "strongs-click": "character.book.closed"; case "search": "magnifyingglass"; case "youtube": "play.rectangle"; case "import": "square.and.arrow.down"; default: "clock" }
    }

    private func rowLabel(_ e: HistoryEntry) -> some View {
        HStack(spacing: 10) {
            Image(systemName: Self.symbol(e.type)).frame(width: 20).foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    Text(e.title).lineLimit(1)
                    if let passage = scriptureDestination(e) ?? compareDestination(e)?.passage {
                        let text = textInfo(passage.textId)
                        Text(text.short)
                            .font(.caption.weight(.medium))
                            .foregroundStyle(.secondary)
                            .accessibilityLabel(text.name)
                    }
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
            if canOpen(entry) { Button("Open") { open(entry) } }
            Button("Remove from History", role: .destructive) {
                try? app.historyService?.delete(entry.id)
                load()
            }
        }
        #if os(iOS)
        .swipeActions {
            Button("Remove", role: .destructive) {
                try? app.historyService?.delete(entry.id)
                load()
            }
        }
        #endif
    }

    private func scriptureDestination(_ entry: HistoryEntry) -> RecentPassage? {
        guard entry.type == "bible", let payload = entry.query,
              let passage = try? JSONDecoder().decode(RecentPassage.self, from: Data(payload.utf8)),
              passage.bookId == entry.bookId, passage.chapter == entry.chapter, passage.verse == entry.verse,
              availableTexts.contains(where: { $0.id == passage.textId }) else { return nil }
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
                                  textId: destination.textId, reuseTab: true)
            } else {
                app.openScripture(bookId: book, chapter: chapter, verse: e.verse, reuseTab: true)
            }
        case "compare":
            guard let book = e.bookId, let chapter = e.chapter else { return }
            app.reopenComparison(bookId: book, chapter: chapter, verse: e.verse, destination: compareDestination(e))
        case "note": if let n = e.noteId { app.openNote(n) }
        case "lexicon", "strongs-click": if let s = e.strongsNum { app.openLexicon(s, reuseTab: true) }
        case "search": if let q = e.query { app.openSearch(q, reuseTab: true) }
        default: break
        }
    }
}
