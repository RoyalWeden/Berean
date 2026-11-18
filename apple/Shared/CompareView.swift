import SwiftUI
import BereanCore
import BereanBible
import BereanText
import BereanReference
import BereanNotes
import BereanWorkspace
#if os(macOS)
import AppKit
#endif

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
        !isPinned && book == anchor.bookId &&
            chapter == ChapterMap.mapChapter(book, anchor.chapter, from: anchor.translation, to: text)
    }

    var isPinned: Bool { record["nativePinnedPassage"]?.boolValue == true }

    var legacyScrollVerse: Int? {
        record["scrollPos"]?.objectValue?["verseNum"]?.numberValue.flatMap(Int.init(exactly:))
    }

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
    @State private var eligibleComparisonEditions = Set<String>()
    @State private var compareWidth: CGFloat = 0
    @State private var localVerseSelection: Int?
    @State private var selectionAnchor: (edition: ChapterEdition, verse: Int)?
    @State private var editingColumn: CompareColumn?
    @State private var tagging: VerseTagTarget?
    @State private var independentVisibleVerses: [Int: Int] = [:]
    @State private var visibleIndependentRows: [Int: Set<Int>] = [:]
    @State private var visibleStackedVerses: [Int: Set<Int>] = [:]
    @State private var scrollingColumn: Int?
    #if os(macOS)
    @State private var wheelDriver: (deadline: TimeInterval, column: Int)?
    #endif
    @State private var lastScrolledColumn: Int?
    @State private var visibleAlignedVerses: Set<Int> = []
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
            } else {
                let visible = cols.filter { availableColumnIDs.contains($0.id) }
                VStack(spacing: 0) {
                    unavailableColumns(cols)
                    if visible.isEmpty {
                        ContentUnavailableView("Choose a Passage", systemImage: "book",
                                               description: Text("These saved chapters are unavailable in their editions."))
                    } else if canShowIndependentPanes(width: geometry.size.width, count: visible.count),
                              !syncScrolling || !visible.allSatisfy({ $0.follows(st) }) {
                        independentPanes(visible, passage: passage, compact: geometry.size.width < CGFloat(visible.count) * 260)
                    } else if !visible.allSatisfy({ $0.follows(st) }) {
                        stackedIndependentComparison(st, visible, passage: passage)
                    } else {
                        alignedComparison(st, visible)
                    }
                }
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
            visibleStackedVerses = [:]
            scrollingColumn = nil
            lastScrolledColumn = nil
            #if os(macOS)
            wheelDriver = nil
            #endif
            visibleAlignedVerses = []
            pendingAlignedVerse = nil
            restoredSharedScrollKey = nil
        }
        #if os(iOS)
        .safeAreaInset(edge: .top, spacing: 0) {
            HStack(spacing: 2) {
                manageTranslations(st, cols)
                    .menuStyle(.borderlessButton)
                    .menuIndicator(.hidden)
                    .hoverEffect(.highlight)
                Button("Exit Compare", systemImage: "xmark") {
                    exitCompareKeepingColumns(st, columns: cols)
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
        let additions = availableTexts.filter { text in
            loadedPassage == passageKey(st, cols) && eligibleComparisonEditions.contains(text.id)
                && !cols.contains { $0.text == text.id && $0.follows(st) }
        }
        return Menu {
            if canShowIndependentPanes(width: compareWidth, count: cols.count) {
                Toggle("Sync Scrolling", isOn: Binding(get: { syncScrolling }, set: { enabled in
                    setSyncScrolling(enabled, state: st, columns: cols)
                }))
            }
            Menu("Add Translation", systemImage: "plus") {
                ForEach(additions) { text in
                    Button(text.name) { setColumns(cols + [CompareColumn(id: (cols.last?.id ?? -1) + 1, text: text.id, anchor: st)]) }
                }
            }
            .disabled(cols.count >= 4 || additions.isEmpty)
            Button("Add Another Passage…", systemImage: "book.badge.plus") {
                editingColumn = cols.first { !availableColumnIDs.contains($0.id) }
                    ?? CompareColumn(id: (cols.map(\.id).max() ?? -1) + 1, text: st.translation, anchor: st)
            }
            .disabled(cols.count >= 4 && cols.allSatisfy { availableColumnIDs.contains($0.id) })
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
                    .disabled(pinned && !eligibleComparisonEditions.contains(column.text))
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
                ForEach(cols.filter { availableColumnIDs.contains($0.id) }) { column in
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
        .clickableCursor()
        .help("Add a translation or open one in the reader")
    }

    private func exitCompareKeepingColumns(_ source: BibleState, columns: [CompareColumn]) {
        if let column = columns.first(where: { $0.text == source.translation && $0.follows(source) }),
           let reading = readingAnchor(in: column, source: source), reading.chapter == source.chapter {
            let edition = ChapterEdition(source)
            app.scriptureReadingPositions[tabId, default: [:]][edition.key] =
                ScriptureReadingPosition(offset: 0, verse: reading.verse, selectedVerses: selectedVerses(in: source))
        }
        app.update(tabId) { $0.state.remove("compareMode") }
    }

    private func setSyncScrolling(_ enabled: Bool, state: BibleState, columns: [CompareColumn]) {
        if enabled != syncScrolling, columns.allSatisfy({ $0.follows(state) }) {
            if enabled {
                let source = lastScrolledColumn ?? columns.first?.id
                pendingAlignedVerse = source.flatMap { id in
                    guard let verse = independentVisibleVerses[id], let column = columns.first(where: { $0.id == id }) else { return nil }
                    return rows.first { _, row in row[id]?.chapter == column.chapter && row[id]?.verseNum == verse }?.key
                } ?? state.verse
            } else {
                let verse = visibleAlignedVerses.min() ?? state.verse
                visibleAlignedVerses = []
                independentVisibleVerses = [:]
                if let verse {
                    for column in columns {
                        if let mapped = mappedVerse(verse, in: column, source: state) {
                            independentVisibleVerses[column.id] = correspondingVerse(mapped, in: column)
                        }
                    }
                }
                lastScrolledColumn = nil
            }
        }
        app.update(tabId, recordHistory: false) { tab in
            tab.state["compareSyncScroll"] = .bool(enabled)
        }
    }

    private func passageKey(_ state: BibleState, _ columns: [CompareColumn]) -> String {
        let destinations = columns.map { "\($0.id):\($0.historyKey)" }.joined(separator: ",")
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
        return LazyVStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 18) {
                if showVerseNumbers { Color.clear.frame(width: controlSize, height: 1) }
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
            Divider()
            ForEach(rows.keys.sorted(), id: \.self) { v in
                HStack(alignment: .firstTextBaseline, spacing: 18) {
                    if showVerseNumbers {
                        verseButton(v, state: st, selected: selected.contains(v))
                            .frame(width: controlSize)
                    }
                    ForEach(cols) { c in
                        comparisonText(v, text: c, state: st)
                            #if os(macOS)
                            .frame(width: columnWidth(c, columns: cols, space: space), alignment: .leading)
                            #endif
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .id(v)
                .onScrollVisibilityChange(threshold: 0.2) { visible in
                    trackAlignedVerse(v, passage: passageKey(st, self.columns), visible: visible)
                }
                .onDisappear {
                    trackAlignedVerse(v, passage: passageKey(st, self.columns), visible: false)
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
                .onScrollVisibilityChange(threshold: 0.2) { visible in
                    trackAlignedVerse(verse, passage: passageKey(state, self.columns), visible: visible)
                }
                .onDisappear {
                    trackAlignedVerse(verse, passage: passageKey(state, self.columns), visible: false)
                }
            }
        }
        .padding(16)
    }

    private var availableColumnIDs: Set<Int> {
        Set(independentRows.filter { !$0.value.isEmpty }.keys).union(rows.values.flatMap { $0.keys })
    }

    @ViewBuilder private func unavailableColumns(_ columns: [CompareColumn]) -> some View {
        let unavailable = columns.filter { !availableColumnIDs.contains($0.id) }
        if !unavailable.isEmpty {
            VStack(spacing: 4) {
                ForEach(unavailable) { column in
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(column.label).font(.callout.weight(.medium))
                            Text("This edition has no chapter here.").font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 8)
                        Button("Choose Passage") { editingColumn = column }
                            .buttonStyle(.bordered)
                            .frame(minHeight: 44)
                        Button("Remove Unavailable Column", systemImage: "xmark") {
                            let remaining = columns.filter { $0.id != column.id }
                            if !remaining.isEmpty, remaining.allSatisfy({ !availableColumnIDs.contains($0.id) }) {
                                // Keep the repair UI instead of opening another
                                // unavailable saved chapter as a single reader.
                                app.update(tabId) { $0.state["compareColumns"] = .array(remaining.map { .object($0.record) }) }
                            } else {
                                setColumns(remaining)
                            }
                        }
                        .labelStyle(.iconOnly).buttonStyle(.interactivePlain)
                        .frame(minWidth: 44, minHeight: 44)
                    }
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 8)
            Divider()
        }
    }

    private func alignedColumnHeading(_ column: CompareColumn, available: Bool) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            columnPassageButton(column, title: textInfo(column.text).name)
            let chapterNames = Set(rows.values.compactMap { $0[column.id]?.chapter }).sorted().map {
                Reference.readerChapterLabel(column.book, $0, textId: column.text)
            }
            if chapterNames.count > 1 {
                Text(chapterNames.joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if !available {
                Text("Passage unavailable in this edition")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func alignedComparison(_ state: BibleState, _ columns: [CompareColumn]) -> some View {
        let key = "aligned|" + passageKey(state, self.columns)
        return ScrollViewReader { proxy in
            restoredCompareScroll(key: key, preferringVerse: pendingAlignedVerse != nil) {
                if prefersStackedComparison || compareWidth < CGFloat(columns.count) * 280 + 60 {
                    stackedComparison(state, columns)
                } else {
                    comparisonGrid(state, columns)
                }
            }
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
                                                      initialJump: (() -> Void)? = nil,
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
                if !preferringVerse {
                    if let offset = app.compareScrollOffsets[tabId]?[key] {
                        sharedScrollPosition.scrollTo(y: offset)
                    } else {
                        initialJump?()
                    }
                }
                restoredSharedScrollKey = key
            }
    }

    private func trackAlignedVerse(_ verse: Int, passage: String, visible: Bool) {
        guard passage == loadedPassage else { return }
        if visible {
            visibleAlignedVerses.insert(verse)
        } else {
            visibleAlignedVerses.remove(verse)
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
                                independentVerses(column, compact: compact, independentPassage: passage)
                            }
                            .scrollTargetLayout()
                            .padding(compact ? 8 : 16)
                        }
                        .scrollPosition(id: independentPosition(for: column, passage: passage), anchor: .top)
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
                        #if os(macOS)
                        .background {
                            CompareWheelRegion {
                                wheelDriver = (ProcessInfo.processInfo.systemUptime + 0.25, column.id)
                                lastScrolledColumn = column.id
                            }
                            .allowsHitTesting(false)
                        }
                        #endif
                        .id(column.label)
                        .task(id: column.historyKey) {
                            let key = columnScrollKey(column.id, passage: passage)
                            guard let verse = independentVisibleVerses[column.id]
                                    ?? app.compareColumnScrollVerses[tabId]?[key]
                                    ?? selectedRows(in: column, source: state).first?.verseNum
                                    ?? column.legacyScrollVerse.flatMap({ correspondingVerse($0, in: column) }) else { return }
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

    private func independentPosition(for column: CompareColumn, passage: String) -> Binding<Int?> {
        Binding(get: { independentVisibleVerses[column.id] }, set: { verse in
            guard passage == passageKey(state, self.columns) else { return }
            independentVisibleVerses[column.id] = verse
            if app.activeTab?.id == tabId, let verse {
                let key = columnScrollKey(column.id, passage: passage)
                app.compareColumnScrollVerses[tabId, default: [:]][key] = verse
            }
        })
    }

    private func updateIndependentVisibility(_ verse: Int, column: CompareColumn, passage: String, visible: Bool) {
        guard passage == loadedPassage else { return }
        if visible {
            visibleIndependentRows[column.id, default: []].insert(verse)
        } else {
            visibleIndependentRows[column.id]?.remove(verse)
        }
        guard syncScrolling, drivesScrollSync(column.id), let top = visibleIndependentRows[column.id]?.min() else { return }
        for destination in columns where destination.id != column.id && destination.book == column.book {
            guard let mapped = ChapterMap.synchronizedVerse(column.book, chapter: column.chapter, verse: top,
                                                             from: column.text, destinationChapter: destination.chapter,
                                                             to: destination.text),
                  let match = correspondingVerse(mapped, in: destination) else { continue }
            if independentVisibleVerses[destination.id] != match {
                independentVisibleVerses[destination.id] = match
            }
        }
    }

    private func drivesScrollSync(_ column: Int) -> Bool {
        #if os(macOS)
        if let wheelDriver, ProcessInfo.processInfo.systemUptime <= wheelDriver.deadline {
            return wheelDriver.column == column
        }
        #endif
        return scrollingColumn == column
    }

    private func columnScrollKey(_ id: Int, passage: String) -> String {
        passage + "|column:\(id)"
    }

    private func correspondingVerse(_ verse: Int, in column: CompareColumn) -> Int? {
        guard let rows = independentRows[column.id] else { return nil }
        return rows.last(where: { $0.verseNum <= verse })?.verseNum ?? rows.first?.verseNum
    }

    @State private var reorderedStackedAnchor: (passage: String, target: StackedVerseTarget)?

    private struct StackedVerseTarget: Hashable {
        let columnID: Int
        let verse: Int
    }

    private func stackedIndependentComparison(_ state: BibleState, _ columns: [CompareColumn], passage: String) -> some View {
        let key = "stacked|" + passage
        return ScrollViewReader { proxy in
            restoredCompareScroll(key: key, initialJump: {
                if let bookmark = reorderedStackedAnchor, bookmark.passage == passage {
                    reorderedStackedAnchor = nil
                    proxy.scrollTo(bookmark.target, anchor: .top)
                } else if let column = columns.first(where: { $0.id == lastScrolledColumn }),
                          let verse = app.compareColumnScrollVerses[tabId]?[columnScrollKey(column.id, passage: passage)] {
                    proxy.scrollTo(StackedVerseTarget(columnID: column.id, verse: verse), anchor: .top)
                } else if let target = stackedSelectionTarget(in: columns, state: state) {
                    proxy.scrollTo(target, anchor: .top)
                }
            }) {
                independentComparison(columns, passage: passage)
            }
            .onScrollPhaseChange { old, new in
                guard old != .idle, new == .idle, app.activeTab?.id == tabId, loadedPassage == passage else { return }
                for (id, verses) in visibleStackedVerses {
                    if let verse = verses.min() {
                        app.compareColumnScrollVerses[tabId, default: [:]][columnScrollKey(id, passage: passage)] = verse
                    }
                }
            }
        }
    }

    private func stackedSelectionTarget(in columns: [CompareColumn], state: BibleState) -> StackedVerseTarget? {
        let preferred = columns.filter { $0.text == state.translation } + columns.filter { $0.text != state.translation }
        for column in preferred {
            let selected = selectedRows(in: column, source: state)
            let focused = state.verse.flatMap { mappedVerse($0, in: column, source: state) }
            if let row = selected.first(where: { $0.verseNum == focused }) ?? selected.first {
                return StackedVerseTarget(columnID: column.id, verse: row.verseNum)
            }
        }
        return nil
    }

    private func independentComparison(_ columns: [CompareColumn], passage: String) -> some View {
        LazyVStack(alignment: .leading, spacing: 12, pinnedViews: [.sectionHeaders]) {
            ForEach(columns) { column in
                Section {
                    independentVerses(column, stackedPassage: passage)
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
        let visible = current.filter { availableColumnIDs.contains($0.id) }
        guard let source = visible.firstIndex(where: { $0.id == column.id && $0.historyKey == column.historyKey }),
              visible.indices.contains(source + delta),
              let target = current.firstIndex(where: { $0.id == visible[source + delta].id }) else { return }
        moveColumn(column, to: target, in: current)
    }

    private func selectedRows(in column: CompareColumn, source: BibleState) -> [ChapterVerseRow] {
        guard column.follows(source), let available = independentRows[column.id] else { return [] }
        let numbers = Set(selectedVerses(in: source).compactMap { mappedVerse($0, in: column, source: source) })
        return available.filter { numbers.contains($0.verseNum) }
    }

    private func mappedVerse(_ verse: Int, in column: CompareColumn, source: BibleState) -> Int? {
        guard let mapped = ChapterMap.verseCounterpart(source.bookId, chapter: source.chapter, verse: verse,
                                                       from: source.translation, to: column.text) else { return verse }
        return mapped.chapter == column.chapter ? mapped.verse : nil
    }

    @ViewBuilder private func independentVerses(_ column: CompareColumn, compact: Bool = false,
                                                stackedPassage: String? = nil, independentPassage: String? = nil) -> some View {
        if let verses = independentRows[column.id], !verses.isEmpty {
            let selected = Set(selectedRows(in: column, source: state).map(\.verseNum))
            ForEach(verses, id: \.verseNum) { row in
                let isSelected = selected.contains(row.verseNum)
                let content = independentVerseRow(row, column: column, compact: compact, selected: isSelected)
                    .background(Color.accentColor.opacity(isSelected ? 0.08 : 0), in: .rect(cornerRadius: 6))
                if let stackedPassage {
                    content
                        .id(StackedVerseTarget(columnID: column.id, verse: row.verseNum))
                        .onScrollVisibilityChange(threshold: 0.2) { visible in
                            trackStackedVerse(row.verseNum, columnID: column.id, passage: stackedPassage, visible: visible)
                        }
                        .onDisappear {
                            trackStackedVerse(row.verseNum, columnID: column.id, passage: stackedPassage, visible: false)
                        }
                } else if let independentPassage {
                    content
                        .onScrollVisibilityChange(threshold: 0.2) { visible in
                            updateIndependentVisibility(row.verseNum, column: column, passage: independentPassage, visible: visible)
                        }
                        .onDisappear {
                            updateIndependentVisibility(row.verseNum, column: column, passage: independentPassage, visible: false)
                        }
                } else {
                    content
                }
            }
        } else {
            Text("No Text in This Passage").foregroundStyle(.secondary)
        }
    }

    private func trackStackedVerse(_ verse: Int, columnID: Int, passage: String, visible: Bool) {
        guard passage == loadedPassage else { return }
        if visible {
            visibleStackedVerses[columnID, default: []].insert(verse)
        } else {
            visibleStackedVerses[columnID]?.remove(verse)
        }
    }

    @ViewBuilder private func independentVerseRow(_ row: ChapterVerseRow, column: CompareColumn,
                                                   compact: Bool, selected: Bool) -> some View {
        if compact {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 2) {
                    if showVerseNumbers { independentVerseButton(row, column: column, selected: selected) }
                    Spacer(minLength: 0)
                    comparisonVerseControls(row, column: column)
                }
                comparisonVerseBody(row, column: column, state: state, showsControls: false)
            }
        } else {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                if showVerseNumbers { independentVerseButton(row, column: column, selected: selected) }
                comparisonVerseBody(row, column: column, state: state)
            }
        }
    }

    private func independentVerseButton(_ row: ChapterVerseRow, column: CompareColumn, selected: Bool) -> some View {
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
        .accessibilityAddTraits(selected ? .isSelected : [])
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
                    .environment(\.openURL, strongsAction(for: row, textId: column.text))
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
        #if os(iOS)
        VerseActionsMenu(label: "Actions for \(comparisonVerseReference(row, column: column))") {
            comparisonVerseActions(row, column: column)
        }
        #endif
    }

    private func openReader(_ row: ChapterVerseRow, in column: CompareColumn, inspector: String? = nil) {
        openReader(ResolvedPassage(textId: column.text, bookId: row.bookId,
                                  chapter: row.chapter, verse: row.verseNum), inspector: inspector)
    }

    private func openReader(_ passage: ResolvedPassage, inspector: String? = nil, readingVerse: Int? = nil) {
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
        if let tab = app.findTab(tabId) {
            let chapter = ChapterEdition(BibleState(tab.state))
            if passage.verse != nil {
                app.requestScriptureJump(in: tabId, to: chapter)
            } else if let readingVerse {
                app.scriptureReadingPositions[tabId, default: [:]][chapter.key] =
                    ScriptureReadingPosition(offset: 0, verse: readingVerse)
            }
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

    private func strongsAction(for row: ChapterVerseRow, textId: String) -> OpenURLAction {
        OpenURLAction { url in
            guard url.scheme == "strongs" else { return .systemAction }
            let id = String(url.absoluteString.dropFirst("strongs:".count))
            app.inspectStrongs(id, in: tabId, textId: textId, bookId: row.bookId, chapter: row.chapter, verse: row.verseNum)
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
            .disabled(pinned && !eligibleComparisonEditions.contains(column.text))
            Button {
                setColumns([column])
            } label: {
                Label("Open in Reader", systemImage: "book.pages")
            }
            Divider()
            Button {
                let remaining = columns.filter { $0.id != column.id }
                // Old workspaces can open Compare with only one saved column.
                setColumns(remaining.isEmpty ? [column] : remaining)
            } label: {
                Label(columns.count <= 2 ? "Close Column and Exit Compare" : "Close Column", systemImage: "xmark")
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
        #else
        .hoverEffect(.highlight)
        #endif
        .help("Column actions")
    }

    private func verseButton(_ verse: Int, state: BibleState, selected: Bool) -> some View {
        Button {
            toggleVerse(verse, in: state)
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

    private func toggleVerse(_ verse: Int, in state: BibleState) {
        let edition = ChapterEdition(state)
        let previousAnchor = selectionAnchor.flatMap { $0.edition == edition ? $0.verse : nil }
        var selection = selectedVerses(in: state)
        #if os(macOS)
        let extend = NSEvent.modifierFlags.contains(.shift)
        #else
        let extend = false
        #endif
        if extend, let anchor = previousAnchor ?? state.verse {
            let span = min(anchor, verse)...max(anchor, verse)
            selection = Set(rows.keys.filter(span.contains))
            selectionAnchor = (edition, anchor)
        } else {
            if selection.contains(verse) { selection.remove(verse) } else { selection.insert(verse) }
            selectionAnchor = selection.contains(verse) ? (edition, verse) : selection.min().map { (edition, $0) }
        }

        let groups = consecutiveVerseRuns(selection)
        let contiguous = groups.count == 1 ? groups.first : nil
        let focus = contiguous?.lowerBound ?? (selection.contains(verse) ? verse : selection.min())
        let end = contiguous.flatMap { $0.count > 1 ? $0.upperBound : nil }
        let passage = ResolvedPassage(textId: state.translation, bookId: state.bookId, chapter: state.chapter,
                                      verse: focus, endVerse: end, verseGroups: groups.count > 1 ? groups : [])
        if state.verse != focus { localVerseSelection = focus }
        app.update(tabId, recordHistory: false) { tab in
            var target = BibleState(tab.state)
            target.verse = focus
            target.endVerse = end
            tab.state = target.merged(into: tab.state)
            tab.state["nativeSelectedVerses"] = passage.savedSelection
            tab.state.remove("endChapter")
        }
    }

    private func allowsSameNumberAlignment(from edition: String, to anchor: BibleState) -> Bool {
        // Brenton Joel 3 is a verified excerpt of KJV Joel 2. The remaining KJV verses belong to Brenton Joel 2.
        if anchor.bookId == "JOL", anchor.chapter == 3, ChapterMap.isLxx(anchor.translation), ChapterMap.isKjv(edition) {
            return false
        }
        return true
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
        let eligible = await app.bible.comparisonEditions(forBook: st.bookId, chapter: st.chapter, from: st.translation,
                                                        candidates: availableTexts.map(\.id))
        guard !Task.isCancelled else { return }
        let aligned = cols.allSatisfy { $0.follows(st) }
        for column in cols where aligned {
            let edition = column.text
            var chapters = ChapterMap.equivalentChapters(st.bookId, st.chapter, from: st.translation, to: edition)
            if ChapterMap.isLxx(st.translation), ChapterMap.isKjv(edition) {
                if st.bookId == "JON", st.chapter == 2 { chapters.insert(1, at: 0) }
                if st.bookId == "MAL", st.chapter == 3 { chapters.append(4) }
            } else if st.bookId == "JON", st.chapter == 1,
                      ChapterMap.isKjv(st.translation), ChapterMap.isLxx(edition) {
                chapters.append(2)
            }

            for chapter in chapters {
                guard !Task.isCancelled else { return }
                let chapterRows = chapter == column.chapter
                    ? independent[column.id] ?? []
                    : await comparisonChapter(book: st.bookId, chapter: chapter, edition: edition)
                for row in chapterRows {
                    if let mapped = ChapterMap.verseCounterpart(st.bookId, chapter: chapter, verse: row.verseNum,
                                                                from: edition, to: st.translation) {
                        if mapped.chapter == st.chapter { out[mapped.verse, default: [:]][column.id] = row }
                    } else if chapter == column.chapter,
                              allowsSameNumberAlignment(from: edition, to: st),
                              ChapterMap.verseCounterpart(st.bookId, chapter: st.chapter, verse: row.verseNum,
                                                          from: st.translation, to: edition) == nil {
                        out[row.verseNum, default: [:]][column.id] = row
                    }
                }
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
        eligibleComparisonEditions = Set(eligible)
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
            let chapter = ChapterMap.mapChapter(anchor.bookId, anchor.chapter, from: anchor.translation, to: column.text)
            record["chapter"] = .number(Double(chapter))
            if column.book != anchor.bookId || column.chapter != chapter { record.remove("scrollPos") }
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
        if !columns.contains(where: { $0.id == id }) {
            var record = JSObject()
            record["textId"] = .string(JSString(text))
            record["bookId"] = .string(JSString(book))
            record["chapter"] = .number(Double(chapter))
            record["nativePinnedPassage"] = .bool(true)
            if let column = CompareColumn(id: id, record: record, anchor: anchor) { setColumns(columns + [column]) }
            return
        }
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

        let aligned = selectedVerses(in: source).sorted().compactMap { rows[$0]?[column.id] }
        let mapped = aligned.isEmpty ? selectedRows(in: column, source: source) : aligned
        let mappedFocus = mappedVerse(first, in: column, source: source)
        let anchor = rows[first]?[column.id] ?? mapped.first { $0.verseNum == mappedFocus } ?? mapped.first
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

    private func readingAnchor(in column: CompareColumn, source: BibleState) -> (chapter: Int, verse: Int)? {
        let passage = passageKey(source, columns)
        guard loadedPassage == passage else { return nil }
        if syncScrolling, columns.allSatisfy({ $0.follows(source) }) {
            guard let top = visibleAlignedVerses.min() else { return nil }
            let row = rows[top]?[column.id] ?? rows.keys.filter { $0 > top }.sorted().lazy.compactMap {
                rows[$0]?[column.id]
            }.first
            return row.map { ($0.chapter, $0.verseNum) }
        }
        let key = columnScrollKey(column.id, passage: passage)
        let saved = app.compareColumnScrollVerses[tabId]?[key]
            ?? column.legacyScrollVerse.flatMap { correspondingVerse($0, in: column) }
        let verse: Int?
        if canShowIndependentPanes(width: compareWidth, count: columns.count) {
            verse = independentVisibleVerses[column.id] ?? saved
        } else {
            verse = visibleStackedVerses[column.id]?.min() ?? saved ?? independentRows[column.id]?.first?.verseNum
        }
        return verse.map { (column.chapter, $0) }
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
            let source = state
            var passage = readerPassage(for: column, source: source)
            let anchor = passage.verse == nil ? readingAnchor(in: column, source: source) : nil
            if let anchor { passage.chapter = anchor.chapter }
            openReader(passage, readingVerse: anchor?.verse)
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
            ? visibleAlignedVerses.min() ?? anchor.verse : nil
        var survivors = 0
        for (index, column) in next.enumerated() {
            guard let source = previousByID[column.id], source.destinationKey == column.destinationKey else { continue }
            survivors += 1
            let oldKey = columnScrollKey(source.id, passage: oldPassage)
            let mapped = alignedVerse.flatMap { mappedVerse($0, in: source, source: anchor) }
            if let verse = visibleStackedVerses[source.id]?.min() ?? independentVisibleVerses[source.id]
                ?? app.compareColumnScrollVerses[tabId]?[oldKey] ?? mapped {
                let newKey = columnScrollKey(reindexed[index].id, passage: newPassage)
                app.compareColumnScrollVerses[tabId, default: [:]][newKey] = verse
            }
        }
        if survivors == previous.count, survivors == next.count,
           let offset = app.compareScrollOffsets[tabId]?["aligned|" + oldPassage] {
            app.compareScrollOffsets[tabId, default: [:]]["aligned|" + newPassage] = offset
        }
        if !canShowIndependentPanes(width: compareWidth, count: previous.count),
           !previous.allSatisfy({ $0.follows(anchor) }) {
            for source in previous {
                guard let verse = visibleStackedVerses[source.id]?.min(),
                      let index = next.firstIndex(where: { $0.id == source.id && $0.destinationKey == source.destinationKey })
                else { continue }
                app.compareScrollOffsets[tabId]?.removeValue(forKey: "stacked|" + newPassage)
                reorderedStackedAnchor = (newPassage, StackedVerseTarget(columnID: reindexed[index].id, verse: verse))
                break
            }
        }
    }
}

#if os(macOS)
/// Identify the wheel's pane before SwiftUI publishes either scroll position.
private struct CompareWheelRegion: NSViewRepresentable {
    let onWheel: () -> Void

    func makeNSView(context: Context) -> Region { Region() }
    func updateNSView(_ view: Region, context: Context) { view.onWheel = onWheel }
    static func dismantleNSView(_ view: Region, coordinator: Void) { view.stopMonitoring() }

    final class Region: NSView {
        var onWheel: (() -> Void)?
        private var monitor: Any?

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            stopMonitoring()
            guard window != nil else { return }
            monitor = NSEvent.addLocalMonitorForEvents(matching: .scrollWheel) { [weak self] event in
                if let self, event.window === window,
                   visibleRect.contains(convert(event.locationInWindow, from: nil)) {
                    onWheel?()
                }
                return event
            }
        }

        func stopMonitoring() {
            if let monitor { NSEvent.removeMonitor(monitor) }
            monitor = nil
        }
    }
}
#endif
