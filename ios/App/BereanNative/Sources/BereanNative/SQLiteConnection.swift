import Foundation
import SQLite3

/// Thin, synchronous wrapper over one `sqlite3*` connection using the SQLite that ships with iOS
/// (FTS5 is compiled in — verified against Apple's `pragma compile_options`, see
/// docs/mobile/decisions.md D-002). Not thread-safe by itself; `BereanSQLitePlugin` drives each
/// connection from its own serial queue.
///
/// Values crossing the JS bridge are JSON: TEXT → String, INTEGER → Int64, REAL → Double,
/// NULL → NSNull, BLOB → `["__blob": base64]` (and the reverse for parameters).
final class SQLiteConnection {
    enum SQLiteError: Error, LocalizedError {
        case open(String)
        case prepare(String, String)
        case step(String, String)
        case bind(String)
        case misuse(String)

        var errorDescription: String? {
            switch self {
            case .open(let m): return "open: \(m)"
            case .prepare(let m, let sql): return "prepare: \(m) — \(sql.prefix(200))"
            case .step(let m, let sql): return "step: \(m) — \(sql.prefix(200))"
            case .bind(let m): return "bind: \(m)"
            case .misuse(let m): return m
            }
        }
    }

    private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    private(set) var db: OpaquePointer?
    let label: String
    let readOnly: Bool

    /// Prepared-statement cache keyed by SQL text (mirrors the desktop adapter's cache).
    private var statements: [String: OpaquePointer] = [:]
    private var statementOrder: [String] = []
    private let statementCacheMax = 64

    /// `path` is an absolute filesystem path. `readOnly` opens with `immutable=1` (no journal, no
    /// locking) which is what a file inside the read-only app bundle needs.
    init(path: String, label: String, readOnly: Bool) throws {
        self.label = label
        self.readOnly = readOnly
        var handle: OpaquePointer?
        let rc: Int32
        if readOnly {
            let uri = "file:\(path)?immutable=1"
            rc = sqlite3_open_v2(uri, &handle, SQLITE_OPEN_READONLY | SQLITE_OPEN_URI | SQLITE_OPEN_NOMUTEX, nil)
        } else {
            rc = sqlite3_open_v2(path, &handle, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_NOMUTEX, nil)
        }
        guard rc == SQLITE_OK, let opened = handle else {
            let msg = handle.map { String(cString: sqlite3_errmsg($0)) } ?? "sqlite3_open_v2 rc=\(rc)"
            if let h = handle { sqlite3_close(h) }
            throw SQLiteError.open(msg)
        }
        db = opened
        sqlite3_busy_timeout(opened, 5000)
    }

    deinit { close() }

    func close() {
        guard let handle = db else { return }
        for (_, stmt) in statements { sqlite3_finalize(stmt) }
        statements.removeAll()
        statementOrder.removeAll()
        sqlite3_close_v2(handle)
        db = nil
    }

    private func errmsg() -> String {
        guard let handle = db else { return "connection closed" }
        return String(cString: sqlite3_errmsg(handle))
    }

    // MARK: exec (multi-statement, no params)

    func exec(_ sql: String) throws {
        guard let handle = db else { throw SQLiteError.misuse("connection closed") }
        var err: UnsafeMutablePointer<CChar>?
        let rc = sqlite3_exec(handle, sql, nil, nil, &err)
        if rc != SQLITE_OK {
            let msg = err.map { String(cString: $0) } ?? errmsg()
            if let e = err { sqlite3_free(e) }
            throw SQLiteError.step(msg, sql)
        }
    }

    // MARK: prepared statements

    private func prepare(_ sql: String) throws -> OpaquePointer {
        guard let handle = db else { throw SQLiteError.misuse("connection closed") }
        if let cached = statements[sql] {
            sqlite3_reset(cached)
            sqlite3_clear_bindings(cached)
            return cached
        }
        var stmt: OpaquePointer?
        var tail: UnsafePointer<CChar>?
        let rc = sqlite3_prepare_v2(handle, sql, -1, &stmt, &tail)
        guard rc == SQLITE_OK, let prepared = stmt else {
            throw SQLiteError.prepare(errmsg(), sql)
        }
        if let t = tail, String(cString: t).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false {
            // More than one statement: run the rest through exec semantics is wrong for a
            // parameterised call; the shared adapter only ever sends one statement here.
            sqlite3_finalize(prepared)
            throw SQLiteError.misuse("run/query accept a single statement; use exec for scripts")
        }
        // LRU insert
        if statements.count >= statementCacheMax, let oldest = statementOrder.first {
            if let old = statements.removeValue(forKey: oldest) { sqlite3_finalize(old) }
            statementOrder.removeFirst()
        }
        statements[sql] = prepared
        statementOrder.append(sql)
        return prepared
    }

