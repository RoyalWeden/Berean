import SwiftUI
import BereanCore
import BereanWorkspace
import BereanReference

/// The native iPhone shell, following the existing iPhone navigation (docs/mobile/mobile-navigation.md):
/// bottom-left tabs, bottom-centre Go (reference / Strong's / search), bottom-right More with the
/// current tab's commands. Content views are shared with the Mac app.
struct IOSRootView: View {
    @Environment(AppModel.self) private var app
    @State private var showTabs = false
    @State private var showGo = false
    @State private var explicitNewTab = false
    @State private var showSettings = false
    @State private var findRequest = 0

    var body: some View {
        @Bindable var app = app
        NavigationStack {
            content
                .safeAreaInset(edge: .bottom, spacing: 0) { bottomBar }
        }
        .studyTrailSheet(app: app)
        .sheet(isPresented: $showSettings) { NavigationStack { SettingsView().navigationTitle("Settings").toolbar { Button("Done") { showSettings = false } } } }
        .sheet(isPresented: $showTabs) { TabCardsSheet().presentationDetents([.medium, .large]) }
        .sheet(isPresented: $showGo) { GoSheet(newTab: explicitNewTab, close: { showGo = false }).presentationDetents([.large]) }
        // ⌘T / ⌘K (hardware keyboard) and in-app "new tab" requests open the same sheet.
        .onChange(of: app.commandPaletteShown) { _, v in if v { app.commandPaletteShown = false; openGo(newTab: true) } }
        .alert(app.userMessage ?? "", isPresented: Binding(get: { app.userMessage != nil }, set: { if !$0 { app.userMessage = nil } })) { Button("OK") {} }
    }

    private func openGo(newTab: Bool = false) {
        explicitNewTab = newTab
        showGo = true
    }

