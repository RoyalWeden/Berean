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
    @State private var noteCounts: [Int: Int] = [:]
    @State private var highlights: [Int: [Highlight]] = [:]
    @State private var pickerShown = false

    var state: BibleState { BibleState(app.findTab(tabId)?.state ?? JSObject()) }

    var body: some View {
        let st = state
        Group {
            if st.compareMode { CompareView(tabId: tabId) } else { chapterBody(st) }
        }
        .navigationTitle(Reference.bookChapterLabel(st.bookId, chapter: Double(st.chapter)))
        .navigationSubtitleCompat(st.compareMode ? "Compare" : (availableTexts.first { $0.id == st.translation }?.name ?? st.translation))
        .toolbar { toolbar(st) }
    }

    @ViewBuilder func chapterBody(_ st: BibleState) -> some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 6) {
                    if let note = ChapterMap.versificationNote(st.bookId, st.chapter, textId: st.translation) {
                        Text(note).font(.callout).foregroundStyle(.secondary).padding(.bottom, 6)
                    }
                    ForEach(verses, id: \.verseNum) { v in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Button { selectedVerse = selectedVerse == v.verseNum ? nil : v.verseNum } label: {
                                VStack(alignment: .trailing, spacing: 2) {
                                    Text("\(v.verseNum)").font(.system(.caption, design: .rounded).weight(.semibold)).foregroundStyle(.secondary)
                                    if let n = noteCounts[v.verseNum] {
                                        Text(n > 1 ? "●\(n)" : "●").font(.system(size: 8)).foregroundStyle(.tint)
                                    }
                                }
                                .frame(minWidth: 22, alignment: .trailing)
                            }
                            .buttonStyle(.plain)
                            .help("Select verse")
                            VerseRowView(row: v, textId: st.translation, showStrongs: st.showStrongs, highlights: (highlights[v.verseNum] ?? []).filter { $0.startChar != nil },
                                         fontSize: app.fontSize, lineSpacing: app.lineSpacing, replacer: app.wordReplacerEnabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .padding(.vertical, 3).padding(.horizontal, 8)
                        .background(RoundedRectangle(cornerRadius: 8).fill(rowTint(v.verseNum)))
                        .id(v.verseNum)
                        .contextMenu {
                            Button("Copy Verse") { copy(v, st) }
                            Menu("Highlight") {
                                ForEach(highlightColors, id: \.self) { c in
                                    Button { try? app.highlights?.toggle(bookId: v.bookId, chapter: v.chapter, verse: v.verseNum, color: c, textId: st.translation) } label: { Label(c.capitalized, systemImage: "circle.fill") }
                                }
                                Divider()
                                Button("Remove Highlights") { try? app.highlights?.remove(bookId: v.bookId, chapter: v.chapter, verse: v.verseNum, textId: st.translation) }
                            }
                            Button("Add Note") { app.newNote(verseRef: "\(v.bookId).\(v.chapter).\(v.verseNum)", textId: st.translation) }
                            Button("Verse Notes") { selectedVerse = v.verseNum; openInspector("notes") }
                            Button("Cross References") { selectedVerse = v.verseNum; openInspector("crossrefs") }
                            Button("Open in New Tab") { app.openScripture(bookId: v.bookId, chapter: v.chapter, verse: v.verseNum, textId: st.translation) }
                        }
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
            .onChange(of: selectedVerse) { _, v in if v != state.verse { mutate { $0.verse = v } } }
            .task(id: "\(st.translation)|\(st.bookId)|\(st.chapter)|\(app.notesRevision)") {
                noteCounts = (try? app.notes?.chapterCounts(st.bookId, st.chapter, textId: st.translation)) ?? [:]
            }
            .task(id: "\(st.translation)|\(st.bookId)|\(st.chapter)|\(app.highlightsRevision)") {
                highlights = (try? app.highlights?.chapter(st.bookId, st.chapter, textId: st.translation)) ?? [:]
            }
            .task(id: "\(st.translation)|\(st.bookId)|\(st.chapter)") {
                verses = await app.bible.queryChapter(st.bookId, st.chapter, textId: st.translation)
                selectedVerse = st.verse
                if let v = st.verse { try? await Task.sleep(for: .milliseconds(50)); proxy.scrollTo(v, anchor: .top) }
            }
        }
        .overlay { if verses.isEmpty { ContentUnavailableView("No text", systemImage: "book.closed", description: Text("This passage is not in the selected text.")) } }
    }

    @ToolbarContentBuilder
    func toolbar(_ st: BibleState) -> some ToolbarContent {
        #if os(macOS)
        // History (the tab's own back/forward) — as in the existing toolbar, separate from chapter stepping.
        ToolbarItemGroup(placement: .navigation) {
            Button { app.goBack() } label: { Label("Back", systemImage: "arrow.left") }.disabled(!app.canGoBack).help("Back (⌘[)")
            Button { app.goForward() } label: { Label("Forward", systemImage: "arrow.right") }.disabled(!app.canGoForward).help("Forward (⌘])")
        }
        // The passage pill: ‹ Book Chapter ⌄ › — previous / next chapter around the book & chapter picker.
        ToolbarItem(placement: .principal) {
            ControlGroup {
                Button { step(-1) } label: { Label("Previous Chapter", systemImage: "chevron.backward") }
                    .keyboardShortcut(.leftArrow, modifiers: [.command, .option]).help("Previous chapter (⌥⌘←)")
                Button { pickerShown.toggle() } label: {
                    // One Text: toolbar buttons flatten stacked label views.
                    Text("\(Reference.bookChapterLabel(st.bookId, chapter: Double(st.chapter)))  \(Image(systemName: "chevron.down"))")
                        .fontWeight(.semibold)
                }
                .accessibilityLabel("\(Reference.bookChapterLabel(st.bookId, chapter: Double(st.chapter))). Choose book and chapter")
                .help("Choose book and chapter")
                Button { step(1) } label: { Label("Next Chapter", systemImage: "chevron.forward") }
                    .keyboardShortcut(.rightArrow, modifiers: [.command, .option]).help("Next chapter (⌥⌘→)")
            }
            .controlGroupStyle(.navigation)
            .popover(isPresented: $pickerShown, arrowEdge: .bottom) {
                PassagePicker(textId: st.translation, currentBook: st.bookId, currentChapter: st.chapter) { b, c in
                    mutate { $0.bookId = b; $0.chapter = c; $0.verse = nil }; pickerShown = false
            }
                }
        }
        #else
        ToolbarItemGroup(placement: .navigation) {
            Button { step(-1) } label: { Label("Previous Chapter", systemImage: "chevron.backward") }
            Button { step(1) } label: { Label("Next Chapter", systemImage: "chevron.forward") }
        }
        #endif
        ToolbarItemGroup {
            Menu {
                Picker("Text", selection: Binding(get: { st.translation }, set: { v in mutate { $0.translation = v } })) {
                    ForEach(availableTexts) { Text($0.name).tag($0.id) }
                }
            } label: { Label(availableTexts.first { $0.id == st.translation }?.short ?? "Text", systemImage: "books.vertical").labelStyle(.titleAndIcon) }
            .help("Bible text: \(availableTexts.first { $0.id == st.translation }?.name ?? st.translation)")
            Toggle(isOn: Binding(get: { st.compareMode }, set: { v in mutate { $0.compareMode = v } })) { Label("Compare", systemImage: "rectangle.split.2x1") }
                .keyboardShortcut("c", modifiers: [.command, .option])
            Toggle(isOn: Binding(get: { st.showStrongs }, set: { v in mutate { $0.showStrongs = v } })) { Label("Strong's Numbers", systemImage: "number") }
            Toggle(isOn: Binding(get: { st.rightPanelOpen }, set: { v in mutate { $0.rightPanelOpen = v } })) { Label("Study Panel", systemImage: "sidebar.trailing") }
                .keyboardShortcut("i", modifiers: [.command, .option])
        }
    }

    /// Selection tint, else the colour of a whole-verse highlight (word-range highlights tint the row too, faintly).
    func rowTint(_ verse: Int) -> Color {
        if selectedVerse == verse { return Color.accentColor.opacity(0.14) }
        if let h = highlights[verse]?.last(where: { $0.startChar == nil }) { return Color.highlight(h.color).opacity(h.startWord == nil ? 0.28 : 0.12) }
        return .clear
    }

    func mutate(_ f: (inout BibleState) -> Void) {
        app.update(tabId) { t in
            var s = BibleState(t.state); f(&s)
            t.state = s.merged(into: t.state)
            t.title = Reference.bookChapterLabel(s.bookId, chapter: Double(s.chapter))
        }
    }

    func step(_ delta: Int) {
        Task {
            let st = state
            let books = await app.books(for: st.translation)
            guard let i = books.firstIndex(where: { $0.id == st.bookId }) else { return }
            let next = st.chapter + delta
            if next >= 1 && next <= books[i].chaptersCount { mutate { $0.chapter = next; $0.verse = nil } }
            else if delta > 0, i + 1 < books.count { mutate { $0.bookId = books[i + 1].id; $0.chapter = 1; $0.verse = nil } }
            else if delta < 0, i > 0 { mutate { $0.bookId = books[i - 1].id; $0.chapter = books[i - 1].chaptersCount; $0.verse = nil } }
        }
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

    var body: some View {
        Text(attributed)
            .font(.system(size: fontSize, design: .serif))
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
                if w.1 { a.font = .system(size: fontSize, design: .serif).italic() }
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
