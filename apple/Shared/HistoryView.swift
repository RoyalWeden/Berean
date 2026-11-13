import SwiftUI
import BereanNotes

/// History (the existing History tab / sheet): everything you opened — passages, notes, Strong's numbers, searches — newest
/// first, grouped by day, filterable; tap to reopen. Device-local (`history` table).
struct HistoryView: View {
    @Environment(AppModel.self) private var app
    @State private var entries: [HistoryEntry] = []
    @State private var filter = ""
    @State private var kind = "all"
    @State private var confirmClear = false
    @State private var hasMore = false

    var shown: [HistoryEntry] {
        entries.filter { e in
            (kind == "all" || e.type == kind) && (filter.isEmpty || e.title.localizedCaseInsensitiveContains(filter) || (e.type == "search" && (e.query ?? "").localizedCaseInsensitiveContains(filter)))
        }
    }

    var days: [(String, [HistoryEntry])] {
        var order: [String] = [], map: [String: [HistoryEntry]] = [:]
        for e in shown {
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
                Picker("Show", selection: $kind) {
                    Text("All").tag("all"); Text("Passages").tag("bible"); Text("Notes").tag("note"); Text("Lexicon").tag("lexicon"); Text("Searches").tag("search")
                }.fixedSize()
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
            Divider()
            List {
                if shown.isEmpty { ContentUnavailableView("No history", systemImage: "clock", description: Text("Passages, notes, Strong's numbers and searches you open appear here.")) }
                ForEach(days, id: \.0) { day, items in
                    Section(day) {
                        ForEach(items) { e in row(e) }
                    }
                }
                if hasMore && filter.isEmpty && kind == "all" {
                    Button("Show Older") { loadMore() }.frame(maxWidth: .infinity)
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
    }

    func load() {
        entries = (try? app.historyService?.all(limit: 300)) ?? []
        hasMore = entries.count >= 300
    }

    func loadMore() {
        guard let last = entries.last else { return }
        let more = (try? app.historyService?.page(before: last.timestamp, limit: 300)) ?? []
        entries += more
        hasMore = more.count >= 300
    }

    static func symbol(_ type: String) -> String {
        switch type { case "bible": "book"; case "note": "note.text"; case "lexicon": "character.book.closed"; case "search": "magnifyingglass"; case "youtube": "play.rectangle"; case "import": "square.and.arrow.down"; default: "clock" }
    }

    func row(_ e: HistoryEntry) -> some View {
        Button { open(e) } label: {
            HStack(spacing: 10) {
                Image(systemName: Self.symbol(e.type)).frame(width: 20).foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 6) {
                        Text(e.title).lineLimit(1)
                        if let passage = scriptureDestination(e) {
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
        .buttonStyle(.interactivePlain)
        .contextMenu {
            Button("Open") { open(e) }
            Button("Remove from History", role: .destructive) { try? app.historyService?.delete(e.id); load() }
        }
        #if os(iOS)
        .swipeActions { Button("Remove", role: .destructive) { try? app.historyService?.delete(e.id); load() } }
        #endif
    }

    private func scriptureDestination(_ entry: HistoryEntry) -> RecentPassage? {
        guard entry.type == "bible", let payload = entry.query,
              let passage = try? JSONDecoder().decode(RecentPassage.self, from: Data(payload.utf8)),
              passage.bookId == entry.bookId, passage.chapter == entry.chapter, passage.verse == entry.verse,
              availableTexts.contains(where: { $0.id == passage.textId }) else { return nil }
        return passage
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
        case "note": if let n = e.noteId { app.openNote(n) }
        case "lexicon": if let s = e.strongsNum { app.openLexicon(s, reuseTab: true) }
        case "search": if let q = e.query { app.openSearch(q, reuseTab: true) }
        default: break
        }
    }
}
