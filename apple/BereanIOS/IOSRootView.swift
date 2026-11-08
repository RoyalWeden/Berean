import SwiftUI
import BereanCore
import BereanWorkspace
import BereanReference

/// The native iPhone shell, following the existing iPhone navigation (docs/mobile/mobile-navigation.md):
/// bottom-left tab cards, bottom-centre plus (reference / Strong's / search), bottom-right caret with the
/// current tab's commands. Content views are shared with the Mac app.
struct IOSRootView: View {
    @Environment(AppModel.self) private var app
    @State private var showTabs = false
    @State private var showSettings = false

    var body: some View {
        @Bindable var app = app
        NavigationStack {
            content
                .toolbar {
                    ToolbarItemGroup(placement: .bottomBar) {
                        Button { showTabs = true } label: { Label("Tabs", systemImage: "square.on.square") }
                        Spacer()
                        Button { app.commandPaletteShown = true } label: { Label("New", systemImage: "plus.circle.fill").font(.title2) }
                        Spacer()
                        caretMenu
                    }
                }
        }
        .sheet(isPresented: $showSettings) { NavigationStack { SettingsView().navigationTitle("Settings").toolbar { Button("Done") { showSettings = false } } } }
        .sheet(isPresented: $showTabs) { TabCardsSheet().presentationDetents([.medium, .large]) }
        .sheet(isPresented: $app.commandPaletteShown) { CommandPalette().presentationDetents([.height(220)]) }
        .alert(app.userMessage ?? "", isPresented: Binding(get: { app.userMessage != nil }, set: { if !$0 { app.userMessage = nil } })) { Button("OK") {} }
    }

    @ViewBuilder var content: some View {
        if let tab = app.activeTab {
            switch tab.tabType {
            case .bible:
                let st = BibleState(tab.state)
                ScriptureView(tabId: tab.id).id(tab.id)
                    .inspector(isPresented: Binding(get: { st.rightPanelOpen }, set: { v in
                        app.update(tab.id) { t in var s = BibleState(t.state); s.rightPanelOpen = v; t.state = s.merged(into: t.state) }
                    })) { StudyInspector(tabId: tab.id).presentationDetents([.medium, .large]) }
            case .lexicon:
                LexiconEntryView(strongsId: tab.state["strongsNum"]?.stringValue?.string ?? "").id(tab.id).navigationTitle(tab.title)
            case .search:
                SearchResultsView(tabId: tab.id).id(tab.id)
            case .note:
                if let id = tab.state["noteId"]?.stringValue?.string { NoteDetailView(noteId: id).id(tab.id + id) } else { NotesHomeView().id(tab.id) }
            default:
                ContentUnavailableView(tab.title, systemImage: "square.dashed", description: Text("This kind of tab arrives in a later native build."))
            }
        } else {
            ContentUnavailableView("No tab open", systemImage: "book", description: Text("Tap + to open a passage or search."))
        }
    }

    var caretMenu: some View {
        Menu {
            if let tab = app.activeTab, tab.tabType == .bible {
                let st = BibleState(tab.state)
                Button(st.showStrongs ? "Hide Strong's Numbers" : "Show Strong's Numbers") { mutate(tab.id) { $0.showStrongs.toggle() } }
                Button("Study Panel") { mutate(tab.id) { $0.rightPanelOpen = true } }
                Picker("Text", selection: Binding(get: { st.translation }, set: { v in mutate(tab.id) { $0.translation = v } })) {
                    ForEach(availableTexts) { Text($0.name).tag($0.id) }
                }
            }
            if app.canGoBack { Button("Back") { app.goBack() } }
            if app.canGoForward { Button("Forward") { app.goForward() } }
            Button("Settings") { showSettings = true }
            if let tab = app.activeTab { Button("Close Tab", role: .destructive) { app.close(tab.id) } }
        } label: { Label("Commands", systemImage: "chevron.up.circle") }
    }

    func mutate(_ id: String, _ f: (inout BibleState) -> Void) {
        app.update(id) { t in var s = BibleState(t.state); f(&s); t.state = s.merged(into: t.state); t.title = Reference.bookChapterLabel(s.bookId, chapter: Double(s.chapter)) }
    }
}

/// The tab sheet (the existing iPhone TabCardsSheet, list view): the session row, a tab search, every tab of
/// the session in the user's order (pinned first), swipe / long-press actions, reorder, New Tab and Archived.
struct TabCardsSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    var shown: [BereanWorkspace.Tab] {
        let q = query.trimmingCharacters(in: .whitespaces)
        return q.isEmpty ? app.orderedTabs : app.orderedTabs.filter { $0.title.localizedCaseInsensitiveContains(q) }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    NavigationLink { SessionsPage() } label: {
                        LabeledContent {
                            Text("\(app.tabCount(app.currentSessionId)) tab\(app.tabCount(app.currentSessionId) == 1 ? "" : "s")")
                        } label: {
                            Label(app.session.name, systemImage: "rectangle.stack").fontWeight(.semibold)
                        }
                    }
                    .accessibilityHint("Switch session or open a saved workspace")
                }
                Section {
                    let pinned = shown.filter(\.isPinned), others = shown.filter { !$0.isPinned }
                    ForEach(pinned) { row($0) }.onMove { app.moveTabs(pinned.map(\.id), from: $0, to: $1) }
                    ForEach(others) { row($0) }.onMove { app.moveTabs(others.map(\.id), from: $0, to: $1) }
                    if shown.isEmpty { Text(query.isEmpty ? "No open tabs in this session." : "No open tab matches “\(query)”.").foregroundStyle(.secondary) }
                }
                Section {
                    Button { dismiss(); app.commandPaletteShown = true } label: { Label("New Tab", systemImage: "plus") }
                    if !app.archivedGroups.isEmpty {
                        NavigationLink { ArchivedTabsPage() } label: { Label("Archived Tabs", systemImage: "archivebox").badge(app.archivedGroups.count) }
                    }
                }
            }
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .automatic), prompt: "Search tabs")
            .navigationTitle("Tabs")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { EditButton() }
                ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } }
            }
        }
    }

    func row(_ tab: BereanWorkspace.Tab) -> some View {
        Button { app.select(tab.id, in: tab.spaceId); dismiss() } label: {
            HStack {
                Image(systemName: tab.symbol).foregroundStyle(tab.tint).frame(width: 24)
                VStack(alignment: .leading, spacing: 1) {
                    Text(tab.title.isEmpty ? "Untitled" : tab.title).foregroundStyle(.primary)
                    Text(tab.spaceId.title).font(.caption).foregroundStyle(.secondary)
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
                Menu("Move to Session", systemImage: "rectangle.stack") {
                    ForEach(app.sessions.filter { $0.id != app.currentSessionId }) { s in Button(s.name) { app.moveTab(tab.id, toSession: s.id) } }
                }
            }
            Button("Archive Tab", systemImage: "archivebox") { app.archive([tab.id]) }
            Button("Close Tab", systemImage: "xmark", role: .destructive) { app.close(tab.id) }
        }
    }
}

