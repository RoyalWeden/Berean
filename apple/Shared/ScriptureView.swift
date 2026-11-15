import SwiftUI
import CoreTransferable
import UniformTypeIdentifiers
import BereanCore
import BereanBible
import BereanText
import BereanReference
import BereanWorkspace
import BereanNotes

struct ScriptureReadingPosition {
    let offset: CGFloat
    let verse: Int?
}

struct ChapterEdition: Equatable {
    let book: String
    let chapter: Int
    let text: String

    init(_ state: BibleState) {
        book = state.bookId
        chapter = state.chapter
        text = state.translation
    }

    init(book: String, chapter: Int, text: String) {
        self.book = book
        self.chapter = chapter
        self.text = text
    }

    var key: String { "\(text)|\(book)|\(chapter)" }

    var counterpart: Self? {
        let other: String
        if ChapterMap.isLxx(text) { other = "kjva" }
        else if ChapterMap.isKjv(text) { other = "lxx" }
        else { return nil }
        return Self(book: book, chapter: ChapterMap.mapChapter(book, chapter, from: text, to: other), text: other)
    }
}

extension AppModel {
    func installedCounterpart(of source: ChapterEdition) async -> ChapterEdition? {
        guard let target = source.counterpart else { return nil }
        let chapters = await bible.chapterNumbers(target.book, textId: target.text)
        return chapters.contains(target.chapter) ? target : nil
    }

    func switchChapterEdition(in tabId: String, from source: ChapterEdition, to target: ChapterEdition) {
        guard let tab = activeTab, tab.id == tabId, tab.tabType == .bible else { return }
        var reader = BibleState(tab.state)
        guard !reader.compareMode, ChapterEdition(reader) == source, source.counterpart == target else { return }
        scriptureEditionSources[tabId] = (source, target)
        reader.translation = target.text
        reader.chapter = target.chapter
        reader.verse = nil
        reader.endVerse = nil
        update(tabId) {
            $0.state = reader.merged(into: $0.state)
            $0.state.remove("endChapter")
            $0.title = Reference.readerChapterLabel(target.book, target.chapter, textId: target.text)
        }
        recordRecent(textId: target.text, bookId: target.book, chapter: target.chapter, verse: nil, endVerse: nil)
    }
    func restoreScripturePosition(tabId: String, edition: ChapterEdition) -> ScriptureReadingPosition? {
        if let transition = scriptureEditionSources[tabId], transition.target == edition {
            scriptureEditionSources.removeValue(forKey: tabId)
            guard let saved = scriptureReadingPositions[tabId]?[transition.source.key] else { return nil }
            var verse = saved.verse
            if edition.book == "JON", let number = verse,
               let mapped = ChapterMap.jonahCounterpart(chapter: transition.source.chapter, verse: number,
                                                        from: transition.source.text, to: edition.text) {
                verse = mapped.chapter == edition.chapter ? mapped.verse : nil
            }
            return ScriptureReadingPosition(offset: 0, verse: verse)
        }
        scriptureEditionSources.removeValue(forKey: tabId)
        return scriptureReadingPositions[tabId]?[edition.key]
    }

}

struct ChapterTagTarget: Identifiable {
    let bookId: String
    let chapter: Int
    let textId: String

    init(_ state: BibleState) {
        bookId = state.bookId
        chapter = state.chapter
        textId = state.translation
    }

    var id: String { "\(textId)/\(bookId)/\(chapter)" }
    var label: String { Reference.readerChapterLabel(bookId, chapter, textId: textId) }
    var ranges: [TagRange] { [TagRange(bookId: bookId, chapter: Double(chapter), whole: true)] }
}

private struct SharedVerseSelection: Transferable {
    let reference: String
    let rows: [ChapterVerseRow]
    let textId: String
    let replacerEnabled: Bool

    var fileName: String {
        reference.replacingOccurrences(of: ":", with: " ") + ".txt"
    }

    var formattedText: String {
        ([reference] + rows.map { row in
            let text = VerseDisplay.text(row.text, tagged: row.textTagged, textId: textId,
                                         replacerEnabled: replacerEnabled, rules: WordReplacer.defaultRules)
            return "\(row.verseNum) \(text)"
        }).joined(separator: "\n")
    }

    static var transferRepresentation: some TransferRepresentation {
        ProxyRepresentation(exporting: { (selection: Self) in selection.formattedText })
            .suggestedFileName { $0.fileName }
    }
}

private struct SharedScriptureChapter: Transferable {
    let reference: String
    let bookId: String
    let chapter: Int
    let textId: String
    let replacerEnabled: Bool
    let bible: BibleService

    func formattedText() async throws -> String {
        let rows = await bible.queryChapter(bookId, chapter, textId: textId)
        guard !rows.isEmpty else { throw CocoaError(.fileReadNoSuchFile) }
        return SharedVerseSelection(reference: reference, rows: rows, textId: textId,
                                    replacerEnabled: replacerEnabled).formattedText
    }

    static var transferRepresentation: some TransferRepresentation {
        ProxyRepresentation(exporting: { (chapter: Self) async throws -> String in
            try await chapter.formattedText()
        })
        .suggestedFileName { $0.reference + ".txt" }
    }
}

func referenceForCopy(_ label: String, textId: String) -> String {
    let text = textId.lowercased()
    if ChapterMap.isKjv(text) || ChapterMap.isLxx(text) {
        return "\(label) \(textInfo(text).short)"
    }
    guard let edition = availableTexts.first(where: { $0.id == text }) else { return label }
    return "\(label) [\(edition.short)]"
}

struct ChapterExportActions: View {
    @Environment(AppModel.self) private var app
    let state: BibleState
    var hasText = true

    var body: some View {
        let chapterLabel = Reference.readerChapterLabel(state.bookId, state.chapter, textId: state.translation)
        let reference = chapterLabel + (state.translation == "lxx" ? " LXX" : "")
        let chapter = SharedScriptureChapter(reference: reference, bookId: state.bookId, chapter: state.chapter,
                                            textId: state.translation, replacerEnabled: app.wordReplacerEnabled,
                                            bible: app.bible)
        Button("Copy Chapter", systemImage: "doc.on.doc") {
            Task {
                do {
                    Clipboard.copy(try await chapter.formattedText())
                    AccessibilityNotification.Announcement("Chapter copied").post()
                } catch {
                    app.userMessage = "This chapter has no text to copy."
                }
            }
        }
        .disabled(!hasText)
        Button("Copy Chapter Reference", systemImage: "number") {
            Clipboard.copy(referenceForCopy(chapterLabel, textId: state.translation))
            AccessibilityNotification.Announcement("Reference copied").post()
        }
        Button("Save Chapter as Text…", systemImage: "square.and.arrow.down") {
            Task {
                do {
                    let text = try await chapter.formattedText()
                    NoteFileTransfer.export(text, suggestedName: reference + ".txt", title: "Save Chapter as Text", type: .plainText) { outcome in
                        if case .failed(let message) = outcome {
                            app.userMessage = "Could not save the chapter. \(message)"
                        }
                    }
                } catch {
                    app.userMessage = "This chapter has no text to save."
                }
            }
        }
        .disabled(!hasText)
        ShareLink(item: chapter, preview: SharePreview(reference)) {
            Label("Share Chapter…", systemImage: "square.and.arrow.up")
        }
        .disabled(!hasText)
    }
}

/// A Scripture tab: chapter text with KJV italics and red letter, the word replacer's restorations (Yehovah,
/// Yeshua, …) on by default as in the existing app, optional Strong's numbers that open the lexicon, and a
/// selectable verse that drives the study inspector.
struct ScriptureView: View {
    @Environment(AppModel.self) private var app
    let tabId: String
    #if os(iOS)
    var findRequest: Int = 0
    #endif
    private enum CopyAction {
        case verses, reference
    }

    @State private var copiedAction: CopyAction?
    @State private var copyFeedbackID = UUID()
    @State private var loadedChapter: String?
    @State private var verses: [ChapterVerseRow] = []
    @State private var selectedVerse: Int?
    private struct SelectionDestination: Equatable {
        let verse: Int?
        let endVerse: Int?

        init(_ state: BibleState) {
            verse = state.verse
            endVerse = state.endVerse
        }

        init(verse: Int?, endVerse: Int?) {
            self.verse = verse
            self.endVerse = endVerse
        }
    }

    @State private var pendingSelectionDestination: SelectionDestination?
    /// Verses selected by clicking verse numbers (⇧-click extends from `anchor`), as in the existing reader.
    @State private var selection: Set<Int> = []
    @State private var anchor: Int?
    @State private var noteCounts: [Int: Int] = [:]
    #if os(macOS)
    @State private var chapterCitations: (key: String, notes: [Note])?
    @State private var verseCitations: (key: String, links: [Int: [NoteCrossReferences.Link]])?
    @AppStorage("crossrefSource") private var crossRefSource = "tske"
    #endif
    @State private var highlights: [Int: [Highlight]] = [:]
    @State private var pickerShown = false
    #if os(macOS)
    @State private var displayOptionsShown = false
    #endif
    @AppStorage("scriptureWidth") private var scriptureWidth = ScriptureWidth.normal
    @AppStorage("showVerseNumbers") private var showVerseNumbers = true
    @AppStorage("showRedLetters") private var showRedLetters = true
    @State private var scrollTarget: Int?
    @State private var chapterStepTask: Task<Void, Never>?
    @State private var verseTags: [Int: [TagLite]] = [:]
    @State private var chapterTags: [TagLite] = []
    @State private var tagging: (ranges: [TagRange], label: String, kind: String)?

    @State private var alternateEdition: ChapterEdition?
    #if os(macOS)
    @State private var strongsTooltips: [String: String] = [:]
    #endif

    #if os(iOS)
    private struct TappedTag: Identifiable {
        let tag: TagLite
        let verse: Int?
        var id: String { tag.id }
    }
    private struct TappedVerse: Identifiable {
        let row: ChapterVerseRow
        var notesSelection: Set<Int> = []
        var id: Int { row.verseNum }
    }
    @State private var tappedTag: TappedTag?
    @State private var tappedVerse: TappedVerse?
    @State private var afterVerseSheet: (() -> Void)?
    @State private var verseSheetCopyFeedback: UUID?
    private enum VerseSheetPage: Hashable { case notes, crossReferences, noteEditor(String) }
    private static let verseSheetCompactDetent = PresentationDetent.height(300)
    @State private var verseSheetPath: [VerseSheetPage] = []
    @State private var verseSheetDetent = Self.verseSheetCompactDetent
    #endif

