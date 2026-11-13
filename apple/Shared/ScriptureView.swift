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
    @State private var verses: [ChapterVerseRow] = []
    @State private var selectedVerse: Int?
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

    @ViewBuilder func chapterBody(_ st: BibleState) -> some View {
        Group {
            #if os(macOS)
            macReader(st)
            #else
            iosReader(st)
            #endif
        }
        #if os(macOS)
        .onChange(of: selectedVerse) { _, v in if v != state.verse { mutate { $0.verse = v } } }
        #endif
        .onChange(of: st.verse) { _, verse in
            guard verse != selectedVerse else { return }
            selectedVerse = verse
            selection = verse.map { [$0] } ?? []
            anchor = verse
            scrollTarget = verse
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
        .task(id: "\(st.translation)|\(st.bookId)|\(st.chapter)") {
            let loaded = await app.bible.queryChapter(st.bookId, st.chapter, textId: st.translation)
            guard !Task.isCancelled else { return }
            verses = loaded
            selectedVerse = st.verse
            selection = st.verse.map { [$0] } ?? []; anchor = st.verse
            scrollTarget = st.verse
        }
        #if os(macOS)
        .safeAreaInset(edge: .bottom, spacing: 0) { selectionBar(st) }
        #else
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if !selection.isEmpty {
                selectionBar(st).padding(.bottom, 58)
            }
        }
        #endif
        .overlay { if verses.isEmpty { ContentUnavailableView("No text", systemImage: "book.closed", description: Text("This passage is not in the selected text.")) } }
    }

    // MARK: verse selection (click / ⇧-click verse numbers)

    func verseClick(_ v: Int, shift: Bool) {
        if shift, let a = anchor {
            selection = Set(min(a, v)...max(a, v)).intersection(verses.map(\.verseNum))
        } else {
            if selection.contains(v) { selection.remove(v) } else { selection.insert(v) }
            anchor = v
        }
        selectedVerse = selection.contains(v) ? v : selection.min()
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
        let rows = selectedRows
        guard !rows.isEmpty else { return }
        let text = { (v: ChapterVerseRow) in VerseDisplay.text(v.text, tagged: v.textTagged, textId: st.translation, replacerEnabled: app.wordReplacerEnabled, rules: WordReplacer.defaultRules) }
        let suffix = st.translation == "lxx" ? " LXX" : ""
        if plain { Clipboard.copy(rows.map(text).joined(separator: " ")); return }
        let head = selectionLabel(st) + suffix
        Clipboard.copy(([head] + rows.map { "\($0.verseNum) \(text($0))" }).joined(separator: "\n"))
    }

    @ViewBuilder func selectionBar(_ st: BibleState) -> some View {
        if !selection.isEmpty {
            HStack(spacing: 2) {
                Button("Copy Verses", systemImage: "doc.on.doc") { copySelection(st, plain: false) }
                    .verseActionHelp("Copy with reference (⌘C)")
                highlightMenu(st).verseActionHelp("Highlight")
                Button("Tag Verses", systemImage: "tag") {
                    tagging = (selectionRanges(st), selectionLabel(st), "verses")
                }
                .verseActionHelp("Tag verses")
                #if os(macOS)
                Button("Add Note", systemImage: "square.and.pencil") {
                    if let verse = selectedRows.first {
                        app.newNote(verseRef: "\(verse.bookId).\(verse.chapter).\(verse.verseNum)", textId: st.translation)
                    }
                }
                .help("Add note")
                Button("Cross References", systemImage: "arrow.triangle.branch") {
                    openInspector("crossrefs", verse: selectedVerse)
                }
                    .help("Cross references")
                #else
                if selectedRows.count == 1, let row = selectedRows.first {
                    Button("More Verse Actions", systemImage: "ellipsis") {
                        tappedVerse = TappedVerse(row: row)
                    }
                }
                #endif
                Divider().frame(height: 16).padding(.horizontal, 3)
                Button("Clear Selection", systemImage: "xmark") { clearVerseSelection() }
                    .foregroundStyle(.secondary)
                    #if os(macOS)
                    .keyboardShortcut(.cancelAction)
                    .help("Clear selection (Esc)")
                    #endif
            }
            .labelStyle(.iconOnly)
            .buttonStyle(VerseActionButtonStyle())
            .padding(.horizontal, 5)
            .padding(.vertical, 3)
            .glassEffectCompat()
            .padding(.horizontal, 8)
            .padding(.bottom, 6)
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Selected \(selectionLabel(st))")
        }
    }

    private func clearVerseSelection() {
        selection = []
        anchor = nil
        selectedVerse = nil
    }

    private func highlightMenu(_ st: BibleState) -> some View {
        Menu {
            ForEach(highlightColors, id: \.self) { color in
                Button(color.capitalized, systemImage: "circle.fill") {
                    for row in selectedRows {
                        #if os(iOS)
                        let existing = highlights[row.verseNum] ?? []
                        guard !existing.contains(where: {
                            $0.startChar == nil && $0.startWord == nil && $0.color == color
                        }) else { continue }
                        #endif
                        try? app.highlights?.toggle(bookId: row.bookId, chapter: row.chapter, verse: row.verseNum,
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
            Label("Highlight", systemImage: "highlighter")
        }
        .menuIndicator(.hidden)
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
                .buttonStyle(.plain)
                .padding(.horizontal, 8)
                .glassEffectCompat()
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
        PassagePicker(textId: st.translation, currentBook: st.bookId, currentChapter: st.chapter, onPick: { t, b, c, v in
            mutate { $0.translation = t; $0.bookId = b; $0.chapter = c; $0.verse = v }; pickerShown = false
        }, compact: compact)
    }

    func mutate(_ f: (inout BibleState) -> Void) {
        var visited: BibleState?
        app.update(tabId) { t in
            let before = BibleState(t.state)
            var s = before; f(&s)
            t.state = s.merged(into: t.state)
            t.title = Reference.readerChapterLabel(s.bookId, s.chapter, textId: s.translation)
            if s.bookId != before.bookId || s.chapter != before.chapter || s.translation != before.translation { visited = s }
        }
        if let v = visited { app.recordRecent(textId: v.translation, bookId: v.bookId, chapter: v.chapter, verse: v.verse) }
    }

    /// Previous / next chapter by the chapters the book really has (prologue chapter 0, gaps, Hermas numbering), then the
    /// neighbouring book — like bibleNav.ts getPrev/NextChapterRef, generalised from the actual chapter list.
    func step(_ delta: Int) {
        Task {
            let st = state
            let chapters = await app.bible.chapterNumbers(st.bookId, textId: st.translation)
            if let i = chapters.firstIndex(of: st.chapter), chapters.indices.contains(i + delta) {
                let c = chapters[i + delta]; mutate { $0.chapter = c; $0.verse = nil }; return
            }
            let books = await app.books(for: st.translation)
            guard let bi = books.firstIndex(where: { $0.id == st.bookId }), books.indices.contains(bi + delta) else { return }
            let nb = books[bi + delta]
            let list = await app.bible.chapterNumbers(nb.id, textId: st.translation)
            guard let c = delta > 0 ? list.first : list.last else { return }
            mutate { $0.bookId = nb.id; $0.chapter = c; $0.verse = nil }
        }
    }

    /// The verse actions (the existing app's verse action popover): verse-number menu and row context menu.
    @ViewBuilder func verseActions(_ v: ChapterVerseRow, _ st: BibleState,
                                    perform: @escaping (@escaping () -> Void) -> Void = { $0() }) -> some View {
        let label = Reference.bookChapterVerseLabel(v.bookId, chapter: v.chapter, verse: v.verseNum, hermas: HermasText(textId: st.translation))
        Button("Copy Verse") { perform { copy(v, st) } }
        Button("Copy Reference") { perform { Clipboard.copy(label + (st.translation == "lxx" ? " LXX" : "")) } }
        Menu("Highlight") {
            ForEach(highlightColors, id: \.self) { c in
                Button { perform { try? app.highlights?.toggle(bookId: v.bookId, chapter: v.chapter, verse: v.verseNum, color: c, textId: st.translation) } } label: { Label(c.capitalized, systemImage: "circle.fill") }
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
        Button("Compare This Verse") { perform { mutate { $0.verse = v.verseNum; $0.compareMode = true } } }
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

    func showLexicon(_ id: String) { mutate { $0.rightPanelOpen = true; $0.rightPanelTab = "lexicon"; $0.rightPanelLexiconEntry = id } }
    func openInspector(_ tab: String, verse: Int? = nil) {
        mutate {
            if let verse { $0.verse = verse }
            $0.rightPanelOpen = true
            $0.rightPanelTab = tab
        }
    }

    func copy(_ v: ChapterVerseRow, _ st: BibleState) {
        let text = VerseDisplay.text(v.text, tagged: v.textTagged, textId: st.translation, replacerEnabled: true, rules: WordReplacer.defaultRules)
        let label = Reference.bookChapterVerseLabel(v.bookId, chapter: v.chapter, verse: v.verseNum, hermas: HermasText(textId: st.translation))
        Clipboard.copy("\(label) \(text)")
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
    @ViewBuilder func glassEffectCompat() -> some View {
        if #available(iOS 26, macOS 26, *) { self.glassEffect(.regular, in: .capsule) } else { self.background(.regularMaterial, in: .capsule) }
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
            m.addItem(ClosureMenuItem("Tag \(selectionLabel(st))…", image: "tag") { tagging = (selectionRanges(st), selectionLabel(st), "verses") })
            m.addItem(.separator())
        }
        m.addItem(ClosureMenuItem(selection.contains(n) ? "Deselect Verse" : "Select Verse", image: "checkmark.circle") { verseClick(n, shift: false) })
        m.addItem(ClosureMenuItem("Copy Verse", image: "doc.on.doc") { copy(v, st) })
        m.addItem(ClosureMenuItem("Copy Reference", image: "number") { Clipboard.copy(label + (st.translation == "lxx" ? " LXX" : "")) })
        let hl = NSMenuItem(title: "Highlight", action: nil, keyEquivalent: ""); hl.image = NSImage(systemSymbolName: "highlighter", accessibilityDescription: nil)
        let sub = NSMenu()
        for c in highlightColors { sub.addItem(ClosureMenuItem(c.capitalized) { try? app.highlights?.toggle(bookId: v.bookId, chapter: v.chapter, verse: v.verseNum, color: c, textId: st.translation) }) }
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
        m.addItem(ClosureMenuItem("Compare This Verse", image: "rectangle.split.2x1") { selection = [v.verseNum]; anchor = v.verseNum; mutate { $0.verse = v.verseNum; $0.compareMode = true } })
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

private struct VerseActionButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 15, weight: .medium))
            #if os(macOS)
            .frame(width: 38, height: 32)
            #else
            .frame(width: 44, height: 44)
            #endif
            .contentShape(.rect)
            .opacity(configuration.isPressed ? 0.55 : 1)
    }
}
