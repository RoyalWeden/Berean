import SwiftUI
import BereanCore
import BereanBible
import BereanText
import BereanReference
import BereanWorkspace

/// A Scripture tab: chapter text with KJV italics and red letter, the word replacer's restorations (Yehovah,
/// Yeshua, …) on by default as in the existing app, optional Strong's numbers that open the lexicon, and a
/// selectable verse that drives the study inspector.
struct ScriptureView: View {
    @Environment(AppModel.self) private var app
    let tabId: String
    @State private var verses: [ChapterVerseRow] = []
    @State private var selectedVerse: Int?
    @State private var noteCounts: [Int: Int] = [:]
    @State private var referenceText = ""
    @FocusState private var referenceFocused: Bool

    var state: BibleState { BibleState(app.findTab(tabId)?.state ?? JSObject()) }

    var body: some View {
        let st = state
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
                            VerseRowView(row: v, textId: st.translation, showStrongs: st.showStrongs)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .padding(.vertical, 3).padding(.horizontal, 8)
                        .background(RoundedRectangle(cornerRadius: 8).fill(selectedVerse == v.verseNum ? Color.accentColor.opacity(0.14) : .clear))
                        .id(v.verseNum)
                        .contextMenu {
                            Button("Copy Verse") { copy(v, st) }
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
            .task(id: "\(st.translation)|\(st.bookId)|\(st.chapter)") {
                verses = await app.bible.queryChapter(st.bookId, st.chapter, textId: st.translation)
                selectedVerse = st.verse
                if let v = st.verse { try? await Task.sleep(for: .milliseconds(50)); proxy.scrollTo(v, anchor: .top) }
            }
        }
        .navigationTitle(Reference.bookChapterLabel(st.bookId, chapter: Double(st.chapter)))
        .navigationSubtitleCompat(availableTexts.first { $0.id == st.translation }?.name ?? st.translation)
        .toolbar { toolbar(st) }
        .overlay { if verses.isEmpty { ContentUnavailableView("No text", systemImage: "book.closed", description: Text("This passage is not in the selected text.")) } }
    }

    @ToolbarContentBuilder
    func toolbar(_ st: BibleState) -> some ToolbarContent {
        ToolbarItemGroup(placement: .navigation) {
            Button { step(-1) } label: { Label("Previous Chapter", systemImage: "chevron.backward") }
                .keyboardShortcut(.leftArrow, modifiers: [.command, .option])
            Button { step(1) } label: { Label("Next Chapter", systemImage: "chevron.forward") }
                .keyboardShortcut(.rightArrow, modifiers: [.command, .option])
        }
        #if os(macOS)
        ToolbarItem(placement: .principal) {
            TextField("Go to reference", text: $referenceText)
                .textFieldStyle(.roundedBorder)
                .frame(minWidth: 180, idealWidth: 240)
                .focused($referenceFocused)
                .onSubmit { app.openQuery(referenceText, newTab: false); referenceText = ""; referenceFocused = false }
        }
        #endif
        ToolbarItemGroup {
            Menu {
                Picker("Text", selection: Binding(get: { st.translation }, set: { v in mutate { $0.translation = v } })) {
                    ForEach(availableTexts) { Text($0.name).tag($0.id) }
                }
            } label: { Label("Text", systemImage: "books.vertical") }
            Toggle(isOn: Binding(get: { st.showStrongs }, set: { v in mutate { $0.showStrongs = v } })) { Label("Strong's Numbers", systemImage: "number") }
            Toggle(isOn: Binding(get: { st.rightPanelOpen }, set: { v in mutate { $0.rightPanelOpen = v } })) { Label("Study Panel", systemImage: "sidebar.trailing") }
                .keyboardShortcut("i", modifiers: [.command, .option])
        }
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

struct VerseRowView: View {
    let row: ChapterVerseRow
    let textId: String
    let showStrongs: Bool

    var body: some View {
        Text(attributed)
            .font(.system(.body, design: .serif))
            .lineSpacing(5)
            .textSelection(.enabled)
            .padding(.vertical, 2)
    }

    var attributed: AttributedString {
        var out = AttributedString()
        if let title = row.title, !title.isEmpty {
            var t = AttributedString(title + "\n"); t.font = .callout.italic(); t.foregroundColor = .secondary
            out = t + out
        }
        let rules = WordReplacer.defaultRules
        guard let tagged = row.textTagged, !tagged.isEmpty, textId == "kjva" || textId == "lxx" else {
            out += AttributedString(VerseDisplay.text(row.text, tagged: nil, textId: textId, replacerEnabled: true, rules: rules))
            return out
        }
        // Study tokens carry the restored display word AND its Strong's numbers.
        let tokens = TaggedText.parse(tagged).filter { !$0.hasNoPlainText }
        let display = VerseDisplay.tokens(row.text, tagged: tagged, textId: textId, replacerEnabled: true, rules: rules)
        let study = VerseDisplay.studyTokens(row.text, tagged: tagged, textId: textId, replacerEnabled: true, rules: rules)
        let words: [(String, Bool, Bool, [String])] = textId == "kjva" && display.count == study.count
            ? zip(display, study).map { ($0.word, $0.isItalic, $0.isRedLetter, $1.strongs) }
            : tokens.map { t in
                let nums: [String] = { switch t.strongs { case .none: return []; case .one(let s): return [s]; case .many(let a): return a } }()
                return (t.word, t.isItalic, t.isRedLetter, nums)
            }
        for (i, w) in words.enumerated() {
            if i > 0 { out += AttributedString(" ") }
            var a = AttributedString(w.0)
            if w.1 { a.font = .system(.body, design: .serif).italic() }
            if w.2 { a.foregroundColor = .red }
            out += a
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
    @ViewBuilder func navigationSubtitleCompat(_ s: String) -> some View {
        #if os(macOS)
        self.navigationSubtitle(s)
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
