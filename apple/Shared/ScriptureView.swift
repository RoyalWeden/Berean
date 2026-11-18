import SwiftUI
import CoreTransferable
import UniformTypeIdentifiers
import BereanCore
import BereanBible
import BereanText
import BereanReference
import BereanWorkspace
import BereanNotes

struct ScriptureReadingPosition: Equatable {
    let offset: CGFloat
    let verse: Int?
    var atEnd = false
    var selectedVerses: Set<Int> = []
    var returnEdition: ChapterEdition?
    var viewportWidth: CGFloat?
    var verseOffsetFromTop: CGFloat?

    var persisted: ReaderViewport? {
        ReaderViewport(offset: Double(offset), verse: verse, atEnd: atEnd, selectedVerses: selectedVerses,
                       width: viewportWidth.map { Double($0) }, verseOffset: verseOffsetFromTop.map { Double($0) })
    }

    init(_ position: ReaderViewport) {
        offset = CGFloat(position.offset); verse = position.verse; atEnd = position.atEnd
        selectedVerses = position.selectedVerses; viewportWidth = position.width.map { CGFloat($0) }
        verseOffsetFromTop = position.verseOffset.map { CGFloat($0) }
    }

    init(offset: CGFloat, verse: Int?, atEnd: Bool = false, selectedVerses: Set<Int> = [],
         returnEdition: ChapterEdition? = nil, viewportWidth: CGFloat? = nil, verseOffsetFromTop: CGFloat? = nil) {
        self.offset = offset; self.verse = verse; self.atEnd = atEnd; self.selectedVerses = selectedVerses
        self.returnEdition = returnEdition; self.viewportWidth = viewportWidth; self.verseOffsetFromTop = verseOffsetFromTop
    }
}

struct ScriptureEditionArrival {
    let edition: ChapterEdition
    let offset: CGFloat

    func returnEdition(at currentOffset: CGFloat) -> ChapterEdition? {
        abs(currentOffset - offset) <= 1 ? edition : nil
    }
}

@MainActor final class ScripturePositionReader {
    var capture: (Int?) -> ScriptureReadingPosition? = { _ in nil }
    #if os(macOS)
    var find: (String, Int) -> (current: Int, total: Int) = { _, _ in (0, 0) }
    #endif
}

struct ChapterEdition: Hashable {
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

private struct ChapterEditionAvailability {
    let book: String
    let kjva: Set<Int>
    let lxx: Set<Int>

    func counterpart(of source: ChapterEdition) -> ChapterEdition? {
        guard source.book == book, let target = source.counterpart else { return nil }
        let chapters = ChapterMap.isLxx(target.text) ? lxx : kjva
        return chapters.contains(target.chapter) ? target : nil
    }
}

private struct AdjacentChapters {
    let source: ChapterEdition
    let previous: ChapterEdition?
    let next: ChapterEdition?

    func destination(_ direction: Int) -> ChapterEdition? { direction < 0 ? previous : next }
}

/// A complete, revision-scoped reader input. No annotation work arrives a frame
/// after the chapter, and warm navigation can render without a loading branch.
struct ScriptureChapterPresentation {
    let rows: [ChapterVerseRow]
    let revisions: [Int]
    let noteCounts: [Int: Int]
    let chapterCitations: [Note]
    let verseCitations: [Int: [NoteCrossReferences.Link]]
    let verseTags: [Int: [TagLite]]
    let chapterTags: [TagLite]
    let highlights: [Int: [Highlight]]
}

extension AppModel {
    /// Prepared Scripture is immutable for the lifetime of an installed text database.
    /// Share in-flight work; cancelling a view must not cancel another reader's load.
    func readerChapter(_ edition: ChapterEdition) async -> [ChapterVerseRow] {
        if let cached = readerChapterCache[edition] {
            touchReaderChapter(edition)
            return cached
        }
        let pending: Task<[ChapterVerseRow], Never>
        if let existing = readerChapterLoads[edition] { pending = existing }
        else {
            let bible = bible
            pending = Task {
                var rows = PsalmSuperscription.apply(
                    await bible.queryChapter(edition.book, edition.chapter, textId: edition.text),
                    textId: edition.text, bookId: edition.book, chapter: edition.chapter)
                if edition.text == "lxx", MissingLxxVerses.eligible(bookId: edition.book, chapter: edition.chapter) {
                    let kjv = await bible.queryChapter(edition.book, edition.chapter, textId: "kjva")
                    rows = MissingLxxVerses.annotate(rows, comparingTo: kjv)
                }
                return rows
            }
            readerChapterLoads[edition] = pending
        }
        let rows = await pending.value
        // Every waiter publishes before returning, even if it resumes before the
        // creator. A reader must never observe completed work without its cache.
        if readerChapterCache[edition] == nil {
            readerChapterLoads.removeValue(forKey: edition)
            readerChapterCache[edition] = rows
            touchReaderChapter(edition)
            let protectedChapter = activeTab.flatMap { tab in
                tab.tabType == .bible ? ChapterEdition(BibleState(tab.state)) : nil
            }
            while readerChapterOrder.count > 16 {
                // The visible reader derives its presentation from this cache.
                // Background completions must not evict it into a loading state.
                let index = readerChapterOrder.firstIndex { $0 != protectedChapter } ?? 0
                let removed = readerChapterOrder.remove(at: index)
                readerChapterCache.removeValue(forKey: removed)
                readerPresentations.removeValue(forKey: removed)
            }
            readerChapterRevision += 1
        }
        return rows
    }

    private func touchReaderChapter(_ edition: ChapterEdition) {
        readerChapterOrder.removeAll { $0 == edition }
        readerChapterOrder.append(edition)
    }

    func readerPresentation(_ edition: ChapterEdition) -> ScriptureChapterPresentation? {
        _ = readerChapterRevision // Observe completed asynchronous preparation.
        guard let rows = readerChapterCache[edition] else { return nil }
        touchReaderChapter(edition)
        let revisions = [notesRevision, tagsRevision, highlightsRevision]
        if let cached = readerPresentations[edition], cached.revisions == revisions { return cached }
        let tags = try? verseTags?.forChapter(edition.book, edition.chapter)
        let presentation = ScriptureChapterPresentation(rows: rows, revisions: revisions,
            noteCounts: (try? notes?.coveringVerseCounts(edition.book, edition.chapter,
                verses: Set(rows.map(\.verseNum)), textId: edition.text)) ?? [:],
            chapterCitations: (try? notes?.notesCitingChapter(edition.book, edition.chapter, textId: edition.text)) ?? [],
            verseCitations: (try? notes?.crossReferences(bookId: edition.book, chapter: edition.chapter,
                textId: edition.text))?.byVerse ?? [:],
            verseTags: tags?.verseTags ?? [:], chapterTags: tags?.chapterTags ?? [],
            highlights: (try? highlights?.chapter(edition.book, edition.chapter, textId: edition.text)) ?? [:])
        readerPresentations[edition] = presentation
        return presentation
    }

    fileprivate func adjacentChapters(to source: ChapterEdition) async -> AdjacentChapters {
        let chapters = await bible.chapterNumbers(source.book, textId: source.text)
        let index = chapters.firstIndex(of: source.chapter)
        let previous = index.flatMap { $0 > 0 ? chapters[$0 - 1] : nil }
        let next = index.flatMap { chapters.indices.contains($0 + 1) ? chapters[$0 + 1] : nil }
        let siblings = previous == nil || next == nil ? await books(for: source.text) : []
        let bookIndex = siblings.firstIndex { $0.id == source.book }

        func destination(_ chapter: Int?, delta: Int) async -> ChapterEdition? {
            if let chapter { return ChapterEdition(book: source.book, chapter: chapter, text: source.text) }
            guard !Task.isCancelled, let bookIndex, siblings.indices.contains(bookIndex + delta) else { return nil }
            let book = siblings[bookIndex + delta].id
            let chapters = await bible.chapterNumbers(book, textId: source.text)
            guard let number = delta < 0 ? chapters.last : chapters.first else { return nil }
            return ChapterEdition(book: book, chapter: number, text: source.text)
        }

        return await AdjacentChapters(source: source, previous: destination(previous, delta: -1),
                                      next: destination(next, delta: 1))
    }

    func installedCounterpart(of source: ChapterEdition) async -> ChapterEdition? {
        guard let target = source.counterpart else { return nil }
        let chapters = await bible.chapterNumbers(target.book, textId: target.text)
        return chapters.contains(target.chapter) ? target : nil
    }

