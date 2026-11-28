import SwiftUI
import BereanNotes
import BereanReference
import BereanText

/// The iPhone destination picker. The dock reuses tabs, while Tabs → New Tab opens a separate tab.
struct GoSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    /// Closes the sheet through the presenter's binding (`dismiss()` alone left the sheet up after a navigation).
    let newTab: Bool
    var close: (() -> Void)? = nil
    @State private var text = ""
    @State private var notes: [Note] = []
    @State private var notesQuery = ""
    @State private var videoHits: (query: String, hits: [TranscriptService.SearchHit]) = ("", [])
    @State private var strongsPreview: (id: String, text: String)?
    @State private var passagePreview: (passage: ResolvedPassage, text: String)?
    @FocusState private var focused: Bool

    var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                searchField
                List {
                    Group {
                        if trimmed.isEmpty {
                            shortcuts.clickableCursor()
                        } else {
                            results.clickableCursor()
                        }
                    }
                    #if os(iOS)
                    .tint(.primary)   // navigation rows use primary text, not accent-coloured links
                    #endif
                }
                .scrollDismissesKeyboard(.interactively)
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
        .onChange(of: trimmed, initial: true) { _, query in
            notes = noteMatches(query)
            notesQuery = query
        }
        .task(id: trimmed) {
            let query = trimmed
            guard query.count >= 3, let searcher = app.transcriptSearcher else { videoHits = (query, []); return }
            do { try await Task.sleep(for: .milliseconds(180)) } catch { return }   // debounce typing
            let hits = await searcher.search(query)
            if !Task.isCancelled { videoHits = (query, hits) }
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

    private var searchField: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Passage or search", text: $text)
                    .textFieldStyle(.plain)
                    .focused($focused)
                    .submitLabel(.go)
                    .onSubmit { go() }
                    .autocorrectionDisabled()
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    #endif
                if !text.isEmpty {
                    Button("Clear search", systemImage: "xmark.circle.fill") { text = ""; focused = true }
                        .labelStyle(.iconOnly).foregroundStyle(.secondary)
                }
                if focused {
                    Button("Dismiss keyboard", systemImage: "keyboard.chevron.compact.down") { focused = false }
                        .labelStyle(.iconOnly).foregroundStyle(.secondary)
                }
            }
            .padding(.horizontal, 16).frame(minHeight: 52)
            .glassEffectCompat(interactive: true)
            if trimmed.isEmpty {
                Text("John 3:16 · Psalm 23 LXX · H3068 · grace")
                    .font(.caption).foregroundStyle(.secondary).padding(.horizontal, 6)
            }
        }
        .padding(.horizontal, 16).padding(.top, 12).padding(.bottom, 8)
    }

    @ViewBuilder private var shortcuts: some View {
        Section("Open") {
            let columns = [GridItem(.adaptive(minimum: dynamicTypeSize.isAccessibilitySize ? 260 : 130),
                                    spacing: 8, alignment: .leading)]
            LazyVGrid(columns: columns, alignment: .leading, spacing: 8) {
                ForEach(destinations, id: \.title) { d in row(d.title, d.symbol, d.tint, action: d.run) }
            }
            .listRowBackground(Color.clear)
            .listRowInsets(EdgeInsets())
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

    /// The Open shortcuts; typing filters them into a Commands section (like the Mac ⌘K palette).
    private var destinations: [(title: String, symbol: String, tint: Color, run: () -> Void)] {
        var out: [(title: String, symbol: String, tint: Color, run: () -> Void)] = [
            ("Scripture", "book", .blue, {
                let passage = lastPassage
                app.openScripture(bookId: passage.bookId, chapter: passage.chapter, verse: passage.verse,
                                  endVerse: passage.endVerse, textId: passage.textId,
                                  reuseTab: !newTab, verseGroups: passage.verseGroups ?? [])
            }),
            ("Notes", "note.text", .orange, { app.openNotesHome(newTab: newTab) }),
            ("Study Trail", "point.topleft.down.to.point.bottomright.curvepath", .blue, { app.showStudyTrail = true }),
            ("History", "clock", .secondary, { app.openHistory(newTab: newTab) }),
            ("Lexicon", "character.book.closed", .green, { app.openLexiconSearch(newTab: newTab) }),
            ("New Note", "square.and.pencil", .orange, { app.newNote() }),
            ("Today's Note", "calendar", .orange, { app.openTodayDailyNote(newTab: newTab) }),
            ("Tags", "tag", .secondary, { app.openTags(newTab: newTab) }),
            ("PDFs", "doc.richtext", .secondary, { app.openPdfLibrary(newTab: newTab) }),
            ("YouTube", "play.rectangle", .secondary, { app.openYouTube(newTab: newTab) }),
        ]
        #if os(iOS)
        out.insert(("Messages", "bubble.left.and.text.bubble.right", .blue, { app.chatShown = true }), at: 3)
        out.append(("Ask Berean", "sparkle.magnifyingglass", .purple, { app.askBereanShown = true }))
        #endif
        return out
    }

    @ViewBuilder private var results: some View {
        let commands = destinations.filter { CommandSearch.matches(trimmed, title: $0.title) }
        if !commands.isEmpty {
            Section("Commands") {
                ForEach(commands, id: \.title) { d in
                    Button { finish(d.run) } label: { Label { Text(d.title) } icon: { Image(systemName: d.symbol).foregroundStyle(d.tint) } }
                }
            }
        }
        if let ref = resolvedPassage {
            let isOpen = !newTab && app.tabs(in: .scripture).contains(where: ref.isShown(in:))
            Section("Passage") {
                Button { finish { app.goToScripture(ref, newTab: newTab) } } label: {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(ref.label)
                            HStack(spacing: 6) {
                                Text(textInfo(ref.textId).name)
                                if isOpen { Text("· Open Tab") }
                            }
                            .font(.caption)
                            .foregroundStyle(.secondary)
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
        let noteHits = notesQuery == trimmed ? notes : noteMatches(trimmed)
        if !noteHits.isEmpty {
            Section("Notes") {
                ForEach(noteHits) { note in
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
        // Transcript matches (original Q10: unified search includes YouTube transcripts).
        if videoHits.query == trimmed, !videoHits.hits.isEmpty {
            let videos = videoHits.hits
            Section("Videos") {
                ForEach(videos, id: \.videoId) { hit in
                    Button { finish { app.openYouTubeVideo(hit.videoId, startMs: hit.startMs) } } label: {
                        Label {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(hit.title).lineLimit(1)
                                Text("\(TranscriptService.clock(hit.startMs)) · \(hit.snippet)")
                                    .font(.caption).foregroundStyle(.secondary).lineLimit(2)
                            }
                        } icon: { Image(systemName: "play.rectangle") }
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
            .font(.subheadline.weight(.medium))
            .padding(.horizontal, 13).padding(.vertical, 12)
            .frame(maxWidth: .infinity, minHeight: 48, alignment: .leading)
            .glassEffectCompat(interactive: true)
        }
        .buttonStyle(.interactivePlain)
    }

    private func noteMatches(_ query: String) -> [Note] {
        guard query.count >= 2 else { return [] }
        return (try? app.notes?.search(query, limit: 6)) ?? []
    }

    private func go() {
        let query = trimmed
        guard !query.isEmpty else { return }
        if let passage = app.resolvePassage(query, preferring: preferredText) {
            finish { app.goToScripture(passage, newTab: newTab) }
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
    private func finish(_ action: () -> Void) {
        let sourceTabID = app.activeTab?.id
        let sourceWorkspace = app.currentSessionId
        if let close { close() } else { dismiss() }
        action()
        if app.currentSessionId == sourceWorkspace {
            app.recordTabReturn(to: sourceTabID)
        }
    }
}
