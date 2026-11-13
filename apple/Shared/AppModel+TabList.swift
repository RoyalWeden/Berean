import Foundation
import BereanCore
import BereanWorkspace

/// The sidebar's tab list, as the existing desktop shows it (TabBar.tsx): ONE list per session in the
/// user's own order (`sessionDisplayOrders` ⇄ the synced `display_order_key`), pinned tabs first, every
/// tab type mixed; plus tab archiving (ArchivedGroup rows, `tabs_json` = the archived tabs as JS objects).
extension AppModel {
    /// Live display order for a session: stored ids that still exist, then any tab not yet ordered
    /// (space order) — the same reconciliation as the store's `reorderTabDisplay`.
    func displayOrder(for sessionId: String) -> [String] {
        guard let s = sessions.first(where: { $0.id == sessionId }) else { return [] }
        let all = s.allTabs.map(\.id)
        let present = Set(all)
        let stored = (displayOrders[sessionId] ?? []).filter { present.contains($0) }
        let seen = Set(stored)
        return stored + all.filter { !seen.contains($0) }
    }

    /// The current session's tabs in display order (pinned first, as in the existing sidebar).
    var orderedTabs: [BereanWorkspace.Tab] {
        let byId = Dictionary(uniqueKeysWithValues: session.allTabs.map { ($0.id, $0) })
        let list = displayOrder(for: currentSessionId).compactMap { byId[$0] }
        return list.filter(\.isPinned) + list.filter { !$0.isPinned }
    }

    func matchingOpenTabs(_ query: String, space: SpaceId? = nil) -> [BereanWorkspace.Tab] {
        let terms = query.split(whereSeparator: \.isWhitespace)
        return orderedTabs.filter { tab in
            guard space == nil || tab.spaceId == space else { return false }
            let title = tab.title.isEmpty ? "Untitled" : tab.title
            let searchableText = "\(title) \(tab.spaceId.title)"
            return terms.allSatisfy { searchableText.localizedStandardContains(String($0)) }
        }
    }

    struct WorkspaceTabMatch: Identifiable {
        let workspaceID: String
        let workspaceName: String
        let tab: BereanWorkspace.Tab
        var id: String { "\(workspaceID)/\(tab.id)" }
    }

    func matchingWorkspaceTabs(_ query: String) -> [WorkspaceTabMatch] {
        let terms = query.split(whereSeparator: \.isWhitespace)
        guard !terms.isEmpty else { return [] }
        return sessions.flatMap { workspace in
            let tabsByID = Dictionary(uniqueKeysWithValues: workspace.allTabs.map { ($0.id, $0) })
            return displayOrder(for: workspace.id).compactMap { id -> WorkspaceTabMatch? in
                guard let tab = tabsByID[id] else { return nil }
                let title = tab.title.isEmpty ? "Untitled" : tab.title
                let searchable = "\(title) \(tab.spaceId.title) \(workspace.name)"
                guard terms.allSatisfy({ searchable.localizedStandardContains(String($0)) }) else { return nil }
                return WorkspaceTabMatch(workspaceID: workspace.id, workspaceName: workspace.name, tab: tab)
            }
        }
    }

    func openWorkspaceTab(_ match: WorkspaceTabMatch) {
        guard sessions.first(where: { $0.id == match.workspaceID })?.allTabs.contains(where: { $0.id == match.tab.id }) == true else { return }
        switchSession(match.workspaceID)
        select(match.tab.id, in: match.tab.spaceId)
    }

    func insertInDisplayOrder(_ id: String, after anchor: String?) {
        guard !currentSessionId.isEmpty else { return }
        var order = displayOrder(for: currentSessionId).filter { $0 != id }
        if let anchor, let i = order.firstIndex(of: anchor) { order.insert(id, at: i + 1) } else { order.append(id) }
        displayOrders[currentSessionId] = order
    }

    /// Drag-reorder inside the pinned or unpinned group of the sidebar list.
    func moveTabs(_ ids: [String], from offsets: IndexSet, to destination: Int) {
        var group = ids
        group.move(fromOffsets: offsets, toOffset: destination)
        var order = displayOrder(for: currentSessionId)
        let groupSet = Set(ids)
        // Slots the group occupies keep their positions; the group's members fill them in the new order.
        var it = group.makeIterator()
        for i in order.indices where groupSet.contains(order[i]) { order[i] = it.next() ?? order[i] }
        displayOrders[currentSessionId] = order
        scheduleSave()
    }

    func tabCount(_ sessionId: String) -> Int { sessions.first { $0.id == sessionId }?.allTabs.count ?? 0 }

