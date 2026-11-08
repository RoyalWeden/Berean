import Testing
import BereanCore
import BereanSQLite
import BereanStore
import Foundation

func schemaDump(_ db: SQLiteConnection) throws -> JSValue {
    func v(_ x: SQLiteValue) -> JSValue {
        switch x { case .null: return .null; case .integer(let i): return .number(Double(i)); case .real(let d): return .number(d); case .text(let s): return .string(JSString(s)); case .blob: return .null }
    }
    var o = JSObject()
    o["objects"] = .array(try db.query("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name").map { r in
        var x = JSObject(); for (i, c) in r.columns.enumerated() { x[JSString(c)] = v(r.values[i]) }; return .object(x)
    })
    o["settings"] = .array(try db.query("SELECT key, value FROM settings ORDER BY key").map { r in
        var x = JSObject(); x["key"] = v(r.values[0]); x["value"] = v(r.values[1]); return .object(x)
    })
    o["versions"] = .array(try db.query("SELECT version FROM schema_version ORDER BY rowid").map { v($0.values[0]) })
    return .object(o)
}

@Suite("schema golden") struct StoreConformanceTests {
    let g: JSObject
    init() throws { g = try Golden.load("schema") }

    func freshDB() throws -> SQLiteConnection {
        let db = try SQLiteConnection(readWritePath: ":memory:", create: true)
        try db.exec("PRAGMA foreign_keys = ON")
        return db
    }

    @Test func freshDatabaseMatchesEveryCheckpoint() throws {
        #expect(Migrator.recordedSchemaVersion == g["schemaVersion"]!.int)
        let cps = g["checkpoints"]!.object
        for (name, want) in cps.entries where name.string != "final" {
            let v = Int(name.string.dropFirst())!
            let db = try freshDB()
            try Migrator.migrate(db, to: v)
            #expect(try schemaDump(db) == want, "checkpoint \(name)")
        }
        let db = try freshDB()
        let applied = try Migrator.migrate(db)
        #expect(applied.count == g.arr("steps").count)
        #expect(try schemaDump(db) == cps["final"]!)
        #expect(try Migrator.migrate(db).isEmpty)   // idempotent
    }

    @Test func pureSQLUpgradeFromV48MatchesFresh() throws {
        let db = try freshDB()
        try Migrator.migrate(db, to: 48)
        var backups: [(Int, Int)] = []
        let applied = try Migrator.migrate(db, backup: { backups.append(($0, $1)) })
        #expect(applied == [49])
        #expect(backups.count == 1 && backups[0] == (48, 49))
        #expect(try schemaDump(db) == g["checkpoints"]!["final"]!)
    }

    @Test func refusals() throws {
        // Newer library: untouched.
        let newer = try freshDB()
        try Migrator.migrate(newer)
        try newer.run("INSERT INTO schema_version (version) VALUES (?)", [.integer(Int64(Migrator.recordedSchemaVersion + 1))])
        #expect(throws: Migrator.MigrationError.newerThanSupported(found: Migrator.recordedSchemaVersion + 1, supported: Migrator.recordedSchemaVersion)) { try Migrator.migrate(newer) }

        // Library needing data-dependent legacy steps.
        let old = try freshDB()
        try Migrator.migrate(old, to: 41)
        #expect(throws: Migrator.MigrationError.requiresLegacyUpgrade(found: 41)) { try Migrator.migrate(old) }
        #expect(try Migrator.currentVersion(old) == 41)
        // From v42 the remaining steps are replay-safe and reach the same schema as a fresh library.
        let v42 = try freshDB()
        try Migrator.migrate(v42, to: 42)
        #expect(try Migrator.migrate(v42) == Array(43...49))
        #expect(try schemaDump(v42) == g["checkpoints"]!["final"]!)

        // Failed backup stops the migration; nothing changes.
        let db = try freshDB()
        try Migrator.migrate(db, to: 48)
        struct Boom: Error {}
        #expect(throws: Migrator.MigrationError.self) { try Migrator.migrate(db, backup: { _, _ in throw Boom() }) }
        #expect(try Migrator.currentVersion(db) == 48)

        // A failing step rolls back and leaves the previous version.
        let steps = Migrator.recordedSteps + [Migrator.Step(version: 50, statements: [.exec("CREATE TABLE t50 (x)"), .exec("THIS IS NOT SQL")])]
        let db2 = try freshDB()
        try Migrator.migrate(db2)
        #expect(throws: Migrator.MigrationError.self) { try Migrator.migrate(db2, to: 50, steps: steps) }
        #expect(try Migrator.currentVersion(db2) == 49)
        #expect(try db2.query("SELECT name FROM sqlite_master WHERE name = 't50'").isEmpty)
    }

    @Test func userDatabaseOpensWithWALAndForeignKeys() throws {
        let path = "\(repoDataDir)/../build/apple/test-user-\(UInt32.random(in: 0...UInt32.max)).db"
        let udb = try UserDatabase(path: path)
        try Migrator.migrate(udb.connection)
        #expect(try udb.connection.query("PRAGMA journal_mode").first?.values.first?.string == "wal")
        #expect(try udb.connection.query("PRAGMA foreign_keys").first?.values.first?.int == 1)
        let n = try udb.transaction { c in try c.run("INSERT INTO settings (key, value) VALUES ('native_test', '1')").changes }
        #expect(n == 1)
        struct Stop: Error {}
        #expect(throws: Stop.self) { try udb.transaction { c in try c.run("INSERT INTO settings (key, value) VALUES ('native_test2', '1')"); throw Stop() } }
        #expect(try udb.connection.query("SELECT key FROM settings WHERE key = 'native_test2'").isEmpty)
        for suffix in ["", "-wal", "-shm"] { unlink(path + suffix) }
    }
}
