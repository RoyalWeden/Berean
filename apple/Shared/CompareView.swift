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

    var state: BibleState { BibleState(app.findTab(tabId)?.state ?? JSObject()) }
    var columns: [String] {
        let cols = app.findTab(tabId)?.state["compareColumns"]?.arrayValue?.compactMap { $0["textId"]?.stringValue?.string } ?? []
        return cols.isEmpty ? [state.translation, state.translation == "lxx" ? "kjva" : "lxx"] : cols
    }

    var body: some View {
        let st = state, cols = columns
        ScrollView([.vertical]) {
            Grid(alignment: .topLeading, horizontalSpacing: 18, verticalSpacing: 10) {
                GridRow {
                    Text("").gridColumnAlignment(.trailing)
                    ForEach(cols, id: \.self) { c in
                        HStack {
                            Text(textInfo(c).name).font(.headline)
                            Spacer()
                            Button { setColumns(cols.filter { $0 != c }) } label: {
                                Label("Close \(textInfo(c).name)", systemImage: "xmark.circle")
                                    .labelStyle(.iconOnly)
                                    .foregroundStyle(.secondary)
                            }
                            .buttonStyle(.plain)
                            .help("Close \(textInfo(c).name)")
                        }
                    }
                }
                Divider().gridCellUnsizedAxes(.horizontal)
                ForEach(rows.keys.sorted(), id: \.self) { v in
                    GridRow(alignment: .firstTextBaseline) {
                        Text("\(v)").font(.system(.caption, design: .rounded).weight(.semibold)).foregroundStyle(.secondary)
                        ForEach(cols, id: \.self) { c in
                            if let row = rows[v]?[c] {
                                VerseRowView(row: row, textId: c, showStrongs: st.showStrongs, fontSize: app.fontSize, lineSpacing: app.lineSpacing, replacer: app.wordReplacerEnabled)
                            } else { Text("—").foregroundStyle(.tertiary) }
                        }
                    }
                }
            }
            .padding(24)
        }
        .environment(\.openURL, OpenURLAction { url in
            if url.scheme == "strongs" {
                app.update(tabId) { t in var s = BibleState(t.state); s.rightPanelOpen = true; s.rightPanelTab = "lexicon"; s.rightPanelLexiconEntry = url.absoluteString.replacingOccurrences(of: "strongs:", with: ""); t.state = s.merged(into: t.state) }
                return .handled
            }
            return .systemAction
        })
        .toolbar {
            ToolbarItem {
                Menu {
                    ForEach(availableTexts.filter { !cols.contains($0.id) }) { t in Button("Add \(t.name)") { setColumns(cols + [t.id]) } }
                } label: { Label("Add Column", systemImage: "rectangle.split.3x1") }.disabled(cols.count >= 4)
            }
        }
        .task(id: "\(st.bookId)|\(st.chapter)|\(cols.joined(separator: ","))") { await load(st, cols) }
    }

    func load(_ st: BibleState, _ cols: [String]) async {
        var out: [Int: [String: ChapterVerseRow]] = [:]
        for c in cols {
            // The tab's chapter is in its own text's numbering; map it for the column's text.
            let ch = ChapterMap.mapChapter(st.bookId, st.chapter, from: st.translation, to: c)
            for r in await app.bible.queryChapter(st.bookId, ch, textId: c) { out[r.verseNum, default: [:]][c] = r }
        }
        guard !Task.isCancelled else { return }
        rows = out
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