    private struct ChapterBounds {
        let book: String
        let text: String
        let first: Int?
        let last: Int?
    }

    @State private var chapterBounds: ChapterBounds?

    private func canStep(_ delta: Int, from reader: BibleState) -> Bool {
        guard let bounds = chapterBounds, bounds.book == reader.bookId, bounds.text == reader.translation else { return true }
        return reader.chapter != (delta < 0 ? bounds.first : bounds.last)
    }

    var state: BibleState { BibleState(app.findTab(tabId)?.state ?? JSObject()) }

    /// "‹ Note title" back to the note whose link opened this passage (original note-back pill). Disappears when the reader
    /// leaves that chapter or the pill is used.
    @ViewBuilder func noteReturnPill(_ st: BibleState) -> some View {
        if let back = app.noteReturn, back.readerTabId == tabId,
           back.chapterKey == "\(st.translation)|\(st.bookId)|\(st.chapter)" {
            Button {
                let id = back.noteId
                app.noteReturn = nil
                app.openNote(id)
            } label: {
                Label(back.title, systemImage: "chevron.backward")
                    .font(.callout.weight(.medium)).lineLimit(1)
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .frame(maxWidth: 220, alignment: .leading)
                    .contentShape(.capsule)
            }
            .buttonStyle(.interactivePlain)
            .glassEffectCompat(interactive: true)
            .padding(.leading, 14).padding(.top, 8)
            .transition(.move(edge: .top).combined(with: .opacity))
            .help("Back to the note “\(back.title)”")
            .accessibilityLabel("Back to note \(back.title)")
        }
    }

    /// The tab's `hiddenAnnotations` (same key and shape as the original reader's tab state).
    var hiddenAnnotations: Set<String> {
        Set((app.findTab(tabId)?.state["hiddenAnnotations"]?.arrayValue ?? []).compactMap { $0.stringValue?.string })
    }

    var body: some View {
        let st = state
        Group {
            if st.compareMode { CompareView(tabId: tabId) } else { chapterBody(st) }
        }
        .overlay(alignment: .topLeading) { noteReturnPill(st) }
        .navigationTitle(Reference.readerChapterLabel(st.bookId, st.chapter, textId: st.translation))
        .navigationSubtitleCompat(st.compareMode ? "Compare" : textInfo(st.translation).name)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackgroundVisibility(.hidden, for: .navigationBar)
        #endif
        .toolbar { toolbar(st) }
        .onDisappear { chapterStepTask?.cancel() }
        .task(id: "\(st.translation)|\(st.bookId)") {
            let books = await app.books(for: st.translation)
            guard !Task.isCancelled else { return }
            let isFirst = books.first?.id == st.bookId
            let isLast = books.last?.id == st.bookId
            let chapters = if isFirst || isLast {
                await app.bible.chapterNumbers(st.bookId, textId: st.translation)
            } else {
                [Int]()
            }
            guard !Task.isCancelled else { return }
            chapterBounds = ChapterBounds(book: st.bookId, text: st.translation,
                                          first: isFirst ? chapters.first : nil,
                                          last: isLast ? chapters.last : nil)
        }
        .task(id: st.compareMode ? nil : ChapterEdition(st)) {
            guard !st.compareMode else { return }
            let target = await app.installedCounterpart(of: ChapterEdition(st))
            guard !Task.isCancelled, !state.compareMode, ChapterEdition(state) == ChapterEdition(st) else { return }
            alternateEdition = target
        }
        .sheet(isPresented: Binding(get: { tagging != nil }, set: { if !$0 { tagging = nil } })) {
            if let t = tagging { TagPickerView(ranges: t.ranges, label: t.label, kind: t.kind) }
        }
    }

    private func chapterKey(_ state: BibleState) -> String {
        "\(state.translation)|\(state.bookId)|\(state.chapter)"
    }

