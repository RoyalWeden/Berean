import BereanSQLite

/// Uses the existing Study Trail tables. The caller owns and serializes the connection.
public struct StudyTrailService {
    public struct Trail: Identifiable, Sendable {
        public let id: String
        public let name: String
        public let status: String
        public let recap: String?
        public let stopCount: Int
    }

    public struct Stop: Identifiable, Sendable {
        public let id: String
        public let bookId: String
        public let chapter: Int
        public let translation: String?
        public let subnote: String?
    }

    public struct Connection: Identifiable, Sendable {
        public enum Destination: Sendable {
            case scripture(bookId: String, chapter: Int, verse: Int?, endVerse: Int?)
            case lexicon(String)
            case note(String)
            case other(String)
        }

        public let id: String
        public let fromStopId: String
        public let parentId: String?
        public let destination: Destination
        public let reason: String?
        public let userNote: String?
    }

    public struct MapConnection: Identifiable, Sendable {
        public let connection: Connection
        public let depth: Int
        public var id: String { connection.id }
    }

    public struct MapStop: Identifiable, Sendable {
        public let stop: Stop
        public let branches: [MapConnection]
        public var id: String { stop.id }
    }

    /// Keeps recorded stop and sibling order. Invalid parent references remain visible at the
    /// stop level, and a cycle in imported data cannot prevent the remaining rows from loading.
    public static func map(stops: [Stop], connections: [Connection])
        -> (stops: [MapStop], unplaced: [MapConnection]) {
        let byStop = Dictionary(grouping: connections, by: \.fromStopId)
        let knownStops = Set(stops.map(\.id))
        func branches(_ rows: [Connection]) -> [MapConnection] {
            let ids = Set(rows.map(\.id))
            let children = Dictionary(grouping: rows) { row in
                row.parentId.flatMap { ids.contains($0) ? $0 : nil }
            }
            var stack = (children[nil] ?? []).reversed().map { ($0, 0) }
            var seen = Set<String>()
            var ordered: [MapConnection] = []
            func visitPending() {
                while let (connection, depth) = stack.popLast() {
                    guard seen.insert(connection.id).inserted else { continue }
                    ordered.append(MapConnection(connection: connection, depth: depth))
                    stack.append(contentsOf: (children[connection.id] ?? []).reversed().map { ($0, depth + 1) })
                }
            }
            visitPending()
            for row in rows where !seen.contains(row.id) {
                stack.append((row, 0))
                visitPending()
            }
            return ordered
        }
        let placed = stops.map { MapStop(stop: $0, branches: branches(byStop[$0.id] ?? [])) }
        let unplaced = connections.filter { !knownStops.contains($0.fromStopId) }
        let byMissingStop = Dictionary(grouping: unplaced, by: \.fromStopId)
        var seenMissingStops = Set<String>()
        return (placed, unplaced.filter { seenMissingStops.insert($0.fromStopId).inserted }
            .flatMap { branches(byMissingStop[$0.fromStopId] ?? []) })
    }

    public enum Transition {
        case pause, resume, finish
    }

    public enum TrailError: Error {
        case emptyName
    }

    private let db: SQLiteConnection

    public init(db: SQLiteConnection) { self.db = db }

    public func trails() throws -> [Trail] {
        let rows = try db.query("""
            SELECT s.id, s.name, s.status, s.recap_text,
                   (SELECT count(*) FROM trail_nodes n WHERE n.trail_session_id = s.id) AS stop_count
            FROM trail_sessions s
            WHERE s.id != '__loose_stops__'
            ORDER BY s.sort_order IS NULL, s.sort_order, s.updated_at DESC, s.id
            """)
        return rows.compactMap { row in
            guard let id = row["id"]?.string, let name = row["name"]?.string,
                  let status = row["status"]?.string, let count = row["stop_count"]?.int else { return nil }
            return Trail(id: id, name: name, status: status, recap: row["recap_text"]?.string, stopCount: count)
        }
    }

    public func stops(in trailId: String) throws -> [Stop] {
        let rows = try db.query("""
            SELECT id, book_id, chapter, translation, cached_subnote
            FROM trail_nodes WHERE trail_session_id = ? ORDER BY order_index, id
            """, [.text(trailId)])
        return rows.compactMap { row in
            guard let id = row["id"]?.string, let book = row["book_id"]?.string,
                  let chapter = row["chapter"]?.int else { return nil }
            return Stop(id: id, bookId: book, chapter: chapter, translation: row["translation"]?.string,
                        subnote: row["cached_subnote"]?.string)
        }
    }

