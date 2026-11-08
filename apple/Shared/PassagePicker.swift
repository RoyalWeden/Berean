import SwiftUI
import BereanBible
import BereanReference

/// One recently opened passage (picker History). Kept per device (UserDefaults), newest first.
struct RecentPassage: Codable, Hashable, Identifiable {
    var textId: String
    var bookId: String
    var chapter: Int
    var verse: Int?
    var id: String { "\(textId)|\(bookId)|\(chapter)" }
    var label: String { Reference.bookChapterVerseLabel(bookId, chapter: chapter, verse: verse) }
}

/// A book in some text (the picker searches every bundled text, not just the current one).
struct CatalogBook: Hashable, Identifiable {
    let textId: String
    let book: BookRow
    var id: String { "\(textId)|\(book.id)" }
    static func == (a: CatalogBook, b: CatalogBook) -> Bool { a.id == b.id }
    func hash(into h: inout Hasher) { h.combine(id) }
}

extension AppModel {
    static let recentKey = "nativeRecentPassages"

    var recentPassages: [RecentPassage] {
        (UserDefaults.standard.data(forKey: Self.recentKey)).flatMap { try? JSONDecoder().decode([RecentPassage].self, from: $0) } ?? []
    }

    /// Records a visited passage (dedup by text + book + chapter, newest first, 40 kept).
    func recordRecent(textId: String, bookId: String, chapter: Int, verse: Int?) {
        var list = recentPassages.filter { !($0.textId == textId && $0.bookId == bookId && $0.chapter == chapter) }
        list.insert(RecentPassage(textId: textId, bookId: bookId, chapter: chapter, verse: verse), at: 0)
        if let data = try? JSONEncoder().encode(Array(list.prefix(40))) { UserDefaults.standard.set(data, forKey: Self.recentKey) }
    }

    /// Every book of every listed text, in list order.
    func catalog() async -> [CatalogBook] {
        var out: [CatalogBook] = []
        for t in availableTexts { out += await books(for: t.id).map { CatalogBook(textId: t.id, book: $0) } }
        return out
    }
}

/// The passage navigator: search & history (left), books → chapters (middle), texts (right).
struct PassagePicker: View {
    @Environment(AppModel.self) private var app
    let textId: String
    let currentBook: String
    let currentChapter: Int
    /// (textId, bookId, chapter, verse)
    let onPick: (String, String, Int, Int?) -> Void
    var compact = false

    @State private var text: String = ""
    @State private var query = ""
    @State private var books: [BookRow] = []
    @State private var catalog: [CatalogBook] = []
    @State private var openBook: BookRow?
    @FocusState private var searchFocused: Bool

    var trimmed: String { query.trimmingCharacters(in: .whitespaces) }

    /// Book-name matches across every text; the current text's copy first.
    var bookMatches: [CatalogBook] {
        guard !trimmed.isEmpty else { return [] }
        let q = trimmed.lowercased()
        let hits = catalog.filter { $0.book.name.lowercased().contains(q) || $0.book.shortName.lowercased().hasPrefix(q) || $0.book.id.lowercased().hasPrefix(q) }
        func rank(_ c: CatalogBook) -> (Int, Int) { (c.textId == text ? 0 : 1, c.book.name.lowercased().hasPrefix(q) ? 0 : 1) }
        return Array(hits.sorted { rank($0) < rank($1) }.prefix(40))
    }

    var parsedRef: ParsedRef? { trimmed.isEmpty ? nil : Reference.parse(trimmed) }

    var body: some View {
        Group {
            if compact {
                VStack(spacing: 0) { leftColumn.frame(maxHeight: 260); Divider(); middleColumn }
            } else {
                HStack(spacing: 0) {
                    leftColumn.frame(width: 250)
                    Divider()
                    middleColumn.frame(width: 330)
                    Divider()
                    textColumn.frame(width: 210)
                }
                .frame(height: 420)
            }
        }
        .task {
            text = textId
            books = await app.books(for: text)
            openBook = books.first { $0.id == currentBook }
            searchFocused = true
            catalog = await app.catalog()
        }
        .onChange(of: text) { _, t in
            Task {
                books = await app.books(for: t)
                if let b = openBook { openBook = books.first { $0.id == b.id } }
            }
        }
    }

    // MARK: left — search across all texts, Go to, History