    @ViewBuilder func chapterBody(_ st: BibleState) -> some View {
        let chapter = chapterKey(st)
        let showActions = loadedChapter == chapter && !verses.isEmpty && !selection.isEmpty
        let actionSpace = showActions ? ReaderFloatingControls.selectionHeight : 0
        VStack(spacing: 0) {
            #if os(macOS)
            if loadedChapter == chapter, !verses.isEmpty,
               let chapterCitations, chapterCitations.key == chapter, !chapterCitations.notes.isEmpty {
                chapterCitationMenu(chapterCitations.notes)
            }
            #endif
            Group {
                if loadedChapter != chapter {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if verses.isEmpty {
                    unavailablePassage(st)
                } else {
                    #if os(macOS)
                    macReader(st, actionClearance: actionSpace)
                    #else
                    iosReader(st, actionClearance: actionSpace)
                    #endif
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .clipped()
            #if os(iOS)
            .overlay(alignment: .topTrailing) {
                if let pinchFontSize {
                    Text("\(Int(pinchFontSize)) pt")
                        .font(.caption.monospacedDigit().weight(.semibold))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(.regularMaterial, in: .capsule)
                        .padding(.trailing, 14)
                        .padding(.top, 10)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
            }
            #endif
        }
        .overlay(alignment: .bottom) {
            if showActions { selectionBar(st) }
        }
        .padding(.bottom, ReaderFloatingControls.readerDockClearance)
        .onChange(of: SelectionDestination(st)) { _, destination in
            let appliedLocally = pendingSelectionDestination == destination
            pendingSelectionDestination = nil
            if appliedLocally { return }
            guard loadedChapter == chapter else { return }
            applyPassageSelection(st)
        }
        .onChange(of: app.findTab(tabId)?.state["nativeSelectedVerses"]) {
            guard loadedChapter == chapter, pendingSelectionDestination == nil else { return }
            applyPassageSelection(st, onlyIfChanged: true)
        }
        .task(id: "\(chapter)|\(loadedChapter ?? "")|\(app.notesRevision)") {
            guard loadedChapter == chapter else { return }
            noteCounts = (try? app.notes?.coveringVerseCounts(st.bookId, st.chapter,
                                                              verses: Set(verses.map(\.verseNum)), textId: st.translation)) ?? [:]
            #if os(macOS)
            let citations = (try? app.notes?.notesCitingChapter(st.bookId, st.chapter, textId: st.translation)) ?? []
            chapterCitations = (chapter, citations)
            let links = (try? app.notes?.crossReferences(bookId: st.bookId, chapter: st.chapter, textId: st.translation))?.byVerse ?? [:]
            verseCitations = (chapter, links)
            #endif
        }
        .task(id: "\(st.bookId)|\(st.chapter)|\(app.tagsRevision)") {
            if let r = try? app.verseTags?.forChapter(st.bookId, st.chapter) { verseTags = r.verseTags; chapterTags = r.chapterTags } else { verseTags = [:]; chapterTags = [] }
        }
        .task(id: "\(st.translation)|\(st.bookId)|\(st.chapter)|\(app.highlightsRevision)") {
            highlights = (try? app.highlights?.chapter(st.bookId, st.chapter, textId: st.translation)) ?? [:]
        }
        .onChange(of: chapter) { _, _ in if app.readerChromeHidden { withAnimation(.snappy) { app.readerChromeHidden = false } } }
        .onDisappear { app.readerChromeHidden = false }
        .onChange(of: app.chapterStepRequest) { _, request in
            guard let request, request.tabId == tabId else { return }
            app.chapterStepRequest = nil
            step(request.delta)
        }
        .task(id: "\(chapter)|\(hiddenAnnotations.sorted().joined(separator: ","))") {
            // Psalm superscriptions become the title line above the first body verse (original reader behaviour).
            var loaded = PsalmSuperscription.apply(await app.bible.queryChapter(st.bookId, st.chapter, textId: st.translation),
                                                   textId: st.translation, bookId: st.bookId, chapter: st.chapter)
            // LXX: mark KJV verses this chapter doesn't have ("— v.5 not in LXX —"), as the original reader does.
            if st.translation == "lxx", MissingLxxVerses.eligible(bookId: st.bookId, chapter: st.chapter) {
                let kjv = await app.bible.queryChapter(st.bookId, st.chapter, textId: "kjva").map(\.verseNum)
                let marks = MissingLxxVerses.markers(lxxVerses: loaded.map(\.verseNum), kjvVerses: kjv)
                if !marks.isEmpty {
                    loaded = loaded.map { row in
                        guard let mark = marks[row.verseNum] else { return row }
                        var r = row
                        r.title = r.title.map { mark + "\n" + $0 } ?? mark
                        return r
                    }
                }
            }
            let hidden = hiddenAnnotations
            if !hidden.isEmpty {
                loaded = loaded.map { row in
                    var r = row
                    r.text = AnnotationFilters.strip(r.text, textId: st.translation, hidden: hidden)
                    if let t = r.textTagged { r.textTagged = AnnotationFilters.stripTagged(t, textId: st.translation, hidden: hidden) }
                    return r
                }
            }
            let destination = state
            guard !Task.isCancelled, chapterKey(destination) == chapter else { return }
            noteCounts = [:]
            verses = loaded
            applyPassageSelection(destination)
            loadedChapter = chapter
        }
    }

    #if os(macOS)
    private func chapterCitationMenu(_ notes: [Note]) -> some View {
        Menu {
            ForEach(notes) { note in
                Button(note.title.isEmpty ? "Untitled" : note.title, systemImage: "note.text") {
                    app.openNote(note.id)
                }
            }
        } label: {
            Label(notes.count == 1 ? "1 note cites this chapter" : "\(notes.count) notes cite this chapter",
                  systemImage: "link")
                .font(.caption)
        }
        .menuStyle(.borderlessButton)
        .clickableCursor()
        .fixedSize()
        .frame(maxWidth: .infinity)
        .padding(.vertical, 4)
    }
    #endif

    private func unavailablePassage(_ st: BibleState) -> some View {
        let source = ChapterEdition(st)
        return ContentUnavailableView {
            Label("Passage Unavailable", systemImage: "book.closed")
        } description: {
            Text("\(Reference.readerChapterLabel(st.bookId, st.chapter, textId: st.translation)) is unavailable in \(textInfo(st.translation).name).")
        } actions: {
            Button("Choose Passage") { pickerShown = true }
                .buttonStyle(.borderedProminent)
            if let target = alternateEdition, target == source.counterpart {
                Button("Open in \(textInfo(target.text).short)") {
                    app.switchChapterEdition(in: tabId, from: source, to: target)
                }
                .buttonStyle(.bordered)
            }
        }
    }

    // MARK: verse selection (click / ⇧-click verse numbers)

    private func applyPassageSelection(_ state: BibleState, onlyIfChanged: Bool = false) {
        let next = passageSelection(state)
        if onlyIfChanged && next == selection { return }
        selectedVerse = state.verse
        anchor = state.verse
        scrollTarget = state.verse
        selection = next
    }

    private func passageSelection(_ state: BibleState) -> Set<Int> {
        guard let first = state.verse else { return [] }
        let last = max(first, state.endVerse ?? first)
        let chapterVerses = Set(verses.map(\.verseNum))
        let restored = (app.findTab(tabId).map { ResolvedPassage.savedVerses(in: $0, reader: state) } ?? [])
            .intersection(chapterVerses)
        if state.endVerse == nil, restored.contains(first) {
            return restored
        }
        return Set(chapterVerses.filter { (first...last).contains($0) })
    }

    func verseClick(_ v: Int, shift: Bool) {
        scrollTarget = nil
        if shift, let a = anchor {
            selection = Set(min(a, v)...max(a, v)).intersection(verses.map(\.verseNum))
        } else {
            if selection.contains(v) { selection.remove(v) } else { selection.insert(v) }
            anchor = selection.contains(v) ? v : selection.min()
        }
        selectedVerse = selection.contains(v) ? v : selection.min()
        persistLocalSelection()
    }

    private func persistLocalSelection() {
        let destination: SelectionDestination
        if let first = selection.min(), let last = selection.max(), first != last, selection.count == last - first + 1 {
            destination = SelectionDestination(verse: first, endVerse: last)
        } else {
            // Legacy destinations represent one verse or a continuous range.
            destination = SelectionDestination(verse: selectedVerse, endVerse: nil)
        }
        let disjoint = destination.endVerse == nil && selection.count > 1 ? selection.sorted() : []
        writeLocalSelectionDestination(destination, disjoint: disjoint)
        app.focusStudyVerse(selectedVerse, in: tabId, selectedVerses: selection.sorted())
    }

    private func writeLocalSelectionDestination(_ destination: SelectionDestination, disjoint: [Int] = []) {
        let changed = SelectionDestination(state) != destination
        if changed { pendingSelectionDestination = destination }
        app.update(tabId, recordHistory: false) { tab in
            var reader = BibleState(tab.state)
            reader.verse = destination.verse
            reader.endVerse = destination.endVerse
            tab.state = reader.merged(into: tab.state)
            if disjoint.isEmpty || destination.verse == nil {
                tab.state.remove("nativeSelectedVerses")
            } else {
                var saved = JSObject()
                saved["passage"] = .string(JSString(chapterKey(reader)))
                saved["activeVerse"] = destination.verse.map { .number(Double($0)) }
                saved["verses"] = .array(disjoint.map { .number(Double($0)) })
                tab.state["nativeSelectedVerses"] = .object(saved)
            }
        }
    }

    var selectedRows: [ChapterVerseRow] { verses.filter { selection.contains($0.verseNum) } }

    /// "John 3:16", "John 3:16-18", "John 3:16-18, 21"
    func selectionLabel(_ st: BibleState) -> String {
        guard !selection.isEmpty else { return "" }
        let runs = consecutiveVerseRuns(selection).map { run in
            run.lowerBound == run.upperBound ? "\(run.lowerBound)" : "\(run.lowerBound)-\(run.upperBound)"
        }
        return "\(referenceChapterLabel(st)):\(runs.joined(separator: ", "))"
    }

    private func referenceChapterLabel(_ st: BibleState) -> String {
        if Reference.isHermasBook(st.bookId) {
            return Reference.readerChapterLabel(st.bookId, st.chapter, textId: st.translation)
        }
        return "\(Reference.bookName(st.bookId)) \(Reference.displayChapterString(st.bookId, st.chapter))"
    }

    /// Consecutive verse runs → tag spans.
    func selectionRanges(_ st: BibleState) -> [TagRange] {
        let spans = consecutiveVerseRuns(selection).map { (Double($0.lowerBound), Double($0.upperBound)) }
        return [TagRange(bookId: st.bookId, chapter: Double(st.chapter), spans: spans)]
    }

    func copySelection(_ st: BibleState, plain: Bool) {
        guard let text = selectionText(st, plain: plain) else { return }
        Clipboard.copy(text)
        if !plain { confirmSelectionCopy(.verses) }
    }

    private func selectionText(_ state: BibleState, plain: Bool = false) -> String? {
        let rows = selectedRows
        guard !rows.isEmpty else { return nil }
        if plain { return rows.map { clipboardVerseText($0, state) }.joined(separator: " ") }
        return shareSelection(state, rows: rows).formattedText
    }

    private func shareSelection(_ state: BibleState, rows: [ChapterVerseRow]) -> SharedVerseSelection {
        SharedVerseSelection(reference: selectionLabel(state) + (state.translation == "lxx" ? " LXX" : ""),
                             rows: rows, textId: state.translation,
                             replacerEnabled: app.wordReplacerEnabled)
    }

    @ViewBuilder private func selectedVerseExportActions(_ state: BibleState) -> some View {
        let rows = selectedRows
        if !rows.isEmpty {
            let selection = shareSelection(state, rows: rows)
            Button("Save Verses as Text…", systemImage: "square.and.arrow.down") {
                NoteFileTransfer.export(selection.formattedText, suggestedName: selection.fileName,
                                        title: "Save Verses as Text", type: .plainText) { outcome in
                    if case .failed(let message) = outcome {
                        app.userMessage = "Could not save the verses. \(message)"
                    }
                }
            }
            ShareLink(item: selection, preview: SharePreview(selection.reference)) {
                Label("Share Verses…", systemImage: "square.and.arrow.up")
            }
        }
    }

    private func addNoteForSelection(_ state: BibleState) {
        guard !selectedRows.isEmpty else { return }
        let links: [String] = selection.count > 1 ? selectionRanges(state).flatMap { range in
            (range.spans ?? []).compactMap { start, end in
                let firstVerse = Int(start)
                let lastVerse = Int(end)
                let numbers = firstVerse == lastVerse ? "\(firstVerse)" : "\(firstVerse)-\(lastVerse)"
                let label = "\(referenceChapterLabel(state)):\(numbers)"
                let destination = "berean://verse/\(range.bookId)/\(Int(range.chapter))/\(numbers)?text=\(state.translation)"
                guard DeepLink.parse(destination) != nil,
                      availableTexts.contains(where: { $0.id == state.translation }) else { return nil }
                return "[\(label)](\(destination))"
            }
        } : []
        let attachment = selectionRanges(state).flatMap { range in
            (range.spans ?? []).map { start, end in
                let prefix = "\(range.bookId).\(Int(range.chapter)).\(Int(start))"
                return start == end ? prefix : "\(prefix)-\(Int(end))"
            }
        }.joined(separator: ",")
        app.newNote(verseRef: attachment,
                    textId: state.translation, title: selectionLabel(state), content: links.joined(separator: "\n\n"))
    }

    private func selectionReference(_ state: BibleState) -> String {
        referenceForCopy(selectionLabel(state), textId: state.translation)
    }


    private func selectionCopyButton(_ action: CopyAction, state: BibleState) -> some View {
        let copied = copiedAction == action
        let title = action == .verses ? "Copy Verses" : "Copy Reference"
        let symbol = action == .verses ? "doc.on.doc" : "number"
        return Button {
            let text = action == .verses ? selectionText(state) : selectionReference(state)
            guard let text, !text.isEmpty else { return }
            Clipboard.copy(text)
            confirmSelectionCopy(action)
        } label: {
            Label(title, systemImage: copied ? "checkmark" : symbol)
                .foregroundStyle(copied ? Color.accentColor : Color.primary)
        }
        .accessibilityValue(copied ? "Copied" : "")
    }

    private func confirmSelectionCopy(_ action: CopyAction) {
        copiedAction = action
        copyFeedbackID = UUID()
        AccessibilityNotification.Announcement(action == .verses ? "Verses copied" : "Reference copied").post()
    }

    @ViewBuilder func selectionBar(_ st: BibleState) -> some View {
        if !selection.isEmpty {
            adaptiveVerseActions(st)
                .padding(.horizontal, ReaderFloatingControls.surfaceHorizontalPadding)
                .padding(.vertical, ReaderFloatingControls.surfacePadding)
                #if os(macOS)
                .glassEffectCompat()
                #else
                .tint(.primary)
                // Keep Scripture glyphs from competing with the small symbols on the glass.
                .background(Color(uiColor: .systemBackground).opacity(0.78), in: .capsule)
                .glassEffectCompat(interactive: true)
                #endif
                .padding(.horizontal, 8)
                .padding(.bottom, ReaderFloatingControls.bottomPadding)
                #if os(iOS)
                // When the dock tucks away while scrolling, the verse actions settle into the space it frees.
                .offset(y: app.readerChromeHidden ? 52 : 0)
                #endif
                #if os(macOS)
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Selected \(selectionLabel(st))")
                #endif
                .task(id: copyFeedbackID) {
                    guard copiedAction != nil else { return }
                    do {
                        try await Task.sleep(for: .seconds(1))
                        if !Task.isCancelled { copiedAction = nil }
                    } catch is CancellationError {
                        // A newer copy restarts the confirmation.
                    } catch {
                        copiedAction = nil
                    }
                }
                .onChange(of: selection) { copiedAction = nil }
                .onDisappear { copiedAction = nil }
        }
    }

    @ViewBuilder private func adaptiveVerseActions(_ st: BibleState) -> some View {
        ViewThatFits(in: .horizontal) {
            verseActionRow(st)
            HStack(spacing: ReaderFloatingControls.actionSpacing) {
                selectionCopyButton(.verses, state: st)
                    .buttonStyle(VerseActionButtonStyle())
                    .verseActionHelp("Copy with reference (⌘C)")
                highlightMenu(st).verseActionHelp("Highlight")
                compactVerseMenu(st)
                clearSelectionButton
            }
            .fixedSize(horizontal: true, vertical: false)
            HStack(spacing: ReaderFloatingControls.actionSpacing) {
                Menu {
                    selectionCopyButton(.verses, state: st)
                    highlightMenu(st, iconOnly: false)
                    additionalVerseActions(st)
                } label: {
                    verseMenuLabel("Verse Actions", symbol: "ellipsis")
                }
                .modifier(VerseActionMenuChrome())
                clearSelectionButton
            }
            .fixedSize(horizontal: true, vertical: false)
        }
    }

    private func verseActionRow(_ st: BibleState) -> some View {
        HStack(spacing: ReaderFloatingControls.actionSpacing) {
            selectionCopyButton(.verses, state: st)
                .buttonStyle(VerseActionButtonStyle())
                .verseActionHelp("Copy with reference (⌘C)")
            highlightMenu(st).verseActionHelp("Highlight")
            Button("Tag Verses", systemImage: "tag") {
                tagging = (selectionRanges(st), selectionLabel(st), "verses")
            }
            .buttonStyle(VerseActionButtonStyle())
            .verseActionHelp("Tag verses")
            #if os(macOS)
            Divider().frame(height: 16)
            selectionCopyButton(.reference, state: st)
                .buttonStyle(VerseActionButtonStyle())
                .help("Copy selected verse reference")
            Button("Add Note", systemImage: "square.and.pencil") {
                addNoteForSelection(st)
            }
            .buttonStyle(VerseActionButtonStyle())
            .help("Add note")
            Button("Cross References", systemImage: "arrow.triangle.branch") {
                openInspector("crossrefs", verse: selectedVerse ?? selection.min(), selectedVerses: selection.sorted())
            }
            .buttonStyle(VerseActionButtonStyle())
            .help("Cross references")
            if !selectedRows.isEmpty {
                Menu {
                    selectedVerseExportActions(st)
                } label: {
                    verseMenuLabel("Export Selected Verses", symbol: "square.and.arrow.up")
                }
                .modifier(VerseActionMenuChrome())
                .help("Save or share selected verses")
            }
            #else
            compactVerseMenu(st, includesTag: false)
            #endif
            Divider().frame(height: 16).padding(.horizontal, 3)
            clearSelectionButton
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    private func compactVerseMenu(_ st: BibleState, includesTag: Bool = true) -> some View {
        Menu {
            additionalVerseActions(st, includesTag: includesTag)
        } label: {
            verseMenuLabel("More Verse Actions", symbol: "ellipsis")
        }
        .modifier(VerseActionMenuChrome())
        .verseActionHelp("More verse actions")
    }

    @ViewBuilder private func additionalVerseActions(_ st: BibleState, includesTag: Bool = true) -> some View {
        selectionCopyButton(.reference, state: st)
        #if os(iOS)
        if selectedRows.count == 1, let row = selectedRows.first {
            Button("All Verse Actions", systemImage: "list.bullet") {
                tappedVerse = TappedVerse(row: row)
            }
        }
        if selectedRows.count > 1, let row = selectedRows.first {
            Button("Notes for Selected Verses", systemImage: "note.text") {
                verseSheetDetent = .large
                tappedVerse = TappedVerse(row: row, notesSelection: Set(selectedRows.map(\.verseNum)))
            }
        }
        #endif
        if includesTag {
            Button("Tag Verses", systemImage: "tag") {
                tagging = (selectionRanges(st), selectionLabel(st), "verses")
            }
        }
        if !selectedRows.isEmpty {
            Button("Add Note", systemImage: "square.and.pencil") { addNoteForSelection(st) }
            Button("Cross References", systemImage: "arrow.triangle.branch") {
                openInspector("crossrefs", verse: selectedVerse ?? selection.min(), selectedVerses: selection.sorted())
            }
        }
        selectedVerseExportActions(st)
    }

    private func verseMenuLabel(_ title: String, symbol: String) -> some View {
        Label(title, systemImage: symbol)
            .foregroundStyle(.primary)
            .modifier(VerseActionControlAppearance())
    }

    private var clearSelectionButton: some View {
        Button("Clear Selection", systemImage: "xmark") { clearVerseSelection() }
            .buttonStyle(VerseActionButtonStyle())
            .accessibilityHint("Clears \(selectionLabel(state))")
            .foregroundStyle(.secondary)
            #if os(macOS)
            .keyboardShortcut(.cancelAction)
            .help("Clear selection (Esc)")
            #endif
    }

    private func clearVerseSelection() {
        selection = []
        anchor = nil
        selectedVerse = nil
        persistLocalSelection()
    }

    @ViewBuilder private func highlightMenu(_ st: BibleState, iconOnly: Bool = true) -> some View {
        let menu = Menu {
            ForEach(highlightColors, id: \.self) { color in
                Button(color.capitalized, systemImage: "circle.fill") {
                    for row in selectedRows {
                        try? app.highlights?.setVerseColor(bookId: row.bookId, chapter: row.chapter, verse: row.verseNum,
                                                          color: color, textId: st.translation)
                    }
                }
            }
            Divider()
            Button("Remove Highlights") {
                for row in selectedRows {
                    try? app.highlights?.remove(bookId: row.bookId, chapter: row.chapter, verse: row.verseNum,
                                                textId: st.translation)
                }
            }
        } label: {
            if iconOnly {
                verseMenuLabel("Highlight", symbol: "highlighter")
            } else {
                Label("Highlight", systemImage: "highlighter").labelStyle(.titleAndIcon)
            }
        }
        if iconOnly {
            menu.modifier(VerseActionMenuChrome())
        } else {
            menu
        }
    }

    #if os(iOS)
    @State private var pinchFontSize: Double?
    @ScaledMetric(relativeTo: .body) private var scriptureTypeScale = 1.0

    func iosReader(_ st: BibleState, actionClearance: CGFloat) -> some View {
        let rv = readerVerses(st)
        var style = readerStyle(st)
        let baseSize = pinchFontSize ?? style.fontSize
        style.fontSize = baseSize * scriptureTypeScale
        return IOSChapterTextView(
            passageId: "\(st.translation)|\(st.bookId)|\(st.chapter)",
            header: ChapterMap.versificationNote(st.bookId, st.chapter, textId: st.translation),
            chapterTags: chapterTags.map { ($0.name, $0.color, $0.colorSlot) },
            verses: rv,
            style: style,
            baseFontSize: baseSize,
            selectedVerses: selection.union(tappedVerse.map { [$0.row.verseNum] } ?? []),
            scrollTarget: scrollTarget,
            actionClearance: actionClearance,
            restorePosition: { app.restoreScripturePosition(tabId: tabId, edition: ChapterEdition(st)) },
            savePosition: { app.scriptureReadingPositions[tabId, default: [:]][chapterKey(st)] = $0 },
            findRequest: findRequest,
            reference: { first, last in
                let suffix = st.translation == "lxx" ? " LXX" : ""
                let label = Reference.bookChapterVerseLabel(st.bookId, chapter: st.chapter, verse: first, hermas: HermasText(textId: st.translation))
                return label + (first == last ? "" : "-\(last)") + suffix
            },
            onStrongs: { showLexicon($0) },
            onNotes: { openInspector("notes", verse: $0) },
            onVerseTap: { verseClick($0, shift: false) },
            onVerseActions: { number in
                if let row = verses.first(where: { $0.verseNum == number }) {
                    tappedVerse = TappedVerse(row: row)
                }
            },
            onTagClick: { name, verse in
                let tags = verse.map { verseTags[$0] ?? [] } ?? chapterTags
                if let tag = tags.first(where: { $0.name == name }) {
                    tappedTag = TappedTag(tag: tag, verse: verse)
                }
            },
            onHighlight: { piece, color in highlightRange(piece.verse, piece.start, piece.end, color, st, rv) },
            onStep: { step($0) },
            onPinchPreview: { pinchFontSize = $0 },
            onPinchCommit: { size in
                if app.fontSize != size { app.fontSize = size }
                pinchFontSize = nil
            },
            onChromeHidden: { hidden in withAnimation(.snappy(duration: 0.25)) { app.readerChromeHidden = hidden } },
            onSearchText: { app.openSearch($0, returningTo: tabId) },
            onLexiconSearch: { app.openLexiconSearch($0, newTab: true) },
            onBookSearch: { app.openBookSearch($0, bookId: st.bookId, textId: st.translation, returningTo: tabId) },
            bookName: Reference.bookName(st.bookId)
        )
        .sheet(item: $tappedVerse, onDismiss: {
            let action = afterVerseSheet
            afterVerseSheet = nil
            verseSheetCopyFeedback = nil
            verseSheetPath = []
            verseSheetDetent = Self.verseSheetCompactDetent
            action?()
        }) { item in
            NavigationStack(path: $verseSheetPath) {
                Group {
                    if !item.notesSelection.isEmpty {
                        VerseNotesView(bookId: item.row.bookId, chapter: item.row.chapter, verse: nil,
                                       textId: st.translation, selectedVerses: item.notesSelection,
                                       editInSheet: { verseSheetPath.append(.noteEditor($0)) })
                    } else {
                        verseSheetActions(item.row, st)
                    }
                }
                .navigationTitle(item.notesSelection.isEmpty
                    ? Reference.bookChapterVerseLabel(item.row.bookId, chapter: item.row.chapter, verse: item.row.verseNum,
                                                      hermas: HermasText(textId: st.translation))
                    : "Verse Notes")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { tappedVerse = nil } } }
                .navigationDestination(for: VerseSheetPage.self) { page in
                    switch page {
                    case .notes:
                        VerseNotesView(bookId: item.row.bookId, chapter: item.row.chapter, verse: item.row.verseNum,
                                       textId: st.translation, editInSheet: { verseSheetPath.append(.noteEditor($0)) })
                            .navigationTitle("Verse Notes")
                            .navigationBarTitleDisplayMode(.inline)
                    case .crossReferences:
                        CrossRefsView(bookId: item.row.bookId, chapter: item.row.chapter, verse: item.row.verseNum,
                                      textId: st.translation, performDestination: finishVerseSheet)
                            .navigationTitle("Cross References")
                            .navigationBarTitleDisplayMode(.inline)
                    case .noteEditor(let id):
                        NoteDetailView(noteId: id, performDestination: finishVerseSheet)
                    }
                }
            }
            .presentationDetents([Self.verseSheetCompactDetent, .large], selection: $verseSheetDetent)
            .presentationDragIndicator(.visible)
        }
        .sheet(item: $tappedTag) { item in
            NavigationStack {
                List { removeMenu(item.tag, bookId: st.bookId, chapter: st.chapter, verse: item.verse) }
                    .navigationTitle("#\(item.tag.name)")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { tappedTag = nil } } }
            }
            .presentationDetents([.medium, .large])
        }
    }

    private func verseSheetActions(_ row: ChapterVerseRow, _ st: BibleState) -> some View {
        List {
            Section("Highlight") { verseHighlightSwatches(row, st) }
            Section {
                HStack(spacing: 8) {
                    verseSheetShortcut("Notes", icon: "note.text", page: .notes)
                    verseSheetShortcut("Cross References", icon: "arrow.triangle.branch", page: .crossReferences)
                }
            }
            Section {
                verseActions(row, st, perform: finishVerseSheet)
            }
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    copy(row, st)
                    verseSheetCopyFeedback = UUID()
                    AccessibilityNotification.Announcement("Verse copied").post()
                } label: {
                    Label("Copy Verse", systemImage: verseSheetCopyFeedback == nil ? "doc.on.doc" : "checkmark")
                }
                .accessibilityValue(verseSheetCopyFeedback == nil ? "" : "Copied")
            }
        }
        .task(id: verseSheetCopyFeedback) {
            guard let feedback = verseSheetCopyFeedback else { return }
            try? await Task.sleep(for: .seconds(1.4))
            guard !Task.isCancelled, verseSheetCopyFeedback == feedback else { return }
            verseSheetCopyFeedback = nil
        }
    }
    #endif