    /// "Scripture › Matthew 15" — where the user is (the existing sidebar's location field).
    var locationTitle: (space: String, title: String) {
        guard let t = activeTab else { return (activeSpace.title, "New Tab") }
        return (t.spaceId.title, t.title.isEmpty ? "Untitled" : t.title)
    }

    // MARK: archive (archiveTab / archiveTabs / restoreArchivedGroup / dismissArchivedGroup)

    func archive(_ tabIds: [String]) {
        let tabs = tabIds.compactMap { findTab($0) }
        guard let first = tabs.first else { return }
        let label = tabs.count == 1 ? first.title : "\(first.title) and \(tabs.count - 1) more"
        let json = JSON.stringifyString(.array(tabs.map { .object($0.jsObject) }))
        let id = "arch-\(Int64(Date().timeIntervalSince1970 * 1000))-\(Self.newId().prefix(6))"
        archivedGroups.insert(ArchivedGroup(id: id, label: label, archivedAt: Int64(Date().timeIntervalSince1970 * 1000), tabsJSON: json), at: 0)
        for t in tabs { close(t.id) }
        scheduleSave()
    }

    var inactiveTabs: [BereanWorkspace.Tab] {
        let selected = Set(session.activeTabId.values.compactMap { $0 })
        return orderedTabs.filter { !$0.isPinned && !selected.contains($0.id) }
    }

    func archiveInactiveTabs(_ ids: [String]) {
        let requested = Set(ids)
        archive(inactiveTabs.filter { requested.contains($0.id) }.map(\.id))
    }

    func archiveAllTabs() { archive(orderedTabs.map(\.id)) }

    func archivedTabs(_ g: ArchivedGroup) -> [BereanWorkspace.Tab] {
        ((try? JSON.parse(g.tabsJSON))?.arrayValue ?? []).compactMap { $0.objectValue.flatMap { BereanWorkspace.Tab(jsObject: $0) } }
    }

    /// Append restored tabs in archive order and keep the current reading position.
    func restoreArchived(_ groupId: String) {
        guard let group = archivedGroups.first(where: { $0.id == groupId }) else { return }
        // Tab IDs are unique in SQLite across all workspaces. An archived copy may
        // already be open elsewhere after a restore on another device.
        var openIds = Set(sessions.flatMap { $0.allTabs.map(\.id) })
        let hadActiveTab = activeTab != nil
        var firstRestoredSpace: SpaceId?
        for tab in archivedTabs(group) where openIds.insert(tab.id).inserted {
            sessions[sessionIndex].tabs[tab.spaceId, default: []].append(tab)
            if activeTabId(in: tab.spaceId) == nil {
                sessions[sessionIndex].activeTabId[tab.spaceId] = tab.id
            }
            insertInDisplayOrder(tab.id, after: nil)
            if firstRestoredSpace == nil { firstRestoredSpace = tab.spaceId }
        }
        archivedGroups.removeAll { $0.id == groupId }
        if !hadActiveTab, let firstRestoredSpace { activeSpace = firstRestoredSpace }
        scheduleSave()
    }

    /// Restore one archived tab while retaining the original records for the rest of the group.
    func restoreArchivedTab(_ tabID: String, from groupID: String) {
        guard let index = archivedGroups.firstIndex(where: { $0.id == groupID }),
              var records = (try? JSON.parse(archivedGroups[index].tabsJSON))?.arrayValue,
              let recordIndex = records.firstIndex(where: { $0["id"]?.stringValue?.string == tabID }),
              let record = records[recordIndex].objectValue,
              let tab = BereanWorkspace.Tab(jsObject: record) else { return }

        if let workspace = sessions.first(where: { $0.allTabs.contains(where: { $0.id == tabID }) }),
           let liveTab = workspace.allTabs.first(where: { $0.id == tabID }) {
            switchSession(workspace.id)
            select(liveTab.id, in: liveTab.spaceId)
            return
        } else {
            sessions[sessionIndex].tabs[tab.spaceId, default: []].append(tab)
            insertInDisplayOrder(tab.id, after: nil)
            records.remove(at: recordIndex)
            if records.isEmpty {
                archivedGroups.remove(at: index)
            } else {
                archivedGroups[index].tabsJSON = JSON.stringifyString(.array(records))
                let remaining = archivedTabs(archivedGroups[index])
                if let first = remaining.first {
                    archivedGroups[index].label = remaining.count == 1 ? first.title : "\(first.title) and \(remaining.count - 1) more"
                }
            }
        }
        select(tab.id, in: tab.spaceId)
    }

    func dismissArchived(_ groupId: String) { archivedGroups.removeAll { $0.id == groupId }; scheduleSave() }

    /// The saved workspace whose session is open (`ws:<id>`), if any.
    func isWorkspaceOpen(_ id: String) -> Bool { sessions.contains { $0.id == WorkspaceSnapshot.sessionId(id) } }
}