    func switchChapterEdition(in tabId: String, from source: ChapterEdition, to fallback: ChapterEdition,
                              position: ScriptureReadingPosition? = nil) {
        guard let tab = activeTab, tab.id == tabId, tab.tabType == .bible else { return }
        var reader = BibleState(tab.state)
        guard !reader.compareMode, ChapterEdition(reader) == source, source.counterpart == fallback else { return }
        var target = fallback
        if let previous = position?.returnEdition, previous.book == fallback.book, previous.text == fallback.text {
            target = previous
        } else if let verse = position?.verse,
                  let mapped = ChapterMap.verseCounterpart(source.book, chapter: source.chapter, verse: verse,
                                                           from: source.text, to: fallback.text) {
            target = ChapterEdition(book: fallback.book, chapter: mapped.chapter, text: fallback.text)
        }
        if let position { saveScripturePosition(tabId: tabId, edition: source, position: position) }
        scriptureEditionSources[tabId] = (source, target, position)
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
        #if os(iOS)
        readerNavigationFeedback()
        #endif
    }
    func savedScripturePosition(tabId: String, edition: ChapterEdition) -> ScriptureReadingPosition? {
        if let position = scriptureReadingPositions[tabId]?[edition.key] { return position }
        guard let tab = findTab(tabId), let saved = ReaderViewports.position(in: tab.state, chapter: edition.key) else { return nil }
        let position = ScriptureReadingPosition(saved)
        scriptureReadingPositions[tabId, default: [:]][edition.key] = position
        return position
    }

    func saveScripturePosition(tabId: String, edition: ChapterEdition, position: ScriptureReadingPosition) {
        scriptureReadingPositions[tabId, default: [:]][edition.key] = position
        guard let persisted = position.persisted, let tab = findTab(tabId), tab.tabType == .bible else { return }
        guard ReaderViewports.position(in: tab.state, chapter: edition.key) != persisted else { return }
        update(tabId, recordHistory: false) {
            $0.state = ReaderViewports.updating($0.state, chapter: edition.key, position: persisted)
        }
        if let keys = findTab(tabId)?.state[ReaderViewports.field]?.objectValue?.entries.map({ $0.0.string }) {
            let retained = Set(keys)
            scriptureReadingPositions[tabId] = scriptureReadingPositions[tabId]?.filter { retained.contains($0.key) }
        }
    }

    func restoreScripturePosition(tabId: String, edition: ChapterEdition) -> ScriptureReadingPosition? {
        if let transition = scriptureEditionSources[tabId], transition.target == edition {
            scriptureEditionSources.removeValue(forKey: tabId)
            guard let saved = transition.position ?? savedScripturePosition(tabId: tabId, edition: transition.source) else { return nil }
            if saved.returnEdition == edition, var original = savedScripturePosition(tabId: tabId, edition: edition) {
                original.returnEdition = transition.source
                return original
            }
            var verse = saved.verse
            if let number = verse,
               let mapped = ChapterMap.verseCounterpart(edition.book, chapter: transition.source.chapter, verse: number,
                                                        from: transition.source.text, to: edition.text) {
                verse = mapped.chapter == edition.chapter ? mapped.verse : nil
            }
            return ScriptureReadingPosition(offset: 0, verse: verse, returnEdition: transition.source)
        }
        scriptureEditionSources.removeValue(forKey: tabId)
        return savedScripturePosition(tabId: tabId, edition: edition)
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
    var hideSuppliedWords = false

    var fileName: String {
        reference.replacingOccurrences(of: ":", with: " ") + ".txt"
    }

    var formattedText: String {
        ([reference] + rows.map { row in
            let text = VerseDisplay.text(row.text, tagged: row.textTagged, textId: textId,
                                         replacerEnabled: replacerEnabled, rules: WordReplacer.defaultRules, hideSuppliedWords: hideSuppliedWords)
            return "\(row.verseNum) \(text)"
        }).joined(separator: "\n")
    }

    static var transferRepresentation: some TransferRepresentation {
        ProxyRepresentation(exporting: { (selection: Self) in selection.formattedText })
            .suggestedFileName { $0.fileName }
    }
}

extension ChapterVerseRow {
    func hidingTextAnnotations(_ hidden: Set<String>, textId: String) -> Self {
        guard textId != "kjva",
              AnnotationFilters.keys[textId]?.contains(where: { hidden.contains($0.id) }) == true else { return self }
        var row = self
        row.text = AnnotationFilters.strip(text, textId: textId, hidden: hidden)
        row.textTagged = textTagged.map { AnnotationFilters.stripTagged($0, textId: textId, hidden: hidden) }
        return row
    }
}

private struct SharedScriptureChapter: Transferable {
    let reference: String
    let bookId: String
    let chapter: Int
    let textId: String
    let replacerEnabled: Bool
    let bible: BibleService
    let hiddenAnnotations: Set<String>

