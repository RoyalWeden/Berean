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
        .sheet(isPresented: $showTabs) { TabCardsSheet().presentationDetents([.medium, .large]) }
        .sheet(isPresented: $app.commandPaletteShown) { CommandPalette().presentationDetents([.height(220)]) }
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
            if let tab = app.activeTab { Button("Close Tab", role: .destructive) { app.close(tab.id) } }
        } label: { Label("Commands", systemImage: "chevron.up.circle") }
    }

    func mutate(_ id: String, _ f: (inout BibleState) -> Void) {
        app.update(id) { t in var s = BibleState(t.state); f(&s); t.state = s.merged(into: t.state); t.title = Reference.bookChapterLabel(s.bookId, chapter: Double(s.chapter)) }
    }
}

/// All tabs of the session as cards, grouped by Space; tap to switch, swipe or ✕ to close.
struct TabCardsSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                ForEach(SpaceId.allCases) { space in
                    let tabs = app.tabs(in: space)
                    if !tabs.isEmpty {
                        Section(space.rawValue.capitalized) {
                            ForEach(tabs) { tab in
                                Button { app.select(tab.id, in: space); dismiss() } label: {
                                    HStack {
                                        Text(tab.title.isEmpty ? "Untitled" : tab.title)
                                        Spacer()
                                        if tab.id == app.activeTabId(in: space) { Image(systemName: "checkmark").foregroundStyle(.tint) }
                                    }
                                }
                                .swipeActions { Button("Close", role: .destructive) { app.close(tab.id) } }
                            }
                            .onMove { app.move(in: space, from: $0, to: $1) }
                        }
                    }
                }
            }
            .navigationTitle(app.session.name)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Menu("Sessions") {
                        ForEach(app.sessions) { s in Button(s.name) { app.switchSession(s.id) } }
                        Button("New Session") { app.newSession() }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) { EditButton() }
            }
        }
    }
}
