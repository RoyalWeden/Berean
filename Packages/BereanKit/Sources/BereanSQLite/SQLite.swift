import SQLite3

/// Minimal SQLite access over the system library (ADR-0006). Read-only bundled corpora first;
/// the mutable user store (M3) adds write/transaction support behind the same types.
public enum SQLiteValue: Equatable, Sendable {
    case null
    case integer(Int64)
    case real(Double)
    case text(String)
    case blob([UInt8])

    public var int: Int? { if case .integer(let i) = self { return Int(i) } else if case .real(let d) = self { return Int(exactly: d) } else { return nil } }
    public var string: String? { if case .text(let s) = self { return s } else { return nil } }
}

public struct SQLiteRow: Sendable {
    public let columns: [String]
    public let values: [SQLiteValue]
    public subscript(_ name: String) -> SQLiteValue? { columns.firstIndex(of: name).map { values[$0] } }
}

public struct SQLiteError: Error, Equatable, Sendable, CustomStringConvertible {
    public let code: Int32
    public let message: String
    public var description: String { "SQLite error \(code): \(message)" }
}

/// One connection. Not thread-safe by itself: owners confine it (an actor or a serial queue).
public final class SQLiteConnection: @unchecked Sendable {
    private var handle: OpaquePointer?
    public let path: String
    private var columnCache: [String: Set<String>] = [:]

    /// Opens an existing database strictly read-only (never creates, never writes, no WAL files).
    public init(readOnlyPath path: String) throws(SQLiteError) {
        self.path = path
        var db: OpaquePointer?
        let rc = sqlite3_open_v2(path, &db, SQLITE_OPEN_READONLY | SQLITE_OPEN_NOMUTEX, nil)
        guard rc == SQLITE_OK, let db else {
            let msg = db.map { String(cString: sqlite3_errmsg($0)) } ?? "open failed"
            if let db { sqlite3_close_v2(db) }
            throw SQLiteError(code: rc, message: msg)
        }
        handle = db
    }

    deinit { if let handle { sqlite3_close_v2(handle) } }

    public static var libraryVersion: String { String(cString: sqlite3_libversion()) }

    public func query(_ sql: String, _ params: [SQLiteValue] = []) throws(SQLiteError) -> [SQLiteRow] {
        guard let handle else { throw SQLiteError(code: SQLITE_MISUSE, message: "closed") }
        var stmt: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &stmt, nil) == SQLITE_OK, let stmt else {
            throw SQLiteError(code: sqlite3_errcode(handle), message: String(cString: sqlite3_errmsg(handle)))
        }
        defer { sqlite3_finalize(stmt) }
        let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
        for (i, p) in params.enumerated() {
            let idx = Int32(i + 1)
            switch p {
            case .null: sqlite3_bind_null(stmt, idx)
            case .integer(let v): sqlite3_bind_int64(stmt, idx, v)
            case .real(let v): sqlite3_bind_double(stmt, idx, v)
            case .text(let v): sqlite3_bind_text(stmt, idx, v, -1, transient)
            case .blob(let v): v.withUnsafeBytes { _ = sqlite3_bind_blob(stmt, idx, $0.baseAddress, Int32(v.count), transient) }
            }
        }
        let n = sqlite3_column_count(stmt)
        let columns = (0..<n).map { String(cString: sqlite3_column_name(stmt, $0)) }
        var rows: [SQLiteRow] = []
        while true {
            let rc = sqlite3_step(stmt)
            if rc == SQLITE_DONE { break }
            guard rc == SQLITE_ROW else { throw SQLiteError(code: rc, message: String(cString: sqlite3_errmsg(handle))) }
            var values: [SQLiteValue] = []
            values.reserveCapacity(Int(n))
            for c in 0..<n {
                switch sqlite3_column_type(stmt, c) {
                case SQLITE_INTEGER: values.append(.integer(sqlite3_column_int64(stmt, c)))
                case SQLITE_FLOAT: values.append(.real(sqlite3_column_double(stmt, c)))
                case SQLITE_TEXT: values.append(.text(String(cString: sqlite3_column_text(stmt, c))))
                case SQLITE_BLOB:
                    let len = Int(sqlite3_column_bytes(stmt, c))
                    let p = sqlite3_column_blob(stmt, c)
                    values.append(.blob(p.map { Array(UnsafeRawBufferPointer(start: $0, count: len)) } ?? []))
                default: values.append(.null)
                }
            }
            rows.append(SQLiteRow(columns: columns, values: values))
        }
        return rows
    }

    /// `hasColumn` (src/platform/db/DatabaseAdapter.ts), cached per table.
    public func hasColumn(_ table: String, _ column: String) -> Bool {
        if let cached = columnCache[table] { return cached.contains(column) }
        let cols = Set(((try? query("SELECT name FROM pragma_table_info(?)", [.text(table)])) ?? []).compactMap { $0.values.first?.string })
        columnCache[table] = cols
        return cols.contains(column)
    }
}
