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
    #expect(try reader.rename(trailId: "pinned", name: "Renamed study", at: 50))
    #expect(try reader.updateRecap("Revised recap", trailId: "pinned", at: 60))
    #expect(try !reader.rename(trailId: "__loose_stops__", name: "Do not rename", at: 70))
    #expect(try !reader.updateRecap("Unavailable", trailId: "missing", at: 80))
    #expect(try reader.trails().first?.name == "Renamed study")
    #expect(try reader.trails().first?.recap == "Revised recap")
    #expect(try db.query("SELECT recap_user_edited FROM trail_sessions WHERE id = 'pinned'").first?["recap_user_edited"]?.int == 1)
    #expect(try reader.moveTrail("recent", .earlier))
    #expect(try reader.trails().map(\.id) == ["recent", "pinned"])
    #expect(try !reader.moveTrail("recent", .earlier))
    #expect(try !reader.moveTrail("__loose_stops__", .later))
    #expect(try db.query("SELECT sort_order FROM trail_sessions WHERE id = '__loose_stops__'").first?["sort_order"] == .null)
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
    let searchRecords = try reader.librarySearchRecords()
    #expect(Set(searchRecords.map(\.trailId)) == ["pinned", "recent"])
    #expect(searchRecords.contains { $0.sourceBook == "GEN" && $0.annotation == "A revised subnote" })
    #expect(searchRecords.contains { $0.title == "H7225" && $0.reason == "Beginning" && $0.annotation == "Compare the opening words" })
    #expect(searchRecords.contains { $0.destinationBook == "JHN" && $0.destinationVerse == 1 && $0.destinationEndVerse == 4 })
    let graph = StudyTrailService.map(stops: stops, connections: new)
    #expect(graph.stops.map(\.id) == ["first", "second"])
    #expect(graph.stops.first?.branches.map(\.id) == ["lex", "chapter", "range", "branch", "nested"])
    #expect(graph.stops.first?.branches.map(\.depth) == [0, 1, 0, 1, 2])
    #expect(graph.stops.last?.branches.map(\.id) == ["note"])
    #expect(graph.unplaced.isEmpty)
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


@Test func capturesExplicitCrossReferencesFromTheRecordedEditionAndVerse() throws {
    let db = try SQLiteConnection(readWritePath: ":memory:", create: true)
    try Migrator.migrate(db)
    let trail = StudyTrailService(db: db)
    try trail.start(name: "Cross references", id: "trail", at: 10)
    try trail.recordStop(trailId: "trail", id: "stop", bookId: "GEN", chapter: 2, translation: "lxx", at: 20)
    let destination: StudyTrailService.Connection.Destination = .scripture(bookId: "GEN", chapter: 2, verse: 4, endVerse: 5)
    func record(_ id: String, edition: String = "lxx", verse: Int = 1) throws -> Bool {
        try trail.recordCrossReference(destination, id: id, trailId: "trail", fromBook: "GEN",
                                       chapter: 2, translation: edition, verse: verse, at: 30)
    }
    #expect(try !record("wrong-edition", edition: "kjva"))
    #expect(try record("first"))
    #expect(try !record("duplicate"))
    #expect(try record("second-verse", verse: 2))
    try trail.transition(.pause, trailId: "trail", at: 40, intervalId: "pause")
    #expect(try !record("paused", verse: 3))
    #expect(try trail.connections(in: "trail").map(\.reason) == ["Cross reference", "Cross reference"])
    #expect(try db.query("SELECT origin_verse_pin_from FROM trail_connections ORDER BY id")
        .map { $0["origin_verse_pin_from"]?.int } == [1, 2])
}