    @ToolbarContentBuilder
    func toolbar(_ st: BibleState) -> some ToolbarContent {
        // History Back / Forward live in the window toolbar beside the sidebar button (MacRootView), for every tab type.
        // The passage pill: ‹ Book Chapter · Text › — previous / next chapter around the passage navigator.
        ToolbarItem(placement: .principal) {
            #if os(macOS)
            ControlGroup { passageControls(st) }
                .controlGroupStyle(.navigation)
                .popover(isPresented: $pickerShown, arrowEdge: .bottom) { picker(st, compact: false) }
            #else
            HStack(spacing: 4) { passageControls(st) }
                .buttonStyle(.interactivePlain)
                .padding(.horizontal, 8)
                .glassEffectCompat(interactive: true)
                // Tucked away while reading downward (fades and lifts; the nav bar keeps its height so text never jumps).
                .opacity(app.readerChromeHidden ? 0 : 1)
                .offset(y: app.readerChromeHidden ? -12 : 0)
                .allowsHitTesting(!app.readerChromeHidden)
                .sheet(isPresented: $pickerShown) {
                    NavigationStack {
                        picker(st, compact: true)
                            .navigationTitle("Go to")
                            .navigationBarTitleDisplayMode(.inline)
                            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { pickerShown = false } } }
                    }
                    .presentationDetents([.large])
                }
            #endif
        }
        #if os(macOS)
        let hasText = st.compareMode || (loadedChapter == chapterKey(st) && !verses.isEmpty)
        ToolbarItemGroup {
            Button("Scripture Display", systemImage: "textformat.size") {
                displayOptionsShown.toggle()
            }
            .pointerStyle(.link)
            .help("Adjust Scripture font, spacing and width")
            .popover(isPresented: $displayOptionsShown, arrowEdge: .bottom) {
                Form { ScriptureDisplayOptions(); ScriptureAnnotationOptions() }
                    .formStyle(.grouped)
                    .frame(width: 360)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !st.compareMode, let target = alternateEdition, target == ChapterEdition(st).counterpart {
                Toggle(isOn: Binding(get: { ChapterMap.isLxx(st.translation) }, set: { _ in
                    let source = ChapterEdition(st)
                    if target.counterpart == source { alternateEdition = source }
                    app.switchChapterEdition(in: tabId, from: source, to: target)
                })) {
                    Label("LXX", systemImage: "arrow.left.arrow.right")
                }
                .pointerStyle(.link)
                .help("Switch to \(textInfo(target.text).name)")
            }
            Button("Tag Chapter", systemImage: "tag") {
                let target = ChapterTagTarget(st)
                tagging = (target.ranges, target.label, "chapter")
            }
            .pointerStyle(.link)
            .help("Tag this chapter")
            .disabled(!hasText)
            Toggle(isOn: Binding(get: { st.compareMode }, set: { v in mutate { $0.compareMode = v } })) { Label("Compare", systemImage: "rectangle.split.2x1") }
                .pointerStyle(.link)
                .keyboardShortcut("c", modifiers: [.command, .option]).help("Compare texts side by side (⌥⌘C)")
            Toggle(isOn: Binding(get: { st.showStrongs }, set: { v in mutate { $0.showStrongs = v } })) { Label("Strong's Numbers", systemImage: "number") }
                .pointerStyle(.link)
                .help("Show Strong's numbers")
            Toggle(isOn: Binding(get: { st.rightPanelOpen }, set: { v in mutate { $0.rightPanelOpen = v } })) { Label("Study Panel", systemImage: "sidebar.trailing") }
                .pointerStyle(.link)
                .keyboardShortcut("i", modifiers: [.command, .option]).help("Study panel: notes, lexicon, cross references (⌥⌘I)")
        }
        ToolbarItem {
            Menu {
                ChapterExportActions(state: st, hasText: hasText)
            } label: {
                Label("Chapter Export", systemImage: "square.and.arrow.up")
            }
            .menuIndicator(.hidden)
            .pointerStyle(.link)
            .help("Copy or share the chapter")
        }
        #endif
    }

    @ViewBuilder private func passageControls(_ st: BibleState) -> some View {
        Button { step(-1) } label: { passageArrow("Previous Chapter", "chevron.backward") }
            .keyboardShortcut(.leftArrow, modifiers: [.command, .option]).help("Previous chapter (⌥⌘←)")
            #if os(macOS)
            .pointerStyle(canStep(-1, from: st) ? .link : .default)
            #endif
            .disabled(!canStep(-1, from: st))
        Button { pickerShown.toggle() } label: {
            HStack(spacing: 5) {
                Text(Reference.readerChapterLabel(st.bookId, st.chapter, textId: st.translation))
                    .fontWeight(.semibold)
                    .lineLimit(1)
                #if os(iOS)
                if ChapterMap.isLxx(st.translation) {
                    Text("LXX").font(.caption.weight(.medium)).foregroundStyle(.secondary)
                }
                #else
                Text(textInfo(st.translation).short)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                #endif
            }
            #if os(iOS)
            .padding(.horizontal, 4)
            .frame(minHeight: 44)
            .contentShape(.rect)
            #endif
        }
        #if os(macOS)
        .pointerStyle(.link)
        #endif
        .accessibilityLabel("\(Reference.readerChapterLabel(st.bookId, st.chapter, textId: st.translation)), \(textInfo(st.translation).name). Choose passage or text")
        .help("Choose book, chapter or text — search every text, see history (⌘L)")
        Button { step(1) } label: { passageArrow("Next Chapter", "chevron.forward") }
            .keyboardShortcut(.rightArrow, modifiers: [.command, .option]).help("Next chapter (⌥⌘→)")
            #if os(macOS)
            .pointerStyle(canStep(1, from: st) ? .link : .default)
            #endif
            .disabled(!canStep(1, from: st))
    }

    @ViewBuilder private func passageArrow(_ title: String, _ symbol: String) -> some View {
        #if os(iOS)
        Label(title, systemImage: symbol)
            .labelStyle(.iconOnly)
            .font(.body.weight(.semibold))
            .frame(width: 44, height: 44)
            .contentShape(.rect)
        #else
        Label(title, systemImage: symbol)
        #endif
    }

    func picker(_ st: BibleState, compact: Bool) -> some View {
        PassagePicker(textId: st.translation, currentBook: st.bookId, currentChapter: st.chapter, onPick: { passage in
            mutate(passage: passage) {
                $0.translation = passage.textId
                $0.bookId = passage.bookId
                $0.chapter = passage.chapter
                $0.verse = passage.verse
                $0.endVerse = passage.endVerse
            }
            pickerShown = false
        }, compact: compact, onPreview: compact ? { passage in
            mutate(passage: passage) {
                $0.translation = passage.textId
                $0.bookId = passage.bookId
                $0.chapter = passage.chapter
                $0.verse = nil
                $0.endVerse = nil
            }
        } : nil)
    }

    func mutate(recordHistory: Bool = true, passage: ResolvedPassage? = nil, _ f: (inout BibleState) -> Void) {
        var visited: BibleState?
        app.update(tabId, recordHistory: recordHistory) { t in
            let before = BibleState(t.state)
            var s = before; f(&s)
            t.state = s.merged(into: t.state)
            if let passage { t.state["nativeSelectedVerses"] = passage.savedSelection }
            t.title = Reference.readerChapterLabel(s.bookId, s.chapter, textId: s.translation)
            if recordHistory, s.bookId != before.bookId || s.chapter != before.chapter
                || s.translation != before.translation || s.verse != before.verse || s.endVerse != before.endVerse {
                visited = s
            }
        }
        if let passage {
            app.recordRecent(textId: passage.textId, bookId: passage.bookId, chapter: passage.chapter,
                             verse: passage.verse, endVerse: passage.endVerse, verseGroups: passage.verseGroups)
        } else if let v = visited { app.recordRecent(textId: v.translation, bookId: v.bookId, chapter: v.chapter, verse: v.verse, endVerse: v.endVerse) }
    }

    /// Previous / next chapter by the chapters the book really has (prologue chapter 0, gaps, Hermas numbering), then the
    /// neighbouring book — like bibleNav.ts getPrev/NextChapterRef, generalised from the actual chapter list.
    func step(_ delta: Int) {
        chapterStepTask?.cancel()
        guard let source = app.findTab(tabId), app.activeTab?.id == tabId else { return }
        let reader = BibleState(source.state)
        guard canStep(delta, from: reader) else { return }
        chapterStepTask = Task {
            let chapters = await app.bible.chapterNumbers(reader.bookId, textId: reader.translation)
            guard !Task.isCancelled else { return }
            let book: String
            let chapter: Int
            if let index = chapters.firstIndex(of: reader.chapter), chapters.indices.contains(index + delta) {
                book = reader.bookId
                chapter = chapters[index + delta]
            } else {
                let books = await app.books(for: reader.translation)
                guard !Task.isCancelled, let index = books.firstIndex(where: { $0.id == reader.bookId }),
                      books.indices.contains(index + delta) else { return }
                book = books[index + delta].id
                let list = await app.bible.chapterNumbers(book, textId: reader.translation)
                guard let destination = delta > 0 ? list.first : list.last else { return }
                chapter = destination
            }
            guard !Task.isCancelled, let current = app.activeTab, current.id == source.id else { return }
            let destination = BibleState(current.state)
            guard ChapterEdition(destination) == ChapterEdition(reader),
                  destination.compareMode == reader.compareMode,
                  destination.verse == reader.verse, destination.endVerse == reader.endVerse,
                  current.state["nativeSelectedVerses"] == source.state["nativeSelectedVerses"] else { return }
            mutate { $0.bookId = book; $0.chapter = chapter; $0.verse = nil; $0.endVerse = nil }
        }
    }

    #if os(iOS)
    private func finishVerseSheet(_ action: @escaping () -> Void) {
        afterVerseSheet = action
        tappedVerse = nil
    }

    private func verseSheetShortcut(_ title: String, icon: String, page: VerseSheetPage) -> some View {
        Button {
            verseSheetDetent = .large
            verseSheetPath.append(page)
        } label: {
            Label(title, systemImage: icon)
                .font(.subheadline.weight(.medium))
                .frame(maxWidth: .infinity, minHeight: 44)
                .contentShape(.rect)
        }
        .buttonStyle(.interactivePlain)
    }

    private func verseHighlightSwatches(_ verse: ChapterVerseRow, _ state: BibleState) -> some View {
        let marks = highlights[verse.verseNum] ?? []
        let current = marks.last { $0.startChar == nil && $0.startWord == nil }?.color
        return LazyVGrid(columns: [GridItem(.adaptive(minimum: 44), spacing: 0)], spacing: 4) {
            ForEach(highlightColors, id: \.self) { color in
                Button {
                    app.attempt("Couldn’t highlight the verse") {
                        try app.highlights?.setVerseColor(bookId: verse.bookId, chapter: verse.chapter,
                                                          verse: verse.verseNum, color: color, textId: state.translation)
                    }
                } label: {
                    Circle()
                        .fill(Color.highlight(color).opacity(0.72))
                        .frame(width: 26, height: 26)
                        .overlay {
                            if current == color {
                                Image(systemName: "checkmark").font(.caption.weight(.bold)).foregroundStyle(.black)
                            }
                        }
                        .frame(minWidth: 44, minHeight: 44)
                        .contentShape(.rect)
                }
                .buttonStyle(.interactivePlain)
                .accessibilityLabel("\(color.capitalized) highlight")
                .accessibilityAddTraits(current == color ? .isSelected : [])
            }
            Button {
                app.attempt("Couldn’t remove the verse highlights") {
                    try app.highlights?.remove(bookId: verse.bookId, chapter: verse.chapter,
                                               verse: verse.verseNum, textId: state.translation)
                }
            } label: {
                Image(systemName: "eraser")
                    .frame(minWidth: 44, minHeight: 44)
                    .contentShape(.rect)
            }
            .buttonStyle(.interactivePlain)
            .disabled(marks.isEmpty)
            .accessibilityLabel("Remove highlights")
        }
    }

    /// The iPhone verse sheet's actions below the highlight palette.
    @ViewBuilder func verseActions(_ v: ChapterVerseRow, _ st: BibleState,
                                    perform: @escaping (@escaping () -> Void) -> Void = { $0() }) -> some View {
        let label = Reference.bookChapterVerseLabel(v.bookId, chapter: v.chapter, verse: v.verseNum, hermas: HermasText(textId: st.translation))
        ShareLink(item: verseWithReference(v, st)) {
            Label("Share Verse…", systemImage: "square.and.arrow.up")
        }
        Button("Copy Reference", systemImage: "number") {
            perform { Clipboard.copy(referenceForCopy(label, textId: st.translation)) }
        }
        Button("Tag Verse…") {
            perform {
                tagging = ([TagRange(bookId: v.bookId, chapter: Double(v.chapter), spans: [(Double(v.verseNum), Double(v.verseNum))])], label, "verses")
            }
        }
        Button("Tag Chapter…") {
            perform {
                tagging = ([TagRange(bookId: v.bookId, chapter: Double(v.chapter), whole: true)], Reference.readerChapterLabel(v.bookId, v.chapter, textId: st.translation), "chapter")
            }
        }
        Button("Add Note") { perform { app.newNote(verseRef: "\(v.bookId).\(v.chapter).\(v.verseNum)", textId: st.translation) } }
        Button("Compare This Verse") { perform { mutate { $0.verse = v.verseNum; $0.endVerse = nil; $0.compareMode = true } } }
        Button("Open in New Tab") { perform { app.openScripture(bookId: v.bookId, chapter: v.chapter, verse: v.verseNum, textId: st.translation) } }
    }
    #endif

    /// A chip's menu: remove the tag group(s) that cover this verse (or chapter).
    @ViewBuilder func removeMenu(_ tag: TagLite, bookId: String, chapter: Int, verse: Int?) -> some View {
        let members = ((try? app.verseTags?.members([tag.id])) ?? []).filter { m in
            verse.map { v in m.verses.contains { $0.bookId == bookId && $0.chapter == chapter && $0.verse == v } }
                ?? m.wholeChapters.contains { $0.bookId == bookId && $0.chapter == chapter }
        }
        ForEach(members) { m in
            Button("Remove “\(m.label)” from #\(tag.name)", role: .destructive) { app.attempt("Couldn’t remove the verse from the tag") { try app.verseTags?.removeMember(m.memberId) } }
        }
        Button("Search #\(tag.name)") { app.openSearch("#\(tag.name)", reuseTab: true) }
    }

    func showLexicon(_ id: String) {
        let reader = state
        app.inspectStrongs(id, in: tabId, bookId: reader.bookId, chapter: reader.chapter)
    }
    func openInspector(_ tab: String, verse: Int? = nil, selectedVerses: [Int] = []) {
        if tab == "crossrefs" || tab == "notes" {
            app.focusStudyVerse(verse, in: tabId, selectedVerses: selectedVerses)

        }
        mutate(recordHistory: false) {
            #if os(macOS)
            if tab == "notes", let layout = ScriptureLayout(rawValue: $0.scriptureLayout), !layout.showsNotes {
                $0.scriptureLayout = ScriptureLayout.standard.rawValue
            }
            if tab == "crossrefs", let layout = ScriptureLayout(rawValue: $0.scriptureLayout) {
                switch layout {
                case .reading, .scriptureFocus, .notesBottom, .compareNotes, .notesTop, .commentary, .tripleCol, .splitBottom:
                    $0.scriptureLayout = ScriptureLayout.standard.rawValue
                default:
                    break
                }
            }
            #endif
            $0.rightPanelOpen = true
            $0.rightPanelTab = tab
        }
    }

    private func clipboardVerseText(_ verse: ChapterVerseRow, _ state: BibleState) -> String {
        VerseDisplay.text(verse.text, tagged: verse.textTagged, textId: state.translation,
                          replacerEnabled: app.wordReplacerEnabled, rules: WordReplacer.defaultRules)
    }

    private func verseWithReference(_ verse: ChapterVerseRow, _ state: BibleState) -> String {
        let label = Reference.bookChapterVerseLabel(verse.bookId, chapter: verse.chapter,
                                                    verse: verse.verseNum, hermas: HermasText(textId: state.translation))
        let suffix = state.translation == "lxx" ? " LXX" : ""
        return "\(label)\(suffix) \(clipboardVerseText(verse, state))"
    }

    func copy(_ verse: ChapterVerseRow, _ state: BibleState) {
        Clipboard.copy(verseWithReference(verse, state))
    }
}

