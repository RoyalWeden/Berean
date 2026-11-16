import SwiftUI
import BereanCore
import BereanNotes
import BereanWorkspace
import BereanText

private extension InspectorTool {
    var title: String {
        switch self {
        case .notes: "Notes"
        case .lexicon: "Lexicon"
        case .crossrefs: "Cross Refs"
        }
    }
}

extension StudyPanelSlots {
    /// Route actions from the Scripture reader to the pane that owns the tool.
    static func focus(_ panel: InspectorTool, in state: inout JSObject) {
        #if os(macOS)
        var slots = Self(state)
        if usesSplitPane(in: state), slots.secondaryTabs.contains(panel) {
            slots.focusSecondary(panel)
            slots.write(to: &state)
            return
        }
        #endif
        state["rightPanelTab"] = .string(JSString(panel.rawValue))
    }

    private static func usesSplitPane(in state: JSObject) -> Bool {
        #if os(macOS)
        switch ScriptureLayout(rawValue: BibleState(state).scriptureLayout) ?? .standard {
        case .standard, .panelBottom, .panelLeft, .notesWide, .scriptureWide: true
        default: false
        }
        #else
        false
        #endif
    }

    static func lexiconKey(in state: JSObject) -> JSString {
        #if os(macOS)
        if usesSplitPane(in: state), Self(state).secondaryTabs.contains(.lexicon) { return "rightPanelLexiconEntryB" }
        #endif
        return "rightPanelLexiconEntry"
    }
}

/// The Scripture tab's study panel for Notes, Lexicon, and Cross References.
struct StudyInspector: View {
    @Environment(AppModel.self) private var app
    let tabId: String

    #if os(macOS)
    @State private var dragToken = UUID()
    @State private var dropOnSecondary: Bool?
    #endif

