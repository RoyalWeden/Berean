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
        let terms = query.replacingOccurrences(of: "–", with: "-").split(whereSeparator: \.isWhitespace)
        return orderedTabs.filter { tab in
            guard space == nil || tab.spaceId == space else { return false }
            let searchableText = tab.navigationSearchText
            return terms.allSatisfy { searchableText.localizedStandardContains(String($0)) }
        }
    }

    struct WorkspaceTabMatch: Identifiable {
        let workspaceID: String
        let workspaceName: String
        let tab: BereanWorkspace.Tab
        var id: String { "\(workspaceID)/\(tab.id)" }
    }

    var recentWorkspaceTabs: [WorkspaceTabMatch] {
        recentTabIDs.filter { $0 != activeTab?.id }.compactMap { id in
            for workspace in sessions {
                if let tab = workspace.allTabs.first(where: { $0.id == id }) {
                    return WorkspaceTabMatch(workspaceID: workspace.id, workspaceName: workspace.name, tab: tab)
                }
            }
            return nil
        }
    }

    func matchingWorkspaceTabs(_ query: String) -> [WorkspaceTabMatch] {
        let terms = query.replacingOccurrences(of: "–", with: "-").split(whereSeparator: \.isWhitespace)
        guard !terms.isEmpty else { return [] }
        return sessions.flatMap { workspace in
            let tabsByID = Dictionary(uniqueKeysWithValues: workspace.allTabs.map { ($0.id, $0) })
            return displayOrder(for: workspace.id).compactMap { id -> WorkspaceTabMatch? in
                guard let tab = tabsByID[id] else { return nil }
                let searchable = "\(tab.navigationSearchText) \(workspace.name)"
                guard terms.allSatisfy({ searchable.localizedStandardContains(String($0)) }) else { return nil }
                return WorkspaceTabMatch(workspaceID: workspace.id, workspaceName: workspace.name, tab: tab)
            }
        }
    }

    func openWorkspaceTab(_ match: WorkspaceTabMatch) {
        guard let tab = sessions.first(where: { $0.id == match.workspaceID })?.allTabs.first(where: { $0.id == match.tab.id }) else { return }
        let sameWorkspace = match.workspaceID == currentSessionId
        switchSession(match.workspaceID)
        select(tab.id, in: tab.spaceId, rememberPrevious: sameWorkspace)
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
        var placements = archivePlacements
        placements[id] = ArchivePlacement(workspace: currentSessionId, order: displayOrder(for: currentSessionId))
        archivedGroups.insert(ArchivedGroup(id: id, label: label, archivedAt: Int64(Date().timeIntervalSince1970 * 1000), tabsJSON: json), at: 0)
        let recentGroups = Set(archivedGroups.prefix(50).map(\.id))
        archivePlacements = placements.filter { recentGroups.contains($0.key) }
        for t in tabs { close(t.id) }
        scheduleSave()
    }

    private struct ArchivePlacement: Codable {
        let workspace: String
        let order: [String]
    }

    private var archivePlacements: [String: ArchivePlacement] {
        get {
            guard let data = UserDefaults.standard.data(forKey: "nativeArchivePlacements") else { return [:] }
            return (try? JSONDecoder().decode([String: ArchivePlacement].self, from: data)) ?? [:]
        }
        set {
            UserDefaults.standard.set(try? JSONEncoder().encode(newValue), forKey: "nativeArchivePlacements")
        }
    }

    private func placeRestoredTab(_ id: String, using placement: ArchivePlacement?) {
        guard let placement, placement.workspace == currentSessionId,
              let index = placement.order.firstIndex(of: id) else {
            insertInDisplayOrder(id, after: nil)
            return
        }
        var order = displayOrder(for: currentSessionId).filter { $0 != id }
        let present = Set(order)
        if let next = placement.order.dropFirst(index + 1).first(where: present.contains),
           let position = order.firstIndex(of: next) {
            order.insert(id, at: position)
        } else if let previous = placement.order.prefix(index).last(where: present.contains),
                  let position = order.firstIndex(of: previous) {
            order.insert(id, at: position + 1)
        } else {
            order.append(id)
        }
        displayOrders[currentSessionId] = order
    }

    var inactiveTabs: [BereanWorkspace.Tab] {
        let selected = Set(session.activeTabId.values.compactMap { $0 })
        return orderedTabs.filter { !$0.isPinned && !selected.contains($0.id) }
    }

    /// Suggest only copies with identical tab state. Prefer keeping a pinned or active copy,
    /// then the first copy in sidebar order. Unknown tab types stay out of duplicate review.
    var inactiveDuplicateOriginals: [String: BereanWorkspace.Tab] {
        let tabs = orderedTabs
        let inactive = Set(inactiveTabs.map(\.id))
        let ordered = tabs.filter { !inactive.contains($0.id) } + tabs.filter { inactive.contains($0.id) }
        var kept: [SpaceId: [String: [BereanWorkspace.Tab]]] = [:]
        var duplicates: [String: BereanWorkspace.Tab] = [:]
        for tab in ordered {
            guard tab.tabType != nil else { continue }
            let copies = kept[tab.spaceId]?[tab.title] ?? []
            if inactive.contains(tab.id), let original = copies.first(where: {
                $0.type == tab.type && $0.state == tab.state
                    && $0.originTabId == tab.originTabId && $0.originSpaceId == tab.originSpaceId
            }) {
                duplicates[tab.id] = original
            } else {
                kept[tab.spaceId, default: [:]][tab.title, default: []].append(tab)
            }
        }
        return duplicates
    }

    func archiveInactiveTabs(_ ids: [String], duplicatesOnly: Bool = false) {
        var requested = Set(ids)
        if duplicatesOnly { requested.formIntersection(inactiveDuplicateOriginals.keys) }
        archive(inactiveTabs.filter { requested.contains($0.id) }.map(\.id))
    }

    func archiveAllTabs() { archive(orderedTabs.map(\.id)) }

    func archivedTabs(_ g: ArchivedGroup) -> [BereanWorkspace.Tab] {
        g.tabs
    }

    /// Restore saved sidebar placement when available and keep the current reading position.
    func restoreArchived(_ groupId: String) {
        guard let index = archivedGroups.firstIndex(where: { $0.id == groupId }) else { return }
        let group = archivedGroups[index]
        let placement = archivePlacements[groupId]
        // Tab IDs are unique in SQLite across all workspaces. An archived copy may
        // already be open elsewhere after a restore on another device.
        var openIds = Set(sessions.flatMap { $0.allTabs.map(\.id) })
        let hadActiveTab = activeTab != nil
        var firstRestoredSpace: SpaceId?
        var restoredIDs = Set<String>()
        for tab in archivedTabs(group) where openIds.insert(tab.id).inserted {
            restoredIDs.insert(tab.id)
            sessions[sessionIndex].tabs[tab.spaceId, default: []].append(tab)
            if activeTabId(in: tab.spaceId) == nil {
                sessions[sessionIndex].activeTabId[tab.spaceId] = tab.id
            }
            placeRestoredTab(tab.id, using: placement)
            if firstRestoredSpace == nil { firstRestoredSpace = tab.spaceId }
        }
        guard !restoredIDs.isEmpty else { return }
        if let remaining = group.afterRestoring(tabIDs: restoredIDs) {
            archivedGroups[index] = remaining
        } else {
            archivedGroups.remove(at: index)
            archivePlacements.removeValue(forKey: groupId)
        }
        if !hadActiveTab, let firstRestoredSpace { activeSpace = firstRestoredSpace }
        scheduleSave()
    }

    /// Restore one archived tab while retaining the original records for the rest of the group.
    func restoreArchivedTab(_ tabID: String, from groupID: String) {
        guard let index = archivedGroups.firstIndex(where: { $0.id == groupID }),
              let tab = archivedGroups[index].tabs.first(where: { $0.id == tabID }) else { return }

        if let workspace = sessions.first(where: { $0.allTabs.contains(where: { $0.id == tabID }) }),
           let liveTab = workspace.allTabs.first(where: { $0.id == tabID }) {
            switchSession(workspace.id)
            select(liveTab.id, in: liveTab.spaceId)
            return
        } else {
            sessions[sessionIndex].tabs[tab.spaceId, default: []].append(tab)
            placeRestoredTab(tab.id, using: archivePlacements[groupID])
            if let remaining = archivedGroups[index].afterRestoring(tabID: tabID) {
                archivedGroups[index] = remaining
            } else {
                archivedGroups.remove(at: index)
                archivePlacements.removeValue(forKey: groupID)
            }
        }
        select(tab.id, in: tab.spaceId)
    }

    func dismissArchived(_ groupId: String) {
        archivedGroups.removeAll { $0.id == groupId }
        archivePlacements.removeValue(forKey: groupId)
        scheduleSave()
    }

    /// The saved workspace whose session is open (`ws:<id>`), if any.
    func isWorkspaceOpen(_ id: String) -> Bool { sessions.contains { $0.id == WorkspaceSnapshot.sessionId(id) } }
}
