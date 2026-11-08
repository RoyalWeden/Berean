import BereanCore
import BereanSQLite
import BereanStore

public struct SessionRow: Equatable, Sendable { public var id, name: String; public var icon, tabFilter: String?; public var orderKey: String; public var createdAt, updatedAt: Int64; public var deletedAt: Int64? }
public struct TabRow: Equatable, Sendable {
    public var id, sessionId, spaceId, type, title: String
    public var isPinned: Bool
    public var orderKey, displayOrderKey: String
    public var originTabId, originSpaceId: String?
    public var syncStateJSON, localStateJSON: String
    public var createdAt, updatedAt: Int64
    public var deletedAt: Int64?
}
public struct ArchivedGroupRow: Equatable, Sendable { public var id, label: String; public var archivedAt: Int64; public var tabsJSON: String; public var createdAt, updatedAt: Int64; public var deletedAt: Int64? }

public struct SessionRowUpsert: Equatable, Sendable { public var id, name: String; public var icon, tabFilter: String?; public var orderKey: String
    public init(id: String, name: String, icon: String?, tabFilter: String?, orderKey: String) { self.id = id; self.name = name; self.icon = icon; self.tabFilter = tabFilter; self.orderKey = orderKey } }
public struct TabRowUpsert: Equatable, Sendable {
    public var id, sessionId, spaceId, type, title: String
    public var isPinned: Bool
    public var orderKey, displayOrderKey: String
    public var originTabId, originSpaceId: String?
    public var syncStateJSON: String
    public var localStateJSON: String?
    public init(id: String, sessionId: String, spaceId: String, type: String, title: String, isPinned: Bool, orderKey: String, displayOrderKey: String,
                originTabId: String?, originSpaceId: String?, syncStateJSON: String, localStateJSON: String?) {
        self.id = id; self.sessionId = sessionId; self.spaceId = spaceId; self.type = type; self.title = title; self.isPinned = isPinned; self.orderKey = orderKey
        self.displayOrderKey = displayOrderKey; self.originTabId = originTabId; self.originSpaceId = originSpaceId; self.syncStateJSON = syncStateJSON; self.localStateJSON = localStateJSON
    }
}
public struct ArchivedGroupUpsert: Equatable, Sendable { public var id, label: String; public var archivedAt: Int64; public var tabsJSON: String
    public init(id: String, label: String, archivedAt: Int64, tabsJSON: String) { self.id = id; self.label = label; self.archivedAt = archivedAt; self.tabsJSON = tabsJSON } }

/// A change the sync engine must capture (`data:changed`).
public struct DataChange: Equatable, Sendable {
    public var entity: String, id: String, op: String
    public init(entity: String, id: String, op: String) { self.entity = entity; self.id = id; self.op = op }
}

/// Port of src/platform/services/sessionsService.ts — sessions, tabs and archived groups with
/// `updated_at` + tombstones (what sync journals). Every write reports its `DataChange`s.
public final class SessionsService: @unchecked Sendable {
    let db: SQLiteConnection
    let now: @Sendable () -> Int64
    let onChange: @Sendable (DataChange) -> Void

    public init(db: SQLiteConnection, now: @escaping @Sendable () -> Int64, onChange: @escaping @Sendable (DataChange) -> Void = { _ in }) {
        self.db = db; self.now = now; self.onChange = onChange
    }

    static func i64(_ v: SQLiteValue?) -> Int64? { if case .integer(let i) = v { return i }; if case .real(let d) = v { return Int64(d) }; return nil }
    static func session(_ r: SQLiteRow) -> SessionRow {
        SessionRow(id: r["id"]!.string!, name: r["name"]?.string ?? "", icon: r["icon"]?.string, tabFilter: r["tab_filter"]?.string, orderKey: r["order_key"]?.string ?? "",
                   createdAt: i64(r["created_at"]) ?? 0, updatedAt: i64(r["updated_at"]) ?? 0, deletedAt: i64(r["deleted_at"]))
    }
    static func tab(_ r: SQLiteRow) -> TabRow {
        TabRow(id: r["id"]!.string!, sessionId: r["session_id"]?.string ?? "", spaceId: r["space_id"]?.string ?? "", type: r["type"]?.string ?? "",
               title: r["title"]?.string ?? "", isPinned: (i64(r["is_pinned"]) ?? 0) != 0, orderKey: r["order_key"]?.string ?? "",
               displayOrderKey: r["display_order_key"]?.string ?? "", originTabId: r["origin_tab_id"]?.string, originSpaceId: r["origin_space_id"]?.string,
               syncStateJSON: r["sync_state_json"]?.string ?? "{}", localStateJSON: r["local_state_json"]?.string ?? "{}",
               createdAt: i64(r["created_at"]) ?? 0, updatedAt: i64(r["updated_at"]) ?? 0, deletedAt: i64(r["deleted_at"]))
    }
    static func group(_ r: SQLiteRow) -> ArchivedGroupRow {
        ArchivedGroupRow(id: r["id"]!.string!, label: r["label"]?.string ?? "", archivedAt: i64(r["archived_at"]) ?? 0, tabsJSON: r["tabs_json"]?.string ?? "[]",
                         createdAt: i64(r["created_at"]) ?? 0, updatedAt: i64(r["updated_at"]) ?? 0, deletedAt: i64(r["deleted_at"]))
    }
    static func text(_ s: String?) -> SQLiteValue { s.map { .text($0) } ?? .null }

