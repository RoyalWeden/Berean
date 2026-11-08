import SwiftUI
import BereanCore
import BereanWorkspace
import BereanReference

/// The native Mac window: a sidebar of Spaces with vertical tabs (Arc-style) inside the current session,
/// and the active tab's content with its toolbar and study inspector.
struct MacRootView: View {
    @Environment(AppModel.self) private var app
    @State private var renaming: String?
    @State private var renameText = ""
    @State private var savingWorkspace = false
    @State private var workspaceName = ""
    @State private var renamingWorkspace: String?
    @State private var deletingWorkspace: SavedWorkspace?
    @AppStorage("sidebarGroupBySpace") private var groupBySpace = false
    @AppStorage("sidebarWorkspacesExpanded") private var workspacesExpanded = true
    @AppStorage("sidebarArchiveExpanded") private var archiveExpanded = false

    var body: some View {
        @Bindable var app = app
        NavigationSplitView {
            sidebar
                .navigationSplitViewColumnWidth(min: 200, ideal: 250, max: 360)
        } detail: {
            detail
                .toolbar {
                    // Back / Forward of the active tab, next to the sidebar button; they stay put when the sidebar is collapsed.
                    ToolbarItemGroup(placement: .navigation) {
                        Button { app.goBack() } label: { Label("Back", systemImage: "arrow.left") }
                            .disabled(!app.canGoBack).help("Back (⌘[)")
                        Button { app.goForward() } label: { Label("Forward", systemImage: "arrow.right") }
                            .disabled(!app.canGoForward).help("Forward (⌘])")
                    }
                }
        }
        .sheet(isPresented: $app.commandPaletteShown) { CommandPalette() }
        .alert(app.userMessage ?? "", isPresented: Binding(get: { app.userMessage != nil }, set: { if !$0 { app.userMessage = nil } })) { Button("OK") {} }
        .alert("Library", isPresented: Binding(get: { app.libraryError != nil }, set: { if !$0 { app.libraryError = nil } })) {
            Button("OK") { app.libraryError = nil }
        } message: { Text(app.libraryError ?? "") }
    }

    var sidebarSelection: Binding<String?> {
        Binding(get: { app.activeTab?.id }, set: { id in
            guard let id, let t = app.findTab(id) else { return }
            app.select(id, in: t.spaceId)
        })
    }

    // MARK: sidebar — session switcher · location · New Tab · tabs (pinned, then the user's order) · workspaces · archive

