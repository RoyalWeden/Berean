import Testing
import BereanCore
import BereanSQLite
import BereanStore
import BereanWorkspace

struct WorkspaceAtomicSaveTests {
    @Test func committedChangesAlreadyHaveTheirActiveTabWhenReported() throws {
        let db = try database()
        let log = EventLog()
        let activeTab = activeScripture("genesis")
        let activeJSON = JSON.stringify(.object(activeTab)).string
        let stamp: Int64 = 1_000
        let service = SessionsService(db: db, now: { stamp }, onChange: { change in
            let local = try? db.query("SELECT active_tab_json, updated_at FROM session_local_state WHERE session_id = 'study-a'")
            #expect(local?.first?.values == [.text(activeJSON), .integer(stamp)])
            log.items.append(change)
        })
        let built = snapshot(sessions: [study("study-a", name: "Study", tabID: "genesis")], group: "group")

        let changes = try service.applySnapshot(built, localState: ["study-a": activeTab])
        #expect(changes.upserted.sessions == 1)
        #expect(changes.upserted.tabs == 1)
        #expect(changes.upserted.archivedGroups == 1)
        #expect(try service.listSessions().first?.updatedAt == stamp)
        #expect(try service.localState(sessionId: "study-a") == activeTab)
        #expect(log.items == [
            DataChange(entity: "session", id: "study-a", op: "upsert"),
            DataChange(entity: "tab", id: "genesis", op: "upsert"),
            DataChange(entity: "archived_group", id: "group", op: "upsert"),
        ])
    }

    @Test(arguments: [false, true])
    func failedLocalStateWriteRollsBackSnapshotAndCanBeRetried(updating: Bool) throws {
        let db = try database()
        let clock = FakeClock()
        let log = EventLog()
        let service = SessionsService(db: db, now: { clock.t }, onChange: { log.items.append($0) })
        let following = study("study-z", name: "Following", tabID: "acts")
        let initial = snapshot(sessions: [
            study("study-a", name: "Original", tabID: "genesis"),
            following,
            study("study-old", name: "Removed", tabID: "ruth"),
        ], group: "old-group")
        let originalSelection = activeScripture("genesis")
        var localState = ["study-a": originalSelection]
        if updating { localState[following.id] = activeScripture(nil) }
        try service.applySnapshot(initial, localState: localState)
        log.items.removeAll()

        let before = try service.allRows()
        let localBefore = try db.query("SELECT * FROM session_local_state ORDER BY session_id").map(\.values)
        let operation = updating ? "UPDATE" : "INSERT"
        // FAIL preserves earlier writes in the transaction and even the triggering row change.
        try db.exec("""
            CREATE TRIGGER reject_active_tab AFTER \(operation) ON session_local_state
            WHEN NEW.session_id = 'study-z'
            BEGIN SELECT RAISE(FAIL, 'reject active tab'); END
            """)
        clock.t += 1_000
        let replacement = snapshot(sessions: [
            study("study-a", name: "Renamed", tabID: "john"),
            following,
        ], group: "new-group")
        let selected = ["study-a": activeScripture("john"), "study-z": activeScripture("acts")]
        #expect(throws: SQLiteError.self) { try service.applySnapshot(replacement, localState: selected) }

        let afterFailure = try service.allRows()
        #expect(afterFailure.sessions == before.sessions)
        #expect(afterFailure.tabs == before.tabs)
        #expect(afterFailure.groups == before.groups)
        #expect(try db.query("SELECT * FROM session_local_state ORDER BY session_id").map(\.values) == localBefore)
        #expect(log.items.isEmpty)

        try db.exec("DROP TRIGGER reject_active_tab")
        let changes = try service.applySnapshot(replacement, localState: selected)
        #expect(changes.upserted.sessions == 1)
        #expect(changes.upserted.tabs == 1)
        #expect(changes.upserted.archivedGroups == 1)
        #expect(changes.tombstoned.sessions == 1)
        #expect(changes.tombstoned.tabs == 2)
        #expect(changes.tombstoned.archivedGroups == 1)
        #expect(try service.listSessions().map(\.id) == ["study-a", "study-z"])
        #expect(try service.listTabs().map(\.id) == ["john", "acts"])
        #expect(try service.listArchivedGroups().map(\.id) == ["new-group"])
        #expect(try service.localState(sessionId: "study-a") == selected["study-a"])
        #expect(try service.localState(sessionId: "study-z") == selected["study-z"])
        let reported = log.items.map { "\($0.entity)/\($0.id)/\($0.op)" }.sorted()
        #expect(reported == [
            "archived_group/new-group/upsert", "archived_group/old-group/delete",
            "session/study-a/upsert", "session/study-old/delete",
            "tab/genesis/delete", "tab/john/upsert", "tab/ruth/delete",
        ])
    }

    private func database() throws -> SQLiteConnection {
        let db = try SQLiteConnection(readWritePath: ":memory:", create: true)
        try db.exec("PRAGMA foreign_keys = ON")
        try Migrator.migrate(db)
        return db
    }

    private func activeScripture(_ tabID: String?) -> JSObject {
        var active = JSObject()
        active["scripture"] = tabID.map { .string(JSString($0)) } ?? .null
        active["notes"] = .null
        return active
    }

    private func study(_ id: String, name: String, tabID: String) -> Session {
        let tab = Tab(id: tabID, spaceId: .scripture, type: TabType.bible.rawValue, title: tabID)
        return Session(id: id, name: name, tabs: [.scripture: [tab]])
    }

    private func snapshot(sessions: [Session], group: String) -> TabPersistence.Snapshot {
        let archive = ArchivedGroup(id: group, label: group, archivedAt: 100, tabsJSON: "[]")
        return TabPersistence.buildSnapshot(sessions: sessions, displayOrders: [:], archivedGroups: [archive]).snapshot
    }
}
