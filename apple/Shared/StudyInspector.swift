import SwiftUI
import BereanCore

/// The Scripture tab's study panel (`rightPanelTab`): Lexicon or Cross References for the selected verse/word.
struct StudyInspector: View {
    @Environment(AppModel.self) private var app
    let tabId: String

    var body: some View {
        let st = BibleState(app.findTab(tabId)?.state ?? JSObject())
        VStack(spacing: 0) {
            Picker("Panel", selection: Binding(get: { ["notes", "crossrefs"].contains(st.rightPanelTab) ? st.rightPanelTab : "lexicon" }, set: { v in
                app.update(tabId) { t in var s = BibleState(t.state); s.rightPanelTab = v; t.state = s.merged(into: t.state) }
            })) {
                Text("Notes").tag("notes")
                Text("Lexicon").tag("lexicon")
                Text("Cross Refs").tag("crossrefs")
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(10)
            Divider()
            if st.rightPanelTab == "notes" {
                VerseNotesView(bookId: st.bookId, chapter: st.chapter, verse: st.verse, textId: st.translation)
            } else if st.rightPanelTab == "crossrefs" {
                CrossRefsView(bookId: st.bookId, chapter: st.chapter, verse: st.verse, textId: st.translation)
            } else if let id = st.rightPanelLexiconEntry {
                LexiconEntryView(strongsId: id, compact: true)
            } else {
                ContentUnavailableView("No word selected", systemImage: "character.book.closed",
                                       description: Text("Turn on Strong's numbers and click one to look it up."))
                    .frame(maxHeight: .infinity, alignment: .top)
            }
        }
        .frame(maxHeight: .infinity, alignment: .top)
    }
}

/// Cmd+T / Cmd+K: type a reference, a Strong's number or words to search.
struct CommandPalette: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            TextField("Reference, Strong's number or words", text: $text)
                .textFieldStyle(.plain)
                .font(.title2)
                .focused($focused)
                .onSubmit { go() }
            Divider()
            Group {
                if let ref = app.resolvePassage(text) {
                    Label("Open \(Reference.bookChapterVerseLabel(ref.bookId, chapter: ref.chapter, verse: ref.verse))\(ref.textId == app.defaultText ? "" : " · " + textInfo(ref.textId).short)", systemImage: "book")
                } else if let id = StrongsId.normalize(text) {
                    Label("Look up \(id)", systemImage: "character.book.closed")
                } else if !text.trimmingCharacters(in: .whitespaces).isEmpty {
                    Label("Search Scripture for “\(text)”", systemImage: "magnifyingglass")
                } else {
                    Text("Examples: John 3:16 · Ps 23 · Isaiah 53:5 LXX · H3068 · grace").foregroundStyle(.secondary)
                }
            }
            .font(.callout)
        }
        .padding(18)
        .frame(width: 520)
        .onAppear { focused = true }
    }

    func go() { app.openQuery(text); dismiss() }
}

import BereanReference
