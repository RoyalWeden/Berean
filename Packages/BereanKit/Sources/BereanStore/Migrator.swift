import BereanSQLite

/// berean.db schema migrations for the native apps (ADR-0009).
///
/// The statements are the ones the TypeScript migrations (src/platform/db/bereanMigrations.ts) execute
/// on a new database, recorded per version and generated into `RecordedMigrations.swift`. Replay is exact
/// for a new database and for upgrades whose pending steps are pure SQL (every version after 17). Older
/// libraries, libraries from a newer app, damaged files and a failed pre-migration backup all stop
/// migration with the database untouched — stricter than the legacy runner, which logs a failed backup
/// and continues (spec §5.1: a failed pre-migration backup must stop the migration).
public enum Migrator {
    public enum Statement: Sendable {
        case exec(String)
        case run(String, [SQLiteValue])
    }
    public struct Step: Sendable {
        public let version: Int
        public let statements: [Statement]
        public init(version: Int, statements: [Statement]) { self.version = version; self.statements = statements }
    }

    public enum MigrationError: Error, Equatable, Sendable {
        /// The library was written by a newer Berean; this build must not touch it.
        case newerThanSupported(found: Int, supported: Int)
        /// Pending steps include data-dependent legacy migrations (≤ v17): open it once in the current Berean first.
        case requiresLegacyUpgrade(found: Int)
        /// `PRAGMA quick_check` failed: never migrate, sync or overwrite a damaged library.
        case damaged(String)
        /// The pre-migration backup failed, so nothing was changed.
        case backupFailed(String)
        /// A step failed and was rolled back; the library stays at `version`.
        case stepFailed(version: Int, message: String)
    }

    /// Highest version a data-dependent (JavaScript) migration has; upgrades must start above it.
    static let lastDataDependentVersion = 17

    public static func currentVersion(_ db: SQLiteConnection) throws(SQLiteError) -> Int {
        try db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)")
        return try db.query("SELECT MAX(version) as v FROM schema_version").first?.values.first?.int ?? 0
    }

    public static func quickCheck(_ db: SQLiteConnection) -> (ok: Bool, detail: String) {
        guard let rows = try? db.query("PRAGMA quick_check") else { return (false, "quick_check failed to run") }
        let msgs = rows.compactMap { $0.values.first?.string }
        let ok = msgs == ["ok"]
        return (ok, ok ? "ok" : msgs.prefix(5).joined(separator: "; "))
    }

    /// Migrates `db` to `target` (default: everything recorded). `backup` runs before an existing library
    /// is upgraded; if it throws, migration stops. Returns the versions applied.
    @discardableResult
    public static func migrate(_ db: SQLiteConnection, to target: Int = recordedSchemaVersion, steps: [Step] = recordedSteps,
                               backup: ((_ from: Int, _ to: Int) throws -> Void)? = nil) throws -> [Int] {
        let supported = steps.last?.version ?? 0
        let current = try currentVersion(db)
        if current > max(supported, target) { throw MigrationError.newerThanSupported(found: current, supported: max(supported, target)) }
        let pending = steps.filter { $0.version > current && $0.version <= target }
        if pending.isEmpty { return [] }
        if current > 0 {
            let health = quickCheck(db)
            if !health.ok { throw MigrationError.damaged(health.detail) }
            if pending.contains(where: { $0.version <= lastDataDependentVersion }) { throw MigrationError.requiresLegacyUpgrade(found: current) }
            if let backup {
                do { try backup(current, pending.last!.version) } catch { throw MigrationError.backupFailed(String(describing: error)) }
            }
        }
        var applied: [Int] = []
        for step in pending {
            do {
                try db.exec("BEGIN IMMEDIATE")
                for s in step.statements {
                    switch s {
                    case .exec(let sql): try db.exec(sql)
                    case .run(let sql, let params): try db.run(sql, params)
                    }
                }
                try db.run("INSERT INTO schema_version (version) VALUES (?)", [.integer(Int64(step.version))])
                try db.exec("COMMIT")
                applied.append(step.version)
            } catch {
                try? db.exec("ROLLBACK")
                throw MigrationError.stepFailed(version: step.version, message: String(describing: error))
            }
        }
        return applied
    }
}

/// The native user library connection: WAL + foreign keys, exactly as electron/db/berean.ts opens it.
public final class UserDatabase: @unchecked Sendable {
    public let connection: SQLiteConnection

    public init(path: String, create: Bool = true) throws {
        connection = try SQLiteConnection(readWritePath: path, create: create)
        try connection.exec("PRAGMA journal_mode = WAL")
        try connection.exec("PRAGMA foreign_keys = ON")
    }

    /// Runs `body` in one transaction (BEGIN IMMEDIATE … COMMIT, rolled back on error).
    public func transaction<T>(_ body: (SQLiteConnection) throws -> T) throws -> T {
        try connection.exec("BEGIN IMMEDIATE")
        do {
            let r = try body(connection)
            try connection.exec("COMMIT")
            return r
        } catch {
            try? connection.exec("ROLLBACK")
            throw error
        }
    }
}