    // MARK: reads
    public func listSessions() throws -> [SessionRow] { try db.query("SELECT * FROM sessions WHERE deleted_at IS NULL ORDER BY order_key, id").map(Self.session) }
    public func listTabs(sessionId: String? = nil) throws -> [TabRow] {
        if let sessionId { return try db.query("SELECT * FROM tabs WHERE session_id = ? AND deleted_at IS NULL ORDER BY order_key, id", [.text(sessionId)]).map(Self.tab) }
        return try db.query("SELECT * FROM tabs WHERE deleted_at IS NULL ORDER BY session_id, order_key, id").map(Self.tab)
    }
    public func allRows() throws -> (sessions: [SessionRow], tabs: [TabRow], groups: [ArchivedGroupRow]) {
        (try db.query("SELECT * FROM sessions").map(Self.session), try db.query("SELECT * FROM tabs").map(Self.tab), try db.query("SELECT * FROM archived_groups").map(Self.group))
    }
    public func listArchivedGroups() throws -> [ArchivedGroupRow] { try db.query("SELECT * FROM archived_groups WHERE deleted_at IS NULL ORDER BY archived_at DESC, id").map(Self.group) }
    /// Device-local active tab per space (never journaled). Raw JSON object, as stored.
    public func localState(sessionId: String) throws -> JSObject {
        guard let s = try db.query("SELECT active_tab_json FROM session_local_state WHERE session_id = ?", [.text(sessionId)]).first?.values.first?.string else { return JSObject() }
        return (try? JSON.parse(s))?.objectValue ?? JSObject()
    }
    public func hasAny() throws -> Bool { (try db.query("SELECT COUNT(*) AS n FROM sessions").first?.values.first?.int ?? 0) > 0 }

    // MARK: writes
    func upsertSession(_ s: SessionRowUpsert, at now: Int64) throws -> Bool {
        let cur = try db.query("SELECT * FROM sessions WHERE id = ?", [.text(s.id)]).first.map(Self.session)
        if let cur, cur.deletedAt == nil, cur.name == s.name, cur.icon == s.icon, cur.tabFilter == s.tabFilter, cur.orderKey == s.orderKey { return false }
        try db.run("""
            INSERT INTO sessions (id, name, icon, tab_filter, order_key, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
                  ON CONFLICT(id) DO UPDATE SET name = excluded.name, icon = excluded.icon, tab_filter = excluded.tab_filter, order_key = excluded.order_key, updated_at = excluded.updated_at, deleted_at = NULL
            """, [.text(s.id), .text(s.name), Self.text(s.icon), Self.text(s.tabFilter), .text(s.orderKey), .integer(cur?.createdAt ?? now), .integer(now)])
        return true
    }

    func upsertTab(_ t: TabRowUpsert, at now: Int64) throws -> Bool {
        let cur = try db.query("SELECT * FROM tabs WHERE id = ?", [.text(t.id)]).first.map(Self.tab)
        let local = t.localStateJSON ?? cur?.localStateJSON ?? "{}"
        let syncSame = cur.map { c in c.deletedAt == nil && c.sessionId == t.sessionId && c.spaceId == t.spaceId && c.type == t.type && c.title == t.title
            && c.isPinned == t.isPinned && c.orderKey == t.orderKey && c.displayOrderKey == t.displayOrderKey && c.originTabId == t.originTabId
            && c.originSpaceId == t.originSpaceId && c.syncStateJSON == t.syncStateJSON } ?? false
        if syncSame && cur!.localStateJSON == local { return false }
        try db.run("""
            INSERT INTO tabs (id, session_id, space_id, type, title, is_pinned, order_key, display_order_key, origin_tab_id, origin_space_id, sync_state_json, local_state_json, created_at, updated_at, deleted_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
                  ON CONFLICT(id) DO UPDATE SET session_id = excluded.session_id, space_id = excluded.space_id, type = excluded.type, title = excluded.title, is_pinned = excluded.is_pinned,
                    order_key = excluded.order_key, display_order_key = excluded.display_order_key, origin_tab_id = excluded.origin_tab_id, origin_space_id = excluded.origin_space_id,
                    sync_state_json = excluded.sync_state_json, local_state_json = excluded.local_state_json, updated_at = excluded.updated_at, deleted_at = NULL
            """, [.text(t.id), .text(t.sessionId), .text(t.spaceId), .text(t.type), .text(t.title), .integer(t.isPinned ? 1 : 0), .text(t.orderKey), .text(t.displayOrderKey),
                  Self.text(t.originTabId), Self.text(t.originSpaceId), .text(t.syncStateJSON), .text(local), .integer(cur?.createdAt ?? now),
                  .integer(syncSame ? (cur?.updatedAt ?? now) : now)])
        return true
    }