    private var bottomBar: some View {
        HStack(spacing: 8) {
            Button { showTabs = true } label: { bottomItem(symbol: "square.on.square", badge: app.tabCount(app.currentSessionId)) }
                .accessibilityLabel("Tabs and workspaces, \(app.tabCount(app.currentSessionId)) open")
            Button { openGo() } label: { bottomItem(symbol: "magnifyingglass", prominent: true) }
                .accessibilityLabel("Go to a passage or search")
            menu
        }
        .buttonStyle(.interactivePlain)
        .padding(.horizontal, 12)
        .padding(.vertical, 3)
        .glassEffectCompat(interactive: true)
        .frame(maxWidth: 260)
        .padding(.horizontal, 14)
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity)
    }

    private func bottomItem(symbol: String, prominent: Bool = false, badge: Int? = nil) -> some View {
        Image(systemName: symbol)
            .font(.system(size: 17, weight: .semibold))
            .frame(width: 46, height: 30)
            .foregroundStyle(prominent ? Color.white : Color.primary)
            .background {
                if prominent { Capsule().fill(Color.accentColor) }
            }
            .overlay(alignment: .topTrailing) {
                if let badge, badge > 0 {
                    Text(badge > 99 ? "99+" : String(badge))
                        .font(.system(size: 9, weight: .semibold).monospacedDigit())
                        .padding(.horizontal, 4)
                        .padding(.vertical, 2)
                        .background(.thinMaterial, in: .capsule)
                        .offset(x: 6, y: -1)
                        .accessibilityHidden(true)
                }
            }
        .frame(maxWidth: .infinity, minHeight: 44)
        .contentShape(.rect)
    }

    @ViewBuilder var content: some View {
        if let tab = app.activeTab {
            switch tab.tabType {
            case .bible:
                let st = BibleState(tab.state)
                ScriptureView(tabId: tab.id, findRequest: findRequest).id(tab.id)
                    .inspector(isPresented: Binding(get: { st.rightPanelOpen }, set: { v in
                        app.update(tab.id) { t in var s = BibleState(t.state); s.rightPanelOpen = v; t.state = s.merged(into: t.state) }
                    })) { StudyInspector(tabId: tab.id).presentationDetents([.medium, .large]) }
            case .lexicon:
                LexiconEntryView(strongsId: tab.state["strongsNum"]?.stringValue?.string ?? "", tabId: tab.id).id(tab.id).navigationTitle(tab.title)
            case .search:
                SearchResultsView(tabId: tab.id).id(tab.id)
            case .note:
                if let id = tab.state["noteId"]?.stringValue?.string { NoteDetailView(noteId: id).id(tab.id + id) } else { NotesHomeView(tabId: tab.id).id(tab.id) }
            case .calendar:
                DailyNoteCalendar(tabId: tab.id).id(tab.id)
            case .history:
                HistoryView(tabId: tab.id).id(tab.id)
            case .tags:
                TagManagerView().id(tab.id)
            default:
                ContentUnavailableView(tab.title, systemImage: "square.dashed", description: Text("This kind of tab arrives in a later native build."))
            }
        } else {
            ContentUnavailableView {
                Label("No tab open", systemImage: "book")
            } description: { Text("Open a passage, a note or a search.") } actions: {
                Button("Go…") { openGo() }.buttonStyle(.borderedProminent)
            }
        }
    }

    /// Commands for what is on screen, then the app-level items (always last, always the same).
    var menu: some View {
        Menu {
            if app.canGoBack || app.canGoForward {
                ControlGroup {
                    Button { app.goBack() } label: { Label("Back", systemImage: "chevron.backward") }.disabled(!app.canGoBack)
                    Button { app.goForward() } label: { Label("Forward", systemImage: "chevron.forward") }.disabled(!app.canGoForward)
                }
            }
            if let tab = app.activeTab, tab.tabType == .bible {
                let st = BibleState(tab.state)
                Section {
                    if !st.compareMode {
                        Button("Find in Chapter", systemImage: "magnifyingglass") { findRequest += 1 }
                    }
                    Button { mutate(tab.id) { $0.rightPanelOpen = true; $0.rightPanelTab = "crossrefs" } } label: { Label("Cross References", systemImage: "arrow.triangle.branch") }
                    Button("Notes for This Chapter", systemImage: "note.text") {
                        app.focusStudyVerse(nil, in: tab.id)
                        mutate(tab.id) { $0.rightPanelOpen = true; $0.rightPanelTab = "notes" }
                    }
                    ChapterExportActions(state: st)
                    Toggle(isOn: Binding(get: { st.showStrongs }, set: { v in mutate(tab.id) { $0.showStrongs = v } })) { Label("Strong's Numbers", systemImage: "number") }
                    Toggle(isOn: Binding(get: { st.compareMode }, set: { v in mutate(tab.id) { $0.compareMode = v } })) { Label("Compare Texts", systemImage: "rectangle.split.2x1") }
                }
            }
            if let tab = app.activeTab {
                Section {
                    Button { app.duplicate(tab.id) } label: { Label("Duplicate Tab", systemImage: "plus.square.on.square") }
                    Button(role: .destructive) { app.close(tab.id) } label: { Label("Close Tab", systemImage: "xmark") }
                }
            }
            Section {
                Button("Study Trail", systemImage: "point.topleft.down.to.point.bottomright.curvepath") { app.showStudyTrail = true }
                Button { app.openCalendar() } label: { Label("Calendar", systemImage: "calendar") }
                Button { showSettings = true } label: { Label("Settings", systemImage: "gearshape") }
            }
        } label: { bottomItem(symbol: "ellipsis").hoverEffect(.highlight) }
        .accessibilityLabel("More: commands for this tab")
    }

    func mutate(_ id: String, _ f: (inout BibleState) -> Void) {
        app.update(id) { t in var s = BibleState(t.state); f(&s); t.state = s.merged(into: t.state); t.title = Reference.readerChapterLabel(s.bookId, s.chapter, textId: s.translation) }
    }
}

