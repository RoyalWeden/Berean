import BereanCore
import BereanSync

/// A session (Arc-style tab group): its tabs per Space and the active tab per Space.
public struct Session: Equatable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var icon: String?
    public var tabFilter: String?
    public var tabs: [SpaceId: [Tab]]
    public var activeTabId: [SpaceId: String?]

    public init(id: String, name: String, icon: String? = nil, tabFilter: String? = nil, tabs: [SpaceId: [Tab]] = [:], activeTabId: [SpaceId: String?] = [:]) {
        self.id = id; self.name = name; self.icon = icon; self.tabFilter = tabFilter; self.tabs = tabs; self.activeTabId = activeTabId
    }

    public func tabs(in space: SpaceId) -> [Tab] { tabs[space] ?? [] }
    public var allTabs: [Tab] { SpaceId.allCases.flatMap { tabs(in: $0) } }
}

public struct ArchivedGroup: Equatable, Sendable, Identifiable {
    public var id: String
    public var label: String
    public var archivedAt: Int64
    /// The archived tabs as stored (`tabs_json`), kept verbatim.
    public var tabsJSON: String
    public init(id: String, label: String, archivedAt: Int64, tabsJSON: String) { self.id = id; self.label = label; self.archivedAt = archivedAt; self.tabsJSON = tabsJSON }

    public var tabs: [Tab] {
        records.compactMap { $0.objectValue.flatMap(Tab.init(jsObject:)) }
    }

    private var records: [JSValue] {
        (try? JSON.parse(tabsJSON))?.arrayValue ?? []
    }

    /// Remove only the restored record, preserving records this version cannot decode.
    public func afterRestoring(tabID: String) -> ArchivedGroup? {
        let original = records
        let remaining = original.filter { $0["id"]?.stringValue?.string != tabID }
        guard remaining.count != original.count else { return self }
        guard !remaining.isEmpty else { return nil }
        var group = self
        group.tabsJSON = JSON.stringifyString(.array(remaining))
        if let first = group.tabs.first {
            let title = first.title.isEmpty ? "Untitled" : first.title
            group.label = remaining.count == 1 ? title : "\(title) and \(remaining.count - 1) more"
        }
        return group
    }
}

/// Port of src/store/tabPersistence.ts: workspace state ⇄ the synced `sessions` / `tabs` / `archived_groups` rows.
public enum TabPersistence {
    public struct OrderKeyMaps: Equatable, Sendable {
        public var sessions: [String: String] = [:]
        public var tabs: [String: String] = [:]
        public var display: [String: String] = [:]
        public init() {}
    }

    /// `assignOrderKeys` — keep existing keys where they still increase; new keys only for moved ids.
    public static func assignOrderKeys(_ ids: [String], existing: [String: String]) -> [(String, String)] {
        func lt(_ a: String, _ b: String) -> Bool { jsCompare(a, b) < 0 }
        var later = [String?](repeating: nil, count: ids.count)
        var minLater: String?
        for i in stride(from: ids.count - 1, through: 0, by: -1) {
            later[i] = minLater
            if let k = existing[ids[i]], minLater == nil || lt(k, minLater!) { minLater = k }
        }
        var kept = [String?](repeating: nil, count: ids.count)
        var last: String?
        for i in ids.indices {
            if let k = existing[ids[i]], last == nil || lt(last!, k), later[i] == nil || lt(k, later[i]!) { kept[i] = k; last = k }
        }
        var out: [(String, String)] = []
        var prev: String?
        for i in ids.indices {
            if let k = kept[i] { out.append((ids[i], k)); prev = k; continue }
            var next: String?
            for j in (i + 1)..<max(i + 1, ids.count) where kept[j] != nil { next = kept[j]; break }
            let k = (try? OrderKey.between(prev, next)) ?? "a0"
            out.append((ids[i], k))
            prev = k
        }
        return out
    }

    public struct Snapshot: Equatable, Sendable {
        public var sessions: [SessionRowUpsert] = []
        public var tabs: [TabRowUpsert] = []
        public var archivedGroups: [ArchivedGroupUpsert] = []
    }

