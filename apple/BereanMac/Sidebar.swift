import SwiftUI
import UniformTypeIdentifiers
import BereanWorkspace

/// The Mac sidebar (ADR-0010 organisation, Arc/Yab-style rows — ADR-0012):
/// Workspace switcher · location field · New Tab · pinned tabs · tabs (the user's order) · archived tabs.
/// Empty areas drag the window; rows reorder by drag and drop (drop on a pinned row to pin).
struct BereanSidebar: View {
    @Environment(AppModel.self) private var app
    @AppStorage("sidebarGroupBySpace") private var groupBySpace = false
    @AppStorage("sidebarArchiveExpanded") private var archiveExpanded = false
    let browseArchive: () -> Void
    @State private var undoArchiveID: String?
    @State private var dragging: String?
    @State private var renaming: WorkspaceItem?
    @State private var deleting: WorkspaceItem?
    @State private var savingSnapshot = false
    @State private var showTabCleanup = false
    @State private var name = ""
    @State private var showsWorkspaceSearch = false
    @State private var workspaceQuery = ""
    @FocusState private var workspaceSearchFocused: Bool
    @State private var showsTabFilter = false
    @State private var tabQuery = ""
    @State private var tabTypeFilter: TabType?
    @FocusState private var tabFilterFocused: Bool

