import SwiftUI
import BereanNotes
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
    @State private var notes: [Note] = []
    @State private var notesQuery = ""
    @FocusState private var focused: Bool

    var trimmed: String { text.trimmingCharacters(in: .whitespaces) }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    TextField("Passage, Strong's number, note or words", text: $text)
                        .focused($focused)
                        .submitLabel(.go)
                        .onSubmit { go() }
                        .autocorrectionDisabled()
                    #if os(iOS)
                        .textInputAutocapitalization(.never)
                    #endif
                } footer: {
                    if trimmed.isEmpty { Text("For example: John 3:16 · Ps 23 · Isaiah 53 LXX · H3068 · grace") }
                }
                Group {
                    if trimmed.isEmpty {
                        shortcuts.clickableCursor()
                    } else {
                        results.clickableCursor()
                    }
                }
                #if os(iOS)
                .tint(.primary)   // navigation rows read as list items (primary text), not accent-coloured links
                #endif
            }
            .navigationTitle(newTab ? "New Tab" : "Go")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { if let close { close() } else { dismiss() } } } }
        }
        .task(id: trimmed) {
            let query = trimmed
            guard query.count >= 2 else { return }
            do { try await Task.sleep(for: .milliseconds(160)) } catch { return }
            guard !Task.isCancelled, query == trimmed else { return }
            notes = (try? app.notes?.search(query, limit: 6)) ?? []
            notesQuery = query
        }
    }

    @ViewBuilder private var shortcuts: some View {
        Section("Open") {
            row("Scripture", "book", .blue) { app.openScripture(bookId: lastPassage.bookId, chapter: lastPassage.chapter, verse: lastPassage.verse, endVerse: lastPassage.endVerse, textId: lastPassage.textId, reuseTab: !newTab, verseGroups: lastPassage.verseGroups ?? []) }
            row("New Note", "square.and.pencil", .orange) { app.newNote() }
            row("Today's Note", "calendar", .orange) { app.openTodayDailyNote() }
            row("Notes", "note.text", .orange) { app.openNotesHome(newTab: newTab) }
            row("History", "clock", .secondary) { app.openHistory(newTab: newTab) }
            row("Tags", "tag", .secondary) { app.openTags(newTab: newTab) }
            row("Lexicon", "character.book.closed", .green) { app.openLexiconSearch(newTab: newTab) }
        }
        if !recents.isEmpty {
            Section("Recent") {
                ForEach(recents) { r in
                    Button { finish { app.openScripture(bookId: r.bookId, chapter: r.chapter, verse: r.verse, endVerse: r.endVerse, textId: r.textId, reuseTab: !newTab, verseGroups: r.verseGroups ?? []) } } label: {
                        Label(r.label + (r.textId == "kjva" ? "" : " · \(textInfo(r.textId).short)"), systemImage: "clock.arrow.circlepath")
                    }
                }
            }
        }
    }

    var recents: [RecentPassage] { Array(app.recentPassages.prefix(5)) }
    var lastPassage: RecentPassage { app.recentPassages.first ?? RecentPassage(textId: app.defaultText, bookId: "GEN", chapter: 1) }

    @ViewBuilder private var results: some View {
        let preferredText = app.activeTab.flatMap {
            $0.tabType == .bible ? BibleState($0.state).translation : nil
        }
        if let ref = app.resolvePassage(trimmed, preferring: preferredText) {
            Section("Passage") {
                Button { go() } label: {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(ref.label)
                            Text(textInfo(ref.textId).name).font(.caption).foregroundStyle(.secondary)
                        }
                    } icon: { Image(systemName: "book") }
                }
            }
        } else if let id = StrongsId.normalize(trimmed) {
            Section("Lexicon") {
                Button { go() } label: { Label("Look up \(id)", systemImage: "character.book.closed") }
            }
        }
        if notesQuery == trimmed && !notes.isEmpty {
            Section("Notes") {
                ForEach(notes) { note in
                    Button { finish { app.openNote(note.id, newTab: newTab) } } label: {
                        Label(note.displayTitle, systemImage: "note.text")
                    }
                }
            }
        }
        Section("Scripture") {
            let qualified = app.editionQualifiedQuery(trimmed)
            let title = qualified.map { "Search \(textInfo($0.text).short) for “\($0.query)”" } ?? "Search for “\(trimmed)”"
            Button {
                let query = trimmed
                finish { app.openSearch(query, reuseTab: !newTab) }
            } label: {
                Label(title, systemImage: "magnifyingglass")
            }
        }
        let archived = newTab ? [] : app.matchingArchivedTabs(trimmed)
        if !archived.isEmpty {
            Section("Archived Tabs") {
                ForEach(archived) { match in
                    Button { finish { app.restoreArchivedTab(match.tab.id, from: match.groupID) } } label: {
                        Label {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(match.tab.navigationLabel)
                                Text(match.groupTitle).font(.caption).foregroundStyle(.secondary)
                            }
                        } icon: { Image(systemName: "archivebox") }
                    }
                    .accessibilityHint("Restore and open this tab")
                    .contextMenu {
                        if let source = match.sourceName {
                            Button("Restore to \(source)", systemImage: "square.stack") {
                                finish { app.restoreArchivedTab(match.tab.id, from: match.groupID, toSource: true) }
                            }
                        }
                    }
                }
            }
        }
        if StrongsId.normalize(trimmed) == nil, !trimmed.contains(where: \.isNumber), trimmed.split(separator: " ").count <= 2 {
            Section("Lexicon") {
                Button {
                    let query = trimmed
                    finish { app.openLexiconSearch(query, newTab: newTab) }
                } label: {
                    Label("Search Lexicon for “\(trimmed)”", systemImage: "character.book.closed")
                }
            }
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
