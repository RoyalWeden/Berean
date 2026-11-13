import SwiftUI
import BereanCore
import BereanBible
import BereanText
import BereanReference
import BereanWorkspace
import BereanNotes

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
    @State private var highlights: [Int: [Highlight]] = [:]
    @State private var pickerShown = false
    @AppStorage("showVerseNumbers") private var showVerseNumbers = true
    @AppStorage("showRedLetters") private var showRedLetters = true
    @State private var scrollTarget: Int?
    @State private var verseTags: [Int: [TagLite]] = [:]
    @State private var chapterTags: [TagLite] = []
    @State private var tagging: (ranges: [TagRange], label: String, kind: String)?

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
        var id: Int { row.verseNum }
    }
    @State private var tappedTag: TappedTag?
    @State private var tappedVerse: TappedVerse?
    @State private var afterVerseSheet: (() -> Void)?
    #endif

    var state: BibleState { BibleState(app.findTab(tabId)?.state ?? JSObject()) }

    var body: some View {
        let st = state
        Group {
            if st.compareMode { CompareView(tabId: tabId) } else { chapterBody(st) }
        }
        .navigationTitle(Reference.readerChapterLabel(st.bookId, st.chapter, textId: st.translation))
        .navigationSubtitleCompat(st.compareMode ? "Compare" : textInfo(st.translation).name)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackgroundVisibility(.hidden, for: .navigationBar)
        #endif
        .toolbar { toolbar(st) }
    }

    private func chapterKey(_ state: BibleState) -> String {
        "\(state.translation)|\(state.bookId)|\(state.chapter)"
    }

    @ViewBuilder func chapterBody(_ st: BibleState) -> some View {
        let chapter = chapterKey(st)
        Group {
            if loadedChapter == chapter {
                #if os(macOS)
                macReader(st)
                #else
                iosReader(st)
                #endif
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .onChange(of: SelectionDestination(st)) { _, destination in
            let appliedLocally = pendingSelectionDestination == destination
            pendingSelectionDestination = nil
            if appliedLocally { return }
            guard loadedChapter == chapter else { return }
            applyPassageSelection(st)
        }
        .task(id: "\(st.translation)|\(st.bookId)|\(st.chapter)|\(app.notesRevision)") {
            noteCounts = (try? app.notes?.chapterCounts(st.bookId, st.chapter, textId: st.translation)) ?? [:]
        }
        .task(id: "\(st.bookId)|\(st.chapter)|\(app.tagsRevision)") {
            if let r = try? app.verseTags?.forChapter(st.bookId, st.chapter) { verseTags = r.verseTags; chapterTags = r.chapterTags } else { verseTags = [:]; chapterTags = [] }
        }
        .sheet(isPresented: Binding(get: { tagging != nil }, set: { if !$0 { tagging = nil } })) {
            if let t = tagging { TagPickerView(ranges: t.ranges, label: t.label, kind: t.kind) }
        }
        .task(id: "\(st.translation)|\(st.bookId)|\(st.chapter)|\(app.highlightsRevision)") {
            highlights = (try? app.highlights?.chapter(st.bookId, st.chapter, textId: st.translation)) ?? [:]
        }
        .task(id: chapter) {
            let loaded = await app.bible.queryChapter(st.bookId, st.chapter, textId: st.translation)
            let destination = state
            guard !Task.isCancelled, chapterKey(destination) == chapter else { return }
            verses = loaded
            applyPassageSelection(destination)
            loadedChapter = chapter
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            Color.clear.frame(height: 0)
                .overlay(alignment: .bottom) {
                    #if os(iOS)
                    if loadedChapter == chapter { selectionBar(st).padding(.bottom, ReaderFloatingControls.dockOffset) }
                    #else
                    if loadedChapter == chapter { selectionBar(st) }
                    #endif
                }
        }
        .overlay { if loadedChapter == chapter, verses.isEmpty { ContentUnavailableView("No text", systemImage: "book.closed", description: Text("This passage is not in the selected text.")) } }
    }

    // MARK: verse selection (click / ⇧-click verse numbers)

    private func applyPassageSelection(_ state: BibleState) {
        selectedVerse = state.verse
        anchor = state.verse
        scrollTarget = state.verse
        guard let first = state.verse else {
            selection = []
            return
        }
        let last = max(first, state.endVerse ?? first)
        let chapterVerses = Set(verses.map(\.verseNum))
        let saved = app.findTab(tabId)?.state["nativeSelectedVerses"]
        let savedVerses = saved?["passage"]?.stringValue?.string == chapterKey(state)
            && saved?["activeVerse"]?.numberValue == Double(first)
            ? saved?["verses"]?.arrayValue : nil
        let restored = Set((savedVerses ?? []).compactMap { $0.numberValue.flatMap(Int.init(exactly:)) })
            .intersection(chapterVerses)
        if state.endVerse == nil, restored.contains(first) {
            selection = restored
        } else {
            selection = Set(chapterVerses.filter { (first...last).contains($0) })
        }
    }

    func verseClick(_ v: Int, shift: Bool) {
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

    /// "John 3:16", "John 3:16-18", "John 3:16, 18"
    func selectionLabel(_ st: BibleState) -> String {
        let vs = selection.sorted()
        guard let f = vs.first, let l = vs.last else { return "" }
        let base = "\(referenceChapterLabel(st)):"
        if vs.count == l - f + 1 { return base + (f == l ? "\(f)" : "\(f)-\(l)") }
        return base + vs.map(String.init).joined(separator: ", ")
    }

    private func referenceChapterLabel(_ st: BibleState) -> String {
        if Reference.isHermasBook(st.bookId) {
            return Reference.readerChapterLabel(st.bookId, st.chapter, textId: st.translation)
        }
        return "\(Reference.bookName(st.bookId)) \(Reference.displayChapterString(st.bookId, st.chapter))"
    }

    /// Consecutive verse runs → tag spans.
    func selectionRanges(_ st: BibleState) -> [TagRange] {
        var spans: [(Double, Double)] = []
        for v in selection.sorted() {
            if let last = spans.last, Int(last.1) + 1 == v { spans[spans.count - 1].1 = Double(v) } else { spans.append((Double(v), Double(v))) }
        }
        return [TagRange(bookId: st.bookId, chapter: Double(st.chapter), spans: spans)]
    }

    func copySelection(_ st: BibleState, plain: Bool) {
        if let text = selectionText(st, plain: plain) { Clipboard.copy(text) }
    }

    private func selectionText(_ state: BibleState, plain: Bool = false) -> String? {
        let rows = selectedRows
        guard !rows.isEmpty else { return nil }
        if plain { return rows.map { clipboardVerseText($0, state) }.joined(separator: " ") }
        let reference = selectionReference(state)
        return ([reference] + rows.map { "\($0.verseNum) \(clipboardVerseText($0, state))" }).joined(separator: "\n")
    }

    private func addNoteForSelection(_ state: BibleState) {
        guard let first = selectedRows.first else { return }
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
        app.newNote(verseRef: "\(first.bookId).\(first.chapter).\(first.verseNum)",
                    textId: state.translation, title: selectionLabel(state), content: links.joined(separator: "\n\n"))
    }

    private func selectionReference(_ state: BibleState) -> String {
        selectionLabel(state) + (state.translation == "lxx" ? " LXX" : "")
    }

    private func selectionCopyButton(_ action: CopyAction, state: BibleState) -> some View {
        let copied = copiedAction == action
        let title = action == .verses ? "Copy Verses" : "Copy Reference"
        let symbol = action == .verses ? "doc.on.doc" : "number"
        return Button {
            let text = action == .verses ? selectionText(state) : selectionReference(state)
            guard let text, !text.isEmpty else { return }
            Clipboard.copy(text)
            copiedAction = action
            copyFeedbackID = UUID()
            AccessibilityNotification.Announcement(action == .verses ? "Verses copied" : "Reference copied").post()
        } label: {
            Label(title, systemImage: copied ? "checkmark" : symbol)
                .foregroundStyle(copied ? Color.accentColor : Color.primary)
        }
    }

    @ViewBuilder func selectionBar(_ st: BibleState) -> some View {
        if !selection.isEmpty {
            ViewThatFits(in: .horizontal) {
                verseActionRow(st)
                HStack(spacing: 2) {
                    selectionCopyButton(.verses, state: st)
                    highlightMenu(st)
                    compactVerseMenu(st)
                    clearSelectionButton
                }
                .fixedSize(horizontal: true, vertical: false)
                HStack(spacing: 2) {
                    Menu {
                        selectionCopyButton(.verses, state: st)
                        highlightMenu(st, iconOnly: false)
                        additionalVerseActions(st)
                    } label: {
                        verseMenuLabel("Verse Actions", symbol: "ellipsis")
                    }
                    .menuIndicator(.hidden)
                    clearSelectionButton
                }
                .fixedSize(horizontal: true, vertical: false)
            }
            .labelStyle(.iconOnly)
            .buttonStyle(VerseActionButtonStyle())
            .padding(.horizontal, 5)
            .padding(.vertical, ReaderFloatingControls.surfacePadding)
            .glassEffectCompat(interactive: true)
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

    private func verseActionRow(_ st: BibleState) -> some View {
        HStack(spacing: 2) {
            selectionCopyButton(.verses, state: st)
                .verseActionHelp("Copy with reference (⌘C)")
            highlightMenu(st).verseActionHelp("Highlight")
            Button("Tag Verses", systemImage: "tag") {
                tagging = (selectionRanges(st), selectionLabel(st), "verses")
            }
            .verseActionHelp("Tag verses")
            #if os(macOS)
            selectionCopyButton(.reference, state: st).help("Copy selected verse reference")
            Button("Add Note", systemImage: "square.and.pencil") {
                addNoteForSelection(st)
            }
            .help("Add note")
            Button("Cross References", systemImage: "arrow.triangle.branch") {
                openInspector("crossrefs", verse: state.verse ?? selection.min())
            }
                .help("Cross references")
            if let text = selectionText(st) {
                ShareLink(item: text) {
                    Label("Share Verses…", systemImage: "square.and.arrow.up")
                }
                .help("Share selected verses")
                .pointerStyle(.link)
            }
            #else
            if selectedRows.count == 1, let row = selectedRows.first {
                Button("More Verse Actions", systemImage: "ellipsis") {
                    tappedVerse = TappedVerse(row: row)
                }
            } else {
                Menu {
                    selectionCopyButton(.reference, state: st)
                    if let text = selectionText(st) {
                        ShareLink(item: text) { Label("Share Verses…", systemImage: "square.and.arrow.up") }
                    }
                    if !selectedRows.isEmpty {
                        Button("Add Note", systemImage: "square.and.pencil") { addNoteForSelection(st) }
                        Button("Cross References", systemImage: "arrow.triangle.branch") {
                            openInspector("crossrefs", verse: state.verse ?? selection.min())
                        }
                    }
                } label: {
                    verseMenuLabel("More Verse Actions", symbol: "ellipsis")
                }
                .menuIndicator(.hidden)
            }
            #endif
            Divider().frame(height: 16).padding(.horizontal, 3)
            clearSelectionButton
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    private func compactVerseMenu(_ st: BibleState) -> some View {
        Menu {
            additionalVerseActions(st)
        } label: {
            verseMenuLabel("More Verse Actions", symbol: "ellipsis")
        }
        .menuIndicator(.hidden)
    }

    @ViewBuilder private func additionalVerseActions(_ st: BibleState) -> some View {
        selectionCopyButton(.reference, state: st)
        #if os(iOS)
        if selectedRows.count == 1, let row = selectedRows.first {
            Button("All Verse Actions", systemImage: "list.bullet") {
                tappedVerse = TappedVerse(row: row)
            }
        }
        #endif
        Button("Tag Verses", systemImage: "tag") {
            tagging = (selectionRanges(st), selectionLabel(st), "verses")
        }
        if !selectedRows.isEmpty {
            Button("Add Note", systemImage: "square.and.pencil") { addNoteForSelection(st) }
            Button("Cross References", systemImage: "arrow.triangle.branch") {
                openInspector("crossrefs", verse: state.verse ?? selection.min())
            }
        }
        if let text = selectionText(st) {
            ShareLink(item: text) { Label("Share Verses…", systemImage: "square.and.arrow.up") }
        }
    }

    private func verseMenuLabel(_ title: String, symbol: String) -> some View {
        Label(title, systemImage: symbol)
            .labelStyle(.iconOnly)
            .contentShape(.rect)
            #if os(macOS)
            .pointerStyle(.link)
            #else
            .hoverEffect(.highlight)
            #endif
    }

    private var clearSelectionButton: some View {
        Button("Clear Selection", systemImage: "xmark") { clearVerseSelection() }
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

    private func highlightMenu(_ st: BibleState, iconOnly: Bool = true) -> some View {
        Menu {
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
        .menuIndicator(.hidden)
        #if os(macOS)
        .pointerStyle(.link)
        #else
        .hoverEffect(.highlight)
        #endif
    }

    #if os(iOS)
    func iosReader(_ st: BibleState) -> some View {
        let rv = readerVerses(st)
        return IOSChapterTextView(
            passageId: "\(st.translation)|\(st.bookId)|\(st.chapter)",
            header: ChapterMap.versificationNote(st.bookId, st.chapter, textId: st.translation),
            chapterTags: chapterTags.map { ($0.name, $0.color, $0.colorSlot) },
            verses: rv,
            style: readerStyle(st),
            selectedVerses: selection.union(tappedVerse.map { [$0.row.verseNum] } ?? []),
            scrollTarget: scrollTarget,
            findRequest: findRequest,
            reference: { first, last in
                let suffix = st.translation == "lxx" ? " LXX" : ""
                let label = Reference.bookChapterVerseLabel(st.bookId, chapter: st.chapter, verse: first, hermas: HermasText(textId: st.translation))
                return label + (first == last ? "" : "-\(last)") + suffix
            },
            onStrongs: { showLexicon($0) },
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
            onStep: { step($0) }
        )
        .sheet(item: $tappedVerse, onDismiss: {
            let action = afterVerseSheet
            afterVerseSheet = nil
            action?()
        }) { item in
            NavigationStack {
                List {
                    verseActions(item.row, st, perform: { action in
                        afterVerseSheet = action
                        tappedVerse = nil
                    })
                }
                    .navigationTitle(Reference.bookChapterVerseLabel(st.bookId, chapter: st.chapter, verse: item.row.verseNum, hermas: HermasText(textId: st.translation)))
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { tappedVerse = nil } } }
            }
            .presentationDetents([.medium, .large])
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
        ToolbarItemGroup {
            Toggle(isOn: Binding(get: { st.compareMode }, set: { v in mutate { $0.compareMode = v } })) { Label("Compare", systemImage: "rectangle.split.2x1") }
                .keyboardShortcut("c", modifiers: [.command, .option]).help("Compare texts side by side (⌥⌘C)")
            Toggle(isOn: Binding(get: { st.showStrongs }, set: { v in mutate { $0.showStrongs = v } })) { Label("Strong's Numbers", systemImage: "number") }
                .help("Show Strong's numbers")
            Toggle(isOn: Binding(get: { st.rightPanelOpen }, set: { v in mutate { $0.rightPanelOpen = v } })) { Label("Study Panel", systemImage: "sidebar.trailing") }
                .keyboardShortcut("i", modifiers: [.command, .option]).help("Study panel: notes, lexicon, cross references (⌥⌘I)")
        }
        #endif
    }

    @ViewBuilder private func passageControls(_ st: BibleState) -> some View {
        Button { step(-1) } label: { passageArrow("Previous Chapter", "chevron.backward") }
            .keyboardShortcut(.leftArrow, modifiers: [.command, .option]).help("Previous chapter (⌥⌘←)")
        Button { pickerShown.toggle() } label: {
            HStack(spacing: 5) {
                Text(Reference.readerChapterLabel(st.bookId, st.chapter, textId: st.translation))
                    .fontWeight(.semibold)
                    .lineLimit(1)
                Text(textInfo(st.translation).short)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            #if os(iOS)
            .padding(.horizontal, 4)
            .frame(minHeight: 44)
            .contentShape(.rect)
            #endif
        }
        .accessibilityLabel("\(Reference.readerChapterLabel(st.bookId, st.chapter, textId: st.translation)), \(textInfo(st.translation).name). Choose passage or text")
        .help("Choose book, chapter or text — search every text, see history (⌘L)")
        Button { step(1) } label: { passageArrow("Next Chapter", "chevron.forward") }
            .keyboardShortcut(.rightArrow, modifiers: [.command, .option]).help("Next chapter (⌥⌘→)")
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
        PassagePicker(textId: st.translation, currentBook: st.bookId, currentChapter: st.chapter, onPick: { t, b, c, v, end in
            mutate { $0.translation = t; $0.bookId = b; $0.chapter = c; $0.verse = v; $0.endVerse = end }; pickerShown = false
        }, compact: compact)
    }

    func mutate(recordHistory: Bool = true, _ f: (inout BibleState) -> Void) {
        var visited: BibleState?
        app.update(tabId, recordHistory: recordHistory) { t in
            let before = BibleState(t.state)
            var s = before; f(&s)
            t.state = s.merged(into: t.state)
            t.title = Reference.readerChapterLabel(s.bookId, s.chapter, textId: s.translation)
            if recordHistory, s.bookId != before.bookId || s.chapter != before.chapter
                || s.translation != before.translation || s.verse != before.verse || s.endVerse != before.endVerse {
                visited = s
            }
        }
        if let v = visited { app.recordRecent(textId: v.translation, bookId: v.bookId, chapter: v.chapter, verse: v.verse, endVerse: v.endVerse) }
    }

    /// Previous / next chapter by the chapters the book really has (prologue chapter 0, gaps, Hermas numbering), then the
    /// neighbouring book — like bibleNav.ts getPrev/NextChapterRef, generalised from the actual chapter list.
    func step(_ delta: Int) {
        Task {
            let st = state
            let chapters = await app.bible.chapterNumbers(st.bookId, textId: st.translation)
            if let i = chapters.firstIndex(of: st.chapter), chapters.indices.contains(i + delta) {
                let c = chapters[i + delta]; mutate { $0.chapter = c; $0.verse = nil; $0.endVerse = nil }; return
            }
            let books = await app.books(for: st.translation)
            guard let bi = books.firstIndex(where: { $0.id == st.bookId }), books.indices.contains(bi + delta) else { return }
            let nb = books[bi + delta]
            let list = await app.bible.chapterNumbers(nb.id, textId: st.translation)
            guard let c = delta > 0 ? list.first : list.last else { return }
            mutate { $0.bookId = nb.id; $0.chapter = c; $0.verse = nil; $0.endVerse = nil }
        }
    }

    /// The verse actions (the existing app's verse action popover): verse-number menu and row context menu.
    @ViewBuilder func verseActions(_ v: ChapterVerseRow, _ st: BibleState,
                                    perform: @escaping (@escaping () -> Void) -> Void = { $0() }) -> some View {
        let label = Reference.bookChapterVerseLabel(v.bookId, chapter: v.chapter, verse: v.verseNum, hermas: HermasText(textId: st.translation))
        Button("Copy Verse") { perform { copy(v, st) } }
        ShareLink(item: verseWithReference(v, st)) {
            Label("Share Verse…", systemImage: "square.and.arrow.up")
        }
        Button("Copy Reference") { perform { Clipboard.copy(label + (st.translation == "lxx" ? " LXX" : "")) } }
        Menu("Highlight") {
            ForEach(highlightColors, id: \.self) { c in
                Button { perform { try? app.highlights?.setVerseColor(bookId: v.bookId, chapter: v.chapter, verse: v.verseNum, color: c, textId: st.translation) } } label: { Label(c.capitalized, systemImage: "circle.fill") }
            }
            Divider()
            Button("Remove Highlights") { perform { try? app.highlights?.remove(bookId: v.bookId, chapter: v.chapter, verse: v.verseNum, textId: st.translation) } }
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
        Button("Verse Notes") { perform { openInspector("notes", verse: v.verseNum) } }
        Button("Cross References") { perform { openInspector("crossrefs", verse: v.verseNum) } }
        Button("Compare This Verse") { perform { mutate { $0.verse = v.verseNum; $0.endVerse = nil; $0.compareMode = true } } }
        Button("Open in New Tab") { perform { app.openScripture(bookId: v.bookId, chapter: v.chapter, verse: v.verseNum, textId: st.translation) } }
    }

    /// A chip's menu: remove the tag group(s) that cover this verse (or chapter).
    @ViewBuilder func removeMenu(_ tag: TagLite, bookId: String, chapter: Int, verse: Int?) -> some View {
        let members = ((try? app.verseTags?.members([tag.id])) ?? []).filter { m in
            verse.map { v in m.verses.contains { $0.bookId == bookId && $0.chapter == chapter && $0.verse == v } }
                ?? m.wholeChapters.contains { $0.bookId == bookId && $0.chapter == chapter }
        }
        ForEach(members) { m in
            Button("Remove “\(m.label)” from #\(tag.name)", role: .destructive) { try? app.verseTags?.removeMember(m.memberId) }
        }
        Button("Search #\(tag.name)") { app.openQuery("#\(tag.name)") }
    }

    func showLexicon(_ id: String) {
        let reader = state
        app.recordHistory(type: "strongs-click", title: id, bookId: reader.bookId,
                          chapter: reader.chapter, strongsNum: id)
        mutate { $0.rightPanelOpen = true; $0.rightPanelTab = "lexicon"; $0.rightPanelLexiconEntry = id }
    }
    func openInspector(_ tab: String, verse: Int? = nil) {
        if let verse, verse != state.verse, !selection.contains(verse) {
            writeLocalSelectionDestination(SelectionDestination(verse: verse, endVerse: nil))
        }
        mutate(recordHistory: false) {
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

    var attributed: AttributedString {
        var out = AttributedString()
        if let title = row.title, !title.isEmpty {
            var t = AttributedString(title + "\n"); t.font = .callout.italic(); t.foregroundColor = .secondary
            out = t + out
        }
        let rules = replacer ? WordReplacer.defaultRules : []
        guard let tagged = row.textTagged, !tagged.isEmpty, textId == "kjva" || textId == "lxx" else {
            out += AttributedString(VerseDisplay.text(row.text, tagged: nil, textId: textId, replacerEnabled: replacer, rules: rules))
            return out
        }
        let rendered = VerseDisplay.renderTokens(row.text, tagged: tagged, textId: textId, replacerEnabled: replacer, rules: rules)
        let words: [(String, Bool, Bool, [String])] = rendered.map { t in
            let nums: [String] = { switch t.strongs { case .none: return []; case .one(let s): return [s]; case .many(let a): return a } }()
            return (t.word, t.isItalic, t.isRedLetter, nums)
        }
        // Stored character highlights are offsets into verse.text; map them onto the displayed words.
        let shown = words.map(\.0).joined(separator: " ")
        let ranges: [(Int, Int, String)] = highlights.compactMap { h in
            guard let s = h.startChar, let e = h.endChar else { return nil }
            let off = OffsetMap.originalToDisplay(display: shown, original: row.text, offsets: [s, e])
            return (off[0], off[1], h.color)
        }
        var pos = 0
        for (i, w) in words.enumerated() {
            if i > 0 { var sp = AttributedString(" "); if ranges.contains(where: { $0.0 <= pos && pos < $0.1 }) { sp.backgroundColor = Color.highlight(ranges.first { $0.0 <= pos && pos < $0.1 }!.2).opacity(0.35) }; out += sp; pos += 1 }
            let units = Array(w.0.utf16)
            var k = 0
            while k < units.count {
                let p = pos + k
                let hit = ranges.last { $0.0 <= p && p < $0.1 }
                var j = k + 1
                while j < units.count, (ranges.last { $0.0 <= pos + j && pos + j < $0.1 })?.2 == hit?.2 { j += 1 }
                var a = AttributedString(String(decoding: units[k..<j], as: UTF16.self))
                if w.1 { a.font = ScriptureFont.font(family, size: fontSize).italic() }
                if w.2 && showRedLetters { a.foregroundColor = .red }
                if let hit { a.backgroundColor = Color.highlight(hit.2).opacity(0.35) }
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
    @ViewBuilder func glassEffectCompat(interactive: Bool = false) -> some View {
        if #available(iOS 26, macOS 26, *) {
            glassEffect(.regular.interactive(interactive), in: .capsule)
        } else {
            background(.regularMaterial, in: .capsule)
        }
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
            let shown = words.map(\.text).joined(separator: " ")
            let marks: [ReaderVerse.Mark] = (highlights[v.verseNum] ?? []).compactMap { h in
                guard let s = h.startChar, let e = h.endChar else { return nil }
                let off = OffsetMap.originalToDisplay(display: shown, original: v.text, offsets: [s, e])
                return .init(start: off[0], end: off[1], color: h.color)
            }
            let whole = highlights[v.verseNum]?.last { $0.startChar == nil }
            return ReaderVerse(verse: v.verseNum, title: v.title, words: words, marks: marks, tint: whole?.color, noteCount: noteCounts[v.verseNum] ?? 0,
                               tags: (verseTags[v.verseNum] ?? []).map { ($0.name, $0.color, $0.colorSlot) })
        }
    }

    func readerStyle(_ st: BibleState) -> ReaderStyle {
        ReaderStyle(fontSize: app.fontSize, lineSpacing: app.lineSpacing, family: app.scriptureFontFamily,
                    showStrongs: st.showStrongs, showVerseNumbers: showVerseNumbers, redLetters: showRedLetters)
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
    func macReader(_ st: BibleState) -> some View {
        let rv = readerVerses(st)
        let header = ChapterMap.versificationNote(st.bookId, st.chapter, textId: st.translation).map { [$0] } ?? []
        let suffix = st.translation == "lxx" ? " LXX" : ""
        return ChapterTextView(
            passageId: "\(st.translation)|\(st.bookId)|\(st.chapter)",
            header: header, chapterTags: chapterTags.map { ($0.name, $0.color, $0.colorSlot) }, verses: rv,
            style: readerStyle(st),
            selectedVerses: selection, scrollTarget: scrollTarget,
            selectionReference: { selectionLabel(st) + suffix },
            rangeReference: { a, b in "\(referenceChapterLabel(st)):\(a)\(a == b ? "" : "-\(b)")\(suffix)" },
            verseMenu: { verseNSMenu($0, st) },
            tagMenu: { name, v in tagNSMenu(name, verse: v, st) },
            strongsTooltips: st.showStrongs ? strongsTooltips : [:],
            onStrongs: { showLexicon($0) },
            onVerseClick: { v, shift in verseClick(v, shift: shift) },
            onHighlightRange: { verse, a, b, color in highlightRange(verse, a, b, color, st, rv) })
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
        m.addItem(ClosureMenuItem("Copy Reference", image: "number") { Clipboard.copy(label + (st.translation == "lxx" ? " LXX" : "")) })
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
            for mem in members { m.addItem(ClosureMenuItem("Remove “\(mem.label)” from #\(name)") { try? app.verseTags?.removeMember(mem.memberId) }) }
        }
        m.addItem(ClosureMenuItem("Search #\(name)", image: "magnifyingglass") { app.openQuery("#\(name)") })
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

enum ReaderFloatingControls {
    #if os(macOS)
    static let actionHeight: CGFloat = 32
    static let dockOffset: CGFloat = 0
    static let readingGap: CGFloat = 2
    #else
    static let actionHeight: CGFloat = 44
    static let dockOffset: CGFloat = 58
    static let readingGap: CGFloat = 2
    #endif

    static let surfacePadding: CGFloat = 3
    static let bottomPadding: CGFloat = 8
    static var scrollClearance: CGFloat {
        dockOffset + actionHeight + 2 * surfacePadding + bottomPadding + readingGap
    }
}

private struct VerseActionButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .medium))
            #if os(macOS)
            .frame(width: 38, height: ReaderFloatingControls.actionHeight)
            #else
            .frame(width: 44, height: ReaderFloatingControls.actionHeight)
            #endif
            .contentShape(.rect)
            #if os(macOS)
            .pointerStyle(.link)
            #else
            .hoverEffect(.highlight)
            #endif
            .opacity(configuration.isPressed ? 0.55 : 1)
    }
}


// Group consecutive verse numbers so a continuous selection draws a single outline.
func selectedVerseRanges(_ selection: Set<Int>, in ranges: [Int: NSRange]) -> [NSRange] {
    var runs: [NSRange] = []
    var previous: Int?
    for verse in selection.sorted() {
        guard let range = ranges[verse] else { continue }
        if previous == verse - 1, let last = runs.popLast() {
            runs.append(NSUnionRange(last, range))
        } else {
            runs.append(range)
        }
        previous = verse
    }
    return runs
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