    public func connections(in trailId: String) throws -> [Connection] {
        let rows = try db.query("""
            SELECT id, from_node_id, from_connection_id, to_kind, to_book_id, to_chapter,
                   to_verse, to_verse_end, to_strongs_num, to_note_id, reason_text, user_note
            FROM trail_connections WHERE trail_session_id = ? ORDER BY created_at, id
            """, [.text(trailId)])
        return rows.compactMap { row in
            guard let id = row["id"]?.string, let from = row["from_node_id"]?.string,
                  let kind = row["to_kind"]?.string else { return nil }
            let destination: Connection.Destination
            switch kind {
            case "chapter", "compare":
                if let book = row["to_book_id"]?.string, let chapter = row["to_chapter"]?.int {
                    destination = .scripture(bookId: book, chapter: chapter, verse: row["to_verse"]?.int,
                                             endVerse: row["to_verse_end"]?.int)
                } else {
                    destination = .other(kind)
                }
            case "lexicon":
                destination = row["to_strongs_num"]?.string.map { .lexicon($0) } ?? .other(kind)
            case "note":
                destination = row["to_note_id"]?.string.map { .note($0) } ?? .other(kind)
            default:
                destination = .other(kind)
            }
            return Connection(id: id, fromStopId: from, parentId: row["from_connection_id"]?.string,
                              destination: destination, reason: row["reason_text"]?.string,
                              userNote: row["user_note"]?.string)
        }
    }
    @discardableResult
    public func start(name: String, id: String, at time: Int64) throws -> String {
        guard !name.isEmpty else { throw TrailError.emptyName }
        try db.run("""
            INSERT INTO trail_sessions (id, name, status, created_at, updated_at)
            VALUES (?, ?, 'live', ?, ?)
            """, [.text(id), .text(name), .integer(time), .integer(time)])
        return id
    }

    @discardableResult
    public func transition(_ action: Transition, trailId: String, at time: Int64,
                           intervalId: String) throws -> Bool {
        guard trailId != "__loose_stops__" else { return false }
        return try transaction {
            let trail = SQLiteValue.text(trailId)
            let stamp = SQLiteValue.integer(time)
            switch action {
            case .pause:
                guard try db.run("""
                    UPDATE trail_sessions SET status = 'paused', updated_at = ?
                    WHERE id = ? AND status = 'live'
                    """, [stamp, trail]).changes == 1 else { return false }
                try db.run("""
                    INSERT INTO trail_paused_intervals (id, trail_session_id, paused_at)
                    VALUES (?, ?, ?)
                    """, [.text(intervalId), trail, stamp])
            case .resume:
                guard try db.run("""
                    UPDATE trail_sessions SET status = 'live', updated_at = ?
                    WHERE id = ? AND status = 'paused'
                    """, [stamp, trail]).changes == 1 else { return false }
                try closePauseIntervals(trail, at: stamp)
            case .finish:
                guard try db.run("""
                    UPDATE trail_sessions
                    SET status = 'ended', updated_at = ?, possibly_accidental = (
                        ? - created_at < 30000
                        AND (SELECT count(*) FROM trail_nodes WHERE trail_session_id = ?) <= 1
                        AND NOT EXISTS (SELECT 1 FROM trail_connections WHERE trail_session_id = ?)
                    )
                    WHERE id = ? AND status IN ('live', 'paused')
                    """, [stamp, stamp, trail, trail, trail]).changes == 1 else { return false }
                try closePauseIntervals(trail, at: stamp)
                try closeAnchors(trail, at: stamp)
            }
            return true
        }
    }

