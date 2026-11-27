import SwiftUI
import AppKit
import BereanCore
import BereanWorkspace
import BereanReference

/// The native Mac window: a sidebar of Spaces with vertical tabs (Arc-style) inside the current session,
/// and the active tab's content with its toolbar and study inspector.
struct MacRootView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.openWindow) private var openWindow
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
                                InspectorWidthReader(isPresented: activeInspectorState(for: tab.id)?.rightPanelOpen == true,
                                                     preferredWidth: inspectorWidth,
                                                     isCurrent: { activeInspectorState(for: tab.id)?.rightPanelOpen == true }) { width in
                                    guard activeInspectorState(for: tab.id)?.rightPanelOpen == true,
                                          width >= MacLayoutLimits.studyPanelMinimum, width <= 520,
                                          abs(width - inspectorWidth) > 0.5 else { return }
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
                    ToolbarItem(placement: .primaryAction) {
                        Button { openWindow(id: "presenter") } label: {
                            Label("Presenter", systemImage: "rectangle.on.rectangle")
                        }
                        .labelStyle(.titleAndIcon)
                        .help("Open Presenter (⇧⌘B)")
                    }
                }
        }
        .toolbarBackground(scriptureToolbarBackground, for: .windowToolbar)
        .background { NativeDividerCursorRegions() }
        // Both scrims switch immediately from the same visibility state. A fade
        // on the SwiftUI overlay leaves the native title bar dimming ahead of it.
        .background { ToolbarDimOverlay(isVisible: app.commandPaletteShown, opacity: paletteDimOpacity) }
        .disabled(app.commandPaletteShown)
        .studyTrailSheet(app: app)
        .sheet(isPresented: $showsArchive) { MacArchivedTabsSheet() }
        .overlay(alignment: .bottomTrailing) { CrashReportBanner() }
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
                .transition(.identity)
            }
        }
        .onChange(of: app.sidebarToggleRequest) { withAnimation { columns = columns == .detailOnly ? .all : .detailOnly } }
        .onChange(of: app.chatWindowRequest) { openWindow(id: "chat") }
        .sheet(isPresented: Binding(get: { app.gettingStartedShown }, set: { app.gettingStartedShown = $0 })) {
            GettingStartedChecklist().environment(app)
        }
        .sheet(isPresented: Binding(get: { app.askBereanShown }, set: { app.askBereanShown = $0 })) {
            AskBereanView().environment(app)
        }
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
        // Keep the render's identity but read live state. Change Current Tab
        // can reuse this ID for a different type while AppKit is dismissing.
        let targetID = app.activeTab.flatMap { inspectorState(in: $0) == nil ? nil : $0.id }
        return Binding(get: {
            targetID.flatMap { activeInspectorState(for: $0)?.rightPanelOpen } ?? false
        }, set: { presented in
            guard let targetID, let reader = activeInspectorState(for: targetID),
                  reader.rightPanelOpen != presented else { return }
            app.update(targetID, recordHistory: false) { tab in
                guard inspectorState(in: tab) != nil else { return }
                tab.state["rightPanelOpen"] = .bool(presented)
            }
        })
    }

    private func activeInspectorState(for tabID: String) -> BibleState? {
        guard let tab = app.activeTab, tab.id == tabID else { return nil }
        return inspectorState(in: tab)
    }

    private func inspectorState(in tab: BereanWorkspace.Tab) -> BibleState? {
        guard tab.tabType == .bible else { return nil }
        let state = BibleState(tab.state)
        let layout = ScriptureLayout(rawValue: state.scriptureLayout) ?? .standard
        return layout.usesInspector ? state : nil
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
    let isPresented: Bool
    let preferredWidth: CGFloat
    let isCurrent: () -> Bool
    let changed: (CGFloat) -> Void
    func makeNSView(context: Context) -> Probe { Probe() }
    func updateNSView(_ view: Probe, context: Context) {
        view.configure(isPresented: isPresented, preferredWidth: preferredWidth, isCurrent: isCurrent, changed: changed)
    }
    static func dismantleNSView(_ view: Probe, coordinator: Void) { view.stop() }

    final class Probe: NSView {
        var changed: (CGFloat) -> Void = { _ in }
        private var queued = false
        private var lastWidth: CGFloat?
        private var settle: Timer?
        private var isPresented = false
        private var preferredWidth: CGFloat = 340
        private var pendingRestoreWidth: CGFloat?
        private var isCurrent: () -> Bool = { false }

        func configure(isPresented: Bool, preferredWidth: CGFloat, isCurrent: @escaping () -> Bool,
                       changed: @escaping (CGFloat) -> Void) {
            self.isCurrent = isCurrent
            self.changed = changed
            self.preferredWidth = preferredWidth
            if isPresented && !self.isPresented { pendingRestoreWidth = preferredWidth }
            if !isPresented {
                pendingRestoreWidth = nil
                settle?.invalidate()
                settle = nil
            }
            self.isPresented = isPresented
            scheduleReport()
        }

        override func hitTest(_ point: NSPoint) -> NSView? { nil }
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            stop()
            guard window != nil else { return }
            if isPresented { pendingRestoreWidth = preferredWidth }
            NotificationCenter.default.addObserver(self, selector: #selector(splitResized(_:)),
                name: NSSplitView.didResizeSubviewsNotification, object: nil)
            scheduleReport()
        }
        override func layout() { super.layout(); scheduleReport() }
        @objc private func splitResized(_ notification: Notification) {
            guard let split = notification.object as? NSSplitView, isDescendant(of: split) else { return }
            // A user resize owns the width immediately, including one that starts
            // before the first presentation layout has completed.
            if split.inLiveResize || window?.inLiveResize == true || NSApp.currentEvent?.type == .leftMouseDragged {
                pendingRestoreWidth = nil
            }
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
                guard self.window != nil, self.isPresented, self.isCurrent() else { return }
                var child: NSView = self
                while let parent = child.superview {
                    if let split = parent as? NSSplitView, split.isVertical,
                       split.arrangedSubviews.last === child {
                        let width = child.frame.width
                        if let requested = self.pendingRestoreWidth {
                            // The native inspector remembers its hidden minimum on a
                            // Bible→Bible transition. Restore the visible width once,
                            // after its real pane geometry exists; never fight later
                            // resize input or continuously constrain a live divider.
                            guard split.arrangedSubviews.count == 2, !child.isHidden,
                                  !split.isSubviewCollapsed(child),
                                  let primary = split.arrangedSubviews.first,
                                  primary.frame.width >= MacLayoutLimits.studyPanelMinimum,
                                  abs(child.frame.maxX - split.bounds.maxX) < 1,
                                  width >= MacLayoutLimits.studyPanelMinimum else { return }
                            self.pendingRestoreWidth = nil
                            let available = split.bounds.width - MacLayoutLimits.studyPanelMinimum - split.dividerThickness
                            let target = min(max(MacLayoutLimits.studyPanelMinimum, requested), min(520, available))
                            if target >= MacLayoutLimits.studyPanelMinimum, abs(width - target) > 0.5 {
                                split.setPosition(split.bounds.maxX - target, ofDividerAt: 0)
                                self.scheduleReport()
                                return
                            }
                        }
                        guard width > 0, self.lastWidth != width else { return }
                        self.lastWidth = width
                        self.settle?.invalidate()
                        // Opening/closing uses intermediate native widths. Remember
                        // only a settled pane, without changing its live animation target.
                        let timer = Timer(timeInterval: 0.25, repeats: false) { [weak self] _ in
                            MainActor.assumeIsolated {
                                guard let self, self.window != nil, self.isPresented, self.isCurrent(),
                                      self.pendingRestoreWidth == nil, self.lastWidth == width else { return }
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
