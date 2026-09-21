import XCTest
@testable import BereanNative

final class SQLiteConnectionTests: XCTestCase {
    func testCrudRunQueryAndParameterTypes() throws {
        let db = try SQLiteConnection(path: ":memory:", label: "t", readOnly: false)
        try db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, n REAL, b BLOB)")
        let r = try db.run("INSERT INTO t (name, n, b) VALUES (?, ?, ?)", params: ["a", 1.5, ["__blob": Data([1, 2, 3]).base64EncodedString()]])
        XCTAssertEqual(r.changes, 1)
        XCTAssertEqual(r.lastInsertRowid, 1)
        _ = try db.run("INSERT INTO t (name, n) VALUES (?, ?)", params: ["b", 2])
        let rows = try db.query("SELECT id, name, n, b FROM t ORDER BY id", params: [])
        XCTAssertEqual(rows.count, 2)
        XCTAssertEqual(rows[0]["name"] as? String, "a")
        XCTAssertEqual(rows[0]["n"] as? Double, 1.5)
        XCTAssertEqual(rows[0]["id"] as? Int64, 1)
        XCTAssertEqual((rows[0]["b"] as? [String: String])?["__blob"], Data([1, 2, 3]).base64EncodedString())
        // integral doubles bind as INTEGER so `n = 2` matches
        XCTAssertEqual(rows[1]["n"] as? Int64, 2)
        XCTAssertTrue(rows[1]["b"] is NSNull)
        let missing = try db.query("SELECT * FROM t WHERE name = ?", params: ["zz"], )
        XCTAssertEqual(missing.count, 0)
    }

    func testFts5IsAvailable() throws {
        let db = try SQLiteConnection(path: ":memory:", label: "fts", readOnly: false)
        try db.exec("CREATE VIRTUAL TABLE f USING fts5(text); INSERT INTO f VALUES ('in the beginning'); INSERT INTO f VALUES ('the end');")
        let rows = try db.query("SELECT text FROM f WHERE f MATCH ?", params: ["beginning"])
        XCTAssertEqual(rows.map { $0["text"] as? String }, ["in the beginning"])
    }

    func testStatementCacheReuseAndParameterCountErrors() throws {
        let db = try SQLiteConnection(path: ":memory:", label: "c", readOnly: false)
        try db.exec("CREATE TABLE t (v TEXT)")
        for i in 0..<100 { _ = try db.run("INSERT INTO t (v) VALUES (?)", params: ["v\(i)"]) }
        XCTAssertEqual(try db.query("SELECT COUNT(*) AS n FROM t", params: [])[0]["n"] as? Int64, 100)
        XCTAssertThrowsError(try db.run("INSERT INTO t (v) VALUES (?)", params: []))
        XCTAssertThrowsError(try db.query("SELECT * FROM nope", params: []))
    }

    func testReadOnlyImmutableOpenRejectsWrites() throws {
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("ro-\(UUID().uuidString).db")
        do {
            let w = try SQLiteConnection(path: tmp.path, label: "w", readOnly: false)
            try w.exec("CREATE TABLE t (v TEXT); INSERT INTO t VALUES ('x')")
            w.close()
        }
        let ro = try SQLiteConnection(path: tmp.path, label: "ro", readOnly: true)
        XCTAssertEqual(try ro.query("SELECT v FROM t", params: []).count, 1)
        XCTAssertThrowsError(try ro.run("INSERT INTO t VALUES ('y')", params: []))
    }

    func testAttachAndTransactions() throws {
        let db = try SQLiteConnection(path: ":memory:", label: "a", readOnly: false)
        _ = try db.run("ATTACH DATABASE ? AS other", params: [":memory:"])
        try db.exec("CREATE TABLE other.o (x INTEGER); INSERT INTO other.o VALUES (7)")
        XCTAssertEqual(try db.query("SELECT x FROM other.o", params: [])[0]["x"] as? Int64, 7)
        try db.exec("CREATE TABLE t (v TEXT)")
        try db.exec("BEGIN IMMEDIATE")
        _ = try db.run("INSERT INTO t VALUES ('a')", params: [])
        try db.exec("ROLLBACK")
        XCTAssertEqual(try db.query("SELECT COUNT(*) AS n FROM t", params: [])[0]["n"] as? Int64, 0)
    }
}