/// The tab sheet (the existing iPhone TabCardsSheet, list view): the session row, a tab search, every tab of
/// the session in the user's order (pinned first), swipe / long-press actions, reorder, New Tab and Archived.
struct TabCardsSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var showTabCleanup = false

    @State private var spaceFilter: SpaceId?

    var shown: [BereanWorkspace.Tab] {
        app.matchingOpenTabs(query, space: spaceFilter)
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 10) {
                        Image(systemName: "magnifyingglass")
                            .foregroundStyle(.secondary)
                            .accessibilityHidden(true)
                        TextField("Search tabs", text: $query)
                            .autocorrectionDisabled()
                            .submitLabel(.search)
                        if !query.isEmpty {
                            Button {
                                query = ""
                            } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .foregroundStyle(.secondary)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel("Clear tab search")
                        }
                    }
                }
                Section {
                    NavigationLink { SessionsPage(closeTabs: { dismiss() }) } label: {
                        LabeledContent {
                            Text("\(app.tabCount(app.currentSessionId)) tab\(app.tabCount(app.currentSessionId) == 1 ? "" : "s")")
                        } label: {
                            Label(app.session.name, systemImage: "square.stack").fontWeight(.semibold)
                        }
                    }
                    .accessibilityHint("Switch, create or manage workspaces")
                }
                Section {
                    Button { dismiss(); app.commandPaletteShown = true } label: { Label("New Tab", systemImage: "plus") }
                    if !app.inactiveTabs.isEmpty {
                        Button { showTabCleanup = true } label: { Label("Archive Inactive Tabs…", systemImage: "archivebox") }
                    }
                    if !app.archivedGroups.isEmpty {
                        NavigationLink { ArchivedTabsPage(onOpen: { dismiss() }) } label: { Label("Archived Tabs", systemImage: "archivebox").badge(app.archivedGroups.count) }
                    }
                }
                if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, spaceFilter == nil {
                    WorkspaceTabResults(title: "Recent Tabs", matches: Array(app.recentWorkspaceTabs.prefix(3)),
                                        onOpen: { dismiss() })
                }
                let otherMatches = app.matchingWorkspaceTabs(query).filter {
                    $0.workspaceID != app.currentSessionId && (spaceFilter == nil || $0.tab.spaceId == spaceFilter)
                }
                Section {
                    let pinned = shown.filter(\.isPinned), others = shown.filter { !$0.isPinned }
                    ForEach(pinned) { row($0) }.onMove { app.moveTabs(pinned.map(\.id), from: $0, to: $1) }
                    ForEach(others) { row($0) }.onMove { app.moveTabs(others.map(\.id), from: $0, to: $1) }
                    if shown.isEmpty && otherMatches.isEmpty { Text(query.isEmpty && spaceFilter == nil ? "No open tabs in this workspace." : "No tabs match the current filters.").foregroundStyle(.secondary) }
                }
                WorkspaceTabResults(matches: otherMatches, onOpen: { dismiss() })
            }
            .scrollDismissesKeyboard(.interactively)
            .sheet(isPresented: $showTabCleanup) { TabCleanupView() }
            .navigationTitle("Tabs")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { EditButton() }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Picker("Tab Space", selection: $spaceFilter) {
                            Text("All Tabs").tag(nil as SpaceId?)
                            ForEach(SpaceId.allCases) { space in
                                Text(space.title).tag(Optional(space))
                            }
                        }
                    } label: {
                        Label("Filter Tabs", systemImage: spaceFilter == nil ? "line.3.horizontal.decrease" : "line.3.horizontal.decrease.circle.fill")
                    }
                    .accessibilityValue(spaceFilter?.title ?? "All Tabs")
                }
                ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } }
            }
        }
    }

    func row(_ tab: BereanWorkspace.Tab) -> some View {
        Button { app.select(tab.id, in: tab.spaceId); dismiss() } label: {
            HStack {
                Image(systemName: tab.symbol).foregroundStyle(tab.tint).frame(width: 24)
                VStack(alignment: .leading, spacing: 1) {
                    Text(tab.navigationLabel).foregroundStyle(.primary)
                    Text(tab.navigationDetail).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if tab.isPinned { Image(systemName: "pin.fill").font(.caption).foregroundStyle(.secondary) }
                if tab.id == app.activeTab?.id { Image(systemName: "checkmark").foregroundStyle(.tint).accessibilityLabel("Current tab") }
            }
        }
        .swipeActions(edge: .trailing) {
            Button("Close", role: .destructive) { app.close(tab.id) }
            Button("Archive") { app.archive([tab.id]) }.tint(.indigo)
        }
        .swipeActions(edge: .leading) { Button(tab.isPinned ? "Unpin" : "Pin") { app.togglePin(tab.id) }.tint(.orange) }
        .contextMenu {
            Button("Duplicate Tab", systemImage: "plus.square.on.square") { app.duplicate(tab.id) }
            Button(tab.isPinned ? "Unpin Tab" : "Pin Tab", systemImage: "pin") { app.togglePin(tab.id) }
            if app.sessions.count > 1 {
                Menu("Move to Workspace", systemImage: "square.stack") {
                    ForEach(app.sessions.filter { $0.id != app.currentSessionId }) { s in Button(s.name) { app.moveTab(tab.id, toSession: s.id) } }
                }
            }
            Button("Archive Tab", systemImage: "archivebox") { app.archive([tab.id]) }
            Button("Close Tab", systemImage: "xmark", role: .destructive) { app.close(tab.id) }
        }
    }
}