let highlightColors = ["yellow", "red", "green", "blue", "purple"]

extension Color {
    static func highlight(_ name: String) -> Color {
        switch name { case "red": return .red; case "green": return .green; case "blue": return .blue; case "purple": return .purple; case "orange": return .orange; default: return .yellow }
    }
}

private func displayedHighlightRanges(_ highlights: [Highlight], words: [String], original: String) -> [ReaderVerse.Mark] {
    var offset = 0
    let bounds = words.map { word in
        let start = offset
        offset += word.utf16.count + 1
        return start..<(offset - 1)
    }
    let shown = words.joined(separator: " ")
    return highlights.compactMap { highlight in
        if let start = highlight.startChar, let end = highlight.endChar {
            let mapped = OffsetMap.originalToDisplay(display: shown, original: original, offsets: [start, end])
            guard mapped[0] < mapped[1] else { return nil }
            return .init(start: mapped[0], end: mapped[1], color: highlight.color)
        }
        guard let start = highlight.startWord, bounds.indices.contains(start) else { return nil }
        let end = min(highlight.endWord ?? start, bounds.count - 1)
        guard end >= start, bounds[start].lowerBound < bounds[end].upperBound else { return nil }
        return .init(start: bounds[start].lowerBound, end: bounds[end].upperBound, color: highlight.color)
    }
}

