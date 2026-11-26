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
    var verseGroups: [ClosedRange<Int>]? = nil

    var id: String {
        "\(textId)|\(bookId)|\(chapter)|\(verse.map(String.init) ?? "")|\(endVerse.map(String.init) ?? "")|\(verseGroups ?? [])"
    }

    var label: String {
        ResolvedPassage(textId: textId, bookId: bookId, chapter: chapter, verse: verse, endVerse: endVerse, verseGroups: verseGroups ?? []).label
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
        (UserLibrary.defaults.data(forKey: Self.recentKey)).flatMap { try? JSONDecoder().decode([RecentPassage].self, from: $0) } ?? []
    }

    /// Records a visited destination, newest first, with up to 40 entries.
    func recordRecent(textId: String, bookId: String, chapter: Int, verse: Int?, endVerse: Int? = nil, verseGroups: [ClosedRange<Int>] = []) {
        let destination = RecentPassage(textId: textId, bookId: bookId, chapter: chapter, verse: verse, endVerse: endVerse, verseGroups: verseGroups.isEmpty ? nil : verseGroups)
        var list = recentPassages.filter { $0 != destination }
        list.insert(destination, at: 0)
        if let data = try? JSONEncoder().encode(Array(list.prefix(40))) { UserLibrary.defaults.set(data, forKey: Self.recentKey) }
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
    let onPick: (ResolvedPassage) -> Void
    var compact = false
    /// Compact navigation belongs to iPhone. Shared sheet callers cannot
    /// accidentally replace the desktop's three-column browser with phone tiles.
    private var usesCompactLayout: Bool {
        #if os(iOS)
        compact
        #else
        false
        #endif
    }
    /// An optional chapter preview enables the verse grid; a verse tap finishes
    /// with onPick. This works within either platform's own browser layout.
    /// Nil keeps the one-tap chapter pick.
    var onPreview: ((ResolvedPassage) -> Void)? = nil
    @State private var verseGrid: (edition: ChapterEdition, rows: [ChapterVerseRow])?
    @State private var chapterPreviewID: UUID?

    @State private var showingTexts = false
    @State private var textQuery = ""
    @State private var chosenText: String?
    private var text: String { chosenText ?? textId }
    @State private var loadedRequest: BrowseRequest?
    @State private var bookChoice: CatalogBook?
    @State private var didPick = false
    @State private var query = ""
    @State private var books: [BookRow] = []
    @State private var chosenBookSection: String?
    @State private var catalog: [CatalogBook] = []
    @State private var openBook: BookRow?
    @State private var chapters: [Int] = []
    @State private var alternateEdition: ChapterEdition?
    @FocusState private var searchFocused: Bool

    var trimmed: String { query.trimmingCharacters(in: .whitespaces) }

    /// Book-name matches across every text; the current text's copy first.
    var bookMatches: [CatalogBook] {
        guard !trimmed.isEmpty else { return [] }
        let q = trimmed.lowercased()
        let hits = catalog.filter { match in
            match.book.name.lowercased().contains(q)
                || match.book.shortName.lowercased().hasPrefix(q)
                || match.book.id.lowercased().hasPrefix(q)
                || Self.pickerBookName(match.book, in: match.textId).lowercased().contains(q)
        }
        func rank(_ c: CatalogBook) -> (Int, Int, Int) {
            (c.textId == text ? 0 : 1, c.book.name.lowercased().hasPrefix(q) ? 0 : 1,
             c.textId == app.hermasEdition.rawValue ? 0 : 1)
        }
        return Array(hits.sorted { rank($0) < rank($1) }.prefix(40))
    }

    var resolved: ResolvedPassage? { trimmed.isEmpty ? nil : app.resolvePassage(trimmed, preferring: text) }

    var body: some View {
        Group {
            if usesCompactLayout {
                VStack(spacing: 0) {
                    compactHeader
                    if trimmed.isEmpty { middleColumn }
                    else { leftColumn }
                }
            } else {
                HStack(spacing: 0) {
                    leftColumn.frame(width: 250)
                    Divider()
                    middleColumn.frame(width: 330)
                    Divider()
                    textColumn.frame(width: 210)
                }
                .frame(height: 480)
            }
        }
        .task {
            searchFocused = !usesCompactLayout
            catalog = app.bookCatalog.isEmpty ? await app.catalog() : app.bookCatalog
        }
        .task(id: BrowseRequest(text: text, choice: bookChoice)) {
            let request = BrowseRequest(text: text, choice: bookChoice)
            guard request != loadedRequest, !didPick else { return }
            let requestedText = request.text
            let choice = request.choice
            let initial = loadedRequest == nil
            let bookID: String?
            if choice?.textId == requestedText {
                bookID = choice?.book.id
            } else if requestedText == "kjva" {
                bookID = nil
            } else {
                bookID = openBook?.id ?? (initial ? currentBook : nil)
            }
            let newBooks = await app.books(for: requestedText)
            let book = newBooks.count == 1 ? newBooks.first : newBooks.first { $0.id == bookID }
            let newChapters: [Int]
            if let book {
                newChapters = await app.bible.chapterNumbers(book.id, textId: requestedText)
            } else {
                newChapters = []
            }
            guard !Task.isCancelled, !didPick, requestedText == text, choice == bookChoice else { return }
            books = newBooks
            chapters = newChapters
            openBook = newChapters.isEmpty || (newBooks.count > 1 && initial && choice == nil && newChapters.count == 1) ? nil : book
            loadedRequest = request
            if choice?.textId == requestedText, let book, newChapters.count == 1, let chapter = newChapters.first {
                pick(ResolvedPassage(textId: requestedText, bookId: book.id, chapter: chapter, verse: nil))
            }
        }
        #if os(iOS)
        .sheet(isPresented: $showingTexts) {
            NavigationStack {
                textColumn
                    .searchable(text: $textQuery, prompt: "Find a text")
                    .scrollDismissesKeyboard(.interactively)
                    .navigationTitle("Texts")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { showingTexts = false } } }
            }
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
        #endif
        .task(id: sourceEdition) {
            alternateEdition = nil
            let target = await app.installedCounterpart(of: sourceEdition)
            guard !Task.isCancelled else { return }
            alternateEdition = target
        }
        .onDisappear { chapterPreviewID = nil }
    }

    private struct BrowseRequest: Equatable {
        let text: String
        let choice: CatalogBook?
    }

    private var sourceEdition: ChapterEdition {
        ChapterEdition(book: currentBook, chapter: currentChapter, text: textId)
    }

    // MARK: left — search across all texts, Go to, History

    var leftColumn: some View {
        VStack(spacing: 0) {
            if !usesCompactLayout {
                TextField("Book, reference or text", text: $query)
                    .textFieldStyle(.roundedBorder)
                    .focused($searchFocused)
                    .onSubmit(submit)
                    .padding(10)
                    .accessibilityLabel("Search books and references in every text")
            }
            List {
                if trimmed.isEmpty, let target = alternateEdition, target == sourceEdition.counterpart {
                    Section("Same Passage") {
                        Button {
                            pick(ResolvedPassage(textId: target.text, bookId: target.book, chapter: target.chapter, verse: nil))
                        } label: {
                            HStack {
                                Label(Reference.readerChapterLabel(target.book, target.chapter, textId: target.text),
                                      systemImage: "arrow.left.arrow.right")
                                Spacer()
                                Text(textInfo(target.text).short).font(.caption).foregroundStyle(.secondary)
                            }
                            .contentShape(.rect)
                        }
                        .buttonStyle(.interactivePlain)
                    }
                }
                if let p = resolved {
                    Section("Go to") {
                        Button { pick(p) } label: {
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
                                    Text(Self.pickerBookName(m.book, in: m.textId))
                                        .accessibilityLabel(m.book.name)
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
                            Button { pick(ResolvedPassage(textId: r.textId, bookId: r.bookId, chapter: r.chapter, verse: r.verse, endVerse: r.endVerse, verseGroups: r.verseGroups ?? [])) } label: {
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
            }
            .listStyle(.sidebar)
            #if os(iOS)
            .scrollDismissesKeyboard(usesCompactLayout ? .interactively : .automatic)
            #endif
        }
    }

    private var compactHeader: some View {
        VStack(spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Book or reference", text: $query)
                    .textFieldStyle(.plain)
                    .focused($searchFocused)
                    .onSubmit(submit)
                    .autocorrectionDisabled()
                    .accessibilityLabel("Search books and references in every text")
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    .submitLabel(.go)
                    #endif
                if !query.isEmpty {
                    Button { query = "" } label: {
                        Label("Clear search", systemImage: "xmark.circle.fill")
                            .labelStyle(.iconOnly).foregroundStyle(.secondary)
                            #if os(iOS)
                            .frame(width: 44, height: 44).contentShape(.rect)
                            #endif
                    }
                }
                if searchFocused {
                    Button { searchFocused = false } label: {
                        Label("Dismiss keyboard", systemImage: "keyboard.chevron.compact.down")
                            .labelStyle(.iconOnly).foregroundStyle(.secondary)
                            #if os(iOS)
                            .frame(width: 44, height: 44).contentShape(.rect)
                            #endif
                    }
                }
            }
            .padding(.horizontal, 16).frame(minHeight: 50)
            .glassEffectCompat(interactive: true)
            Button {
                searchFocused = false
                textQuery = ""
                showingTexts = true
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "books.vertical").font(.title3).foregroundStyle(.tint)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(textInfo(text).name).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                        Text("Bible and other writings").font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 8)
                    Image(systemName: "arrow.left.arrow.right").font(.subheadline).foregroundStyle(.secondary)
                }
                .padding(.horizontal, 14).frame(minHeight: 54)
                .contentShape(.rect)
            }
            .buttonStyle(.interactivePlain)
            .accessibilityLabel("Choose text, currently \(textInfo(text).name)")
        }
        .padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 8)
    }

    private func selectText(_ id: String) {
        chapterPreviewID = nil
        searchFocused = false
        if id != text { chosenBookSection = nil }
        chosenText = id
        bookChoice = nil
        verseGrid = nil
        query = ""
        showingTexts = false
    }

    private func pick(_ passage: ResolvedPassage) {
        guard !didPick else { return }
        searchFocused = false
        didPick = true
        chapterPreviewID = nil
        onPick(passage)
    }

    private func showBooks() {
        chapterPreviewID = nil
        openBook = nil
        chapters = []
        bookChoice = nil
        loadedRequest = BrowseRequest(text: text, choice: nil)
    }

    func submit() {
        if let p = resolved { pick(p) } else if let first = bookMatches.first { choose(first) }
    }

    func choose(_ match: CatalogBook) {
        chapterPreviewID = nil
        searchFocused = false
        verseGrid = nil
        if match.textId != text { chosenBookSection = nil }
        chosenText = match.textId
        bookChoice = match
        query = ""
    }

    func open(_ book: BookRow, in textId: String) {
        chapterPreviewID = nil
        searchFocused = false
        verseGrid = nil
        bookChoice = CatalogBook(textId: textId, book: book)
    }

    // MARK: middle — books, then chapters (with an internal Back)

    @ViewBuilder var middleColumn: some View {
        if loadedRequest != BrowseRequest(text: text, choice: bookChoice) {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let grid = verseGrid {
            let edition = grid.edition
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Button { chapterPreviewID = nil; verseGrid = nil } label: { Label("Chapters", systemImage: "chevron.backward") }
                        .buttonStyle(.interactivePlain)
                    Spacer()
                    Text(Reference.readerChapterLabel(edition.book, edition.chapter, textId: edition.text)).font(.headline).lineLimit(1)
                }.padding(10)
                Divider()
                if grid.rows.isEmpty {
                    ContentUnavailableView("No Verses Available", systemImage: "book")
                } else {
                    ScrollView {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 44, maximum: 52), spacing: 6)], spacing: 6) {
                            ForEach(grid.rows, id: \.verseNum) { row in
                                Button {
                                    pick(ResolvedPassage(textId: edition.text, bookId: edition.book,
                                                         chapter: edition.chapter, verse: row.verseNum))
                                } label: {
                                    Text(row.readerVerseLabel).monospacedDigit()
                                        .lineLimit(1).minimumScaleFactor(0.65)
                                        .frame(maxWidth: .infinity).frame(height: 44)
                                        .background(Color.secondary.opacity(0.12), in: .rect(cornerRadius: 8))
                                        .contentShape(.rect)
                                }
                                .buttonStyle(.interactivePlain)
                                .accessibilityLabel(row.readerVerseNumbers.lowerBound == row.readerVerseNumbers.upperBound
                                    ? "Verse \(row.readerVerseLabel)" : "Verses \(row.readerVerseLabel)")
                            }
                        }
                        .padding(12)
                    }
                }
            }
        } else if let b = openBook {
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    if books.count > 1 {
                        Button(action: showBooks) { Label("Books", systemImage: "chevron.backward") }
                            .buttonStyle(.interactivePlain)
                            .keyboardShortcut(.leftArrow, modifiers: [.command])
                            .help("Back to the book list (⌘←)")
                    }
                    Spacer()
                    Text(Self.pickerBookName(b, in: text)).font(.headline).lineLimit(1)
                        .accessibilityLabel(b.name)
                }.padding(10)
                Divider()
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 44, maximum: 52), spacing: 6)], spacing: 6) {
                            ForEach(chapters, id: \.self) { chapter in
                                chapterButton(chapter, in: b)
                                    .id(chapter)
                            }
                        }
                        .padding(12)
                    }
                    .onAppear {
                        if b.id == currentBook, text == textId, chapters.contains(currentChapter) {
                            proxy.scrollTo(currentChapter, anchor: .center)
                        }
                    }
                }
            }
        } else {
            VStack(spacing: 0) {
                #if os(macOS)
                HStack {
                    Text("Books").font(.headline)
                    Spacer()
                    Text("\(books.count)").font(.caption).monospacedDigit()
                        .foregroundStyle(.secondary)
                }
                .padding(.horizontal, 12).padding(.vertical, 10)
                Divider()
                #endif
                if let activeBookSection {
                    bookSectionPicker(selection: activeBookSection)
                }
                ScrollViewReader { proxy in
                    bookList
                        .id(activeBookSection)
                        .onAppear {
                            if text == textId, displayedBookSections.contains(where: { $0.1.contains { $0.id == currentBook } }) {
                                proxy.scrollTo(currentBook, anchor: .center)
                            }
                        }
                }
            }
        }
    }

    private var activeBookSection: String? {
        guard text == "kjva", sections.count > 1 else { return nil }
        if let chosenBookSection, sections.contains(where: { $0.0 == chosenBookSection }) { return chosenBookSection }
        if text == textId, let current = sections.first(where: { $0.1.contains { $0.id == currentBook } }) {
            return current.0
        }
        return sections.first?.0
    }

    private var displayedBookSections: [(String, [BookRow])] {
        guard let activeBookSection else { return sections }
        return sections.filter { $0.0 == activeBookSection }
    }

    private func bookSectionPicker(selection: String) -> some View {
        Picker("Book section", selection: Binding(get: { selection }, set: { section in
            if usesCompactLayout { searchFocused = false }
            chosenBookSection = section
        })) {
            ForEach(sections, id: \.0) { title, _ in
                let label = switch title {
                case "Old Testament": "OT"
                case "New Testament": "NT"
                default: title
                }
                Text(label).accessibilityLabel(title).tag(title)
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    @ViewBuilder private var bookList: some View {
        if usesCompactLayout {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14, pinnedViews: [.sectionHeaders]) {
                    ForEach(displayedBookSections, id: \.0) { title, rows in
                        Section {
                            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 6), count: 3), spacing: 6) {
                                ForEach(rows, id: \.id) { book in bookTile(book).id(book.id) }
                            }
                            .padding(.horizontal, 12)
                        } header: {
                            if activeBookSection == nil, !title.isEmpty {
                                Text(title).font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.horizontal, 16).padding(.vertical, 6)
                                    .background(.background)
                            }
                        }
                    }
                }
                .padding(.vertical, 8)
            }
            #if os(iOS)
            .scrollDismissesKeyboard(.interactively)
            #endif
        } else {
            List {
                ForEach(displayedBookSections, id: \.0) { title, rows in
                    Section {
                        ForEach(rows, id: \.id) { book in
                            let current = book.id == currentBook && text == textId
                            Button { open(book, in: text) } label: {
                                HStack {
                                    Text(Self.pickerBookName(book, in: text))
                                        .fontWeight(current ? .semibold : .regular)
                                        .accessibilityLabel(book.name)
                                    Spacer()
                                    Text(book.chaptersCount == 1 ? "" : "\(book.chaptersCount)")
                                        .font(.caption).foregroundStyle(.tertiary).monospacedDigit()
                                }
                                .padding(.vertical, 4)
                                .background(current ? Color.accentColor.opacity(0.14) : .clear, in: .rect(cornerRadius: 6))
                                .contentShape(.rect)
                            }
                            .buttonStyle(.interactivePlain)
                            .accessibilityAddTraits(current ? .isSelected : [])
                            .id(book.id)
                        }
                    } header: {
                        if activeBookSection == nil, !title.isEmpty { Text(title) }
                    }
                }
            }
            .listStyle(.sidebar)
        }
    }

    private func bookTile(_ b: BookRow) -> some View {
        let current = b.id == currentBook && text == textId
        return Button { open(b, in: text) } label: {
            VStack(spacing: 1) {
                Text(Self.pickerBookName(b, in: text))
                    .font(.subheadline.weight(current ? .semibold : .regular))
                    .lineLimit(2).minimumScaleFactor(0.8).multilineTextAlignment(.center)
                if b.chaptersCount > 1 {
                    Text("\(b.chaptersCount)").font(.caption2).monospacedDigit()
                        .foregroundStyle(current ? AnyShapeStyle(.white.opacity(0.85)) : AnyShapeStyle(.tertiary))
                }
            }
            .foregroundStyle(current ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
            .frame(maxWidth: .infinity, minHeight: 46)
            .padding(.horizontal, 4)
            .background(current ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(.quaternary.opacity(0.6)),
                        in: .rect(cornerRadius: 8))
            .contentShape(.rect)
        }
        .buttonStyle(.interactivePlain)
        .accessibilityLabel(b.chaptersCount > 1 ? "\(b.name), \(b.chaptersCount) chapters" : b.name)
        .accessibilityAddTraits(current ? .isSelected : [])
    }

    static func pickerBookName(_ book: BookRow, in textId: String) -> String {
        switch (textId, book.id) {
        case ("recog_clement", _) where book.id.hasPrefix("RCL"):
            if let number = Int(book.id.dropFirst(3)), (1...10).contains(number) {
                return "Book \(number)"
            }
            return book.name
        case ("hermas", "HER_VIS"), ("hermas_taylor", "HER_VIS"):
            return "Visions"
        case ("hermas", "HER_MAN"), ("hermas_taylor", "HER_MAN"):
            return "Mandates"
        case ("hermas", "HER_SIM"), ("hermas_taylor", "HER_SIM"):
            return "Similitudes"
        default:
            return book.name
        }
    }

    private func chapterButton(_ chapter: Int, in book: BookRow) -> some View {
        let current = book.id == currentBook && chapter == currentChapter && text == textId
        let number = Reference.displayChapterString(book.id, chapter)
        let label = if chapter == 0 {
            "\(book.name) prologue"
        } else if Reference.isHermasBook(book.id) {
            Reference.readerChapterLabel(book.id, chapter, textId: text)
        } else {
            "\(book.name) chapter \(number)"
        }
        return Button {
            let passage = ResolvedPassage(textId: text, bookId: book.id, chapter: chapter, verse: nil)
            if let onPreview {
                let requestID = UUID()
                chapterPreviewID = requestID
                onPreview(passage)
                let edition = ChapterEdition(book: book.id, chapter: chapter, text: text)
                Task {
                    let rows = await app.readerChapter(edition).rows
                    guard !Task.isCancelled, chapterPreviewID == requestID, text == edition.text, !didPick else { return }
                    if rows.count == 1 { pick(passage) } else { verseGrid = (edition, rows) }
                }
            } else {
                pick(passage)
            }
        } label: {
            Text(chapter == 0 ? "Prol." : number)
                .font(chapter == 0 ? .caption : .body)
                .monospacedDigit()
                .frame(maxWidth: .infinity)
                .frame(height: usesCompactLayout ? 44 : 34)
                .background(current ? Color.accentColor : Color.secondary.opacity(0.12), in: .rect(cornerRadius: 8))
                .foregroundStyle(current ? .white : .primary)
                .contentShape(.rect)
        }
        .buttonStyle(.interactivePlain)
        .accessibilityLabel(label)
        .accessibilityAddTraits(current ? .isSelected : [])
        .help(label)
    }

    var sections: [(String, [BookRow])] {
        var out: [(String, [BookRow])] = []
        for b in books {
            let title = textInfo(text).section == "Other writings" ? "" : Self.sectionTitle(b.testament)
            if out.last?.0 == title { out[out.count - 1].1.append(b) } else { out.append((title, [b])) }
        }
        if text == "kjva" {
            let order = ["Old Testament", "New Testament", "Apocrypha"]
            return out.sorted { lhs, rhs in
                (order.firstIndex(of: lhs.0) ?? order.count) < (order.firstIndex(of: rhs.0) ?? order.count)
            }
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
                let matches = availableTexts.filter { $0.section == section && (textQuery.isEmpty || $0.name.localizedCaseInsensitiveContains(textQuery) || $0.short.localizedCaseInsensitiveContains(textQuery)) }
                if !matches.isEmpty {
                    Section(section) {
                        ForEach(matches) { t in
                            Button { selectText(t.id) } label: {
                                HStack {
                                    Text(t.name).lineLimit(2)
                                    Spacer()
                                    if t.id == text { Image(systemName: "checkmark").foregroundStyle(.tint) }
                                }
                                .frame(minHeight: usesCompactLayout ? 48 : 32)
                                .contentShape(.rect)
                            }
                            .buttonStyle(.interactivePlain)
                            .accessibilityAddTraits(t.id == text ? .isSelected : [])
                        }
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