/// Sessions (live tab groups) and saved workspaces (frozen snapshots of a session's tabs).
struct SessionsPage: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var renaming: String?
    @State private var name = ""
    @State private var saving = false
    @State private var renamingWorkspace: String?

    var body: some View {
        List {
            Section {
                ForEach(app.sessions) { s in
                    Button { app.switchSession(s.id); dismiss() } label: {
                        HStack {
                            VStack(alignment: .leading) {
                                Text(s.name).foregroundStyle(.primary)
                                Text("\(app.tabCount(s.id)) tab\(app.tabCount(s.id) == 1 ? "" : "s")").font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            if s.id == app.currentSessionId { Image(systemName: "checkmark").foregroundStyle(.tint) }
                        }
                    }
                    .swipeActions { if app.sessions.count > 1 { Button("Close", role: .destructive) { app.deleteSession(s.id) } } }
                    .contextMenu {
                        Button("Rename…") { name = s.name; renaming = s.id }
                        if s.id == app.currentSessionId { Button("Archive All Tabs") { app.archiveAllTabs() } }
                        if app.sessions.count > 1 { Button("Close Session", role: .destructive) { app.deleteSession(s.id) } }
                    }
                }
                Button { app.newSession(); dismiss() } label: { Label("New Session", systemImage: "plus") }
            } header: { Text("Sessions") } footer: { Text("A session is a live group of tabs. Switching sessions swaps the tabs you see.") }

            Section {
                ForEach(app.savedWorkspaces) { w in
                    Button { app.openWorkspace(w.id); dismiss() } label: {
                        HStack {
                            Label(w.name, systemImage: "square.stack.3d.up").foregroundStyle(.primary)
                            Spacer()
                            if app.isWorkspaceOpen(w.id) { Text("Open").font(.caption).foregroundStyle(.secondary) }
                        }
                    }
                    .swipeActions { Button("Delete", role: .destructive) { app.deleteWorkspace(w.id) } }
                    .contextMenu {
                        Button("Rename…") { name = w.name; renamingWorkspace = w.id }
                        Button("Delete", role: .destructive) { app.deleteWorkspace(w.id) }
                    }
                }
                Button { name = app.session.name; saving = true } label: { Label("Save This Session as a Workspace…", systemImage: "square.and.arrow.down.on.square") }
            } header: { Text("Saved Workspaces") } footer: { Text("A saved workspace is a frozen copy of a session's tabs. Opening it brings those tabs back in their own session.") }
        }
        .navigationTitle("Sessions")
        .alert("Rename Session", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: $name)
            Button("Rename") { if let id = renaming { app.renameSession(id, to: name) }; renaming = nil }
            Button("Cancel", role: .cancel) { renaming = nil }
        }
        .alert("Save Workspace", isPresented: $saving) {
            TextField("Name", text: $name)
            Button("Save") { app.saveWorkspace(named: name) }
            Button("Cancel", role: .cancel) {}
        }
        .alert("Rename Workspace", isPresented: Binding(get: { renamingWorkspace != nil }, set: { if !$0 { renamingWorkspace = nil } })) {
            TextField("Name", text: $name)
            Button("Rename") { if let id = renamingWorkspace { app.renameWorkspace(id, to: name) }; renamingWorkspace = nil }
            Button("Cancel", role: .cancel) { renamingWorkspace = nil }
        }
    }
}

/// Archived tab groups: tap to restore into this session, swipe to remove.
struct ArchivedTabsPage: View {
    @Environment(AppModel.self) private var app
    var body: some View {
        List {
            ForEach(app.archivedGroups) { g in
                Button { app.restoreArchived(g.id) } label: {
                    VStack(alignment: .leading) {
                        Text(g.label.isEmpty ? "Archived tabs" : g.label).foregroundStyle(.primary)
                        Text("\(app.archivedTabs(g).count) tab(s) · \(Date(timeIntervalSince1970: Double(g.archivedAt) / 1000).formatted(date: .abbreviated, time: .shortened))")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                .swipeActions { Button("Remove", role: .destructive) { app.dismissArchived(g.id) } }
            }
            if app.archivedGroups.isEmpty { Text("No archived tabs.").foregroundStyle(.secondary) }
        }
        .navigationTitle("Archived Tabs")
    }
}