struct VerseRowView: View {
    let row: ChapterVerseRow
    let textId: String
    let showStrongs: Bool
    var highlights: [Highlight] = []
    var fontSize: Double = 16
    var lineSpacing: CGFloat = 5
    var replacer = true
    var family = "system"
    @AppStorage("showRedLetters") private var showRedLetters = true

    var body: some View {
        Text(attributed)
            .font(ScriptureFont.font(family, size: fontSize))
            .lineSpacing(lineSpacing)
            .textSelection(.enabled)
            .padding(.vertical, 2)
    }

    private func markedText(_ shown: String, wholeTint: Color?) -> AttributedString {
        var text = AttributedString(shown)
        text.backgroundColor = wholeTint
        let words = shown.components(separatedBy: " ")
        for mark in displayedHighlightRanges(highlights, words: words, original: row.text) {
            guard let range = Range(NSRange(location: mark.start, length: mark.end - mark.start), in: shown),
                  let lower = AttributedString.Index(range.lowerBound, within: text),
                  let upper = AttributedString.Index(range.upperBound, within: text) else { continue }
            text[lower..<upper].backgroundColor = Color.highlight(mark.color).opacity(0.35)
        }
        return text
    }

    var attributed: AttributedString {
        var out = AttributedString()
        if let title = row.title, !title.isEmpty {
            var t = AttributedString(title + "\n"); t.font = .callout.italic(); t.foregroundColor = .secondary
            out = t + out
        }
        let rules = replacer ? WordReplacer.defaultRules : []
        let wholeTint = highlights.last { $0.startChar == nil && $0.startWord == nil }.map { Color.highlight($0.color).opacity(0.22) }
        guard let tagged = row.textTagged, !tagged.isEmpty, textId == "kjva" || textId == "lxx" else {
            let shown = VerseDisplay.text(row.text, tagged: nil, textId: textId, replacerEnabled: replacer, rules: rules)
            return out + markedText(shown, wholeTint: wholeTint)
        }
        let rendered = VerseDisplay.renderTokens(row.text, tagged: tagged, textId: textId, replacerEnabled: replacer, rules: rules)
        let words: [(String, Bool, Bool, [String])] = rendered.map { t in
            let nums: [String] = { switch t.strongs { case .none: return []; case .one(let s): return [s]; case .many(let a): return a } }()
            return (t.word, t.isItalic, t.isRedLetter, nums)
        }
        let ranges = displayedHighlightRanges(highlights, words: words.map(\.0), original: row.text)
        var pos = 0
        for (i, w) in words.enumerated() {
            if i > 0 {
                var space = AttributedString(" ")
                space.backgroundColor = ranges.last { $0.start <= pos && pos < $0.end }.map { Color.highlight($0.color).opacity(0.35) } ?? wholeTint
                out += space
                pos += 1
            }
            let units = Array(w.0.utf16)
            var k = 0
            while k < units.count {
                let p = pos + k
                let hit = ranges.last { $0.start <= p && p < $0.end }
                var j = k + 1
                while j < units.count, (ranges.last { $0.start <= pos + j && pos + j < $0.end })?.color == hit?.color { j += 1 }
                var a = AttributedString(String(decoding: units[k..<j], as: UTF16.self))
                if w.1 { a.font = ScriptureFont.font(family, size: fontSize).italic() }
                if w.2 && showRedLetters { a.foregroundColor = .red }
                a.backgroundColor = hit.map { Color.highlight($0.color).opacity(0.35) } ?? wholeTint
                out += a
                k = j
            }
            pos += units.count
            if showStrongs && !w.3.isEmpty {
                for (k, n) in w.3.enumerated() {
                    let id = n.trimmingCharacters(in: CharacterSet(charactersIn: "()"))
                    var chip = AttributedString((k > 0 ? " " : "") + id)
                    chip.font = .system(.caption2, design: .rounded)
                    chip.foregroundColor = .secondary
                    chip.baselineOffset = 6
                    chip.link = URL(string: "strongs:\(id)")
                    out += chip
                }
            }
        }
        return out
    }
}