/// Workspaces (ADR-0011): one list — live workspaces, then saved ones not open — with switch, new, rename, duplicate,
/// delete; "Save Snapshot" is a secondary action on the current workspace.
private struct WorkspaceTabResults: View {
    @Environment(AppModel.self) private var app
    var title = "Open Tabs in Other Workspaces"
    let matches: [AppModel.WorkspaceTabMatch]
    let onOpen: () -> Void

    var body: some View {
        if !matches.isEmpty {
            Section(title) {
                ForEach(matches) { match in
                    Button {
                        app.openWorkspaceTab(match)
                        onOpen()
                    } label: {
                        Label {
                            VStack(alignment: .leading) {
                                Text(match.tab.navigationLabel)
                                Text(match.workspaceName + " · " + match.tab.navigationDetail)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        } icon: {
                            Image(systemName: match.tab.symbol).foregroundStyle(match.tab.tint)
                        }
                    }
                }
            }
        }
    }
}

struct SessionsPage: View {
    @Environment(AppModel.self) private var app
    let closeTabs: () -> Void
    @State private var renaming: WorkspaceItem?
    @State private var deleting: WorkspaceItem?
    @State private var name = ""
    @State private var saving = false
    @State private var query = ""

    var body: some View {
        List {
            WorkspaceTabResults(title: "Open Tabs", matches: app.matchingWorkspaceTabs(query), onOpen: closeTabs)
            Section {
                ForEach(app.workspaceItems.filter { $0.matches(query.trimmingCharacters(in: .whitespacesAndNewlines)) }) { w in
                    Button { app.open(w); closeTabs() } label: {
                        HStack {
                            Image(systemName: w.isSaved ? "square.stack.3d.up" : "square.stack").foregroundStyle(.secondary).frame(width: 24)
                            VStack(alignment: .leading) {
                                Text(w.name).foregroundStyle(.primary)
                                ForEach(w.previewLabels(matching: query), id: \.self) { preview in
                                    Text(preview).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                                }
                                Text(w.isSaved ? "Saved · \(w.tabCount) tab\(w.tabCount == 1 ? "" : "s")" : "\(w.tabCount) tab\(w.tabCount == 1 ? "" : "s")")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if app.isCurrent(w) { Image(systemName: "checkmark").foregroundStyle(.tint).accessibilityLabel("Current workspace") }
                        }
                    }
                    .swipeActions { if app.canDelete(w) { Button("Delete", role: .destructive) { deleting = w } } }
                    .contextMenu {
                        Button("Rename…", systemImage: "pencil") { name = w.name; renaming = w }
                        Button("Duplicate", systemImage: "plus.square.on.square") { app.duplicate(w) }
                        if app.isCurrent(w) {
                            Button("Save Snapshot…", systemImage: "square.and.arrow.down.on.square") { name = w.name; saving = true }
                            Button("Archive All Tabs", systemImage: "archivebox") { app.archiveAllTabs() }
                        }
                        if app.canDelete(w) { Button("Delete…", systemImage: "trash", role: .destructive) { deleting = w } }
                    }
                }
                Button { app.newWorkspace(); closeTabs() } label: { Label("New Workspace", systemImage: "plus") }
            } footer: { Text("A workspace is a set of tabs you study with. Switching workspaces swaps the tabs you see. Touch and hold a workspace for more.") }
        }
        .navigationTitle("Workspaces")
        .searchable(text: $query, prompt: "Workspace or tab title")
        .alert("Rename Workspace", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: $name)
            Button("Rename") { if let r = renaming { app.rename(r, to: name) }; renaming = nil }
            Button("Cancel", role: .cancel) { renaming = nil }
        }
        .alert("Save a Snapshot", isPresented: $saving) {
            TextField("Name", text: $name)
            Button("Save") { app.saveWorkspace(named: name) }
            Button("Cancel", role: .cancel) {}
        } message: { Text("Keeps a frozen copy of these tabs that you can reopen later.") }
        .confirmationDialog("Delete “\(deleting?.name ?? "")”?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("Delete Workspace", role: .destructive) { if let d = deleting { app.delete(d) }; deleting = nil }
        } message: { Text("Its tabs are closed. This cannot be undone.") }
    }
}

/// Browse archived tabs and restore a group or an individual tab.
struct ArchivedTabsPage: View {
    @Environment(AppModel.self) private var app
    let onOpen: () -> Void
    @State private var query = ""

