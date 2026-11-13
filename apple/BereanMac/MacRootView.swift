import SwiftUI
import BereanCore
import BereanWorkspace
import BereanReference

/// The native Mac window: a sidebar of Spaces with vertical tabs (Arc-style) inside the current session,
/// and the active tab's content with its toolbar and study inspector.
struct MacRootView: View {
    @Environment(AppModel.self) private var app
    @State private var columns: NavigationSplitViewVisibility = .all

    var body: some View {
        @Bindable var app = app
        NavigationSplitView(columnVisibility: $columns) {
            BereanSidebar()
                .navigationSplitViewColumnWidth(min: 200, ideal: 250, max: 360)
                // Browser-style: [sidebar] [‹] [›] together in the sidebar's title bar (Yab / Safari / Arc).
                .toolbar(removing: .sidebarToggle)
                .toolbar { ToolbarItemGroup(placement: .automatic) { if columns != .detailOnly { navGroup } } }
        } detail: {
            detail
                .toolbar {
                    // With the sidebar hidden the same buttons sit right after the sidebar button.
                    ToolbarItemGroup(placement: .navigation) { if columns == .detailOnly { navGroup } }
                }
        }
        .sheet(isPresented: $app.commandPaletteShown) { CommandPalette() }
        .onChange(of: app.sidebarToggleRequest) { withAnimation { columns = columns == .detailOnly ? .all : .detailOnly } }
        .alert(app.userMessage ?? "", isPresented: Binding(get: { app.userMessage != nil }, set: { if !$0 { app.userMessage = nil } })) { Button("OK") {} }
        .alert("Library", isPresented: Binding(get: { app.libraryError != nil }, set: { if !$0 { app.libraryError = nil } })) {
            Button("OK") { app.libraryError = nil }
        } message: { Text(app.libraryError ?? "") }
    }

    /// [sidebar] [‹] [›] — one group, the same order whether the sidebar is shown or hidden.
    @ViewBuilder var navGroup: some View {
        Button { withAnimation { columns = columns == .detailOnly ? .all : .detailOnly } } label: {
            Label(columns == .detailOnly ? "Show Sidebar" : "Hide Sidebar", systemImage: "sidebar.left")
        }
        .help(columns == .detailOnly ? "Show Sidebar (⌃⌘S)" : "Hide Sidebar (⌃⌘S)")
        historyButtons
    }

    @ViewBuilder var historyButtons: some View {
        Button { app.goBack() } label: { Label("Back", systemImage: "chevron.backward") }
            .disabled(!app.canGoBack).help("Back (⌘[)")
        Button { app.goForward() } label: { Label("Forward", systemImage: "chevron.forward") }
            .disabled(!app.canGoForward).help("Forward (⌘])")
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
                if let id = tab.state["noteId"]?.stringValue?.string { NoteDetailView(noteId: id).id(tab.id + id) } else { NotesHomeView(tabId: tab.id).id(tab.id) }
            case .calendar:
                DailyNoteCalendar(tabId: tab.id).id(tab.id)
            case .history:
                HistoryView().id(tab.id)
            case .tags:
                TagManagerView().id(tab.id)
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