extension View {
    /// Liquid Glass capsule on current systems.
    func glassEffectCompat(interactive: Bool = false) -> some View {
        modifier(ReaderGlassCapsule(interactive: interactive))
    }

    /// macOS: the passage pill and text button already say where the reader is, so the window title is kept for the
    /// Window menu / Mission Control but not drawn in the toolbar (as in the existing app's toolbar).
    @ViewBuilder func navigationSubtitleCompat(_ s: String) -> some View {
        #if os(macOS)
        self.navigationSubtitle(s).toolbar(removing: .title)
        #else
        self
        #endif
    }
}

enum Clipboard {
    static func copy(_ s: String) {
        #if os(macOS)
        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(s, forType: .string)
        #else
        UIPasteboard.general.string = s
        #endif
    }
}

extension ScriptureView {
    func readerVerses(_ st: BibleState) -> [ReaderVerse] {
        let rules = app.wordReplacerEnabled ? WordReplacer.defaultRules : []
        return verses.map { v in
            var words: [ReaderVerse.Word]
            if let tagged = v.textTagged, !tagged.isEmpty, st.translation == "kjva" || st.translation == "lxx" {
                words = VerseDisplay.renderTokens(v.text, tagged: tagged, textId: st.translation, replacerEnabled: app.wordReplacerEnabled, rules: rules).map { t in
                    let nums: [String] = { switch t.strongs { case .none: return []; case .one(let s): return [s]; case .many(let a): return a } }()
                    return .init(text: t.word, italic: t.isItalic, red: t.isRedLetter, strongs: nums)
                }
            } else {
                let plain = VerseDisplay.text(v.text, tagged: nil, textId: st.translation, replacerEnabled: app.wordReplacerEnabled, rules: rules)
                words = plain.split(separator: " ", omittingEmptySubsequences: false).map { .init(text: String($0), italic: false, red: false, strongs: []) }
            }
            let marks = displayedHighlightRanges(highlights[v.verseNum] ?? [], words: words.map(\.text), original: v.text)
            let whole = highlights[v.verseNum]?.last { $0.startChar == nil && $0.startWord == nil }
            var rendered = ReaderVerse(verse: v.verseNum, title: v.title, words: words, marks: marks, tint: whole?.color, noteCount: noteCounts[v.verseNum] ?? 0,
                                       tags: (verseTags[v.verseNum] ?? []).map { ($0.name, $0.color, $0.colorSlot) })
            #if os(macOS)
            if v.verseNum > 0, let verseCitations, verseCitations.key == chapterKey(st),
               let links = verseCitations.links[v.verseNum], !links.isEmpty {
                rendered.citationCount = links.count
                rendered.citationPreview = links.prefix(4).map { link in
                    let passage = ResolvedPassage(textId: link.textId, bookId: link.bookId, chapter: link.chapter,
                                                  verse: link.verse, endVerse: link.endVerse)
                    let title = link.note.title.isEmpty ? "Untitled" : link.note.title
                    return "\(passage.label) · \(title)"
                }.joined(separator: "\n")
            }
            #endif
            return rendered
        }
    }

    func readerStyle(_ st: BibleState) -> ReaderStyle {
        ReaderStyle(fontSize: app.fontSize, lineSpacing: app.lineSpacing, family: app.scriptureFontFamily,
                    showStrongs: st.showStrongs, showVerseNumbers: showVerseNumbers, redLetters: showRedLetters, width: scriptureWidth)
    }

    /// Partial highlight: shown-word offsets → offsets into the stored verse text (OffsetMap), saved as a character highlight.
    func highlightRange(_ verse: Int, _ a: Int, _ b: Int, _ color: String, _ st: BibleState, _ rv: [ReaderVerse]) {
        guard let row = verses.first(where: { $0.verseNum == verse }), let shown = rv.first(where: { $0.verse == verse })?.displayText else { return }
        let o = OffsetMap.displayToOriginal(display: shown, original: row.text, offsets: [a, b])
        guard o.count == 2, o[1] > o[0] else { return }
        _ = try? app.highlights?.toggle(bookId: row.bookId, chapter: row.chapter, verse: verse, color: color, textId: st.translation, startChar: o[0], endChar: o[1])
    }

}

#if os(macOS)
import AppKit

extension ScriptureView {
    /// The continuous TextKit reader (cross-verse selection, clickable verse numbers / Strong's / tags).
    func macReader(_ st: BibleState, actionClearance: CGFloat) -> some View {
        let rv = readerVerses(st)
        let header = ChapterMap.versificationNote(st.bookId, st.chapter, textId: st.translation).map { [$0] } ?? []
        let suffix = st.translation == "lxx" ? " LXX" : ""
        return ChapterTextView(
            passageId: "\(st.translation)|\(st.bookId)|\(st.chapter)",
            header: header, chapterTags: chapterTags.map { ($0.name, $0.color, $0.colorSlot) }, verses: rv,
            style: readerStyle(st),
            selectedVerses: selection, scrollTarget: scrollTarget,
            actionClearance: actionClearance,
            restorePosition: { app.restoreScripturePosition(tabId: tabId, edition: ChapterEdition(st)) },
            savePosition: { app.scriptureReadingPositions[tabId, default: [:]][chapterKey(st)] = $0 },
            selectedVerseCopyText: { plain in selectionText(st, plain: plain) },
            rangeReference: { a, b in "\(referenceChapterLabel(st)):\(a)\(a == b ? "" : "-\(b)")\(suffix)" },
            verseMenu: { verseNSMenu($0, st) },
            tagMenu: { name, v in tagNSMenu(name, verse: v, st) },
            strongsTooltips: st.showStrongs ? strongsTooltips : [:],
            onStrongs: { showLexicon($0) },
            onNotes: { openInspector("notes", verse: $0) },
            onCitations: { verse in
                crossRefSource = "notes"
                openInspector("crossrefs", verse: verse)
            },
            onVerseClick: { v, shift in verseClick(v, shift: shift) },
            onCopySelectedVerses: { confirmSelectionCopy(.verses) },
            onHighlightRange: { verse, a, b, color in highlightRange(verse, a, b, color, st, rv) },
            onSearchSelection: { app.openSearch($0, returningTo: tabId) },
            onBookSearch: { app.openBookSearch($0, bookId: st.bookId, textId: st.translation, returningTo: tabId) },
            bookName: Reference.bookName(st.bookId),
            onLexiconSearch: { app.openLexiconSearch($0, newTab: true) })
            .task(id: strongsIDs(in: rv, enabled: st.showStrongs)) {
                let ids = strongsIDs(in: rv, enabled: st.showStrongs)
                var next: [String: String] = [:]
                for id in ids.sorted() {
                    guard !Task.isCancelled else { return }
                    if let cached = strongsTooltips[id] {
                        next[id] = cached
                    } else if let entry = await app.lexicon.entry(id) {
                        let word = [entry.lemma, entry.transliteration].filter { !$0.isEmpty }.joined(separator: " · ")
                        next[id] = [id, word, entry.gloss].filter { !$0.isEmpty }.joined(separator: "\n")
                    }
                }
                guard !Task.isCancelled else { return }
                strongsTooltips = next
            }

    }

    private func strongsIDs(in verses: [ReaderVerse], enabled: Bool) -> Set<String> {
        guard enabled else { return [] }
        return Set(verses.flatMap { verse in
            verse.words.flatMap { word in
                word.strongs.map { $0.trimmingCharacters(in: CharacterSet(charactersIn: "()")) }
            }
        })
    }

