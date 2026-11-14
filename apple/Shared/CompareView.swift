import SwiftUI
import BereanCore
import BereanBible
import BereanText
import BereanReference

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
    @State private var rows: [Int: [Int: ChapterVerseRow]] = [:]
    @State private var independentRows: [Int: [ChapterVerseRow]] = [:]
    @State private var loadedPassage: String?
    @State private var localVerseSelection: Int?
    @State private var editingColumn: CompareColumn?
    @AppStorage("showVerseNumbers") private var showVerseNumbers = true

    var state: BibleState { BibleState(app.findTab(tabId)?.state ?? JSObject()) }
    var columns: [CompareColumn] {
        CompareColumn.resolved(in: app.findTab(tabId)?.state ?? JSObject())
    }

    var body: some View {
        let st = state, cols = columns
        let passage = "\(st.translation)|\(st.bookId)|\(st.chapter)|\(cols.map { "\($0.id):\($0.destinationKey)" }.joined(separator: ","))"
        GeometryReader { geometry in
            if loadedPassage != passage {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if !cols.allSatisfy({ $0.follows(st) }) {
                if geometry.size.width >= CGFloat(cols.count) * 260 {
                    independentPanes(cols)
                } else {
                    ScrollView { independentComparison(cols) }
                        .contentMargins(.bottom, dockClearance, for: .scrollContent)
                }
            } else if rows.isEmpty {
                ContentUnavailableView("No Text in This Passage", systemImage: "book.closed")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                alignedComparison(st, cols)
            }
        }
        .toolbar {
            ToolbarItem {
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
                }
                .help("Add a translation or open one in the reader")
            }
        }
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
        .task(id: passage) { await load(st, cols, passage: passage) }
    }

    private func comparisonGrid(_ st: BibleState, _ cols: [CompareColumn]) -> some View {
        Grid(alignment: .topLeading, horizontalSpacing: 18, verticalSpacing: 10) {
            GridRow {
                if showVerseNumbers { Text("").gridColumnAlignment(.trailing) }
                ForEach(cols) { c in
                    HStack {
                        Text(textInfo(c.text).name).font(.headline)
                        Spacer()
                        columnActions(c, columns: cols)
                    }
                    .frame(minWidth: 180)
                }
            }
            Divider().gridCellUnsizedAxes(.horizontal)
            ForEach(rows.keys.sorted(), id: \.self) { v in
                GridRow(alignment: .firstTextBaseline) {
                    if showVerseNumbers {
                        verseButton(v, state: st)
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
        LazyVStack(alignment: .leading, spacing: 14) {
            ForEach(columns) { text in
                HStack {
                    Text(textInfo(text.text).name).font(.subheadline.weight(.semibold))
                    Spacer()
                    columnActions(text, columns: columns)
                }
            }
            ForEach(rows.keys.sorted(), id: \.self) { verse in
                VStack(alignment: .leading, spacing: 8) {
                    Divider()
                    if showVerseNumbers { verseButton(verse, state: state) }
                    ForEach(columns) { text in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(textInfo(text.text).short)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                            comparisonText(verse, text: text, state: state)
                        }
                    }
                }
                .id(verse)
            }
        }
        .padding(16)
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
                ViewThatFits(in: .horizontal) {
                    comparisonGrid(state, columns)
                    stackedComparison(state, columns)
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
            Button {
                editingColumn = column
            } label: {
                Label(column.label, systemImage: "book")
                    .font(.headline)
                    .lineLimit(1)
                    .frame(minHeight: controlSize)
                    .contentShape(.rect)
            }
            .buttonStyle(.interactivePlain)
            .accessibilityLabel("Change passage for \(column.label)")
            .help("Change column passage")
            Spacer()
            columnActions(column, columns: columns)
        }
        .padding(.horizontal, 8)
    }

    @ViewBuilder private func independentVerses(_ column: CompareColumn) -> some View {
        if let verses = independentRows[column.id], !verses.isEmpty {
            ForEach(verses, id: \.verseNum) { row in
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    if showVerseNumbers {
                        Button {
                            openReader(column, verse: row.verseNum)
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
                    VerseRowView(row: row, textId: column.text, showStrongs: state.showStrongs,
                                 fontSize: app.fontSize, lineSpacing: app.lineSpacing,
                                 replacer: app.wordReplacerEnabled, family: app.scriptureFontFamily)
                    .environment(\.openURL, strongsAction(for: row))
                }
            }
        } else {
            Text("No Text in This Passage").foregroundStyle(.secondary)
        }
    }

    private func openReader(_ column: CompareColumn, verse: Int) {
        app.update(tabId) { tab in
            var reader = BibleState(tab.state)
            reader.compareMode = false
            reader.bookId = column.book
            reader.chapter = column.chapter
            reader.translation = column.text
            reader.verse = verse
            reader.endVerse = nil
            tab.state = reader.merged(into: tab.state)
            tab.state.remove("compareColumns")
            tab.title = Reference.readerChapterLabel(column.book, column.chapter, textId: column.text)
        }
    }

    @ViewBuilder private func comparisonText(_ verse: Int, text column: CompareColumn, state: BibleState) -> some View {
        let text = column.text
        if let row = rows[verse]?[column.id] {
            VStack(alignment: .leading, spacing: 3) {
                if row.verseNum != verse || row.chapter != ChapterMap.mapChapter(state.bookId, state.chapter, from: state.translation, to: text) {
                    Text("\(row.chapter):\(row.verseNum)")
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                VerseRowView(row: row, textId: text, showStrongs: state.showStrongs, fontSize: app.fontSize,
                             lineSpacing: app.lineSpacing, replacer: app.wordReplacerEnabled, family: app.scriptureFontFamily)
                    .environment(\.openURL, strongsAction(for: row))
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
        #endif
        .help("Column actions")
    }

    private func verseButton(_ verse: Int, state: BibleState) -> some View {
        Button {
            if state.verse != verse { localVerseSelection = verse }
            app.update(tabId, recordHistory: false) { tab in
                var target = BibleState(tab.state)
                target.verse = verse
                target.endVerse = nil
                tab.state = target.merged(into: tab.state)
            }
        } label: {
            Text("\(verse)")
                .font(.system(.caption, design: .rounded).weight(.semibold))
                .foregroundStyle(isSelected(verse, state) ? Color.accentColor : Color.secondary)
                .frame(minWidth: controlSize, minHeight: controlSize)
                .contentShape(.rect)
        }
        .buttonStyle(.interactivePlain)
        .accessibilityLabel("Verse \(verse)")
        .accessibilityAddTraits(isSelected(verse, state) ? .isSelected : [])
    }

    private func isSelected(_ verse: Int, _ state: BibleState) -> Bool {
        guard let first = state.verse else { return false }
        return verse >= first && verse <= max(first, state.endVerse ?? first)
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

    func setColumns(_ cols: [CompareColumn]) {
        let st = state
        app.update(tabId) { t in
            if cols.count < 2 {
                var reader = st
                reader.compareMode = false
                if let column = cols.first {
                    let remaining = column.text
                    reader.bookId = column.book
                    reader.chapter = column.chapter
                    if !column.follows(st) {
                        reader.verse = nil
                        reader.endVerse = nil
                    } else if st.bookId == "JON", let verse = st.verse {
                        let start = ChapterMap.jonahCounterpart(chapter: st.chapter, verse: verse, from: st.translation, to: remaining)
                            ?? (chapter: reader.chapter, verse: verse)
                        reader.chapter = start.chapter
                        reader.verse = start.verse
                        reader.endVerse = st.endVerse.flatMap { end in
                            let mapped = ChapterMap.jonahCounterpart(chapter: st.chapter, verse: end, from: st.translation, to: remaining)
                                ?? (chapter: st.chapter, verse: end)
                            return mapped.chapter == start.chapter && mapped.verse > start.verse ? mapped.verse : nil
                        }
                    }
                    reader.translation = remaining
                }
                t.state = reader.merged(into: t.state)
                t.state.remove("compareColumns")
                t.title = Reference.readerChapterLabel(reader.bookId, reader.chapter, textId: reader.translation)
                return
            }
            t.state["compareColumns"] = .array(cols.map { .object($0.record) })
        }
    }
}