    var body: some View {
        VStack(spacing: 0) {
            header
            GeometryReader { geo in
                ScrollView {
                    VStack(alignment: .leading, spacing: 2) {
                        if groupBySpace { groupedTabs } else { orderedTabs }
                        if isFilteringTabs && matchingTabs.isEmpty {
                            Text("No matching tabs").font(.callout).foregroundStyle(.secondary).padding(10)
                        }
                        if !isFilteringTabs && !app.archivedGroups.isEmpty { archive.padding(.top, 14) }
                    }
                    .padding(.horizontal, 8)
                    .padding(.bottom, 8)
                    .frame(maxWidth: .infinity, minHeight: geo.size.height, alignment: .top)
                    // Empty sidebar space (between and below rows) moves the window; rows and buttons take their own clicks.
                    .background(WindowDragArea())
                    .animation(.snappy(duration: 0.18), value: app.orderedTabs.map(\.id))
                }
                .scrollIndicators(.never)
            }
            if let undoArchiveID, let group = app.archivedGroups.first(where: { $0.id == undoArchiveID }) {
                archiveNotice(group)
            }
        }
        .background {
            Rectangle().fill(.regularMaterial)
                .ignoresSafeArea(.container, edges: .top)
        }
        .onChange(of: app.currentSessionId) { _, _ in
            tabQuery = ""
            tabTypeFilter = nil
        }
        .contextMenu {
            Toggle("Group Tabs by Space", isOn: $groupBySpace)
            Button("Archive Inactive Tabs…") { showTabCleanup = true }.disabled(app.inactiveTabs.isEmpty)
            Button("Archive All Tabs") { archiveWithUndo(app.orderedTabs.map(\.id)) }
                .disabled(app.orderedTabs.isEmpty)
        }
        .sheet(isPresented: $showsWorkspaceSearch) { workspaceTabSearch }
        .sheet(isPresented: $showTabCleanup) { TabCleanupView().frame(minWidth: 360, minHeight: 420) }
        .alert("Rename Workspace", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: $name)
            Button("Rename") { if let r = renaming { app.rename(r, to: name) }; renaming = nil }
            Button("Cancel", role: .cancel) { renaming = nil }
        }
        .confirmationDialog("Delete the workspace “\(deleting?.name ?? "")”?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })) {
            Button("Delete Workspace", role: .destructive) { if let d = deleting { app.delete(d) }; deleting = nil }
        } message: { Text("Its tabs are closed. This cannot be undone.") }
        .alert("Save a Snapshot", isPresented: $savingSnapshot) {
            TextField("Name", text: $name)
            Button("Save") { app.saveWorkspace(named: name) }
            Button("Cancel", role: .cancel) {}
        } message: { Text("Keeps a frozen copy of this workspace's tabs that you can reopen later, even after the tabs change.") }
    }

    // MARK: header

    var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            workspaceSwitcher
            Button { app.showCommandPalette() } label: {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    Text(app.locationTitle.space).foregroundStyle(.secondary)
                    Image(systemName: "chevron.compact.right").foregroundStyle(.tertiary)
                    Text(app.locationTitle.title).lineLimit(1)
                    Spacer(minLength: 0)
                }
                .font(.callout)
                .padding(.horizontal, 10).padding(.vertical, 7)
                .background(.quaternary.opacity(0.55), in: .rect(cornerRadius: 9))
                .contentShape(.rect)
            }
            .buttonStyle(.interactivePlain)
            .help("Go to a passage, Strong's number, note or search (⌘K)")
            .accessibilityLabel("Location: \(app.locationTitle.space), \(app.locationTitle.title). Open reference or search")
            HStack(spacing: 2) {
                Button { app.showCommandPalette(newTab: true) } label: {
                    Label("New Tab", systemImage: "plus")
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .contentShape(.rect)
                }
                .buttonStyle(SidebarRowButtonStyle())
                .help("New tab (⌘T)")

                Button {
                    withAnimation(.snappy(duration: 0.2)) {
                        if showsTabFilter {
                            closeTabFilter()
                        } else {
                            showsTabFilter = true
                            tabFilterFocused = true
                        }
                    }
                } label: {
                    Label(showsTabFilter ? "Close Tab Filter" : "Filter Tabs",
                          systemImage: showsTabFilter ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease")
                        .labelStyle(.iconOnly)
                        .frame(width: 30, height: 26)
                        .background(showsTabFilter ? Color.primary.opacity(0.08) : Color.clear, in: .rect(cornerRadius: 6))
                        .contentShape(.rect)
                }
                .buttonStyle(SidebarRowButtonStyle())
                .help(showsTabFilter ? "Close and clear tab filters" : "Filter tabs in this workspace")
            }
            .foregroundStyle(.secondary)

            if showsTabFilter {
                tabFilterControls
                    .transition(.opacity)
            }
        }
        .padding(.horizontal, 8).padding(.top, 4).padding(.bottom, 8)
        .background(WindowDragArea())   // below the title bar only, so the toolbar's own buttons keep their clicks
    }

    private var tabFilterControls: some View {
        let tabs = app.orderedTabs
        return VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    .accessibilityHidden(true)
                TextField("Search tabs", text: $tabQuery)
                    .textFieldStyle(.plain)
                    .focused($tabFilterFocused)
                if !tabQuery.isEmpty {
                    Button("Clear search", systemImage: "xmark.circle.fill") {
                        tabQuery = ""
                        tabFilterFocused = true
                    }
                    .labelStyle(.iconOnly)
                    .buttonStyle(.interactivePlain)
                    .foregroundStyle(.secondary)
                }
                Menu {
                    Picker("Tab Type", selection: $tabTypeFilter) {
                        Text("All Types").tag(nil as TabType?)
                        ForEach(TabType.allCases.filter { type in
                            tabs.contains { $0.tabType == type } || tabTypeFilter == type
                        }, id: \.self) { type in
                            Text(tabTypeTitle(type)).tag(Optional(type))
                        }
                    }
                    .pickerStyle(.inline)
                } label: {
                    Label("Tab Type", systemImage: "line.3.horizontal.decrease")
                        .labelStyle(.iconOnly)
                        .frame(width: 22, height: 22)
                        .contentShape(.rect)
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                .fixedSize()
                .help(tabTypeFilter.map(tabTypeTitle) ?? "All tab types")
            }
            .padding(.leading, 8)
            .padding(.trailing, 4)
            .padding(.vertical, 3)
            .background(.quaternary.opacity(0.55), in: .rect(cornerRadius: 8))

            if let type = tabTypeFilter {
                Button {
                    tabTypeFilter = nil
                } label: {
                    HStack(spacing: 5) {
                        Text(tabTypeTitle(type))
                        Image(systemName: "xmark").font(.caption2.weight(.semibold))
                    }
                    .font(.caption)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(.quaternary, in: .capsule)
                    .contentShape(.capsule)
                }
                .buttonStyle(.interactivePlain)
                .accessibilityLabel("Remove \(tabTypeTitle(type)) filter")
            }
        }
        .onExitCommand { closeTabFilter() }
    }

    private func tabTypeTitle(_ type: TabType) -> String {
        type == .bible ? "Scripture" : type.rawValue.capitalized
    }

    private func closeTabFilter() {
        tabQuery = ""
        tabTypeFilter = nil
        tabFilterFocused = false
        showsTabFilter = false
    }

    private var workspaceTabSearch: some View {
        let query = workspaceQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        let workspaces = app.workspaceItems.filter { $0.matches(query) }
        let matches = app.matchingWorkspaceTabs(query)
        let exactWorkspaces = WorkspaceItem.exactMatches(for: query, in: workspaces)
        return VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Workspace, passage, or tab title", text: $workspaceQuery)
                    .textFieldStyle(.plain)
                    .focused($workspaceSearchFocused)
                    .onSubmit {
                        guard !query.isEmpty, exactWorkspaces.count <= 1 else { return }
                        if let exact = exactWorkspaces.first {
                            openWorkspaceSearchResult(exact)
                        } else if let first = matches.first {
                            openWorkspaceTab(first)
                        } else if let first = workspaces.first {
                            openWorkspaceSearchResult(first)
                        }
                    }
                Button("Cancel") { showsWorkspaceSearch = false }
                    .keyboardShortcut(.cancelAction)
            }
            Divider()
            if exactWorkspaces.count > 1 {
                Text("Choose a workspace below.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if workspaces.isEmpty && matches.isEmpty {
                ContentUnavailableView.search(text: query)
            } else {
                List {
                    if !workspaces.isEmpty {
                        Section("Workspaces") {
                            ForEach(workspaces) { workspace in
                                Button { openWorkspaceSearchResult(workspace) } label: {
                                    let preview = workspace.previewLabels(matching: query).filter { $0 != workspace.displayName }
                                    let detail = ([workspace.displayDetail] + preview).joined(separator: " · ")
                                    searchResultLabel(title: workspace.displayName, detail: detail,
                                                      symbol: workspace.isSaved ? "square.stack.3d.up" : WorkspaceIcon.symbol(workspace.icon),
                                                      tint: .secondary)
                                }
                                .buttonStyle(.interactivePlain)
                            }
                        }
                    }
                    if !matches.isEmpty {
                        Section("Open Tabs") {
                            ForEach(matches) { match in
                                Button { openWorkspaceTab(match) } label: {
                                    searchResultLabel(title: match.tab.navigationLabel,
                                                      detail: match.workspaceName + " · " + match.tab.navigationDetail,
                                                      symbol: match.tab.symbol, tint: match.tab.tint)
                                }
                                .buttonStyle(.interactivePlain)
                            }
                        }
                    }
                }
                .listStyle(.plain)
            }
        }
        .padding(16)
        .frame(width: 460, height: 390)
        .onAppear { workspaceSearchFocused = true }
    }

    private func searchResultLabel(title: String, detail: String, symbol: String, tint: Color) -> some View {
        HStack(spacing: 10) {
            Image(systemName: symbol).foregroundStyle(tint).frame(width: 20)
            VStack(alignment: .leading) {
                Text(title).lineLimit(1)
                Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Spacer()
            Image(systemName: "arrow.right").foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
        .contentShape(.rect)
    }

    private func openWorkspaceSearchResult(_ workspace: WorkspaceItem) {
        app.open(workspace)
        showsWorkspaceSearch = false
    }

    private func openWorkspaceTab(_ match: AppModel.WorkspaceTabMatch) {
        app.openWorkspaceTab(match)
        showsWorkspaceSearch = false
    }

    /// One Workspace control: the current workspace; its menu lists every workspace (live and saved) and the actions.
    var workspaceSwitcher: some View {
        let workspaces = app.workspaceItems
        let current = workspaces.first { app.isCurrent($0) }
        let currentLabel = current?.displayName ?? app.session.name
        let duplicatePreviews = Set(Dictionary(grouping: workspaces, by: \.displayName)
            .filter { $0.value.count > 1 }.keys)
        return Menu {
            if let previous = app.recentWorkspaceTabs.first {
                let title = previous.tab.navigationLabel
                let label = previous.workspaceID == app.currentSessionId ? title : "\(title) · \(previous.workspaceName)"
                Button("Return to \(label)", systemImage: "arrow.uturn.backward") {
                    app.openWorkspaceTab(previous)
                }
            }
            Button("Find Workspace or Tab…", systemImage: "magnifyingglass") {
                workspaceQuery = ""
                showsWorkspaceSearch = true
            }
            Divider()
            ForEach(workspaces) { w in
                Toggle(isOn: Binding(get: { app.isCurrent(w) }, set: { if $0 { app.open(w) } })) {
                    Text(w.displayName == w.name || duplicatePreviews.contains(w.displayName) ? w.menuLabel : w.displayName)
                    Text(w.displayDetail)
                }
            }
            Divider()
            Button("New Workspace") { app.newWorkspace() }
            Button("Archive Inactive Tabs…") { showTabCleanup = true }.disabled(app.inactiveTabs.isEmpty)
            if let cur = current {
                Button("Rename Workspace…") { name = cur.displayName; renaming = cur }
                Button("Duplicate “\(cur.name)”") { app.duplicate(cur) }
                Menu("Icon") {
                    ForEach(WorkspaceIcon.all, id: \.name) { icon in
                        Button(WorkspaceIcon.label(icon.name), systemImage: icon.symbol) { app.setSessionIcon(app.currentSessionId, icon.name) }
                    }
                    Divider()
                    Button("Default") { app.setSessionIcon(app.currentSessionId, nil) }
                }
                Button("Save Snapshot…") { name = cur.name; savingSnapshot = true }
                Divider()
                Button("Delete “\(cur.name)”…", role: .destructive) { deleting = cur }.disabled(!app.canDelete(cur))
            }
            let savedOnly = app.workspaceItems.filter(\.isSaved)
            if !savedOnly.isEmpty {
                Menu("Manage Saved") {
                    ForEach(savedOnly) { w in
                        Menu(w.name) {
                            Button("Open") { app.open(w) }
                            Button("Rename…") { name = w.name; renaming = w }
                            Button("Delete…", role: .destructive) { deleting = w }
                        }
                    }
                }
            }
        } label: {
            Label(currentLabel, systemImage: WorkspaceIcon.symbol(app.session.icon))
                .fontWeight(.semibold)
                .lineLimit(1)
                .frame(maxWidth: 156, alignment: .leading)
        }
        .menuStyle(.borderlessButton).menuIndicator(.visible).fixedSize()
        .padding(.horizontal, 10).padding(.vertical, 5)
        .background(.quaternary.opacity(0.35), in: .capsule)
        .help("Workspace: \(current?.menuLabel ?? app.session.name) — switch, create, rename, duplicate or delete workspaces")
        .accessibilityLabel("Workspace \(currentLabel), \(current?.displayDetail ?? "")")
    }

    // MARK: tabs

    private var isFilteringTabs: Bool {
        tabTypeFilter != nil || !tabQuery.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var matchingTabs: [BereanWorkspace.Tab] {
        let query = tabQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        return app.matchingOpenTabs(query).filter { tabTypeFilter == nil || $0.tabType == tabTypeFilter }
    }

    @ViewBuilder var orderedTabs: some View {
        let pinned = matchingTabs.filter(\.isPinned), others = matchingTabs.filter { !$0.isPinned }
        if !pinned.isEmpty {
            sectionLabel("Pinned")
            ForEach(pinned) { row($0) }
            Divider().padding(.vertical, 6).padding(.horizontal, 6)
        }
        ForEach(others) { row($0) }
        if !isFilteringTabs && app.orderedTabs.isEmpty {
            Text("No tabs. Press ⌘T to open a passage, a Strong's number or a search.").font(.callout).foregroundStyle(.secondary).padding(10)
        }
    }

    @ViewBuilder var groupedTabs: some View {
        ForEach(SpaceId.allCases) { space in
            let tabs = matchingTabs.filter { $0.spaceId == space }
            if !tabs.isEmpty {
                sectionLabel(space.title)
                ForEach(tabs) { row($0) }
            }
        }
    }

    func sectionLabel(_ s: String) -> some View {
        Text(s).font(.caption.weight(.semibold)).foregroundStyle(.secondary).padding(.horizontal, 10).padding(.top, 6).padding(.bottom, 2)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder func row(_ tab: BereanWorkspace.Tab) -> some View {
        let row = SidebarTabRow(tab: tab, isActive: app.activeTab?.id == tab.id, isDragging: dragging == tab.id,
                               onSelect: { app.select(tab.id, in: tab.spaceId) }, onClose: { app.close(tab.id) })
            .contextMenu { tabMenu(tab) }
        if isFilteringTabs {
            row
        } else {
            row.onDrag {
                dragging = tab.id
                return NSItemProvider(object: tab.id as NSString)
            } preview: {
                SidebarTabRow(tab: tab, isActive: true, isDragging: false, onSelect: {}, onClose: {}).frame(width: 220)
            }
            .onDrop(of: [.text], delegate: TabDropDelegate(target: tab, app: app, dragging: $dragging))
        }
    }

    @ViewBuilder func tabMenu(_ tab: BereanWorkspace.Tab) -> some View {
        Button("Duplicate Tab") { app.duplicate(tab.id) }
        Button("Close Other Tabs") { app.closeOthers(tab.id) }
        Menu("Change Tab To") {
            ForEach(AppModel.TabKind.allCases, id: \.self) { kind in Button(kind.rawValue) { app.switchTab(tab.id, to: kind) } }
        }
        Button(tab.isPinned ? "Unpin Tab" : "Pin Tab") { app.togglePin(tab.id) }
        let destinations = app.tabMoveDestinations
        if !destinations.isEmpty {
            Menu("Move to Workspace") {
                ForEach(destinations) { workspace in
                    Button(workspace.moveMenuLabel) { app.moveTab(tab.id, to: workspace) }
                }
            }
        }
        Button("Archive Tab") { archiveWithUndo([tab.id]) }
        Divider()
        Button("Close Tab", role: .destructive) { app.close(tab.id) }
    }

    // MARK: archive

    private func archiveWithUndo(_ tabIDs: [String]) {
        if let group = app.archive(tabIDs) { undoArchiveID = group.id }
    }

    private func archiveNotice(_ group: ArchivedGroup) -> some View {
        let hasSource = app.canRestoreArchiveToSource(group.id)
        return HStack(spacing: 6) {
            Label("\(group.tabs.count) archived", systemImage: "archivebox")
                .font(.caption)
                .fixedSize()
            Spacer(minLength: 0)
            Button(hasSource ? "Undo" : "Restore Here") {
                app.restoreArchived(group.id, toSource: hasSource)
                if !app.archivedGroups.contains(where: { $0.id == group.id }) {
                    undoArchiveID = nil
                }
            }
            .buttonStyle(OptionButtonStyle())
            Button("Dismiss archive notice", systemImage: "xmark") { undoArchiveID = nil }
                .labelStyle(.iconOnly)
                .buttonStyle(OptionButtonStyle())
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(.quaternary, in: .rect(cornerRadius: 8))
        .padding(8)
    }

    var archive: some View {
        let titles = archiveExpanded ? app.archiveTitles() : [:]
        let sourceNames = archiveExpanded ? app.archiveSourceNames() : [:]
        let destinations = archiveExpanded ? app.tabMoveDestinations : []
        return VStack(alignment: .leading, spacing: 2) {
            Button { withAnimation(.snappy(duration: 0.18)) { archiveExpanded.toggle() } } label: {
                HStack {
                    Text("Archived").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    Spacer()
                    Image(systemName: "chevron.right").font(.caption2.weight(.semibold)).foregroundStyle(.secondary).rotationEffect(.degrees(archiveExpanded ? 90 : 0))
                }.padding(.horizontal, 10).padding(.vertical, 4).contentShape(.rect)
            }.buttonStyle(.interactivePlain)
            if archiveExpanded {
                Button(action: browseArchive) {
                    Label("Browse Archived Tabs…", systemImage: "magnifyingglass")
                        .padding(.horizontal, 10).padding(.vertical, 6)
                }
                .buttonStyle(.interactivePlain)
                ForEach(app.archivedGroups) { g in
                    Button { app.restoreArchived(g.id) } label: {
                        Label(titles[g.id] ?? g.label, systemImage: "archivebox").lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 10).padding(.vertical, 6).contentShape(.rect)
                    }
                    .buttonStyle(SidebarRowButtonStyle())
                    .help("Restore \(app.archivedTabs(g).count) tab(s)")
                    .contextMenu {
                        Button("Restore All") { app.restoreArchived(g.id) }
                        if !g.tabs.isEmpty, let source = sourceNames[g.id] {
                            Button("Restore to \(source)") { app.restoreArchived(g.id, toSource: true) }
                        }
                        if !g.tabs.isEmpty && !destinations.isEmpty {
                            Menu("Restore All to Workspace", systemImage: "square.stack") {
                                ForEach(destinations) { workspace in
                                    Button(workspace.moveMenuLabel) { app.restoreArchived(g.id, to: workspace) }
                                }
                            }
                        }
                        Menu("Restore One Tab") {
                            ForEach(app.archivedTabs(g)) { tab in
                                Button(tab.navigationLabel + " · " + tab.navigationDetail, systemImage: tab.symbol) {
                                    app.restoreArchivedTab(tab.id, from: g.id)
                                }
                            }
                        }
                        Button("Remove from Archive", role: .destructive) { app.dismissArchived(g.id) }
                    }
                }
            }
        }
    }
}

/// Live reordering: entering a row moves the dragged tab to that row's place (animated); dropping onto the
/// pinned group pins it, onto the other group unpins it. The order is persisted through `moveTabs`.
struct TabDropDelegate: DropDelegate {
    let target: BereanWorkspace.Tab
    let app: AppModel
    @Binding var dragging: String?

    func dropEntered(info: DropInfo) {
        guard let id = dragging, id != target.id, let dragged = app.findTab(id) else { return }
        if dragged.isPinned != target.isPinned { app.update(id, recordHistory: false) { $0.isPinned = target.isPinned } }
        let group = app.orderedTabs.filter { $0.isPinned == target.isPinned }.map(\.id)
        guard let from = group.firstIndex(of: id), let to = group.firstIndex(of: target.id) else { return }
        withAnimation(.snappy(duration: 0.18)) {
            app.moveTabs(group, from: IndexSet(integer: from), to: to > from ? to + 1 : to)
        }
    }
    func dropUpdated(info: DropInfo) -> DropProposal? { DropProposal(operation: .move) }
    func performDrop(info: DropInfo) -> Bool { dragging = nil; return true }
    func dropExited(info: DropInfo) {}
}

/// Arc/Yab-style tab row: a raised rounded card for the active tab, a soft fill on hover, close button on hover.
struct SidebarTabRow: View {
    @Environment(\.colorScheme) private var scheme
    let tab: BereanWorkspace.Tab
    let isActive: Bool
    let isDragging: Bool
    let onSelect: () -> Void
    let onClose: () -> Void
    @State private var hovering = false

    var body: some View {
        let comparing = tab.tabType == .bible && BibleState(tab.state).compareMode
        HStack(spacing: 8) {
            Image(systemName: comparing ? "rectangle.split.2x1" : tab.symbol).font(.system(size: 13, weight: .medium)).foregroundStyle(tab.tint).frame(width: 18)
            Text(tab.navigationLabel)
                .font(.system(size: 13, weight: isActive ? .medium : .regular))
                .foregroundStyle(isActive ? .primary : .secondary)
                .lineLimit(1)
            Spacer(minLength: 0)
            if tab.scriptureEditionLabel == "LXX" {
                Text("LXX")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .fixedSize()
            }
            ZStack {
                if hovering {
                    Button(action: onClose) {
                        Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).frame(width: 18, height: 18)
                    }
                    .buttonStyle(SidebarCloseButtonStyle())
                    .help("Close Tab (⌘W)")
                    .accessibilityLabel("Close \(tab.navigationLabel)")
                } else if tab.isPinned {
                    Image(systemName: "pin.fill").font(.system(size: 9)).foregroundStyle(.tertiary)
                }
            }
            .frame(width: 18, height: 18)
        }
        .padding(.leading, 10).padding(.trailing, 6)
        .frame(height: 34)
        .background {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(isActive ? (scheme == .dark ? Color.white.opacity(0.13) : Color.white.opacity(0.92)) : (hovering ? Color.primary.opacity(0.06) : .clear))
                .shadow(color: isActive ? .black.opacity(scheme == .dark ? 0.35 : 0.10) : .clear, radius: isActive ? 1.5 : 0, y: isActive ? 0.5 : 0)
        }
        .opacity(isDragging ? 0.35 : 1)
        .contentShape(.rect)
        .onTapGesture(perform: onSelect)
        .onHover { hovering = $0 }
        .pointerStyle(.link)
        .help("\(tab.navigationLabel) · \(tab.navigationDetail)")
        .animation(.easeOut(duration: 0.12), value: hovering)
        .animation(.easeOut(duration: 0.15), value: isActive)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isActive ? [.isButton, .isSelected] : .isButton)
        .accessibilityLabel("\(tab.navigationLabel), \(tab.navigationDetail)\(tab.isPinned ? ", pinned" : "")")
        .accessibilityAction { onSelect() }
    }
}

struct SidebarRowButtonStyle: ButtonStyle {
    @State private var hovering = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.primary.opacity(configuration.isPressed ? 0.10 : hovering ? 0.06 : 0)))
            .pointerStyle(.link)
            .onHover { hovering = $0 }
    }
}

