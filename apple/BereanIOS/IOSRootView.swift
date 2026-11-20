import SwiftUI
import UIKit
import BereanCore
import BereanWorkspace
import BereanReference
import BereanText
import BereanNotes

private struct HistoryEdgeSwipe: UIGestureRecognizerRepresentable {
    let enabled: Bool
    let edge: UIRectEdge
    let action: () -> Void

    func makeUIGestureRecognizer(context: Context) -> UIScreenEdgePanGestureRecognizer {
        let recognizer = UIScreenEdgePanGestureRecognizer()
        updateUIGestureRecognizer(recognizer, context: context)
        return recognizer
    }

    func updateUIGestureRecognizer(_ recognizer: UIScreenEdgePanGestureRecognizer, context: Context) {
        recognizer.edges = edge
        recognizer.isEnabled = enabled
    }

    func handleUIGestureRecognizerAction(_ recognizer: UIScreenEdgePanGestureRecognizer, context: Context) {
        guard enabled, recognizer.state == .ended else { return }
        let translation = recognizer.translation(in: recognizer.view)
        let inwardDistance = edge == .right ? -translation.x : translation.x
        guard inwardDistance >= 44, inwardDistance >= abs(translation.y) * 1.5 else { return }
        action()
    }
}

/// The native iPhone shell, following the existing iPhone navigation (docs/mobile/mobile-navigation.md):
/// bottom-left tabs, bottom-centre Go (reference / Strong's / search), bottom-right More with the
/// current tab's commands. Content views are shared with the Mac app.
struct IOSRootView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.layoutDirection) private var layoutDirection
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @State private var contentWidth: CGFloat = 0
    @State private var showArchive = false
    @State private var readerArchiveUndo: ReaderArchiveUndo?
    @State private var archiveNoticeHeight: CGFloat = 0

    private struct ReaderArchiveUndo {
        let groupID: String
        let tabID: String
        let workspaceID: String
    }
    @State private var pendingStudyDestination: (tabID: String, action: () -> Void)?
    @State private var showTabs = false
    @State private var tabSheetDetent = PresentationDetent.large
    private struct GoRequest: Identifiable {
        let id = UUID()
        let newTab: Bool
    }
    @State private var goRequest: GoRequest?
    @State private var showSettings = false
    @State private var keyboardUp = false
    @State private var noteEditingFocus = NoteEditingFocus()
    @State private var showScriptureDisplay = false
    @State private var chapterTagTarget: ChapterTagTarget?
    @State private var findRequest = 0
    @State private var editionFlipRequest = 0
    @State private var pendingNewTab = false
    @State private var alternateEdition: ChapterEdition?
    @State private var availableEdition: ChapterEdition?

    private var readerEdition: ChapterEdition? {
        guard let tab = app.activeTab, tab.tabType == .bible else { return nil }
        let state = BibleState(tab.state)
        return state.compareMode ? nil : ChapterEdition(state)
    }

    private var sideBySideReaderControls: Bool {
        readerEdition != nil && verticalSizeClass == .compact && contentWidth >= 580 && !keyboardUp
    }

    var body: some View {
        @Bindable var app = app
        NavigationStack {
            content
                .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { contentWidth = $0 }
                .gesture(HistoryEdgeSwipe(
                    enabled: app.canGoBack && !keyboardUp,
                    edge: layoutDirection == .rightToLeft ? .right : .left,
                    action: goBackFromEdge
                ))
                .safeAreaInset(edge: .bottom, spacing: 0) {
                    if readerEdition == nil && !keyboardUp { bottomControls }
                }
                .overlay(alignment: .bottom) {
                    if readerEdition != nil && !keyboardUp { bottomControls }
                }
                // The dock steps aside while typing (the note editor's format bar docks above the keyboard).
                .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)) { note in
                    // Covers the software keyboard and the accessory-only bar shown with a hardware keyboard.
                    guard let end = (note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue else { return }
                    let screen = (note.object as? UIScreen)?.bounds ?? UIScreen.main.bounds
                    let up = end.minY < screen.maxY - 1 && end.height > 0
                    if up != keyboardUp { withAnimation(.snappy(duration: 0.2)) { keyboardUp = up } }
                }
                .onReceive(NotificationCenter.default.publisher(for: .bereanNoteEditing)) { note in
                    guard let activity = note.object as? NoteEditorActivity,
                          let up = noteEditingFocus.receive(activity) else { return }
                    if up != keyboardUp { withAnimation(.snappy(duration: 0.2)) { keyboardUp = up } }
                }
                .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
                    withAnimation(.snappy(duration: 0.2)) { keyboardUp = false }
                }
        }
        .studyTrailSheet(app: app)
        .task(id: readerEdition) {
            availableEdition = nil
            guard let source = readerEdition else { return }
            let chapters = await app.bible.chapterNumbers(source.book, textId: source.text)
            guard !Task.isCancelled, readerEdition == source else { return }
            if chapters.contains(source.chapter) { availableEdition = source }
        }
        .task(id: readerEdition) {
            alternateEdition = nil
            guard let source = readerEdition else { return }
            let target = await app.installedCounterpart(of: source)
            guard !Task.isCancelled, readerEdition == source else { return }
            alternateEdition = target
        }
        .sheet(isPresented: $showSettings) { NavigationStack { SettingsView().navigationTitle("Settings").toolbar { Button("Done") { showSettings = false } } } }
        .fullScreenCover(isPresented: Binding(get: { app.chatShown }, set: { app.chatShown = $0 })) {
            ChatView(onDone: { app.chatShown = false })
        }
        .sheet(isPresented: Binding(get: { app.idiomDraft != nil }, set: { if !$0 { app.idiomDraft = nil } })) {
            NewIdiomSheet(term: app.idiomDraft?.term ?? "", meaning: app.idiomDraft?.meaning ?? "")
                .presentationDetents([.medium])
        }
        .fullScreenCover(isPresented: Binding(get: { app.onboardingShown }, set: { if !$0 { app.completeOnboarding() } })) {
            OnboardingView()
        }
        .sheet(item: $chapterTagTarget) { target in
            TagPickerView(ranges: target.ranges, label: target.label, kind: "chapter")
        }
        .sheet(isPresented: $showScriptureDisplay) {
            NavigationStack {
                Form { ScriptureDisplayOptions(); ScriptureAnnotationOptions() }
                    .navigationTitle("Scripture Display")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { showScriptureDisplay = false }
                        }
                    }
            }
            .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $showTabs, onDismiss: {
            guard pendingNewTab else { return }
            pendingNewTab = false
            openGo(newTab: true)
        }) {
            TabCardsSheet(onNewTab: {
                pendingNewTab = true
                showTabs = false
            })
            .presentationDetents([.medium, .large], selection: $tabSheetDetent)
        }
        .sheet(isPresented: $showArchive) {
            NavigationStack {
                ArchivedTabsPage(onOpen: { showArchive = false })
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { showArchive = false }
                        }
                    }
            }
        }
        .sheet(item: $goRequest) { request in
            GoSheet(newTab: request.newTab, close: { goRequest = nil }).presentationDetents([.large])
        }
        .alert(app.userMessage ?? "", isPresented: Binding(get: { app.userMessage != nil }, set: { if !$0 { app.userMessage = nil } })) { Button("OK") {} }
    }

    private func goBackFromEdge() {
        guard app.canGoBack, !keyboardUp else { return }
        withAnimation(.snappy) { app.goBack() }
        if UserLibrary.defaults.object(forKey: "berean.haptics.enabled") as? Bool ?? true {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        }
    }

    private func openGo(newTab: Bool = false) {
        // Presentation and destination intent travel together. Separate state
        // variables can leave a newly presented sheet with the previous mode.
        goRequest = GoRequest(newTab: newTab)
    }

    private var visibleArchiveUndo: ReaderArchiveUndo? {
        guard let receipt = readerArchiveUndo,
              app.currentSessionId == receipt.workspaceID,
              app.archivedGroups.contains(where: { $0.id == receipt.groupID }),
              !app.readerChromeHidden else { return nil }
        return receipt
    }

    private var readerDockClearance: CGFloat {
        guard !keyboardUp, !app.readerChromeHidden else { return 0 }
        let noticeClearance = visibleArchiveUndo == nil ? 0 : max(44, archiveNoticeHeight)
        return ReaderFloatingControls.readerDockHeight + noticeClearance
    }

    private var bottomControls: some View {
        VStack(spacing: 0) {
            if let receipt = visibleArchiveUndo {
                HStack(spacing: 8) {
                    Label("Tab archived", systemImage: "archivebox")
                        .font(.subheadline)
                    Button("Undo") {
                        app.restoreArchivedTab(receipt.tabID, from: receipt.groupID, toSource: true)
                        if !app.archivedGroups.contains(where: { $0.id == receipt.groupID }) {
                            readerArchiveUndo = nil
                            AccessibilityNotification.Announcement("Tab restored").post()
                        }
                    }
                    .buttonStyle(.bordered)
                    .frame(minHeight: 44)
                    Button("Dismiss archive notice", systemImage: "xmark") { readerArchiveUndo = nil }
                        .labelStyle(.iconOnly)
                        .buttonStyle(.borderless)
                        .frame(minWidth: 44, minHeight: 44)
                }
                .padding(.leading, 12)
                .glassEffectCompat(interactive: true, backingOpacity: ReaderFloatingControls.dockBackingOpacity)
                .padding(.horizontal, 14)
                .frame(maxWidth: .infinity, alignment: sideBySideReaderControls ? .trailing : .center)
                .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { archiveNoticeHeight = $0 }
            }
            bottomBar
        }
    }

    private var bottomBar: some View {
        HStack(spacing: 8) {
            Button { tabSheetDetent = .large; showTabs = true } label: { bottomItem(symbol: "square.on.square", badge: app.tabCount(app.currentSessionId)) }
                .accessibilityLabel("Tabs and workspaces, \(app.tabCount(app.currentSessionId)) open")
            Button { openGo() } label: { bottomItem(symbol: "magnifyingglass", prominent: true) }
                .accessibilityLabel("Go to a passage or search")
            menu
        }
        .buttonStyle(.interactivePlain)
        .padding(.horizontal, 12)
        .padding(.vertical, ReaderFloatingControls.dockSurfacePadding)
        .glassEffectCompat(interactive: true, backingOpacity: readerEdition == nil ? 0 : ReaderFloatingControls.dockBackingOpacity)
        .frame(maxWidth: 260)
        .padding(.horizontal, 14)
        .padding(.vertical, ReaderFloatingControls.dockOuterPadding)
        // Swipe across the dock to move to the neighbouring tab (original BottomNav: >60 pt, mostly horizontal).
        .simultaneousGesture(
            DragGesture(minimumDistance: 24).onEnded { value in
                let dx = value.translation.width, dy = value.translation.height
                guard abs(dx) > 60, abs(dx) > abs(dy) * 1.5 else { return }
                if withAnimation(.snappy, { app.stepTab(dx < 0 ? 1 : -1) }),
                   UserLibrary.defaults.object(forKey: "berean.haptics.enabled") as? Bool ?? true {
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                }
            }
        )
        .offset(y: app.readerChromeHidden ? 110 : 0)
        .opacity(app.readerChromeHidden ? 0 : 1)
        .allowsHitTesting(!app.readerChromeHidden)
        .accessibilityHidden(app.readerChromeHidden)
        .frame(maxWidth: .infinity, alignment: sideBySideReaderControls ? .trailing : .center)
    }

    private func bottomItem(symbol: String, prominent: Bool = false, badge: Int? = nil) -> some View {
        Image(systemName: symbol)
            .font(.system(size: 17, weight: .semibold))
            .frame(width: 46, height: 30)
            .foregroundStyle(prominent ? Color.white : Color.primary)
            .background {
                if prominent { Capsule().fill(Color.accentColor) }
            }
            .overlay(alignment: .topTrailing) {
                if let badge, badge > 0 {
                    Text(badge > 99 ? "99+" : String(badge))
                        .font(.system(size: 9, weight: .semibold).monospacedDigit())
                        .padding(.horizontal, 4)
                        .padding(.vertical, 2)
                        .background(.thinMaterial, in: .capsule)
                        .offset(x: 6, y: -1)
                        .accessibilityHidden(true)
                }
            }
        .frame(maxWidth: .infinity, minHeight: ReaderFloatingControls.dockButtonHeight)
        .contentShape(.rect)
    }

    @ViewBuilder var content: some View {
        if let tab = app.activeTab {
            switch tab.tabType {
            case .bible:
                let st = BibleState(tab.state)
                ScriptureView(tabId: tab.id, findRequest: findRequest, editionFlipRequest: editionFlipRequest,
                              dockClearance: readerDockClearance,
                              sideBySideReaderControls: sideBySideReaderControls)
                    .id(tab.id)
                    .inspector(isPresented: Binding(get: { st.rightPanelOpen }, set: { isPresented in
                        guard app.activeTab?.id == tab.id else { return }
                        setStudyPanel(isPresented, in: tab.id)
                    })) {
                        StudyInspector(tabId: tab.id, performCrossReferenceDestination: { action in
                            pendingStudyDestination = (tab.id, action)
                            setStudyPanel(false, in: tab.id)
                        })
                        .presentationDetents([.medium, .large])
                        .onDisappear { finishStudyDestination(from: tab.id) }
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
                ContentUnavailableView(tab.title, systemImage: "square.dashed", description: Text("This kind of tab arrives in a later native build."))
            }
        } else {
            ContentUnavailableView {
                Label("No tab open", systemImage: "book")
            } description: { Text("Open a passage, a note or a search.") } actions: {
                Button("Go…") { openGo() }.buttonStyle(.borderedProminent)
                if !app.archivedGroups.isEmpty {
                    Button("Browse Archived Tabs…") { showArchive = true }
                        .buttonStyle(.bordered)
                }
            }
        }
    }

    /// Commands for what is on screen, then the app-level items (always last, always the same).
    var menu: some View {
        Menu {
            if app.canGoBack || app.canGoForward {
                ControlGroup {
                    Button { app.goBack() } label: { Label("Back", systemImage: "chevron.backward") }.disabled(!app.canGoBack)
                    Button { app.goForward() } label: { Label("Forward", systemImage: "chevron.forward") }.disabled(!app.canGoForward)
                }
            }
            if let tab = app.activeTab, tab.tabType == .bible {
                let st = BibleState(tab.state)
                let hasText = st.compareMode || availableEdition == ChapterEdition(st)
                Section {
                    if !st.compareMode {
                        Button("Find in Chapter", systemImage: "magnifyingglass") { findRequest += 1 }
                        let source = ChapterEdition(st)
                        if let target = alternateEdition, target == source.counterpart {
                            Button("Switch to \(textInfo(target.text).short)", systemImage: "arrow.left.arrow.right") {
                                editionFlipRequest += 1
                            }
                        }
                    }
                    let selected = app.readerSelectedVerses(in: tab.id, state: st)
                    Button {
                        app.focusStudyVerse(selected.first ?? st.verse, in: tab.id, selectedVerses: selected)
                        setStudyPanel(true, in: tab.id, tool: .crossrefs)
                    } label: {
                        Label("Cross References", systemImage: "arrow.triangle.branch")
                    }
                    Button("Chapter Notes", systemImage: "note.text") {
                        app.focusStudyVerse(nil, in: tab.id)
                        setStudyPanel(true, in: tab.id, tool: .notes)
                    }
                }
                Section {
                    Menu("Reading Options", systemImage: "textformat.size") {
                        Toggle(isOn: Binding(get: { st.showStrongs }, set: { enabled in
                            app.update(tab.id, recordHistory: false) { $0.state["showStrongs"] = .bool(enabled) }
                        })) { Label("Strong's Numbers", systemImage: "number") }
                        Toggle(isOn: Binding(get: { st.compareMode }, set: { enabled in
                            app.update(tab.id) { $0.state["compareMode"] = enabled ? .bool(true) : nil }
                        })) { Label("Compare Texts", systemImage: "rectangle.split.2x1") }
                        Button("Scripture Display…", systemImage: "textformat.size") { showScriptureDisplay = true }
                    }
                    Menu("Chapter Actions", systemImage: "square.and.arrow.up") {
                        Button("Tag Chapter…", systemImage: "tag") { chapterTagTarget = ChapterTagTarget(st) }
                            .disabled(!hasText)
                        Divider()
                        ChapterExportActions(state: st, tabId: tab.id, hasText: hasText)
                    }
                }
            }
            if let tab = app.activeTab {
                Section {
                    Menu("Tab Actions", systemImage: "square.on.square") {
                        Menu {
                            ForEach(AppModel.TabKind.allCases, id: \.self) { kind in
                                Button(kind.rawValue) { app.switchTab(tab.id, to: kind) }
                            }
                        } label: { Label("Change Tab To", systemImage: "arrow.triangle.swap") }
                        Divider()
                        Button("Duplicate Tab", systemImage: "plus.square.on.square") { app.duplicate(tab.id) }
                        Button("Archive Tab", systemImage: "archivebox") {
                            let workspaceID = app.currentSessionId
                            if let group = app.archive([tab.id]) {
                                readerArchiveUndo = ReaderArchiveUndo(groupID: group.id, tabID: tab.id, workspaceID: workspaceID)
                                AccessibilityNotification.Announcement("Tab archived. Undo is available.").post()
                            }
                        }
                        Button("Close Tab", systemImage: "xmark", role: .destructive) { app.close(tab.id) }
                    }
                }
            }
            Section {
                Menu("Study Tools", systemImage: "books.vertical") {
                    Button("Study Trail", systemImage: "point.topleft.down.to.point.bottomright.curvepath") { app.showStudyTrail = true }
                    Button { app.openCalendar() } label: { Label("Calendar", systemImage: "calendar") }
                    Button("Tags", systemImage: "tag") { app.openTags() }
                    Button("PDFs", systemImage: "doc.richtext") { app.openPdfLibrary() }
                    Button("YouTube", systemImage: "play.rectangle") { app.openYouTube() }
                    Button("Berean Chat", systemImage: "bubble.left.and.text.bubble.right") { app.chatShown = true }
                }
                Button { showSettings = true } label: { Label("Settings", systemImage: "gearshape") }
            }
        } label: { bottomItem(symbol: "ellipsis").hoverEffect(.highlight) }
        .menuOrder(.fixed)
        .accessibilityLabel("More: commands for this tab")
    }

    private func finishStudyDestination(from tabID: String) {
        guard let pendingStudyDestination, pendingStudyDestination.tabID == tabID else { return }
        self.pendingStudyDestination = nil
        guard app.activeTab?.id == tabID else { return }
        pendingStudyDestination.action()
    }

    private func setStudyPanel(_ isPresented: Bool, in tabID: String, tool: InspectorTool? = nil) {
        app.update(tabID, recordHistory: false) { tab in
            tab.state["rightPanelOpen"] = .bool(isPresented)
            if let tool { StudyPanelSlots.focus(tool, in: &tab.state) }
        }
    }

}

