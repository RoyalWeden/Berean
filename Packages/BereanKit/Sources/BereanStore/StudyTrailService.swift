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
            case scripture(bookId: String, chapter: Int, verse: Int?)
            case lexicon(String)
            case note(String)
            case other(String)
        }

        public let id: String
        public let fromStopId: String
        public let parentId: String?
        public let destination: Destination
        public let reason: String?
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
                   to_verse, to_strongs_num, to_note_id, reason_text
            FROM trail_connections WHERE trail_session_id = ? ORDER BY created_at, id
            """, [.text(trailId)])
        return rows.compactMap { row in
            guard let id = row["id"]?.string, let from = row["from_node_id"]?.string,
                  let kind = row["to_kind"]?.string else { return nil }
            let destination: Connection.Destination
            switch kind {
            case "chapter", "compare":
                if let book = row["to_book_id"]?.string, let chapter = row["to_chapter"]?.int {
                    destination = .scripture(bookId: book, chapter: chapter, verse: row["to_verse"]?.int)
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
                              destination: destination, reason: row["reason_text"]?.string)
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
