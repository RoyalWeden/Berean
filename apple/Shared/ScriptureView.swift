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
    @State private var verses: [ChapterVerseRow] = []
    @State private var selectedVerse: Int?
    /// Verses selected by clicking verse numbers (⇧-click extends from `anchor`), as in the existing reader.
    @State private var selection: Set<Int> = []
    @State private var anchor: Int?
    @State private var noteCounts: [Int: Int] = [:]
    @State private var highlights: [Int: [Highlight]] = [:]
    @State private var pickerShown = false
    @State private var scrollTarget: Int?
    @State private var verseTags: [Int: [TagLite]] = [:]
    @State private var chapterTags: [TagLite] = []
    @State private var tagging: (ranges: [TagRange], label: String, kind: String)?

    var state: BibleState { BibleState(app.findTab(tabId)?.state ?? JSObject()) }

    var body: some View {
        let st = state
        Group {
            if st.compareMode { CompareView(tabId: tabId) } else { chapterBody(st) }
        }
        .navigationTitle(Reference.bookChapterLabel(st.bookId, chapter: Double(st.chapter)))
        .navigationSubtitleCompat(st.compareMode ? "Compare" : (textInfo(st.translation).name))
        .toolbar { toolbar(st) }
    }

    @ViewBuilder func chapterBody(_ st: BibleState) -> some View {
        ScrollViewReader { proxy in
            Group {
                #if os(macOS)
                macReader(st)
                #else
                rowsScroll(st)
                #endif
            }
            .onChange(of: selectedVerse) { _, v in if v != state.verse { mutate { $0.verse = v } } }
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
                verses = await app.bible.queryChapter(st.bookId, st.chapter, textId: st.translation)
                selectedVerse = st.verse
                selection = st.verse.map { [$0] } ?? []; anchor = st.verse
                if let v = st.verse { try? await Task.sleep(for: .milliseconds(50)); proxy.scrollTo(v, anchor: .top) }
                scrollTarget = st.verse
            }
        }
        .overlay(alignment: .bottom) { selectionBar(st).animation(.snappy(duration: 0.2), value: selection) }
        .overlay { if verses.isEmpty { ContentUnavailableView("No text", systemImage: "book.closed", description: Text("This passage is not in the selected text.")) } }
    }

    // MARK: verse selection (click / ⇧-click verse numbers)

    func verseClick(_ v: Int, shift: Bool) {
        if shift, let a = anchor {
            selection = Set(min(a, v)...max(a, v)).intersection(verses.map(\.verseNum))
        } else if selection.contains(v) {
            selection.remove(v)
        } else {
            selection.insert(v)
        }
        anchor = v
        selectedVerse = selection.isEmpty ? nil : v
    }

    var selectedRows: [ChapterVerseRow] { verses.filter { selection.contains($0.verseNum) } }

    /// "John 3:16", "John 3:16-18", "John 3:16, 18"
    func selectionLabel(_ st: BibleState) -> String {
        let vs = selection.sorted()
        guard let f = vs.first, let l = vs.last else { return "" }
        let base = "\(Reference.bookName(st.bookId)) \(Reference.displayChapterString(st.bookId, st.chapter)):"
        if vs.count == l - f + 1 { return base + (f == l ? "\(f)" : "\(f)-\(l)") }
        return base + vs.map(String.init).joined(separator: ", ")
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
        guard let first = rows.first, let last = rows.last else { return }
        let text = { (v: ChapterVerseRow) in VerseDisplay.text(v.text, tagged: v.textTagged, textId: st.translation, replacerEnabled: app.wordReplacerEnabled, rules: WordReplacer.defaultRules) }
        let suffix = st.translation == "lxx" ? " LXX" : ""
        if plain { Clipboard.copy(rows.map(text).joined(separator: " ")); return }
        let head = "\(Reference.bookName(st.bookId)) \(Reference.displayChapterString(st.bookId, st.chapter)):\(first.verseNum)\(rows.count > 1 ? "-\(last.verseNum)" : "")\(suffix)"
        Clipboard.copy(([head] + rows.map { "\($0.verseNum) \(text($0))" }).joined(separator: "\n"))
    }

    /// The bar shown while verses are selected: what is selected and what can be done with it.
    @ViewBuilder func selectionBar(_ st: BibleState) -> some View {
        if !selection.isEmpty {
            HStack(spacing: 4) {
                Text(selectionLabel(st)).font(.callout.weight(.semibold)).lineLimit(1).padding(.horizontal, 8)
                Divider().frame(height: 18)
                Button { copySelection(st, plain: false) } label: { Label("Copy", systemImage: "doc.on.doc") }.help("Copy with reference (⌘C)")
                Menu {
                    ForEach(highlightColors, id: \.self) { c in
                        Button { for v in selectedRows { try? app.highlights?.toggle(bookId: v.bookId, chapter: v.chapter, verse: v.verseNum, color: c, textId: st.translation) } } label: { Label(c.capitalized, systemImage: "circle.fill") }
                    }
                    Divider()
                    Button("Remove Highlights") { for v in selectedRows { try? app.highlights?.remove(bookId: v.bookId, chapter: v.chapter, verse: v.verseNum, textId: st.translation) } }
                } label: { Label("Highlight", systemImage: "highlighter") }.menuIndicator(.hidden).fixedSize()
                Button { tagging = (selectionRanges(st), selectionLabel(st), "verses") } label: { Label("Tag", systemImage: "tag") }.help("Tag these verses")
                Button { if let v = selectedRows.first { app.newNote(verseRef: "\(v.bookId).\(v.chapter).\(v.verseNum)", textId: st.translation) } } label: { Label("Note", systemImage: "square.and.pencil") }.help("New note on \(selectionLabel(st))")
                Button { openInspector("crossrefs") } label: { Label("Cross References", systemImage: "arrow.triangle.branch") }.help("Cross references")
                Divider().frame(height: 18)
                Button { selection = []; anchor = nil; selectedVerse = nil } label: { Label("Clear Selection", systemImage: "xmark") }
                    .keyboardShortcut(.cancelAction).help("Clear selection (Esc)")
            }
            .labelStyle(.iconOnly)
            .buttonStyle(.borderless)
            .padding(.horizontal, 8).padding(.vertical, 6)
            .glassEffectCompat()
            .padding(.bottom, 14)
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Selected \(selectionLabel(st))")
        }
    }

    /// iPhone reader: one row per verse (tap a verse number for its actions).
    func rowsScroll(_ st: BibleState) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 6) {
                if let note = ChapterMap.versificationNote(st.bookId, st.chapter, textId: st.translation) {
                    Text(note).font(.callout).foregroundStyle(.secondary).padding(.bottom, 6)
                }
                if !chapterTags.isEmpty {
                    FlowChips(tags: chapterTags) { t in removeMenu(t, bookId: st.bookId, chapter: st.chapter, verse: nil) }
                        .padding(.horizontal, 8).padding(.bottom, 4)
                        .accessibilityLabel("Chapter tags")
                }
                ForEach(verses, id: \.verseNum) { v in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Button { verseClick(v.verseNum, shift: false) } label: {
                            VStack(alignment: .trailing, spacing: 2) {
                                Text("\(v.verseNum)").font(.system(.caption, design: .rounded).weight(.semibold))
                                    .foregroundStyle(selection.contains(v.verseNum) ? Color.accentColor : .secondary)
                                if let n = noteCounts[v.verseNum] {
                                    Text(n > 1 ? "●\(n)" : "●").font(.system(size: 8)).foregroundStyle(.tint)
                                }
                            }
                            .frame(minWidth: 28, minHeight: 28, alignment: .topTrailing)
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Verse \(v.verseNum)\(selection.contains(v.verseNum) ? ", selected" : "")")
                        .accessibilityHint("Tap to select. Touch and hold the verse for highlight, tag, note and more.")
                        VStack(alignment: .leading, spacing: 2) {
                            VerseRowView(row: v, textId: st.translation, showStrongs: st.showStrongs, highlights: (highlights[v.verseNum] ?? []).filter { $0.startChar != nil },
                                         fontSize: app.fontSize, lineSpacing: app.lineSpacing, replacer: app.wordReplacerEnabled, family: app.scriptureFontFamily)
                            if let tags = verseTags[v.verseNum], !tags.isEmpty {
                                FlowChips(tags: tags) { t in removeMenu(t, bookId: v.bookId, chapter: v.chapter, verse: v.verseNum) }
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.vertical, 3).padding(.horizontal, 8)
                    .background(RoundedRectangle(cornerRadius: 8).fill(rowTint(v.verseNum)))
                    .id(v.verseNum)
                    .contextMenu { verseActions(v, st) }
                }
            }
            .frame(maxWidth: 760)
            .padding(.horizontal, 24).padding(.vertical, 16)
            .frame(maxWidth: .infinity)
        }
        .environment(\.openURL, OpenURLAction { url in
            if url.scheme == "strongs" { showLexicon(url.absoluteString.replacingOccurrences(of: "strongs:", with: "")); return .handled }
            return .systemAction
        })
    }

    @ToolbarContentBuilder
    func toolbar(_ st: BibleState) -> some ToolbarContent {
        // History Back / Forward live in the window toolbar beside the sidebar button (MacRootView), for every tab type.
        // The passage pill: ‹ Book Chapter · Text › — previous / next chapter around the passage navigator.
        ToolbarItem(placement: .principal) {
            ControlGroup {
                Button { step(-1) } label: { Label("Previous Chapter", systemImage: "chevron.backward") }
                    .keyboardShortcut(.leftArrow, modifiers: [.command, .option]).help("Previous chapter (⌥⌘←)")
                Button { pickerShown.toggle() } label: {
                    Text("\(Reference.bookChapterLabel(st.bookId, chapter: Double(st.chapter)))\(textInfo(st.translation).section == "Bible" ? "  " : "")\(Text(textInfo(st.translation).section == "Bible" ? textInfo(st.translation).short : "").foregroundStyle(.secondary))")
                        .fontWeight(.semibold)
                }
                .accessibilityLabel("\(Reference.bookChapterLabel(st.bookId, chapter: Double(st.chapter))), \(textInfo(st.translation).name). Choose passage or text")
                .help("Choose book, chapter or text — search every text, see history (⌘L)")
                Button { step(1) } label: { Label("Next Chapter", systemImage: "chevron.forward") }
                    .keyboardShortcut(.rightArrow, modifiers: [.command, .option]).help("Next chapter (⌥⌘→)")
            }
            .controlGroupStyle(.navigation)
            #if os(macOS)
            .popover(isPresented: $pickerShown, arrowEdge: .bottom) { picker(st, compact: false) }
            #else
            .sheet(isPresented: $pickerShown) { NavigationStack { picker(st, compact: true).navigationTitle("Go to").navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { pickerShown = false } } } }.presentationDetents([.large]) }
            #endif
        }
        ToolbarItemGroup {
            Toggle(isOn: Binding(get: { st.compareMode }, set: { v in mutate { $0.compareMode = v } })) { Label("Compare", systemImage: "rectangle.split.2x1") }
                .keyboardShortcut("c", modifiers: [.command, .option]).help("Compare texts side by side (⌥⌘C)")
            Toggle(isOn: Binding(get: { st.showStrongs }, set: { v in mutate { $0.showStrongs = v } })) { Label("Strong's Numbers", systemImage: "number") }
                .help("Show Strong's numbers")
            Toggle(isOn: Binding(get: { st.rightPanelOpen }, set: { v in mutate { $0.rightPanelOpen = v } })) { Label("Study Panel", systemImage: "sidebar.trailing") }
                .keyboardShortcut("i", modifiers: [.command, .option]).help("Study panel: notes, lexicon, cross references (⌥⌘I)")
        }
    }

    func picker(_ st: BibleState, compact: Bool) -> some View {
        PassagePicker(textId: st.translation, currentBook: st.bookId, currentChapter: st.chapter, onPick: { t, b, c, v in
            mutate { $0.translation = t; $0.bookId = b; $0.chapter = c; $0.verse = v }; pickerShown = false
        }, compact: compact)
    }

    /// Selection tint, else the colour of a whole-verse highlight (word-range highlights tint the row too, faintly).
    func rowTint(_ verse: Int) -> Color {
        if selection.contains(verse) { return Color.accentColor.opacity(0.16) }
        if let h = highlights[verse]?.last(where: { $0.startChar == nil }) { return Color.highlight(h.color).opacity(h.startWord == nil ? 0.28 : 0.12) }
        return .clear
    }

    func mutate(_ f: (inout BibleState) -> Void) {
        var visited: BibleState?
        app.update(tabId) { t in
            let before = BibleState(t.state)
            var s = before; f(&s)
            t.state = s.merged(into: t.state)
            t.title = Reference.bookChapterLabel(s.bookId, chapter: Double(s.chapter))
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
    @ViewBuilder func verseActions(_ v: ChapterVerseRow, _ st: BibleState) -> some View {
        Button("Copy Verse") { copy(v, st) }
        Menu("Highlight") {
            ForEach(highlightColors, id: \.self) { c in
                Button { try? app.highlights?.toggle(bookId: v.bookId, chapter: v.chapter, verse: v.verseNum, color: c, textId: st.translation) } label: { Label(c.capitalized, systemImage: "circle.fill") }
            }
            Divider()
            Button("Remove Highlights") { try? app.highlights?.remove(bookId: v.bookId, chapter: v.chapter, verse: v.verseNum, textId: st.translation) }
        }
        Button("Tag Verse…") {
            tagging = ([TagRange(bookId: v.bookId, chapter: Double(v.chapter), spans: [(Double(v.verseNum), Double(v.verseNum))])],
                       Reference.bookChapterVerseLabel(v.bookId, chapter: v.chapter, verse: v.verseNum), "verses")
        }
        Button("Tag Chapter…") {
            tagging = ([TagRange(bookId: v.bookId, chapter: Double(v.chapter), whole: true)], Reference.bookChapterLabel(v.bookId, chapter: Double(v.chapter)), "chapter")
        }
        Button("Add Note") { app.newNote(verseRef: "\(v.bookId).\(v.chapter).\(v.verseNum)", textId: st.translation) }
        Button("Verse Notes") { selectedVerse = v.verseNum; openInspector("notes") }
        Button("Cross References") { selectedVerse = v.verseNum; openInspector("crossrefs") }
        Button("Open in New Tab") { app.openScripture(bookId: v.bookId, chapter: v.chapter, verse: v.verseNum, textId: st.translation) }
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
    func openInspector(_ tab: String) { mutate { $0.rightPanelOpen = true; $0.rightPanelTab = tab } }

    func copy(_ v: ChapterVerseRow, _ st: BibleState) {
        let text = VerseDisplay.text(v.text, tagged: v.textTagged, textId: st.translation, replacerEnabled: true, rules: WordReplacer.defaultRules)
        let label = Reference.bookChapterVerseLabel(v.bookId, chapter: v.chapter, verse: v.verseNum)
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
                if w.2 { a.foregroundColor = .red }
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

#if os(macOS)
import AppKit

extension ScriptureView {
    /// The continuous TextKit reader (cross-verse selection, clickable verse numbers / Strong's / tags).
    func macReader(_ st: BibleState) -> some View {
        let rules = app.wordReplacerEnabled ? WordReplacer.defaultRules : []
        let rv: [ReaderVerse] = verses.map { v in
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
        let header = ChapterMap.versificationNote(st.bookId, st.chapter, textId: st.translation).map { [$0] } ?? []
        let suffix = st.translation == "lxx" ? " LXX" : ""
        return ChapterTextView(
            passageId: "\(st.translation)|\(st.bookId)|\(st.chapter)",
            header: header, chapterTags: chapterTags.map { ($0.name, $0.color, $0.colorSlot) }, verses: rv,
            style: ReaderStyle(fontSize: app.fontSize, lineSpacing: app.lineSpacing, family: app.scriptureFontFamily, showStrongs: st.showStrongs),
            selectedVerses: selection, scrollTarget: scrollTarget,
            reference: { Reference.bookChapterVerseLabel(st.bookId, chapter: st.chapter, verse: $0) + suffix },
            rangeReference: { a, b in "\(Reference.bookName(st.bookId)) \(Reference.displayChapterString(st.bookId, st.chapter)):\(a)\(a == b ? "" : "-\(b)")\(suffix)" },
            verseMenu: { verseNSMenu($0, st) },
            tagMenu: { name, v in tagNSMenu(name, verse: v, st) },
            onStrongs: { showLexicon($0) },
            onVerseClick: { v, shift in verseClick(v, shift: shift) })
    }

    func verseNSMenu(_ n: Int, _ st: BibleState) -> NSMenu {
        let m = NSMenu()
        guard let v = verses.first(where: { $0.verseNum == n }) else { return m }
        let label = Reference.bookChapterVerseLabel(v.bookId, chapter: v.chapter, verse: v.verseNum)
        let header = NSMenuItem(title: label, action: nil, keyEquivalent: ""); header.isEnabled = false
        m.addItem(header)
        if selection.count > 1, selection.contains(n) {
            m.addItem(ClosureMenuItem("Copy \(selectionLabel(st))", image: "doc.on.doc") { copySelection(st, plain: false) })
            m.addItem(ClosureMenuItem("Tag \(selectionLabel(st))…", image: "tag") { tagging = (selectionRanges(st), selectionLabel(st), "verses") })
            m.addItem(.separator())
        }
        m.addItem(ClosureMenuItem(selection.contains(n) ? "Deselect Verse" : "Select Verse", image: "checkmark.circle") { verseClick(n, shift: false) })
        m.addItem(ClosureMenuItem("Copy Verse", image: "doc.on.doc") { copy(v, st) })
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
            tagging = ([TagRange(bookId: v.bookId, chapter: Double(v.chapter), whole: true)], Reference.bookChapterLabel(v.bookId, chapter: Double(v.chapter)), "chapter")
        })
        m.addItem(.separator())
        m.addItem(ClosureMenuItem("Add Note", image: "square.and.pencil") { app.newNote(verseRef: "\(v.bookId).\(v.chapter).\(v.verseNum)", textId: st.translation) })
        m.addItem(ClosureMenuItem("Verse Notes") { selectedVerse = v.verseNum; openInspector("notes") })
        m.addItem(ClosureMenuItem("Cross References", image: "arrow.triangle.branch") { selectedVerse = v.verseNum; openInspector("crossrefs") })
        m.addItem(.separator())
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
