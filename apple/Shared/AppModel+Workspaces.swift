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
    var preview: String? { tabTitles.first(where: { !$0.isEmpty }) }

    func matches(_ query: String) -> Bool {
        query.isEmpty || name.localizedCaseInsensitiveContains(query)
            || tabTitles.contains { $0.localizedCaseInsensitiveContains(query) }
    }
    var id: String { switch kind { case .live(let s): "live:\(s)"; case .saved(let w): "saved:\(w)" } }
    var isSaved: Bool { if case .saved = kind { true } else { false } }
}

extension AppModel {
    /// Live workspaces in session order, then saved ones that are not open.
    var workspaceItems: [WorkspaceItem] {
        let live = sessions.map { session in
            let tabs = session.allTabs
            let activeIds = Set(session.activeTabId.values.compactMap { $0 })
            let titles = tabs.filter { activeIds.contains($0.id) }.map(\.title)
                + tabs.filter { !activeIds.contains($0.id) }.map(\.title)
            return WorkspaceItem(kind: .live(session.id), name: session.name, tabCount: tabs.count,
                                 icon: session.icon, tabTitles: titles)
        }
        let saved = savedWorkspaces.filter { !isWorkspaceOpen($0.id) }.map { workspace in
            let snapshot = WorkspaceSnapshot.parse(workspace.stateJSON)
            let tabs = WorkspaceSnapshot.spaces.flatMap { snapshot.tabs(in: $0) }
            let titles = tabs.compactMap { $0["title"]?.stringValue?.string }
            return WorkspaceItem(kind: .saved(workspace.id), name: workspace.name,
                                 tabCount: snapshot.displayOrder.count, icon: nil, tabTitles: titles)
        }
        return live + saved
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
        switch item.kind {
        case .live(let s):
            guard let ses = sessions.first(where: { $0.id == s }) else { return }
            source = ses; order = displayOrder(for: s)
        case .saved(let w):
            guard let ws = savedWorkspaces.first(where: { $0.id == w }) else { return }
            let p = WorkspaceSnapshot.parse(ws.stateJSON)
            var tabs: [SpaceId: [BereanWorkspace.Tab]] = [:]
            for sp in WorkspaceSnapshot.spaces { tabs[sp] = p.tabs(in: sp).compactMap { BereanWorkspace.Tab(jsObject: $0) } }
            source = Session(id: "", name: ws.name, icon: p.icon, tabs: tabs, activeTabId: p.activeTabId)
            order = p.displayOrder
        }
        var idMap: [String: String] = [:]
        var tabs: [SpaceId: [BereanWorkspace.Tab]] = [:]
        for sp in SpaceId.allCases {
            tabs[sp] = source.tabs(in: sp).map { t in var c = t; c.id = Self.newId(); idMap[t.id] = c.id; return c }
        }
        var active: [SpaceId: String?] = [:]
        for sp in SpaceId.allCases { active[sp] = (source.activeTabId[sp] ?? nil).flatMap { idMap[$0] } }
        let copy = Session(id: Self.newId(), name: "\(item.name) Copy", icon: source.icon, tabs: tabs, activeTabId: active)
        sessions.append(copy)
        displayOrders[copy.id] = order.compactMap { idMap[$0] }
        currentSessionId = copy.id
        scheduleSave()
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

    var currentWorkspace: WorkspaceItem? { workspaceItems.first { isCurrent($0) } }
}

extension AppModel {
    func openCalendar() {
        if let tab = session.allTabs.first(where: { $0.tabType == .calendar }) {
            select(tab.id, in: tab.spaceId)
        } else {
            openTab(.calendar, in: .notes, title: "Calendar", state: JSObject())
        }
    }

    func openTodayDailyNote() { openDailyNote(DailyNoteDay.dateKey(DailyNotePreferences.today())) }

    func openDailyNote(_ key: String) {
        guard let notes else {
            userMessage = "The notes library is unavailable."
            return
        }
        do {
            if let hit = try notes.dailyDates().first(where: { $0.dateKey == key }) {
                openNote(hit.noteId)
            } else {
                let created = try notes.create(.init(type: "daily", title: "Daily — \(key)", content: ""))
                openNote(created.note.id)
            }
        } catch {
            userMessage = "Could not open the daily note: \(error)"
        }
    }
}
