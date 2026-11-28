import Testing
import Observation
import BereanCore
import BereanSQLite
import BereanStore
import BereanWorkspace

@MainActor @Suite("Canonical workspace writer")
struct WorkspaceStoreTests {
    private func fixture() -> Session {
        Session(id: "study", name: "Study", tabs: [.scripture: [
            Tab(id: "john", spaceId: .scripture, type: "bible", title: "John 1",
                state: JSValue(dictionaryLiteral: ("bookId", "JHN"), ("chapter", 1), ("translation", "kjva")).objectValue!),
            Tab(id: "psalm", spaceId: .scripture, type: "bible", title: "Psalm 3",
                state: JSValue(dictionaryLiteral: ("bookId", "PSA"), ("chapter", 3), ("translation", "lxx")).objectValue!)
        ]], activeTabId: [.scripture: "john"])
    }

    @Test func failedSaveRetainsCommittedKeysAndPendingEditsForRetry() throws {
        let db = try SQLiteConnection(readWritePath: ":memory:", create: true)
        try Migrator.migrate(db)
        let service = SessionsService(db: db, now: { 1_800_000_000_000 })
        let store = WorkspaceStore(service: service, sessions: [fixture()])
        #expect(try store.save())
        let committed = store.orderKeys
        let before = try service.allRows()
        store.sessions[0].tabs[.scripture]?.reverse()
        store.sessions[0].tabs[.scripture]?.append(Tab(id: "note", spaceId: .scripture, type: "note", title: "Note"))
        store.sessions[0].activeTabId[.scripture] = "note"
        let pending = store.sessions
        try db.exec("CREATE TEMP TRIGGER fail_selection BEFORE INSERT ON session_local_state BEGIN SELECT RAISE(ABORT, 'test selection failure'); END")
        #expect(throws: SQLiteError.self) { try store.save() }
        #expect(store.orderKeys == committed)
        #expect(store.sessions == pending)
        #expect(try service.allRows().sessions == before.sessions)
        #expect(try service.allRows().tabs == before.tabs)
        #expect(try service.localState(sessionId: "study")["scripture"] == .string("john"))
        try db.exec("DROP TRIGGER fail_selection")
        #expect(try store.save())
        #expect(store.orderKeys != committed)
        #expect(try service.listTabs().map(\.id) == ["psalm", "john", "note"])
        #expect(try service.localState(sessionId: "study")["scripture"] == .string("note"))
    }

    @Test func hydratedKeysAndLocalOnlySelectionDoNotChurnSyncedRows() throws {
        let db = try SQLiteConnection(readWritePath: ":memory:", create: true)
        try Migrator.migrate(db)
        let clock = FakeClock()
        let service = SessionsService(db: db, now: { clock.t })
        let initial = WorkspaceStore(service: service, sessions: [fixture()], displayOrders: ["study": ["psalm", "john"]])
        try initial.save()
        let rows = try service.allRows()
        let hydrated = TabPersistence.hydrate(sessions: rows.sessions, tabs: rows.tabs, groups: rows.groups,
                                             localState: ["study": ["scripture": "john"]])
        let reopened = WorkspaceStore(service: service, sessions: hydrated.sessions,
                                      displayOrders: hydrated.displayOrders, archivedGroups: hydrated.archivedGroups,
                                      orderKeys: hydrated.keys)
        clock.t += 5_000
        reopened.sessions[0].activeTabId[.scripture] = "psalm"
        try reopened.save()
        #expect(reopened.orderKeys == hydrated.keys)
        #expect(try service.allRows().sessions == rows.sessions)
        #expect(try service.allRows().tabs == rows.tabs)
        #expect(try service.localState(sessionId: "study")["scripture"] == .string("psalm"))
    }

    @Test func nestedCanonicalEditsInvalidateObservation() {
        final class Probe: @unchecked Sendable { var changes = 0 }
        let store = WorkspaceStore(sessions: [fixture()])
        let probe = Probe()
        withObservationTracking {
            _ = store.sessions[0].tabs[.scripture]?.first?.title
        } onChange: { probe.changes += 1 }
        store.sessions[0].tabs[.scripture]?[0].title = "John 2"
        #expect(probe.changes == 1)
    }

    @Test func unavailablePersistenceDoesNotAcceptUncommittedOrderKeys() throws {
        let store = WorkspaceStore(sessions: [fixture()])
        #expect(!store.canPersist)
        #expect(try store.save() == false)
        #expect(store.orderKeys == .init())
        #expect(store.sessions == [fixture()])
    }
}
