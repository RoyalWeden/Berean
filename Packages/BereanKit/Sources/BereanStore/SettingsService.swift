import BereanCore
import BereanSQLite

/// The device-local `settings` key/value table (JSON values) — port of settingsService.ts. Never synced.
public final class SettingsService: @unchecked Sendable {
    let db: SQLiteConnection
    let onChange: @Sendable (String) -> Void
    public init(db: SQLiteConnection, onChange: @escaping @Sendable (String) -> Void = { _ in }) { self.db = db; self.onChange = onChange }

    public func get(_ key: String) throws -> JSValue? {
        guard let s = try db.query("SELECT value FROM settings WHERE key = ?", [.text(key)]).first?.values.first?.string else { return nil }
        return try? JSON.parse(s)
    }
    public func set(_ key: String, _ value: JSValue) throws {
        try db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [.text(key), .text(JSON.stringify(value).string)])
        onChange(key)
    }
    public func all() throws -> [String: JSValue] {
        var out: [String: JSValue] = [:]
        for r in try db.query("SELECT key, value FROM settings") {
            if let k = r.values[0].string, let v = r.values[1].string, let j = try? JSON.parse(v) { out[k] = j }
        }
        return out
    }
}
