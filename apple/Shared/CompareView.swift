import SwiftUI
import BereanCore
import BereanBible
import BereanText
import BereanReference
import BereanNotes
import BereanWorkspace

/// A persisted Compare column. Keep the raw object so older clients retain their metadata.
struct CompareColumn: Identifiable {
    let id: Int
    let record: JSObject
    let text: String
    let book: String
    let chapter: Int

    init?(id: Int, record: JSObject, anchor: BibleState) {
        guard let text = record["textId"]?.stringValue?.string else { return nil }
        self.id = id
        self.record = record
        self.text = text.lowercased()
        book = record["bookId"]?.stringValue?.string ?? anchor.bookId
        chapter = record["chapter"]?.numberValue.flatMap(Int.init(exactly:))
            ?? ChapterMap.mapChapter(anchor.bookId, anchor.chapter, from: anchor.translation, to: self.text)
    }

    init(id: Int, text: String, anchor: BibleState) {
        var record = JSObject()
        record["textId"] = .string(JSString(text))
        record["bookId"] = .string(JSString(anchor.bookId))
        record["chapter"] = .number(Double(ChapterMap.mapChapter(anchor.bookId, anchor.chapter, from: anchor.translation, to: text)))
        self.id = id
        self.record = record
        self.text = text
        book = anchor.bookId
        chapter = ChapterMap.mapChapter(book, anchor.chapter, from: anchor.translation, to: text)
    }

    func follows(_ anchor: BibleState) -> Bool {
        book == anchor.bookId && chapter == ChapterMap.mapChapter(book, anchor.chapter, from: anchor.translation, to: text)
    }

    var isPinned: Bool { record["nativePinnedPassage"]?.boolValue == true }

    static func followPassageChange(_ value: JSValue?, from old: BibleState, to new: BibleState) -> JSValue? {
        guard old.compareMode, new.compareMode,
              old.bookId != new.bookId || old.chapter != new.chapter || old.translation != new.translation,
              let records = value?.arrayValue else { return value }
        return .array(records.enumerated().map { index, value in
            guard var record = value.objectValue,
                  let column = CompareColumn(id: index, record: record, anchor: old),
                  !column.isPinned else { return value }
            guard column.follows(old) else {
                // Legacy records imply independence when they differ from the anchor.
                record["nativePinnedPassage"] = .bool(true)
                return .object(record)
            }
            let chapter = ChapterMap.mapChapter(new.bookId, new.chapter, from: new.translation, to: column.text)
            if column.book != new.bookId || column.chapter != chapter {
                record["bookId"] = .string(JSString(new.bookId))
                record["chapter"] = .number(Double(chapter))
                record.remove("scrollPos")
            }
            return .object(record)
        })
    }

    static func resolved(in state: JSObject) -> [CompareColumn] {
        let saved = state["compareColumns"]?.arrayValue ?? []
        let anchor = BibleState(state)
        let valid = saved.enumerated().compactMap { index, value in
            value.objectValue.flatMap { CompareColumn(id: index, record: $0, anchor: anchor) }
        }
        if !valid.isEmpty { return valid }
        return [
            CompareColumn(id: 0, text: anchor.translation, anchor: anchor),
            CompareColumn(id: 1, text: anchor.translation == "lxx" ? "kjva" : "lxx", anchor: anchor)
        ]
    }

    var historyKey: String { destinationKey + (isPinned ? ":pinned" : "") }

    var destinationKey: String { "\(text):\(book):\(chapter)" }

    var label: String {
        "\(Reference.readerChapterLabel(book, chapter, textId: text)) · \(textInfo(text).short)"
    }
}