struct SidebarCloseButtonStyle: ButtonStyle {
    @State private var hovering = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(.secondary)
            .background(RoundedRectangle(cornerRadius: 5).fill(Color.primary.opacity(configuration.isPressed ? 0.16 : hovering ? 0.09 : 0)))
            .pointerStyle(.link)
            .onHover { hovering = $0 }
    }
}

/// An AppKit area that moves the window when dragged (`NSWindow.performDrag`), placed behind sidebar content.
struct WindowDragArea: NSViewRepresentable {
    final class DragView: NSView {
        override func mouseDown(with event: NSEvent) {
            if event.clickCount == 2 { window?.performZoom(nil); return }   // title-bar convention
            window?.performDrag(with: event)
        }
        override var mouseDownCanMoveWindow: Bool { true }
    }
    func makeNSView(context: Context) -> NSView { DragView() }
    func updateNSView(_ nsView: NSView, context: Context) {}
}

struct MacArchivedTabsSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var archiveQuery = ""
    @FocusState private var archiveSearchFocused: Bool

    var body: some View {
        let terms = archiveQuery.replacingOccurrences(of: "–", with: "-").split(whereSeparator: \.isWhitespace)
        let titles = app.archiveTitles()
        let sourceNames = app.archiveSourceNames()
        let searchTitles = app.archiveTitles(includeAliases: true)
        let groups = app.archivedGroups.map { group in
            (group, group.tabs.filter { tab in
                return terms.allSatisfy { "\(tab.navigationSearchText) \(searchTitles[group.id] ?? group.label)".localizedStandardContains(String($0)) }
            })
        }.filter { !$0.1.isEmpty }
        return VStack(spacing: 12) {
            HStack {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Search archived tabs", text: $archiveQuery)
                    .textFieldStyle(.plain)
                    .focused($archiveSearchFocused)
                Button("Done") { dismiss() }
                    .keyboardShortcut(.cancelAction)
            }
            List {
                ForEach(groups, id: \.0.id) { group, tabs in
                    if !tabs.isEmpty {
                        Section(titles[group.id] ?? group.label) {
                            ForEach(tabs) { tab in
                                Button {
                                    app.restoreArchivedTab(tab.id, from: group.id)
                                    dismiss()
                                } label: {
                                    HStack {
                                        Label(tab.navigationLabel, systemImage: tab.symbol)
                                        Spacer()
                                        Text(tab.navigationDetail).foregroundStyle(.secondary)
                                    }
                                    .padding(.vertical, 4)
                                    .contentShape(.rect)
                                }
                                .buttonStyle(.interactivePlain)
                                .help("Restore and open this tab")
                                .contextMenu {
                                    Button("Restore and Open Here", systemImage: "archivebox") {
                                        app.restoreArchivedTab(tab.id, from: group.id)
                                        dismiss()
                                    }
                                    if let source = sourceNames[group.id] {
                                        Button("Restore and Open in \(source)", systemImage: "square.stack") {
                                            app.restoreArchivedTab(tab.id, from: group.id, toSource: true)
                                            dismiss()
                                        }
                                        Divider()
                                        Button("Restore to \(source) in Background", systemImage: "arrow.down.to.line") {
                                            app.restoreArchived(group.id, toSource: true, only: tab.id)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .overlay {
                if groups.isEmpty {
                    if terms.isEmpty {
                        ContentUnavailableView("No Restorable Tabs", systemImage: "archivebox")
                    } else {
                        ContentUnavailableView.search(text: archiveQuery)
                    }
                }
            }
        }
        .padding(16)
        .frame(width: 440, height: 350)
        .onAppear { archiveSearchFocused = true }
    }
}
