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
    @State private var dragging: String?
    @State private var renaming: WorkspaceItem?
    @State private var deleting: WorkspaceItem?
    @State private var savingSnapshot = false
    @State private var name = ""

    var body: some View {
        VStack(spacing: 0) {
            header
            GeometryReader { geo in
                ScrollView {
                    VStack(alignment: .leading, spacing: 2) {
                        if groupBySpace { groupedTabs } else { orderedTabs }
                        if !app.archivedGroups.isEmpty { archive.padding(.top, 14) }
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
        }
        .contextMenu {
            Toggle("Group Tabs by Space", isOn: $groupBySpace)
            Button("Archive All Tabs") { app.archiveAllTabs() }.disabled(app.orderedTabs.isEmpty)
        }
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
            Button { app.commandPaletteShown = true } label: {
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
            .buttonStyle(.plain)
            .help("Go to a passage, Strong's number, note or search (⌘K)")
            .accessibilityLabel("Location: \(app.locationTitle.space), \(app.locationTitle.title). Open reference or search")
            Button { app.commandPaletteShown = true } label: {
                Label("New Tab", systemImage: "plus").frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 10).padding(.vertical, 6).contentShape(.rect)
            }
            .buttonStyle(SidebarRowButtonStyle())
            .foregroundStyle(.secondary)
            .help("New tab (⌘T)")
        }
        .padding(.horizontal, 8).padding(.top, 4).padding(.bottom, 8)
        .background(WindowDragArea())   // below the title bar only, so the toolbar's own buttons keep their clicks
    }

    /// One Workspace control: the current workspace; its menu lists every workspace (live and saved) and the actions.
    var workspaceSwitcher: some View {
        Menu {
            ForEach(app.workspaceItems) { w in
                Toggle(isOn: Binding(get: { app.isCurrent(w) }, set: { if $0 { app.open(w) } })) {
                    Text(w.name)
                    Text(w.isSaved ? "Saved · \(w.tabCount) tab\(w.tabCount == 1 ? "" : "s")" : "\(w.tabCount) tab\(w.tabCount == 1 ? "" : "s")")
                }
            }
            Divider()
            Button("New Workspace") { app.newWorkspace() }
            if let cur = app.currentWorkspace {
                Button("Rename “\(cur.name)”…") { name = cur.name; renaming = cur }
                Button("Duplicate “\(cur.name)”") { app.duplicate(cur) }
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
            Label(app.session.name, systemImage: "square.stack").fontWeight(.semibold)
        }
        .menuStyle(.borderlessButton).menuIndicator(.visible).fixedSize()
        .padding(.horizontal, 10).padding(.vertical, 5)
        .background(.quaternary.opacity(0.35), in: .capsule)
        .help("Workspace: \(app.session.name) — switch, create, rename, duplicate or delete workspaces")
        .accessibilityLabel("Workspace \(app.session.name), \(app.tabCount(app.currentSessionId)) tabs")
    }

    // MARK: tabs

    @ViewBuilder var orderedTabs: some View {
        let pinned = app.orderedTabs.filter(\.isPinned), others = app.orderedTabs.filter { !$0.isPinned }
        if !pinned.isEmpty {
            sectionLabel("Pinned")
            ForEach(pinned) { row($0) }
            Divider().padding(.vertical, 6).padding(.horizontal, 6)
        }
        ForEach(others) { row($0) }
        if app.orderedTabs.isEmpty {
            Text("No tabs. Press ⌘T to open a passage, a Strong's number or a search.").font(.callout).foregroundStyle(.secondary).padding(10)
        }
    }

    @ViewBuilder var groupedTabs: some View {
        ForEach(SpaceId.allCases) { space in
            let tabs = app.tabs(in: space)
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

    func row(_ tab: BereanWorkspace.Tab) -> some View {
        SidebarTabRow(tab: tab, isActive: app.activeTab?.id == tab.id, isDragging: dragging == tab.id,
                      onSelect: { app.select(tab.id, in: tab.spaceId) }, onClose: { app.close(tab.id) })
            .contextMenu { tabMenu(tab) }
            .onDrag {
                dragging = tab.id
                return NSItemProvider(object: tab.id as NSString)
            } preview: {
                SidebarTabRow(tab: tab, isActive: true, isDragging: false, onSelect: {}, onClose: {}).frame(width: 220)
            }
            .onDrop(of: [.text], delegate: TabDropDelegate(target: tab, app: app, dragging: $dragging))
    }

    @ViewBuilder func tabMenu(_ tab: BereanWorkspace.Tab) -> some View {
        Button("Duplicate Tab") { app.duplicate(tab.id) }
        Button(tab.isPinned ? "Unpin Tab" : "Pin Tab") { app.togglePin(tab.id) }
        let others = app.sessions.filter { $0.id != app.currentSessionId }
        if !others.isEmpty {
            Menu("Move to Workspace") { ForEach(others) { s in Button(s.name) { app.moveTab(tab.id, toSession: s.id) } } }
        }
        Button("Archive Tab") { app.archive([tab.id]) }
        Divider()
        Button("Close Tab", role: .destructive) { app.close(tab.id) }
    }

    // MARK: archive

    var archive: some View {
        VStack(alignment: .leading, spacing: 2) {
            Button { withAnimation(.snappy(duration: 0.18)) { archiveExpanded.toggle() } } label: {
                HStack {
                    Text("Archived").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    Spacer()
                    Image(systemName: "chevron.right").font(.caption2.weight(.semibold)).foregroundStyle(.secondary).rotationEffect(.degrees(archiveExpanded ? 90 : 0))
                }.padding(.horizontal, 10).padding(.vertical, 4).contentShape(.rect)
            }.buttonStyle(.plain)
            if archiveExpanded {
                ForEach(app.archivedGroups) { g in
                    Button { app.restoreArchived(g.id) } label: {
                        Label(g.label.isEmpty ? "Archived tabs" : g.label, systemImage: "archivebox").lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 10).padding(.vertical, 6).contentShape(.rect)
                    }
                    .buttonStyle(SidebarRowButtonStyle())
                    .help("Restore \(app.archivedTabs(g).count) tab(s)")
                    .contextMenu {
                        Button("Restore") { app.restoreArchived(g.id) }
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
        HStack(spacing: 8) {
            Image(systemName: tab.symbol).font(.system(size: 13, weight: .medium)).foregroundStyle(tab.tint).frame(width: 18)
            Text(tab.title.isEmpty ? "Untitled" : tab.title)
                .font(.system(size: 13, weight: isActive ? .medium : .regular))
                .foregroundStyle(isActive ? .primary : .secondary)
                .lineLimit(1)
            Spacer(minLength: 0)
            if hovering {
                Button(action: onClose) { Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).frame(width: 18, height: 18) }
                    .buttonStyle(SidebarCloseButtonStyle())
                    .help("Close Tab (⌘W)").accessibilityLabel("Close \(tab.title)")
            } else if tab.isPinned {
                Image(systemName: "pin.fill").font(.system(size: 9)).foregroundStyle(.tertiary)
            }
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
        .animation(.easeOut(duration: 0.12), value: hovering)
        .animation(.easeOut(duration: 0.15), value: isActive)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isActive ? [.isButton, .isSelected] : .isButton)
        .accessibilityLabel("\(tab.title.isEmpty ? "Untitled" : tab.title), \(tab.spaceId.title)\(tab.isPinned ? ", pinned" : "")")
        .accessibilityAction { onSelect() }
    }
}

struct SidebarRowButtonStyle: ButtonStyle {
    @State private var hovering = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Color.primary.opacity(configuration.isPressed ? 0.10 : hovering ? 0.06 : 0)))
            .onHover { hovering = $0 }
    }
}

struct SidebarCloseButtonStyle: ButtonStyle {
    @State private var hovering = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(.secondary)
            .background(RoundedRectangle(cornerRadius: 5).fill(Color.primary.opacity(configuration.isPressed ? 0.16 : hovering ? 0.09 : 0)))
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