@Test func recordsStrongsLookupsWithTheLegacyOriginAndDepth() throws {
    let db = try SQLiteConnection(readWritePath: ":memory:", create: true)
    try Migrator.migrate(db)
    let trail = StudyTrailService(db: db)
    try trail.start(name: "Word study", id: "trail", at: 10)
    try trail.recordStop(trailId: "trail", id: "stop", bookId: "GEN", chapter: 2, translation: "lxx", at: 20)
    func record(_ id: String, verse: Int) throws -> Bool {
        try trail.recordStrongsLookup("G2316", id: id, trailId: "trail", fromBook: "GEN", chapter: 2,
                                    translation: "lxx", verse: verse, at: 30)
    }
    #expect(try record("lookup", verse: 1))
    #expect(try !record("duplicate", verse: 1))
    #expect(try record("later", verse: 2))
    let rows = try trail.connections(in: "trail")
    #expect(rows.map(\.reason) == ["Strong's word · G2316", "Strong's word · G2316"])
    #expect(try db.query("SELECT strongs_depth FROM trail_connections").map { $0["strongs_depth"]?.string } == ["click", "click"])
}

@Test func createsAndAssignsLegacyTrailTagsWithoutChangingOtherTrails() throws {
    let db = try SQLiteConnection(readWritePath: ":memory:", create: true)
    try Migrator.migrate(db)
    let service = StudyTrailService(db: db)
    try service.start(name: "First", id: "first", at: 1)
    try service.start(name: "Second", id: "second", at: 2)
    #expect(try service.createAndAssignTag("Wisdom", id: "wisdom", to: "first", at: 3))
    #expect(try service.createAndAssignTag("WISDOM", id: "duplicate", to: "second", at: 4))
    #expect(try !service.createAndAssignTag("Missing", id: "missing", to: "absent", at: 5))
    #expect(try service.tags(for: "second").map(\.id) == ["wisdom"])
    #expect(try service.tags(for: "second").first?.assigned == true)
    try service.assignTag("wisdom", to: "first", assigned: false, at: 6)
    #expect(try service.tags(for: "first").first?.assigned == false)
    let searchableTags = try service.librarySearchRecords().filter(\.isTag)
    #expect(searchableTags.map(\.trailId) == ["second"])
    #expect(searchableTags.first?.title == "Wisdom")
}

@Test func editsLegacyTrailStickiesWithinTheirOwningTrail() throws {
    let db = try SQLiteConnection(readWritePath: ":memory:", create: true)
    try Migrator.migrate(db)
    let service = StudyTrailService(db: db)
    try service.start(name: "First", id: "first", at: 1)
    try service.start(name: "Second", id: "second", at: 2)
    #expect(try service.createSticky(id: "loose", in: "first", kind: .annotation, title: "", body: "Unanchored", at: 3))
    #expect(try service.recordStop(trailId: "first", id: "gen", bookId: "GEN", chapter: 1, translation: "kjva", at: 4))
    #expect(try service.recordStop(trailId: "first", id: "psa", bookId: "PSA", chapter: 1, translation: "kjva", at: 5))
    #expect(try service.createSticky(id: "section", in: "first", kind: .section, title: "Opening", body: "Body", at: 6))
    #expect(try !service.updateSticky(id: "section", in: "second", title: "Wrong", body: "", at: 7))
    #expect(try !service.deleteSticky(id: "section", in: "second"))
    #expect(try service.updateSticky(id: "section", in: "first", title: "Revised", body: "Section body", at: 8))
    let notes = try service.stickies(in: "first")
    #expect(notes.map(\.id) == ["loose", "section"])
    #expect(notes.map(\.anchorID) == [nil, "psa"])
    #expect(notes.last?.kind == .section)
    #expect(notes.last?.title == "Revised")
    let indexed = try service.librarySearchRecords()
    #expect(indexed.contains { $0.trailId == "first" && $0.title == "Revised" && $0.annotation == "Section body" })
    #expect(indexed.contains { $0.trailId == "first" && $0.annotation == "Unanchored" })
    #expect(try service.recordStop(trailId: "second", id: "foreign", bookId: "JHN", chapter: 1, translation: "kjva", at: 9))
    #expect(try !service.moveSticky(id: "section", in: "first", to: "foreign", at: 10))
    #expect(try !service.moveSticky(id: "section", in: "second", to: nil, at: 10))
    #expect(try service.moveSticky(id: "section", in: "first", to: "gen", at: 11))
    #expect(try !service.moveSticky(id: "section", in: "first", to: "gen", at: 12))
    let moved = try #require(service.stickies(in: "first").first { $0.id == "section" })
    #expect(moved.anchorID == "gen")
    #expect(moved.body == "Section body")
    #expect(try service.moveSticky(id: "section", in: "first", to: nil, at: 13))
    #expect(try service.stickies(in: "first").first { $0.id == "section" }?.anchorID == nil)
    try db.exec("INSERT INTO trail_collapse (scope, key, collapsed, updated_at) VALUES ('section', 'section', 1, 9)")
    #expect(try service.deleteSticky(id: "section", in: "first"))
    #expect(try db.query("SELECT key FROM trail_collapse WHERE key = 'section'").isEmpty)
    #expect(try service.stickies(in: "first").map(\.id) == ["loose"])
}

