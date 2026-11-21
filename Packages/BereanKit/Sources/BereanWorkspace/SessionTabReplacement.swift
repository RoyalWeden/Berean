extension Session {
    /// Reuses a tab's identity and pin while replacing its destination in one session mutation.
    /// Returns the previous tab for navigation history, or leaves the session unchanged if absent.
    @discardableResult
    public mutating func replaceTabContent(_ id: String, with destination: Tab) -> Tab? {
        for sourceSpace in SpaceId.allCases {
            guard var sourceTabs = tabs[sourceSpace], let index = sourceTabs.firstIndex(where: { $0.id == id }) else { continue }
            let previous = sourceTabs[index]
            var replacement = destination
            replacement.id = previous.id
            replacement.isPinned = previous.isPinned
            if sourceSpace == destination.spaceId {
                sourceTabs[index] = replacement
                tabs[sourceSpace] = sourceTabs
            } else {
                sourceTabs.remove(at: index)
                tabs[sourceSpace] = sourceTabs
                if activeTabId[sourceSpace] == id {
                    activeTabId[sourceSpace] = .some(sourceTabs.isEmpty ? nil : sourceTabs[min(index, sourceTabs.count - 1)].id)
                }
                tabs[destination.spaceId, default: []].append(replacement)
            }
            activeTabId[destination.spaceId] = id
            return previous
        }
        return nil
    }
}