    var leftColumn: some View {
        VStack(spacing: 0) {
            TextField("Book, reference or text", text: $query)
                .textFieldStyle(.roundedBorder)
                .focused($searchFocused)
                .onSubmit(submit)
                .padding(10)
                .accessibilityLabel("Search books and references in every text")
            List {
                if let ref = parsedRef {
                    Section("Go to") {
                        Button { go(ref) } label: { Label(Reference.bookChapterVerseLabel(ref.bookId, chapter: ref.chapter, verse: ref.verse), systemImage: "arrow.right.circle") }
                            .buttonStyle(.plain)
                    }
                }
                if !bookMatches.isEmpty {
                    Section("Books") {
                        ForEach(bookMatches) { m in
                            Button { choose(m) } label: {
                                HStack {
                                    Text(m.book.name)
                                    Spacer()
                                    Text(textInfo(m.textId).short).font(.caption).foregroundStyle(.secondary)
                                }.contentShape(.rect)
                            }.buttonStyle(.plain)
                        }
                    }
                }
                if trimmed.isEmpty || (parsedRef == nil && bookMatches.isEmpty) {
                    Section("History") {
                        let recents = app.recentPassages
                        if recents.isEmpty { Text("Passages you open appear here.").foregroundStyle(.secondary) }
                        ForEach(recents.prefix(25)) { r in
                            Button { onPick(r.textId, r.bookId, r.chapter, r.verse) } label: {
                                HStack {
                                    Image(systemName: "clock.arrow.circlepath").foregroundStyle(.secondary)
                                    Text(r.label)
                                    Spacer()
                                    if r.textId != "kjva" { Text(textInfo(r.textId).short).font(.caption).foregroundStyle(.secondary) }
                                }.contentShape(.rect)
                            }.buttonStyle(.plain)
                        }
                    }
                }
                if compact {
                    Section("Text") {
                        Picker("Text", selection: $text) { ForEach(availableTexts) { Text($0.name).tag($0.id) } }
                    }
                }
            }
            .listStyle(.sidebar)
        }
    }

    func submit() {
        if let ref = parsedRef { go(ref) } else if let first = bookMatches.first { choose(first) }
    }

    /// A parsed reference stays in the current text when it has the book, else opens the first text that does.
    func go(_ ref: ParsedRef) {
        let t = ref.forcedTranslation == "LXX" ? "lxx" : textFor(bookId: ref.bookId)
        onPick(t, ref.bookId, ref.chapter, ref.verse)
    }

    func textFor(bookId: String) -> String {
        if books.contains(where: { $0.id == bookId }) { return text }
        return catalog.first { $0.book.id == bookId }?.textId ?? text
    }

    func choose(_ m: CatalogBook) {
        if m.book.chaptersCount <= 1 { onPick(m.textId, m.book.id, 1, nil); return }
        if m.textId != text { text = m.textId }
        openBook = m.book
        query = ""
    }

    // MARK: middle — books, then chapters (with an internal Back)

    @ViewBuilder var middleColumn: some View {
        if let b = openBook {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Button { openBook = nil } label: { Label("Books", systemImage: "chevron.backward") }
                        .buttonStyle(.borderless)
                        .keyboardShortcut(.leftArrow, modifiers: [.command])
                        .help("Back to the book list (⌘←)")
                    Spacer()
                    Text(b.name).font(.headline).lineLimit(1)
                }.padding(10)
                Divider()
                ScrollView {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 42, maximum: 48), spacing: 6)], spacing: 6) {
                        ForEach(1...max(1, b.chaptersCount), id: \.self) { c in
                            let current = b.id == currentBook && c == currentChapter && text == textId
                            Button { onPick(text, b.id, c, nil) } label: {
                                Text(Reference.displayChapterString(b.id, c)).monospacedDigit().frame(width: 42, height: 30)
                                    .background(current ? Color.accentColor : Color.secondary.opacity(0.12), in: .rect(cornerRadius: 6))
                                    .foregroundStyle(current ? .white : .primary)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("\(b.name) chapter \(c)")
                        }
                    }.padding(12)
                }
            }
        } else {
            ScrollViewReader { proxy in
                List {
                    ForEach(sections, id: \.0) { s in
                        Section(s.0) {
                            ForEach(s.1, id: \.id) { b in
                                Button { openBook = b } label: {
                                    HStack {
                                        Text(b.name).fontWeight(b.id == currentBook ? .semibold : .regular)
                                        Spacer()
                                        Text("\(b.chaptersCount)").font(.caption).foregroundStyle(.tertiary).monospacedDigit()
                                    }.contentShape(.rect)
                                }
                                .buttonStyle(.plain).id(b.id)
                            }
                        }
                    }
                }
                .listStyle(.sidebar)
                .onChange(of: books.count) { DispatchQueue.main.async { proxy.scrollTo(currentBook, anchor: .center) } }
            }
        }
    }

    var sections: [(String, [BookRow])] {
        var out: [(String, [BookRow])] = []
        for b in books {
            let title = Self.sectionTitle(b.testament)
            if out.last?.0 == title { out[out.count - 1].1.append(b) } else { out.append((title, [b])) }
        }
        return out
    }

    static func sectionTitle(_ t: String) -> String {
        switch t.uppercased() { case "OT": "Old Testament"; case "NT": "New Testament"; case "": "Books"; default: t.capitalized }
    }

    // MARK: right — texts

    var textColumn: some View {
        List {
            ForEach(["Bible", "Other writings"], id: \.self) { section in
                Section(section) {
                    ForEach(availableTexts.filter { $0.section == section }) { t in
                        Button { text = t.id } label: {
                            HStack {
                                Text(t.name).lineLimit(2)
                                Spacer()
                                if t.id == text { Image(systemName: "checkmark").foregroundStyle(.tint) }
                            }.contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(t.id == text ? .isSelected : [])
                    }
                }
            }
        }
        .listStyle(.sidebar)
    }
}

extension Reference {
    /// The chapter number as shown to readers (custom-numbered books such as Recognitions 3 differ from storage).
    static func displayChapterString(_ bookId: String, _ stored: Int) -> String {
        let d = displayChapter(bookId, Double(stored))
        return d == d.rounded() ? String(Int(d)) : String(d)
    }
}
