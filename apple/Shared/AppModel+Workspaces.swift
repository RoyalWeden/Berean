import Foundation
import BereanCore
import BereanNotes
import BereanWorkspace

/// One user-facing "Workspace" (ADR-0011). Storage is unchanged: a live workspace is a `sessions` row (with its
/// tabs); a saved workspace that is not open is a `workspaces` row (a frozen snapshot). Opening a saved one creates
/// its session `ws:<id>`, after which only the live entry is listed (no duplicates).
struct WorkspaceItem: Identifiable, Hashable {
    enum Kind: Hashable { case live(String), saved(String) }
    var kind: Kind
    var name: String
    var tabCount: Int
    var icon: String?
    var tabTitles: [String]
    var matchingNameLabel: String? = nil
    var distinguishingTab: String? = nil
    var tabCountLabel: String { "\(tabCount) tab\(tabCount == 1 ? "" : "s")" }

    /// A passage label makes automatically numbered live workspaces easier to recognize.
    /// The stored name remains available for management and matching legacy names.
    var displayName: String {
        guard !isSaved, hasGeneratedName else { return name }
        return tabTitles.first { !$0.isEmpty } ?? name
    }

    private var hasGeneratedName: Bool {
        for prefix in ["Session ", "Workspace "] where name.hasPrefix(prefix) {
            let suffix = name.dropFirst(prefix.count)
            return !suffix.isEmpty && suffix.utf8.allSatisfy { (48...57).contains($0) }
        }
        return false
    }

    var displayDetail: String {
        let count = isSaved ? "Saved · \(tabCountLabel)" : tabCountLabel
        return [displayName == name ? nil : name, count, matchingNameLabel]
            .compactMap { $0 }.joined(separator: " · ")
    }

    var tabDestinationName: String {
        [displayName, displayName == name ? nil : name, matchingNameLabel]
            .compactMap { $0 }.joined(separator: " · ")
    }

    var menuLabel: String {
        guard displayName == name else {
            return [displayName, distinguishingTab, name, matchingNameLabel].compactMap { $0 }.joined(separator: " · ")
        }
        return [name, preview ?? tabCountLabel, matchingNameLabel].compactMap { $0 }.joined(separator: " · ")
    }

    var moveMenuLabel: String {
        let otherTab = previewLabels().first { $0 != displayName && $0 != name }
        let storedName = displayName == name ? nil : name
        return ([displayName] + [otherTab, storedName, tabCountLabel, matchingNameLabel].compactMap { $0 })
            .joined(separator: " · ")
    }

    static func distinguishingMatchingNames(_ items: [WorkspaceItem]) -> [WorkspaceItem] {
        func key(_ label: String) -> String {
            label.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
        }
        let keys = items.map { key($0.displayName) }
        let groups = Dictionary(grouping: items.indices, by: { keys[$0] })
        let titleCounts = groups.mapValues { indices in
            guard indices.count > 1 else { return [String: Int]() }
            return indices.reduce(into: [String: Int]()) { counts, index in
                for title in Set(items[index].tabTitles.lazy.filter { !$0.isEmpty }.map(key)) {
                    counts[title, default: 0] += 1
                }
            }
        }
        var positions: [String: Int] = [:]
        return zip(items, keys).map { item, groupKey in
            var item = item
            let count = groups[groupKey]?.count ?? 0
            let position = positions[groupKey, default: 0] + 1
            positions[groupKey] = position
            item.matchingNameLabel = count > 1 ? "\(position) of \(count)" : nil
            let counts = titleCounts[groupKey, default: [:]]
            item.distinguishingTab = item.tabTitles.first {
                let tabKey = key($0)
                return tabKey != groupKey && counts[tabKey] == 1
            }
            return item
        }
    }

    var preview: String? {
        let labels = previewLabels()
        return labels.isEmpty ? nil : labels.joined(separator: " · ")
    }

    func previewLabels(matching query: String = "") -> [String] {
        let unmatched = Set(termsOutsideName(query))
        var seen = Set<String>()
        let titles = tabTitles.filter { !$0.isEmpty && seen.insert($0).inserted }
        guard !unmatched.isEmpty else {
            guard let distinguishingTab else { return Array(titles.prefix(2)) }
            return Array(([distinguishingTab] + titles.filter { $0 != distinguishingTab }).prefix(2))
        }

        let candidates = titles.map { title in
            let searchable = normalized(title)
            return (title: title, matched: unmatched.filter { searchable.localizedStandardContains(String($0)) })
        }
        let complete = candidates.filter { $0.matched == unmatched }
        if !complete.isEmpty { return Array(complete.prefix(2).map(\.title)) }
        guard candidates.reduce(into: Set<Substring>(), { $0.formUnion($1.matched) }) == unmatched else { return [] }

        // Show two different pieces of evidence when a query names more than one tab.
        var remaining = unmatched
        var previews: [String] = []
        for _ in 0..<2 {
            let best = candidates.max { $0.matched.intersection(remaining).count < $1.matched.intersection(remaining).count }
            guard let best, !best.matched.isDisjoint(with: remaining) else { break }
            previews.append(best.title)
            remaining.subtract(best.matched)
        }
        return previews
    }