    func upsertGroup(_ g: ArchivedGroupUpsert, at now: Int64) throws -> Bool {
        let cur = try db.query("SELECT * FROM archived_groups WHERE id = ?", [.text(g.id)]).first.map(Self.group)
        if let cur, cur.deletedAt == nil, cur.label == g.label, cur.archivedAt == g.archivedAt, cur.tabsJSON == g.tabsJSON { return false }
        try db.run("""
            INSERT INTO archived_groups (id, label, archived_at, tabs_json, created_at, updated_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, NULL)
                  ON CONFLICT(id) DO UPDATE SET label = excluded.label, archived_at = excluded.archived_at, tabs_json = excluded.tabs_json, updated_at = excluded.updated_at, deleted_at = NULL
            """, [.text(g.id), .text(g.label), .integer(g.archivedAt), .text(g.tabsJSON), .integer(cur?.createdAt ?? now), .integer(now)])
        return true
    }

    public func upsertSession(_ s: SessionRowUpsert) throws { if try upsertSession(s, at: now()) { onChange(.init(entity: "session", id: s.id, op: "upsert")) } }
    public func upsertTab(_ t: TabRowUpsert) throws { if try upsertTab(t, at: now()) { onChange(.init(entity: "tab", id: t.id, op: "upsert")) } }

    public func deleteSession(_ id: String) throws {
        let n = now()
        try transaction {
            try db.run("UPDATE sessions SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL", [.integer(n), .integer(n), .text(id)])
            try db.run("UPDATE tabs SET deleted_at = ?, updated_at = ? WHERE session_id = ? AND deleted_at IS NULL", [.integer(n), .integer(n), .text(id)])
        }
        onChange(.init(entity: "session", id: id, op: "delete"))
    }
    public func deleteTab(_ id: String) throws {
        let n = now()
        try db.run("UPDATE tabs SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL", [.integer(n), .integer(n), .text(id)])
        onChange(.init(entity: "tab", id: id, op: "delete"))
    }
    public func setLocalState(sessionId: String, activeTab: JSObject) throws {
        try db.run("INSERT INTO session_local_state (session_id, active_tab_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET active_tab_json = excluded.active_tab_json, updated_at = excluded.updated_at",
                   [.text(sessionId), .text(JSON.stringify(.object(activeTab)).string), .integer(now())])
    }

    public struct Counts: Equatable, Sendable { public var sessions = 0, tabs = 0, archivedGroups = 0 }

    /// `applySnapshot` — make the tables match the workspace: upsert what differs, tombstone what is gone (one transaction).
    @discardableResult
    public func applySnapshot(_ snap: TabPersistence.Snapshot) throws -> (upserted: Counts, tombstoned: Counts) {
        let n = now()
        var up = Counts(), tomb = Counts()
        var changed: [DataChange] = []
        try transaction {
            let keepS = Set(snap.sessions.map(\.id)), keepT = Set(snap.tabs.map(\.id)), keepG = Set(snap.archivedGroups.map(\.id))
            for s in snap.sessions where try upsertSession(s, at: n) { up.sessions += 1; changed.append(.init(entity: "session", id: s.id, op: "upsert")) }
            for t in snap.tabs where try upsertTab(t, at: n) { up.tabs += 1; changed.append(.init(entity: "tab", id: t.id, op: "upsert")) }
            for g in snap.archivedGroups where try upsertGroup(g, at: n) { up.archivedGroups += 1; changed.append(.init(entity: "archived_group", id: g.id, op: "upsert")) }
            for (table, keep, entity) in [("sessions", keepS, "session"), ("tabs", keepT, "tab"), ("archived_groups", keepG, "archived_group")] {
                for row in try db.query("SELECT id FROM \(table) WHERE deleted_at IS NULL") {
                    let id = row.values[0].string!
                    if keep.contains(id) { continue }
                    try db.run("UPDATE \(table) SET deleted_at = ?, updated_at = ? WHERE id = ?", [.integer(n), .integer(n), .text(id)])
                    switch table { case "sessions": tomb.sessions += 1; case "tabs": tomb.tabs += 1; default: tomb.archivedGroups += 1 }
                    changed.append(.init(entity: entity, id: id, op: "delete"))
                }
            }
        }
        changed.forEach(onChange)
        return (up, tomb)
    }

    /// `purgeTombstones`.
    public func purgeTombstones(olderThan ms: Int64) throws -> Int {
        let cutoff = now() - ms
        return try ["sessions", "tabs", "archived_groups"].reduce(0) { n, t in n + (try db.run("DELETE FROM \(t) WHERE deleted_at IS NOT NULL AND deleted_at < ?", [.integer(cutoff)]).changes) }
    }

    func transaction(_ body: () throws -> Void) throws {
        try db.exec("BEGIN IMMEDIATE")
        do { try body(); try db.exec("COMMIT") } catch { try? db.exec("ROLLBACK"); throw error }
    }
}