@Test func mergesAndSplitsTrailsLikeTheOriginal() throws {
    let db = try SQLiteConnection(readWritePath: ":memory:", create: true)
    try Migrator.migrate(db)
    try db.exec("""
        INSERT INTO trail_sessions (id, name, status, created_at, updated_at)
        VALUES ('a', 'A', 'ended', 1, 1), ('b', 'B', 'ended', 1, 1), ('__loose_stops__', 'Loose stops', 'live', 1, 1);
        INSERT INTO trail_nodes (id, trail_session_id, book_id, chapter, order_index, anchor_started_at)
        VALUES ('a1', 'a', 'GEN', 1, 0, 10), ('a2', 'a', 'GEN', 2, 1, 20), ('a3', 'a', 'GEN', 3, 2, 30),
               ('b1', 'b', 'EXO', 1, 0, 15), ('l1', '__loose_stops__', 'LEV', 1, 0, 40);
        INSERT INTO trail_connections (id, trail_session_id, from_node_id, to_kind, to_strongs_num, clarity_tier, created_at)
        VALUES ('c2', 'a', 'a2', 'lexicon', 'H1', 1, 21), ('c1', 'a', 'a1', 'lexicon', 'H2', 1, 11);
        """)
    let trail = StudyTrailService(db: db)

    // Split at a2: a2, a3 and the connection off a2 move to the new paused trail.
    #expect(try trail.split("a", at: "a2", newId: "s", name: "  ", at: 50))
    #expect(try db.query("SELECT name, status FROM trail_sessions WHERE id = 's'").first?["name"] == .text("Split session"))
    #expect(try trail.stops(in: "s").map(\.id) == ["a2", "a3"])
    #expect(try trail.stops(in: "a").map(\.id) == ["a1"])
    #expect(try db.query("SELECT trail_session_id FROM trail_connections WHERE id = 'c2'").first?["trail_session_id"] == .text("s"))
    #expect(try db.query("SELECT trail_session_id FROM trail_connections WHERE id = 'c1'").first?["trail_session_id"] == .text("a"))
    #expect(try !trail.split("a", at: "b1", newId: "x", name: nil, at: 51))   // stop not in that trail

    // Merge b into a: b's stop joins a in time order, b is deleted.
    #expect(try trail.merge("b", into: "a", at: 60))
    #expect(try trail.stops(in: "a").map(\.id) == ["a1", "b1"])
    #expect(try db.query("SELECT order_index FROM trail_nodes WHERE id = 'b1'").first?["order_index"]?.int == 1)
    #expect(try db.query("SELECT id FROM trail_sessions WHERE id = 'b'").isEmpty)
    #expect(try !trail.merge("a", into: "a", at: 61))

    // Merging out of the loose bucket empties it but keeps the row.
    #expect(try trail.merge("__loose_stops__", into: "s", at: 70))
    #expect(try db.query("SELECT id FROM trail_sessions WHERE id = '__loose_stops__'").count == 1)
    #expect(try trail.stops(in: "s").map(\.id) == ["a2", "a3", "l1"])
}
