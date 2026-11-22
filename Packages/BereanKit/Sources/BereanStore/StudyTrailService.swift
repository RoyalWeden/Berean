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
        /// Original v36 user-marked topic break (`is_topic_break`): a "New topic" divider above this stop.
        public var isTopicBreak: Bool = false
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
        public let originVerse: Int?
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

    public enum TrailMove { case earlier, later }

    /// Save dense positions so the legacy Study Trail rail opens in the same order.
    public func moveTrail(_ id: String, _ direction: TrailMove) throws -> Bool {
        try transaction {
            var ids = try trails().map(\.id)
            guard let index = ids.firstIndex(of: id) else { return false }
            let destination = index + (direction == .earlier ? -1 : 1)
            guard ids.indices.contains(destination) else { return false }
            ids.swapAt(index, destination)
            for (order, trailId) in ids.enumerated() {
                try db.run("UPDATE trail_sessions SET sort_order = ? WHERE id = ?",
                           [.integer(Int64(order)), .text(trailId)])
            }
            return true
        }
    }

    public struct Tag: Identifiable, Sendable {
        public let id: String
        public let name: String
        public let assigned: Bool
    }

    public func tags(for trailId: String) throws -> [Tag] {
        try db.query("""
            SELECT t.id, t.name, m.tag_id IS NOT NULL AS assigned
            FROM trail_tags t
            LEFT JOIN trail_tag_members m ON m.tag_id = t.id AND m.trail_session_id = ?
            ORDER BY t.sort_order IS NULL, t.sort_order, t.name COLLATE NOCASE, t.id
            """, [.text(trailId)]).compactMap { row in
                guard let id = row["id"]?.string, let name = row["name"]?.string else { return nil }
                return Tag(id: id, name: name, assigned: row["assigned"]?.int == 1)
            }
    }

    @discardableResult
    public func createAndAssignTag(_ name: String, id: String, to trailId: String, at time: Int64) throws -> Bool {
        guard !name.isEmpty else { throw TrailError.emptyName }
        return try transaction {
            guard try db.query("SELECT id FROM trail_sessions WHERE id = ? AND id <> '__loose_stops__'",
                               [.text(trailId)]).first != nil else { return false }
            try db.run("""
                INSERT INTO trail_tags (id, name, created_at) VALUES (?, ?, ?)
                ON CONFLICT(name COLLATE NOCASE) DO NOTHING
                """, [.text(id), .text(name), .integer(time)])
            try db.run("""
                INSERT OR IGNORE INTO trail_tag_members (tag_id, trail_session_id, created_at)
                SELECT id, ?, ? FROM trail_tags WHERE name = ? COLLATE NOCASE
                """, [.text(trailId), .integer(time), .text(name)])
            return true
        }
    }

    public func assignTag(_ id: String, to trailId: String, assigned: Bool, at time: Int64) throws {
        let scope: [SQLiteValue] = [.text(id), .text(trailId)]
        if assigned {
            try db.run("""
                INSERT OR IGNORE INTO trail_tag_members (tag_id, trail_session_id, created_at)
                SELECT t.id, s.id, ? FROM trail_tags t, trail_sessions s
                WHERE t.id = ? AND s.id = ? AND s.id <> '__loose_stops__'
                """, [.integer(time)] + scope)
        } else {
            try db.run("""
                DELETE FROM trail_tag_members
                WHERE tag_id = ? AND trail_session_id = ? AND trail_session_id <> '__loose_stops__'
                """, scope)
        }
    }

    public struct Sticky: Identifiable, Sendable {
        public enum Kind: String, Sendable { case annotation, section }
        public let id: String
        public let kind: Kind
        public let anchorID: String?
        public let title: String
        public let body: String
    }

    public func stickies(in trailID: String) throws -> [Sticky] {
        try db.query("""
            SELECT id, kind, anchor_node_id, title, body FROM trail_notes
            WHERE trail_session_id = ? ORDER BY order_index, created_at, id
            """, [.text(trailID)]).compactMap { row in
                guard let id = row["id"]?.string else { return nil }
                let kind = row["kind"]?.string.flatMap(Sticky.Kind.init(rawValue:)) ?? .annotation
                return Sticky(id: id, kind: kind, anchorID: row["anchor_node_id"]?.string,
                              title: row["title"]?.string ?? "", body: row["body"]?.string ?? "")
            }
    }

    public func createSticky(id: String, in trailID: String, kind: Sticky.Kind, title: String,
                             body: String, at time: Int64) throws -> Bool {
        try db.run("""
            INSERT INTO trail_notes
              (id, trail_session_id, kind, anchor_node_id, title, body, created_at, updated_at)
            SELECT ?, s.id, ?,
                   (SELECT n.id FROM trail_nodes n WHERE n.trail_session_id = s.id
                    ORDER BY n.order_index DESC, n.id DESC LIMIT 1),
                   ?, ?, ?, ?
            FROM trail_sessions s WHERE s.id = ? AND s.id <> '__loose_stops__'
            """, [.text(id), .text(kind.rawValue), title.isEmpty ? .null : .text(title),
                  .text(body), .integer(time), .integer(time), .text(trailID)]).changes == 1
    }

    public func updateSticky(id: String, in trailID: String, title: String,
                             body: String, at time: Int64) throws -> Bool {
        try db.run("""
            UPDATE trail_notes SET title = ?, body = ?, updated_at = ?
            WHERE id = ? AND trail_session_id = ? AND trail_session_id <> '__loose_stops__'
            """, [title.isEmpty ? .null : .text(title), .text(body), .integer(time),
                  .text(id), .text(trailID)]).changes == 1
    }

    public func moveSticky(id: String, in trailID: String, to anchorID: String?, at time: Int64) throws -> Bool {
        try db.run("""
            UPDATE trail_notes
            SET anchor_node_id = ?1,
                order_index = COALESCE((SELECT n.order_index FROM trail_nodes n
                                        WHERE n.id = ?1 AND n.trail_session_id = ?4), 0),
                updated_at = ?2
            WHERE id = ?3 AND trail_session_id = ?4 AND trail_session_id <> '__loose_stops__'
              AND anchor_node_id IS NOT ?1
              AND (?1 IS NULL OR EXISTS (SELECT 1 FROM trail_nodes n
                                         WHERE n.id = ?1 AND n.trail_session_id = ?4))
            """, [anchorID.map(SQLiteValue.text) ?? .null, .integer(time),
                  .text(id), .text(trailID)]).changes == 1
    }

    public func deleteSticky(id: String, in trailID: String) throws -> Bool {
        try transaction {
            guard try db.run("""
                DELETE FROM trail_notes
                WHERE id = ? AND trail_session_id = ? AND trail_session_id <> '__loose_stops__'
                """, [.text(id), .text(trailID)]).changes == 1 else { return false }
            try db.run("DELETE FROM trail_collapse WHERE scope = 'section' AND key = ?", [.text(id)])
            return true
        }
    }

    public struct SearchRecord: Sendable {
        public let trailId: String
        public let sourceBook: String?
        public let sourceChapter: Int?
        public let sourceVerse: Int?
        public let sourceEdition: String?
        public let destinationBook: String?
        public let destinationChapter: Int?
        public let destinationVerse: Int?
        public let destinationEndVerse: Int?
        public let title: String?
        public let annotation: String?
        public let reason: String?
        public let isTag: Bool
    }

    /// Read searchable stop and connection fields in one pass without opening each trail.
    public func librarySearchRecords() throws -> [SearchRecord] {
        try db.query("""
            SELECT n.trail_session_id AS trail, n.book_id AS source_book, n.chapter AS source_chapter,
                   NULL AS source_verse, n.translation AS source_edition, NULL AS destination_book,
                   NULL AS destination_chapter, NULL AS destination_verse, NULL AS destination_end,
                   NULL AS title, n.cached_subnote AS annotation, NULL AS reason, 0 AS is_tag
            FROM trail_nodes n JOIN trail_sessions s ON s.id = n.trail_session_id
            WHERE s.id <> '__loose_stops__'
            UNION ALL
            SELECT c.trail_session_id, n.book_id, n.chapter, c.origin_verse_pin_from, n.translation,
                   c.to_book_id, c.to_chapter, c.to_verse, c.to_verse_end,
                   COALESCE(c.to_strongs_num, note.title), c.user_note, c.reason_text, 0
            FROM trail_connections c JOIN trail_sessions s ON s.id = c.trail_session_id
            LEFT JOIN trail_nodes n ON n.id = c.from_node_id AND n.trail_session_id = s.id
            LEFT JOIN notes note ON note.id = c.to_note_id AND note.deleted_at IS NULL
            WHERE s.id <> '__loose_stops__'
            UNION ALL
            SELECT m.trail_session_id, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, t.name, NULL, NULL, 1
            FROM trail_tag_members m JOIN trail_tags t ON t.id = m.tag_id
            WHERE m.trail_session_id <> '__loose_stops__'
            UNION ALL
            SELECT n.trail_session_id, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, n.title, n.body, NULL, 0
            FROM trail_notes n JOIN trail_sessions s ON s.id = n.trail_session_id
            WHERE s.id <> '__loose_stops__'
            """).compactMap { row in
                guard let trail = row["trail"]?.string else { return nil }
                return SearchRecord(trailId: trail, sourceBook: row["source_book"]?.string,
                                    sourceChapter: row["source_chapter"]?.int, sourceVerse: row["source_verse"]?.int,
                                    sourceEdition: row["source_edition"]?.string, destinationBook: row["destination_book"]?.string,
                                    destinationChapter: row["destination_chapter"]?.int, destinationVerse: row["destination_verse"]?.int,
                                    destinationEndVerse: row["destination_end"]?.int, title: row["title"]?.string,
                                    annotation: row["annotation"]?.string, reason: row["reason"]?.string,
                                    isTag: row["is_tag"]?.int == 1)
            }
    }

    public func stops(in trailId: String) throws -> [Stop] {
        let rows = try db.query("""
            SELECT id, book_id, chapter, translation, cached_subnote, is_topic_break
            FROM trail_nodes WHERE trail_session_id = ? ORDER BY order_index, id
            """, [.text(trailId)])
        return rows.compactMap { row in
            guard let id = row["id"]?.string, let book = row["book_id"]?.string,
                  let chapter = row["chapter"]?.int else { return nil }
            return Stop(id: id, bookId: book, chapter: chapter, translation: row["translation"]?.string,
                        subnote: row["cached_subnote"]?.string, isTopicBreak: row["is_topic_break"]?.int == 1)
        }
    }

    public func connections(in trailId: String) throws -> [Connection] {
        let rows = try db.query("""
            SELECT id, from_node_id, from_connection_id, to_kind, to_book_id, to_chapter,
                   to_verse, to_verse_end, to_strongs_num, to_note_id, reason_text, user_note, origin_verse_pin_from
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
                              userNote: row["user_note"]?.string, originVerse: row["origin_verse_pin_from"]?.int)
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
    public func rename(trailId: String, name: String, at time: Int64) throws -> Bool {
        guard !name.isEmpty else { throw TrailError.emptyName }
        return try db.run("""
            UPDATE trail_sessions SET name = ?, updated_at = ?
            WHERE id = ? AND id <> '__loose_stops__'
            """, [.text(name), .integer(time), .text(trailId)]).changes == 1
    }

    @discardableResult
    public func updateRecap(_ recap: String, trailId: String, at time: Int64) throws -> Bool {
        try db.run("""
            UPDATE trail_sessions SET recap_text = ?, recap_user_edited = 1, updated_at = ?
            WHERE id = ? AND id <> '__loose_stops__'
            """, [.text(recap), .integer(time), .text(trailId)]).changes == 1
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

    // MARK: topic breaks / moving stops (port of setNodeTopicBreak / moveNodes)

    @discardableResult
    public func setTopicBreak(_ isBreak: Bool, stopId: String) throws -> Bool {
        try db.run("UPDATE trail_nodes SET is_topic_break = ? WHERE id = ?", [.integer(isBreak ? 1 : 0), .text(stopId)]).changes == 1
    }

    /// Moves stops (with every connection hanging off them, chained ones included) into
    /// `targetId`, slotted in by time; both sides are renumbered.
    @discardableResult
    public func moveStops(_ stopIds: [String], to targetId: String, at time: Int64) throws -> Bool {
        guard !stopIds.isEmpty else { return false }
        return try transaction {
            guard try db.query("SELECT id FROM trail_sessions WHERE id = ?", [.text(targetId)]).first != nil else { return false }
            var sources = Set<String>()
            var frontier: [String] = []
            for id in stopIds {
                if let source = try db.query("SELECT trail_session_id FROM trail_nodes WHERE id = ?", [.text(id)]).first?["trail_session_id"]?.string {
                    sources.insert(source)
                }
                frontier += try db.query("SELECT id FROM trail_connections WHERE from_node_id = ?", [.text(id)]).compactMap { $0["id"]?.string }
            }
            var connections = Set(frontier)
            while !frontier.isEmpty {
                var next: [String] = []
                for id in frontier {
                    for row in try db.query("SELECT id FROM trail_connections WHERE from_connection_id = ?", [.text(id)]) {
                        if let child = row["id"]?.string, connections.insert(child).inserted { next.append(child) }
                    }
                }
                frontier = next
            }
            for id in stopIds {
                try db.run("UPDATE trail_nodes SET trail_session_id = ?, order_index = COALESCE(anchor_started_at, order_index) WHERE id = ?",
                           [.text(targetId), .text(id)])
            }
            for id in connections {
                try db.run("UPDATE trail_connections SET trail_session_id = ? WHERE id = ?", [.text(targetId), .text(id)])
            }
            try db.run("UPDATE trail_sessions SET updated_at = ? WHERE id = ?", [.integer(time), .text(targetId)])
            for trail in sources.union([targetId]) { try renumberStops(trail) }
            return true
        }
    }

    // MARK: merge / split (port of studyTrailService.ts mergeSessions / splitSession)

    /// Moves every stop, connection and sticky of `fromId` into `intoId`, renumbers, and drops the
    /// emptied trail (the structural loose-stops bucket is emptied, never deleted).
    @discardableResult
    public func merge(_ fromId: String, into intoId: String, at time: Int64) throws -> Bool {
        guard fromId != intoId else { return false }
        return try transaction {
            guard try db.query("SELECT id FROM trail_sessions WHERE id = ?", [.text(intoId)]).first != nil,
                  try db.query("SELECT id FROM trail_sessions WHERE id = ?", [.text(fromId)]).first != nil else { return false }
            for table in ["trail_nodes", "trail_connections", "trail_notes"] {
                try db.run("UPDATE \(table) SET trail_session_id = ? WHERE trail_session_id = ?", [.text(intoId), .text(fromId)])
            }
            try renumberStops(intoId)
            if fromId != "__loose_stops__" { try db.run("DELETE FROM trail_sessions WHERE id = ?", [.text(fromId)]) }
            try db.run("UPDATE trail_sessions SET updated_at = ? WHERE id = ?", [.integer(time), .text(intoId)])
            return true
        }
    }

    /// Everything from `stopId` onward (by order_index) becomes a new paused trail `newId`;
    /// connections follow their own stop, stickies their anchor stop. Returns false if the stop
    /// isn't in `trailId`.
    @discardableResult
    public func split(_ trailId: String, at stopId: String, newId: String, name: String?, at time: Int64) throws -> Bool {
        try transaction {
            guard let pivot = try db.query("SELECT order_index FROM trail_nodes WHERE id = ? AND trail_session_id = ?",
                                           [.text(stopId), .text(trailId)]).first?["order_index"] else { return false }
            let title = name.map { String($0.drop(while: \.isWhitespace).reversed().drop(while: \.isWhitespace).reversed()) } ?? ""
            try db.run("INSERT INTO trail_sessions (id, name, status, created_at, updated_at) VALUES (?, ?, 'paused', ?, ?)",
                       [.text(newId), .text(title.isEmpty ? "Split session" : title), .integer(time), .integer(time)])
            try db.run("UPDATE trail_nodes SET trail_session_id = ? WHERE trail_session_id = ? AND order_index >= ?",
                       [.text(newId), .text(trailId), pivot])
            try db.run("""
                UPDATE trail_connections SET trail_session_id = ?
                WHERE trail_session_id = ? AND from_node_id IN (SELECT id FROM trail_nodes WHERE trail_session_id = ?)
                """, [.text(newId), .text(trailId), .text(newId)])
            try db.run("""
                UPDATE trail_notes SET trail_session_id = ?
                WHERE trail_session_id = ? AND anchor_node_id IN (SELECT id FROM trail_nodes WHERE trail_session_id = ?)
                """, [.text(newId), .text(trailId), .text(newId)])
            try renumberStops(trailId)
            try renumberStops(newId)
            return true
        }
    }

    private func renumberStops(_ trailId: String) throws {
        let rows = try db.query("SELECT id FROM trail_nodes WHERE trail_session_id = ? ORDER BY anchor_started_at, order_index", [.text(trailId)])
        for (index, row) in rows.enumerated() {
            guard let id = row["id"] else { continue }
            try db.run("UPDATE trail_nodes SET order_index = ? WHERE id = ?", [.integer(Int64(index)), id])
        }
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
