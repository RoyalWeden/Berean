import SwiftUI
import BereanCore
import BereanBible
import BereanText
import BereanReference
import BereanNotes

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
    @State private var localVerseSelection: Int?
    @State private var editingColumn: CompareColumn?
    @State private var tagging: VerseTagTarget?

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

    var body: some View {
        let st = state, cols = columns
        let passage = passageKey(st, cols)
        GeometryReader { geometry in
            if loadedPassage != passage {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if !cols.allSatisfy({ $0.follows(st) }) {
                if !prefersStackedComparison, geometry.size.width >= CGFloat(cols.count) * 260 {
                    independentPanes(cols)
                } else {
                    ScrollView { independentComparison(cols) }
                        .contentMargins(.bottom, dockClearance, for: .scrollContent)
                }
            } else {
                alignedComparison(st, cols)
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            #if os(iOS)
            HStack(spacing: 2) {
                manageTranslations(st, cols)
                    .menuStyle(.borderlessButton)
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
            #endif
        }
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
        return Grid(alignment: .topLeading, horizontalSpacing: 18, verticalSpacing: 10) {
            GridRow {
                if showVerseNumbers { Text("").gridColumnAlignment(.trailing) }
                ForEach(cols) { c in
                    HStack {
                        alignedColumnHeading(c, available: available.contains(c.id))
                        columnActions(c, columns: cols)
                    }
                    .frame(minWidth: 180)
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
                    }
                }
                .id(v)
            }
        }
        .padding(24)
    }

    private func stackedComparison(_ state: BibleState, _ columns: [CompareColumn]) -> some View {
        let available = availableColumnIDs
        let selected = selectedVerses(in: state)
        return LazyVStack(alignment: .leading, spacing: 14) {
            ForEach(columns) { text in
                HStack {
                    alignedColumnHeading(text, available: available.contains(text.id))
                    columnActions(text, columns: columns)
                }
            }
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

    private var dockClearance: CGFloat {
        #if os(iOS)
        ReaderFloatingControls.dockOffset
        #else
        0
        #endif
    }

    private func alignedComparison(_ state: BibleState, _ columns: [CompareColumn]) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                if prefersStackedComparison {
                    stackedComparison(state, columns)
                } else {
                    ViewThatFits(in: .horizontal) {
                        comparisonGrid(state, columns)
                        stackedComparison(state, columns)
                    }
                }
            }
            .contentMargins(.bottom, dockClearance, for: .scrollContent)
            .onChange(of: state.verse, initial: true) {
                let selectedHere = localVerseSelection != nil && localVerseSelection == state.verse
                localVerseSelection = nil
                if !selectedHere, let verse = state.verse {
                    proxy.scrollTo(verse, anchor: .top)
                }
            }
        }
    }

    private func independentPanes(_ columns: [CompareColumn]) -> some View {
        HStack(spacing: 0) {
            ForEach(columns) { column in
                if column.id != columns.first?.id { Divider() }
                VStack(spacing: 0) {
                    independentHeader(column, columns: columns)
                        .padding(.horizontal, 12)
                    Divider()
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 12) {
                            independentVerses(column)
                        }
                        .padding(16)
                    }
                    .contentMargins(.bottom, dockClearance, for: .scrollContent)
                    .id(column.label)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
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

    private func independentHeader(_ column: CompareColumn, columns: [CompareColumn]) -> some View {
        HStack {
            columnPassageButton(column, title: column.label)
            columnActions(column, columns: columns)
        }
        .padding(.horizontal, 8)
    }

    private func columnPassageButton(_ column: CompareColumn, title: String) -> some View {
        Button {
            editingColumn = column
        } label: {
            Label(title, systemImage: "book")
                .font(.subheadline.weight(.semibold))
                .frame(maxWidth: .infinity, minHeight: controlSize, alignment: .leading)
                .contentShape(.rect)
        }
        .buttonStyle(.interactivePlain)
        .accessibilityLabel("Change passage for \(column.label)")
        .help("Change column passage")
    }

    @ViewBuilder private func independentVerses(_ column: CompareColumn) -> some View {
        if let verses = independentRows[column.id], !verses.isEmpty {
            ForEach(verses, id: \.verseNum) { row in
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    if showVerseNumbers {
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
                    comparisonVerseBody(row, column: column, state: state)
                }
            }
        } else {
            Text("No Text in This Passage").foregroundStyle(.secondary)
        }
    }

    @ViewBuilder private func comparisonVerseActions(_ row: ChapterVerseRow, column: CompareColumn) -> some View {
        let reference = comparisonVerseReference(row, column: column)
        Button("Copy Verse", systemImage: "doc.on.doc") {
            let text = VerseDisplay.text(row.text, tagged: row.textTagged, textId: column.text,
                                         replacerEnabled: app.wordReplacerEnabled, rules: WordReplacer.defaultRules)
            Clipboard.copy("\(reference) \(text)")
            AccessibilityNotification.Announcement("Verse copied").post()
        }
        Button("Copy Reference", systemImage: "number") {
            Clipboard.copy(reference)
            AccessibilityNotification.Announcement("Reference copied").post()
        }
        Menu("Highlight Verse", systemImage: "highlighter") {
            ForEach(highlightColors, id: \.self) { color in
                Button(color.capitalized, systemImage: "circle.fill") {
                    try? app.highlights?.setVerseColor(bookId: row.bookId, chapter: row.chapter,
                                                       verse: row.verseNum, color: color, textId: column.text)
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
                VerseRowView(row: row, textId: column.text, showStrongs: state.showStrongs,
                             highlights: chapterHighlights[EditionChapter(row, text: column.text)]?[row.verseNum] ?? [],
                             fontSize: scriptureFontSize, lineSpacing: app.lineSpacing,
                             replacer: app.wordReplacerEnabled, family: app.scriptureFontFamily)
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
            if let inspector {
                reader.rightPanelOpen = true
                reader.rightPanelTab = inspector
            }
            tab.state = reader.merged(into: tab.state)
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
        .menuStyle(.borderlessButton)
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

    func load(_ st: BibleState, _ cols: [CompareColumn], passage: String) async {
        var out: [Int: [Int: ChapterVerseRow]] = [:]
        var independent: [Int: [ChapterVerseRow]] = [:]
        if !cols.allSatisfy({ $0.follows(st) }) {
            for column in cols {
                independent[column.id] = await app.bible.queryChapter(column.book, column.chapter, textId: column.text)
            }
        }
        for column in cols where independent.isEmpty {
            let c = column.text
            // The tab's chapter is in its own text's numbering; map it for the column's text.
            let ch = ChapterMap.mapChapter(st.bookId, st.chapter, from: st.translation, to: c)
            let chapters = st.bookId == "JON" && st.chapter == 2
                && ChapterMap.isLxx(st.translation) && ChapterMap.isKjv(c) ? [1, ch] : [ch]
            for chapter in chapters {
                for row in await app.bible.queryChapter(st.bookId, chapter, textId: c) {
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
        app.update(tabId) { tab in
            tab.state["compareColumns"] = .array(cols.map { .object($0.record) })
        }
    }
}
