import SwiftUI
import BereanCore
import BereanWorkspace
import BereanReference

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

/// The native Mac window: a sidebar of Spaces with vertical tabs (Arc-style) inside the current session,
/// and the active tab's content with its toolbar and study inspector.
struct MacRootView: View {
    @Environment(AppModel.self) private var app
    @State private var renaming: String?
    @State private var renameText = ""
    @State private var savingWorkspace = false
    @State private var workspaceName = ""

    var body: some View {
        @Bindable var app = app
        NavigationSplitView {
            sidebar
                .navigationSplitViewColumnWidth(min: 200, ideal: 250, max: 360)
        } detail: {
            detail
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

    var sidebar: some View {
        List(selection: sidebarSelection) {
            ForEach(SpaceId.allCases) { space in
                Section {
                    ForEach(app.tabs(in: space)) { tab in
                        Label(tab.title.isEmpty ? "Untitled" : tab.title, systemImage: tab.symbol)
                            .badge(tab.isPinned ? Text(Image(systemName: "pin.fill")) : nil)
                            .tag(tab.id)
                            .contextMenu { tabMenu(tab) }
                    }
                    .onMove { app.move(in: space, from: $0, to: $1) }
                } header: {
                    HStack {
                        Label(space.title, systemImage: space.symbol)
                        Spacer()
                        Button { newTab(in: space) } label: { Image(systemName: "plus") }
                            .buttonStyle(.borderless).help("New \(space.title) tab")
                    }
                }
            }
        }
        .listStyle(.sidebar)
        .safeAreaInset(edge: .top) { sessionPicker.padding(.horizontal, 10).padding(.top, 4) }
    }

    var sessionPicker: some View {
        Menu {
            ForEach(app.sessions) { s in
                Button { app.switchSession(s.id) } label: {
                    if s.id == app.currentSessionId { Label(s.name, systemImage: "checkmark") } else { Text(s.name) }
                }
            }
            Divider()
            Button("New Session") { app.newSession() }
            Button("Rename Session…") { renameText = app.session.name; renaming = app.currentSessionId }
            Button("Delete Session", role: .destructive) { app.deleteSession(app.currentSessionId) }.disabled(app.sessions.count < 2)
            Divider()
            Button("Save Session as Workspace…") { workspaceName = app.session.name; savingWorkspace = true }
            Menu("Open Workspace") {
                if app.savedWorkspaces.isEmpty { Text("No saved workspaces") }
                ForEach(app.savedWorkspaces) { w in Button(w.name) { app.openWorkspace(w.id) } }
            }
        } label: {
            Label(app.session.name, systemImage: "rectangle.stack")
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .menuStyle(.borderlessButton)
        .alert("Rename Session", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: $renameText)
            Button("Rename") { if let id = renaming { app.renameSession(id, to: renameText) }; renaming = nil }
            Button("Cancel", role: .cancel) { renaming = nil }
        }
        .alert("Save Workspace", isPresented: $savingWorkspace) {
            TextField("Workspace name", text: $workspaceName)
            Button("Save") { app.saveWorkspace(named: workspaceName) }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Saves this session's tabs. Workspaces also appear in Berean's Settings → Layout.")
        }
    }

    @ViewBuilder func tabMenu(_ tab: BereanWorkspace.Tab) -> some View {
        Button(tab.isPinned ? "Unpin" : "Pin") { app.togglePin(tab.id) }
        Button("Duplicate") { app.duplicate(tab.id) }
        if app.sessions.count > 1 {
            Menu("Move to Session") {
                ForEach(app.sessions.filter { $0.id != app.currentSessionId }) { s in Button(s.name) { app.moveTab(tab.id, toSession: s.id) } }
            }
        }
        Divider()
        Button("Close Tab") { app.close(tab.id) }
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
