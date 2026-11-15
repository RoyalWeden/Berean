import SwiftUI
import BereanCore
import BereanNotes
import BereanWorkspace
import BereanText

/// The Scripture tab's study panel (`rightPanelTab`): Lexicon or Cross References for the selected verse/word.
struct StudyInspector: View {
    @Environment(AppModel.self) private var app
    let tabId: String

    /// Verses whose Strong's numbers the Lexicon pane lists: the selection, else the focused verse.
    private func strongsVerses(_ st: BibleState) -> [Int] {
        let selected = app.studySelectedVerses(in: tabId, state: st)
        if !selected.isEmpty { return selected }
        return app.studyVerse(in: tabId, state: st).map { [$0] } ?? []
    }

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
            .labelsHidden().clickableCursor()
            .padding(10)
            Divider()
            if st.rightPanelTab == "notes" {
                VerseNotesView(bookId: st.bookId, chapter: st.chapter, verse: app.studyVerse(in: tabId, state: st),
                               textId: st.translation, selectedVerses: Set(app.studySelectedVerses(in: tabId, state: st)),
                               allowsChapterScope: true)
            } else if st.rightPanelTab == "crossrefs" {
                CrossRefsView(bookId: st.bookId, chapter: st.chapter, verse: app.studyVerse(in: tabId, state: st),
                              textId: st.translation, selectedVerses: app.studySelectedVerses(in: tabId, state: st))
            } else if let id = st.rightPanelLexiconEntry {
                if !strongsVerses(st).isEmpty {
                    Button { app.update(tabId, recordHistory: false) { $0.state.remove("rightPanelLexiconEntry") } } label: {
                        Label("Selected Verses", systemImage: "chevron.backward").font(.callout)
                    }
                    .buttonStyle(.interactivePlain)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 12).padding(.top, 8)
                }
                LexiconEntryView(strongsId: id, tabId: tabId, compact: true)
            } else if !strongsVerses(st).isEmpty {
                SelectedVersesStrongsView(tabId: tabId, bookId: st.bookId, chapter: st.chapter, textId: st.translation,
                                          verses: strongsVerses(st))
            } else {
                ContentUnavailableView("No word selected", systemImage: "character.book.closed",
                                       description: Text("Turn on Strong's numbers and click one to look it up."))
                    .frame(maxHeight: .infinity, alignment: .top)
            }
        }
        .frame(maxHeight: .infinity, alignment: .top)
        // A new verse selection shows its Strong's strip again (a previously opened entry would otherwise cover it).
        .onChange(of: strongsVerses(BibleState(app.findTab(tabId)?.state ?? JSObject()))) { _, verses in
            guard !verses.isEmpty, app.findTab(tabId)?.state["rightPanelLexiconEntry"] != nil else { return }
            app.update(tabId, recordHistory: false) { $0.state.remove("rightPanelLexiconEntry") }
        }
    }
}

