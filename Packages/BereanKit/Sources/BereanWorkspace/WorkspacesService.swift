import Foundation
import BereanSQLite

/// Saved workspaces (named layout + tab snapshot) — port of workspacesService.ts. `layoutJSON` / `stateJSON`
/// are stored verbatim so workspaces saved by either app load in the other.
public struct SavedWorkspace: Equatable, Sendable, Identifiable {
    public var id, name: String
    public var createdAt: Int64
    public var layoutJSON: String?
    public var stateJSON: String?
}

public final class WorkspacesService: @unchecked Sendable {
    let db: SQLiteConnection
    let now: @Sendable () -> Int64
    let uuid: @Sendable () -> String
    let onChange: @Sendable (DataChange) -> Void
    public init(db: SQLiteConnection, now: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) },
                uuid: @escaping @Sendable () -> String = { UUID().uuidString.lowercased() }, onChange: @escaping @Sendable (DataChange) -> Void = { _ in }) {
        self.db = db; self.now = now; self.uuid = uuid; self.onChange = onChange
    }

    public func list() throws -> [SavedWorkspace] {
        try db.query("SELECT id, name, created_at FROM workspaces ORDER BY created_at DESC").map {
            SavedWorkspace(id: $0.values[0].string!, name: $0.values[1].string ?? "", createdAt: SessionsService.i64($0.values[2]) ?? 0)
        }
    }
    public func save(name: String, layoutJSON: String, stateJSON: String) throws -> SavedWorkspace {
        let id = uuid(), n = now()
        try db.run("INSERT INTO workspaces (id, name, layout_json, state_json, created_at) VALUES (?, ?, ?, ?, ?)", [.text(id), .text(name), .text(layoutJSON), .text(stateJSON), .integer(n)])
        onChange(DataChange(entity: "workspace", id: id, op: "upsert"))
        return SavedWorkspace(id: id, name: name, createdAt: n)
    }
    public func load(_ id: String) throws -> SavedWorkspace? {
        try db.query("SELECT * FROM workspaces WHERE id = ?", [.text(id)]).first.map {
            SavedWorkspace(id: $0["id"]!.string!, name: $0["name"]?.string ?? "", createdAt: SessionsService.i64($0["created_at"]) ?? 0, layoutJSON: $0["layout_json"]?.string, stateJSON: $0["state_json"]?.string)
        }
    }
    public func delete(_ id: String) throws { try db.run("DELETE FROM workspaces WHERE id = ?", [.text(id)]); onChange(DataChange(entity: "workspace", id: id, op: "delete")) }
    public func rename(_ id: String, to name: String) throws { try db.run("UPDATE workspaces SET name = ? WHERE id = ?", [.text(name), .text(id)]); onChange(DataChange(entity: "workspace", id: id, op: "upsert")) }
}