    private func bind(_ params: [Any], to stmt: OpaquePointer) throws {
        let expected = Int(sqlite3_bind_parameter_count(stmt))
        if params.count != expected {
            throw SQLiteError.bind("expected \(expected) parameters, got \(params.count)")
        }
        for (i, value) in params.enumerated() {
            let idx = Int32(i + 1)
            let rc: Int32
            switch value {
            case is NSNull:
                rc = sqlite3_bind_null(stmt, idx)
            case let s as String:
                rc = sqlite3_bind_text(stmt, idx, s, -1, SQLiteConnection.transient)
            case let b as Bool:
                rc = sqlite3_bind_int64(stmt, idx, b ? 1 : 0)
            case let n as Int:
                rc = sqlite3_bind_int64(stmt, idx, Int64(n))
            case let n as Int64:
                rc = sqlite3_bind_int64(stmt, idx, n)
            case let n as Double:
                // JSON numbers arrive as Double; keep integral values as INTEGER so `= ?` on
                // INTEGER columns and rowid comparisons behave exactly like better-sqlite3.
                if n.rounded() == n, abs(n) < 9.007199254740992e15 {
                    rc = sqlite3_bind_int64(stmt, idx, Int64(n))
                } else {
                    rc = sqlite3_bind_double(stmt, idx, n)
                }
            case let n as NSNumber:
                if CFGetTypeID(n) == CFBooleanGetTypeID() {
                    rc = sqlite3_bind_int64(stmt, idx, n.boolValue ? 1 : 0)
                } else if n.doubleValue.rounded() == n.doubleValue, abs(n.doubleValue) < 9.007199254740992e15 {
                    rc = sqlite3_bind_int64(stmt, idx, n.int64Value)
                } else {
                    rc = sqlite3_bind_double(stmt, idx, n.doubleValue)
                }
            case let dict as [String: Any]:
                guard let b64 = dict["__blob"] as? String, let data = Data(base64Encoded: b64) else {
                    throw SQLiteError.bind("object parameter must be {\"__blob\": base64}")
                }
                rc = data.withUnsafeBytes { ptr in
                    sqlite3_bind_blob(stmt, idx, ptr.baseAddress, Int32(data.count), SQLiteConnection.transient)
                }
            default:
                throw SQLiteError.bind("unsupported parameter type at index \(i): \(type(of: value))")
            }
            if rc != SQLITE_OK { throw SQLiteError.bind(errmsg()) }
        }
    }

    private func columnValue(_ stmt: OpaquePointer, _ col: Int32) -> Any {
        switch sqlite3_column_type(stmt, col) {
        case SQLITE_INTEGER:
            return sqlite3_column_int64(stmt, col)
        case SQLITE_FLOAT:
            return sqlite3_column_double(stmt, col)
        case SQLITE_TEXT:
            return String(cString: sqlite3_column_text(stmt, col))
        case SQLITE_BLOB:
            let count = Int(sqlite3_column_bytes(stmt, col))
            guard count > 0, let base = sqlite3_column_blob(stmt, col) else { return ["__blob": ""] }
            return ["__blob": Data(bytes: base, count: count).base64EncodedString()]
        default:
            return NSNull()
        }
    }

    /// SELECT-style: every row as `[column: value]`, column names exactly as SQLite reports them.
    func query(_ sql: String, params: [Any]) throws -> [[String: Any]] {
        let stmt = try prepare(sql)
        try bind(params, to: stmt)
        let count = sqlite3_column_count(stmt)
        var names: [String] = []
        names.reserveCapacity(Int(count))
        for c in 0..<count { names.append(String(cString: sqlite3_column_name(stmt, c))) }
        var rows: [[String: Any]] = []
        while true {
            let rc = sqlite3_step(stmt)
            if rc == SQLITE_ROW {
                var row: [String: Any] = [:]
                row.reserveCapacity(Int(count))
                for c in 0..<count { row[names[Int(c)]] = columnValue(stmt, c) }
                rows.append(row)
            } else if rc == SQLITE_DONE {
                break
            } else {
                let msg = errmsg()
                sqlite3_reset(stmt)
                throw SQLiteError.step(msg, sql)
            }
        }
        sqlite3_reset(stmt)
        return rows
    }

    /// INSERT/UPDATE/DELETE-style: returns `changes` and `lastInsertRowid` like better-sqlite3.
    func run(_ sql: String, params: [Any]) throws -> (changes: Int64, lastInsertRowid: Int64) {
        guard let handle = db else { throw SQLiteError.misuse("connection closed") }
        let stmt = try prepare(sql)
        try bind(params, to: stmt)
        var rc = sqlite3_step(stmt)
        // A statement with a RETURNING clause (unused today) would yield rows; drain them.
        while rc == SQLITE_ROW { rc = sqlite3_step(stmt) }
        if rc != SQLITE_DONE {
            let msg = errmsg()
            sqlite3_reset(stmt)
            throw SQLiteError.step(msg, sql)
        }
        sqlite3_reset(stmt)
        return (Int64(sqlite3_changes(handle)), sqlite3_last_insert_rowid(handle))
    }
}