    /// Explicitly add the open chapter. Reopening an existing stop preserves its place in the trail.
    @discardableResult
    public func recordStop(trailId: String, id: String, bookId: String, chapter: Int,
                           translation: String, at time: Int64) throws -> Bool {
        guard trailId != "__loose_stops__" else { return false }
        return try transaction {
            let trail = SQLiteValue.text(trailId)
            let stamp = SQLiteValue.integer(time)
            let book = SQLiteValue.text(bookId)
            let chapter = SQLiteValue.integer(Int64(chapter))
            let text = SQLiteValue.text(translation)
            guard try db.run("""
                UPDATE trail_sessions SET updated_at = ? WHERE id = ? AND status = 'live'
                """, [stamp, trail]).changes == 1 else { return false }
            let existing = try db.query("""
                SELECT id, anchor_ended_at FROM trail_nodes
                WHERE trail_session_id = ? AND book_id = ? AND chapter = ? AND translation = ?
                  AND revisit_of_node_id IS NULL
                ORDER BY order_index, id LIMIT 1
                """, [trail, book, chapter, text]).first
            if existing?["anchor_ended_at"] == .null { return false }
            try closeAnchors(trail, at: stamp)
            if let existingId = existing?["id"]?.string {
                try db.run("UPDATE trail_nodes SET anchor_ended_at = NULL WHERE id = ?", [.text(existingId)])
            } else {
                try db.run("""
                    INSERT INTO trail_nodes
                        (id, trail_session_id, book_id, chapter, translation, anchor_started_at, order_index)
                    SELECT ?, ?, ?, ?, ?, ?, COALESCE(MAX(order_index) + 1, 0)
                    FROM trail_nodes WHERE trail_session_id = ?
                    """, [.text(id), trail, book, chapter, text, stamp, trail])
            }
            return true
        }
    }

    /// Records an intentional cross-reference jump from an already recorded Scripture stop.
    @discardableResult
    public func recordCrossReference(_ destination: Connection.Destination, id: String, trailId: String,
                                     fromBook: String, chapter: Int, translation: String,
                                     verse: Int?, at time: Int64) throws -> Bool {
        guard case .scripture = destination else { return false }
        return try recordReaderConnection(destination, id: id, trailId: trailId, fromBook: fromBook,
                                          chapter: chapter, translation: translation, verse: verse,
                                          reason: "Cross reference", at: time)
    }

    @discardableResult
    public func recordStrongsLookup(_ strongs: String, id: String, trailId: String, fromBook: String,
                                   chapter: Int, translation: String, verse: Int?, at time: Int64) throws -> Bool {
        try recordReaderConnection(.lexicon(strongs), id: id, trailId: trailId, fromBook: fromBook,
                                   chapter: chapter, translation: translation, verse: verse,
                                   reason: "Strong's word · \(strongs)", at: time)
    }

    private func recordReaderConnection(_ destination: Connection.Destination, id: String, trailId: String,
                                        fromBook: String, chapter: Int, translation: String, verse: Int?,
                                        reason: String, at time: Int64) throws -> Bool {
        let source = try db.query("""
            SELECT n.id FROM trail_nodes n
            JOIN trail_sessions s ON s.id = n.trail_session_id
            WHERE s.id = ? AND s.status = 'live' AND n.book_id = ? AND n.chapter = ? AND n.translation = ?
            ORDER BY n.anchor_ended_at IS NOT NULL, n.anchor_started_at DESC, n.order_index DESC, n.id
            LIMIT 1
            """, [.text(trailId), .text(fromBook), .integer(Int64(chapter)), .text(translation)]).first?["id"]?.string
        guard let source else { return false }
        return try addConnection(destination, id: id, fromStopId: source, trailId: trailId,
                                 after: nil, at: time, reason: reason, originVerse: verse)
    }

    /// Adds an explicit connection, optionally continuing an existing legacy chain.
    @discardableResult
    public func addConnection(_ destination: Connection.Destination, id: String, fromStopId: String,
                              trailId: String, after parentId: String? = nil, at time: Int64) throws -> Bool {
        try addConnection(destination, id: id, fromStopId: fromStopId, trailId: trailId,
                          after: parentId, at: time, reason: nil, originVerse: nil)
    }

