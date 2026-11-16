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
    @State private var strongsPreview: (id: String, text: String)?
    @State private var passagePreview: (passage: ResolvedPassage, text: String)?
    @FocusState private var focused: Bool

    var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

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
        .defaultFocus($focused, true, priority: .userInitiated)
        .task {
            // A sheet does not always attach its field editor until presentation has settled.
            do { try await Task.sleep(for: .milliseconds(300)) } catch { return }
            if text.isEmpty { focused = true }
        }
        .task(id: trimmed) {
            let query = trimmed
            guard query.count >= 2 else { return }
            do { try await Task.sleep(for: .milliseconds(160)) } catch { return }
            guard !Task.isCancelled, query == trimmed else { return }
            notes = noteMatches(query)
            notesQuery = query
        }
        .task(id: StrongsId.normalize(trimmed)) {
            guard let id = StrongsId.normalize(trimmed) else {
                strongsPreview = nil
                return
            }
            let excerpt = await app.strongsExcerpt(id)
            guard !Task.isCancelled, StrongsId.normalize(trimmed) == id else { return }
            strongsPreview = excerpt.map { (id, $0) }
        }
        .task(id: resolvedPassage) {
            guard let passage = resolvedPassage else {
                passagePreview = nil
                return
            }
            let excerpt = await app.passageExcerpt(passage)
            guard !Task.isCancelled, passage == resolvedPassage else { return }
            passagePreview = excerpt.map { (passage, $0) }
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

    private var preferredText: String? {
        app.activeTab.flatMap { $0.tabType == .bible ? BibleState($0.state).translation : nil }
    }

    private var resolvedPassage: ResolvedPassage? {
        trimmed.isEmpty ? nil : app.resolvePassage(trimmed, preferring: preferredText)
    }

    @ViewBuilder private var results: some View {
        if let ref = resolvedPassage {
            Section("Passage") {
                Button { finish { app.visitScripture(ref, reuseTab: !newTab) } } label: {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(ref.label)
                            Text(textInfo(ref.textId).name).font(.caption).foregroundStyle(.secondary)
                            if let passagePreview, passagePreview.passage == ref, !passagePreview.text.isEmpty {
                                Text(passagePreview.text)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(2)
                            }
                        }
                    } icon: { Image(systemName: "book") }
                }
            }
            let matches = newTab ? [] : app.openPassageMatches(ref)
            if !matches.isEmpty {
                Section("Open in Other Workspaces") {
                    ForEach(matches) { match in
                        Button {
                            finish { app.openWorkspacePassage(ref, match: match) }
                        } label: {
                            Label {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(match.tab.navigationLabel)
                                    Text(match.workspaceName).font(.caption).foregroundStyle(.secondary)
                                }
                            } icon: { Image(systemName: "square.stack") }
                        }
                        .accessibilityHint("Switch to the existing tab")
                    }
                }
            }
        } else if let id = StrongsId.normalize(trimmed) {
            Section("Lexicon") {
                Button { finish { app.openLexicon(id, reuseTab: !newTab) } } label: {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Look up \(id)")
                            if let strongsPreview, strongsPreview.id == id {
                                Text(strongsPreview.text)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(2)
                            }
                        }
                    } icon: { Image(systemName: "character.book.closed") }
                }
            }
        }
        if notesQuery == trimmed && !notes.isEmpty {
            Section("Notes") {
                ForEach(notes) { note in
                    Button { finish { app.openNote(note.id, newTab: newTab) } } label: {
                        Label {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(note.displayTitle)
                                let excerpt = noteSearchPreview(note, query: trimmed)
                                if !excerpt.isEmpty {
                                    Text(excerpt)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(2)
                                }
                            }
                        } icon: { Image(systemName: "note.text") }
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

    private func noteMatches(_ query: String) -> [Note] {
        guard query.count >= 2 else { return [] }
        return (try? app.notes?.search(query, limit: 6)) ?? []
    }

    private func go() {
        let query = trimmed
        guard !query.isEmpty else { return }
        if let passage = app.resolvePassage(query, preferring: preferredText) {
            finish { app.visitScripture(passage, reuseTab: !newTab) }
        } else if let id = StrongsId.normalize(query) {
            finish { app.openLexicon(id, reuseTab: !newTab) }
        } else if let note = (notesQuery == query ? notes : noteMatches(query)).first(where: {
            $0.displayTitle.caseInsensitiveCompare(query) == .orderedSame
        }) {
            finish { app.openNote(note.id, newTab: newTab) }
        } else {
            finish { app.openSearch(query, reuseTab: !newTab) }
        }
    }
    func finish(_ action: () -> Void) { if let close { close() } else { dismiss() }; action() }
}