struct CompareView: View {
    @Environment(AppModel.self) private var app
    let tabId: String
    #if os(iOS)
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .body) private var scriptureTypeScale = 1.0
    #endif

    private var hiddenAnnotations: Set<String> {
        Set((app.findTab(tabId)?.state["hiddenAnnotations"]?.arrayValue ?? []).compactMap { $0.stringValue?.string })
    }

    private var hideSuppliedWords: Bool { hiddenAnnotations.contains(AnnotationFilters.kjvaSuppliedWords) }

    private var scriptureFontSize: Double {
        #if os(iOS)
        app.fontSize * scriptureTypeScale
        #else
        app.fontSize
        #endif
    }

    private var prefersStackedComparison: Bool {
        #if os(iOS)
        dynamicTypeSize.isAccessibilitySize
        #else
        false
        #endif
    }
    @State private var rows: [Int: [Int: ChapterVerseRow]] = [:]
    @State private var independentRows: [Int: [ChapterVerseRow]] = [:]

    private struct ColumnBook: Hashable {
        let book: String
        let edition: String

        init(_ column: CompareColumn) {
            book = column.book
            edition = column.text
        }
    }

    @State private var chapterNumbers: [ColumnBook: [Int]] = [:]
    private struct EditionChapter: Hashable {
        let text: String
        let book: String
        let chapter: Int

        init(_ row: ChapterVerseRow, text: String) {
            self.text = text
            book = row.bookId
            chapter = row.chapter
        }
    }

    private struct TagChapter: Hashable {
        let book: String
        let chapter: Int

        init(_ row: ChapterVerseRow) {
            book = row.bookId
            chapter = row.chapter
        }
    }

    @State private var chapterTags: [TagChapter: [Int: [TagLite]]] = [:]
    @State private var chapterNoteCounts: [EditionChapter: [Int: Int]] = [:]
    @State private var chapterHighlights: [EditionChapter: [Int: [Highlight]]] = [:]
    @State private var loadedPassage: String?
    @State private var compareWidth: CGFloat = 0
    @State private var localVerseSelection: Int?
    @State private var editingColumn: CompareColumn?
    @State private var tagging: VerseTagTarget?
    @State private var independentVisibleVerses: [Int: Int] = [:]
    @State private var scrollingColumn: Int?
    @State private var lastScrolledColumn: Int?
    @State private var alignedVersesAboveTop: Set<Int> = []
    @State private var pendingAlignedVerse: Int?
    @State private var sharedScrollPosition = ScrollPosition()
    @State private var restoredSharedScrollKey: String?
    #if os(macOS)
    @State private var columnDragToken = UUID()
    @State private var columnDropTarget: Int?
    @State private var columnWeights: [Int: CGFloat] = [:]
    @State private var resizeStart: [Int: CGFloat]?
    #endif

    private struct VerseTagTarget: Identifiable {
        let id = UUID()
        let range: TagRange
        let label: String
    }
    @AppStorage("showVerseNumbers") private var showVerseNumbers = true

    var state: BibleState { BibleState(app.findTab(tabId)?.state ?? JSObject()) }
    var columns: [CompareColumn] {
        CompareColumn.resolved(in: app.findTab(tabId)?.state ?? JSObject())
    }

    private var syncScrolling: Bool {
        app.findTab(tabId)?.state["compareSyncScroll"]?.boolValue ?? true
    }

    private func canShowIndependentPanes(width: CGFloat, count: Int) -> Bool {
        guard count > 1, !prefersStackedComparison else { return false }
        #if os(iOS)
        if count == 2 { return width >= 320 }
        #endif
        return width >= CGFloat(count) * 260
    }

    var body: some View {
        let st = state, cols = columns
        let passage = passageKey(st, cols)
        GeometryReader { geometry in
            if loadedPassage != passage {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if canShowIndependentPanes(width: geometry.size.width, count: cols.count),
                      !syncScrolling || !cols.allSatisfy({ $0.follows(st) }) {
                independentPanes(cols, passage: passage, compact: geometry.size.width < CGFloat(cols.count) * 260)
            } else if !cols.allSatisfy({ $0.follows(st) }) {
                let key = "stacked|" + passage
                restoredCompareScroll(key: key) {
                    independentComparison(cols)
                }
            } else {
                alignedComparison(st, cols)
            }
        }
        .task(id: Set(cols.map(ColumnBook.init))) {
            let books = Set(cols.map(ColumnBook.init))
            var numbers = chapterNumbers.filter { books.contains($0.key) }
            for book in books where numbers[book] == nil {
                let installed = await app.bible.chapterNumbers(book.book, textId: book.edition)
                guard !Task.isCancelled else { return }
                numbers[book] = installed
            }
            guard !Task.isCancelled else { return }
            chapterNumbers = numbers
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { compareWidth = $0 }
        .onChange(of: passage) {
            independentVisibleVerses = [:]
            scrollingColumn = nil
            lastScrolledColumn = nil
            alignedVersesAboveTop = []
            pendingAlignedVerse = nil
            restoredSharedScrollKey = nil
        }
        #if os(iOS)
        .safeAreaInset(edge: .top, spacing: 0) {
            HStack(spacing: 2) {
                manageTranslations(st, cols)
                    .menuStyle(.borderlessButton).clickableCursor()
                    .menuIndicator(.hidden)
                    .hoverEffect(.highlight)
                Button("Exit Compare", systemImage: "xmark") {
                    app.update(tabId) { $0.state.remove("compareMode") }
                }
                .labelStyle(.iconOnly)
                .frame(minWidth: 44, minHeight: 44)
                .buttonStyle(.interactivePlain)
            }
            .padding(.horizontal, 4)
            .glassEffectCompat(interactive: true)
            .frame(maxWidth: .infinity, alignment: .trailing)
            .padding(.horizontal, 16)
        }
        #endif
        #if os(macOS)
        .toolbar {
            ToolbarItem { manageTranslations(st, cols) }
        }
        #endif
        .sheet(item: $editingColumn) { column in
            NavigationStack {
                PassagePicker(textId: column.text, currentBook: column.book, currentChapter: column.chapter, onPick: { passage in
                    changePassage(for: column.id, text: passage.textId, book: passage.bookId, chapter: passage.chapter)
                    editingColumn = nil
                }, compact: true)
                .navigationTitle("Choose Column Chapter")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { editingColumn = nil }
                    }
                }
            }
            #if os(macOS)
            .frame(minWidth: 460, minHeight: 520)
            #endif
        }
        .sheet(item: $tagging) { target in
            TagPickerView(ranges: [target.range], label: target.label, kind: "verses")
        }
        .task(id: passage) { await load(st, cols, passage: passage) }
        .task(id: "\(loadedPassage ?? "")|\(app.highlightsRevision)") {
            let chapters = displayedVersesByChapter(cols).keys
            chapterHighlights = Dictionary(uniqueKeysWithValues: chapters.map { key in
                (key, (try? app.highlights?.chapter(key.book, key.chapter, textId: key.text)) ?? [:])
            })
        }
        .task(id: "\(loadedPassage ?? "")|\(app.notesRevision)") {
            chapterNoteCounts = Dictionary(uniqueKeysWithValues: displayedVersesByChapter(cols).map { key, verses in
                let counts = (try? app.notes?.coveringVerseCounts(key.book, key.chapter, verses: verses, textId: key.text)) ?? [:]
                return (key, counts)
            })
        }
        .task(id: "\(loadedPassage ?? "")|\(app.tagsRevision)") {
            let aligned = rows.values.flatMap { $0.values }
            let independent = independentRows.values.flatMap { $0 }
            let chapters = Set((aligned + independent).map(TagChapter.init))
            chapterTags = Dictionary(uniqueKeysWithValues: chapters.map { key in
                (key, (try? app.verseTags?.forChapter(key.book, key.chapter).verseTags) ?? [:])
            })
        }
    }

    private func displayedVersesByChapter(_ columns: [CompareColumn]) -> [EditionChapter: Set<Int>] {
        var chapters: [EditionChapter: Set<Int>] = [:]
        for column in columns {
            let verses = independentRows[column.id] ?? rows.values.compactMap { $0[column.id] }
            for row in verses {
                chapters[EditionChapter(row, text: column.text), default: []].insert(row.verseNum)
            }
        }
        return chapters
    }

    private func manageTranslations(_ st: BibleState, _ cols: [CompareColumn]) -> some View {
        Menu {
            if canShowIndependentPanes(width: compareWidth, count: cols.count) {
                Toggle("Sync Scrolling", isOn: Binding(get: { syncScrolling }, set: { enabled in
                    setSyncScrolling(enabled, state: st, columns: cols)
                }))
            }
            Menu("Add Translation", systemImage: "plus") {
                ForEach(availableTexts.filter { text in !cols.contains { $0.text == text.id && $0.follows(st) } }) { text in
                    Button(text.name) { setColumns(cols + [CompareColumn(id: (cols.last?.id ?? -1) + 1, text: text.id, anchor: st)]) }
                }
            }
            .disabled(cols.count >= 4)
            Menu("Change Column Passage", systemImage: "book") {
                ForEach(cols) { column in
                    Button(column.label) { editingColumn = column }
                }
            }
            Menu("Column Navigation", systemImage: "pin") {
                ForEach(cols) { column in
                    let pinned = column.isPinned || !column.follows(st)
                    Button {
                        setPinned(!pinned, for: column)
                    } label: {
                        Label(pinned ? "Follow Main Passage · \(column.label)" : "Pin \(column.label)",
                              systemImage: pinned ? "pin.slash" : "pin")
                    }
                }
            }
            Button {
                setColumns(Array(cols.reversed()))
            } label: {
                Label(cols.count == 2 ? "Swap Columns" : "Reverse Column Order",
                      systemImage: "arrow.left.arrow.right")
            }
            .disabled(cols.count < 2)
            Section("Open in Reader") {
                ForEach(cols) { column in
                    Button(column.label) { setColumns([column]) }
                }
            }
        } label: {
            Label("Manage Translations", systemImage: "rectangle.split.3x1")
                #if os(iOS)
                .labelStyle(.iconOnly)
                .frame(width: 44, height: 44)
                .contentShape(.rect)
                #endif
        }
        .help("Add a translation or open one in the reader")
    }

    private func setSyncScrolling(_ enabled: Bool, state: BibleState, columns: [CompareColumn]) {
        if enabled != syncScrolling, columns.allSatisfy({ $0.follows(state) }) {
            if enabled {
                let source = lastScrolledColumn ?? columns.first?.id
                pendingAlignedVerse = source.flatMap { independentVisibleVerses[$0] } ?? state.verse
            } else {
                let verse = alignedVersesAboveTop.max() ?? state.verse
                alignedVersesAboveTop = []
                independentVisibleVerses = [:]
                if let verse {
                    for column in columns { independentVisibleVerses[column.id] = correspondingVerse(verse, in: column) }
                }
                lastScrolledColumn = nil
            }
        }
        app.update(tabId, recordHistory: false) { tab in
            tab.state["compareSyncScroll"] = .bool(enabled)
        }
    }

    private func passageKey(_ state: BibleState, _ columns: [CompareColumn]) -> String {
        let destinations = columns.map { "\($0.id):\($0.destinationKey)" }.joined(separator: ",")
        return "\(state.translation)|\(state.bookId)|\(state.chapter)|\(destinations)"
    }

    private func selectedVerses(in state: BibleState) -> Set<Int> {
        guard let first = state.verse else { return [] }
        var reader = state
        reader.compareMode = false
        let saved = app.readerSelectedVerses(in: tabId, state: reader)
        return saved.isEmpty ? [first] : Set(saved)
    }

    private func comparisonGrid(_ st: BibleState, _ cols: [CompareColumn]) -> some View {
        let available = availableColumnIDs
        let selected = selectedVerses(in: st)
        #if os(macOS)
        let space = compareWidth - 48 - 18 * CGFloat(cols.count - 1) - (showVerseNumbers ? 50 : 0)
        #endif
        return Grid(alignment: .topLeading, horizontalSpacing: 18, verticalSpacing: 10) {
            GridRow {
                if showVerseNumbers { Text("").gridColumnAlignment(.trailing) }
                ForEach(cols) { c in
                    HStack {
                        alignedColumnHeading(c, available: available.contains(c.id))
                        columnActions(c, columns: cols)
                    }
                    #if os(macOS)
                    .frame(width: columnWidth(c, columns: cols, space: space), alignment: .leading)
                    .overlay(alignment: .trailing) {
                        if let next = nextColumn(after: c, in: cols) {
                            columnDivider(c, next, columns: cols, space: space).offset(x: 15)
                        }
                    }
                    #else
                    .frame(minWidth: 180)
                    #endif
                }
            }
            Divider().gridCellUnsizedAxes(.horizontal)
            ForEach(rows.keys.sorted(), id: \.self) { v in
                GridRow(alignment: .firstTextBaseline) {
                    if showVerseNumbers {
                        verseButton(v, state: st, selected: selected.contains(v))
                    }
                    ForEach(cols) { c in
                        comparisonText(v, text: c, state: st)
                            #if os(macOS)
                            .frame(width: columnWidth(c, columns: cols, space: space), alignment: .leading)
                            #endif
                    }
                }
                .id(v)
                .onGeometryChange(for: Bool.self) { geometry in
                    geometry.frame(in: .named("aligned-compare")).minY <= 1
                } action: { aboveTop in
                    trackAlignedVerse(v, aboveTop: aboveTop)
                }
            }
        }
        .padding(24)
    }

    private func stackedComparison(_ state: BibleState, _ columns: [CompareColumn]) -> some View {
        let available = availableColumnIDs
        let selected = selectedVerses(in: state)
        return LazyVStack(alignment: .leading, spacing: 14) {
            // Headers share one container: as siblings their column ids (0, 1, …) collided with the verse rows'
            // `.id(verse)` and verse 1 vanished, leaving a gap under the headers.
            VStack(alignment: .leading, spacing: 14) {
                ForEach(columns) { text in
                    HStack {
                        alignedColumnHeading(text, available: available.contains(text.id))
                        columnActions(text, columns: columns)
                    }
                }
            }
            .id("compare-headers")
            ForEach(rows.keys.sorted(), id: \.self) { verse in
                VStack(alignment: .leading, spacing: 8) {
                    Divider()
                    if showVerseNumbers { verseButton(verse, state: state, selected: selected.contains(verse)) }
                    ForEach(columns.filter { available.contains($0.id) }) { text in
                        VStack(alignment: .leading, spacing: 3) {
                            HStack(spacing: 4) {
                                Text(textInfo(text.text).short)
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.secondary)
                                Spacer(minLength: 4)
                                if let row = rows[verse]?[text.id] {
                                    comparisonVerseControls(row, column: text)
                                }
                            }
                            comparisonText(verse, text: text, state: state, showsControls: false)
                        }
                    }
                }
                .id(verse)
                .onGeometryChange(for: Bool.self) { geometry in
                    geometry.frame(in: .named("aligned-compare")).minY <= 1
                } action: { aboveTop in
                    trackAlignedVerse(verse, aboveTop: aboveTop)
                }
            }
        }
        .padding(16)
    }

    private var availableColumnIDs: Set<Int> {
        Set(rows.values.flatMap { $0.keys })
    }

    private func alignedColumnHeading(_ column: CompareColumn, available: Bool) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            columnPassageButton(column, title: textInfo(column.text).name)
            if !available {
                Text("Passage unavailable in this edition")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func alignedComparison(_ state: BibleState, _ columns: [CompareColumn]) -> some View {
        let key = "aligned|" + passageKey(state, columns)
        return ScrollViewReader { proxy in
            restoredCompareScroll(key: key, preferringVerse: pendingAlignedVerse != nil) {
                if prefersStackedComparison || compareWidth < CGFloat(columns.count) * 280 + 60 {
                    stackedComparison(state, columns)
                } else {
                    comparisonGrid(state, columns)
                }
            }
            .coordinateSpace(name: "aligned-compare")
            .onChange(of: state.verse, initial: true) { previous, current in
                if let restored = pendingAlignedVerse {
                    pendingAlignedVerse = nil
                    proxy.scrollTo(restored, anchor: .top)
                    return
                }
                if previous == current, app.compareScrollOffsets[tabId]?[key] != nil { return }
                let selectedHere = localVerseSelection != nil && localVerseSelection == state.verse
                localVerseSelection = nil
                if !selectedHere, let verse = current {
                    proxy.scrollTo(verse, anchor: .top)
                }
            }
        }
    }

    private func restoredCompareScroll<Content: View>(key: String, preferringVerse: Bool = false,
                                                      @ViewBuilder content: () -> Content) -> some View {
        ScrollView(content: content)
            .scrollPosition($sharedScrollPosition)
            .onScrollGeometryChange(for: CGFloat.self) { geometry in
                max(0, geometry.contentOffset.y + geometry.contentInsets.top)
            } action: { _, offset in
                guard app.activeTab?.id == tabId, restoredSharedScrollKey == key else { return }
                app.compareScrollOffsets[tabId, default: [:]][key] = offset
            }
            .task(id: key) {
                restoredSharedScrollKey = nil
                await Task.yield()
                guard !Task.isCancelled else { return }
                if !preferringVerse, let offset = app.compareScrollOffsets[tabId]?[key] {
                    sharedScrollPosition.scrollTo(y: offset)
                }
                restoredSharedScrollKey = key
            }
    }

    private func trackAlignedVerse(_ verse: Int, aboveTop: Bool) {
        if aboveTop {
            alignedVersesAboveTop.insert(verse)
        } else {
            alignedVersesAboveTop.remove(verse)
        }
    }

    private func independentPanes(_ columns: [CompareColumn], passage: String, compact: Bool) -> some View {
        #if os(macOS)
        let space = compareWidth - 12 * CGFloat(columns.count - 1)
        #endif
        return HStack(spacing: 0) {
            ForEach(columns) { column in
                #if !os(macOS)
                if column.id != columns.first?.id { Divider() }
                #endif
                VStack(spacing: 0) {
                    independentHeader(column, columns: columns, compact: compact)
                        .padding(.horizontal, compact ? 4 : 12)
                    Divider()
                    ScrollViewReader { proxy in
                        ScrollView {
                            LazyVStack(alignment: .leading, spacing: 12) {
                                independentVerses(column, compact: compact)
                            }
                            .scrollTargetLayout()
                            .padding(compact ? 8 : 16)
                        }
                        .scrollPosition(id: independentPosition(for: column, in: columns, passage: passage), anchor: .top)
                        .onScrollPhaseChange { _, phase in
                            switch phase {
                            case .interacting:
                                scrollingColumn = column.id
                                lastScrolledColumn = column.id
                            case .idle:
                                if scrollingColumn == column.id { scrollingColumn = nil }
                            default: break
                            }
                        }
                        .id(column.label)
                        .task(id: column.historyKey) {
                            let key = columnScrollKey(column.id, passage: passage)
                            guard let verse = independentVisibleVerses[column.id]
                                    ?? app.compareColumnScrollVerses[tabId]?[key] else { return }
                            await Task.yield()
                            guard !Task.isCancelled else { return }
                            proxy.scrollTo(verse, anchor: .top)
                        }
                    }
                }
                #if os(macOS)
                .frame(width: columnWidth(column, columns: columns, space: space))
                .frame(maxHeight: .infinity)
                #else
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                #endif
                #if os(macOS)
                if let next = nextColumn(after: column, in: columns) {
                    columnDivider(column, next, columns: columns, space: space)
                }
                #endif
            }
        }
    }

    private func independentPosition(for column: CompareColumn, in columns: [CompareColumn], passage: String) -> Binding<Int?> {
        Binding(get: { independentVisibleVerses[column.id] }, set: { verse in
            guard passage == passageKey(state, self.columns) else { return }
            independentVisibleVerses[column.id] = verse
            if app.activeTab?.id == tabId, let verse {
                let key = columnScrollKey(column.id, passage: passage)
                app.compareColumnScrollVerses[tabId, default: [:]][key] = verse
            }
            guard syncScrolling, scrollingColumn == column.id, let verse else { return }
            for destination in columns where destination.id != column.id {
                guard let match = correspondingVerse(verse, in: destination) else { continue }
                if independentVisibleVerses[destination.id] != match {
                    independentVisibleVerses[destination.id] = match
                }
            }
        })
    }

    private func columnScrollKey(_ id: Int, passage: String) -> String {
        passage + "|column:\(id)"
    }

    private func correspondingVerse(_ verse: Int, in column: CompareColumn) -> Int? {
        guard let rows = independentRows[column.id] else { return nil }
        return rows.last(where: { $0.verseNum <= verse })?.verseNum ?? rows.first?.verseNum
    }

    private func independentComparison(_ columns: [CompareColumn]) -> some View {
        LazyVStack(alignment: .leading, spacing: 12, pinnedViews: [.sectionHeaders]) {
            ForEach(columns) { column in
                Section {
                    independentVerses(column)
                } header: {
                    independentHeader(column, columns: columns)
                        .background(.regularMaterial, in: .rect(cornerRadius: 10))
                }
            }
        }
        .padding(16)
    }

    private func independentHeader(_ column: CompareColumn, columns: [CompareColumn], compact: Bool = false) -> some View {
        HStack {
            columnPassageButton(column, title: column.label, compact: compact)
            columnActions(column, columns: columns)
        }
        .padding(.horizontal, compact ? 2 : 8)
    }

    private func columnPassageButton(_ column: CompareColumn, title: String, compact: Bool = false) -> some View {
        HStack(spacing: 4) {
            Button {
                editingColumn = column
            } label: {
                Group {
                    if compact {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(textInfo(column.text).short).font(.subheadline.weight(.semibold))
                            Text(Reference.readerChapterLabel(column.book, column.chapter, textId: column.text))
                                .font(.caption2).foregroundStyle(.secondary).lineLimit(2)
                        }
                    } else {
                        Label(title, systemImage: "book").font(.subheadline.weight(.semibold))
                    }
                }
                .frame(maxWidth: .infinity, minHeight: controlSize, alignment: .leading)
                .contentShape(.rect)
            }
            .buttonStyle(.interactivePlain)
            .accessibilityLabel("Change passage for \(column.label)")
            .help("Change column passage")
        }
        #if os(macOS)
        .background(columnDropTarget == column.id ? Color.accentColor.opacity(0.14) : .clear,
                    in: .rect(cornerRadius: 8))
        .contentShape(.rect)
        .draggable(columnDragPayload(column)) {
            Label(column.label, systemImage: "book")
                .font(.subheadline.weight(.semibold))
                .padding(12)
                .background(.regularMaterial, in: .rect(cornerRadius: 10))
        }
        .dropDestination(for: String.self) { items, _ in
            let current = columns
            guard let item = items.first,
                  let source = current.first(where: { item == columnDragPayload($0) }),
                  let target = current.firstIndex(where: { $0.id == column.id && $0.historyKey == column.historyKey }) else { return false }
            return moveColumn(source, to: target, in: current)
        } isTargeted: { targeted in
            if targeted { columnDropTarget = column.id }
            else if columnDropTarget == column.id { columnDropTarget = nil }
        }
        #endif
    }

    #if os(macOS)
    private func columnDragPayload(_ column: CompareColumn) -> String {
        "\(columnDragToken)|\(column.id)|\(column.historyKey)"
    }

    private func nextColumn(after column: CompareColumn, in columns: [CompareColumn]) -> CompareColumn? {
        guard let index = columns.firstIndex(where: { $0.id == column.id }), index + 1 < columns.count else { return nil }
        return columns[index + 1]
    }

    private func columnWidth(_ column: CompareColumn, columns: [CompareColumn], space: CGFloat) -> CGFloat {
        let total = columns.reduce(CGFloat.zero) { $0 + (columnWeights[$1.id] ?? 1) }
        let extra = max(0, space - 180 * CGFloat(columns.count))
        return 180 + extra * (columnWeights[column.id] ?? 1) / max(total, 1)
    }

    private func columnDivider(_ left: CompareColumn, _ right: CompareColumn, columns: [CompareColumn], space: CGFloat) -> some View {
        Rectangle()
            .fill(Color(nsColor: .separatorColor))
            .frame(width: 1)
            .frame(width: 12)
            .frame(minHeight: controlSize)
            .contentShape(.rect)
            .pointerStyle(.columnResize)
            .gesture(DragGesture(minimumDistance: 1, coordinateSpace: .global)
                .onChanged { gesture in
                    if resizeStart == nil { resizeStart = columnWeights }
                    resizeColumns(left, right, by: gesture.translation.width, columns: columns, space: space,
                                  baseline: resizeStart ?? [:])
                }
                .onEnded { _ in resizeStart = nil })
            .accessibilityLabel("Resize \(left.label) and \(right.label)")
            .accessibilityValue("\(Int(columnWidth(left, columns: columns, space: space))) and \(Int(columnWidth(right, columns: columns, space: space))) points")
            .accessibilityAdjustableAction { direction in
                switch direction {
                case .increment: resizeColumns(left, right, by: 24, columns: columns, space: space, baseline: columnWeights)
                case .decrement: resizeColumns(left, right, by: -24, columns: columns, space: space, baseline: columnWeights)
                @unknown default: break
                }
            }
            .help("Drag to resize these columns")
    }

    private func resizeColumns(_ left: CompareColumn, _ right: CompareColumn, by delta: CGFloat,
                               columns: [CompareColumn], space: CGFloat, baseline: [Int: CGFloat]) {
        let extra = space - 180 * CGFloat(columns.count)
        guard extra > 0 else { return }
        let total = columns.reduce(CGFloat.zero) { $0 + (baseline[$1.id] ?? 1) }
        let leftWeight = baseline[left.id] ?? 1
        let pair = leftWeight + (baseline[right.id] ?? 1)
        let nextLeft = min(max(leftWeight + delta * total / extra, 0.02), pair - 0.02)
        columnWeights[left.id] = nextLeft
        columnWeights[right.id] = pair - nextLeft
    }
    #endif

    @discardableResult
    private func moveColumn(_ column: CompareColumn, to target: Int, in current: [CompareColumn]) -> Bool {
        guard let source = current.firstIndex(where: { $0.id == column.id && $0.historyKey == column.historyKey }),
              current.indices.contains(target), source != target else { return false }
        var reordered = current
        reordered.insert(reordered.remove(at: source), at: target)
        setColumns(reordered)
        return true
    }

    private func moveColumn(_ column: CompareColumn, by delta: Int) {
        let current = columns
        guard let source = current.firstIndex(where: { $0.id == column.id && $0.historyKey == column.historyKey }) else { return }
        moveColumn(column, to: source + delta, in: current)
    }

    @ViewBuilder private func independentVerses(_ column: CompareColumn, compact: Bool = false) -> some View {
        if let verses = independentRows[column.id], !verses.isEmpty {
            ForEach(verses, id: \.verseNum) { row in
                if compact {
                    VStack(alignment: .leading, spacing: 0) {
                        HStack(spacing: 2) {
                            if showVerseNumbers { independentVerseButton(row, column: column) }
                            Spacer(minLength: 0)
                            comparisonVerseControls(row, column: column)
                        }
                        comparisonVerseBody(row, column: column, state: state, showsControls: false)
                    }
                } else {
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        if showVerseNumbers { independentVerseButton(row, column: column) }
                        comparisonVerseBody(row, column: column, state: state)
                    }
                }
            }
        } else {
            Text("No Text in This Passage").foregroundStyle(.secondary)
        }
    }

    private func independentVerseButton(_ row: ChapterVerseRow, column: CompareColumn) -> some View {
        Button {
            openReader(row, in: column)
        } label: {
            Text("\(row.verseNum)")
                .font(.caption.monospacedDigit().weight(.semibold))
                .foregroundStyle(Color.accentColor)
                .frame(minWidth: controlSize, minHeight: controlSize)
                .contentShape(.rect)
        }
        .buttonStyle(.interactivePlain)
        .accessibilityLabel("Open verse \(row.verseNum) in Reader")
        .help("Open verse \(row.verseNum) in Reader")
    }
    @ViewBuilder private func comparisonVerseActions(_ row: ChapterVerseRow, column: CompareColumn) -> some View {
        let reference = comparisonVerseReference(row, column: column)
        let copyVerse = {
            let visible = row.hidingTextAnnotations(hiddenAnnotations, textId: column.text)
            let text = VerseDisplay.text(visible.text, tagged: visible.textTagged, textId: column.text,
                                         replacerEnabled: app.wordReplacerEnabled, rules: WordReplacer.defaultRules,
                                         hideSuppliedWords: hideSuppliedWords)
            Clipboard.copy("\(reference) \(text)")
            AccessibilityNotification.Announcement("Verse copied").post()
        }
        Button("Copy Verse", systemImage: "doc.on.doc", action: copyVerse)
        Button("Copy Reference", systemImage: "number") {
            Clipboard.copy(reference)
            AccessibilityNotification.Announcement("Reference copied").post()
        }
        if let url = DeepLink.nativeDevPassageURL(bookId: row.bookId, chapter: row.chapter,
                                                  verse: row.verseNum, textId: column.text) {
            Button("Copy Native Dev Link", systemImage: "link") {
                Clipboard.copy(url.absoluteString)
                AccessibilityNotification.Announcement("Verse link copied").post()
            }
        }
        Menu("Highlight Verse", systemImage: "highlighter") {
            ForEach(highlightColors, id: \.self) { color in
                Button(color.capitalized, systemImage: "circle.fill") {
                    app.highlightVerses([row], color: color, textID: column.text, copy: copyVerse)
                }
            }
        }
        if chapterHighlights[EditionChapter(row, text: column.text)]?[row.verseNum]?.isEmpty == false {
            Button("Remove Highlights", systemImage: "eraser", role: .destructive) {
                try? app.highlights?.remove(bookId: row.bookId, chapter: row.chapter,
                                            verse: row.verseNum, textId: column.text)
            }
        }
        Divider()
        Button("Add Note", systemImage: "square.and.pencil") {
            let title = Reference.bookChapterVerseLabel(row.bookId, chapter: row.chapter, verse: row.verseNum,
                                                        hermas: HermasText(textId: column.text))
            app.newNote(verseRef: "\(row.bookId).\(row.chapter).\(row.verseNum)", textId: column.text, title: title)
        }
        Button("Verse Notes", systemImage: "note.text") {
            openReader(row, in: column, inspector: "notes")
        }
        Button("Tag Verse…", systemImage: "tag") {
            let verse = Double(row.verseNum)
            let range = TagRange(bookId: row.bookId, chapter: Double(row.chapter), spans: [(verse, verse)])
            tagging = VerseTagTarget(range: range, label: reference)
        }
        Button("Cross References", systemImage: "arrow.triangle.branch") {
            openReader(row, in: column, inspector: "crossrefs")
        }
        Button("Open in Reader", systemImage: "book.pages") { openReader(row, in: column) }
        Button("Open in New Tab", systemImage: "plus.square") {
            app.openScripture(bookId: row.bookId, chapter: row.chapter, verse: row.verseNum, textId: column.text)
        }
    }

    private func comparisonVerseReference(_ row: ChapterVerseRow, column: CompareColumn) -> String {
        let label = Reference.bookChapterVerseLabel(row.bookId, chapter: row.chapter, verse: row.verseNum,
                                                    hermas: HermasText(textId: column.text))
        return referenceForCopy(label, textId: column.text)
    }

    private func comparisonVerseBody(_ row: ChapterVerseRow, column: CompareColumn, state: BibleState, showsControls: Bool = true) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            VStack(alignment: .leading, spacing: 4) {
                VerseRowView(row: row.hidingTextAnnotations(hiddenAnnotations, textId: column.text), textId: column.text, showStrongs: state.showStrongs,
                             highlights: chapterHighlights[EditionChapter(row, text: column.text)]?[row.verseNum] ?? [],
                             fontSize: scriptureFontSize, lineSpacing: app.lineSpacing,
                             replacer: app.wordReplacerEnabled, family: app.scriptureFontFamily, hideSuppliedWords: hideSuppliedWords,
                             originalText: row.text)
                    .environment(\.openURL, strongsAction(for: row))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contextMenu { comparisonVerseActions(row, column: column) }
                if let tags = chapterTags[TagChapter(row)]?[row.verseNum], !tags.isEmpty {
                    FlowLayout {
                        ForEach(tags) { tag in
                            Button {
                                app.openSearch("#\(tag.name)", reuseTab: true)
                            } label: {
                                TagChip(name: tag.name, color: tag.color, slot: tag.colorSlot)
                                    .padding(.vertical, 6)
                                    .contentShape(.rect)
                            }
                            .buttonStyle(.interactivePlain)
                            .accessibilityLabel("Search tag \(tag.name)")
                        }
                    }
                }
            }
            if showsControls { comparisonVerseControls(row, column: column) }
        }
    }

    @ViewBuilder private func comparisonVerseControls(_ row: ChapterVerseRow, column: CompareColumn) -> some View {
        if let count = chapterNoteCounts[EditionChapter(row, text: column.text)]?[row.verseNum], count > 0 {
            Button {
                openReader(row, in: column, inspector: "notes")
            } label: {
                Label("Notes (\(count))", systemImage: "note.text")
                    .labelStyle(.iconOnly)
                    .foregroundStyle(Color.accentColor)
                    .frame(minWidth: controlSize, minHeight: controlSize)
                    .contentShape(.rect)
            }
            .buttonStyle(.interactivePlain)
            .accessibilityLabel("\(count) \(count == 1 ? "note" : "notes") for \(comparisonVerseReference(row, column: column))")
            .help("Open verse notes")
        }
        VerseActionsMenu(label: "Actions for \(comparisonVerseReference(row, column: column))") {
            comparisonVerseActions(row, column: column)
        }
    }

    private func openReader(_ row: ChapterVerseRow, in column: CompareColumn, inspector: String? = nil) {
        openReader(ResolvedPassage(textId: column.text, bookId: row.bookId,
                                  chapter: row.chapter, verse: row.verseNum), inspector: inspector)
    }

    private func openReader(_ passage: ResolvedPassage, inspector: String? = nil) {
        app.update(tabId) { tab in
            var reader = BibleState(tab.state)
            reader.compareMode = false
            reader.bookId = passage.bookId
            reader.chapter = passage.chapter
            reader.translation = passage.textId
            reader.verse = passage.verse
            reader.endVerse = passage.endVerse
            if inspector != nil { reader.rightPanelOpen = true }
            tab.state = reader.merged(into: tab.state)
            if let inspector, let panel = InspectorTool(rawValue: inspector) {
                StudyPanelSlots.focus(panel, in: &tab.state)
            }
            tab.state.remove("compareColumns")
            tab.state.remove("endChapter")
            tab.state["nativeSelectedVerses"] = passage.savedSelection
            tab.title = Reference.readerChapterLabel(passage.bookId, passage.chapter, textId: passage.textId)
        }
        app.recordRecent(textId: passage.textId, bookId: passage.bookId, chapter: passage.chapter,
                         verse: passage.verse, endVerse: passage.endVerse, verseGroups: passage.verseGroups)
    }

    @ViewBuilder private func comparisonText(_ verse: Int, text column: CompareColumn, state: BibleState, showsControls: Bool = true) -> some View {
        let text = column.text
        if let row = rows[verse]?[column.id] {
            VStack(alignment: .leading, spacing: 3) {
                if row.verseNum != verse || row.chapter != ChapterMap.mapChapter(state.bookId, state.chapter, from: state.translation, to: text) {
                    Text("\(row.chapter):\(row.verseNum)")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                comparisonVerseBody(row, column: column, state: state, showsControls: showsControls)
            }
        } else {
            Text("—").foregroundStyle(.tertiary)
        }
    }

    private func strongsAction(for row: ChapterVerseRow) -> OpenURLAction {
        OpenURLAction { url in
            guard url.scheme == "strongs" else { return .systemAction }
            let id = String(url.absoluteString.dropFirst("strongs:".count))
            app.inspectStrongs(id, in: tabId, bookId: row.bookId, chapter: row.chapter, verse: row.verseNum)
            return .handled
        }
    }

    private var controlSize: CGFloat {
        #if os(iOS)
        44
        #else
        32
        #endif
    }

    private func columnActions(_ column: CompareColumn, columns: [CompareColumn]) -> some View {
        let pinned = column.isPinned || !column.follows(state)
        return Menu {
            Button {
                editingColumn = column
            } label: {
                Label("Change Passage", systemImage: "book")
            }
            // Per-column chapter stepping (original CompareView column ‹ ›); only this column moves.
            Button { stepColumn(column, by: -1) } label: { Label("Previous Chapter", systemImage: "chevron.backward") }
                .disabled(adjacentChapter(to: column, by: -1) == nil)
            Button { stepColumn(column, by: 1) } label: { Label("Next Chapter", systemImage: "chevron.forward") }
                .disabled(adjacentChapter(to: column, by: 1) == nil)
            Divider()
            Button("Move Earlier", systemImage: "arrow.backward") { moveColumn(column, by: -1) }
                .disabled(columns.first?.id == column.id)
            Button("Move Later", systemImage: "arrow.forward") { moveColumn(column, by: 1) }
                .disabled(columns.last?.id == column.id)
            Divider()
            Button {
                setPinned(!pinned, for: column)
            } label: {
                Label(pinned ? "Follow Main Passage" : "Pin Passage",
                      systemImage: pinned ? "pin.slash" : "pin")
            }
            Button {
                setColumns([column])
            } label: {
                Label("Open in Reader", systemImage: "book.pages")
            }
            Divider()
            Button {
                setColumns(columns.filter { $0.id != column.id })
            } label: {
                Label("Close Column", systemImage: "xmark")
            }
        } label: {
            Label("Actions for \(column.label)", systemImage: "ellipsis.circle")
                .labelStyle(.iconOnly)
                .foregroundStyle(.secondary)
                .frame(minWidth: controlSize, minHeight: controlSize)
                .contentShape(.rect)
        }
        .menuStyle(.borderlessButton).clickableCursor()
        #if os(macOS)
        .menuIndicator(.hidden)
        .pointerStyle(.link)
        #else
        .hoverEffect(.highlight)
        #endif
        .help("Column actions")
    }

    private func verseButton(_ verse: Int, state: BibleState, selected: Bool) -> some View {
        Button {
            if state.verse != verse { localVerseSelection = verse }
            app.update(tabId, recordHistory: false) { tab in
                var target = BibleState(tab.state)
                target.verse = verse
                target.endVerse = nil
                tab.state = target.merged(into: tab.state)
                tab.state.remove("nativeSelectedVerses")
                tab.state.remove("endChapter")
            }
        } label: {
            Text("\(verse)")
                .font(.system(.caption, design: .rounded).weight(.semibold))
                .foregroundStyle(selected ? Color.accentColor : Color.secondary)
                .frame(minWidth: controlSize, minHeight: controlSize)
                .contentShape(.rect)
        }
        .buttonStyle(.interactivePlain)
        .accessibilityLabel("Verse \(verse)")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func comparisonChapter(book: String, chapter: Int, edition: String) async -> [ChapterVerseRow] {
        let rows = await app.bible.queryChapter(book, chapter, textId: edition)
        return PsalmSuperscription.apply(rows, textId: edition, bookId: book, chapter: chapter)
    }

    func load(_ st: BibleState, _ cols: [CompareColumn], passage: String) async {
        var out: [Int: [Int: ChapterVerseRow]] = [:]
        var independent: [Int: [ChapterVerseRow]] = [:]
        for column in cols {
            guard !Task.isCancelled else { return }
            independent[column.id] = await comparisonChapter(book: column.book, chapter: column.chapter, edition: column.text)
        }
        let aligned = cols.allSatisfy { $0.follows(st) }
        for column in cols where aligned {
            let c = column.text
            // The tab's chapter is in its own text's numbering; map it for the column's text.
            let ch = ChapterMap.mapChapter(st.bookId, st.chapter, from: st.translation, to: c)
            let chapters = st.bookId == "JON" && st.chapter == 2
                && ChapterMap.isLxx(st.translation) && ChapterMap.isKjv(c) ? [1, ch] : [ch]
            for chapter in chapters {
                let chapterRows = chapter == column.chapter
                    ? independent[column.id] ?? []
                    : await comparisonChapter(book: st.bookId, chapter: chapter, edition: c)
                for row in chapterRows {
                    let mapped = st.bookId == "JON"
                        ? ChapterMap.jonahCounterpart(chapter: chapter, verse: row.verseNum, from: c, to: st.translation)
                        : nil
                    if let mapped {
                        guard mapped.chapter == st.chapter else { continue }
                    } else if chapter != ch {
                        continue
                    }
                    out[mapped?.verse ?? row.verseNum, default: [:]][column.id] = row
                }
            }
            if st.bookId == "JON", st.chapter == 1, ChapterMap.isKjv(st.translation), ChapterMap.isLxx(c),
               let opening = await app.bible.queryChapter(st.bookId, 2, textId: c).first(where: { $0.verseNum == 1 }) {
                out[17, default: [:]][column.id] = opening
            }
        }
        // The aligned grid already shows the gap as an empty LXX cell. Independent panes
        // carry the notice on the next available verse, as in the standalone reader.
        for column in cols where column.text == "lxx" && MissingLxxVerses.eligible(bookId: column.book, chapter: column.chapter) {
            guard !Task.isCancelled else { return }
            guard let lxx = independent[column.id], !lxx.isEmpty else { continue }
            let kjv: [ChapterVerseRow]
            if let counterpart = cols.first(where: { $0.text == "kjva" && $0.book == column.book && $0.chapter == column.chapter }),
               let existing = independent[counterpart.id] {
                kjv = existing
            } else {
                kjv = await app.bible.queryChapter(column.book, column.chapter, textId: "kjva")
            }
            independent[column.id] = MissingLxxVerses.annotate(lxx, comparingTo: kjv)
        }
        guard !Task.isCancelled else { return }
        chapterHighlights = [:]
        chapterNoteCounts = [:]
        chapterTags = [:]
        rows = out
        independentRows = independent
        loadedPassage = passage
    }

    private func setPinned(_ pinned: Bool, for column: CompareColumn) {
        let anchor = state
        var record = column.record
        if pinned {
            record["nativePinnedPassage"] = .bool(true)
        } else {
            record.remove("nativePinnedPassage")
            record["bookId"] = .string(JSString(anchor.bookId))
            record["chapter"] = .number(Double(ChapterMap.mapChapter(anchor.bookId, anchor.chapter, from: anchor.translation, to: column.text)))
            if !column.follows(anchor) { record.remove("scrollPos") }
        }
        guard let updated = CompareColumn(id: column.id, record: record, anchor: anchor) else { return }
        setColumns(columns.map { $0.id == column.id ? updated : $0 })
    }

    private func adjacentChapter(to column: CompareColumn, by delta: Int) -> Int? {
        guard let numbers = chapterNumbers[ColumnBook(column)],
              let index = numbers.firstIndex(of: column.chapter),
              numbers.indices.contains(index + delta) else { return nil }
        return numbers[index + delta]
    }

    private func stepColumn(_ column: CompareColumn, by delta: Int) {
        guard app.activeTab?.id == tabId,
              let current = columns.first(where: { $0.id == column.id && ColumnBook($0) == ColumnBook(column) }),
              let destination = adjacentChapter(to: current, by: delta) else { return }
        changePassage(for: current.id, text: current.text, book: current.book, chapter: destination)
        #if os(iOS)
        readerNavigationFeedback()
        #endif
    }

    private func changePassage(for id: Int, text: String, book: String, chapter: Int) {
        let anchor = state
        let updated = columns.compactMap { column -> CompareColumn? in
            guard column.id == id else { return column }
            var record = column.record
            record["textId"] = .string(JSString(text))
            record["bookId"] = .string(JSString(book))
            record["chapter"] = .number(Double(chapter))
            if book != column.book || chapter != column.chapter || text != column.text {
                record.remove("scrollPos")
                if book != anchor.bookId || chapter != ChapterMap.mapChapter(book, anchor.chapter, from: anchor.translation, to: text) {
                    record["nativePinnedPassage"] = .bool(true)
                }
            }
            return CompareColumn(id: id, record: record, anchor: anchor)
        }
        setColumns(updated)
    }

    private func readerPassage(for column: CompareColumn, source: BibleState) -> ResolvedPassage {
        var passage = ResolvedPassage(textId: column.text, bookId: column.book, chapter: column.chapter, verse: nil)
        guard loadedPassage == passageKey(source, columns), column.follows(source), let first = source.verse,
              columns.contains(where: { $0.id == column.id && $0.destinationKey == column.destinationKey }) else { return passage }

        let mapped = selectedVerses(in: source).sorted().compactMap { rows[$0]?[column.id] }
        let anchor = rows[first]?[column.id] ?? mapped.first
        guard let anchor else { return passage }
        passage.bookId = anchor.bookId
        passage.chapter = anchor.chapter
        passage.verse = anchor.verseNum
        let group = consecutiveVerseRuns(Set(mapped.filter {
            $0.bookId == anchor.bookId && $0.chapter == anchor.chapter
        }.map(\.verseNum)))
        if group.count == 1, let range = group.first, range.lowerBound == anchor.verseNum {
            if range.upperBound > anchor.verseNum { passage.endVerse = range.upperBound }
        } else if !group.isEmpty {
            passage.verseGroups = group
        }
        return passage
    }

    func setColumns(_ cols: [CompareColumn]) {
        #if os(macOS)
        columnWeights = Dictionary(uniqueKeysWithValues: cols.enumerated().map { ($0.offset, columnWeights[$0.element.id] ?? 1) })
        resizeStart = nil
        #endif
        if cols.isEmpty {
            app.update(tabId) {
                $0.state.remove("compareMode")
                $0.state.remove("compareColumns")
            }
            return
        }
        if cols.count == 1, let column = cols.first {
            openReader(readerPassage(for: column, source: state))
            return
        }
        preserveReadingPositions(for: cols)
        app.update(tabId) { tab in
            tab.state["compareColumns"] = .array(cols.map { .object($0.record) })
        }
    }

    private func preserveReadingPositions(for next: [CompareColumn]) {
        let previous = columns
        let anchor = state
        let reindexed = next.enumerated().compactMap { CompareColumn(id: $0.offset, record: $0.element.record, anchor: anchor) }
        guard reindexed.count == next.count else { return }
        let oldPassage = passageKey(anchor, previous)
        let newPassage = passageKey(anchor, reindexed)
        guard oldPassage != newPassage else { return }

        let previousByID = Dictionary(uniqueKeysWithValues: previous.map { ($0.id, $0) })
        let alignedVerse = previous.allSatisfy { $0.follows(anchor) } && syncScrolling
            ? alignedVersesAboveTop.max() ?? anchor.verse : nil
        var survivors = 0
        for (index, column) in next.enumerated() {
            guard let source = previousByID[column.id], source.destinationKey == column.destinationKey else { continue }
            survivors += 1
            let oldKey = columnScrollKey(source.id, passage: oldPassage)
            if let verse = independentVisibleVerses[source.id] ?? app.compareColumnScrollVerses[tabId]?[oldKey] ?? alignedVerse {
                let newKey = columnScrollKey(reindexed[index].id, passage: newPassage)
                app.compareColumnScrollVerses[tabId, default: [:]][newKey] = verse
            }
        }
        if survivors == previous.count, survivors == next.count {
            for prefix in ["aligned|", "stacked|"] {
                if let offset = app.compareScrollOffsets[tabId]?[prefix + oldPassage] {
                    app.compareScrollOffsets[tabId, default: [:]][prefix + newPassage] = offset
                }
            }
        }
    }
}