/// The tab sheet (the existing iPhone TabCardsSheet, list view): the session row, a tab search, every tab of
/// the session in the user's order (pinned first), swipe / long-press actions, reorder, New Tab and Archived.
struct TabCardsSheet: View {
    let onNewTab: () -> Void
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var showTabCleanup = false
    @State private var isSelecting = false
    @State private var selectedTabIDs: Set<String> = []
    @State private var undoArchiveID: String?
    @State private var movedTabsNotice: String?

    @State private var spaceFilter: SpaceId?
    @State private var typeFilter: TabType?
    @State private var repeatedTitlesOnly = false
    /// "grid" shows Safari-style tab cards (original TabCardsSheet grid); "list" keeps the compact rows. Device-local.
    @AppStorage("tabCardsLayout") private var layout = "grid"
    /// "custom" = workspace order (drag in list mode); "recent" = most recently used first (original Recent/Custom sort).
    @AppStorage("tabCardsSort") private var tabSort = "custom"

    private var isFiltering: Bool { spaceFilter != nil || typeFilter != nil || repeatedTitlesOnly }
    private var hasQuery: Bool { !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private var canReorder: Bool { !isSelecting && tabSort != "recent" && !isFiltering && !hasQuery }

    private func typeTitle(_ type: TabType) -> String {
        type == .bible ? "Scripture" : type.rawValue.capitalized
    }

    private func matchesFilters(_ tab: BereanWorkspace.Tab) -> Bool {
        (spaceFilter == nil || tab.spaceId == spaceFilter)
            && (typeFilter == nil || tab.tabType == typeFilter)
    }

    var shown: [BereanWorkspace.Tab] {
        let repeated = repeatedTitlesOnly ? AppModel.sameTitleTabIndices(app.orderedTabs) : [:]
        return app.matchingOpenTabs(query, space: spaceFilter).filter {
            matchesFilters($0) && (!repeatedTitlesOnly || repeated[$0.id] != nil)
        }
    }

    private var selectableIDs: Set<String> {
        selectableIDs(in: shown)
    }

    private func selectableIDs(in tabs: [BereanWorkspace.Tab]) -> Set<String> {
        Set(app.inactiveTabs.map(\.id)).intersection(tabs.map(\.id))
    }

    private func finishSelection() {
        selectedTabIDs.removeAll()
        isSelecting = false
    }

    private func openOrSelect(_ tab: BereanWorkspace.Tab, eligible: Bool) {
        if isSelecting {
            guard eligible else { return }
            if !selectedTabIDs.insert(tab.id).inserted { selectedTabIDs.remove(tab.id) }
        } else {
            app.select(tab.id, in: tab.spaceId)
            dismiss()
        }
    }

    var body: some View {
        let visibleTabs = shown
        let sameTitleIndices = AppModel.sameTitleTabIndices(app.orderedTabs)
        let eligible = selectableIDs(in: visibleTabs)
        let otherMatches = isSelecting || repeatedTitlesOnly ? [] : app.matchingWorkspaceTabs(query).filter {
            $0.workspaceID != app.currentSessionId && matchesFilters($0.tab)
        }
        return NavigationStack {
            List {
                VStack(alignment: .leading, spacing: 4) {
                    TabSearchField(prompt: "Search tabs", query: $query)
                    if isFiltering {
                        ViewThatFits(in: .horizontal) {
                            HStack(spacing: 8) { activeFilters }
                                .fixedSize(horizontal: true, vertical: false)
                            VStack(alignment: .leading, spacing: 4) { activeFilters }
                        }
                    }
                }
                if isSelecting && !eligible.isEmpty {
                    let allSelected = eligible.isSubset(of: selectedTabIDs)
                    let title = allSelected ? "Deselect All" : (isFiltering || hasQuery ? "Select Matches" : "Select All")
                    Button(title, systemImage: allSelected ? "circle" : "checkmark.circle") {
                        if allSelected { selectedTabIDs.subtract(eligible) }
                        else { selectedTabIDs.formUnion(eligible) }
                    }
                    .accessibilityHint("\(eligible.count) eligible tabs in this view")
                }
                if !isSelecting {
                    workspaceSwitcher
                }
                Section {
                    let pinned = visibleTabs.filter(\.isPinned), others = visibleTabs.filter { !$0.isPinned }
                    if layout == "grid" {
                        if !visibleTabs.isEmpty {
                            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                                ForEach(sortedTabs(pinned + others)) { card($0, eligible: eligible.contains($0.id), sameTitleIndex: sameTitleIndices[$0.id]) }
                            }
                            .padding(.vertical, 6)
                            .listRowInsets(EdgeInsets(top: 0, leading: 12, bottom: 0, trailing: 12))
                            .listRowBackground(Color.clear)
                        }
                    } else if canReorder {
                        ForEach(pinned) { row($0, eligible: eligible.contains($0.id), sameTitleIndex: sameTitleIndices[$0.id]) }.onMove { app.moveTabs(pinned.map(\.id), from: $0, to: $1) }
                        ForEach(others) { row($0, eligible: eligible.contains($0.id), sameTitleIndex: sameTitleIndices[$0.id]) }.onMove { app.moveTabs(others.map(\.id), from: $0, to: $1) }
                    } else {
                        ForEach(sortedTabs(pinned + others)) { row($0, eligible: eligible.contains($0.id), sameTitleIndex: sameTitleIndices[$0.id]) }
                    }
                    if visibleTabs.isEmpty && (isSelecting || otherMatches.isEmpty) {
                        emptyTabResults
                    }
                }
                if !isSelecting { WorkspaceTabResults(matches: otherMatches, onOpen: { dismiss() }) }
                // The overview opens to the tabs the user already has. Creation
                // and cleanup stay available after the working set.
                if !isSelecting, !hasQuery, !isFiltering {
                    workspaceActions
                    WorkspaceTabResults(title: "Recent Tabs", matches: Array(app.recentWorkspaceTabs.prefix(3)),
                                        onOpen: { dismiss() })
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: eligible) { _, eligible in selectedTabIDs.formIntersection(eligible) }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if isSelecting {
                    batchArchiveBar
                } else if let movedTabsNotice {
                    moveReceipt(movedTabsNotice)
                } else if let undoArchiveID, let group = app.archivedGroups.first(where: { $0.id == undoArchiveID }) {
                    archiveReceipt(group)
                }
            }
            .sheet(isPresented: $showTabCleanup) { TabCleanupView() }
            .navigationTitle("Tabs")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if isSelecting {
                        Button("Cancel", action: finishSelection)
                    } else {
                        HStack {
                            if layout == "list" && canReorder { EditButton() }
                            Button("Select") { isSelecting = true }
                                .disabled(eligible.isEmpty)
                        }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(layout == "grid" ? "Show as List" : "Show as Grid", systemImage: layout == "grid" ? "list.bullet" : "square.grid.2x2") {
                        withAnimation(.snappy) { layout = layout == "grid" ? "list" : "grid" }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Menu(spaceFilter.map { "Space: \($0.title)" } ?? "Space", systemImage: "square.stack") {
                            Picker("Tab Space", selection: $spaceFilter) {
                                Text("All Spaces").tag(nil as SpaceId?)
                                ForEach(SpaceId.allCases) { space in
                                    Text(space.title).tag(Optional(space))
                                }
                            }
                            .pickerStyle(.inline)
                        }
                        Menu(typeFilter.map { "Type: \(typeTitle($0))" } ?? "Tab Type", systemImage: "square.grid.2x2") {
                            Picker("Tab Type", selection: $typeFilter) {
                                Text("All Types").tag(nil as TabType?)
                                ForEach(TabType.allCases, id: \.self) { type in
                                    Text(typeTitle(type)).tag(Optional(type))
                                }
                            }
                            .pickerStyle(.inline)
                        }
                        Menu("Sort", systemImage: "arrow.up.arrow.down") {
                            Picker("Sort", selection: $tabSort) {
                                Text("Custom Order").tag("custom")
                                Text("Recently Used").tag("recent")
                            }
                            .pickerStyle(.inline)
                        }
                        Toggle("Repeated Titles", isOn: $repeatedTitlesOnly)
                        if isFiltering {
                            Button("Clear Filters", systemImage: "xmark", action: clearTabFilters)
                        }
                    } label: {
                        Label("Filter Tabs", systemImage: isFiltering ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease")
                    }
                    .accessibilityValue([spaceFilter?.title, typeFilter.map(typeTitle), repeatedTitlesOnly ? "Repeated Titles" : nil].compactMap { $0 }.joined(separator: ", "))
                }
                ToolbarItem(placement: .topBarTrailing) { if !isSelecting { Button("Done") { dismiss() } } }
            }
        }
    }

