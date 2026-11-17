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
        return TabPersistence.reconciledDisplayOrder(tabIDs: s.allTabs.map(\.id), stored: displayOrders[sessionId] ?? [])
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
        var sameTitleIndex: Int? = nil
        var isCurrent = false
        var id: String { "\(workspaceID)/\(tab.id)" }

        var searchDetail: String {
            let position = sameTitleIndex.map { "Tab \($0)" }
            return ([workspaceName, tab.navigationDetail]
                    + [position, tab.isPinned ? "Pinned" : nil, isCurrent ? "Current" : nil].compactMap { $0 })
                .joined(separator: " · ")
        }
    }

    var recentWorkspaceTabs: [WorkspaceTabMatch] {
        let recentIDs = recentTabIDs.filter { $0 != activeTab?.id }
        guard !recentIDs.isEmpty else { return [] }
        let workspaces = Array(zip(sessions, liveWorkspaceItems))
        return recentIDs.compactMap { id in
            for (workspace, item) in workspaces {
                if let tab = workspace.allTabs.first(where: { $0.id == id }) {
                    return WorkspaceTabMatch(workspaceID: workspace.id, workspaceName: item.tabDestinationName, tab: tab)
                }
            }
            return nil
        }
    }

    static func sameTitleTabIndices(_ ordered: [BereanWorkspace.Tab]) -> [String: Int] {
        let pinnedFirst = ordered.filter(\.isPinned) + ordered.filter { !$0.isPinned }
        let tabsByLabel = Dictionary(grouping: pinnedFirst) { [$0.navigationLabel, $0.navigationDetail] }
        var sameTitleIndices: [String: Int] = [:]
        for tabs in tabsByLabel.values where tabs.count > 1 {
            for (index, tab) in tabs.enumerated() {
                sameTitleIndices[tab.id] = index + 1
            }
        }
        return sameTitleIndices
    }

    func matchingWorkspaceTabs(_ query: String) -> [WorkspaceTabMatch] {
        let terms = query.replacingOccurrences(of: "–", with: "-").split(whereSeparator: \.isWhitespace)
        guard !terms.isEmpty else { return [] }
        var direct: [WorkspaceTabMatch] = []
        var workspaceMatches: [WorkspaceTabMatch] = []
        for (workspace, item) in zip(sessions, liveWorkspaceItems) {
            let tabsByID = Dictionary(uniqueKeysWithValues: workspace.allTabs.map { ($0.id, $0) })
            let displayName = item.displayName.replacingOccurrences(of: "–", with: "-")
            // A passage by itself should find the workspace and matching tabs, without listing every tab it contains.
            let includesTabTerms = !terms.allSatisfy { displayName.localizedStandardContains(String($0)) }
            let workspaceText = includesTabTerms ? item.name + " " + displayName : item.name
            let ordered = displayOrder(for: workspace.id).compactMap { tabsByID[$0] }
            let sameTitleIndices = Self.sameTitleTabIndices(ordered)
            for tab in ordered {
                let tabText = tab.navigationSearchText
                let match = WorkspaceTabMatch(workspaceID: workspace.id, workspaceName: item.tabDestinationName, tab: tab,
                                              sameTitleIndex: sameTitleIndices[tab.id], isCurrent: tab.id == activeTab?.id)
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
        for (workspace, item) in zip(sessions, liveWorkspaceItems) where workspace.id != currentSessionId {
            let candidates = workspace.tabs(in: .scripture).filter(passage.isShown(in:))
            let active = workspace.activeTabId[.scripture] ?? nil
            guard let tab = candidates.first(where: { $0.id == active }) ?? candidates.first else { continue }
            matches.append(.init(workspaceID: workspace.id, workspaceName: item.tabDestinationName, tab: tab))
            if matches.count == 6 { break }
        }
        return matches
    }

    func openWorkspacePassage(_ passage: ResolvedPassage, match: WorkspaceTabMatch) {
        guard let workspace = sessions.first(where: { $0.id == match.workspaceID }),
              let destination = workspace.tabs(in: .scripture).first(where: { $0.id == match.tab.id && passage.isShown(in: $0) })
                  ?? workspace.tabs(in: .scripture).first(where: passage.isShown(in:)) else {
            userMessage = "That passage is no longer open in the selected workspace."
            return
        }
        openWorkspaceTab(destination, workspaceID: workspace.id)
        recordRecent(textId: passage.textId, bookId: passage.bookId, chapter: passage.chapter,
                     verse: passage.verse, endVerse: passage.endVerse, verseGroups: passage.verseGroups)
    }

    func openWorkspaceTab(_ match: WorkspaceTabMatch) {
        guard let tab = sessions.first(where: { $0.id == match.workspaceID })?.allTabs.first(where: { $0.id == match.tab.id }) else { return }
        openWorkspaceTab(tab, workspaceID: match.workspaceID)
    }

    private func openWorkspaceTab(_ tab: Tab, workspaceID: String) {
        let sourceWorkspace = currentSessionId
        let sourceTab = activeTab?.id
        let sameWorkspace = workspaceID == sourceWorkspace
        switchSession(workspaceID)
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
        let activeBySpace = Dictionary(uniqueKeysWithValues: SpaceId.allCases.compactMap { space in
            activeTabId(in: space).map { (space.rawValue, $0) }
        })
        var placements = archivePlacements
        placements[id] = ArchivePlacement(workspace: currentSessionId, order: displayOrder(for: currentSessionId),
                                          workspaceName: session.name, workspaceLabel: currentWorkspace?.displayName,
                                          activeTabID: activeTab?.id, activeBySpace: activeBySpace)
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
        let activeTabID: String?
        let activeBySpace: [String: String]?
    }

    func archiveTitles(includeAliases: Bool = false) -> [String: String] {
        let placements = archivePlacements
        let live = liveArchiveSources(for: placements)
        return Dictionary(uniqueKeysWithValues: archivedGroups.map { group in
            let storedLabel = group.label.isEmpty ? "Archived tabs" : group.label
            let label = archiveDisplayLabel(group, fallback: storedLabel)
            let placement = placements[group.id]
            let source = placement.flatMap { live[$0.workspace] }
            let name = source?.tabDestinationName ?? placement?.workspaceLabel ?? placement?.workspaceName
            if includeAliases {
                let aliases = [name, source?.name, placement?.workspaceLabel, placement?.workspaceName].compactMap { $0 }
                let labels = label == storedLabel ? [label] : [label, storedLabel]
                return (group.id, (labels + aliases).joined(separator: " ").replacingOccurrences(of: "–", with: "-"))
            }
            return (group.id, name.map { "\(label) · \($0)" } ?? label)
        })
    }

    private func archiveDisplayLabel(_ group: ArchivedGroup, fallback: String) -> String {
        let tabs = group.tabs
        guard let first = tabs.first, first.tabType == .bible else { return fallback }
        let suffix = tabs.count == 1 ? "" : " and \(tabs.count - 1) more"
        // Only replace the generated label. Keep imported labels and groups with unreadable records intact.
        guard group.label == first.title + suffix else { return fallback }
        return first.navigationLabel + suffix
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

    func canRestoreArchiveToSource(_ groupID: String) -> Bool {
        guard let workspaceID = archivePlacements[groupID]?.workspace else { return false }
        return sessions.contains { $0.id == workspaceID }
    }

    func archiveSourceNames() -> [String: String] {
        let placements = archivePlacements
        let sources = liveArchiveSources(for: placements)
        return placements.compactMapValues { placement in
            guard placement.workspace != currentSessionId else { return nil }
            return sources[placement.workspace]?.tabDestinationName
        }
    }

    private func liveArchiveSources(for placements: [String: ArchivePlacement]) -> [String: WorkspaceItem] {
        let sourceIDs = Set(placements.values.map(\.workspace))
        guard !sourceIDs.isEmpty else { return [:] }
        return Dictionary(uniqueKeysWithValues: zip(sessions, liveWorkspaceItems).compactMap { workspace, item in
            sourceIDs.contains(workspace.id) ? (workspace.id, item) : nil
        })
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
                    && sameCleanupBookmark($0, tab)
            }) {
                duplicates[tab.id] = original
            } else {
                kept[tab.spaceId, default: [:]][tab.title, default: []].append(tab)
            }
        }
        return duplicates
    }

    private func sameCleanupBookmark(_ first: Tab, _ second: Tab) -> Bool {
        let a = first.id
        let b = second.id
        switch first.tabType {
        case .bible:
            let reader = BibleState(first.state)
            let chapter = ChapterEdition(reader).key
            guard scriptureReadingPositions[a]?[chapter] == scriptureReadingPositions[b]?[chapter] else { return false }
            return !reader.compareMode || (compareScrollOffsets[a] == compareScrollOffsets[b]
                && compareColumnScrollVerses[a] == compareColumnScrollVerses[b])
        case .search:
            return searchVisibleRows[a] == searchVisibleRows[b] && searchResultAnchors[a] == searchResultAnchors[b]
        case .lexicon:
            return lexiconSearches[a]?.query == lexiconSearches[b]?.query
                && lexiconSearches[a]?.lang == lexiconSearches[b]?.lang
                && lexiconScrollOffsets[a] == lexiconScrollOffsets[b]
                && lexiconOccurrenceOptions[a] == lexiconOccurrenceOptions[b]
                && lexiconOccurrenceReturns[a] == lexiconOccurrenceReturns[b]
        case .note:
            return notesBrowseOptions[a] == notesBrowseOptions[b]
                && notesFolderPositions[a] == notesFolderPositions[b]
                && notesSearchOffsets[a] == notesSearchOffsets[b]
                && notesSearchReturnRows[a] == notesSearchReturnRows[b]
        case .history:
            return historyBrowseOptions[a] == historyBrowseOptions[b] && historyReturnRows[a] == historyReturnRows[b]
        case .calendar:
            return dailyTimelinePositions[a] == dailyTimelinePositions[b]
        default:
            return true
        }
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
        let workspace = toSource ? archivePlacements[groupId]?.workspace : currentSessionId
        guard let workspace else { return }
        restoreArchived(groupId, workspaceID: workspace, only: tabID)
    }

    func restoreArchived(_ groupId: String, to workspace: WorkspaceItem) {
        guard case .live(let workspaceID) = workspace.kind,
              sessions.contains(where: { $0.id == workspaceID }),
              let group = archivedGroups.first(where: { $0.id == groupId }) else { return }
        let archivedIDs = Set(group.tabs.map(\.id))
        let openElsewhere = Set(sessions.lazy.filter { $0.id != workspaceID }
            .flatMap { $0.allTabs.map(\.id) }).intersection(archivedIDs)
        restoreArchived(groupId, workspaceID: workspaceID, only: nil)
        if !openElsewhere.isEmpty {
            userMessage = openElsewhere.count == 1
                ? "One archived tab was already open in another workspace and stayed there."
                : "\(openElsewhere.count) archived tabs were already open in other workspaces and stayed there."
        }
    }

    private func restoreArchived(_ groupId: String, workspaceID workspace: String, only tabID: String?) {
        guard let index = archivedGroups.firstIndex(where: { $0.id == groupId }) else { return }
        let group = archivedGroups[index]
        let placement = archivePlacements[groupId]
        guard let destination = sessions.firstIndex(where: { $0.id == workspace }) else { return }
        // Tab IDs are unique in SQLite across all workspaces. An archived copy may
        // already be open elsewhere after a restore on another device.
        let plan = group.restorePlan(openTabIDs: Set(sessions.flatMap { $0.allTabs.map(\.id) }), only: tabID)
        guard plan.remaining != group else { return }
        let hadActiveTab = activeTab != nil
        let sourcePlacement = placement?.workspace == workspace ? placement : nil
        let savedOrder = sourcePlacement?.order ?? []
        let restoredBySpace = Dictionary(grouping: plan.tabs, by: \.spaceId)
        var restoredOrder = displayOrder(for: workspace)
        for tab in plan.tabs {
            sessions[destination].tabs[tab.spaceId, default: []].append(tab)
            restoredOrder = TabPersistence.restoredDisplayOrder(tabID: tab.id, current: restoredOrder, archived: savedOrder)
        }
        for (space, tabs) in restoredBySpace where (sessions[destination].activeTabId[space] ?? nil) == nil {
            let previous = sourcePlacement?.activeBySpace?[space.rawValue]
            sessions[destination].activeTabId[space] = tabs.first(where: { $0.id == previous })?.id ?? tabs.first?.id
        }
        if !plan.tabs.isEmpty { displayOrders[workspace] = restoredOrder }
        if let remaining = plan.remaining {
            archivedGroups[index] = remaining
        } else {
            archivedGroups.remove(at: index)
            archivePlacements.removeValue(forKey: groupId)
        }
        if workspace == currentSessionId, !hadActiveTab {
            let original = sourcePlacement?.activeTabID
            if let tab = plan.tabs.first(where: { $0.id == original }) ?? plan.tabs.first {
                select(tab.id, in: tab.spaceId, rememberPrevious: false)
                return
            }
        }
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
            openWorkspaceTab(liveTab, workspaceID: workspace.id)
            return
        }
        guard let destination = toSource ? archivePlacements[groupID]?.workspace : currentSessionId else { return }
        restoreArchived(groupID, toSource: toSource, only: tabID)
        guard sessions.first(where: { $0.id == destination })?.allTabs.contains(where: { $0.id == tabID }) == true else { return }
        openWorkspaceTab(tab, workspaceID: destination)
    }

    func dismissArchived(_ groupId: String) {
        archivedGroups.removeAll { $0.id == groupId }
        archivePlacements.removeValue(forKey: groupId)
        scheduleSave()
    }

    /// The saved workspace whose session is open (`ws:<id>`), if any.
    func isWorkspaceOpen(_ id: String) -> Bool { sessions.contains { $0.id == WorkspaceSnapshot.sessionId(id) } }
}
