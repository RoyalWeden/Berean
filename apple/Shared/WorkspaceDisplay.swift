import SwiftUI
import BereanWorkspace
import BereanNotes

/// Display names, symbols and colours for Spaces and tab types (shared by the Mac and iPhone shells).
extension SpaceId {
    var title: String { ["scripture": "Scripture", "notes": "Notes", "lexicon": "Lexicon", "youtube": "YouTube", "search": "Search"][rawValue]! }
    var symbol: String { ["scripture": "book", "notes": "note.text", "lexicon": "character.book.closed", "youtube": "play.rectangle", "search": "magnifyingglass"][rawValue]! }
}

extension BereanWorkspace.Tab {
    var symbol: String {
        switch tabType {
        case .bible: return "book"
        case .note: return "note.text"
        case .lexicon: return "character.book.closed"
        case .youtube: return "play.rectangle"
        case .search: return "magnifyingglass"
        case .pdf: return "doc.richtext"
        case .tags: return "tag"
        case .history: return "clock"
        case .settings: return "gearshape"
        case .calendar: return "calendar"
        case .none: return "questionmark.square"
        }
    }
}

extension BereanWorkspace.Tab {
    /// Type colours from the existing sidebar (Scripture blue, notes orange, lexicon green, YouTube red).
    var tint: Color {
        switch tabType {
        case .bible: return .blue
        case .note: return .orange
        case .lexicon: return .green
        case .youtube: return .red
        case .search: return .indigo
        default: return .secondary
        }
    }
}


extension BereanWorkspace.Tab {
    var navigationLabel: String {
        let fallback = title.isEmpty ? "Untitled" : title
        // Daily note tabs read as their long date; the stored tab title ("Daily — YYYY-MM-DD") is unchanged.
        if tabType == .note, title.hasPrefix("Daily — ") || title.hasPrefix("Journal — "),
           let key = NotesService.dailyDateKey(title), let long = NotesService.dailyDisplayTitle(key) {
            // Compact for tab rows: "Sabbath, Nov 14, 2026".
            let parts = long.split(separator: " ")   // ["Sabbath,", "November", "14,", "2026"]
            guard parts.count == 4 else { return long }
            return "\(parts[0]) \(parts[1].prefix(3)) \(parts[2]) \(parts[3])"
        }
        guard tabType == .bible else { return fallback }
        let reader = BibleState(state)
        guard let verse = reader.verse else { return fallback }
        let groups = reader.compareMode ? [] : consecutiveVerseRuns(ResolvedPassage.savedVerses(in: state, reader: reader))
        return ResolvedPassage(textId: reader.translation, bookId: reader.bookId,
                               chapter: reader.chapter, verse: verse, endVerse: reader.endVerse, verseGroups: groups).label
    }

    var scriptureEditionLabel: String? {
        guard tabType == .bible else { return nil }
        let reader = BibleState(state)
        return textInfo(reader.translation).short
    }

    var navigationDetail: String {
        guard let edition = scriptureEditionLabel else { return spaceId.title }
        let detail = "\(spaceId.title) · \(edition)"
        return BibleState(state).compareMode ? detail + " · Compare" : detail
    }

    var navigationSearchText: String {
        let edition = tabType == .bible ? textInfo(BibleState(state).translation).name : ""
        return "\(title) \(navigationLabel) \(navigationDetail) \(edition)"
            .replacingOccurrences(of: "–", with: "-")
    }
}

struct TabSearchField: View {
    let prompt: String
    @Binding var query: String
    var autofocus = false
    @FocusState private var searchFocused: Bool

    var body: some View {
        Section {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
                TextField(prompt, text: $query)
                    .autocorrectionDisabled()
                    .focused($searchFocused)
                    .onAppear { if autofocus { searchFocused = true } }
                    #if os(iOS)
                    .submitLabel(.search)
                    #endif
                if !query.isEmpty {
                    Button {
                        query = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.interactivePlain)
                    .accessibilityLabel("Clear search")
                }
            }
        }
    }
}

struct WorkspaceTabsPage: View {
    @Environment(AppModel.self) private var app
    let workspace: WorkspaceItem
    let onOpen: () -> Void
    @State private var query = ""

    var body: some View {
        let terms = query.replacingOccurrences(of: "–", with: "-").split(whereSeparator: \.isWhitespace)
        let session = app.sessions.first { WorkspaceItem.Kind.live($0.id) == workspace.kind }
        let tabs = session.map { app.orderedTabs(in: $0) } ?? []
        let indices = AppModel.sameTitleTabIndices(tabs)
        let copyNumber = terms.count >= 2 && terms[terms.count - 2].lowercased() == "tab"
            ? terms.last.flatMap { Int($0) }
            : nil
        let titleTerms = copyNumber == nil ? terms[...] : terms.dropLast(2)
        let matches = tabs.filter { tab in
            guard copyNumber == nil || indices[tab.id] == copyNumber else { return false }
            let searchable = tab.navigationSearchText
            return titleTerms.allSatisfy { searchable.localizedStandardContains(String($0)) }
        }
        List {
            if let session, !tabs.isEmpty {
                TabSearchField(prompt: "Search tabs in this workspace", query: $query, autofocus: autofocus)
                    .onSubmit {
                        guard !terms.isEmpty, matches.count == 1, let tab = matches.first else { return }
                        open(tab, in: session.id)
                    }
                if matches.isEmpty {
                    ContentUnavailableView.search(text: query)
                }
                ForEach(matches) { tab in
                    Button {
                        open(tab, in: session.id)
                    } label: {
                        Label {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(tab.navigationLabel).foregroundStyle(.primary)
                                let position = indices[tab.id].map { "Tab \($0)" }
                                let detail = [tab.navigationDetail, position, tab.isPinned ? "Pinned" : nil]
                                    .compactMap { $0 }.joined(separator: " · ")
                                Text(detail).font(.caption).foregroundStyle(.secondary)
                            }
                        } icon: {
                            Image(systemName: tab.symbol).foregroundStyle(tab.tint)
                        }
                    }
                    .buttonStyle(.interactivePlain)
                }
            } else {
                ContentUnavailableView("No Open Tabs", systemImage: "rectangle.on.rectangle")
            }
        }
        #if os(iOS)
        .navigationTitle(workspace.displayName)
        .navigationBarTitleDisplayMode(.inline)
        .scrollDismissesKeyboard(.interactively)
        #else
        .listStyle(.plain)
        #endif
    }

    private var autofocus: Bool {
        #if os(macOS)
        true
        #else
        false
        #endif
    }

    private func open(_ tab: BereanWorkspace.Tab, in sessionID: String) {
        app.openWorkspaceTab(.init(workspaceID: sessionID, workspaceName: workspace.displayName, tab: tab))
        onOpen()
    }
}