    private var batchArchiveBar: some View {
        let count = selectedTabIDs.count
        let destinations = app.tabMoveDestinations
        return HStack(spacing: 8) {
            Text("\(count) selected").font(.subheadline.weight(.medium))
                .foregroundStyle(.secondary)
            if !destinations.isEmpty {
                Menu {
                    ForEach(destinations) { workspace in
                        Button(workspace.moveMenuLabel) { moveSelection(to: workspace) }
                    }
                } label: {
                    Label("Move", systemImage: "square.stack")
                        .labelStyle(.iconOnly)
                        .frame(width: 44, height: 44)
                        .contentShape(.rect)
                }
                .menuIndicator(.hidden)
                .accessibilityLabel("Move selected tabs to a workspace")
                .disabled(count == 0)
            }
            Button("Archive", systemImage: "archivebox") {
                recordArchive(app.archiveInactiveTabs(Array(selectedTabIDs.intersection(selectableIDs))))
                finishSelection()
            }
            .buttonStyle(.borderedProminent)
            .disabled(count == 0)
        }
        .padding(6)
        .padding(.leading, 8)
        .glassEffectCompat(interactive: true)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 6)
        .accessibilityElement(children: .contain)
    }

    private func moveSelection(to workspace: WorkspaceItem) {
        let ids = Array(selectedTabIDs.intersection(selectableIDs))
        let count = app.moveInactiveTabs(ids, to: workspace, duplicatesOnly: false, keepingRecent: false)
        let message = count == 0 ? "No selected tabs were moved."
            : "Moved \(count) tab\(count == 1 ? "" : "s") to \(workspace.displayName)."
        movedTabsNotice = message
        AccessibilityNotification.Announcement(message).post()
        finishSelection()
    }

    private func moveReceipt(_ message: String) -> some View {
        HStack(spacing: 8) {
            Label(message, systemImage: "square.stack")
                .font(.subheadline.weight(.medium))
            Button("Dismiss move notice", systemImage: "xmark") { movedTabsNotice = nil }
                .labelStyle(.iconOnly)
                .buttonStyle(.borderless)
                .frame(minWidth: 44, minHeight: 44)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 2)
        .glassEffectCompat(interactive: true)
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 6)
    }

    private func recordArchive(_ group: ArchivedGroup?) {
        guard let group else { return }
        movedTabsNotice = nil
        undoArchiveID = group.id
        let count = group.tabs.count
        AccessibilityNotification.Announcement("\(count) tab\(count == 1 ? "" : "s") archived. Undo is available.").post()
    }

    private func archiveReceipt(_ group: ArchivedGroup) -> some View {
        let count = group.tabs.count
        let hasSource = app.canRestoreArchiveToSource(group.id)
        return HStack(spacing: 10) {
            Label("\(count) archived", systemImage: "archivebox")
                .font(.subheadline.weight(.medium))
            Button(hasSource ? "Undo" : "Restore Here") {
                app.restoreArchived(group.id, toSource: hasSource)
                if !app.archivedGroups.contains(where: { $0.id == group.id }) {
                    undoArchiveID = nil
                    AccessibilityNotification.Announcement("Tabs restored").post()
                }
            }
            .buttonStyle(.bordered)
            Button("Dismiss archive notice", systemImage: "xmark") { undoArchiveID = nil }
                .labelStyle(.iconOnly)
                .buttonStyle(.borderless)
                .frame(minWidth: 44, minHeight: 44)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 2)
        .glassEffectCompat(interactive: true)
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 6)
    }

    private func selectionMark(_ tab: BereanWorkspace.Tab) -> some View {
        Image(systemName: selectedTabIDs.contains(tab.id) ? "checkmark.circle.fill" : "circle")
            .font(.body)
            .foregroundStyle(selectedTabIDs.contains(tab.id) ? Color.accentColor : Color.secondary)
            .accessibilityHidden(true)
    }

    private var emptyTabResults: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(hasQuery || isFiltering ? "No matching tabs" : "No open tabs in this workspace.")
                .foregroundStyle(.secondary)
            if hasQuery || isFiltering {
                Button("Show All Tabs") {
                    query = ""
                    clearTabFilters()
                }
                .buttonStyle(.borderless)
                .frame(minHeight: 44)
            }
        }
    }

    private func clearTabFilters() {
        spaceFilter = nil
        typeFilter = nil
        repeatedTitlesOnly = false
    }

    private var workspaceSwitcher: some View {
        let workspace = app.currentWorkspace
        return Section {
            NavigationLink { SessionsPage(closeTabs: { dismiss() }) } label: {
                LabeledContent {
                    Text(workspace?.tabCountLabel ?? "")
                } label: {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(workspace?.displayName ?? app.session.name)
                                .fontWeight(.semibold)
                                .lineLimit(1)
                            if let workspace, workspace.displayName != workspace.name {
                                Text(workspace.name).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    } icon: {
                        Image(systemName: WorkspaceIcon.symbol(app.session.icon))
                    }
                }
            }
            .accessibilityHint("Switch, create or manage workspaces")
        }
    }

    private var workspaceActions: some View {
        Section {
            Button(action: onNewTab) { Label("New Tab", systemImage: "plus") }
            if !app.inactiveTabs.isEmpty {
                Button { showTabCleanup = true } label: { Label("Archive Inactive Tabs…", systemImage: "archivebox") }
            }
            if !app.archivedGroups.isEmpty {
                NavigationLink { ArchivedTabsPage(onOpen: { dismiss() }) } label: {
                    Label("Archived Tabs", systemImage: "archivebox").badge(app.archivedGroups.count)
                }
            }
        }
    }

    @ViewBuilder
    private var activeFilters: some View {
        if let spaceFilter {
            filterChip(spaceFilter.title, category: "Space") { self.spaceFilter = nil }
        }
        if let typeFilter {
            filterChip(typeTitle(typeFilter), category: "Type") { self.typeFilter = nil }
        }
        if repeatedTitlesOnly {
            filterChip("Repeated Titles", category: "Tabs") { repeatedTitlesOnly = false }
        }
    }

    private func filterChip(_ title: String, category: String, clear: @escaping () -> Void) -> some View {
        Button(action: clear) {
            HStack(spacing: 6) {
                Text(title).font(.subheadline.weight(.medium))
                Image(systemName: "xmark").font(.caption2.weight(.semibold))
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(.quaternary, in: .capsule)
            .frame(minHeight: 44)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Remove \(category) filter: \(title)")
    }

    func row(_ tab: BereanWorkspace.Tab, eligible: Bool, sameTitleIndex: Int? = nil) -> some View {
        Button { openOrSelect(tab, eligible: eligible) } label: {
            HStack {
                Image(systemName: tab.symbol).foregroundStyle(tab.tint).frame(width: 24)
                VStack(alignment: .leading, spacing: 1) {
                    Text(tab.navigationLabel).foregroundStyle(.primary)
                    let detail = sameTitleIndex.map { "\(tab.navigationDetail) · Tab \($0)" } ?? tab.navigationDetail
                    Text(detail).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if tab.isPinned { Image(systemName: "pin.fill").font(.caption).foregroundStyle(.secondary) }
                if isSelecting && eligible {
                    selectionMark(tab)
                } else if tab.id == app.activeTab?.id {
                    Image(systemName: "checkmark").foregroundStyle(.tint).accessibilityLabel("Current tab")
                }
            }
        }
        .disabled(isSelecting && !eligible)
        .accessibilityAddTraits(isSelecting && selectedTabIDs.contains(tab.id) ? .isSelected : [])
        .swipeActions(edge: .trailing) {
            if !isSelecting {
                Button("Close", role: .destructive) { app.close(tab.id) }
                Button("Archive") { recordArchive(app.archive([tab.id])) }.tint(.indigo)
            }
        }
        .swipeActions(edge: .leading) {
            if !isSelecting { Button(tab.isPinned ? "Unpin" : "Pin") { app.togglePin(tab.id) }.tint(.orange) }
        }
        .contextMenu { if !isSelecting { tabMenu(tab) } }
    }

    private func sortedTabs(_ tabs: [BereanWorkspace.Tab]) -> [BereanWorkspace.Tab] {
        guard tabSort == "recent" else { return tabs }
        let rank = Dictionary((([app.activeTab?.id].compactMap { $0 }) + app.recentTabIDs).enumerated().map { ($1, $0) },
                              uniquingKeysWith: { first, _ in first })
        return tabs.enumerated().sorted { a, b in
            (rank[a.element.id] ?? Int.max, a.offset) < (rank[b.element.id] ?? Int.max, b.offset)
        }.map(\.element)
    }

    /// A tab as a card: tinted header with its kind, title and detail, × to close; the current tab is outlined.
    func card(_ tab: BereanWorkspace.Tab, eligible: Bool, sameTitleIndex: Int? = nil) -> some View {
        let current = isSelecting ? selectedTabIDs.contains(tab.id) : tab.id == app.activeTab?.id
        return Button { openOrSelect(tab, eligible: eligible) } label: {
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 6) {
                    Image(systemName: tab.symbol).font(.caption.weight(.semibold))
                    Text(tab.tabType == .bible ? "Scripture" : (tab.tabType?.rawValue ?? tab.type).capitalized).font(.caption.weight(.semibold))
                    Spacer(minLength: 0)
                    if tab.isPinned { Image(systemName: "pin.fill").font(.caption2) }
                }
                .foregroundStyle(tab.tint)
                .padding(.horizontal, 10).padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(tab.tint.opacity(0.14))
                VStack(alignment: .leading, spacing: 4) {
                    Text(tab.navigationLabel).font(.subheadline.weight(.semibold)).foregroundStyle(.primary)
                        .lineLimit(2).multilineTextAlignment(.leading)
                    let kind = tab.tabType == .bible ? "Scripture" : (tab.tabType?.rawValue ?? tab.type).capitalized
                    let detail = tab.navigationDetail.replacingOccurrences(of: "Scripture · ", with: "")
                    if !detail.isEmpty, detail != kind, detail != tab.spaceId.title, detail != tab.navigationLabel {
                        Text(detail).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    }
                    if let sameTitleIndex {
                        Text("Tab \(sameTitleIndex)").font(.caption).foregroundStyle(.secondary)
                    }
                    TabCardPreview(tab: tab)
                    Spacer(minLength: 0)
                }
                .padding(10)
                .frame(maxWidth: .infinity, minHeight: 112, alignment: .topLeading)
            }
            .background(Color(uiColor: .secondarySystemGroupedBackground), in: .rect(cornerRadius: 16))
            .overlay {
                RoundedRectangle(cornerRadius: 16).strokeBorder(current ? Color.accentColor : Color.secondary.opacity(0.18), lineWidth: current ? 2.5 : 1)
            }
            .contentShape(.rect(cornerRadius: 16))
        }
        .buttonStyle(.interactivePlain)
        .disabled(isSelecting && !eligible)
        .overlay(alignment: .topTrailing) {
            if isSelecting {
                if eligible {
                    selectionMark(tab).padding(8).allowsHitTesting(false)
                }
            } else {
                Button {
                    if UserLibrary.defaults.object(forKey: "berean.haptics.enabled") as? Bool ?? true {
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    }
                    withAnimation(.snappy) { app.close(tab.id) }
                } label: {
                    Image(systemName: "xmark").font(.caption2.weight(.bold)).foregroundStyle(.secondary)
                        .frame(width: 24, height: 24).background(.thinMaterial, in: .circle)
                        .frame(width: 44, height: 44).contentShape(.rect)
                }
                .buttonStyle(.interactivePlain)
                .offset(x: 8, y: -8)
                .accessibilityLabel("Close \(tab.navigationLabel)")
            }
        }
        .contextMenu { if !isSelecting { tabMenu(tab) } }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(current ? .isSelected : [])
    }

    @ViewBuilder func tabMenu(_ tab: BereanWorkspace.Tab) -> some View {
            Button("Duplicate Tab", systemImage: "plus.square.on.square") { app.duplicate(tab.id) }
            Button(tab.isPinned ? "Unpin Tab" : "Pin Tab", systemImage: "pin") { app.togglePin(tab.id) }
            let destinations = app.tabMoveDestinations
            if !destinations.isEmpty {
                Menu("Move to Workspace", systemImage: "square.stack") {
                    ForEach(destinations) { workspace in
                        Button(workspace.moveMenuLabel) { app.moveTab(tab.id, to: workspace) }
                    }
                }
            }
            Button("Archive Tab", systemImage: "archivebox") { recordArchive(app.archive([tab.id])) }
            Button("Close Other Tabs", systemImage: "xmark.square") { app.closeOthers(tab.id) }
            Button("Close Tab", systemImage: "xmark", role: .destructive) { app.close(tab.id) }
    }
}

