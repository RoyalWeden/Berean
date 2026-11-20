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
    @State private var showsArchive = false
    @State private var inspectorWidth: CGFloat = 340
    private let paletteDimOpacity = 0.12

    var body: some View {
        @Bindable var app = app
        NavigationSplitView(columnVisibility: $columns) {
            BereanSidebar(browseArchive: { showsArchive = true })
                .frame(minWidth: MacLayoutLimits.sidebarMinimum)
                .navigationSplitViewColumnWidth(min: MacLayoutLimits.sidebarMinimum, ideal: 260, max: 360)
                // Browser-style: [sidebar] [‹] [›] together in the sidebar's title bar (Yab / Safari / Arc).
                .toolbar(removing: .sidebarToggle)
                .toolbar { ToolbarItemGroup(placement: .automatic) { if columns != .detailOnly { navGroup } } }
        } detail: {
            detail
                // The window owns one inspector. Switching document identities must not
                // destroy/recreate a presented native inspector for each reader host.
                .inspector(isPresented: inspectorBinding) {
                    if let tab = app.activeTab, tab.tabType == .bible {
                        StudyInspector(tabId: tab.id)
                            .frame(minWidth: MacLayoutLimits.studyPanelMinimum)
                            .inspectorColumnWidth(min: MacLayoutLimits.studyPanelMinimum, ideal: max(MacLayoutLimits.studyPanelMinimum, inspectorWidth), max: 520)
                            .background {
                                InspectorWidthReader { width in
                                    guard width >= MacLayoutLimits.studyPanelMinimum, width <= 520, abs(width - inspectorWidth) > 0.5 else { return }
                                    inspectorWidth = width
                                }
                            }
                    }
                }
                .transaction(value: app.activeTab?.id) { transaction in
                    transaction.animation = nil
                    transaction.disablesAnimations = true
                }
                .toolbar {
                    // With the sidebar hidden the same buttons sit right after the sidebar button.
                    ToolbarItemGroup(placement: .navigation) { if columns == .detailOnly { navGroup } }
                }
        }
        .toolbarBackground(scriptureToolbarBackground, for: .windowToolbar)
        .background { NativeDividerCursorRegions() }
        // Match the content scrim above the native toolbar glass.
        .background { ToolbarDimOverlay(isVisible: app.commandPaletteShown, opacity: paletteDimOpacity) }
        .disabled(app.commandPaletteShown)
        .studyTrailSheet(app: app)
        .sheet(isPresented: $showsArchive) { MacArchivedTabsSheet() }
        .overlay(alignment: .top) {
            if app.commandPaletteShown {
                GeometryReader { geometry in
                    ZStack(alignment: .top) {
                        Color.black.opacity(paletteDimOpacity)
                            .contentShape(.rect)
                            .onTapGesture { app.commandPaletteShown = false }
                            .pointerStyle(.default)
                            .accessibilityHidden(true)
                        CommandPalette(newTab: app.commandPaletteCreatesTab,
                                       location: app.commandPaletteLocationRequest,
                                       resultsHeight: min(390, max(100, geometry.size.height - 156)),
                                       close: { app.commandPaletteShown = false })
                            .id(app.commandPaletteLocationRequest?.id)
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

    private var inspectorBinding: Binding<Bool> {
        // Capture this render's target so a late native dismissal cannot change
        // the newly selected tab's saved open/closed state.
        let target = app.activeTab
        return Binding(get: {
            guard let target, target.tabType == .bible,
                  app.activeTab?.id == target.id else { return false }
            let state = BibleState(target.state)
            let layout = ScriptureLayout(rawValue: state.scriptureLayout) ?? .standard
            return layout.usesInspector && state.rightPanelOpen
        }, set: { presented in
            guard let target, target.tabType == .bible,
                  app.activeTab?.id == target.id else { return }
            let state = BibleState(target.state)
            let layout = ScriptureLayout(rawValue: state.scriptureLayout) ?? .standard
            guard layout.usesInspector else { return }
            app.update(target.id, recordHistory: false) { tab in
                var reader = BibleState(tab.state)
                reader.rightPanelOpen = presented
                tab.state = reader.merged(into: tab.state)
            }
        })
    }

    /// [sidebar] [‹] [›] stay together in the sidebar title bar.
    @ViewBuilder var navGroup: some View {
        ControlGroup {
        Button { withAnimation { columns = columns == .detailOnly ? .all : .detailOnly } } label: {
            Label(columns == .detailOnly ? "Show Sidebar" : "Hide Sidebar", systemImage: "sidebar.left")
        }
        .clickableCursor()
        .accessibilityIdentifier(ProcessInfo.processInfo.arguments.contains("--qa-library") ? "berean-native-qa-sidebar-toggle" : "sidebar-toggle")
        .help(columns == .detailOnly ? "Show Sidebar (⌃⌘S)" : "Hide Sidebar (⌃⌘S)")
        historyButtons
        }
        .controlGroupStyle(.navigation)
        .labelStyle(.iconOnly)
    }

    @ViewBuilder var historyButtons: some View {
        Button { app.goBack() } label: { Label("Back", systemImage: "chevron.backward") }
            .accessibilityLabel("Back").accessibilityIdentifier("history-back")
            .clickableCursor(app.canGoBack)
            .disabled(!app.canGoBack).help("Back (⌘[)")
        Button { app.goForward() } label: { Label("Forward", systemImage: "chevron.forward") }
            .accessibilityLabel("Forward").accessibilityIdentifier("history-forward")
            .clickableCursor(app.canGoForward)
            .disabled(!app.canGoForward).help("Forward (⌘])")
    }

    @ViewBuilder var detail: some View {
        if let tab = app.activeTab {
            MacTabContentHost(tabID: tab.id)
        } else {
            ContentUnavailableView {
                Label("No tab open", systemImage: app.activeSpace.symbol)
            } description: {
                Text("Open a passage, a note or a search.")
            } actions: {
                Button("Go…") { app.showCommandPalette() }
                    .buttonStyle(.borderedProminent)
                    .clickableCursor()
                if !app.archivedGroups.isEmpty {
                    Button("Browse Archived Tabs…") { showsArchive = true }
                        .buttonStyle(.bordered)
                        .clickableCursor()
                }
            }
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



/// Measure the native inspector pane, including its host insets. Measuring the
/// SwiftUI content and feeding that smaller width back as the ideal would shrink
/// the pane repeatedly. This probe uses only public NSView/NSSplitView geometry.
private struct InspectorWidthReader: NSViewRepresentable {
    let changed: (CGFloat) -> Void
    func makeNSView(context: Context) -> Probe { Probe() }
    func updateNSView(_ view: Probe, context: Context) { view.changed = changed; view.scheduleReport() }
    static func dismantleNSView(_ view: Probe, coordinator: Void) { view.stop() }

    final class Probe: NSView {
        var changed: (CGFloat) -> Void = { _ in }
        private var queued = false
        private var lastWidth: CGFloat?
        private var settle: Timer?
        override func hitTest(_ point: NSPoint) -> NSView? { nil }
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            stop()
            guard window != nil else { return }
            NotificationCenter.default.addObserver(self, selector: #selector(splitResized(_:)),
                name: NSSplitView.didResizeSubviewsNotification, object: nil)
            scheduleReport()
        }
        override func layout() { super.layout(); scheduleReport() }
        @objc private func splitResized(_ notification: Notification) {
            guard let split = notification.object as? NSSplitView, isDescendant(of: split) else { return }
            scheduleReport()
        }
        func stop() {
            settle?.invalidate()
            settle = nil
            NotificationCenter.default.removeObserver(self, name: NSSplitView.didResizeSubviewsNotification, object: nil)
        }
        func scheduleReport() {
            guard !queued else { return }
            queued = true
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.queued = false
                guard self.window != nil else { return }
                var child: NSView = self
                while let parent = child.superview {
                    if let split = parent as? NSSplitView, split.isVertical,
                       split.arrangedSubviews.last === child {
                        let width = child.frame.width
                        guard width > 0, self.lastWidth != width else { return }
                        self.lastWidth = width
                        self.settle?.invalidate()
                        // Opening/closing uses intermediate native widths. Remember
                        // only a settled pane, without changing its live animation target.
                        let timer = Timer(timeInterval: 0.25, repeats: false) { [weak self] _ in
                            MainActor.assumeIsolated {
                                guard let self, self.window != nil, self.lastWidth == width else { return }
                                self.changed(width)
                                self.settle = nil
                            }
                        }
                        self.settle = timer
                        RunLoop.main.add(timer, forMode: .common)
                        return
                    }
                    child = parent
                }
            }
        }
    }
}