    func matches(_ query: String) -> Bool {
        termsOutsideName(query).isEmpty || !previewLabels(matching: query).isEmpty
    }

    static func exactMatches(for query: String, in candidates: [WorkspaceItem]) -> [WorkspaceItem] {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "–", with: "-")
        guard !query.isEmpty else { return [] }
        func equals(_ name: String) -> Bool {
            name.replacingOccurrences(of: "–", with: "-").localizedCaseInsensitiveCompare(query) == .orderedSame
        }
        let stored = candidates.filter { equals($0.name) }
        return stored.isEmpty ? candidates.filter { equals($0.displayName) } : stored
    }

    private func termsOutsideName(_ query: String) -> [Substring] {
        let workspaceName = normalized(name)
        return normalized(query).split(whereSeparator: \.isWhitespace).filter {
            !workspaceName.localizedStandardContains(String($0))
        }
    }

    private func normalized(_ text: String) -> String {
        text.replacingOccurrences(of: "–", with: "-")
    }

    var id: String { switch kind { case .live(let s): "live:\(s)"; case .saved(let w): "saved:\(w)" } }
    var isSaved: Bool { if case .saved = kind { true } else { false } }
}

extension WorkspaceItem {
    init(session: Session) {
        let tabs = session.workspacePreviewTabs
        self.init(kind: .live(session.id), name: session.name, tabCount: tabs.count,
                  icon: session.icon, tabTitles: tabs.map(\.workspacePreviewLabel))
    }
}

extension AppModel {
    /// Live workspaces in session order, then saved ones that are not open.
    var workspaceItems: [WorkspaceItem] {
        let live = sessions.map(WorkspaceItem.init(session:))
        let saved = savedWorkspaces.filter { !isWorkspaceOpen($0.id) }.map { workspace in
            let snapshot = WorkspaceSnapshot.parse(workspace.stateJSON)
            let tabs = WorkspaceSnapshot.spaces.flatMap { snapshot.tabs(in: $0) }
            let decoded = tabs.compactMap(Tab.init(jsObject:))
            let activeIDs = Set(snapshot.activeTabId.values.compactMap { $0 })
            let ordered = decoded.filter { activeIDs.contains($0.id) } + decoded.filter { !activeIDs.contains($0.id) }
            let titles = ordered.map(\.workspacePreviewLabel)
            return WorkspaceItem(kind: .saved(workspace.id), name: workspace.name,
                                 tabCount: tabs.count, icon: nil, tabTitles: titles)
        }
        return WorkspaceItem.distinguishingMatchingNames(live + saved)
    }

    var liveWorkspaceItems: [WorkspaceItem] {
        WorkspaceItem.distinguishingMatchingNames(sessions.map(WorkspaceItem.init(session:)))
    }

    var tabMoveDestinations: [WorkspaceItem] {
        liveWorkspaceItems.filter { !isCurrent($0) }
    }

    func moveTab(_ id: String, to item: WorkspaceItem) {
        guard case .live(let destination) = item.kind else { return }
        moveTab(id, toSession: destination)
    }

    func isCurrent(_ item: WorkspaceItem) -> Bool { if case .live(let s) = item.kind { return s == currentSessionId }; return false }

    func open(_ item: WorkspaceItem) {
        switch item.kind { case .live(let s): switchSession(s); case .saved(let w): openWorkspace(w) }
    }

    /// The saved snapshot linked to a live workspace (session id `ws:<snapshotId>`), if any.
    func linkedSnapshotId(_ sessionId: String) -> String? {
        guard sessionId.hasPrefix("ws:") else { return nil }
        let id = String(sessionId.dropFirst(3))
        return savedWorkspaces.contains { $0.id == id } ? id : nil
    }

    func newWorkspace() {
        var n = sessions.count + 1
        while sessions.contains(where: { $0.name == "Workspace \(n)" }) { n += 1 }
        newSession(named: "Workspace \(n)")
    }