    private func addConnection(_ destination: Connection.Destination, id: String, fromStopId: String,
                               trailId: String, after parentId: String?, at time: Int64,
                               reason: String?, originVerse: Int?) throws -> Bool {
        let fields: [SQLiteValue]
        var strongsDepth: SQLiteValue = .null
        switch destination {
        case .scripture(let book, let chapter, let verse, let endVerse):
            guard !book.isEmpty, chapter >= 0, verse.map({ $0 > 0 }) ?? true,
                  endVerse.map({ end in verse.map { end >= $0 } ?? false }) ?? true else { return false }
            fields = [.text("chapter"), .text(book), .integer(Int64(chapter)),
                      verse.map { .integer(Int64($0)) } ?? .null,
                      endVerse.map { .integer(Int64($0)) } ?? .null, .null, .null]
        case .lexicon(let strongs):
            guard !strongs.isEmpty else { return false }
            fields = [.text("lexicon"), .null, .null, .null, .null, .text(strongs), .null]
            if reason != nil { strongsDepth = .text("click") }
        case .note(let note):
            guard !note.isEmpty else { return false }
            fields = [.text("note"), .null, .null, .null, .null, .null, .text(note)]
        case .other:
            return false
        }
        let parent = parentId.map(SQLiteValue.text) ?? .null
        let parameters: [SQLiteValue] = [.text(id), .text(trailId), .text(fromStopId)]
            + fields + [.integer(time), parent, reason.map(SQLiteValue.text) ?? .null,
                        originVerse.map { .integer(Int64($0)) } ?? .null, strongsDepth]
        return try db.run("""
            INSERT INTO trail_connections (
                id, trail_session_id, from_node_id, to_kind, to_book_id, to_chapter, to_verse,
                to_verse_end, to_strongs_num, to_note_id, clarity_tier, created_at,
                from_connection_id, chain_depth, reason_text, origin_verse_pin_from, strongs_depth
            )
            SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 1, ?11,
                   p.id, COALESCE(p.chain_depth + 1, 0), ?13, ?14, ?15
            FROM trail_nodes n
            JOIN trail_sessions s ON s.id = n.trail_session_id
            LEFT JOIN trail_connections p
                ON p.id = ?12 AND p.trail_session_id = s.id AND p.from_node_id = n.id
            WHERE n.id = ?3 AND s.id = ?2 AND s.id <> '__loose_stops__'
              AND (?12 IS NULL OR p.id IS NOT NULL)
              AND (?13 IS NULL OR s.status = 'live')
              AND NOT EXISTS (
                SELECT 1 FROM trail_connections
                WHERE trail_session_id = ?2 AND from_node_id = ?3 AND from_connection_id IS ?12
                  AND to_kind = ?4 AND to_book_id IS ?5 AND to_chapter IS ?6 AND to_verse IS ?7
                  AND to_verse_end IS ?8 AND to_strongs_num IS ?9 AND to_note_id IS ?10
                  AND (?13 IS NULL OR (reason_text IS ?13 AND origin_verse_pin_from IS ?14))
              )
            """, parameters).changes == 1
    }

    @discardableResult
    public func updateStopNote(_ note: String, stopId: String, trailId: String) throws -> Bool {
        try db.run("""
            UPDATE trail_nodes SET cached_subnote = ? WHERE id = ? AND trail_session_id = ?
            """, [.text(note), .text(stopId), .text(trailId)]).changes == 1
    }

    @discardableResult
    public func updateConnectionNote(_ note: String, connectionId: String, trailId: String) throws -> Bool {
        try db.run("""
            UPDATE trail_connections SET user_note = ? WHERE id = ? AND trail_session_id = ?
            """, [.text(note), .text(connectionId), .text(trailId)]).changes == 1
    }

    private func closePauseIntervals(_ trail: SQLiteValue, at time: SQLiteValue) throws {
        try db.run("""
            UPDATE trail_paused_intervals SET resumed_at = MAX(paused_at, ?)
            WHERE trail_session_id = ? AND resumed_at IS NULL
            """, [time, trail])
    }

    private func closeAnchors(_ trail: SQLiteValue, at time: SQLiteValue) throws {
        try db.run("""
            UPDATE trail_nodes SET anchor_ended_at = MAX(anchor_started_at, ?)
            WHERE trail_session_id = ? AND anchor_ended_at IS NULL
            """, [time, trail])
    }

    private func transaction<T>(_ body: () throws -> T) throws -> T {
        try db.exec("BEGIN IMMEDIATE")
        do {
            let result = try body()
            try db.exec("COMMIT")
            return result
        } catch {
            try? db.exec("ROLLBACK")
            throw error
        }
    }
}
