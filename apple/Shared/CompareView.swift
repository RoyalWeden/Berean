import SwiftUI
import BereanCore
import BereanBible
import BereanText
import BereanReference

/// Parallel Scripture (Compare mode): one column per text, rows aligned by verse number. Columns follow the
/// tab's passage (LXX Psalm/Jeremiah numbering mapped with ChapterMap) and are stored in the synced
/// `compareColumns` field, so compare tabs round-trip with the existing apps.
struct CompareView: View {
    @Environment(AppModel.self) private var app
    let tabId: String
    @State private var rows: [Int: [String: ChapterVerseRow]] = [:]
    @State private var loadedPassage: String?
    @AppStorage("showVerseNumbers") private var showVerseNumbers = true

    var state: BibleState { BibleState(app.findTab(tabId)?.state ?? JSObject()) }
    var columns: [String] {
        let cols = app.findTab(tabId)?.state["compareColumns"]?.arrayValue?.compactMap { $0["textId"]?.stringValue?.string } ?? []
        return cols.isEmpty ? [state.translation, state.translation == "lxx" ? "kjva" : "lxx"] : cols
    }

    var body: some View {
        let st = state, cols = columns
        let passage = "\(st.translation)|\(st.bookId)|\(st.chapter)|\(cols.joined(separator: ","))"
        ScrollViewReader { proxy in
            ScrollView {
                if loadedPassage != passage {
                    ProgressView().frame(maxWidth: .infinity).padding()
                } else if rows.isEmpty {
                    ContentUnavailableView("No Text in This Passage", systemImage: "book.closed")
                } else {
                    comparisonGrid(st, cols)
                }
            }
            .onChange(of: loadedPassage) {
                if loadedPassage == passage, let verse = st.verse { proxy.scrollTo(verse, anchor: .top) }
            }
            .onChange(of: st.verse) {
                if loadedPassage == passage, let verse = st.verse { proxy.scrollTo(verse, anchor: .top) }
            }
        }
        .environment(\.openURL, OpenURLAction { url in
            guard url.scheme == "strongs" else { return .systemAction }
            app.update(tabId) { tab in
                var state = BibleState(tab.state)
                state.rightPanelOpen = true
                state.rightPanelTab = "lexicon"
                state.rightPanelLexiconEntry = String(url.absoluteString.dropFirst("strongs:".count))
                tab.state = state.merged(into: tab.state)
            }
            return .handled
        })
        .toolbar {
            ToolbarItem {
                Menu {
                    ForEach(availableTexts.filter { !cols.contains($0.id) }) { text in
                        Button(text.name) { setColumns(cols + [text.id]) }
                    }
                } label: { Label("Add Translation", systemImage: "rectangle.split.3x1") }
                    .disabled(cols.count >= 4)
            }
        }
        .task(id: passage) { await load(st, cols, passage: passage) }
    }

    private func comparisonGrid(_ st: BibleState, _ cols: [String]) -> some View {
        Grid(alignment: .topLeading, horizontalSpacing: 18, verticalSpacing: 10) {
            GridRow {
                if showVerseNumbers { Text("").gridColumnAlignment(.trailing) }
                ForEach(cols, id: \.self) { c in
                    HStack {
                        Text(textInfo(c).name).font(.headline)
                        Spacer()
                        Button { setColumns(cols.filter { $0 != c }) } label: {
                            Label("Close \(textInfo(c).name)", systemImage: "xmark.circle")
                                .labelStyle(.iconOnly)
                                .foregroundStyle(.secondary)
                                .frame(minWidth: 28, minHeight: 28)
                                .contentShape(.rect)
                        }
                        .buttonStyle(.interactivePlain)
                        .help("Close \(textInfo(c).name)")
                    }
                }
            }
            Divider().gridCellUnsizedAxes(.horizontal)
            ForEach(rows.keys.sorted(), id: \.self) { v in
                GridRow(alignment: .firstTextBaseline) {
                    if showVerseNumbers {
                        Button {
                            app.update(tabId, recordHistory: false) { tab in
                                var state = BibleState(tab.state)
                                state.verse = v
                                state.endVerse = nil
                                tab.state = state.merged(into: tab.state)
                            }
                        } label: {
                            Text("\(v)")
                                .font(.system(.caption, design: .rounded).weight(.semibold))
                                .foregroundStyle(isSelected(v, st) ? Color.accentColor : Color.secondary)
                                .frame(minWidth: 28, minHeight: 28)
                                .contentShape(.rect)
                        }
                        .buttonStyle(.interactivePlain)
                        .accessibilityLabel("Verse \(v)")
                        .accessibilityAddTraits(isSelected(v, st) ? .isSelected : [])
                    }
                    ForEach(cols, id: \.self) { c in
                        if let row = rows[v]?[c] {
                            VerseRowView(row: row, textId: c, showStrongs: st.showStrongs, fontSize: app.fontSize, lineSpacing: app.lineSpacing, replacer: app.wordReplacerEnabled,
                                         family: app.scriptureFontFamily)
                        } else { Text("—").foregroundStyle(.tertiary) }
                    }
                }
                .id(v)
            }
        }
        .padding(24)
    }

    private func isSelected(_ verse: Int, _ state: BibleState) -> Bool {
        guard let first = state.verse else { return false }
        return verse >= first && verse <= max(first, state.endVerse ?? first)
    }

    func load(_ st: BibleState, _ cols: [String], passage: String) async {
        var out: [Int: [String: ChapterVerseRow]] = [:]
        for c in cols {
            // The tab's chapter is in its own text's numbering; map it for the column's text.
            let ch = ChapterMap.mapChapter(st.bookId, st.chapter, from: st.translation, to: c)
            for r in await app.bible.queryChapter(st.bookId, ch, textId: c) { out[r.verseNum, default: [:]][c] = r }
        }
        guard !Task.isCancelled else { return }
        rows = out
        loadedPassage = passage
    }

    func setColumns(_ cols: [String]) {
        let st = state
        app.update(tabId) { t in
            if cols.count < 2 {
                var reader = st
                reader.compareMode = false
                if let remaining = cols.first {
                    reader.chapter = ChapterMap.mapChapter(st.bookId, st.chapter, from: st.translation, to: remaining)
                    reader.translation = remaining
                }
                t.state = reader.merged(into: t.state)
                t.state.remove("compareColumns")
                t.title = Reference.bookChapterLabel(reader.bookId, chapter: Double(reader.chapter))
                return
            }
            t.state["compareColumns"] = .array(cols.map { c in
                var o = JSObject()
                o["textId"] = .string(JSString(c)); o["bookId"] = .string(JSString(st.bookId))
                o["chapter"] = .number(Double(ChapterMap.mapChapter(st.bookId, st.chapter, from: st.translation, to: c)))
                return .object(o)
            })
        }
    }
}