    func rename(_ item: WorkspaceItem, to name: String) {
        let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        switch item.kind {
        case .live(let s):
            renameSession(s, to: name)
            if let w = linkedSnapshotId(s) { renameWorkspace(w, to: name) }
        case .saved(let w): renameWorkspace(w, to: name)
        }
    }

    /// A copy of the workspace's tabs (fresh ids, same states and order) as a new live workspace.
    func duplicate(_ item: WorkspaceItem) {
        let source: Session
        let order: [String]
        let preferredSpace: SpaceId?
        switch item.kind {
        case .live(let s):
            guard let ses = sessions.first(where: { $0.id == s }) else { return }
            source = ses
            order = displayOrder(for: s)
            preferredSpace = workspaceReadingSpace(s)
        case .saved(let w):
            guard let ws = savedWorkspaces.first(where: { $0.id == w }) else { return }
            let p = WorkspaceSnapshot.parse(ws.stateJSON)
            var tabs: [SpaceId: [BereanWorkspace.Tab]] = [:]
            for sp in WorkspaceSnapshot.spaces { tabs[sp] = p.tabs(in: sp).compactMap { BereanWorkspace.Tab(jsObject: $0) } }
            source = Session(id: "", name: ws.name, icon: p.icon, tabs: tabs, activeTabId: p.activeTabId)
            order = p.displayOrder
            preferredSpace = p.preferredSpace
        }
        var idMap: [String: String] = [:]
        var tabs: [SpaceId: [BereanWorkspace.Tab]] = [:]
        for sp in SpaceId.allCases {
            tabs[sp] = source.tabs(in: sp).map { t in var c = t; c.id = Self.newId(); idMap[t.id] = c.id; return c }
        }
        var active: [SpaceId: String?] = [:]
        for sp in SpaceId.allCases { active[sp] = (source.activeTabId[sp] ?? nil).flatMap { idMap[$0] } }
        tabs = tabs.mapValues { list in list.map { $0.remappingOrigin(using: idMap) } }
        let copy = Session(id: Self.newId(), name: "\(item.name) Copy", icon: source.icon, tabs: tabs, activeTabId: active)
        sessions.append(copy)
        displayOrders[copy.id] = order.compactMap { idMap[$0] }
        switchSession(copy.id, preferredSpace: preferredSpace)
    }

    /// Deletes the workspace: a live one's session (its linked saved copy too), or a saved snapshot.
    /// The last live workspace cannot be deleted.
    func delete(_ item: WorkspaceItem) {
        switch item.kind {
        case .live(let s):
            guard sessions.count > 1 else { return }
            let linked = linkedSnapshotId(s)
            deleteSession(s)
            if let w = linked { deleteWorkspace(w) }
        case .saved(let w): deleteWorkspace(w)
        }
    }

    func canDelete(_ item: WorkspaceItem) -> Bool { item.isSaved || sessions.count > 1 }

    var currentWorkspace: WorkspaceItem? {
        sessions.first(where: { $0.id == currentSessionId }).map(WorkspaceItem.init(session:))
    }
}

extension AppModel {
    func openCalendar(newTab: Bool = false) {
        openUtilityTab(.calendar, in: .notes, title: "Calendar", newTab: newTab)
    }

    func openTodayDailyNote(newTab: Bool = false) {
        openDailyNote(DailyNoteDay.dateKey(DailyNotePreferences.today()), newTab: newTab)
    }

    func openDailyNote(_ key: String, fromCalendar source: String? = nil, newTab: Bool = false) {
        guard let notes else {
            userMessage = "The notes library is unavailable."
            return
        }
        do {
            if let hit = try notes.dailyDates().first(where: { $0.dateKey == key }) {
                openNote(hit.noteId, newTab: newTab, fromList: source)
            } else {
                let created = try notes.create(.init(type: "daily", title: "Daily — \(key)", content: ""))
                openNote(created.note.id, newTab: newTab, fromList: source)
            }
        } catch {
            userMessage = "Could not open the daily note: \(error)"
        }
    }
}

private extension Tab {
    var workspacePreviewLabel: String {
        guard let edition = scriptureEditionLabel else { return navigationLabel }
        return "\(navigationLabel) (\(edition))"
    }
}

extension Session {
    /// Active tabs appear first in workspace previews and are preferred when switching Spaces.
    var workspacePreviewTabs: [Tab] {
        let activeIDs = Set(activeTabId.values.compactMap { $0 })
        let tabs = allTabs
        return tabs.filter { activeIDs.contains($0.id) } + tabs.filter { !activeIDs.contains($0.id) }
    }
}