#if os(macOS)
/// The Mac palette uses the same results for routine navigation and explicit New Tab.
struct CommandPalette: View {
    @Environment(AppModel.self) private var app
    let newTab: Bool
    let resultsHeight: CGFloat
    let close: () -> Void
    /// Shift-Return: open the chosen result in a new tab (original Floating Search behaviour).
    @State private var shiftNewTab = false
    private var opensNewTab: Bool { newTab || shiftNewTab }
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
            out.append(Item(id: "lex", group: "Lexicon", title: "Look up \(id)", detail: "Strong's lexicon entry", symbol: "character.book.closed") { app.openLexicon(id, reuseTab: !opensNewTab) })
            out.append(Item(id: "strongs", group: "Lexicon", title: "Verses with \(id)", detail: "Search all tagged texts", symbol: "number") { app.openSearch(id, reuseTab: !opensNewTab) })
        }
        // A note whose title is exactly what was typed comes before the word search, so Return opens it.
        let exactNotes = noteHits.filter { $0.displayTitle.caseInsensitiveCompare(trimmed) == .orderedSame }
        for n in exactNotes.prefix(3) {
            out.append(Item(id: "note-\(n.id)", group: "Top Hit", title: NotesHomeView.rowTitle(n), detail: NotesHomeView.dateLabel(n.updatedAt), symbol: "note.text") { app.openNote(n.id, newTab: opensNewTab) })
        }
        if !trimmed.isEmpty, StrongsId.normalize(trimmed) == nil {
            out.append(Item(id: "search", group: "Search", title: "Search all texts for “\(trimmed)”", detail: "Scripture and other writings", symbol: "magnifyingglass") { app.openSearch(trimmed, reuseTab: !opensNewTab) })
            out.append(Item(id: "notes-search", group: "Search", title: "Search Notes for “\(trimmed)”", detail: "Titles and text",
                            symbol: "note.text") { app.openNotesSearch(trimmed) })
        }
        for n in noteHits.filter({ hit in !exactNotes.contains { $0.id == hit.id } }).prefix(6) {
            out.append(Item(id: "note-\(n.id)", group: "Notes", title: NotesHomeView.rowTitle(n), detail: NotesHomeView.dateLabel(n.updatedAt), symbol: "note.text") { app.openNote(n.id, newTab: opensNewTab) })
        }
        if !trimmed.isEmpty && !newTab {
            for workspace in app.workspaceItems.filter({ $0.matches(trimmed) }).prefix(6) {
                let detail = workspace.tabTitles.first { $0.localizedCaseInsensitiveContains(trimmed) } ?? workspace.preview ?? ""
                out.append(Item(id: workspace.id, group: "Workspaces", title: workspace.name, detail: detail,
                                symbol: "square.stack") { app.open(workspace) })
            }
        }
        var commands: [(String, String, () -> Void)] = [
            ("New Note", "square.and.pencil", { app.newNote() }),
            ("Today's Note", "calendar", { app.openTodayDailyNote() }),
            ("Calendar", "calendar", { app.openCalendar(newTab: opensNewTab) }),
            ("Notes Home", "tray.full", { app.openNotesHome(newTab: opensNewTab) }),
            ("History", "clock", { app.openHistory(newTab: opensNewTab) }),
            ("Tags", "tag", { app.openTags(newTab: opensNewTab) }),
            ("Search Lexicon", "character.book.closed", { app.openLexiconSearch(newTab: opensNewTab) }),
            ("New Workspace", "square.stack", { app.newWorkspace() }),
        ]
        if let tab = app.activeTab {
            commands += [
                ("Duplicate Tab", "plus.square.on.square", { app.duplicate(tab.id) }),
                ("Close Other Tabs", "xmark.square", { app.closeOthers(tab.id) }),
            ]
        }
        // Reader commands (original lib/commands.ts) when a Scripture tab is active.
        if let tab = app.activeTab, tab.tabType == .bible {
            let strongs = BibleState(tab.state).showStrongs
            commands += [
                ("Next Chapter", "chevron.forward", { app.chapterStepRequest = .init(tabId: tab.id, delta: 1) }),
                ("Previous Chapter", "chevron.backward", { app.chapterStepRequest = .init(tabId: tab.id, delta: -1) }),
                (strongs ? "Hide Strong's Numbers" : "Show Strong's Numbers", "number", {
                    app.update(tab.id, recordHistory: false) { $0.state["showStrongs"] = .bool(!strongs) }
                }),
            ]
        }
        var leading: [Item] = []
        for (t, sym, run) in commands where trimmed.isEmpty || t.localizedCaseInsensitiveContains(trimmed) {
            let item = Item(id: "cmd-\(t)", group: "Commands", title: t, detail: "", symbol: sym, run: run)
            // Typing a command's name (or its start, 3+ letters) means the command: it goes first, so Return runs it
            // instead of searching Scripture for those words. A passage ("Go to") still wins over a command.
            let lower = t.lowercased(), q = trimmed.lowercased()
            if !q.isEmpty, lower == q || (q.count >= 3 && lower.hasPrefix(q)) { leading.append(item) } else { out.append(item) }
        }
        if !trimmed.isEmpty, StrongsId.normalize(trimmed) == nil, !trimmed.contains(where: \.isNumber),
           trimmed.split(separator: " ").count <= 2 {
            out.append(Item(id: "lexicon-search", group: "Lexicon", title: "Search Lexicon for “\(trimmed)”", detail: "",
                            symbol: "character.book.closed") { app.openLexiconSearch(trimmed, newTab: opensNewTab) })
        }
        if !leading.isEmpty {
            let at = out.firstIndex { $0.group != "Recent" && $0.group != "Go to" && $0.group != "Open in Other Workspaces" } ?? out.count
            out.insert(contentsOf: leading, at: at)
        }
        return out
    }

    private func open(_ ref: ResolvedPassage) {
        app.visitScripture(ref, reuseTab: !opensNewTab)
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
            HStack(spacing: 12) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary).accessibilityHidden(true)
                TextField(newTab ? "New tab: passage, Strong's number, note or words" : "Passage, Strong's number, note or words", text: $text)
                .textFieldStyle(.plain)
                .font(.title2)
                .focused($focused)
                .onSubmit { activate() }
                .onKeyPress(.return, phases: .down) { press in
                    guard press.modifiers.contains(.shift) else { return .ignored }
                    shiftNewTab = true
                    activate()
                    return .handled
                }
                .onKeyPress(.downArrow) { index = min(index + 1, max(0, items.count - 1)); return .handled }
                .onKeyPress(.upArrow) { index = max(index - 1, 0); return .handled }
            }
            .padding(.horizontal, 20)
            .frame(height: 58)
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
                                    Image(systemName: it.symbol).frame(width: 20).foregroundStyle(.secondary)
                                    Text(it.title).lineLimit(1)
                                    Spacer()
                                    Text(it.detail).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                }
                                .padding(.horizontal, 10).padding(.vertical, 6)
                                .foregroundStyle(.primary)
                                .background(i == index ? Color.primary.opacity(0.09) : .clear, in: .rect(cornerRadius: 8))
                                .contentShape(.rect)
                            }
                            .buttonStyle(.interactivePlain)
                            .id(it.id)
                        }
                        if list.isEmpty { Text("No matches").foregroundStyle(.secondary).padding(10) }
                    }
                    .padding(8)
                    .id("paletteResultsStart")
                }
                .onChange(of: text) {
                    index = 0
                    proxy.scrollTo("paletteResultsStart", anchor: .top)
                }
                .onChange(of: index) { _, i in
                    guard i != 0 else {
                        proxy.scrollTo("paletteResultsStart", anchor: .top)
                        return
                    }
                    let list = items
                    if list.indices.contains(i) { proxy.scrollTo(list[i].id) }
                }
            }
            .frame(height: resultsHeight)
            Divider()
            HStack(spacing: 8) {
                Spacer()
                Text("Open").foregroundStyle(.secondary)
                Text("↩").font(.caption.monospaced())
                Text("Close").foregroundStyle(.secondary).padding(.leading, 8)
                Text("Esc").font(.caption.monospaced())
            }
            .font(.caption)
            .padding(.horizontal, 16)
            .frame(height: 32)
        }
        .background(.regularMaterial, in: .rect(cornerRadius: 18))
        .overlay { RoundedRectangle(cornerRadius: 18).strokeBorder(.primary.opacity(0.14)).allowsHitTesting(false) }
        .clipShape(.rect(cornerRadius: 18))
        .shadow(color: .black.opacity(0.24), radius: 22, y: 8)
        .accessibilityElement(children: .contain)
        .onExitCommand(perform: close)
        .onAppear { focused = true }
        .task(id: trimmed) {
            noteHits = trimmed.count < 2 ? [] : ((try? app.notes?.search(trimmed, limit: 6)) ?? [])
        }
    }

    func activate() {
        let l = items
        guard l.indices.contains(index) else { return }
        l[index].run()
        close()
    }
}
#endif

