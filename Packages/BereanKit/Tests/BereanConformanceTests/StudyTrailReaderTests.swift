import BereanSQLite
import BereanStore
import Testing

@Test func readsLegacyTrailOrderAndStops() throws {
    let db = try SQLiteConnection(readWritePath: ":memory:", create: true)
    try Migrator.migrate(db)
    try db.exec("""
        INSERT INTO trail_sessions (id, name, status, created_at, updated_at, sort_order, recap_text)
        VALUES ('recent', 'Recent', 'live', 1, 20, NULL, NULL),
               ('pinned', 'Study', 'ended', 1, 10, 0, 'A recap'),
               ('__loose_stops__', 'Loose stops', 'live', 1, 30, NULL, NULL);
        INSERT INTO trail_nodes (id, trail_session_id, book_id, chapter, order_index, anchor_started_at, translation, cached_subnote)
        VALUES ('second', 'pinned', 'PSA', 22, 2, 2, 'lxx', NULL),
               ('first', 'pinned', 'GEN', 1, 1, 1, NULL, 'A subnote'),
               ('loose', '__loose_stops__', 'GEN', 2, 1, 1, NULL, NULL);
        """)
    let reader = StudyTrailReader(db: db)
    let trails = try reader.trails()
    #expect(trails.map(\.id) == ["pinned", "recent"])
    #expect(trails.map(\.stopCount) == [2, 0])
    #expect(trails.first?.recap == "A recap")
    let stops = try reader.stops(in: "pinned")
    #expect(stops.map(\.id) == ["first", "second"])
    #expect(stops.map(\.translation) == [nil, "lxx"])
    #expect(stops.first?.subnote == "A subnote")
}