    var sidebar: some View {
        List(selection: sidebarSelection) {
            if groupBySpace {
                ForEach(SpaceId.allCases) { space in
                    let tabs = app.tabs(in: space)
                    if !tabs.isEmpty {
                        Section(space.title) { ForEach(tabs) { tabRow($0) }.onMove { app.move(in: space, from: $0, to: $1) } }
                    }
                }
            } else {
                let pinned = app.orderedTabs.filter(\.isPinned), others = app.orderedTabs.filter { !$0.isPinned }
                if !pinned.isEmpty {
                    Section("Pinned") { ForEach(pinned) { tabRow($0) }.onMove { app.moveTabs(pinned.map(\.id), from: $0, to: $1) } }
                }
                Section(pinned.isEmpty ? "" : "Tabs") {
                    ForEach(others) { tabRow($0) }.onMove { app.moveTabs(others.map(\.id), from: $0, to: $1) }
                }
            }
            workspacesSection
            if !app.archivedGroups.isEmpty { archiveSection }
        }
        .listStyle(.sidebar)
        .safeAreaInset(edge: .top, spacing: 0) { sidebarHeader }
        .contextMenu {
            Toggle("Group Tabs by Space", isOn: $groupBySpace)
            Button("Archive All Tabs") { app.archiveAllTabs() }.disabled(app.orderedTabs.isEmpty)
        }
        .alert("Rename Session", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: $renameText)
            Button("Rename") { if let id = renaming { app.renameSession(id, to: renameText) }; renaming = nil }
            Button("Cancel", role: .cancel) { renaming = nil }
        }
        .alert("Save Session as Workspace", isPresented: $savingWorkspace) {
            TextField("Workspace name", text: $workspaceName)
            Button("Save") { app.saveWorkspace(named: workspaceName) }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("A workspace is a saved copy of this session's tabs. Open it any time to get those tabs back in their own session.")
        }
        .alert("Rename Workspace", isPresented: Binding(get: { renamingWorkspace != nil }, set: { if !$0 { renamingWorkspace = nil } })) {
            TextField("Name", text: $workspaceName)
            Button("Rename") { if let id = renamingWorkspace { app.renameWorkspace(id, to: workspaceName) }; renamingWorkspace = nil }
            Button("Cancel", role: .cancel) { renamingWorkspace = nil }
        }
        .confirmationDialog("Delete the workspace “\(deletingWorkspace?.name ?? "")”?", isPresented: Binding(get: { deletingWorkspace != nil }, set: { if !$0 { deletingWorkspace = nil } })) {
            Button("Delete Workspace", role: .destructive) { if let w = deletingWorkspace { app.deleteWorkspace(w.id) }; deletingWorkspace = nil }
        } message: { Text("Only the saved copy is deleted. Sessions that are open stay as they are.") }
    }

    /// Session switcher, location field and New Tab — the head of the existing sidebar.
    var sidebarHeader: some View {
        VStack(alignment: .leading, spacing: 6) {
            sessionSwitcher
            Button { app.commandPaletteShown = true } label: {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    Text(app.locationTitle.space).foregroundStyle(.secondary)
                    Image(systemName: "chevron.compact.right").foregroundStyle(.tertiary)
                    Text(app.locationTitle.title).lineLimit(1)
                    Spacer(minLength: 0)
                }
                .font(.callout)
                .padding(.horizontal, 10).padding(.vertical, 6)
                .background(.quaternary.opacity(0.6), in: .rect(cornerRadius: 8))
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .help("Go to a passage, Strong's number, note or search (⌘K)")
            .accessibilityLabel("Location: \(app.locationTitle.space), \(app.locationTitle.title). Open reference or search")
            Button { app.commandPaletteShown = true } label: {
                Label("New Tab", systemImage: "plus").frame(maxWidth: .infinity, alignment: .leading).contentShape(.rect)
            }
            .buttonStyle(.plain).foregroundStyle(.secondary).padding(.horizontal, 10).padding(.top, 2)
            .help("New tab (⌘T)")
        }
        .padding(.horizontal, 10).padding(.top, 4).padding(.bottom, 6)
    }

    /// The current session, always visible; its menu lists every session (with tab counts) and the saved workspaces.
    var sessionSwitcher: some View {
        Menu {
            Section("Sessions") {
                ForEach(app.sessions) { s in
                    Toggle(isOn: Binding(get: { s.id == app.currentSessionId }, set: { if $0 { app.switchSession(s.id) } })) {
                        Text(s.name)
                        Text("\(app.tabCount(s.id)) tab\(app.tabCount(s.id) == 1 ? "" : "s")")
                    }
                }
            }
            Button("New Session") { app.newSession() }
            Button("Rename Session…") { renameText = app.session.name; renaming = app.currentSessionId }
            Button("Close Session", role: .destructive) { app.deleteSession(app.currentSessionId) }.disabled(app.sessions.count < 2)
            Divider()
            Section("Saved Workspaces") {
                ForEach(app.savedWorkspaces) { w in Button(w.name) { app.openWorkspace(w.id) } }
                Button("Save Session as Workspace…") { workspaceName = app.session.name; savingWorkspace = true }
            }
        } label: {
            Label(app.session.name, systemImage: "rectangle.stack").fontWeight(.semibold)
        }
        .menuStyle(.borderlessButton).menuIndicator(.visible).fixedSize()
        .padding(.horizontal, 10).padding(.vertical, 5)
        .background(.quaternary.opacity(0.35), in: .capsule)
        .help("Session: \(app.session.name) — switch sessions, start a new one or open a saved workspace")
        .accessibilityLabel("Session \(app.session.name), \(app.tabCount(app.currentSessionId)) tabs")
    }

    func tabRow(_ tab: BereanWorkspace.Tab) -> some View {
        TabRow(tab: tab, isActive: app.activeTab?.id == tab.id) { app.close(tab.id) }
            .tag(tab.id)
            .contextMenu { tabMenu(tab) }
    }

    var workspacesSection: some View {
        Section(isExpanded: $workspacesExpanded) {
            if app.savedWorkspaces.isEmpty {
                Button { workspaceName = app.session.name; savingWorkspace = true } label: {
                    Label("Save This Session…", systemImage: "square.and.arrow.down.on.square")
                }.buttonStyle(.plain).foregroundStyle(.secondary)
            }
            ForEach(app.savedWorkspaces) { w in
                Button { app.openWorkspace(w.id) } label: {
                    HStack {
                        Label(w.name, systemImage: "square.stack.3d.up")
                        Spacer()
                        if app.isWorkspaceOpen(w.id) { Text("Open").font(.caption).foregroundStyle(.secondary) }
                    }.contentShape(.rect)
                }
                .buttonStyle(.plain)
                .help("Open “\(w.name)” — its tabs come back in their own session")
                .contextMenu {
                    Button("Open") { app.openWorkspace(w.id) }
                    Button("Rename…") { workspaceName = w.name; renamingWorkspace = w.id }
                    Button("Delete…", role: .destructive) { deletingWorkspace = w }
                }
            }
        } header: {
            HStack {
                Text("Workspaces")
                Spacer()
                Button { workspaceName = app.session.name; savingWorkspace = true } label: { Image(systemName: "plus") }
                    .buttonStyle(.borderless).help("Save this session as a workspace")
            }
        }
    }

    var archiveSection: some View {
        Section("Archived", isExpanded: $archiveExpanded) {
            ForEach(app.archivedGroups) { g in
                Button { app.restoreArchived(g.id) } label: {
                    Label(g.label.isEmpty ? "Archived tabs" : g.label, systemImage: "archivebox").lineLimit(1).contentShape(.rect)
                }
                .buttonStyle(.plain)
                .help("Restore \(app.archivedTabs(g).count) tab(s) to this session")
                .contextMenu {
                    Button("Restore") { app.restoreArchived(g.id) }
                    Button("Remove from Archive", role: .destructive) { app.dismissArchived(g.id) }
                }
            }
        }
    }

    @ViewBuilder func tabMenu(_ tab: BereanWorkspace.Tab) -> some View {
        Button("Duplicate Tab") { app.duplicate(tab.id) }
        Button(tab.isPinned ? "Unpin Tab" : "Pin Tab") { app.togglePin(tab.id) }
        if app.sessions.count > 1 {
            Menu("Move to Session") {
                ForEach(app.sessions.filter { $0.id != app.currentSessionId }) { s in Button(s.name) { app.moveTab(tab.id, toSession: s.id) } }
            }
        }
        Button("Archive Tab") { app.archive([tab.id]) }
        Divider()
        Button("Close Tab", role: .destructive) { app.close(tab.id) }
    }

    func newTab(in space: SpaceId) {
        switch space {
        case .scripture: app.openScripture(bookId: "GEN", chapter: 1)
        case .notes: app.openNote(nil)
        default: app.activeSpace = space; app.commandPaletteShown = true
        }
    }

    @ViewBuilder var detail: some View {
        if let tab = app.activeTab {
            switch tab.tabType {
            case .bible:
                let st = BibleState(tab.state)
                let layout = ScriptureLayout(rawValue: st.scriptureLayout) ?? .standard
                ScriptureLayoutView(tabId: tab.id, layout: layout)
                    .id(tab.id)
                    .inspector(isPresented: Binding(get: { layout.usesInspector && st.rightPanelOpen }, set: { v in
                        app.update(tab.id) { t in var s = BibleState(t.state); s.rightPanelOpen = v; t.state = s.merged(into: t.state) }
                    })) {
                        StudyInspector(tabId: tab.id).inspectorColumnWidth(min: 280, ideal: 340, max: 520)
                    }
                    .toolbar {
                        ToolbarItem {
                            Menu {
                                Picker("Layout", selection: Binding(get: { layout }, set: { v in
                                    app.update(tab.id) { t in var s = BibleState(t.state); s.scriptureLayout = v.rawValue; if v == .standard { s.rightPanelOpen = true }; t.state = s.merged(into: t.state) }
                                })) { ForEach(ScriptureLayout.allCases) { Label($0.title, systemImage: $0.symbol).tag($0) } }
                                    .pickerStyle(.inline)
                            } label: { Label("Layout", systemImage: layout.symbol) }
                        }
                    }
            case .lexicon:
                LexiconEntryView(strongsId: tab.state["strongsNum"]?.stringValue?.string ?? "")
                    .id(tab.id)
                    .navigationTitle(tab.title)
            case .search:
                SearchResultsView(tabId: tab.id).id(tab.id)
            case .note:
                if let id = tab.state["noteId"]?.stringValue?.string { NoteDetailView(noteId: id).id(tab.id + id) } else { NotesHomeView().id(tab.id) }
            default:
                ContentUnavailableView(tab.title, systemImage: tab.symbol,
                                       description: Text("This kind of tab arrives in a later native build. It stays saved with your session."))
            }
        } else {
            ContentUnavailableView("No tab open", systemImage: app.activeSpace.symbol,
                                   description: Text("Press ⌘T to open a passage, a Strong's number or a search."))
        }
    }
}


/// One tab in the sidebar: type-coloured symbol, title, pin, and a close button on hover / when active.
struct TabRow: View {
    let tab: BereanWorkspace.Tab
    let isActive: Bool
    let onClose: () -> Void
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: tab.symbol).foregroundStyle(tab.tint).frame(width: 18)
            Text(tab.title.isEmpty ? "Untitled" : tab.title).lineLimit(1)
            Spacer(minLength: 0)
            if hovering || isActive {
                Button(action: onClose) { Image(systemName: "xmark").font(.caption2.weight(.semibold)) }
                    .buttonStyle(.borderless).foregroundStyle(.secondary)
                    .help("Close Tab (⌘W)").accessibilityLabel("Close \(tab.title)")
            } else if tab.isPinned {
                Image(systemName: "pin.fill").font(.caption2).foregroundStyle(.tertiary)
            }
        }
        .onHover { hovering = $0 }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isActive ? .isSelected : [])
    }
}