    var body: some View {
        let state = app.findTab(tabId)?.state ?? JSObject()
        let reader = BibleState(state)
        let slots = StudyPanelSlots(state)
        let lexiconKey = StudyPanelSlots.lexiconKey(in: state)
        Group {
            #if os(macOS)
            if let secondary = slots.secondary {
                VSplitView {
                    pane(slots.primary, tabs: slots.primaryTabs, reader: reader, lexiconKey: lexiconKey, secondary: false)
                        .frame(minHeight: 120)
                    pane(secondary, tabs: slots.secondaryTabs, reader: reader, lexiconKey: lexiconKey, secondary: true)
                        .frame(minHeight: 120)
                }
            } else {
                pane(slots.primary, tabs: InspectorTool.allCases, reader: reader, lexiconKey: lexiconKey, secondary: false)
            }
            #else
            pane(InspectorTool(rawValue: reader.rightPanelTab) ?? .lexicon, tabs: InspectorTool.allCases,
                 reader: reader, lexiconKey: lexiconKey, secondary: false)
            #endif
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .onChange(of: app.studyStrongsVerses(in: tabId, state: reader)) { _, verses in
            guard !verses.isEmpty, app.findTab(tabId)?.state[lexiconKey] != nil else { return }
            app.update(tabId, recordHistory: false) { $0.state.remove(lexiconKey) }
        }
    }

    private func pane(_ panel: InspectorTool, tabs: [InspectorTool], reader: BibleState, lexiconKey: JSString, secondary: Bool) -> some View {
        VStack(spacing: 0) {
            #if os(macOS)
            macPaneHeader(panel, tabs: tabs, secondary: secondary)
            #else
            Picker("Study pane", selection: Binding(get: { panel }, set: focusTool)) {
                ForEach(tabs) { Text($0.title).tag($0) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .padding(10)
            #endif
            Divider()
            panelContent(panel, st: reader, lexiconKey: lexiconKey)
                .frame(maxHeight: .infinity, alignment: .top)
        }
    }

    private func focusTool(_ tool: InspectorTool) {
        app.update(tabId, recordHistory: false) { StudyPanelSlots.focus(tool, in: &$0.state) }
    }

    #if os(macOS)
    private func macPaneHeader(_ panel: InspectorTool, tabs: [InspectorTool], secondary: Bool) -> some View {
        HStack(spacing: 6) {
            HStack(spacing: 2) {
                ForEach(tabs) { tool in
                    Button { focusTool(tool) } label: {
                        Text(tool.title)
                            .font(.callout.weight(tool == panel ? .semibold : .regular))
                            .lineLimit(1)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 5)
                            .background(tool == panel ? Color.accentColor.opacity(0.16) : .clear, in: .rect(cornerRadius: 6))
                            .contentShape(.rect)
                    }
                    .buttonStyle(.interactivePlain)
                    .accessibilityAddTraits(tool == panel ? .isSelected : [])
                    .draggable(dragPayload(tool)) {
                        Text(tool.title).font(.callout.weight(.semibold))
                            .padding(.horizontal, 12).padding(.vertical, 7)
                            .background(.regularMaterial, in: .capsule)
                    }
                }
            }
            .padding(2)
            .background(.quaternary.opacity(0.55), in: .rect(cornerRadius: 8))
            paneActions(secondary: secondary)
        }
        .padding(10)
        .background(dropOnSecondary == secondary ? Color.accentColor.opacity(0.13) : .clear)
        .contentShape(.rect)
        .dropDestination(for: String.self) { items, _ in
            guard let payload = items.first,
                  let tool = InspectorTool.allCases.first(where: { dragPayload($0) == payload }) else { return false }
            let slots = StudyPanelSlots(app.findTab(tabId)?.state ?? JSObject())
            if secondary {
                guard slots.primaryTabs.contains(tool), slots.primaryTabs.count > 1 else { return false }
            } else {
                guard slots.secondaryTabs.contains(tool) else { return false }
            }
            changeSlots { $0.move(tool, toSecondary: secondary) }
            return true
        } isTargeted: { targeted in
            if targeted { dropOnSecondary = secondary }
            else if dropOnSecondary == secondary { dropOnSecondary = nil }
        }
    }

    private func dragPayload(_ tool: InspectorTool) -> String {
        "\(dragToken)|\(tabId)|\(tool.rawValue)"
    }

    private func paneActions(secondary: Bool) -> some View {
        let slots = StudyPanelSlots(app.findTab(tabId)?.state ?? JSObject())
        return Menu {
            if secondary {
                ForEach(slots.secondaryTabs) { panel in
                    Button("Move \(panel.title) to Main Pane") { changeSlots { $0.move(panel, toSecondary: false) } }
                }
                Button("Close Second Pane") { changeSlots { $0.closeSecondary() } }
            } else {
                ForEach(slots.primaryTabs) { panel in
                    Button("Move \(panel.title) to Second Pane") { changeSlots { $0.move(panel, toSecondary: true) } }
                        .disabled(slots.primaryTabs.count < 2)
                }
            }
        } label: {
            Label(secondary ? "Second Pane Actions" : "Study Pane Actions", systemImage: "ellipsis.circle")
                .labelStyle(.iconOnly)
        }
        .menuStyle(.borderlessButton).menuIndicator(.hidden).fixedSize().clickableCursor()
    }

    private func changeSlots(_ change: (inout StudyPanelSlots) -> Void) {
        app.update(tabId, recordHistory: false) { tab in
            var slots = StudyPanelSlots(tab.state)
            let oldKey = StudyPanelSlots.lexiconKey(in: tab.state)
            change(&slots)
            slots.write(to: &tab.state)
            let newKey = StudyPanelSlots.lexiconKey(in: tab.state)
            if oldKey != newKey {
                tab.state[newKey] = tab.state[oldKey]
                tab.state.remove(oldKey)
            }
        }
    }
    #endif

    @ViewBuilder private func panelContent(_ panel: InspectorTool, st: BibleState, lexiconKey: JSString) -> some View {
        if panel == .notes {
            VerseNotesView(bookId: st.bookId, chapter: st.chapter, verse: app.studyVerse(in: tabId, state: st),
                           textId: st.translation, selectedVerses: Set(app.studySelectedVerses(in: tabId, state: st)),
                           allowsChapterScope: true)
        } else if panel == .crossrefs {
            CrossRefsView(bookId: st.bookId, chapter: st.chapter, verse: app.studyVerse(in: tabId, state: st),
                          textId: st.translation, selectedVerses: app.studySelectedVerses(in: tabId, state: st))
        } else {
            StudyLexiconContent(tabId: tabId, reader: st, lexiconKey: lexiconKey)
        }
    }
}

struct StudyLexiconContent: View {
    @Environment(AppModel.self) private var app
    let tabId: String
    let reader: BibleState
    let lexiconKey: JSString

    var body: some View {
        let verses = app.studyStrongsVerses(in: tabId, state: reader)
        if let id = app.findTab(tabId)?.state[lexiconKey]?.stringValue?.string {
            VStack(spacing: 0) {
                if !verses.isEmpty {
                    Button {
                        app.update(tabId, recordHistory: false) { $0.state.remove(lexiconKey) }
                    } label: {
                        Label("Selected Verses", systemImage: "chevron.backward").font(.callout)
                    }
                    .buttonStyle(.interactivePlain)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 12).padding(.top, 8)
                }
                LexiconEntryView(strongsId: id, tabId: tabId, compact: true)
            }
        } else if !verses.isEmpty {
            SelectedVersesStrongsView(tabId: tabId, bookId: reader.bookId, chapter: reader.chapter,
                                      textId: reader.translation, verses: verses)
        } else {
            ContentUnavailableView("No word selected", systemImage: "character.book.closed",
                                   description: Text("Select a verse or tap a Strong’s number."))
                .frame(maxHeight: .infinity, alignment: .top)
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
    @State private var text = ""
    @State private var textSelection: TextSelection?
    @State private var index = 0
    @State private var selectionQuery = ""
    @State private var noteResults: (query: String, hits: [Note])?
    @State private var actionsShown = false
    @FocusState private var focused: Bool

    struct Item: Identifiable {
        let id: String
        let group: String
        let title: String
        let detail: String
        let symbol: String
        var offersOpenMenu = false
        var sourceRestore: (name: String, run: () -> Void)?
        var hasActions: Bool { offersOpenMenu || sourceRestore != nil }
        let run: (_ inNewTab: Bool) -> Void
    }

    var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var prefersActiveTab: Bool { app.commandPaletteLocationRequest != nil }

    private func items(for trimmed: String, noteHits: [Note]) -> [Item] {
        var out: [Item] = []
        let preferActiveTab = prefersActiveTab
        if trimmed.isEmpty {
            for r in app.recentPassages.prefix(5) {
                out.append(Item(id: "recent-\(r.id)", group: "Recent", title: r.label, detail: textInfo(r.textId).short, symbol: "clock.arrow.circlepath", offersOpenMenu: true) { inNewTab in
                    app.visitScripture(ResolvedPassage(textId: r.textId, bookId: r.bookId, chapter: r.chapter, verse: r.verse, endVerse: r.endVerse, verseGroups: r.verseGroups ?? []), reuseTab: !inNewTab, preferActiveTab: preferActiveTab)
                })
            }
        }
        let currentText = app.activeTab.flatMap { $0.tabType == .bible ? BibleState($0.state).translation : nil }
        if let ref = app.resolvePassage(trimmed, preferring: currentText) {
            out.append(Item(id: "go", group: "Go to", title: ref.label,
                            detail: textInfo(ref.textId).name, symbol: "book", offersOpenMenu: true) { inNewTab in app.visitScripture(ref, reuseTab: !inNewTab, preferActiveTab: preferActiveTab) })
            if !newTab { out.append(contentsOf: openTabs(for: ref)) }
        }
        if let id = StrongsId.normalize(trimmed) {
            out.append(Item(id: "lex", group: "Lexicon", title: "Look up \(id)", detail: "Strong's lexicon entry", symbol: "character.book.closed", offersOpenMenu: true) { inNewTab in app.openLexicon(id, reuseTab: !inNewTab, preferActiveTab: preferActiveTab) })
            out.append(Item(id: "strongs", group: "Lexicon", title: "Verses with \(id)", detail: "Search all tagged texts", symbol: "number", offersOpenMenu: true) { inNewTab in app.openSearch(id, reuseTab: !inNewTab, preferActiveTab: preferActiveTab) })
        }
        // A note whose title is exactly what was typed comes before the word search, so Return opens it.
        let exactNotes = noteHits.filter { $0.displayTitle.caseInsensitiveCompare(trimmed) == .orderedSame }
        for n in exactNotes.prefix(3) {
            out.append(Item(id: "note-\(n.id)", group: "Top Hit", title: NotesHomeView.rowTitle(n), detail: NotesHomeView.dateLabel(n.updatedAt), symbol: "note.text", offersOpenMenu: true) { inNewTab in app.openNote(n.id, newTab: inNewTab, preferActiveTab: preferActiveTab) })
        }
        if !trimmed.isEmpty, StrongsId.normalize(trimmed) == nil {
            let qualified = app.editionQualifiedQuery(trimmed)
            let scope = qualified.map { textInfo($0.text).short } ?? "all texts"
            let words = qualified?.query ?? trimmed
            out.append(Item(id: "search", group: "Search", title: "Search \(scope) for “\(words)”", detail: qualified == nil ? "Scripture and other writings" : "", symbol: "magnifyingglass", offersOpenMenu: true) { inNewTab in app.openSearch(trimmed, reuseTab: !inNewTab, preferActiveTab: preferActiveTab) })
            out.append(Item(id: "notes-search", group: "Search", title: "Search Notes for “\(trimmed)”", detail: "Titles and text",
                            symbol: "note.text") { _ in app.openNotesSearch(trimmed) })
        }
        for n in noteHits.filter({ hit in !exactNotes.contains { $0.id == hit.id } }).prefix(6) {
            out.append(Item(id: "note-\(n.id)", group: "Notes", title: NotesHomeView.rowTitle(n), detail: NotesHomeView.dateLabel(n.updatedAt), symbol: "note.text", offersOpenMenu: true) { inNewTab in app.openNote(n.id, newTab: inNewTab, preferActiveTab: preferActiveTab) })
        }
        if !trimmed.isEmpty && !newTab {
            for match in app.matchingArchivedTabs(trimmed) {
                let restore = match.sourceName.map { name in
                    (name: name, run: { app.restoreArchivedTab(match.tab.id, from: match.groupID, toSource: true) })
                }
                out.append(Item(id: "archived-\(match.id)", group: "Archived Tabs", title: match.tab.navigationLabel,
                                detail: match.groupTitle, symbol: "archivebox", sourceRestore: restore) { _ in
                    app.restoreArchivedTab(match.tab.id, from: match.groupID)
                })
            }
            for workspace in app.workspaceItems.filter({ $0.matches(trimmed) }).prefix(6) {
                let detail = workspace.tabTitles.first { $0.localizedCaseInsensitiveContains(trimmed) } ?? workspace.preview ?? ""
                out.append(Item(id: workspace.id, group: "Workspaces", title: workspace.displayName, detail: detail == workspace.displayName ? workspace.displayDetail : detail,
                                symbol: "square.stack") { _ in app.open(workspace) })
            }
        }
        var commands: [(String, String, (Bool) -> Void)] = [
            ("New Note", "square.and.pencil", { _ in app.newNote() }),
            ("Today's Note", "calendar", { _ in app.openTodayDailyNote() }),
            ("Calendar", "calendar", { inNewTab in app.openCalendar(newTab: inNewTab) }),
            ("Notes", "tray.full", { inNewTab in app.openNotesHome(newTab: inNewTab) }),
            ("History", "clock", { inNewTab in app.openHistory(newTab: inNewTab) }),
            ("Tags", "tag", { inNewTab in app.openTags(newTab: inNewTab) }),
            ("Search Lexicon", "character.book.closed", { inNewTab in app.openLexiconSearch(newTab: inNewTab) }),
            ("New Workspace", "square.stack", { _ in app.newWorkspace() }),
        ]
        if let tab = app.activeTab {
            commands += [
                ("Duplicate Tab", "plus.square.on.square", { _ in app.duplicate(tab.id) }),
                ("Close Other Tabs", "xmark.square", { _ in app.closeOthers(tab.id) }),
            ]
        }
        // Reader commands (original lib/commands.ts) when a Scripture tab is active.
        if let tab = app.activeTab, tab.tabType == .bible {
            let strongs = BibleState(tab.state).showStrongs
            commands += [
                ("Next Chapter", "chevron.forward", { _ in app.chapterStepRequest = .init(tabId: tab.id, delta: 1) }),
                ("Previous Chapter", "chevron.backward", { _ in app.chapterStepRequest = .init(tabId: tab.id, delta: -1) }),
                (strongs ? "Hide Strong's Numbers" : "Show Strong's Numbers", "number", { _ in
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
                            symbol: "character.book.closed", offersOpenMenu: true) { inNewTab in app.openLexiconSearch(trimmed, newTab: inNewTab) })
        }
        if !leading.isEmpty {
            let at = out.firstIndex { $0.group != "Recent" && $0.group != "Go to" && $0.group != "Open in Other Workspaces" } ?? out.count
            out.insert(contentsOf: leading, at: at)
        }
        return out
    }

    private func openTabs(for ref: ResolvedPassage) -> [Item] {
        app.openPassageMatches(ref).map { match in
            Item(id: "open-\(match.id)", group: "Open in Other Workspaces",
                 title: match.workspaceName, detail: match.tab.navigationLabel, symbol: "book") { _ in
                app.openWorkspacePassage(ref, match: match)
            }
        }
    }

    private func actionTitle(_ item: Item) -> String {
        switch item.group {
        case "Open in Other Workspaces": return "Switch to Tab"
        case "Workspaces": return "Open Workspace"
        case "Archived Tabs": return "Restore Tab"
        case "Commands": return "Run Command"
        default:
            if newTab && item.offersOpenMenu { return "Open in New Tab" }
            switch item.id {
            case "search", "strongs": return "Search Scripture"
            case "notes-search": return "Search Notes"
            case "lexicon-search": return "Search Lexicon"
            case "lex": return "Look Up"
            default: return "Open"
            }
        }
    }

    private func selectedIndex(in list: [Item], query: String) -> Int? {
        let candidate = selectionQuery == query ? index : 0
        return list.indices.contains(candidate) ? candidate : list.indices.last
    }

    private func noteHits(for query: String) -> [Note] {
        guard query.count >= 2 else { return [] }
        return (try? app.notes?.search(query, limit: 6)) ?? []
    }

    private func submit(inNewTab: Bool) {
        let query = trimmed
        let hits = noteResults.flatMap { $0.query == query ? $0.hits : nil } ?? noteHits(for: query)
        let current = items(for: query, noteHits: hits)
        guard let selected = selectedIndex(in: current, query: query) else { return }
        activate(current[selected], inNewTab: inNewTab)
    }

    private func moveSelection(_ delta: Int, in list: [Item], proxy: ScrollViewProxy) {
        let query = trimmed
        guard let current = selectedIndex(in: list, query: query) else { return }
        selectionQuery = query
        index = min(max(current + delta, 0), list.count - 1)
        if index == 0 {
            proxy.scrollTo("paletteResultsStart", anchor: .top)
        } else {
            proxy.scrollTo(list[index].id)
        }
    }

    var body: some View {
        let query = trimmed
        let list = items(for: query, noteHits: noteResults?.query == query ? noteResults?.hits ?? [] : [])
        let selection = selectedIndex(in: list, query: query)
        let selected = selection.map { list[$0] }
        ScrollViewReader { proxy in
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 12) {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary).accessibilityHidden(true)
                    TextField(newTab ? "New tab: passage, Strong's number, note or words" : "Passage, Strong's number, note or words", text: $text, selection: $textSelection)
                    .textFieldStyle(.plain)
                    .font(.system(size: 18))
                    .focused($focused)
                    .onSubmit { submit(inNewTab: newTab) }
                    .onKeyPress(.return, phases: .down) { press in
                        guard press.modifiers.contains(.shift) else { return .ignored }
                        submit(inNewTab: true)
                        return .handled
                    }
                    .onKeyPress(.downArrow) { moveSelection(1, in: list, proxy: proxy); return .handled }
                    .onKeyPress(.upArrow) { moveSelection(-1, in: list, proxy: proxy); return .handled }
                }
                .padding(.horizontal, 20)
                .frame(height: 58)
                Divider()
                ScrollView {
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(Array(list.enumerated()), id: \.element.id) { i, it in
                            if i == 0 || list[i - 1].group != it.group {
                                Text(it.group).font(.caption.weight(.semibold)).foregroundStyle(.secondary).padding(.horizontal, 10).padding(.top, i == 0 ? 4 : 10)
                            }
                            Button { activate(it, inNewTab: newTab) } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: it.symbol).frame(width: 20).foregroundStyle(.secondary)
                                    Text(it.title).font(.system(size: 14)).lineLimit(1)
                                    if !it.detail.isEmpty {
                                        Text(it.detail).font(.callout).foregroundStyle(.secondary).lineLimit(1)
                                    }
                                    Spacer(minLength: 4)
                                    if i == selection || it.group == "Open in Other Workspaces" {
                                        Text(actionTitle(it)).font(.callout).foregroundStyle(.secondary)
                                            .lineLimit(1).layoutPriority(1)
                                    }
                                }
                                .padding(.horizontal, 10).padding(.vertical, 7)
                                .foregroundStyle(.primary)
                                .background(i == selection ? Color.primary.opacity(0.09) : .clear, in: .rect(cornerRadius: 8))
                                .contentShape(.rect)
                            }
                            .buttonStyle(.interactivePlain)
                            .onHover { inside in
                                if inside && trimmed == query { selectionQuery = query; index = i }
                            }
                            .contextMenu {
                                resultActions(it)
                            }
                            .id(it.id)
                        }
                        if list.isEmpty { Text("No matches").foregroundStyle(.secondary).padding(10) }
                    }
                    .padding(8)
                    .id("paletteResultsStart")
                }
                .onChange(of: query) {
                    selectionQuery = query
                    index = 0
                    proxy.scrollTo("paletteResultsStart", anchor: .top)
                }
                .frame(height: resultsHeight)
                Divider()
                HStack {
                    Spacer()
                    if let selected {
                        HStack(spacing: 4) {
                            Button {
                                activate(selected, inNewTab: newTab)
                            } label: {
                                HStack(spacing: 6) {
                                    Text(actionTitle(selected))
                                    Image(systemName: "return").font(.system(size: 13, weight: .semibold))
                                        .frame(width: 23, height: 23)
                                        .background(.quaternary, in: .rect(cornerRadius: 5))
                                        .accessibilityHidden(true)
                                }
                                .padding(.horizontal, 11).padding(.vertical, 8)
                                .contentShape(.capsule)
                            }
                            .buttonStyle(.interactivePlain)

                            if selected.hasActions {
                                Button {
                                    actionsShown.toggle()
                                } label: {
                                    HStack(spacing: 4) {
                                        Text("Actions")
                                        shortcutKey("⌘")
                                        shortcutKey("K")
                                    }
                                    .padding(.horizontal, 11).padding(.vertical, 8)
                                    .contentShape(.capsule)
                                }
                                .buttonStyle(.interactivePlain)
                                .help("Search result actions (⌘K)")
                                .popover(isPresented: $actionsShown, arrowEdge: .bottom) {
                                    VStack(alignment: .leading, spacing: 6) {
                                        resultActions(selected)
                                    }
                                    .controlSize(.large)
                                    .padding(8)
                                    .onExitCommand { actionsShown = false; focused = true }
                                }
                            }
                        }
                        .glassEffectCompat(interactive: true)
                    }
                }
                .font(.system(size: 14))
                .padding(.horizontal, 10)
                .frame(height: 58)
            }
        }
        .clipShape(.rect(cornerRadius: 20))
        .modifier(CommandPaletteSurface())
        .defaultFocus($focused, true, priority: .userInitiated)
        .onAppear { focused = true }
        .accessibilityElement(children: .contain)
        .onExitCommand {
            if actionsShown {
                actionsShown = false
                focused = true
            } else {
                close()
            }
        }
        .onChange(of: app.commandPaletteActionsRequest) {
            guard selected?.hasActions == true else { return }
            actionsShown.toggle()
            if !actionsShown { focused = true }
        }
        .onChange(of: selected?.id) { actionsShown = false }
        .task(id: app.commandPaletteLocationRequest) {
            let location = app.commandPaletteLocationRequest
            if let location {
                textSelection = nil
                text = location.text
                selectionQuery = trimmed
                index = 0
                actionsShown = false
            }
            await Task.yield()
            guard !Task.isCancelled else { return }
            focused = true
            guard let location, !location.text.isEmpty else { return }
            // The field editor attaches on the next AppKit update after SwiftUI requests focus.
            try? await Task.sleep(for: .milliseconds(30))
            guard !Task.isCancelled, text == location.text else { return }
            textSelection = TextSelection(range: text.startIndex..<text.endIndex)
        }
        .task(id: query) {
            guard !Task.isCancelled else { return }
            noteResults = (query, noteHits(for: query))
        }
    }

    private func shortcutKey(_ label: String) -> some View {
        Text(label).font(.system(size: 14, weight: .semibold))
            .frame(width: 23, height: 23)
            .background(.quaternary, in: .rect(cornerRadius: 5))
            .accessibilityHidden(true)
    }

    @ViewBuilder private func resultActions(_ item: Item) -> some View {
        if item.offersOpenMenu {
            Button("Open", systemImage: "arrow.right") { activate(item, inNewTab: false) }
            Button("Open in New Tab", systemImage: "plus.square") { activate(item, inNewTab: true) }
        }
        if let source = item.sourceRestore {
            Button("Restore to \(source.name)", systemImage: "square.stack") {
                source.run()
                close()
            }
        }
    }

    private func activate(_ item: Item, inNewTab: Bool) {
        let source = prefersActiveTab && !inNewTab && item.offersOpenMenu ? app.activeTab?.id : nil
        item.run(inNewTab)
        app.recordTabReturn(to: source)
        close()
    }
}

private struct CommandPaletteSurface: ViewModifier {
    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: 20)
        if #available(macOS 26.0, *) {
            content
                .glassEffect(.regular, in: shape)
                .shadow(color: .black.opacity(0.22), radius: 24, y: 10)
        } else {
            content
                .background(.thinMaterial, in: shape)
                .overlay { shape.strokeBorder(.primary.opacity(0.14)).allowsHitTesting(false) }
                .shadow(color: .black.opacity(0.24), radius: 22, y: 8)
        }
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
            rows = []
            var out: [(Int, [StudyToken])] = []
            for v in verses.sorted().prefix(Self.limit) {
                let row = await app.bible.queryVerse(bookId, chapter, v, textId: textId)
                guard !Task.isCancelled else { return }
                guard let row else { continue }
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
