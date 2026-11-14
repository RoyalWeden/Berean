import SwiftUI
import BereanCore
import BereanNotes
import BereanWorkspace

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
                VerseNotesView(bookId: st.bookId, chapter: st.chapter, verse: app.studyVerse(in: tabId, state: st), textId: st.translation)
            } else if st.rightPanelTab == "crossrefs" {
                CrossRefsView(bookId: st.bookId, chapter: st.chapter, verse: app.studyVerse(in: tabId, state: st), textId: st.translation)
            } else if let id = st.rightPanelLexiconEntry {
                LexiconEntryView(strongsId: id, tabId: tabId, compact: true)
            } else {
                ContentUnavailableView("No word selected", systemImage: "character.book.closed",
                                       description: Text("Turn on Strong's numbers and click one to look it up."))
                    .frame(maxHeight: .infinity, alignment: .top)
            }
        }
        .frame(maxHeight: .infinity, alignment: .top)
    }
}

#if os(macOS)
/// The Mac palette uses the same results for routine navigation and explicit New Tab.
struct CommandPalette: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let newTab: Bool
    @State private var text = ""
    @State private var index = 0
    @State private var noteHits: [Note] = []
    @FocusState private var focused: Bool

    struct Item: Identifiable { let id: String; let group: String; let title: String; let detail: String; let symbol: String; let run: () -> Void }

    var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

    var items: [Item] {
        var out: [Item] = []
        if trimmed.isEmpty {
            for r in app.recentPassages.prefix(5) {
                out.append(Item(id: "recent-\(r.id)", group: "Recent", title: r.label, detail: textInfo(r.textId).short, symbol: "clock.arrow.circlepath") {
                    open(ResolvedPassage(textId: r.textId, bookId: r.bookId, chapter: r.chapter, verse: r.verse, endVerse: r.endVerse, verseGroups: r.verseGroups ?? []))
                })
            }
        }
        let currentText = app.activeTab.flatMap { $0.tabType == .bible ? BibleState($0.state).translation : nil }
        if let ref = app.resolvePassage(trimmed, preferring: currentText) {
            out.append(Item(id: "go", group: "Go to", title: ref.label,
                            detail: textInfo(ref.textId).name, symbol: "book") { open(ref) })
            if !newTab { out.append(contentsOf: openTabs(for: ref)) }
        }
        if let id = StrongsId.normalize(trimmed) {
            out.append(Item(id: "lex", group: "Lexicon", title: "Look up \(id)", detail: "Strong's lexicon entry", symbol: "character.book.closed") { app.openLexicon(id, reuseTab: !newTab) })
            out.append(Item(id: "strongs", group: "Lexicon", title: "Verses with \(id)", detail: "Search all tagged texts", symbol: "number") { app.openSearch(id, reuseTab: !newTab) })
        }
        if !trimmed.isEmpty, StrongsId.normalize(trimmed) == nil {
            out.append(Item(id: "search", group: "Search", title: "Search all texts for “\(trimmed)”", detail: "Scripture and other writings", symbol: "magnifyingglass") { app.openSearch(trimmed, reuseTab: !newTab) })
        }
        for n in noteHits.prefix(6) {
            out.append(Item(id: "note-\(n.id)", group: "Notes", title: n.displayTitle, detail: NotesHomeView.dateLabel(n.updatedAt), symbol: "note.text") { app.openNote(n.id, newTab: newTab) })
        }
        if !trimmed.isEmpty && !newTab {
            for workspace in app.workspaceItems.filter({ $0.matches(trimmed) }).prefix(6) {
                let detail = workspace.tabTitles.first { $0.localizedCaseInsensitiveContains(trimmed) } ?? workspace.preview ?? ""
                out.append(Item(id: workspace.id, group: "Workspaces", title: workspace.name, detail: detail,
                                symbol: "square.stack") { app.open(workspace) })
            }
        }
        let commands: [(String, String, () -> Void)] = [
            ("New Note", "square.and.pencil", { app.newNote() }),
            ("Today's Note", "calendar", { app.openTodayDailyNote() }),
            ("Calendar", "calendar", { app.openCalendar(newTab: newTab) }),
            ("Notes Home", "tray.full", { app.openNotesHome(newTab: newTab) }),
            ("History", "clock", { app.openHistory(newTab: newTab) }),
            ("Tags", "tag", { app.openTags(newTab: newTab) }),
            ("New Workspace", "square.stack", { app.newWorkspace() }),
        ]
        for (t, sym, run) in commands where trimmed.isEmpty || t.localizedCaseInsensitiveContains(trimmed) {
            out.append(Item(id: "cmd-\(t)", group: "Commands", title: t, detail: "", symbol: sym, run: run))
        }
        return out
    }

    private func open(_ ref: ResolvedPassage) {
        app.visitScripture(ref, reuseTab: !newTab)
    }

    private func openTabs(for ref: ResolvedPassage) -> [Item] {
        let matches: [Item] = app.sessions.filter { $0.id != app.currentSessionId }.compactMap { workspace in
            let exact = workspace.tabs(in: .scripture).filter(ref.isShown(in:))
            let activeId = workspace.activeTabId[.scripture] ?? nil
            guard let tab = exact.first(where: { $0.id == activeId }) ?? exact.first else { return nil }
            return Item(id: "open-\(workspace.id)-\(tab.id)", group: "Open in Other Workspaces",
                        title: workspace.name, detail: tab.title, symbol: "book") {
                app.switchSession(workspace.id)
                app.select(tab.id, in: .scripture)
                app.recordRecent(textId: ref.textId, bookId: ref.bookId, chapter: ref.chapter, verse: ref.verse, endVerse: ref.endVerse, verseGroups: ref.verseGroups)
            }
        }
        return Array(matches.prefix(6))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            TextField(newTab ? "New tab: passage, Strong's number, note or words" : "Passage, Strong's number, note or words", text: $text)
                .textFieldStyle(.plain)
                .font(.title2)
                .focused($focused)
                .onSubmit { activate() }
                .onKeyPress(.downArrow) { index = min(index + 1, max(0, items.count - 1)); return .handled }
                .onKeyPress(.upArrow) { index = max(index - 1, 0); return .handled }
                .padding(16)
            Divider()
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 2) {
                        let list = items
                        ForEach(Array(list.enumerated()), id: \.element.id) { i, it in
                            if i == 0 || list[i - 1].group != it.group {
                                Text(it.group).font(.caption.weight(.semibold)).foregroundStyle(.secondary).padding(.horizontal, 10).padding(.top, i == 0 ? 4 : 10)
                            }
                            Button { index = i; activate() } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: it.symbol).frame(width: 20).foregroundStyle(i == index ? .white : .secondary)
                                    Text(it.title).lineLimit(1)
                                    Spacer()
                                    Text(it.detail).font(.caption).foregroundStyle(i == index ? .white.opacity(0.85) : .secondary).lineLimit(1)
                                }
                                .padding(.horizontal, 10).padding(.vertical, 6)
                                .foregroundStyle(i == index ? .white : .primary)
                                .background(i == index ? Color.accentColor : .clear, in: .rect(cornerRadius: 7))
                                .contentShape(.rect)
                            }
                            .buttonStyle(.interactivePlain)
                            .id(it.id)
                        }
                        if list.isEmpty { Text("No matches").foregroundStyle(.secondary).padding(10) }
                    }
                    .padding(8)
                }
                .onChange(of: index) { _, i in let l = items; if l.indices.contains(i) { proxy.scrollTo(l[i].id) } }
            }
            .frame(maxHeight: 380)
        }
        .frame(minWidth: 360, idealWidth: 560, maxWidth: 560)
        .onAppear { focused = true }
        .onChange(of: text) { index = 0 }
        .task(id: trimmed) {
            noteHits = trimmed.count < 2 ? [] : ((try? app.notes?.search(trimmed, limit: 6)) ?? [])
        }
    }

    func activate() {
        let l = items
        guard l.indices.contains(index) else { return }
        l[index].run()
        dismiss()
    }
}
#endif

import BereanReference
