import SwiftUI
import AppKit
import BereanCore
import BereanWorkspace
import BereanReference

/// The native Mac window: a sidebar of Spaces with vertical tabs (Arc-style) inside the current session,
/// and the active tab's content with its toolbar and study inspector.
struct MacRootView: View {
    @Environment(AppModel.self) private var app
    @State private var columns: NavigationSplitViewVisibility = .all
    private let paletteDimOpacity = 0.12

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
        .toolbarBackground(scriptureToolbarBackground, for: .windowToolbar)
        // Match the content scrim above the native toolbar glass.
        .background { ToolbarDimOverlay(isVisible: app.commandPaletteShown, opacity: paletteDimOpacity) }
        .disabled(app.commandPaletteShown)
        .studyTrailSheet(app: app)
        .overlay(alignment: .top) {
            if app.commandPaletteShown {
                GeometryReader { geometry in
                    ZStack(alignment: .top) {
                        Color.black.opacity(paletteDimOpacity)
                            .contentShape(.rect)
                            .onTapGesture { app.commandPaletteShown = false }
                            .accessibilityHidden(true)
                        CommandPalette(newTab: app.commandPaletteCreatesTab,
                                       resultsHeight: min(390, max(100, geometry.size.height - 156)),
                                       close: { app.commandPaletteShown = false })
                            .frame(maxWidth: 680)
                            .padding(.horizontal, 20)
                            .padding(.top, 24)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                }
                .transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.15), value: app.commandPaletteShown)
        .onChange(of: app.sidebarToggleRequest) { withAnimation { columns = columns == .detailOnly ? .all : .detailOnly } }
        .alert(app.userMessage ?? "", isPresented: Binding(get: { app.userMessage != nil }, set: { if !$0 { app.userMessage = nil } })) { Button("OK") {} }
        .alert("Library", isPresented: Binding(get: { app.libraryError != nil }, set: { if !$0 { app.libraryError = nil } })) {
            Button("OK") { app.libraryError = nil }
        } message: { Text(app.libraryError ?? "") }
    }

    private var scriptureToolbarBackground: Visibility {
        guard let tab = app.activeTab, tab.tabType == .bible, !BibleState(tab.state).compareMode else { return .automatic }
        return .hidden
    }

    /// [sidebar] [‹] [›] — one group, the same order whether the sidebar is shown or hidden.
    @ViewBuilder var navGroup: some View {
        Button { withAnimation { columns = columns == .detailOnly ? .all : .detailOnly } } label: {
            Label(columns == .detailOnly ? "Show Sidebar" : "Hide Sidebar", systemImage: "sidebar.left")
        }
        .pointerStyle(.link)
        .help(columns == .detailOnly ? "Show Sidebar (⌃⌘S)" : "Hide Sidebar (⌃⌘S)")
        historyButtons
    }

    @ViewBuilder var historyButtons: some View {
        Button { app.goBack() } label: { Label("Back", systemImage: "chevron.backward") }
            .pointerStyle(app.canGoBack ? .link : .default)
            .disabled(!app.canGoBack).help("Back (⌘[)")
        Button { app.goForward() } label: { Label("Forward", systemImage: "chevron.forward") }
            .pointerStyle(app.canGoForward ? .link : .default)
            .disabled(!app.canGoForward).help("Forward (⌘])")
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
            default:
                ContentUnavailableView(tab.title, systemImage: tab.symbol,
                                       description: Text("This kind of tab arrives in a later native build. It stays saved with your workspace."))
            }
        } else {
            ContentUnavailableView("No tab open", systemImage: app.activeSpace.symbol,
                                   description: Text("Press ⌘T to open a passage, a Strong's number or a search."))
        }
    }
}

/// Adds a pass-through tint over the native titlebar, where the SwiftUI content overlay cannot
/// reach the toolbar's glass buttons. The frame is derived from the public contentLayoutRect and
/// converted into the window frame view's coordinates; no titlebar implementation classes are
/// inspected.
private struct ToolbarDimOverlay: NSViewRepresentable {
    let isVisible: Bool
    let opacity: Double

    func makeNSView(context: Context) -> ToolbarDimOverlayHostView {
        ToolbarDimOverlayHostView()
    }

    func updateNSView(_ view: ToolbarDimOverlayHostView, context: Context) {
        view.configure(isVisible: isVisible, opacity: opacity)
    }
}

private final class ToolbarDimOverlayHostView: NSView {
    private let tintView = PassThroughTintView()
    private var isVisible = false
    private var opacity: Double = 0

    override func viewWillMove(toWindow newWindow: NSWindow?) {
        if let window {
            NotificationCenter.default.removeObserver(self, name: NSWindow.didResizeNotification, object: window)
        }
        tintView.removeFromSuperview()
        super.viewWillMove(toWindow: newWindow)
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if let window {
            NotificationCenter.default.addObserver(self, selector: #selector(windowDidResize(_:)),
                                                   name: NSWindow.didResizeNotification, object: window)
        }
        layoutTitlebarTint()
    }

    @objc private func windowDidResize(_ notification: Notification) {
        layoutTitlebarTint()
    }

    func configure(isVisible: Bool, opacity: Double) {
        self.isVisible = isVisible
        self.opacity = opacity
        layoutTitlebarTint()
    }

    override func layout() {
        super.layout()
        layoutTitlebarTint()
    }

    private func layoutTitlebarTint() {
        guard let window, let frameView = window.contentView?.superview else {
            tintView.removeFromSuperview()
            return
        }
        guard isVisible else {
            tintView.removeFromSuperview()
            return
        }

        // contentLayoutRect is in window coordinates and ends where the titlebar begins.
        let contentRect = window.contentLayoutRect
        let titlebarRect = CGRect(x: 0, y: contentRect.maxY,
                                  width: window.frame.width,
                                  height: max(0, window.frame.height - contentRect.maxY))
        guard titlebarRect.height > 0 else {
            tintView.removeFromSuperview()
            return
        }
        tintView.frame = frameView.convert(titlebarRect, from: nil)
        tintView.layer?.backgroundColor = NSColor.black.withAlphaComponent(opacity).cgColor
        if tintView.superview !== frameView {
            tintView.removeFromSuperview()
            frameView.addSubview(tintView, positioned: .above, relativeTo: nil)
        }
    }
}

private final class PassThroughTintView: NSView {
    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
    }

    required init?(coder: NSCoder) { nil }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }
}