    func verseNSMenu(_ n: Int, _ st: BibleState) -> NSMenu {
        let m = NSMenu()
        guard let v = verses.first(where: { $0.verseNum == n }) else { return m }
        let label = Reference.bookChapterVerseLabel(v.bookId, chapter: v.chapter, verse: v.verseNum, hermas: HermasText(textId: st.translation))
        let header = NSMenuItem(title: label, action: nil, keyEquivalent: ""); header.isEnabled = false
        m.addItem(header)
        if selection.count > 1, selection.contains(n) {
            m.addItem(ClosureMenuItem("Copy \(selectionLabel(st))", image: "doc.on.doc") { copySelection(st, plain: false) })
            m.addItem(ClosureMenuItem("Copy Selection Reference", image: "number") { Clipboard.copy(selectionReference(st)) })
            m.addItem(ClosureMenuItem("Tag \(selectionLabel(st))…", image: "tag") { tagging = (selectionRanges(st), selectionLabel(st), "verses") })
            m.addItem(.separator())
        }
        m.addItem(ClosureMenuItem(selection.contains(n) ? "Deselect Verse" : "Select Verse", image: "checkmark.circle") { verseClick(n, shift: false) })
        m.addItem(ClosureMenuItem("Copy Verse", image: "doc.on.doc") { copy(v, st) })
        m.addItem(ClosureMenuItem("Copy Reference", image: "number") { Clipboard.copy(referenceForCopy(label, textId: st.translation)) })
        let hl = NSMenuItem(title: "Highlight", action: nil, keyEquivalent: ""); hl.image = NSImage(systemSymbolName: "highlighter", accessibilityDescription: nil)
        let sub = NSMenu()
        for c in highlightColors { sub.addItem(ClosureMenuItem(c.capitalized) { try? app.highlights?.setVerseColor(bookId: v.bookId, chapter: v.chapter, verse: v.verseNum, color: c, textId: st.translation) }) }
        sub.addItem(.separator())
        sub.addItem(ClosureMenuItem("Remove Highlights") { try? app.highlights?.remove(bookId: v.bookId, chapter: v.chapter, verse: v.verseNum, textId: st.translation) })
        hl.submenu = sub; m.addItem(hl)
        m.addItem(ClosureMenuItem("Tag Verse…", image: "tag") {
            tagging = ([TagRange(bookId: v.bookId, chapter: Double(v.chapter), spans: [(Double(v.verseNum), Double(v.verseNum))])], label, "verses")
        })
        m.addItem(ClosureMenuItem("Tag Chapter…") {
            tagging = ([TagRange(bookId: v.bookId, chapter: Double(v.chapter), whole: true)], Reference.readerChapterLabel(v.bookId, v.chapter, textId: st.translation), "chapter")
        })
        m.addItem(.separator())
        m.addItem(ClosureMenuItem("Add Note", image: "square.and.pencil") { app.newNote(verseRef: "\(v.bookId).\(v.chapter).\(v.verseNum)", textId: st.translation) })
        m.addItem(ClosureMenuItem("Verse Notes") { openInspector("notes", verse: v.verseNum) })
        m.addItem(ClosureMenuItem("Cross References", image: "arrow.triangle.branch") { openInspector("crossrefs", verse: v.verseNum) })
        m.addItem(.separator())
        m.addItem(ClosureMenuItem("Compare This Verse", image: "rectangle.split.2x1") { selection = [v.verseNum]; anchor = v.verseNum; mutate { $0.verse = v.verseNum; $0.endVerse = nil; $0.compareMode = true } })
        m.addItem(ClosureMenuItem("Open in New Tab") { app.openScripture(bookId: v.bookId, chapter: v.chapter, verse: v.verseNum, textId: st.translation) })
        return m
    }

    func tagNSMenu(_ name: String, verse: Int?, _ st: BibleState) -> NSMenu {
        let m = NSMenu()
        if let tag = (try? app.verseTags?.list())?.first(where: { $0.name == name }) {
            let members = ((try? app.verseTags?.members([tag.id])) ?? []).filter { mem in
                verse.map { v in mem.verses.contains { $0.bookId == st.bookId && $0.chapter == st.chapter && $0.verse == v } }
                    ?? mem.wholeChapters.contains { $0.bookId == st.bookId && $0.chapter == st.chapter }
            }
            for mem in members { m.addItem(ClosureMenuItem("Remove “\(mem.label)” from #\(name)") { app.attempt("Couldn’t remove the verse from the tag") { try app.verseTags?.removeMember(mem.memberId) } }) }
        }
        m.addItem(ClosureMenuItem("Search #\(name)", image: "magnifyingglass") { app.openSearch("#\(name)", reuseTab: true) })
        return m
    }
}
#endif


private extension View {
    @ViewBuilder func verseActionHelp(_ title: String) -> some View {
        #if os(macOS)
        help(title)
        #else
        self
        #endif
    }
}

private struct ReaderGlassCapsule: ViewModifier {
    let interactive: Bool
    #if os(iOS)
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    #endif

    func body(content: Content) -> some View {
        #if os(iOS)
        if verticalSizeClass == .compact {
            content.background(.regularMaterial, in: .capsule)
        } else if #available(iOS 26, *) {
            content.glassEffect(.regular.interactive(interactive), in: .capsule)
        } else {
            content.background(.regularMaterial, in: .capsule)
        }
        #else
        if #available(macOS 26, *) {
            content.glassEffect(.regular.interactive(interactive), in: .capsule)
        } else {
            content.background(.regularMaterial, in: .capsule)
        }
        #endif
    }
}

enum ReaderFloatingControls {
    #if os(macOS)
    static let actionSpacing: CGFloat = 4
    static let surfaceHorizontalPadding: CGFloat = 8
    static let actionWidth: CGFloat = 38
    static let actionHeight: CGFloat = 32
    static let readerDockClearance: CGFloat = 0
    #else
    static let actionSpacing: CGFloat = 2
    static let surfaceHorizontalPadding: CGFloat = 5
    static let actionWidth: CGFloat = 44
    static let actionHeight: CGFloat = 44
    // The root dock overlays this explicitly sized TextKit viewport.
    static let readerDockClearance: CGFloat = 58
    #endif

    static let surfacePadding: CGFloat = 3
    static let bottomPadding: CGFloat = 8
    static let outlinePadding: CGFloat = 3
    static let outlineRadius: CGFloat = 9
    static let outlineOpacity: CGFloat = 0.75
    static let fillOpacity: CGFloat = 0.06
    static let readingGap: CGFloat = outlinePadding + 5
    static var selectionHeight: CGFloat { actionHeight + 2 * surfacePadding + bottomPadding }
}

private struct VerseActionMenuChrome: ViewModifier {
    func body(content: Content) -> some View {
        content
            .menuStyle(.borderlessButton).clickableCursor()
            .menuIndicator(.hidden)
            #if os(macOS)
            .buttonStyle(.plain)
            #endif
    }
}

private struct VerseActionButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .modifier(VerseActionControlAppearance())
            .opacity(configuration.isPressed ? 0.55 : 1)
    }
}

private struct VerseActionControlAppearance: ViewModifier {
    var width = ReaderFloatingControls.actionWidth
    @Environment(\.isEnabled) private var isEnabled
    @State private var hovering = false

    func body(content: Content) -> some View {
        content
            .labelStyle(.iconOnly)
            .font(.system(size: 15, weight: .medium))
            .frame(width: width, height: ReaderFloatingControls.actionHeight)
            .contentShape(.rect)
            #if os(macOS)
            .background {
                Capsule()
                    .fill(.primary.opacity(isEnabled && hovering ? 0.08 : 0))
                    .padding(2)
            }
            .onHover { hovering = $0 }
            .pointerStyle(isEnabled ? .link : .default)
            #else
            .hoverEffect(.highlight, isEnabled: isEnabled)
            #endif
    }
}

func consecutiveVerseRuns(_ verses: Set<Int>) -> [ClosedRange<Int>] {
    var runs: [ClosedRange<Int>] = []
    for verse in verses.sorted() {
        if let last = runs.last, last.upperBound == verse - 1 {
            runs[runs.count - 1] = last.lowerBound...verse
        } else {
            runs.append(verse...verse)
        }
    }
    return runs
}

// A missing layout range breaks the outline. A rendered blank verse can bridge a run,
// but it should not extend the frame past the first or last visible line.
func selectedVerseRanges(_ selection: Set<Int>, in ranges: [Int: NSRange]) -> [NSRange] {
    let available = Set(selection.filter { ranges[$0] != nil })
    return consecutiveVerseRuns(available).compactMap { run in
        let visible = run.compactMap { verse -> NSRange? in
            guard let range = ranges[verse], range.length > 1 else { return nil }
            return NSRange(location: range.location, length: range.length - 1)
        }
        guard let first = visible.first, let last = visible.last else { return nil }
        return NSUnionRange(first, last)
    }
}

/// Feedback for controls whose layout already supplies the visible button shape.
struct InteractivePlainButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(isEnabled ? (configuration.isPressed ? 0.65 : 1) : 0.45)
            #if os(macOS)
            .pointerStyle(isEnabled ? .link : .default)
            #else
            .hoverEffect(.highlight, isEnabled: isEnabled)
            #endif
    }
}

extension ButtonStyle where Self == InteractivePlainButtonStyle {
    static var interactivePlain: Self { Self() }
}

extension View {
    /// Pointing-hand cursor on the Mac for controls that keep their native look (menus, pickers, toggles, toolbar and
    /// bordered buttons). Plain buttons use `.buttonStyle(.interactivePlain)` instead. Applied to a container it covers
    /// every control inside, so keep text fields out of such containers.
    @ViewBuilder func clickableCursor(_ enabled: Bool = true) -> some View {
        #if os(macOS)
        pointerStyle(enabled ? .link : .default)
        #else
        self
        #endif
    }
}

struct VerseActionsMenu<Actions: View>: View {
    let label: String
    @ViewBuilder let actions: () -> Actions

    var body: some View {
        Menu(content: actions) {
            Image(systemName: "ellipsis")
                .foregroundStyle(.primary)
                .modifier(VerseActionControlAppearance(width: ReaderFloatingControls.actionHeight))
        }
        .modifier(VerseActionMenuChrome())
        .fixedSize()
        .accessibilityLabel(label)
        .help("Verse actions")
    }
}