import BereanReference

/// The selected verses with their Strong's numbers as tappable superscripts — port of SelectedVersesStrongs.tsx, shown in the
/// Lexicon pane while verses are selected and no entry is open. Tapping a number opens it in the same pane.
struct SelectedVersesStrongsView: View {
    @Environment(AppModel.self) private var app
    let tabId: String
    let bookId: String
    let chapter: Int
    let textId: String
    let verses: [Int]
    @State private var rows: [(verse: Int, tokens: [StudyToken])] = []
    static let limit = 60

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text(verses.count == 1 ? "Selected verse" : "Selected verses · \(verses.count)")
                    .font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
                ForEach(rows, id: \.verse) { row in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(Reference.bookChapterVerseLabel(bookId, chapter: chapter, verse: row.verse) + (textId == "lxx" ? " LXX" : ""))
                            .font(.footnote.weight(.semibold))
                        Text(attributed(row.tokens)).font(.body).lineSpacing(4)
                            .environment(\.openURL, OpenURLAction { url in
                                guard url.scheme == "berean-lexicon" else { return .systemAction }
                                app.navigateLexicon(String(url.absoluteString.dropFirst("berean-lexicon:".count)), in: tabId)
                                return .handled
                            })
                        if !row.tokens.contains(where: { !$0.strongs.isEmpty }) {
                            Text("No Strong's tagging for this text.").font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                    Divider()
                }
                if verses.count > Self.limit {
                    Text("+\(verses.count - Self.limit) more selected — narrow the selection to see them here.")
                        .font(.caption).foregroundStyle(.secondary)
                }
                Text("Tap a number to open its lexicon entry.").font(.caption2).foregroundStyle(.tertiary)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .task(id: "\(textId)|\(bookId)|\(chapter)|\(verses)|\(app.wordReplacerEnabled)") {
            var out: [(Int, [StudyToken])] = []
            for v in verses.sorted().prefix(Self.limit) {
                guard let row = await app.bible.queryVerse(bookId, chapter, v, textId: textId) else { continue }
                out.append((v, VerseDisplay.studyTokens(row.text, tagged: row.textTagged, textId: textId,
                                                        replacerEnabled: app.wordReplacerEnabled, rules: WordReplacer.defaultRules)))
            }
            rows = out.map { (verse: $0.0, tokens: $0.1) }
        }
    }

    private func attributed(_ tokens: [StudyToken]) -> AttributedString {
        var out = AttributedString()
        for t in tokens {
            var word = AttributedString(t.word)
            if t.isRedLetter { word.foregroundColor = .red }
            if t.isItalic { word.font = .body.italic() }
            out += word
            for n in t.strongs {
                let num = n.replacingOccurrences(of: "(", with: "").replacingOccurrences(of: ")", with: "")
                var chip = AttributedString("\u{2009}" + num)
                chip.font = .caption2.monospaced()
                chip.baselineOffset = 6
                chip.foregroundColor = n.hasPrefix("(") ? .secondary : .accentColor
                chip.link = URL(string: "berean-lexicon:" + num)
                out += chip
            }
            out += AttributedString(" ")
        }
        return out
    }
}