/// Workspaces (ADR-0011): one list — live workspaces, then saved ones not open — with switch, new, rename, duplicate,
/// delete; "Save Snapshot" is a secondary action on the current workspace.
private struct WorkspaceTabResults: View {
    @Environment(AppModel.self) private var app
    var title = "Open Tabs in Other Workspaces"
    let matches: [AppModel.WorkspaceTabMatch]
    let onOpen: () -> Void

    var body: some View {
        if !matches.isEmpty {
            Section(title) {
                ForEach(matches) { match in
                    Button {
                        app.openWorkspaceTab(match)
                        onOpen()
                    } label: {
                        Label {
                            VStack(alignment: .leading) {
                                Text(match.tab.navigationLabel)
                                Text(match.searchDetail)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        } icon: {
                            Image(systemName: match.tab.symbol).foregroundStyle(match.tab.tint)
                        }
                    }
                }
            }
        }
    }
}

struct SessionsPage: View {
    @Environment(AppModel.self) private var app
    let closeTabs: () -> Void
    @State private var renaming: WorkspaceItem?
    @State private var deleting: WorkspaceItem?
    @State private var name = ""
    @State private var saving = false
    @State private var query = ""
    @State private var browsingWorkspace: WorkspaceItem?

    var body: some View {
        let search = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let matches = app.workspaceItems.filter { $0.matches(search) }
        // Keep the current workspace visible when browsing a long list.
        let workspaces = search.isEmpty
            ? matches.filter(app.isCurrent) + matches.filter { !app.isCurrent($0) }
            : matches
        let tabs = app.matchingWorkspaceTabs(search)
        let submit = AppModel.workspaceSearchSubmission(query: search, workspaces: workspaces, tabs: tabs)
        return List {
            TabSearchField(prompt: "Workspace, passage, or tab title", query: $query)
                .onSubmit {
                    switch submit {
                    case .workspace(let workspace): app.open(workspace)
                    case .tab(let tab): app.openWorkspaceTab(tab)
                    case .chooseWorkspace, .chooseTab, .noMatch: return
                    }
                    closeTabs()
                }
            switch submit {
            case .chooseWorkspace:
                Text("Choose a workspace below.").font(.caption).foregroundStyle(.secondary)
            case .chooseTab:
                Text("Choose a tab below.").font(.caption).foregroundStyle(.secondary)
            default:
                EmptyView()
            }
            if workspaces.isEmpty && tabs.isEmpty && !search.isEmpty {
                ContentUnavailableView.search(text: search)
            }
            if search.isEmpty || !workspaces.isEmpty {
                Section {
                    ForEach(workspaces) { w in
                        Button { app.open(w); closeTabs() } label: {
                            HStack {
                                Image(systemName: w.icon.map { WorkspaceIcon.symbol($0) } ?? (w.isSaved ? "square.stack.3d.up" : "square.stack")).foregroundStyle(.secondary).frame(width: 24)
                                VStack(alignment: .leading) {
                                    Text(w.displayName).font(.body.weight(.medium)).foregroundStyle(.primary)
                                    Text(w.displayDetail)
                                        .font(.caption).foregroundStyle(.secondary)
                                    ForEach(w.previewLabels(matching: query).filter { $0 != w.displayName }, id: \.self) { preview in
                                        Text(preview).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                                    }
                                }
                                Spacer()
                                if app.isCurrent(w) { Image(systemName: "checkmark").foregroundStyle(.tint).accessibilityLabel("Current workspace") }
                            }
                            .frame(minHeight: 44)
                            .contentShape(.rect)
                        }
                        .buttonStyle(.interactivePlain)
                        .accessibilityAddTraits(app.isCurrent(w) ? .isSelected : [])
                        .swipeActions(edge: .leading, allowsFullSwipe: false) {
                            if !w.isSaved {
                                Button("Browse Tabs", systemImage: "rectangle.on.rectangle") { browsingWorkspace = w }
                                    .tint(.indigo)
                            }
                        }
                        .swipeActions { if app.canDelete(w) { Button("Delete", role: .destructive) { deleting = w } } }
                        .contextMenu {
                            if !w.isSaved {
                                Button("Browse Tabs", systemImage: "rectangle.on.rectangle") { browsingWorkspace = w }
                            }
                            Button("Rename…", systemImage: "pencil") { name = w.name; renaming = w }
                            Button("Duplicate", systemImage: "plus.square.on.square") { app.duplicate(w) }
                            if app.isCurrent(w) {
                                Button("Save Snapshot…", systemImage: "square.and.arrow.down.on.square") { name = w.name; saving = true }
                                Button("Archive All Tabs", systemImage: "archivebox") { app.archiveAllTabs() }
                                Menu("Icon", systemImage: WorkspaceIcon.symbol(w.icon)) {
                                    ForEach(WorkspaceIcon.all, id: \.name) { icon in
                                        Button(WorkspaceIcon.label(icon.name), systemImage: icon.symbol) { app.setSessionIcon(app.currentSessionId, icon.name) }
                                    }
                                    Button("Default") { app.setSessionIcon(app.currentSessionId, nil) }
                                }
                            }
                            if app.canDelete(w) { Button("Delete…", systemImage: "trash", role: .destructive) { deleting = w } }
                        }
                    }
                } header: {
                    if !search.isEmpty { Text("Workspaces") }
                } footer: {
                    if search.isEmpty { Text("Touch and hold a workspace for more actions.") }
                }
            }
            WorkspaceTabResults(title: "Open Tabs", matches: tabs, onOpen: closeTabs)
        }
        .navigationTitle("Workspaces")
        .navigationDestination(item: $browsingWorkspace) { workspace in
            WorkspaceTabsPage(workspace: workspace, onOpen: closeTabs)
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("New Workspace", systemImage: "plus") {
                    app.newWorkspace()
                    closeTabs()
                }
            }
        }
        .scrollDismissesKeyboard(.interactively)
        .alert("Rename Workspace", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: $name)
            Button("Rename") { if let r = renaming { app.rename(r, to: name) }; renaming = nil }
            Button("Cancel", role: .cancel) { renaming = nil }
        }
        .alert("Save a Snapshot", isPresented: $saving) {
            TextField("Name", text: $name)
            Button("Save") { app.saveWorkspace(named: name) }
            Button("Cancel", role: .cancel) {}
        } message: { Text("Keeps a frozen copy of these tabs that you can reopen later.") }
        .confirmationDialog("Delete “\(deleting?.name ?? "")”?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }), titleVisibility: .visible) {
            Button("Delete Workspace", role: .destructive) { if let d = deleting { app.delete(d) }; deleting = nil }
        } message: { Text("Its tabs are closed. This cannot be undone.") }
    }
}

