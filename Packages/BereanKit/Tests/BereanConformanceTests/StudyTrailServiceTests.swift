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
        INSERT INTO trail_connections (id, trail_session_id, from_node_id, from_connection_id, to_kind, to_strongs_num, clarity_tier, reason_text, created_at)
        VALUES ('lex', 'pinned', 'first', NULL, 'lexicon', 'H7225', 1, 'Beginning', 5),
               ('other', 'recent', 'unrelated', NULL, 'lexicon', 'H1', 2, NULL, 1);
        INSERT INTO trail_connections (id, trail_session_id, from_node_id, from_connection_id, to_kind, to_book_id, to_chapter, to_verse, clarity_tier, created_at)
        VALUES ('chapter', 'pinned', 'first', 'lex', 'chapter', 'JHN', 1, 1, 1, 6);
        """)
    let reader = StudyTrailService(db: db)
    let trails = try reader.trails()
    #expect(trails.map(\.id) == ["pinned", "recent"])
    #expect(trails.map(\.stopCount) == [2, 0])
    #expect(trails.first?.recap == "A recap")
    let stops = try reader.stops(in: "pinned")
    #expect(stops.map(\.id) == ["first", "second"])
    #expect(stops.map(\.translation) == [nil, "lxx"])
    #expect(stops.first?.subnote == "A subnote")
    let connections = try reader.connections(in: "pinned")
    #expect(connections.map(\.id) == ["lex", "chapter"])
    #expect(connections.last?.parentId == "lex")
    #expect(connections.first?.reason == "Beginning")
    #expect(try !reader.updateConnectionNote("Wrong trail", connectionId: "lex", trailId: "recent"))
    #expect(try !reader.updateStopNote("Wrong trail", stopId: "first", trailId: "recent"))
    #expect(try reader.updateConnectionNote("Compare the opening words", connectionId: "lex", trailId: "pinned"))
    #expect(try reader.updateStopNote("A revised subnote", stopId: "first", trailId: "pinned"))
    let edited = try #require(reader.connections(in: "pinned").first)
    #expect(edited.userNote == "Compare the opening words")
    #expect(edited.reason == "Beginning")
    #expect(try reader.stops(in: "pinned").first?.subnote == "A revised subnote")
    guard let last = connections.last,
          case let .scripture(book, chapter, verse, endVerse) = last.destination else {
        Issue.record("Expected a Scripture destination")
        return
    }
    #expect(book == "JHN")
    #expect(chapter == 1)
    #expect(verse == 1)
    #expect(endVerse == nil)
    let range: StudyTrailService.Connection.Destination = .scripture(bookId: "JHN", chapter: 1, verse: 1, endVerse: 4)
    #expect(try !reader.addConnection(range, id: "foreign", fromStopId: "first", trailId: "recent", at: 7))
    #expect(try reader.addConnection(range, id: "range", fromStopId: "first", trailId: "pinned", at: 7))
    #expect(try !reader.addConnection(range, id: "duplicate", fromStopId: "first", trailId: "pinned", at: 8))
    #expect(try reader.addConnection(.note("note-id"), id: "note", fromStopId: "second", trailId: "pinned", at: 9))
    #expect(try reader.addConnection(.lexicon("G3056"), id: "branch", fromStopId: "first",
                                     trailId: "pinned", after: "range", at: 10))
    #expect(try reader.addConnection(.note("branch-note"), id: "nested", fromStopId: "first",
                                     trailId: "pinned", after: "branch", at: 11))
    #expect(try !reader.addConnection(.lexicon("G3056"), id: "duplicate-branch", fromStopId: "first",
                                      trailId: "pinned", after: "range", at: 12))
    #expect(try !reader.addConnection(.lexicon("G1"), id: "bad-stop", fromStopId: "second",
                                      trailId: "pinned", after: "range", at: 13))
    #expect(try !reader.addConnection(.lexicon("G1"), id: "bad-trail", fromStopId: "first",
                                      trailId: "pinned", after: "other", at: 14))
    #expect(try db.query("SELECT chain_depth FROM trail_connections WHERE id IN ('branch', 'nested') ORDER BY created_at")
        .map { $0["chain_depth"]?.int } == [1, 2])
    let new = try reader.connections(in: "pinned")
    #expect(new.map(\.id) == ["lex", "chapter", "range", "note", "branch", "nested"])
    let savedRange = try #require(new.first { $0.id == "range" })
    let savedNote = try #require(new.first { $0.id == "note" })
    if case .scripture("JHN", 1, 1, 4) = savedRange.destination {} else { Issue.record("Expected the saved verse range") }
    if case .note("note-id") = savedNote.destination {} else { Issue.record("Expected the saved note") }
    #expect(new.last?.parentId == "branch")
}

@Test func recordsAndFinishesTrailWithLegacyRows() throws {
    let db = try SQLiteConnection(readWritePath: ":memory:", create: true)
    try Migrator.migrate(db)
    let trail = StudyTrailService(db: db)
    try trail.start(name: "Study", id: "study", at: 100)
    #expect(try trail.recordStop(trailId: "study", id: "gen", bookId: "GEN", chapter: 1, translation: "kjva", at: 200))
    #expect(try trail.transition(.pause, trailId: "study", at: 300, intervalId: "pause"))
    #expect(try !trail.transition(.pause, trailId: "study", at: 310, intervalId: "extra"))
    #expect(try !trail.recordStop(trailId: "study", id: "ignored", bookId: "GEN", chapter: 2, translation: "kjva", at: 350))
    #expect(try trail.transition(.resume, trailId: "study", at: 400, intervalId: "unused"))
    #expect(try trail.recordStop(trailId: "study", id: "psa", bookId: "PSA", chapter: 22, translation: "lxx", at: 500))
    #expect(try trail.recordStop(trailId: "study", id: "unused", bookId: "GEN", chapter: 1, translation: "kjva", at: 550))
    #expect(try !trail.recordStop(trailId: "study", id: "unused", bookId: "GEN", chapter: 1, translation: "kjva", at: 560))
    #expect(try trail.transition(.finish, trailId: "study", at: 600, intervalId: "unused"))
    #expect(try trail.trails().first?.status == "ended")
    #expect(try trail.stops(in: "study").map(\.id) == ["gen", "psa"])
    #expect(try db.query("SELECT resumed_at FROM trail_paused_intervals").map { $0.values[0] } == [.integer(400)])
    #expect(try db.query("SELECT anchor_ended_at FROM trail_nodes ORDER BY order_index").map { $0.values[0] } == [.integer(600), .integer(550)])
    #expect(try !trail.transition(.resume, trailId: "study", at: 700, intervalId: "unused"))
}
