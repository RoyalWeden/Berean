import Foundation
import Capacitor

/// Capacitor plugin exposing the system SQLite to the shared TypeScript services
/// (src/platform/ios/capacitorSqliteAdapter.ts). See docs/mobile/decisions.md D-002.
///
/// Paths are symbolic so JavaScript never sees absolute device paths:
///   `bundle:data/kjva.db`   → a read-only file inside the app bundle (opened with immutable=1)
///   `appsupport:berean.db`  → <Library/Application Support/Berean>/berean.db (read-write, created)
///   `memory:`               → an in-memory database (tests / self-test screen)
///
/// Every connection runs on its own serial queue; calls resolve on that queue's completion so
/// two overlapping JS calls against one handle never interleave inside SQLite.
@objc(BereanSQLitePlugin)
public class BereanSQLitePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BereanSQLitePlugin"
    public let jsName = "BereanSQLite"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "close", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "exec", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "run", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "query", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "batch", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "attach", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "detach", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fileInfo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "backup", returnType: CAPPluginReturnPromise),
    ]

    private struct Handle {
        let connection: SQLiteConnection
        let queue: DispatchQueue
    }

    private var handles: [Int: Handle] = [:]
    private var nextHandle = 1
    private let registry = DispatchQueue(label: "app.berean.sqlite.registry")

    // MARK: path resolution

    static func resolve(path: String) throws -> (url: URL, readOnly: Bool) {
        if path == "memory:" {
            return (URL(fileURLWithPath: ":memory:"), false)
        }
        if let rest = path.stripPrefix("bundle:") {
            guard let base = Bundle.main.resourceURL else { throw SQLiteConnection.SQLiteError.misuse("no bundle resource URL") }
            let url = base.appendingPathComponent(rest)
            guard FileManager.default.fileExists(atPath: url.path) else {
                throw SQLiteConnection.SQLiteError.misuse("bundled database not found: \(rest)")
            }
            return (url, true)
        }
        if let rest = path.stripPrefix("appsupport:") {
            let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            let dir = support.appendingPathComponent("Berean", isDirectory: true)
            if !FileManager.default.fileExists(atPath: dir.path) {
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                // The user database (berean.db) stays in device backups: iCloud sync is opt-in, so
                // for a user who never enables it the backup is the only durable copy (R017).
                // Re-creatable caches are excluded per directory below.
                var values = URLResourceValues()
                values.isExcludedFromBackup = false
                var mutable = dir
                try? mutable.setResourceValues(values)
            }
            // Purgeable subdirectories (downloaded transcript packs, TTS caches/models) are excluded
            // from backup — they are re-downloadable and can be large.
            for cache in ["downloads", "tts-cache", "tts-model"] where rest.hasPrefix(cache + "/") || rest == cache {
                let cacheDir = dir.appendingPathComponent(cache, isDirectory: true)
                if !FileManager.default.fileExists(atPath: cacheDir.path) {
                    try? FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)
                }
                var values = URLResourceValues()
                values.isExcludedFromBackup = true
                var mutable = cacheDir
                try? mutable.setResourceValues(values)
            }
            return (dir.appendingPathComponent(rest), false)
        }
        throw SQLiteConnection.SQLiteError.misuse("unsupported path scheme: \(path)")
    }

    private func withHandle(_ call: CAPPluginCall, _ body: @escaping (SQLiteConnection) throws -> [String: Any]) {
        guard let id = call.getInt("handle") else { call.reject("missing handle"); return }
        let handle: Handle? = registry.sync { handles[id] }
        guard let h = handle else { call.reject("unknown handle \(id)"); return }
        h.queue.async {
            do {
                let result = try body(h.connection)
                call.resolve(result)
            } catch {
                call.reject(error.localizedDescription, "SQLITE_ERROR", error)
            }
        }
    }

    private static func params(from call: CAPPluginCall, key: String = "params") -> [Any] {
        (call.getArray(key) as? [Any]) ?? []
    }

    // MARK: methods

    @objc func open(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else { call.reject("missing path"); return }
        let forceReadOnly = call.getBool("readOnly") ?? false
        do {
            let (url, bundled) = try BereanSQLitePlugin.resolve(path: path)
            let readOnly = bundled || forceReadOnly
            let sqlitePath = path == "memory:" ? ":memory:" : url.path
            let conn = try SQLiteConnection(path: sqlitePath, label: path, readOnly: readOnly)
            if !readOnly {
                try conn.exec("PRAGMA journal_mode = WAL")
                try conn.exec("PRAGMA foreign_keys = ON")
            }
            let id: Int = registry.sync {
                let id = nextHandle
                nextHandle += 1
                handles[id] = Handle(connection: conn, queue: DispatchQueue(label: "app.berean.sqlite.\(id)"))
                return id
            }
            call.resolve(["handle": id, "readOnly": readOnly])
        } catch {
            call.reject("open failed: \(error.localizedDescription)", "SQLITE_OPEN", error)
        }
    }

    @objc func close(_ call: CAPPluginCall) {
        guard let id = call.getInt("handle") else { call.reject("missing handle"); return }
        let handle: Handle? = registry.sync {
            let h = handles[id]
            handles[id] = nil
            return h
        }
        guard let h = handle else { call.resolve(); return }
        h.queue.async {
            h.connection.close()
            call.resolve()
        }
    }

    @objc func exec(_ call: CAPPluginCall) {
        guard let sql = call.getString("sql") else { call.reject("missing sql"); return }
        withHandle(call) { conn in
            try conn.exec(sql)
            return [:]
        }
    }

    @objc func run(_ call: CAPPluginCall) {
        guard let sql = call.getString("sql") else { call.reject("missing sql"); return }
        let params = BereanSQLitePlugin.params(from: call)
        withHandle(call) { conn in
            let r = try conn.run(sql, params: params)
            return ["changes": r.changes, "lastInsertRowid": r.lastInsertRowid]
        }
    }

    @objc func query(_ call: CAPPluginCall) {
        guard let sql = call.getString("sql") else { call.reject("missing sql"); return }
        let params = BereanSQLitePlugin.params(from: call)
        withHandle(call) { conn in
            ["rows": try conn.query(sql, params: params)]
        }
    }

    /// Executes `statements` ([{sql, params, kind: "run"|"query"}]) inside ONE transaction; rolls
    /// back on the first failure. Used by the adapter for transactional batches so a transaction
    /// costs one bridge round-trip instead of one per statement.
    @objc func batch(_ call: CAPPluginCall) {
        guard let statements = call.getArray("statements") as? [[String: Any]] else { call.reject("missing statements"); return }
        withHandle(call) { conn in
            try conn.exec("BEGIN IMMEDIATE")
            var results: [[String: Any]] = []
            do {
                for st in statements {
                    guard let sql = st["sql"] as? String else { throw SQLiteConnection.SQLiteError.misuse("statement without sql") }
                    let params = (st["params"] as? [Any]) ?? []
                    let kind = (st["kind"] as? String) ?? "run"
                    if kind == "query" {
                        results.append(["rows": try conn.query(sql, params: params)])
                    } else {
                        let r = try conn.run(sql, params: params)
                        results.append(["changes": r.changes, "lastInsertRowid": r.lastInsertRowid])
                    }
                }
                try conn.exec("COMMIT")
            } catch {
                try? conn.exec("ROLLBACK")
                throw error
            }
            return ["results": results]
        }
    }

    @objc func attach(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), let alias = call.getString("alias") else { call.reject("missing path/alias"); return }
        guard alias.range(of: "^[A-Za-z_][A-Za-z0-9_]*$", options: .regularExpression) != nil else { call.reject("invalid alias"); return }
        withHandle(call) { conn in
            let (url, readOnly) = try BereanSQLitePlugin.resolve(path: path)
            let file = path == "memory:" ? ":memory:" : (readOnly ? "file:\(url.path)?immutable=1" : url.path)
            _ = try conn.run("ATTACH DATABASE ? AS \(alias)", params: [file])
            return [:]
        }
    }

    @objc func detach(_ call: CAPPluginCall) {
        guard let alias = call.getString("alias") else { call.reject("missing alias"); return }
        guard alias.range(of: "^[A-Za-z_][A-Za-z0-9_]*$", options: .regularExpression) != nil else { call.reject("invalid alias"); return }
        withHandle(call) { conn in
            try conn.exec("DETACH DATABASE \(alias)")
            return [:]
        }
    }

    /// Existence + size of a symbolic path (used by the self-test screen and the bundled-data
    /// inventory check at startup).
    /// A consistent copy of an open database (`VACUUM INTO`, safe with WAL — never a raw file
    /// copy) into Application Support/Berean/backups/<name>, keeping the newest `keep` copies.
    /// Written to a temporary name and renamed, so a kill never leaves a half backup looking whole.
    /// The folder is excluded from device backups (the device backup already has berean.db).
    @objc func backup(_ call: CAPPluginCall) {
        guard let name = call.getString("name"), !name.contains("/"), !name.contains("..") else { call.reject("bad backup name"); return }
        let keep = max(1, call.getInt("keep") ?? 3)
        withHandle(call) { conn in
            let (dbURL, _) = try BereanSQLitePlugin.resolve(path: "appsupport:berean.db")
            let dir = dbURL.deletingLastPathComponent().appendingPathComponent("backups", isDirectory: true)
            let fm = FileManager.default
            if !fm.fileExists(atPath: dir.path) {
                try fm.createDirectory(at: dir, withIntermediateDirectories: true)
                var values = URLResourceValues(); values.isExcludedFromBackup = true
                var mutable = dir; try? mutable.setResourceValues(values)
            }
            let tmp = dir.appendingPathComponent(name + ".tmp")
            let dest = dir.appendingPathComponent(name)
            try? fm.removeItem(at: tmp)
            try conn.exec("VACUUM INTO '\(tmp.path.replacingOccurrences(of: "'", with: "''"))'")
            try? fm.removeItem(at: dest)
            try fm.moveItem(at: tmp, to: dest)
            let files = (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.creationDateKey]))?
                .filter { $0.pathExtension == "db" }
                .sorted { ((try? $0.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast) > ((try? $1.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast) } ?? []
            for old in files.dropFirst(keep) { try? fm.removeItem(at: old) }
            return ["path": "appsupport:backups/\(name)", "kept": min(files.count, keep)]
        }
    }

    @objc func fileInfo(_ call: CAPPluginCall) {
        guard let path = call.getString("path") else { call.reject("missing path"); return }
        do {
            let (url, readOnly) = try BereanSQLitePlugin.resolve(path: path)
            let attrs = try? FileManager.default.attributesOfItem(atPath: url.path)
            let size = (attrs?[.size] as? NSNumber)?.int64Value ?? 0
            var out: [String: Any] = ["exists": attrs != nil, "size": size, "readOnly": readOnly]
            // Creation time identifies this copy of the file: a restored backup or a copy is a new
            // file (the sync engine forks its device id on a change — DATA-SAFE-030).
            if let created = attrs?[.creationDate] as? Date { out["created"] = Int64(created.timeIntervalSince1970 * 1000) }
            call.resolve(out)
        } catch {
            call.resolve(["exists": false, "size": 0, "readOnly": false])
        }
    }
}

private extension String {
    func stripPrefix(_ prefix: String) -> String? {
        guard hasPrefix(prefix) else { return nil }
        return String(dropFirst(prefix.count))
    }
}
