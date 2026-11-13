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

    /// Re-adds each archived tab to its space in the current session (skipping ids already open) and removes the group.
    func restoreArchived(_ groupId: String) {
        guard let g = archivedGroups.first(where: { $0.id == groupId }) else { return }
        let open = Set(session.allTabs.map(\.id))
        var last: BereanWorkspace.Tab?
        for t in archivedTabs(g) where !open.contains(t.id) {
            sessions[sessionIndex].tabs[t.spaceId, default: []].append(t)
            sessions[sessionIndex].activeTabId[t.spaceId] = t.id
            insertInDisplayOrder(t.id, after: nil)
            last = t
        }
        archivedGroups.removeAll { $0.id == groupId }
        if let last { activeSpace = last.spaceId }
        scheduleSave()
    }

    func dismissArchived(_ groupId: String) { archivedGroups.removeAll { $0.id == groupId }; scheduleSave() }

    /// The saved workspace whose session is open (`ws:<id>`), if any.
    func isWorkspaceOpen(_ id: String) -> Bool { sessions.contains { $0.id == WorkspaceSnapshot.sessionId(id) } }
}
