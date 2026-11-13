import SwiftUI
import BereanReference
import BereanText

/// The iPhone destination picker. The dock reuses tabs, while Tabs → New Tab opens a separate tab.
struct GoSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    /// Closes the sheet through the presenter's binding (`dismiss()` alone left the sheet up after a navigation).
    let newTab: Bool
    var close: (() -> Void)? = nil
    @State private var text = ""
    @FocusState private var focused: Bool

    var trimmed: String { text.trimmingCharacters(in: .whitespaces) }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    TextField("Reference, Strong's number or words", text: $text)
                        .focused($focused)
                        .submitLabel(.go)
                        .onSubmit { go() }
                        .autocorrectionDisabled()
                    #if os(iOS)
                        .textInputAutocapitalization(.never)
                    #endif
                    if !trimmed.isEmpty {
                        Button { go() } label: { suggestion }
                    }
                } footer: {
                    if trimmed.isEmpty { Text("For example: John 3:16 · Ps 23 · Isaiah 53 LXX · H3068 · grace") }
                }
                if trimmed.isEmpty {
                    shortcuts
                }
            }
            .navigationTitle(newTab ? "New Tab" : "Go")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { if let close { close() } else { dismiss() } } } }
        }
        .onAppear { focused = false }
    }

    @ViewBuilder private var shortcuts: some View {
        Section("Open") {
            row("Scripture", "book", .blue) { app.openScripture(bookId: lastPassage.bookId, chapter: lastPassage.chapter, verse: lastPassage.verse, textId: lastPassage.textId, reuseTab: !newTab) }
            row("New Note", "square.and.pencil", .orange) { app.newNote() }
            row("Today's Note", "calendar", .orange) { app.openTodayDailyNote() }
            row("Notes", "note.text", .orange) { app.openNote(nil) }
            row("History", "clock", .secondary) { app.openHistory() }
            row("Tags", "tag", .secondary) { app.openTags() }
        }
        if !recents.isEmpty {
            Section("Recent") {
                ForEach(recents) { r in
                    Button { finish { app.openScripture(bookId: r.bookId, chapter: r.chapter, verse: r.verse, textId: r.textId, reuseTab: !newTab) } } label: {
                        Label(r.label + (r.textId == "kjva" ? "" : " · \(textInfo(r.textId).short)"), systemImage: "clock.arrow.circlepath")
                    }
                }
            }
        }
    }

    var recents: [RecentPassage] { Array(app.recentPassages.prefix(5)) }
    var lastPassage: RecentPassage { app.recentPassages.first ?? RecentPassage(textId: app.defaultText, bookId: "GEN", chapter: 1) }

    @ViewBuilder var suggestion: some View {
        if let ref = app.resolvePassage(trimmed) {
            Label("Open \(Reference.bookChapterVerseLabel(ref.bookId, chapter: ref.chapter, verse: ref.verse))\(ref.textId == app.defaultText ? "" : " · " + textInfo(ref.textId).short)", systemImage: "book")
        } else if let id = StrongsId.normalize(trimmed) {
            Label("Look up \(id)", systemImage: "character.book.closed")
        } else {
            Label("Search Scripture for “\(trimmed)”", systemImage: "magnifyingglass")
        }
    }

    func row(_ title: String, _ symbol: String, _ tint: Color, action: @escaping () -> Void) -> some View {
        Button { finish(action) } label: {
            Label {
                Text(title).foregroundStyle(.primary)
            } icon: {
                Image(systemName: symbol).foregroundStyle(tint)
            }
        }
    }

    func go() { guard !trimmed.isEmpty else { return }; let q = trimmed; finish { app.openQuery(q, newTab: newTab) } }
    func finish(_ action: () -> Void) { if let close { close() } else { dismiss() }; action() }
}
