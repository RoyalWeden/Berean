import Foundation
import BereanCore
import BereanWorkspace

struct ArchivedTabMatch: Identifiable {
    let groupID: String
    let groupTitle: String
    let sourceName: String?
    let tab: BereanWorkspace.Tab
    var id: String { "\(groupID)/\(tab.id)" }
}

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
    /// iPhone dock swipe (original BottomNav step): moves to the previous / next tab in display order.
    func stepTab(_ delta: Int) -> Bool {
        let list = orderedTabs
        guard let current = activeTab, let i = list.firstIndex(where: { $0.id == current.id }),
              list.indices.contains(i + delta) else { return false }
        let target = list[i + delta]
        select(target.id, in: target.spaceId)
        return true
    }

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
                    let label = WorkspaceItem(session: workspace).displayName
                    return WorkspaceTabMatch(workspaceID: workspace.id, workspaceName: label, tab: tab)
                }
            }
            return nil
        }
    }

    func matchingWorkspaceTabs(_ query: String) -> [WorkspaceTabMatch] {
        let terms = query.replacingOccurrences(of: "–", with: "-").split(whereSeparator: \.isWhitespace)
        guard !terms.isEmpty else { return [] }
        var direct: [WorkspaceTabMatch] = []
        var workspaceMatches: [WorkspaceTabMatch] = []
        for workspace in sessions {
            let item = WorkspaceItem(session: workspace)
            let tabsByID = Dictionary(uniqueKeysWithValues: workspace.allTabs.map { ($0.id, $0) })
            let displayName = item.displayName.replacingOccurrences(of: "–", with: "-")
            // A passage by itself should find the workspace and matching tabs, without listing every tab it contains.
            let includesTabTerms = !terms.allSatisfy { displayName.localizedStandardContains(String($0)) }
            let workspaceText = includesTabTerms ? item.name + " " + displayName : item.name
            for id in displayOrder(for: workspace.id) {
                guard let tab = tabsByID[id] else { continue }
                let tabText = tab.navigationSearchText
                let match = WorkspaceTabMatch(workspaceID: workspace.id, workspaceName: item.displayName, tab: tab)
                if terms.allSatisfy({ tabText.localizedStandardContains(String($0)) }) {
                    direct.append(match)
                } else if terms.allSatisfy({ (tabText + " " + workspaceText).localizedStandardContains(String($0)) }) {
                    workspaceMatches.append(match)
                }
            }
        }
        return direct + workspaceMatches
    }

    func openPassageMatches(_ passage: ResolvedPassage) -> [WorkspaceTabMatch] {
        var matches: [WorkspaceTabMatch] = []
        for workspace in sessions where workspace.id != currentSessionId {
            let candidates = workspace.tabs(in: .scripture).filter(passage.isShown(in:))
            let active = workspace.activeTabId[.scripture] ?? nil
            guard let tab = candidates.first(where: { $0.id == active }) ?? candidates.first else { continue }
            let label = WorkspaceItem(session: workspace).displayName
            matches.append(.init(workspaceID: workspace.id, workspaceName: label, tab: tab))
            if matches.count == 6 { break }
        }
        return matches
    }

    func openWorkspacePassage(_ passage: ResolvedPassage, match: WorkspaceTabMatch) {
        openWorkspaceTab(match)
        guard currentSessionId == match.workspaceID, activeTab?.id == match.tab.id else { return }
        recordRecent(textId: passage.textId, bookId: passage.bookId, chapter: passage.chapter,
                     verse: passage.verse, endVerse: passage.endVerse, verseGroups: passage.verseGroups)
    }

    func openWorkspaceTab(_ match: WorkspaceTabMatch) {
        guard let tab = sessions.first(where: { $0.id == match.workspaceID })?.allTabs.first(where: { $0.id == match.tab.id }) else { return }
        let sourceWorkspace = currentSessionId
        let sourceTab = activeTab?.id
        let sameWorkspace = match.workspaceID == sourceWorkspace
        switchSession(match.workspaceID)
        select(tab.id, in: tab.spaceId, rememberPrevious: sameWorkspace)
        if !sameWorkspace {
            recordTabReturn(to: sourceTab, in: sourceWorkspace)
        }
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

    @discardableResult
    func archive(_ tabIds: [String]) -> ArchivedGroup? {
        let tabs = tabIds.compactMap { findTab($0) }
        guard let first = tabs.first else { return nil }
        let label = tabs.count == 1 ? first.title : "\(first.title) and \(tabs.count - 1) more"
        let json = JSON.stringifyString(.array(tabs.map { .object($0.jsObject) }))
        let id = "arch-\(Int64(Date().timeIntervalSince1970 * 1000))-\(Self.newId().prefix(6))"
        var placements = archivePlacements
        placements[id] = ArchivePlacement(workspace: currentSessionId, order: displayOrder(for: currentSessionId),
                                          workspaceName: session.name, workspaceLabel: currentWorkspace?.displayName)
        let group = ArchivedGroup(id: id, label: label, archivedAt: Int64(Date().timeIntervalSince1970 * 1000), tabsJSON: json)
        archivedGroups.insert(group, at: 0)
        let recentGroups = Set(archivedGroups.prefix(50).map(\.id))
        archivePlacements = placements.filter { recentGroups.contains($0.key) }
        for t in tabs { close(t.id) }
        scheduleSave()
        return group
    }

    private struct ArchivePlacement: Codable {
        let workspace: String
        let order: [String]
        let workspaceName: String?
        let workspaceLabel: String?
    }

    func archiveTitles(includeAliases: Bool = false) -> [String: String] {
        let placements = archivePlacements
        let sourceIDs = Set(placements.values.map(\.workspace))
        let live = Dictionary(uniqueKeysWithValues: sessions.filter { sourceIDs.contains($0.id) }
            .map { ($0.id, WorkspaceItem(session: $0)) })
        return Dictionary(uniqueKeysWithValues: archivedGroups.map { group in
            let label = group.label.isEmpty ? "Archived tabs" : group.label
            guard let placement = placements[group.id] else { return (group.id, label) }
            let source = live[placement.workspace]
            let name = source?.displayName ?? placement.workspaceLabel ?? placement.workspaceName
            if includeAliases {
                let aliases = [name, source?.name, placement.workspaceLabel, placement.workspaceName].compactMap { $0 }
                return (group.id, ([label] + aliases).joined(separator: " ").replacingOccurrences(of: "–", with: "-"))
            }
            return (group.id, name.map { "\(label) · \($0)" } ?? label)
        })
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

    private func placeRestoredTab(_ id: String, in workspace: String, using placement: ArchivePlacement?) {
        let savedOrder = placement?.workspace == workspace ? placement?.order : nil
        displayOrders[workspace] = TabPersistence.restoredDisplayOrder(
            tabID: id, current: displayOrder(for: workspace), archived: savedOrder ?? []
        )
    }

    func archiveSourceNames() -> [String: String] {
        let names = Dictionary(uniqueKeysWithValues: sessions.filter { $0.id != currentSessionId }.map { ($0.id, $0.name) })
        return archivePlacements.compactMapValues { names[$0.workspace] }
    }

    var inactiveTabs: [BereanWorkspace.Tab] {
        let selected = Set(session.activeTabId.values.compactMap { $0 })
        return orderedTabs.filter { !$0.isPinned && !selected.contains($0.id) }
    }

    /// Suggest only copies with identical tab state. Prefer active or pinned copies, then
    /// protected recent copies, then sidebar order. Unknown tab types stay out of review.
    func inactiveDuplicateOriginals(keepingRecent: Bool) -> [String: BereanWorkspace.Tab] {
        let tabs = orderedTabs
        let inactive = Set(inactiveTabs.map(\.id))
        let recent: Set<String> = keepingRecent ? recentCleanupTabIDs : []
        let ordered = tabs.filter { !inactive.contains($0.id) }
            + tabs.filter { inactive.contains($0.id) && recent.contains($0.id) }
            + tabs.filter { inactive.contains($0.id) && !recent.contains($0.id) }
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

    @discardableResult
    func archiveInactiveTabs(_ ids: [String], duplicatesOnly: Bool = false, keepingRecent: Bool = false) -> ArchivedGroup? {
        archive(eligibleInactiveTabIDs(ids, duplicatesOnly: duplicatesOnly, keepingRecent: keepingRecent))
    }

    func moveInactiveTabs(_ ids: [String], to workspace: WorkspaceItem, duplicatesOnly: Bool, keepingRecent: Bool) -> Int {
        guard case .live(let target) = workspace.kind else { return 0 }
        return moveTabs(eligibleInactiveTabIDs(ids, duplicatesOnly: duplicatesOnly, keepingRecent: keepingRecent), toSession: target)
    }

    private func eligibleInactiveTabIDs(_ ids: [String], duplicatesOnly: Bool, keepingRecent: Bool) -> [String] {
        var requested = Set(ids)
        if keepingRecent { requested.subtract(recentCleanupTabIDs) }
        if duplicatesOnly { requested.formIntersection(inactiveDuplicateOriginals(keepingRecent: keepingRecent).keys) }
        return inactiveTabs.filter { requested.contains($0.id) }.map(\.id)
    }

    func archiveAllTabs() { archive(orderedTabs.map(\.id)) }

    func archivedTabs(_ g: ArchivedGroup) -> [BereanWorkspace.Tab] {
        g.tabs
    }

    func matchingArchivedTabs(_ query: String, limit: Int = 6) -> [ArchivedTabMatch] {
        let normalized = query.replacingOccurrences(of: "–", with: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let terms = normalized.split(whereSeparator: \.isWhitespace)
        guard limit > 0, !terms.isEmpty else { return [] }

        let titles = archiveTitles()
        let searchTitles = archiveTitles(includeAliases: true)
        let sourceNames = archiveSourceNames()
        var exact: [ArchivedTabMatch] = []
        var direct: [ArchivedTabMatch] = []
        var contextual: [ArchivedTabMatch] = []
        for group in archivedGroups {
            let title = titles[group.id] ?? group.label
            for tab in archivedTabs(group) {
                let match = ArchivedTabMatch(groupID: group.id, groupTitle: title, sourceName: sourceNames[group.id], tab: tab)
                let tabTitle = tab.navigationLabel.replacingOccurrences(of: "–", with: "-")
                let tabText = tab.navigationSearchText
                if tabTitle.localizedStandardCompare(normalized) == .orderedSame {
                    exact.append(match)
                    if exact.count == limit { return exact }
                } else if direct.count < limit, terms.allSatisfy({ tabText.localizedStandardContains(String($0)) }) {
                    direct.append(match)
                } else if contextual.count < limit {
                    let text = "\(tabText) \(searchTitles[group.id] ?? title)"
                    if terms.allSatisfy({ text.localizedStandardContains(String($0)) }) { contextual.append(match) }
                }
            }
        }
        return Array((exact + direct + contextual).prefix(limit))
    }

    /// Restore saved sidebar placement when available and keep the current reading position.
    func restoreArchived(_ groupId: String, toSource: Bool = false, only tabID: String? = nil) {
        guard let index = archivedGroups.firstIndex(where: { $0.id == groupId }) else { return }
        let group = archivedGroups[index]
        let placement = archivePlacements[groupId]
        guard let workspace = toSource ? placement?.workspace : currentSessionId,
              let destination = sessions.firstIndex(where: { $0.id == workspace }) else { return }
        // Tab IDs are unique in SQLite across all workspaces. An archived copy may
        // already be open elsewhere after a restore on another device.
        let plan = group.restorePlan(openTabIDs: Set(sessions.flatMap { $0.allTabs.map(\.id) }), only: tabID)
        guard plan.remaining != group else { return }
        let hadActiveTab = activeTab != nil
        var firstRestoredSpace: SpaceId?
        for tab in plan.tabs {
            sessions[destination].tabs[tab.spaceId, default: []].append(tab)
            if (sessions[destination].activeTabId[tab.spaceId] ?? nil) == nil {
                sessions[destination].activeTabId[tab.spaceId] = tab.id
            }
            placeRestoredTab(tab.id, in: workspace, using: placement)
            if firstRestoredSpace == nil { firstRestoredSpace = tab.spaceId }
        }
        if let remaining = plan.remaining {
            archivedGroups[index] = remaining
        } else {
            archivedGroups.remove(at: index)
            archivePlacements.removeValue(forKey: groupId)
        }
        if workspace == currentSessionId, !hadActiveTab, let firstRestoredSpace { activeSpace = firstRestoredSpace }
        scheduleSave()
    }

    /// Restore one archived tab while retaining the original records for the rest of the group.
    func restoreArchivedTab(_ tabID: String, from groupID: String, toSource: Bool = false) {
        guard let index = archivedGroups.firstIndex(where: { $0.id == groupID }),
              let tab = archivedGroups[index].tabs.first(where: { $0.id == tabID }) else { return }

        if let workspace = sessions.first(where: { $0.allTabs.contains(where: { $0.id == tabID }) }),
           let liveTab = workspace.allTabs.first(where: { $0.id == tabID }) {
            if let remaining = archivedGroups[index].afterRestoring(tabID: tabID) {
                archivedGroups[index] = remaining
            } else {
                archivedGroups.remove(at: index)
                archivePlacements.removeValue(forKey: groupID)
            }
            switchSession(workspace.id)
            select(liveTab.id, in: liveTab.spaceId)
            return
        }
        guard let destination = toSource ? archivePlacements[groupID]?.workspace : currentSessionId else { return }
        restoreArchived(groupID, toSource: toSource, only: tabID)
        guard sessions.first(where: { $0.id == destination })?.allTabs.contains(where: { $0.id == tabID }) == true else { return }
        if destination != currentSessionId { switchSession(destination) }
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
