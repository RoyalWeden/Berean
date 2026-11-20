import SwiftUI
import BereanWorkspace

/// Renders the requested document identity rather than choosing a document from
/// global focus. Currently used only for the single active tab. Background panes
/// still require command/inspector routing and duplicate-note editing coordination.
struct MacTabContentHost: View {
    @Environment(AppModel.self) private var app
    let tabID: String

    @ViewBuilder var body: some View {
        if let tab = app.findTab(tabID) {
            switch tab.tabType {
            case .bible:
                let st = BibleState(tab.state)
                let layout = ScriptureLayout(rawValue: st.scriptureLayout) ?? .standard
                ScriptureLayoutView(tabId: tab.id, layout: layout)
                    .id(tab.id)
                    .toolbar {
                        ToolbarItem {
                            Menu {
                                Picker("Layout", selection: Binding(get: { layout }, set: { v in
                                    app.update(tab.id) { t in var s = BibleState(t.state); s.scriptureLayout = v.rawValue; if v == .standard { s.rightPanelOpen = true }; t.state = s.merged(into: t.state) }
                                })) { ForEach(ScriptureLayout.allCases) { Label($0.title, systemImage: $0.symbol).tag($0) } }
                                    .pickerStyle(.inline)
                            } label: { Label("Layout", systemImage: layout.symbol) }
                            .menuIndicator(.hidden)
                        }
                    }
            case .lexicon:
                LexiconTabHost(tab: tab)
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
            case .pdf:
                PdfTabView(tabId: tab.id).id(tab.id)
            case .youtube:
                if #available(iOS 26.0, macOS 26.0, *) {
                    YouTubeTabView(tabId: tab.id).id(tab.id)
                } else {
                    ContentUnavailableView("YouTube Needs iOS 26", systemImage: "play.rectangle",
                                           description: Text("Update to iOS 26 or later to watch YouTube in Berean."))
                }
            default:
                ContentUnavailableView(tab.title, systemImage: tab.symbol,
                                       description: Text("This kind of tab arrives in a later native build. It stays saved with your workspace."))
            }
        } else {
            ContentUnavailableView("Tab Unavailable", systemImage: "rectangle.slash",
                                   description: Text("This tab is no longer open in this workspace."))
        }
    }
}