    private var searchTerms: [Substring] { query.replacingOccurrences(of: "–", with: "-").split(whereSeparator: \.isWhitespace) }

    private func matches(_ tab: BereanWorkspace.Tab) -> Bool {
        searchTerms.allSatisfy { tab.navigationSearchText.localizedStandardContains(String($0)) }
    }

    var body: some View {
        List {
            ForEach(app.archivedGroups) { group in
                let tabs = app.archivedTabs(group)
                let matches = tabs.filter { self.matches($0) }
                if !matches.isEmpty || (tabs.isEmpty && searchTerms.isEmpty) {
                    Section(group.label.isEmpty ? "Archived tabs" : group.label) {
                        ForEach(matches) { tab in
                            Button {
                                app.restoreArchivedTab(tab.id, from: group.id)
                                onOpen()
                            } label: {
                                Label {
                                    VStack(alignment: .leading) {
                                        Text(tab.navigationLabel)
                                        Text(tab.navigationDetail).font(.caption).foregroundStyle(.secondary)
                                    }
                                } icon: {
                                    Image(systemName: tab.symbol).foregroundStyle(tab.tint)
                                }
                                .accessibilityHint("Restore and open this tab")
                            }
                        }
                        if searchTerms.isEmpty {
                            Menu("Group Actions", systemImage: "ellipsis.circle") {
                                if tabs.count > 1 {
                                    Button("Restore All \(tabs.count) Tabs", systemImage: "archivebox") {
                                        app.restoreArchived(group.id)
                                    }
                                }
                                Button("Remove from Archive", systemImage: "trash", role: .destructive) {
                                    app.dismissArchived(group.id)
                                }
                            }
                        }
                    }
                }
            }
            if app.archivedGroups.isEmpty {
                ContentUnavailableView("No Archived Tabs", systemImage: "archivebox")
            } else if !searchTerms.isEmpty && !app.archivedGroups.contains(where: { app.archivedTabs($0).contains(where: matches) }) {
                ContentUnavailableView.search(text: query)
            }
        }
        .navigationTitle("Archived Tabs")
        .searchable(text: $query, prompt: "Search archived tabs")
    }
}