/// Browse archived tabs and restore a group or an individual tab.
struct ArchivedTabsPage: View {
    @Environment(AppModel.self) private var app
    let onOpen: () -> Void
    @State private var query = ""

    private var searchTerms: [Substring] { query.replacingOccurrences(of: "–", with: "-").split(whereSeparator: \.isWhitespace) }

    private func matches(_ tab: BereanWorkspace.Tab, title: String) -> Bool {
        let text = "\(tab.navigationSearchText) \(title)"
        return searchTerms.allSatisfy { text.localizedStandardContains(String($0)) }
    }

    var body: some View {
        let titles = app.archiveTitles()
        let searchTitles = app.archiveTitles(includeAliases: true)
        let sourceNames = app.archiveSourceNames()
        let destinations = app.tabMoveDestinations
        List {
            if !app.archivedGroups.isEmpty {
                TabSearchField(prompt: "Search archived tabs", query: $query)
            }
            ForEach(app.archivedGroups) { group in
                let tabs = app.archivedTabs(group)
                let title = titles[group.id] ?? group.label
                let matches = tabs.filter { self.matches($0, title: searchTitles[group.id] ?? title) }
                if !matches.isEmpty || (tabs.isEmpty && searchTerms.isEmpty) {
                    Section(title) {
                        ForEach(matches) { tab in
                            Button {
                                app.restoreArchivedTab(tab.id, from: group.id)
                                onOpen()
                            } label: {
                                Label {
                                    VStack(alignment: .leading) {
                                        Text(tab.navigationLabel)
                                        Text(tab.navigationDetail).font(.caption).foregroundStyle(.secondary)
                                    }
                                } icon: {
                                    Image(systemName: tab.symbol).foregroundStyle(tab.tint)
                                }
                                .accessibilityHint("Restore and open this tab")
                            }
                            .contextMenu {
                                Button("Restore and Open Here", systemImage: "archivebox") {
                                    app.restoreArchivedTab(tab.id, from: group.id)
                                    onOpen()
                                }
                                if let source = sourceNames[group.id] {
                                    Button("Restore and Open in \(source)", systemImage: "square.stack") {
                                        app.restoreArchivedTab(tab.id, from: group.id, toSource: true)
                                        onOpen()
                                    }
                                }
                            }
                            .swipeActions(allowsFullSwipe: false) {
                                if let source = sourceNames[group.id] {
                                    Button("Restore to \(source)", systemImage: "square.stack") {
                                        app.restoreArchived(group.id, toSource: true, only: tab.id)
                                    }
                                    .tint(.indigo)
                                }
                            }
                        }
                        if searchTerms.isEmpty {
                            Menu("Group Actions", systemImage: "ellipsis.circle") {
                                if !tabs.isEmpty, let source = sourceNames[group.id] {
                                    Button("Restore to \(source)", systemImage: "square.stack") {
                                        app.restoreArchived(group.id, toSource: true)
                                    }
                                }
                                if tabs.count > 1 {
                                    Button("Restore All \(tabs.count) Tabs", systemImage: "archivebox") {
                                        app.restoreArchived(group.id)
                                    }
                                }
                                if !tabs.isEmpty && !destinations.isEmpty {
                                    Menu("Restore All to Workspace", systemImage: "square.stack") {
                                        ForEach(destinations) { workspace in
                                            Button(workspace.moveMenuLabel) { app.restoreArchived(group.id, to: workspace) }
                                        }
                                    }
                                }
                                Button("Remove from Archive", systemImage: "trash", role: .destructive) {
                                    app.dismissArchived(group.id)
                                }
                            }
                        }
                    }
                }
            }
            if app.archivedGroups.isEmpty {
                ContentUnavailableView("No Archived Tabs", systemImage: "archivebox")
            } else if !searchTerms.isEmpty && !app.archivedGroups.contains(where: { group in
                app.archivedTabs(group).contains { matches($0, title: searchTitles[group.id] ?? group.label) }
             }) {
                ContentUnavailableView.search(text: query)
            }
        }
        .navigationTitle("Archived Tabs")
        .scrollDismissesKeyboard(.interactively)
    }
}


/// A few words of what the tab shows (first verse of a Scripture tab, opening of a note) — original TabPreview.
private struct TabCardPreview: View {
    @Environment(AppModel.self) private var app
    let tab: BereanWorkspace.Tab
    @State private var text = ""

    var body: some View {
        Text(text).font(.caption).foregroundStyle(.secondary).lineLimit(3).multilineTextAlignment(.leading)
            .task(id: tab.id + tab.title + (tab.tabType == .note ? "|\(app.notesRevision)" : "")) {
                switch tab.tabType {
                case .bible:
                    let st = BibleState(tab.state)
                    if let row = await app.bible.queryVerse(st.bookId, st.chapter, st.verse ?? 1, textId: st.translation) {
                        text = VerseDisplay.text(row.text, tagged: row.textTagged, textId: st.translation,
                                                 replacerEnabled: app.wordReplacerEnabled, rules: app.wordReplacerRules)
                    }
                case .note:
                    if let id = tab.state["noteId"]?.stringValue?.string, let note = try? app.notes?.one(id) {
                        text = noteExcerptText(note.content).replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespaces)
                    }
                default: text = ""
                }
            }
    }
}
