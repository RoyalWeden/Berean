import SwiftUI
import BereanBible
import BereanReference

/// One recently opened passage (picker History). Kept per device (UserDefaults), newest first.
struct RecentPassage: Codable, Hashable, Identifiable {
    var textId: String
    var bookId: String
    var chapter: Int
    var verse: Int?
    var endVerse: Int? = nil

    var id: String {
        "\(textId)|\(bookId)|\(chapter)|\(verse.map(String.init) ?? "")|\(endVerse.map(String.init) ?? "")"
    }

    var label: String {
        ResolvedPassage(textId: textId, bookId: bookId, chapter: chapter, verse: verse, endVerse: endVerse).label
    }
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

    /// Records a visited destination, newest first, with up to 40 entries.
    func recordRecent(textId: String, bookId: String, chapter: Int, verse: Int?, endVerse: Int? = nil) {
        let destination = RecentPassage(textId: textId, bookId: bookId, chapter: chapter, verse: verse, endVerse: endVerse)
        var list = recentPassages.filter { $0 != destination }
        list.insert(destination, at: 0)
        if let data = try? JSONEncoder().encode(Array(list.prefix(40))) { UserDefaults.standard.set(data, forKey: Self.recentKey) }
        let storedDestination = (try? JSONEncoder().encode(destination)).flatMap { String(data: $0, encoding: .utf8) }
        recordHistory(type: "bible", title: destination.label, bookId: bookId, chapter: chapter, verse: verse,
                      query: storedDestination)
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
    let onPick: (String, String, Int, Int?, Int?) -> Void
    var compact = false

    @State private var text: String = ""
    @State private var query = ""
    @State private var books: [BookRow] = []
    @State private var catalog: [CatalogBook] = []
    @State private var openBook: BookRow?
    @State private var chapters: [Int] = []
    @FocusState private var searchFocused: Bool

    var trimmed: String { query.trimmingCharacters(in: .whitespaces) }

    /// Book-name matches across every text; the current text's copy first.
    var bookMatches: [CatalogBook] {
        guard !trimmed.isEmpty else { return [] }
        let q = trimmed.lowercased()
        let hits = catalog.filter { $0.book.name.lowercased().contains(q) || $0.book.shortName.lowercased().hasPrefix(q) || $0.book.id.lowercased().hasPrefix(q) }
        func rank(_ c: CatalogBook) -> (Int, Int, Int) {
            (c.textId == text ? 0 : 1, c.book.name.lowercased().hasPrefix(q) ? 0 : 1,
             c.textId == app.hermasEdition.rawValue ? 0 : 1)
        }
        return Array(hits.sorted { rank($0) < rank($1) }.prefix(40))
    }

    var resolved: ResolvedPassage? { trimmed.isEmpty ? nil : app.resolvePassage(trimmed, preferring: text) }

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
            if let b = books.first(where: { $0.id == currentBook }) {
                let list = await app.bible.chapterNumbers(b.id, textId: text)
                if list.count > 1 { chapters = list; openBook = b }
            }
            searchFocused = true
            catalog = app.bookCatalog.isEmpty ? await app.catalog() : app.bookCatalog
        }
        .onChange(of: text) { _, t in
            Task {
                books = await app.books(for: t)
                if let b = openBook { openBook = books.first { $0.id == b.id }; chapters = await app.bible.chapterNumbers(b.id, textId: t) }
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
                if let p = resolved {
                    Section("Go to") {
                        Button { onPick(p.textId, p.bookId, p.chapter, p.verse, p.endVerse) } label: {
                            HStack {
                                Label(p.label, systemImage: "arrow.right.circle")
                                Spacer()
                                Text(textInfo(p.textId).short).font(.caption).foregroundStyle(.secondary)
                            }.contentShape(.rect)
                        }
                        .buttonStyle(.interactivePlain)
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
                            }.buttonStyle(.interactivePlain)
                        }
                    }
                }
                if trimmed.isEmpty || (resolved == nil && bookMatches.isEmpty) {
                    Section("History") {
                        let recents = app.recentPassages
                        if recents.isEmpty { Text("Passages you open appear here.").foregroundStyle(.secondary) }
                        ForEach(recents.prefix(25)) { r in
                            Button { onPick(r.textId, r.bookId, r.chapter, r.verse, r.endVerse) } label: {
                                HStack {
                                    Image(systemName: "clock.arrow.circlepath").foregroundStyle(.secondary)
                                    Text(r.label)
                                    Spacer()
                                    if r.textId != "kjva" { Text(textInfo(r.textId).short).font(.caption).foregroundStyle(.secondary) }
                                }.contentShape(.rect)
                            }.buttonStyle(.interactivePlain)
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
        if let p = resolved { onPick(p.textId, p.bookId, p.chapter, p.verse, p.endVerse) } else if let first = bookMatches.first { choose(first) }
    }

    func choose(_ m: CatalogBook) {
        if m.textId != text { text = m.textId }
        open(m.book, in: m.textId)
        query = ""
    }

    /// Shows a book's chapters — or, when it has only one, opens it straight away (no one-button grid).
    func open(_ b: BookRow, in textId: String) {
        Task {
            let list = await app.bible.chapterNumbers(b.id, textId: textId)
            if list.count <= 1 { onPick(textId, b.id, list.first ?? 1, nil, nil); return }
            chapters = list
            openBook = b
        }
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
                        ForEach(chapters.isEmpty ? Array(1...max(1, b.chaptersCount)) : chapters, id: \.self) { c in
                            let chapterLabel = Reference.isHermasBook(b.id)
                                ? Reference.readerChapterLabel(b.id, c, textId: text)
                                : "\(b.name) chapter \(Reference.displayChapterString(b.id, c))"
                            let current = b.id == currentBook && c == currentChapter && text == textId
                            Button { onPick(text, b.id, c, nil, nil) } label: {
                                Text(c == 0 ? "Prol." : Reference.displayChapterString(b.id, c)).font(c == 0 ? .caption : .body).monospacedDigit().frame(width: 42, height: 30)
                                    .background(current ? Color.accentColor : Color.secondary.opacity(0.12), in: .rect(cornerRadius: 6))
                                    .foregroundStyle(current ? .white : .primary)
                            }
                            .buttonStyle(.interactivePlain)
                            .accessibilityLabel(c == 0 ? "\(b.name) prologue" : chapterLabel)
                            .help(c == 0 ? "Prologue" : chapterLabel)
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
                                Button { open(b, in: text) } label: {
                                    HStack {
                                        Text(b.name).fontWeight(b.id == currentBook ? .semibold : .regular)
                                        Spacer()
                                        Text(b.chaptersCount == 1 ? "" : "\(b.chaptersCount)").font(.caption).foregroundStyle(.tertiary).monospacedDigit()
                                    }.contentShape(.rect)
                                }
                                .buttonStyle(.interactivePlain).id(b.id)
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
                        .buttonStyle(.interactivePlain)
                        .accessibilityAddTraits(t.id == text ? .isSelected : [])
                    }
                }
            }
        }
        .listStyle(.sidebar)
    }
}

extension Reference {
    static func readerChapterLabel(_ bookId: String, _ chapter: Int, textId: String) -> String {
        if isHermasBook(bookId) {
            return bookChapterVerseLabel(bookId, chapter: chapter, hermas: HermasText(textId: textId))
        }
        return bookChapterLabel(bookId, chapter: Double(chapter))
    }

    /// The chapter number as shown to readers (custom-numbered books such as Recognitions 3 differ from storage).
    static func displayChapterString(_ bookId: String, _ stored: Int) -> String {
        let d = displayChapter(bookId, Double(stored))
        return d == d.rounded() ? String(Int(d)) : String(d)
    }
}