    /// `buildSnapshot`.
    public static func buildSnapshot(sessions: [Session], displayOrders: [String: [String]], archivedGroups: [ArchivedGroup],
                                     previous: OrderKeyMaps = OrderKeyMaps()) -> (snapshot: Snapshot, keys: OrderKeyMaps, localState: [String: [SpaceId: String?]]) {
        var keys = OrderKeyMaps()
        for (id, k) in assignOrderKeys(sessions.map(\.id), existing: previous.sessions) { keys.sessions[id] = k }
        var snap = Snapshot()
        var localState: [String: [SpaceId: String?]] = [:]
        for s in sessions {
            snap.sessions.append(SessionRowUpsert(id: s.id, name: s.name, icon: s.icon, tabFilter: s.tabFilter, orderKey: keys.sessions[s.id]!))
            localState[s.id] = s.activeTabId
            var all: [Tab] = []
            for sp in SpaceId.allCases {
                let list = s.tabs(in: sp)
                for (id, k) in assignOrderKeys(list.map(\.id), existing: previous.tabs) { keys.tabs[id] = k }
                all += list
            }
            let present = Set(all.map(\.id))
            let stored = (displayOrders[s.id] ?? []).filter { present.contains($0) }
            let seen = Set(stored)
            let displayIds = stored + all.map(\.id).filter { !seen.contains($0) }
            for (id, k) in assignOrderKeys(displayIds, existing: previous.display) { keys.display[id] = k }
            for t in all {
                let type = t.tabType ?? .bible
                let split = TabFields.split(type: type, state: t.state)
                snap.tabs.append(TabRowUpsert(id: t.id, sessionId: s.id, spaceId: t.spaceId.rawValue, type: t.type, title: t.title, isPinned: t.isPinned,
                                              orderKey: keys.tabs[t.id]!, displayOrderKey: keys.display[t.id]!, originTabId: t.originTabId,
                                              originSpaceId: t.originSpaceId?.rawValue, syncStateJSON: JSON.stableJSON(.object(split.sync)),
                                              localStateJSON: JSON.stableJSON(.object(split.local))))
            }
        }
        for g in archivedGroups { snap.archivedGroups.append(ArchivedGroupUpsert(id: g.id, label: g.label, archivedAt: g.archivedAt, tabsJSON: g.tabsJSON)) }
        return (snap, keys, localState)
    }

    /// `hydrateFromRows` — rows back to sessions (tabs grouped by Space, ordered; active tab validated).
    public static func hydrate(sessions sessionRows: [SessionRow], tabs tabRows: [TabRow], groups: [ArchivedGroupRow],
                               localState: [String: [String: String?]]) -> (sessions: [Session], displayOrders: [String: [String]], archivedGroups: [ArchivedGroup], keys: OrderKeyMaps) {
        var keys = OrderKeyMaps()
        func byOrder<T>(_ rows: [T], _ key: (T) -> String, _ id: (T) -> String) -> [T] {
            rows.sorted { a, b in let c = jsCompare(key(a), key(b)); return c != 0 ? c < 0 : jsCompare(id(a), id(b)) < 0 }
        }
        var bySession: [String: [TabRow]] = [:]
        for t in tabRows where t.deletedAt == nil { bySession[t.sessionId, default: []].append(t) }
        var sessions: [Session] = [], displayOrders: [String: [String]] = [:]
        for s in byOrder(sessionRows.filter { $0.deletedAt == nil }, { $0.orderKey }, { $0.id }) {
            keys.sessions[s.id] = s.orderKey
            let rows = bySession[s.id] ?? []
            var tabs: [SpaceId: [Tab]] = Dictionary(uniqueKeysWithValues: SpaceId.allCases.map { ($0, []) })
            for r in byOrder(rows, { $0.orderKey }, { $0.id }) {
                keys.tabs[r.id] = r.orderKey
                keys.display[r.id] = r.displayOrderKey
                let type = TabType(rawValue: r.type) ?? .bible
                let sync = (try? JSON.parse(r.syncStateJSON))?.objectValue ?? JSObject()
                let local = (try? JSON.parse(r.localStateJSON))?.objectValue ?? JSObject()
                let space = SpaceId(rawValue: r.spaceId) ?? .scripture
                tabs[space]!.append(Tab(id: r.id, spaceId: space, type: r.type, title: r.title, state: TabFields.merge(type: type, sync: sync, local: local),
                                        isPinned: r.isPinned, originTabId: r.originTabId.flatMap { $0.isEmpty ? nil : $0 },
                                        originSpaceId: r.originSpaceId.flatMap { $0.isEmpty ? nil : SpaceId(rawValue: $0) }))
            }
            displayOrders[s.id] = byOrder(rows, { $0.displayOrderKey }, { $0.id }).map(\.id)
            let active = localState[s.id] ?? [:]
            var activeTabId: [SpaceId: String?] = [:]
            for sp in SpaceId.allCases {
                let wanted = active[sp.rawValue] ?? nil
                activeTabId[sp] = wanted.flatMap { w in tabs[sp]!.contains { $0.id == w } ? w : nil } ?? tabs[sp]!.first?.id
            }
            sessions.append(Session(id: s.id, name: s.name, icon: s.icon.flatMap { $0.isEmpty ? nil : $0 }, tabFilter: s.tabFilter.flatMap { $0.isEmpty ? nil : $0 },
                                    tabs: tabs, activeTabId: activeTabId))
        }
        let archived = groups.filter { $0.deletedAt == nil }.map { ArchivedGroup(id: $0.id, label: $0.label, archivedAt: $0.archivedAt, tabsJSON: $0.tabsJSON) }
            .enumerated().sorted { $0.element.archivedAt != $1.element.archivedAt ? $0.element.archivedAt > $1.element.archivedAt : $0.offset < $1.offset }.map(\.element)
        return (sessions, displayOrders, archived, keys)
    }
}