    func formattedText() async throws -> String {
        let rows = await bible.queryChapter(bookId, chapter, textId: textId)
        guard !rows.isEmpty else { throw CocoaError(.fileReadNoSuchFile) }
        let visibleRows = rows.map { $0.hidingTextAnnotations(hiddenAnnotations, textId: textId) }
        return SharedVerseSelection(reference: reference, rows: visibleRows, textId: textId,
                                    replacerEnabled: replacerEnabled,
                                    hideSuppliedWords: hiddenAnnotations.contains(AnnotationFilters.kjvaSuppliedWords)).formattedText
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
    let tabId: String
    var hasText = true

    var body: some View {
        let chapterLabel = Reference.readerChapterLabel(state.bookId, state.chapter, textId: state.translation)
        let reference = chapterLabel + (state.translation == "lxx" ? " LXX" : "")
        let hidden = Set((app.findTab(tabId)?.state["hiddenAnnotations"]?.arrayValue ?? []).compactMap { $0.stringValue?.string })
        let chapter = SharedScriptureChapter(reference: reference, bookId: state.bookId, chapter: state.chapter,
                                            textId: state.translation, replacerEnabled: app.wordReplacerEnabled,
                                            bible: app.bible, hiddenAnnotations: hidden)
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
        if let url = DeepLink.nativeDevPassageURL(bookId: state.bookId, chapter: state.chapter, textId: state.translation) {
            Button("Copy Native Dev Link", systemImage: "link") {
                Clipboard.copy(url.absoluteString)
                AccessibilityNotification.Announcement("Chapter link copied").post()
            }
            .disabled(!hasText)
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
    var editionFlipRequest: Int = 0
    var dockClearance: CGFloat = 0
    var sideBySideReaderControls = false
    #endif
    private enum CopyAction {
        case verses, reference
    }

    @State private var copiedAction: CopyAction?
    @State private var copyFeedbackID = UUID()
    private var presentation: ScriptureChapterPresentation? { app.readerPresentation(ChapterEdition(state)) }
    private var loadedChapter: String? { presentation == nil ? nil : chapterKey(state) }
    @State private var chapterPull: ChapterPullCue?
    private struct ChapterStepArrival {
        let chapter: ChapterEdition
        let atEnd: Bool
    }
    @State private var chapterStepArrival: ChapterStepArrival?
    @AppStorage("chapterPullNavigation") private var chapterPullNavigation = true
    private var verses: [ChapterVerseRow] { presentation?.rows ?? [] }
    private struct SelectionScope: Equatable {
        let chapter: ChapterEdition
        let destination: SelectionDestination
        let disjoint: JSValue?
    }
    private var selectionScope: SelectionScope {
        SelectionScope(chapter: ChapterEdition(state), destination: SelectionDestination(state),
            disjoint: app.findTab(tabId)?.state["nativeSelectedVerses"])
    }
    @State private var storedSelectionScope: SelectionScope?
    @State private var storedSelectedVerse: Int?
    private var selectedVerse: Int? {
        get { storedSelectionScope == selectionScope ? storedSelectedVerse : state.verse }
        nonmutating set { storedSelectedVerse = newValue }
    }
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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var storedSelection: Set<Int> = []
    private var selection: Set<Int> {
        get { storedSelectionScope == selectionScope ? storedSelection : passageSelection(state) }
        nonmutating set { storedSelectionScope = selectionScope; storedSelection = newValue }
    }
    @State private var storedAnchor: Int?
    private var anchor: Int? {
        get { storedSelectionScope == selectionScope ? storedAnchor : state.verse }
        nonmutating set { storedAnchor = newValue }
    }
    private var noteCounts: [Int: Int] { presentation?.noteCounts ?? [:] }
    private var chapterCitations: (key: String, notes: [Note])? {
        presentation.map { (chapterKey(state), $0.chapterCitations) }
    }
    private var verseCitations: (key: String, links: [Int: [NoteCrossReferences.Link]])? {
        presentation.map { (chapterKey(state), $0.verseCitations) }
    }
    @AppStorage("crossrefSource") private var crossRefSource = "tske"
    private var highlights: [Int: [Highlight]] { presentation?.highlights ?? [:] }
    @State private var pickerShown = false
    #if os(macOS)
    private enum VersePopover { case highlight, export }
    @State private var versePopover: VersePopover?
    @State private var displayOptionsShown = false
    #endif
    @AppStorage("scriptureWidth") private var scriptureWidth = ScriptureWidth.normal
    @AppStorage("showVerseNumbers") private var showVerseNumbers = true
    @AppStorage("showRedLetters") private var showRedLetters = true
    @State private var scrollTargetScope: SelectionScope?
    @State private var storedScrollTarget: Int?
    private var scrollTarget: Int? {
        get {
            let chapter = ChapterEdition(state)
            if let jump = app.scriptureJumpRequest, jump.tabID == tabId, jump.chapter == chapter { return state.verse }
            if scrollTargetScope == selectionScope { return storedScrollTarget }
            let next = passageSelection(state)
            return app.savedScripturePosition(tabId: tabId, edition: chapter)?.selectedVerses == next ? nil : state.verse
        }
        nonmutating set { scrollTargetScope = selectionScope; storedScrollTarget = newValue }
    }
    @State private var scrollRevision: UUID?
    @State private var chapterStepTask: Task<Void, Never>?
    private var verseTags: [Int: [TagLite]] { presentation?.verseTags ?? [:] }
    private var chapterTags: [TagLite] { presentation?.chapterTags ?? [] }
    @State private var tagging: (ranges: [TagRange], label: String, kind: String)?

    @State private var editionAvailability: ChapterEditionAvailability?
    @State private var positionReader = ScripturePositionReader()
    #if os(macOS)
    @State private var strongsTooltips: [String: String] = [:]
    @State private var chapterFindQuery = ""
    @State private var chapterFindVisible = false
    @State private var chapterFindAutomatic = false
    @State private var chapterFindActivity = UUID()
    @State private var chapterFindResult = (current: 0, total: 0)
    @FocusState private var chapterFindFocused: Bool
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

    @State private var chapterNeighbors: AdjacentChapters?

    private func canStep(_ delta: Int, from reader: BibleState) -> Bool {
        guard let chapterNeighbors, chapterNeighbors.source == ChapterEdition(reader) else { return true }
        return chapterNeighbors.destination(delta) != nil
    }

    private func pullDestination(_ direction: Int, from reader: BibleState) -> ChapterEdition? {
        guard chapterPullNavigation, chapterNeighbors?.source == ChapterEdition(reader) else { return nil }
        return chapterNeighbors?.destination(direction)
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
        .onChange(of: editionFlipRequest) {
            guard !st.compareMode, let target = ChapterEdition(st).counterpart else { return }
            flipEdition(st, to: target)
        }
        #endif
        .toolbar { toolbar(st) }
        .onDisappear { chapterStepTask?.cancel() }
        .onChange(of: scenePhase) { _, phase in
            guard phase != .active, !st.compareMode, let position = positionReader.capture(nil) else { return }
            app.saveScripturePosition(tabId: tabId, edition: ChapterEdition(st), position: position)
            app.saveNow()
        }
        .task(id: st.compareMode ? nil : ChapterEdition(st)) {
            guard !st.compareMode else { return }
            let source = ChapterEdition(st)
            let neighbors = await app.adjacentChapters(to: source)
            guard !Task.isCancelled, !state.compareMode, ChapterEdition(state) == source else { return }
            chapterNeighbors = neighbors
            // Warm actual neighboring chapters, including prologues and book boundaries.
            for target in [neighbors.next, neighbors.previous].compactMap({ $0 }) {
                guard !Task.isCancelled else { return }
                _ = await app.readerChapter(target)
            }
        }
        .task(id: editionAvailabilityBook(st)) {
            guard let book = editionAvailabilityBook(st), editionAvailability?.book != book else { return }
            async let kjva = app.bible.chapterNumbers(book, textId: "kjva")
            async let lxx = app.bible.chapterNumbers(book, textId: "lxx")
            let availability = await ChapterEditionAvailability(book: book, kjva: Set(kjva), lxx: Set(lxx))
            guard !Task.isCancelled, editionAvailabilityBook(state) == book else { return }
            editionAvailability = availability
        }
        .sheet(isPresented: Binding(get: { tagging != nil }, set: { if !$0 { tagging = nil } })) {
            if let t = tagging { TagPickerView(ranges: t.ranges, label: t.label, kind: t.kind) }
        }
    }

    private func editionAvailabilityBook(_ state: BibleState) -> String? {
        !state.compareMode && ChapterEdition(state).counterpart != nil ? state.bookId : nil
    }

    private func chapterKey(_ state: BibleState) -> String {
        "\(state.translation)|\(state.bookId)|\(state.chapter)"
    }

    private func restoreReaderPosition(_ state: BibleState) -> ScriptureReadingPosition? {
        let edition = ChapterEdition(state)
        if let arrival = chapterStepArrival, arrival.chapter == edition {
            chapterStepArrival = nil
            return ScriptureReadingPosition(offset: 0, verse: nil, atEnd: arrival.atEnd)
        }
        return app.restoreScripturePosition(tabId: tabId, edition: edition)
    }

    @ViewBuilder func chapterBody(_ st: BibleState) -> some View {
        let chapter = chapterKey(st)
        let showActions = loadedChapter == chapter && !verses.isEmpty && !selection.isEmpty
        let actionSpace = showActions ? ReaderFloatingControls.selectionHeight : 0
        #if os(iOS)
        let shareBottomRow = sideBySideReaderControls && dockClearance > 0
        let bottomClearance = shareBottomRow ? max(actionSpace, dockClearance) : actionSpace + dockClearance
        let actionAlignment: Alignment = shareBottomRow ? .bottomLeading : .bottom
        #else
        let bottomClearance = actionSpace
        let actionAlignment: Alignment = .bottom
        #endif
        VStack(spacing: 0) {
            if loadedChapter == chapter, !verses.isEmpty,
               let chapterCitations, chapterCitations.key == chapter, !chapterCitations.notes.isEmpty {
                chapterCitationMenu(chapterCitations.notes)
            }
            Group {
                if loadedChapter != chapter {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if verses.isEmpty {
                    unavailablePassage(st)
                } else {
                    #if os(macOS)
                    GeometryReader { geometry in
                        GeometryReader { underlap in
                            let titleBar = max(0, geometry.frame(in: .global).minY - underlap.frame(in: .global).minY)
                            macReader(st, actionClearance: actionSpace, titleBarClearance: titleBar)
                                .clipped()
                                .overlay(alignment: .topTrailing) {
                                    if chapterFindVisible {
                                        chapterFindBar(availableWidth: underlap.size.width - 28)
                                            .padding(.top, titleBar + 8)
                                            .padding(.horizontal, 14)
                                    }
                                }
                        }
                        .ignoresSafeArea(.container, edges: .top)
                    }
                    #else
                    iosReader(st, actionClearance: bottomClearance)
                    #endif
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            #if os(iOS)
            .clipped()
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
        .overlay(alignment: chapterPull?.direction == -1 ? .top : .bottom) {
            if let pull = chapterPull, let target = pullDestination(pull.direction, from: st) {
                let destination = Reference.readerChapterLabel(target.book, target.chapter, textId: target.text)
                Label(pull.ready ? "Release to open \(destination)" : "Pull for \(destination)",
                      systemImage: pull.direction < 0 ? "chevron.up" : "chevron.down")
                    .font(.callout.weight(.medium))
                    .padding(.horizontal, 14).padding(.vertical, 8)
                    .glassEffectCompat()
                    .padding(pull.direction < 0 ? .top : .bottom, pull.direction < 0 ? 16 : 16 + bottomClearance)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
                    .transition(.opacity)
            }
        }
        .onChange(of: ChapterEdition(st)) { _, edition in
            chapterPull = nil
            if chapterStepArrival?.chapter != edition { chapterStepArrival = nil }
            #if os(macOS)
            if chapterFindVisible { closeChapterFind() }
            #endif
        }
        .overlay(alignment: actionAlignment) {
            if showActions {
                selectionBar(st)
                    #if os(iOS)
                    .padding(.bottom, shareBottomRow ? 0 : dockClearance)
                    .padding(.leading, shareBottomRow ? 6 : 0)
                    #endif
            }
        }
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
        .onChange(of: app.scriptureJumpRequest?.revision) {
            guard loadedChapter == chapter, consumeVerseJump(for: st) else { return }
            applyPassageSelection(st)
        }
        .onChange(of: chapter) { _, _ in
            if app.readerChromeHidden {
                withAnimation(reduceMotion ? nil : .snappy) { app.readerChromeHidden = false }
            }
        }
        .onDisappear { app.readerChromeHidden = false }
        .onChange(of: app.chapterStepRequest) { _, request in
            guard let request, request.tabId == tabId else { return }
            app.chapterStepRequest = nil
            step(request.delta)
        }
        .task(id: chapter) {
            if loadedChapter != chapter { _ = await app.readerChapter(ChapterEdition(st)) }
            let destination = state
            guard !Task.isCancelled, chapterKey(destination) == chapter else { return }
            let isVerseJump = consumeVerseJump(for: destination)
            if isVerseJump || storedSelectionScope != selectionScope {
                applyPassageSelection(destination, restoringReader: !isVerseJump)
            }
        }
    }

    private func chapterCitationMenu(_ notes: [Note]) -> some View {
        Menu {
            ForEach(notes) { note in
                Button(note.title.isEmpty ? "Untitled" : note.title, systemImage: "note.text") {
                    app.openNote(note.id, fromList: tabId)
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

    private func unavailablePassage(_ st: BibleState) -> some View {
        let source = ChapterEdition(st)
        return ContentUnavailableView {
            Label("Passage Unavailable", systemImage: "book.closed")
        } description: {
            Text("\(Reference.readerChapterLabel(st.bookId, st.chapter, textId: st.translation)) is unavailable in \(textInfo(st.translation).name).")
        } actions: {
            Button("Choose Passage") { pickerShown = true }
                .buttonStyle(.borderedProminent)
            if let target = editionAvailability?.counterpart(of: source) {
                Button("Open in \(textInfo(target.text).short)") {
                    app.switchChapterEdition(in: tabId, from: source, to: target)
                }
                .buttonStyle(.bordered)
            }
        }
    }

    // MARK: verse selection (click / ⇧-click verse numbers)

    /// An explicit destination wins even if the reader mounts after the request arrived.
    private func consumeVerseJump(for state: BibleState) -> Bool {
        guard let request = app.scriptureJumpRequest, request.tabID == tabId,
              request.chapter == ChapterEdition(state) else { return false }
        scrollRevision = request.revision
        app.scriptureJumpRequest = nil
        return true
    }

    private func applyPassageSelection(_ state: BibleState, onlyIfChanged: Bool = false, restoringReader: Bool = false) {
        let next = passageSelection(state)
        if onlyIfChanged && next == selection { return }
        selectedVerse = state.verse
        anchor = state.verse
        let saved = app.savedScripturePosition(tabId: tabId, edition: ChapterEdition(state))
        scrollTarget = restoringReader && saved?.selectedVerses == next ? nil : state.verse
        selection = next
    }

    private func passageSelection(_ state: BibleState) -> Set<Int> {
        guard let first = state.verse else { return [] }
        let last = max(first, state.endVerse ?? first)
        let chapterVerses = Set(verses.map(\.verseNum))
        let restored = (app.findTab(tabId).map { ResolvedPassage.savedVerses(in: $0.state, reader: state) } ?? [])
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
        // A local click just wrote the location represented by these local
        // values. Keep its exact focus and nil scroll target through that write.
        storedSelectionScope = selectionScope
        scrollTargetScope = selectionScope
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
                             rows: rows.map { $0.hidingTextAnnotations(hiddenAnnotations, textId: state.translation) },
                             textId: state.translation, replacerEnabled: app.wordReplacerEnabled,
                             hideSuppliedWords: hideKJVASuppliedWords)
    }

    @ViewBuilder private func selectedVerseExportActions(_ state: BibleState, onComplete: @escaping () -> Void = {}) -> some View {
        let rows = selectedRows
        if !rows.isEmpty {
            let selection = shareSelection(state, rows: rows)
            let links = consecutiveVerseRuns(self.selection).compactMap { run in
                DeepLink.nativeDevPassageURL(bookId: state.bookId, chapter: state.chapter, verse: run.lowerBound,
                                             endVerse: run.upperBound, textId: state.translation)?.absoluteString
            }
            if !links.isEmpty {
                Button(links.count == 1 ? "Copy Native Dev Link" : "Copy Native Dev Links", systemImage: "link") {
                    onComplete()
                    Clipboard.copy(links.joined(separator: "\n"))
                    AccessibilityNotification.Announcement(links.count == 1 ? "Verse link copied" : "Verse links copied").post()
                }
            }
            Button("Save Verses as Text…", systemImage: "square.and.arrow.down") {
                onComplete()
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
                .glassEffectCompat(interactive: true, backingOpacity: ReaderFloatingControls.dockBackingOpacity)
                #endif
                .padding(.horizontal, 8)
                .padding(.bottom, ReaderFloatingControls.bottomPadding)
                .accessibilityElement(children: .contain)
                .accessibilityLabel("Selected \(selectionLabel(st))")
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
            #if os(macOS)
            HStack(spacing: ReaderFloatingControls.actionSpacing) {
                primaryVerseActions(st)
                compactVerseMenu(st, includesTag: false)
                clearSelectionButton
            }
            .fixedSize(horizontal: true, vertical: false)
            #endif
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
                .accessibilityLabel("Verse Actions")
                .verseActionHelp("Verse actions")
                clearSelectionButton
            }
            .fixedSize(horizontal: true, vertical: false)
        }
    }

    @ViewBuilder private func primaryVerseActions(_ st: BibleState) -> some View {
        selectionCopyButton(.verses, state: st)
            .buttonStyle(VerseActionButtonStyle())
            .verseActionHelp("Copy with reference (⌘C)")
        highlightMenu(st).verseActionHelp("Highlight")
        Button("Tag Verses", systemImage: "tag") {
            tagging = (selectionRanges(st), selectionLabel(st), "verses")
        }
        .buttonStyle(VerseActionButtonStyle())
        .verseActionHelp("Tag verses")
    }

    private func verseActionRow(_ st: BibleState) -> some View {
        HStack(spacing: ReaderFloatingControls.actionSpacing) {
            primaryVerseActions(st)
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
                compareSelectionButton
                    .buttonStyle(VerseActionButtonStyle())
                    .help("Compare selected verses")
                VerseActionPopover(title: "Export Selected Verses", symbol: "square.and.arrow.up", selection: selection,
                                   presented: versePopoverBinding(.export)) { close in
                    selectedVerseExportActions(st, onComplete: close)
                }
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
        .accessibilityLabel("More Verse Actions")
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
            compareSelectionButton
        }
        selectedVerseExportActions(st)
    }

    private var compareSelectionButton: some View {
        Button(selection.count == 1 ? "Compare This Verse" : "Compare Selected Verses",
               systemImage: "rectangle.split.2x1") {
            app.prepareCompareJump(in: tabId, edition: ChapterEdition(state))
            mutate { $0.compareMode = true }
        }
    }

    private func compareVerse(_ verse: ChapterVerseRow, in state: BibleState) {
        let passage = ResolvedPassage(textId: state.translation, bookId: verse.bookId, chapter: verse.chapter,
                                      verse: verse.verseNum, endVerse: nil)
        app.prepareCompareJump(in: tabId, edition: ChapterEdition(book: verse.bookId, chapter: verse.chapter, text: state.translation))
        mutate(passage: passage) {
            $0.verse = verse.verseNum
            $0.endVerse = nil
            $0.compareMode = true
        }
    }

    private func verseMenuLabel(_ title: String, symbol: String) -> some View {
        Image(systemName: symbol)
            .imageScale(.large)
            .modifier(VerseActionControlAppearance())
            .accessibilityLabel(title)
    }

    private var clearSelectionButton: some View {
        Button("Clear Selection", systemImage: "xmark") { clearVerseSelection() }
            .buttonStyle(VerseActionButtonStyle())
            .accessibilityHint("Clears \(selectionLabel(state))")
            #if os(macOS)
            .keyboardShortcut(versePopover == nil ? .cancelAction : nil)
            .help("Clear selection (Esc)")
            #endif
    }

    private func clearVerseSelection() {
        selection = []
        anchor = nil
        selectedVerse = nil
        persistLocalSelection()
    }

    #if os(macOS)
    private func versePopoverBinding(_ target: VersePopover) -> Binding<Bool> {
        Binding(get: { versePopover == target }, set: { isPresented in
            if isPresented {
                versePopover = target
            } else if versePopover == target {
                versePopover = nil
            }
        })
    }
    #endif

    @ViewBuilder private func highlightMenu(_ st: BibleState, iconOnly: Bool = true) -> some View {
        #if os(macOS)
        if iconOnly {
            VerseActionPopover(title: "Highlight", symbol: "highlighter", selection: selection,
                               presented: versePopoverBinding(.highlight)) { close in
                highlightActions(st, onComplete: close)
            }
        } else {
            Menu("Highlight", systemImage: "highlighter") { highlightActions(st) }
        }
        #else
        let menu = Menu {
            highlightActions(st)
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
        #endif
    }

    @ViewBuilder private func highlightActions(_ st: BibleState, onComplete: @escaping () -> Void = {}) -> some View {
        ForEach(highlightColors, id: \.self) { color in
            Button(color.capitalized, systemImage: "circle.fill") {
                onComplete()
                app.highlightVerses(selectedRows, color: color, textID: st.translation) {
                    copySelection(st, plain: false)
                }
            }
        }
        Divider()
        Button("Remove Highlights") {
            onComplete()
            for row in selectedRows {
                try? app.highlights?.remove(bookId: row.bookId, chapter: row.chapter, verse: row.verseNum,
                                            textId: st.translation)
            }
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
            selectionFocus: tappedVerse?.row.verseNum ?? selectedVerse,
            scrollTarget: scrollTarget,
            actionClearance: actionClearance,
            animateOutline: !reduceMotion && scenePhase == .active,
            scrollRevision: scrollRevision,
            positionReader: positionReader,
            restorePosition: { restoreReaderPosition(st) },
            savePosition: { app.saveScripturePosition(tabId: tabId, edition: ChapterEdition(st), position: $0) },
            findRequest: findRequest,
            reference: { first, last in
                let suffix = st.translation == "lxx" ? " LXX" : ""
                let label = Reference.bookChapterVerseLabel(st.bookId, chapter: st.chapter, verse: first, hermas: HermasText(textId: st.translation))
                return label + (first == last ? "" : "-\(last)") + suffix
            },
            onStrongs: { id, verse in showLexicon(id, verse: verse) },
            onOpenStrongsTab: { id, verse in showLexicon(id, verse: verse, newTab: true) },
            onNotes: { openInspector("notes", verse: $0) },
            onCitations: { verse in
                crossRefSource = "notes"
                openInspector("crossrefs", verse: verse)
            },
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
            canPullChapter: { pullDestination($0, from: st) != nil },
            onChapterPull: { pull in withAnimation(.easeOut(duration: 0.15)) { chapterPull = pull } },
            onChapterPullCommit: { step($0, fromPull: true) },
            onPinchPreview: { pinchFontSize = $0 },
            onPinchCommit: { size in
                if app.fontSize != size { app.fontSize = size }
                pinchFontSize = nil
            },
            onChromeHidden: { hidden in
                withAnimation(reduceMotion ? nil : .snappy(duration: 0.25)) { app.readerChromeHidden = hidden }
            },
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
                                      textId: st.translation, sourceTabID: tabId, performDestination: finishVerseSheet)
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
                .accessibilityHidden(app.readerChromeHidden)
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
        #if os(iOS)
        if !st.compareMode, let target = editionAvailability?.counterpart(of: ChapterEdition(st)) {
            ToolbarItem(placement: .topBarTrailing) {
                let isLxx = ChapterMap.isLxx(st.translation)
                Button {
                    flipEdition(st, to: target)
                } label: {
                    Image(systemName: "arrow.left.arrow.right")
                        .foregroundStyle(isLxx ? Color.accentColor : Color.primary)
                        .frame(width: 44, height: 44)
                        .contentShape(.rect)
                }
                .buttonStyle(.interactivePlain)
                .glassEffectCompat(interactive: true)
                .opacity(app.readerChromeHidden ? 0 : 1)
                .offset(y: app.readerChromeHidden ? -12 : 0)
                .allowsHitTesting(!app.readerChromeHidden)
                .accessibilityHidden(app.readerChromeHidden)
                .accessibilityLabel("Switch to \(textInfo(target.text).name)")
                .accessibilityAddTraits(isLxx ? .isSelected : [])
            }
            .readerOwnGlassBackground()
        }
        #else
        let hasText = st.compareMode || (loadedChapter == chapterKey(st) && !verses.isEmpty)
        ToolbarItemGroup {
            Button("Scripture Display", systemImage: "textformat.size") {
                displayOptionsShown.toggle()
            }
            .clickableCursor()
            .help("Adjust Scripture font, spacing and width")
            .popover(isPresented: $displayOptionsShown, arrowEdge: .bottom) {
                Form { ScriptureDisplayOptions(); ScriptureAnnotationOptions() }
                    .formStyle(.grouped)
                    .frame(width: 360)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !st.compareMode, let target = editionAvailability?.counterpart(of: ChapterEdition(st)) {
                Toggle(isOn: Binding(get: { ChapterMap.isLxx(st.translation) }, set: { _ in
                    flipEdition(st, to: target)
                })) {
                    Label("LXX", systemImage: "arrow.left.arrow.right")
                }
                .clickableCursor()
                .help("Switch to \(textInfo(target.text).name)")
            }
        }
        if #available(macOS 26.0, *) { ToolbarSpacer(.fixed) }
        ToolbarItemGroup {
            Toggle(isOn: Binding(get: { st.compareMode }, set: { v in mutate { $0.compareMode = v } })) { Label("Compare", systemImage: "rectangle.split.2x1") }
                .clickableCursor()
                .keyboardShortcut("c", modifiers: [.command, .option]).help("Compare texts side by side (⌥⌘C)")
            Toggle(isOn: Binding(get: { st.showStrongs }, set: { v in mutate { $0.showStrongs = v } })) { Label("Strong's Numbers", systemImage: "number") }
                .clickableCursor()
                .help("Show Strong's numbers")
            Toggle(isOn: Binding(get: { st.rightPanelOpen }, set: { v in mutate { $0.rightPanelOpen = v } })) { Label("Study Panel", systemImage: "sidebar.trailing") }
                .clickableCursor()
                .keyboardShortcut("i", modifiers: [.command, .option]).help("Study panel: notes, lexicon, cross references (⌥⌘I)")
        }
        if #available(macOS 26.0, *) { ToolbarSpacer(.fixed) }
        ToolbarItem {
            Menu {
                Button("Tag Chapter", systemImage: "tag") {
                    let target = ChapterTagTarget(st)
                    tagging = (target.ranges, target.label, "chapter")
                }
                .disabled(!hasText)
                Divider()
                ChapterExportActions(state: st, tabId: tabId, hasText: hasText)
            } label: {
                Label("Chapter Actions", systemImage: "square.and.arrow.up")
            }
            .menuIndicator(.hidden)
            .clickableCursor()
            .help("Tag, copy, or share the chapter")
        }
        #endif
    }

    private func flipEdition(_ state: BibleState, to target: ChapterEdition) {
        let source = ChapterEdition(state)
        let preferred = selection.count == 1 ? selection.first.flatMap { verse in
            ChapterMap.verseCounterpart(source.book, chapter: source.chapter, verse: verse,
                                        from: source.text, to: target.text) == nil ? nil : verse
        } : nil
        app.switchChapterEdition(in: tabId, from: source, to: target, position: positionReader.capture(preferred))
    }

    @ViewBuilder private func passageControls(_ st: BibleState) -> some View {
        Button { step(-1) } label: { passageArrow("Previous Chapter", "chevron.backward") }
            .keyboardShortcut(.leftArrow, modifiers: [.command, .option]).help("Previous chapter (⌥⌘←)")
            #if os(macOS)
            .clickableCursor(canStep(-1, from: st))
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
        .clickableCursor()
        #endif
        .accessibilityLabel("\(Reference.readerChapterLabel(st.bookId, st.chapter, textId: st.translation)), \(textInfo(st.translation).name). Choose passage or text")
        .help("Choose book, chapter or text — search every text or see history")
        Button { step(1) } label: { passageArrow("Next Chapter", "chevron.forward") }
            .keyboardShortcut(.rightArrow, modifiers: [.command, .option]).help("Next chapter (⌥⌘→)")
            #if os(macOS)
            .clickableCursor(canStep(1, from: st))
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
            let moved = s.bookId != before.bookId || s.chapter != before.chapter
                || s.translation != before.translation || s.verse != before.verse || s.endVerse != before.endVerse
            if moved || passage != nil {
                t.title = Reference.readerChapterLabel(s.bookId, s.chapter, textId: s.translation)
            }
            if recordHistory && moved { visited = s }
        }
        if let passage {
            app.recordRecent(textId: passage.textId, bookId: passage.bookId, chapter: passage.chapter,
                             verse: passage.verse, endVerse: passage.endVerse, verseGroups: passage.verseGroups)
        } else if let v = visited { app.recordRecent(textId: v.translation, bookId: v.bookId, chapter: v.chapter, verse: v.verse, endVerse: v.endVerse) }
    }

    /// Previous / next chapter by the chapters the book really has (prologue chapter 0, gaps, Hermas numbering), then the
    /// neighbouring book — like bibleNav.ts getPrev/NextChapterRef, generalised from the actual chapter list.
    func step(_ delta: Int, fromPull: Bool = false) {
        chapterStepTask?.cancel()
        guard let source = app.findTab(tabId), app.activeTab?.id == tabId else { return }
        let reader = BibleState(source.state)
        guard canStep(delta, from: reader) else { return }
        chapterStepTask = Task {
            let sourceEdition = ChapterEdition(reader)
            let neighbors: AdjacentChapters
            if let chapterNeighbors, chapterNeighbors.source == sourceEdition {
                neighbors = chapterNeighbors
            } else {
                neighbors = await app.adjacentChapters(to: sourceEdition)
            }
            guard let target = neighbors.destination(delta) else { return }
            // Keep the outgoing passage visible until the replacement is ready.
            if !reader.compareMode { _ = await app.readerChapter(target) }
            guard !Task.isCancelled, let current = app.activeTab, current.id == source.id else { return }
            let destination = BibleState(current.state)
            guard ChapterEdition(destination) == ChapterEdition(reader),
                  destination.compareMode == reader.compareMode,
                  destination.verse == reader.verse, destination.endVerse == reader.endVerse,
                  current.state["nativeSelectedVerses"] == source.state["nativeSelectedVerses"] else { return }
            if !reader.compareMode, let position = positionReader.capture(nil) {
                app.saveScripturePosition(tabId: tabId, edition: sourceEdition, position: position)
            }
            chapterStepArrival = ChapterStepArrival(chapter: target, atEnd: fromPull && delta < 0)
            mutate { $0.bookId = target.book; $0.chapter = target.chapter; $0.verse = nil; $0.endVerse = nil }
            if !reader.compareMode { applyPassageSelection(state, restoringReader: true) }
            #if os(iOS)
            if !fromPull { readerNavigationFeedback() }
            #endif
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
                    app.highlightVerses([verse], color: color, textID: state.translation) { copy(verse, state) }
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
        Button("Compare This Verse") { perform { compareVerse(v, in: st) } }
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

    func showLexicon(_ id: String, verse: Int?, newTab: Bool = false) {
        let reader = state
        app.recordStudyStrongsLookup(id, from: ChapterEdition(reader), verse: verse)
        if newTab {
            app.openLexicon(id, from: app.findTab(tabId))
            app.recordTabReturn(to: tabId)
        } else {
            app.inspectStrongs(id, in: tabId, textId: reader.translation, bookId: reader.bookId, chapter: reader.chapter, verse: verse)
        }
    }
    func openInspector(_ tab: String, verse: Int? = nil, selectedVerses: [Int] = []) {
        if tab == "crossrefs" || tab == "notes" {
            app.focusStudyVerse(verse, in: tabId, selectedVerses: selectedVerses)

        }
        app.update(tabId, recordHistory: false) { source in
            var reader = BibleState(source.state)
            #if os(macOS)
            if tab == "notes", let layout = ScriptureLayout(rawValue: reader.scriptureLayout), !layout.showsNotes {
                reader.scriptureLayout = ScriptureLayout.standard.rawValue
            }
            if tab == "crossrefs", let layout = ScriptureLayout(rawValue: reader.scriptureLayout) {
                switch layout {
                case .reading, .scriptureFocus, .notesBottom, .compareNotes, .notesTop, .commentary, .tripleCol, .splitBottom:
                    reader.scriptureLayout = ScriptureLayout.standard.rawValue
                default:
                    break
                }
            }
            #endif
            reader.rightPanelOpen = true
            source.state = reader.merged(into: source.state)
            if let panel = InspectorTool(rawValue: tab) {
                StudyPanelSlots.focus(panel, in: &source.state)
            }
        }
    }

    private var hideKJVASuppliedWords: Bool {
        hiddenAnnotations.contains(AnnotationFilters.kjvaSuppliedWords)
    }

    private func clipboardVerseText(_ verse: ChapterVerseRow, _ state: BibleState) -> String {
        let visible = verse.hidingTextAnnotations(hiddenAnnotations, textId: state.translation)
        return VerseDisplay.text(visible.text, tagged: visible.textTagged, textId: state.translation,
                          replacerEnabled: app.wordReplacerEnabled, rules: WordReplacer.defaultRules,
                          hideSuppliedWords: hideKJVASuppliedWords)
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
        switch name {
        case "red": return .red
        case "green": return .green
        case "blue": return .blue
        case "purple": return .purple
        case "orange": return .orange
        // Existing notes can carry the additional color names from the web editor.
        case "amber": return Color(red: 251 / 255, green: 191 / 255, blue: 36 / 255)
        case "rose": return Color(red: 251 / 255, green: 113 / 255, blue: 133 / 255)
        case "pink": return Color(red: 244 / 255, green: 114 / 255, blue: 182 / 255)
        case "violet": return Color(red: 167 / 255, green: 139 / 255, blue: 250 / 255)
        case "indigo": return Color(red: 129 / 255, green: 140 / 255, blue: 248 / 255)
        case "sky": return Color(red: 56 / 255, green: 189 / 255, blue: 248 / 255)
        case "cyan": return Color(red: 34 / 255, green: 211 / 255, blue: 238 / 255)
        case "teal": return Color(red: 45 / 255, green: 212 / 255, blue: 191 / 255)
        case "lime": return Color(red: 163 / 255, green: 230 / 255, blue: 53 / 255)
        default: return .yellow
        }
    }
}

private func displayedHighlightRanges(_ highlights: [Highlight], words: [String], original: String) -> [ReaderVerse.Mark] {
    var offset = 0
    let originalWords = original.components(separatedBy: " ")
    let bounds = originalWords.map { word in
        let start = offset
        offset += word.utf16.count + 1
        return start..<(offset - 1)
    }
    let shown = words.joined(separator: " ")
    return highlights.compactMap { highlight in
        let start: Int
        let end: Int
        if let startChar = highlight.startChar, let endChar = highlight.endChar {
            start = startChar
            end = endChar
        } else {
            guard let startWord = highlight.startWord, bounds.indices.contains(startWord) else { return nil }
            let endWord = min(highlight.endWord ?? startWord, bounds.count - 1)
            guard endWord >= startWord else { return nil }
            start = bounds[startWord].lowerBound
            end = bounds[endWord].upperBound
        }
        let mapped = OffsetMap.originalToDisplay(display: shown, original: original, offsets: [start, end])
        guard mapped[0] < mapped[1] else { return nil }
        return .init(start: mapped[0], end: mapped[1], color: highlight.color)
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
    var hideSuppliedWords = false
    var originalText: String?
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
        for mark in displayedHighlightRanges(highlights, words: words, original: originalText ?? row.text) {
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
        let rendered = VerseDisplay.renderTokens(row.text, tagged: tagged, textId: textId, replacerEnabled: replacer, rules: rules,
                                                 hideSuppliedWords: hideSuppliedWords)
        let words: [(String, Bool, Bool, [String])] = rendered.map { t in
            let nums: [String] = { switch t.strongs { case .none: return []; case .one(let s): return [s]; case .many(let a): return a } }()
            return (t.word, t.isItalic, t.isRedLetter, nums)
        }
        let ranges = displayedHighlightRanges(highlights, words: words.map(\.0), original: originalText ?? row.text)
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
    func glassEffectCompat(interactive: Bool = false, backingOpacity: Double = 0) -> some View {
        modifier(ReaderGlassCapsule(interactive: interactive, backingOpacity: backingOpacity))
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

#if os(iOS)
@MainActor func readerNavigationFeedback() {
    guard UserDefaults.standard.object(forKey: "berean.haptics.enabled") as? Bool ?? true else { return }
    UISelectionFeedbackGenerator().selectionChanged()
}
#endif

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
        let hidden = hiddenAnnotations
        let hideSuppliedWords = hidden.contains(AnnotationFilters.kjvaSuppliedWords)
        return verses.map { original in
            let v = original.hidingTextAnnotations(hidden, textId: st.translation)
            var words: [ReaderVerse.Word]
            if let tagged = v.textTagged, !tagged.isEmpty, st.translation == "kjva" || st.translation == "lxx" {
                words = VerseDisplay.renderTokens(v.text, tagged: tagged, textId: st.translation, replacerEnabled: app.wordReplacerEnabled, rules: rules,
                                                  hideSuppliedWords: hideSuppliedWords).map { t in
                    let nums: [String] = { switch t.strongs { case .none: return []; case .one(let s): return [s]; case .many(let a): return a } }()
                    return .init(text: t.word, italic: t.isItalic, red: t.isRedLetter, strongs: nums)
                }
            } else {
                let plain = VerseDisplay.text(v.text, tagged: nil, textId: st.translation, replacerEnabled: app.wordReplacerEnabled, rules: rules)
                words = plain.split(separator: " ", omittingEmptySubsequences: false).map { .init(text: String($0), italic: false, red: false, strongs: []) }
            }
            let marks = displayedHighlightRanges(highlights[v.verseNum] ?? [], words: words.map(\.text), original: original.text)
            let whole = highlights[v.verseNum]?.last { $0.startChar == nil && $0.startWord == nil }
            var rendered = ReaderVerse(verse: v.verseNum, title: v.title, words: words, marks: marks, tint: whole?.color, noteCount: noteCounts[v.verseNum] ?? 0,
                                       tags: (verseTags[v.verseNum] ?? []).map { ($0.name, $0.color, $0.colorSlot) })
            if v.verseNum > 0, let verseCitations, verseCitations.key == chapterKey(st),
               let links = verseCitations.links[v.verseNum], !links.isEmpty {
                rendered.citationCount = links.count
                #if os(macOS)
                rendered.citationPreview = links.prefix(4).map { link in
                    let passage = ResolvedPassage(textId: link.textId, bookId: link.bookId, chapter: link.chapter,
                                                  verse: link.verse, endVerse: link.endVerse)
                    let title = link.note.title.isEmpty ? "Untitled" : link.note.title
                    return "\(passage.label) · \(title)"
                }.joined(separator: "\n")
                #endif
            }
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
        guard let highlights = app.highlights else { return }
        app.attempt("Couldn’t highlight the selection") {
            let change = try highlights.toggle(bookId: row.bookId, chapter: row.chapter, verse: verse,
                                               color: color, textId: st.translation, startChar: o[0], endChar: o[1])
            guard app.autoCopyOnHighlight else { return }
            switch change {
            case .created, .updated: copy(row, st)
            case .removed: break
            }
        }
    }

}

#if os(macOS)
import AppKit

extension ScriptureView {
    private func chapterFindBar(availableWidth: CGFloat) -> some View {
        let compact = availableWidth < 270
        let stacked = availableWidth < 180
        let layout = stacked ? AnyLayout(VStackLayout(alignment: .trailing, spacing: 2))
            : AnyLayout(HStackLayout(spacing: 4))
        return layout {
            HStack(spacing: 6) {
                if !compact {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary).accessibilityHidden(true)
                }
                TextField(compact ? "Find" : "Find in Chapter", text: $chapterFindQuery)
                    .accessibilityLabel("Find in Chapter")
                    .textFieldStyle(.plain)
                    .focused($chapterFindFocused)
                    .onAppear { if !chapterFindAutomatic { chapterFindFocused = true } }
                    .onSubmit { updateChapterFind(step: 1) }
                    .frame(minWidth: 0, maxWidth: .infinity)
            }
            HStack(spacing: 2) {
                if !chapterFindQuery.isEmpty {
                    let count = chapterFindResult.total
                    let status = count == 0 ? "No matches" : "\(chapterFindResult.current) of \(count)"
                    Text(compact ? "\(chapterFindResult.current)/\(count)" : status)
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(.secondary)
                        .fixedSize()
                        .accessibilityLabel(status)
                }
                chapterFindButton("Previous Match", symbol: "chevron.up") { updateChapterFind(step: -1) }
                    .disabled(chapterFindResult.total == 0)
                chapterFindButton("Next Match", symbol: "chevron.down") { updateChapterFind(step: 1) }
                    .disabled(chapterFindResult.total == 0)
                chapterFindButton("Close Find", symbol: "xmark", action: closeChapterFind)
            }
        }
        .padding(.leading, compact ? 8 : 12)
        .padding(.trailing, 5)
        .padding(.vertical, 4)
        .glassEffectCompat(interactive: true)
        .frame(width: max(0, min(390, availableWidth)))
        .onChange(of: chapterFindFocused) { _, focused in
            if focused, chapterFindAutomatic { chapterFindActivity = UUID() }
        }
        .onChange(of: chapterFindQuery) { updateChapterFind() }
        .onExitCommand(perform: closeChapterFind)
        .task(id: chapterFindActivity) {
            guard chapterFindAutomatic else { return }
            do { try await Task.sleep(for: .seconds(6)) } catch { return }
            guard !Task.isCancelled, chapterFindAutomatic else { return }
            closeChapterFind()
        }
    }

    private func chapterFindButton(_ title: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Label(title, systemImage: symbol)
                .labelStyle(.iconOnly)
                .frame(width: 28, height: 26)
                .contentShape(.rect)
        }
        .buttonStyle(.interactivePlain)
        .help(title)
    }

    private func updateChapterFind(step: Int = 0) {
        chapterFindResult = positionReader.find(chapterFindQuery, step)
        chapterFindActivity = UUID()
    }

    private func closeChapterFind() {
        chapterFindVisible = false
        chapterFindFocused = false
        chapterFindAutomatic = false
        chapterFindQuery = ""
        chapterFindResult = positionReader.find("", 0)
    }

    private func handleChapterFindKey(_ event: NSEvent, editing: Bool) -> Bool {
        guard app.activeTab?.id == tabId, !app.commandPaletteShown, !pickerShown,
              !displayOptionsShown, versePopover == nil else { return false }
        let mods = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        let key = event.charactersIgnoringModifiers?.lowercased()
        if mods == [.command], key == "f", !editing || chapterFindFocused {
            chapterFindAutomatic = false
            chapterFindVisible = true
            chapterFindFocused = true
            return true
        }
        if key == "g", mods == [.command] || mods == [.command, .shift], chapterFindVisible,
           !editing || chapterFindFocused {
            updateChapterFind(step: mods.contains(.shift) ? -1 : 1)
            return true
        }
        if chapterFindVisible, event.keyCode == 53, !editing || chapterFindFocused {
            closeChapterFind()
            return true
        }
        if chapterFindVisible, !editing, mods.isEmpty {
            if event.keyCode == 51 {
                if !chapterFindQuery.isEmpty { chapterFindQuery.removeLast() }
                return true
            }
            if event.keyCode == 36 || event.keyCode == 76 {
                updateChapterFind(step: 1)
                return true
            }
        }
        guard !editing, mods.subtracting([.shift, .capsLock]).isEmpty,
              let text = event.characters, !text.isEmpty,
              text.unicodeScalars.allSatisfy({ !CharacterSet.controlCharacters.contains($0) && !(0xF700...0xF8FF).contains($0.value) }),
              chapterFindVisible || !text.trimmingCharacters(in: .whitespaces).isEmpty else { return false }
        if !chapterFindVisible {
            chapterFindAutomatic = true
            chapterFindVisible = true
            chapterFindQuery = text
            updateChapterFind()
        } else {
            chapterFindQuery += text
        }
        return true
    }

    /// The continuous TextKit reader (cross-verse selection, clickable verse numbers / Strong's / tags).
    func macReader(_ st: BibleState, actionClearance: CGFloat, titleBarClearance: CGFloat) -> some View {
        let rv = readerVerses(st)
        let header = ChapterMap.versificationNote(st.bookId, st.chapter, textId: st.translation).map { [$0] } ?? []
        let suffix = st.translation == "lxx" ? " LXX" : ""
        return ChapterTextView(
            passageId: "\(st.translation)|\(st.bookId)|\(st.chapter)",
            header: header, chapterTags: chapterTags.map { ($0.name, $0.color, $0.colorSlot) }, verses: rv,
            style: readerStyle(st),
            selectedVerses: selection, selectionFocus: selectedVerse, scrollTarget: scrollTarget,
            actionClearance: actionClearance,
            animateOutline: !reduceMotion && scenePhase == .active,
            scrollRevision: scrollRevision,
            titleBarClearance: titleBarClearance,
            positionReader: positionReader,
            onFindRefresh: { query, current, total in
                if chapterFindVisible, chapterFindQuery == query {
                    chapterFindResult = (current, total)
                }
            },
            onFindKey: handleChapterFindKey,
            restorePosition: { restoreReaderPosition(st) },
            savePosition: { app.saveScripturePosition(tabId: tabId, edition: ChapterEdition(st), position: $0) },
            selectedVerseCopyText: { plain in selectionText(st, plain: plain) },
            rangeReference: { a, b in "\(referenceChapterLabel(st)):\(a)\(a == b ? "" : "-\(b)")\(suffix)" },
            verseMenu: { verseNSMenu($0, st) },
            tagMenu: { name, v in tagNSMenu(name, verse: v, st) },
            strongsTooltips: st.showStrongs ? strongsTooltips : [:],
            onStrongs: { id, verse in showLexicon(id, verse: verse) },
            onOpenStrongsTab: { id, verse in showLexicon(id, verse: verse, newTab: true) },
            onNotes: { openInspector("notes", verse: $0) },
            onCitations: { verse in
                crossRefSource = "notes"
                openInspector("crossrefs", verse: verse)
            },
            onVerseClick: { v, shift in verseClick(v, shift: shift) },
            onCopySelectedVerses: { confirmSelectionCopy(.verses) },
            canPullChapter: { pullDestination($0, from: st) != nil },
            onChapterPull: { pull in withAnimation(.easeOut(duration: 0.15)) { chapterPull = pull } },
            onChapterPullCommit: { step($0, fromPull: true) },
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
        for color in highlightColors {
            sub.addItem(ClosureMenuItem(color.capitalized) {
                app.highlightVerses([v], color: color, textID: st.translation) { copy(v, st) }
            })
        }
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
        m.addItem(ClosureMenuItem("Compare This Verse", image: "rectangle.split.2x1") { compareVerse(v, in: st) })
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
    let backingOpacity: Double
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    #if os(iOS)
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    #endif

    @ViewBuilder func body(content: Content) -> some View {
        if reduceTransparency {
            content
                .background(opaqueBackground, in: .capsule)
                .overlay {
                    Capsule().strokeBorder(.primary.opacity(0.18))
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
        } else if backingOpacity > 0 {
            glassSurface(content.background(opaqueBackground.opacity(backingOpacity), in: .capsule))
        } else {
            glassSurface(content)
        }
    }

    private var opaqueBackground: Color {
        #if os(iOS)
        Color(uiColor: .systemBackground)
        #else
        Color(nsColor: .windowBackgroundColor)
        #endif
    }

    @ViewBuilder private func glassSurface(_ content: some View) -> some View {
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
    #else
    static let actionSpacing: CGFloat = 2
    static let surfaceHorizontalPadding: CGFloat = 5
    static let actionWidth: CGFloat = 44
    static let actionHeight: CGFloat = 44
    // Keep red-letter text and dark-appearance glyphs legible around the controls without losing the glass rim.
    static let dockBackingOpacity = 0.94
    static let dockButtonHeight: CGFloat = 44
    static let dockSurfacePadding: CGFloat = 3
    static let dockOuterPadding: CGFloat = 4
    static var readerDockHeight: CGFloat { dockButtonHeight + 2 * (dockSurfacePadding + dockOuterPadding) }
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

#if os(macOS)
private struct VerseActionPopover<Actions: View>: View {
    let title: String
    let symbol: String
    let selection: Set<Int>
    @Binding var presented: Bool
    @ViewBuilder let actions: (@escaping () -> Void) -> Actions

    var body: some View {
        Button(title, systemImage: symbol) { presented.toggle() }
            .buttonStyle(VerseActionButtonStyle())
            .popover(isPresented: $presented, arrowEdge: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    actions { presented = false }
                }
                .padding(10)
                .onExitCommand { presented = false }
            }
            .onChange(of: selection) { presented = false }
            .onDisappear { presented = false }
    }
}
#endif

/// Drives the outline only while a reader with selected verses is on screen.
@MainActor final class ReaderOutlineMotion {
    private var timer: Timer?
    private(set) var phase: CGFloat = 0

    func update(active: Bool, redraw: @escaping @MainActor () -> Void) {
        guard active else {
            timer?.invalidate()
            timer = nil
            if phase != 0 {
                phase = 0
                redraw()
            }
            return
        }
        guard timer == nil else { return }
        let started = ProcessInfo.processInfo.systemUptime
        let timer = Timer(timeInterval: 1.0 / 20, repeats: true) { [weak self] timer in
            let active = MainActor.assumeIsolated {
                guard let self else { return false }
                let travel = (ProcessInfo.processInfo.systemUptime - started) * 3
                self.phase = -travel.truncatingRemainder(dividingBy: 7)
                redraw()
                return true
            }
            if !active { timer.invalidate() }
        }
        self.timer = timer
        RunLoop.main.add(timer, forMode: .common)
    }
}

struct ScriptureScrollTarget: Equatable {
    let verse: Int
    let lastSelectedVerse: Int?
    let revision: UUID?
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
            .symbolRenderingMode(.monochrome)
            .foregroundStyle(.primary)
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
            .clickableCursor()
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

/// Try the selected run first, then the newly selected endpoint if the run cannot fit.
func selectionRevealRanges(_ selection: Set<Int>, previous: Set<Int>, focus: Int? = nil, in ranges: [Int: NSRange]) -> [NSRange] {
    let visible = Set(selection.filter { (ranges[$0]?.length ?? 0) > 1 })
    let additions = visible.subtracting(previous)
    guard let first = additions.min(), let last = additions.max() else { return [] }
    let endpoint = focus.flatMap { additions.contains($0) ? $0 : nil }
        ?? (first < (previous.min() ?? first) ? first : last)
    guard let focused = ranges[endpoint] else { return [] }
    guard let run = consecutiveVerseRuns(visible).first(where: { $0.contains(endpoint) }),
          run.lowerBound != run.upperBound,
          let head = ranges[run.lowerBound], let tail = ranges[run.upperBound] else { return [focused] }
    return [NSUnionRange(head, tail), focused]
}

func selectionRevealOffset(lines: ClosedRange<CGFloat>, visible: ClosedRange<CGFloat>, gap: CGFloat) -> CGFloat? {
    guard lines.upperBound - lines.lowerBound + 2 * gap <= visible.upperBound - visible.lowerBound else {
        return nil
    }
    if lines.lowerBound - gap < visible.lowerBound { return lines.lowerBound - gap - visible.lowerBound }
    if lines.upperBound + gap > visible.upperBound { return lines.upperBound + gap - visible.upperBound }
    return 0
}

/// Feedback for controls whose layout already supplies the visible button shape.
struct InteractivePlainButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(isEnabled ? (configuration.isPressed ? 0.65 : 1) : 0.45)
            #if os(macOS)
            .clickableCursor()
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
        modifier(ClickableCursorModifier(requested: enabled))
        #else
        self
        #endif
    }
}

#if os(macOS)
private struct ClickableCursorModifier: ViewModifier {
    let requested: Bool
    @Environment(\.isEnabled) private var isEnabled

    func body(content: Content) -> some View {
        content
            .pointerStyle(requested && isEnabled ? .link : .default)
            .background { ClickableCursorRegion(enabled: requested && isEnabled) }
    }
}
#endif

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

#if os(iOS)
private extension ToolbarContent {
    /// The reader supplies its own fading glass; a system platter would stay
    /// visible as an empty circle after the controls tuck away.
    @ToolbarContentBuilder
    func readerOwnGlassBackground() -> some ToolbarContent {
        if #available(iOS 26.0, *) {
            self.sharedBackgroundVisibility(.hidden)
        } else {
            self
        }
    }
}
#endif
