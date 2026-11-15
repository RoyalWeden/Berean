import SwiftUI
import BereanCore
import BereanWorkspace
import BereanReference
import BereanText

/// The native iPhone shell, following the existing iPhone navigation (docs/mobile/mobile-navigation.md):
/// bottom-left tabs, bottom-centre Go (reference / Strong's / search), bottom-right More with the
/// current tab's commands. Content views are shared with the Mac app.
struct IOSRootView: View {
    @Environment(AppModel.self) private var app
    @State private var showTabs = false
    @State private var showGo = false
    @State private var explicitNewTab = false
    @State private var showSettings = false
    @State private var keyboardUp = false
    @State private var showScriptureDisplay = false
    @State private var chapterTagTarget: ChapterTagTarget?
    @State private var findRequest = 0
    @State private var pendingNewTab = false
    @State private var alternateEdition: ChapterEdition?
    @State private var availableEdition: ChapterEdition?

    private var readerEdition: ChapterEdition? {
        guard let tab = app.activeTab, tab.tabType == .bible else { return nil }
        let state = BibleState(tab.state)
        return state.compareMode ? nil : ChapterEdition(state)
    }

    var body: some View {
        @Bindable var app = app
        NavigationStack {
            content
                .safeAreaInset(edge: .bottom, spacing: 0) { if !keyboardUp { bottomBar } }
                // The dock steps aside while typing (the note editor's format bar docks above the keyboard).
                .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillChangeFrameNotification)) { note in
                    // Covers the software keyboard and the accessory-only bar shown with a hardware keyboard.
                    guard let end = (note.userInfo?[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue else { return }
                    let screen = (note.object as? UIScreen)?.bounds ?? UIScreen.main.bounds
                    let up = end.minY < screen.maxY - 1 && end.height > 0
                    if up != keyboardUp { withAnimation(.snappy(duration: 0.2)) { keyboardUp = up } }
                }
                .onReceive(NotificationCenter.default.publisher(for: .bereanNoteEditing)) { note in
                    let up = note.object as? Bool ?? false
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
            .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $showGo) { GoSheet(newTab: explicitNewTab, close: { showGo = false }).presentationDetents([.large]) }
        .alert(app.userMessage ?? "", isPresented: Binding(get: { app.userMessage != nil }, set: { if !$0 { app.userMessage = nil } })) { Button("OK") {} }
    }

    private func openGo(newTab: Bool = false) {
        explicitNewTab = newTab
        showGo = true
    }

    private var bottomBar: some View {
        HStack(spacing: 8) {
            Button { showTabs = true } label: { bottomItem(symbol: "square.on.square", badge: app.tabCount(app.currentSessionId)) }
                .accessibilityLabel("Tabs and workspaces, \(app.tabCount(app.currentSessionId)) open")
            Button { openGo() } label: { bottomItem(symbol: "magnifyingglass", prominent: true) }
                .accessibilityLabel("Go to a passage or search")
            menu
        }
        .buttonStyle(.interactivePlain)
        .padding(.horizontal, 12)
        .padding(.vertical, 3)
        .glassEffectCompat(interactive: true)
        .frame(maxWidth: 260)
        .padding(.horizontal, 14)
        .padding(.vertical, 4)
        // Swipe across the dock to move to the neighbouring tab (original BottomNav: >60 pt, mostly horizontal).
        .simultaneousGesture(
            DragGesture(minimumDistance: 24).onEnded { value in
                let dx = value.translation.width, dy = value.translation.height
                guard abs(dx) > 60, abs(dx) > abs(dy) * 1.5 else { return }
                if withAnimation(.snappy, { app.stepTab(dx < 0 ? 1 : -1) }),
                   UserDefaults.standard.object(forKey: "berean.haptics.enabled") as? Bool ?? true {
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                }
            }
        )
        .offset(y: app.readerChromeHidden ? 110 : 0)
        .opacity(app.readerChromeHidden ? 0 : 1)
        .allowsHitTesting(!app.readerChromeHidden)
        .frame(maxWidth: .infinity)
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
        .frame(maxWidth: .infinity, minHeight: 44)
        .contentShape(.rect)
    }

    @ViewBuilder var content: some View {
        if let tab = app.activeTab {
            switch tab.tabType {
            case .bible:
                let st = BibleState(tab.state)
                ScriptureView(tabId: tab.id, findRequest: findRequest).id(tab.id)
                    .inspector(isPresented: Binding(get: { st.rightPanelOpen }, set: { v in
                        app.update(tab.id) { t in var s = BibleState(t.state); s.rightPanelOpen = v; t.state = s.merged(into: t.state) }
                    })) { StudyInspector(tabId: tab.id).presentationDetents([.medium, .large]) }
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
                ContentUnavailableView(tab.title, systemImage: "square.dashed", description: Text("This kind of tab arrives in a later native build."))
            }
        } else {
            ContentUnavailableView {
                Label("No tab open", systemImage: "book")
            } description: { Text("Open a passage, a note or a search.") } actions: {
                Button("Go…") { openGo() }.buttonStyle(.borderedProminent)
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
                                app.switchChapterEdition(in: tab.id, from: source, to: target)
                            }
                        }
                    }
                    let selected = app.readerSelectedVerses(in: tab.id, state: st)
                    Button {
                        app.focusStudyVerse(selected.first ?? st.verse, in: tab.id, selectedVerses: selected)
                        mutate(tab.id) { $0.rightPanelOpen = true; $0.rightPanelTab = "crossrefs" }
                    } label: {
                        Label("Cross References", systemImage: "arrow.triangle.branch")
                    }
                    Button("Notes for This Chapter", systemImage: "note.text") {
                        app.focusStudyVerse(nil, in: tab.id)
                        mutate(tab.id) { $0.rightPanelOpen = true; $0.rightPanelTab = "notes" }
                    }
                    Button("Tag Chapter…", systemImage: "tag") { chapterTagTarget = ChapterTagTarget(st) }
                        .disabled(!hasText)
                    Toggle(isOn: Binding(get: { st.showStrongs }, set: { v in mutate(tab.id) { $0.showStrongs = v } })) { Label("Strong's Numbers", systemImage: "number") }
                    Toggle(isOn: Binding(get: { st.compareMode }, set: { v in mutate(tab.id) { $0.compareMode = v } })) { Label("Compare Texts", systemImage: "rectangle.split.2x1") }
                    Button("Scripture Display…", systemImage: "textformat.size") { showScriptureDisplay = true }
                    Menu("Chapter Export", systemImage: "square.and.arrow.up") { ChapterExportActions(state: st, tabId: tab.id, hasText: hasText) }
                }
            }
            if let tab = app.activeTab {
                Section {
                    Menu {
                        ForEach(AppModel.TabKind.allCases, id: \.self) { kind in
                            Button(kind.rawValue) { app.switchTab(tab.id, to: kind) }
                        }
                    } label: { Label("Change Tab To", systemImage: "arrow.triangle.swap") }
                    Button { app.duplicate(tab.id) } label: { Label("Duplicate Tab", systemImage: "plus.square.on.square") }
                    Button(role: .destructive) { app.close(tab.id) } label: { Label("Close Tab", systemImage: "xmark") }
                }
            }
            Section {
                Button("Study Trail", systemImage: "point.topleft.down.to.point.bottomright.curvepath") { app.showStudyTrail = true }
                Button { app.openCalendar() } label: { Label("Calendar", systemImage: "calendar") }
                Button { showSettings = true } label: { Label("Settings", systemImage: "gearshape") }
            }
        } label: { bottomItem(symbol: "ellipsis").hoverEffect(.highlight) }
        .accessibilityLabel("More: commands for this tab")
    }

    func mutate(_ id: String, _ f: (inout BibleState) -> Void) {
        app.update(id) { t in var s = BibleState(t.state); f(&s); t.state = s.merged(into: t.state); t.title = Reference.readerChapterLabel(s.bookId, s.chapter, textId: s.translation) }
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

    @State private var spaceFilter: SpaceId?
    @State private var typeFilter: TabType?
    /// "grid" shows Safari-style tab cards (original TabCardsSheet grid); "list" keeps the compact rows. Device-local.
    @AppStorage("tabCardsLayout") private var layout = "grid"
    /// "custom" = workspace order (drag in list mode); "recent" = most recently used first (original Recent/Custom sort).
    @AppStorage("tabCardsSort") private var tabSort = "custom"

    private var isFiltering: Bool { spaceFilter != nil || typeFilter != nil }
    private var hasQuery: Bool { !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private var canReorder: Bool { tabSort != "recent" && !isFiltering && !hasQuery }

    private func typeTitle(_ type: TabType) -> String {
        type == .bible ? "Scripture" : type.rawValue.capitalized
    }

    private func matchesFilters(_ tab: BereanWorkspace.Tab) -> Bool {
        (spaceFilter == nil || tab.spaceId == spaceFilter)
            && (typeFilter == nil || tab.tabType == typeFilter)
    }

    var shown: [BereanWorkspace.Tab] {
        app.matchingOpenTabs(query, space: spaceFilter).filter(matchesFilters)
    }

    var body: some View {
        NavigationStack {
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
                if !hasQuery, !isFiltering {
                    workspaceActions
                    WorkspaceTabResults(title: "Recent Tabs", matches: Array(app.recentWorkspaceTabs.prefix(3)),
                                        onOpen: { dismiss() })
                }
                let otherMatches = app.matchingWorkspaceTabs(query).filter {
                    $0.workspaceID != app.currentSessionId && matchesFilters($0.tab)
                }
                Section {
                    let pinned = shown.filter(\.isPinned), others = shown.filter { !$0.isPinned }
                    if layout == "grid" {
                        if !shown.isEmpty {
                            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                                ForEach(sortedTabs(pinned + others)) { card($0) }
                            }
                            .padding(.vertical, 6)
                            .listRowInsets(EdgeInsets(top: 0, leading: 12, bottom: 0, trailing: 12))
                            .listRowBackground(Color.clear)
                        }
                    } else if canReorder {
                        ForEach(pinned) { row($0) }.onMove { app.moveTabs(pinned.map(\.id), from: $0, to: $1) }
                        ForEach(others) { row($0) }.onMove { app.moveTabs(others.map(\.id), from: $0, to: $1) }
                    } else {
                        ForEach(sortedTabs(pinned + others)) { row($0) }
                    }
                    if shown.isEmpty && otherMatches.isEmpty { Text(!hasQuery && !isFiltering ? "No open tabs in this workspace." : "No tabs match the current filters.").foregroundStyle(.secondary) }
                }
                WorkspaceTabResults(matches: otherMatches, onOpen: { dismiss() })
            }
            .scrollDismissesKeyboard(.interactively)
            .sheet(isPresented: $showTabCleanup) { TabCleanupView() }
            .navigationTitle("Tabs")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    if layout == "list" && canReorder { EditButton() }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button(layout == "grid" ? "Show as List" : "Show as Grid", systemImage: layout == "grid" ? "list.bullet" : "square.grid.2x2") {
                        withAnimation(.snappy) { layout = layout == "grid" ? "list" : "grid" }
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Picker("Tab Space", selection: $spaceFilter) {
                            Text("All Spaces").tag(nil as SpaceId?)
                            ForEach(SpaceId.allCases) { space in
                                Text(space.title).tag(Optional(space))
                            }
                        }
                        Picker("Tab Type", selection: $typeFilter) {
                            Text("All Types").tag(nil as TabType?)
                            ForEach(TabType.allCases, id: \.self) { type in
                                Text(typeTitle(type)).tag(Optional(type))
                            }
                        }
                        Picker("Sort", selection: $tabSort) {
                            Text("Custom Order").tag("custom")
                            Text("Recently Used").tag("recent")
                        }
                        if isFiltering {
                            Button("Clear Filters", systemImage: "xmark") {
                                spaceFilter = nil
                                typeFilter = nil
                            }
                        }
                    } label: {
                        Label("Filter Tabs", systemImage: isFiltering ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease")
                    }
                    .accessibilityValue([spaceFilter?.title, typeFilter.map(typeTitle)].compactMap { $0 }.joined(separator: ", "))
                }
                ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } }
            }
        }
    }

    @ViewBuilder
    private var workspaceActions: some View {
        Section {
            NavigationLink { SessionsPage(closeTabs: { dismiss() }) } label: {
                LabeledContent {
                    Text("\(app.tabCount(app.currentSessionId)) tab\(app.tabCount(app.currentSessionId) == 1 ? "" : "s")")
                } label: {
                    Label(app.session.name, systemImage: WorkspaceIcon.symbol(app.session.icon)).fontWeight(.semibold)
                }
            }
            .accessibilityHint("Switch, create or manage workspaces")
        }
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

    func row(_ tab: BereanWorkspace.Tab) -> some View {
        Button { app.select(tab.id, in: tab.spaceId); dismiss() } label: {
            HStack {
                Image(systemName: tab.symbol).foregroundStyle(tab.tint).frame(width: 24)
                VStack(alignment: .leading, spacing: 1) {
                    Text(tab.navigationLabel).foregroundStyle(.primary)
                    Text(tab.navigationDetail).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                if tab.isPinned { Image(systemName: "pin.fill").font(.caption).foregroundStyle(.secondary) }
                if tab.id == app.activeTab?.id { Image(systemName: "checkmark").foregroundStyle(.tint).accessibilityLabel("Current tab") }
            }
        }
        .swipeActions(edge: .trailing) {
            Button("Close", role: .destructive) { app.close(tab.id) }
            Button("Archive") { app.archive([tab.id]) }.tint(.indigo)
        }
        .swipeActions(edge: .leading) { Button(tab.isPinned ? "Unpin" : "Pin") { app.togglePin(tab.id) }.tint(.orange) }
        .contextMenu { tabMenu(tab) }
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
    func card(_ tab: BereanWorkspace.Tab) -> some View {
        let current = tab.id == app.activeTab?.id
        return Button { app.select(tab.id, in: tab.spaceId); dismiss() } label: {
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
        .overlay(alignment: .topTrailing) {
            Button {
                if UserDefaults.standard.object(forKey: "berean.haptics.enabled") as? Bool ?? true {
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
        .contextMenu { tabMenu(tab) }
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
                        Button(workspace.menuLabel) { app.moveTab(tab.id, to: workspace) }
                    }
                }
            }
            Button("Archive Tab", systemImage: "archivebox") { app.archive([tab.id]) }
            Button("Close Other Tabs", systemImage: "xmark.square") { app.closeOthers(tab.id) }
            Button("Close Tab", systemImage: "xmark", role: .destructive) { app.close(tab.id) }
    }
}

private struct TabSearchField: View {
    let prompt: String
    @Binding var query: String

    var body: some View {
        Section {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                    .accessibilityHidden(true)
                TextField(prompt, text: $query)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                if !query.isEmpty {
                    Button {
                        query = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.interactivePlain)
                    .accessibilityLabel("Clear search")
                }
            }
        }
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
                                Text(match.workspaceName + " · " + match.tab.navigationDetail)
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

    var body: some View {
        let search = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let workspaces = app.workspaceItems.filter { $0.matches(search) }
        let tabs = app.matchingWorkspaceTabs(search)
        return List {
            TabSearchField(prompt: "Workspace, passage, or tab title", query: $query)
                .onSubmit {
                    guard !search.isEmpty else { return }
                    if let exact = workspaces.first(where: { $0.name.localizedStandardCompare(search) == .orderedSame }) {
                        app.open(exact)
                    } else if let tab = tabs.first {
                        app.openWorkspaceTab(tab)
                    } else if let workspace = workspaces.first {
                        app.open(workspace)
                    } else {
                        return
                    }
                    closeTabs()
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
                                    ForEach(w.previewLabels(matching: query).filter { $0 != w.displayName }, id: \.self) { preview in
                                        Text(preview).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
                                    }
                                    Text(w.displayDetail)
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                if app.isCurrent(w) { Image(systemName: "checkmark").foregroundStyle(.tint).accessibilityLabel("Current workspace") }
                            }
                        }
                        .swipeActions { if app.canDelete(w) { Button("Delete", role: .destructive) { deleting = w } } }
                        .contextMenu {
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
                    if search.isEmpty {
                        Button { app.newWorkspace(); closeTabs() } label: { Label("New Workspace", systemImage: "plus") }
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
        let sourceNames = app.archiveSourceNames()
        List {
            if !app.archivedGroups.isEmpty {
                TabSearchField(prompt: "Search archived tabs", query: $query)
            }
            ForEach(app.archivedGroups) { group in
                let tabs = app.archivedTabs(group)
                let title = titles[group.id] ?? group.label
                let matches = tabs.filter { self.matches($0, title: title) }
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
                            .swipeActions {
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
                app.archivedTabs(group).contains { matches($0, title: titles[group.id] ?? group.label) }
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
            .task(id: tab.id + tab.title) {
                switch tab.tabType {
                case .bible:
                    let st = BibleState(tab.state)
                    if let row = await app.bible.queryVerse(st.bookId, st.chapter, st.verse ?? 1, textId: st.translation) {
                        text = VerseDisplay.text(row.text, tagged: row.textTagged, textId: st.translation,
                                                 replacerEnabled: app.wordReplacerEnabled, rules: WordReplacer.defaultRules)
                    }
                case .note:
                    if let id = tab.state["noteId"]?.stringValue?.string, let note = try? app.notes?.one(id) {
                        text = note.content.replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespaces)
                    }
                default: text = ""
                }
            }
    }
}
