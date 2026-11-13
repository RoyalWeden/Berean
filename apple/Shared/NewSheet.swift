import SwiftUI
import BereanReference
import BereanText

/// "New" (the iPhone Plus button; also ⌘T's iPhone counterpart): type a reference, Strong's number or words — or pick
/// one of the common things to open. One clear job: open or create something. (ADR-0013)
struct NewSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
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
                Section("Open") {
                    row("Scripture", "book", .blue, "Continue reading in a new tab") { app.openScripture(bookId: lastPassage.bookId, chapter: lastPassage.chapter, textId: lastPassage.textId) }
                    row("New Note", "square.and.pencil", .orange, "A blank note") { app.newNote() }
                    row("Today's Note", "calendar", .orange, "Your daily note for today") { app.openTodayDailyNote() }
                    row("Notes", "note.text", .orange, "All notes, folders and filters") { app.openNote(nil) }
                }
                if !recents.isEmpty {
                    Section("Recent") {
                        ForEach(recents) { r in
                            Button { finish { app.openScripture(bookId: r.bookId, chapter: r.chapter, verse: r.verse, textId: r.textId) } } label: {
                                Label(r.label + (r.textId == "kjva" ? "" : " · \(textInfo(r.textId).short)"), systemImage: "clock.arrow.circlepath")
                            }
                        }
                    }
                }
            }
            .navigationTitle("New")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
        .onAppear { focused = false }
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

    func row(_ title: String, _ symbol: String, _ tint: Color, _ detail: String, action: @escaping () -> Void) -> some View {
        Button { finish(action) } label: {
            HStack(spacing: 12) {
                Image(systemName: symbol).font(.title3).foregroundStyle(tint).frame(width: 30)
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).foregroundStyle(.primary)
                    Text(detail).font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .accessibilityHint(detail)
    }

    func go() { guard !trimmed.isEmpty else { return }; let q = trimmed; finish { app.openQuery(q) } }
    func finish(_ action: () -> Void) { action(); dismiss() }
}
