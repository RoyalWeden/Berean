import BereanSQLite

/// Reads the existing Study Trail tables. The caller owns and serializes the connection.
public struct StudyTrailReader {
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
}
