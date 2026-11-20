import Foundation
import BereanCore
import BereanSQLite

public enum TagEdgeArrows: String, Sendable, CaseIterable { case none, forward, backward, both }

public struct TagEdge: Equatable, Sendable, Identifiable {
    public var id: String
    public var source: String
    public var target: String
    public var arrows: TagEdgeArrows
    public var color: String?
    public var dashed: Bool
    public var note: String
    public var createdAt: Int64
    public var updatedAt: Int64
}

public struct TagCoOccurrence: Equatable, Sendable {
    public var a: String
    public var b: String
    public var weight: Int
    public init(a: String, b: String, weight: Int) { self.a = a; self.b = b; self.weight = weight }
}

public struct TagGraph: Equatable, Sendable {
    public var tags: [VerseTagSummary]
    public var edges: [TagEdge]
    public var coOccurrence: [TagCoOccurrence]
    public var coOccurrenceOmitted: Bool
    public init(tags: [VerseTagSummary], edges: [TagEdge], coOccurrence: [TagCoOccurrence], coOccurrenceOmitted: Bool) {
        self.tags = tags; self.edges = edges; self.coOccurrence = coOccurrence; self.coOccurrenceOmitted = coOccurrenceOmitted
    }
}

public enum TagEdgeCreateResult: Equatable, Sendable {
    case created(TagEdge), conflict(existing: TagEdge), invalid
}

/// Port of src/platform/services/tagGraphService.ts — user-drawn tag edges, verse co-occurrence
/// and saved node positions. Same tables, SQL and change events as the original.
public final class TagGraphService: @unchecked Sendable {
    public static let coOccurrenceRowCap = 50_000
    let db: SQLiteConnection
    let tags: VerseTagsService
    let now: @Sendable () -> Int64
    let uuid: @Sendable () -> String
    let onChange: @Sendable (_ entity: String, _ id: String?, _ op: String) -> Void

    public init(db: SQLiteConnection, tags: VerseTagsService,
                now: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) },
                uuid: @escaping @Sendable () -> String = { UUID().uuidString.lowercased() },
                onChange: @escaping @Sendable (_ entity: String, _ id: String?, _ op: String) -> Void = { _, _, _ in }) {
        self.db = db; self.tags = tags; self.now = now; self.uuid = uuid; self.onChange = onChange
    }

    static let edgeSelect = """
        SELECT id, source_tag_id AS source, target_tag_id AS target, arrows, color, dashed, note,
          created_at AS createdAt, updated_at AS updatedAt
        FROM tag_edges
        """

    static func edge(_ r: SQLiteRow) -> TagEdge {
        TagEdge(id: r["id"]?.string ?? "", source: r["source"]?.string ?? "", target: r["target"]?.string ?? "",
                arrows: TagEdgeArrows(rawValue: r["arrows"]?.string ?? "none") ?? .none, color: r["color"]?.string,
                dashed: (VerseTagsService.i(r["dashed"]) ?? 0) != 0, note: r["note"]?.string ?? "",
                createdAt: Int64(VerseTagsService.i(r["createdAt"]) ?? 0), updatedAt: Int64(VerseTagsService.i(r["updatedAt"]) ?? 0))
    }

    public func edges() throws -> [TagEdge] { try db.query(Self.edgeSelect).map(Self.edge) }

    public func graph() throws -> TagGraph {
        let list = try tags.list()
        let edges = try edges()
        let total = VerseTagsService.i(try db.query("SELECT COUNT(*) AS n FROM verse_tag_verse WHERE verse > 0").first?["n"]) ?? 0
        if total > Self.coOccurrenceRowCap { return TagGraph(tags: list, edges: edges, coOccurrence: [], coOccurrenceOmitted: true) }
        let co = try db.query("""
            SELECT a.tag_id AS a, b.tag_id AS b, COUNT(*) AS weight
            FROM verse_tag_verse a
            JOIN verse_tag_verse b
              ON a.book_id = b.book_id AND a.chapter = b.chapter AND a.verse = b.verse AND a.tag_id < b.tag_id
            WHERE a.verse > 0
            GROUP BY a.tag_id, b.tag_id
            HAVING weight >= 2
            ORDER BY weight DESC
            LIMIT 2000
            """).map { TagCoOccurrence(a: $0["a"]?.string ?? "", b: $0["b"]?.string ?? "", weight: VerseTagsService.i($0["weight"]) ?? 0) }
        return TagGraph(tags: list, edges: edges, coOccurrence: co, coOccurrenceOmitted: false)
    }

    public func createEdge(_ source: String, _ target: String) throws -> TagEdgeCreateResult {
        guard !source.isEmpty, !target.isEmpty, source != target else { return .invalid }
        if let row = try db.query("\(Self.edgeSelect) WHERE source_tag_id = ? AND target_tag_id = ?", [.text(source), .text(target)]).first {
            return .conflict(existing: Self.edge(row))
        }
        let t = now(), id = uuid()
        try db.run("""
            INSERT INTO tag_edges (id, source_tag_id, target_tag_id, arrows, color, dashed, note, created_at, updated_at)
            VALUES (?, ?, ?, 'none', NULL, 0, '', ?, ?)
            """, [.text(id), .text(source), .text(target), .integer(t), .integer(t)])
        onChange("tag_edge", id, "upsert")
        return .created(TagEdge(id: id, source: source, target: target, arrows: .none, color: nil, dashed: false, note: "", createdAt: t, updatedAt: t))
    }

    public struct EdgePatch: Sendable {
        public var arrows: TagEdgeArrows?
        /// `.some(nil)` clears the colour; `nil` leaves it unchanged.
        public var color: String??
        public var dashed: Bool?
        public var note: String?
        public init(arrows: TagEdgeArrows? = nil, color: String?? = nil, dashed: Bool? = nil, note: String? = nil) {
            self.arrows = arrows; self.color = color; self.dashed = dashed; self.note = note
        }
    }

    /// Returns the updated edge list, or nil when the edge no longer exists.
    @discardableResult public func updateEdge(_ id: String, _ patch: EdgePatch) throws -> [TagEdge]? {
        guard let cur = try db.query("\(Self.edgeSelect) WHERE id = ?", [.text(id)]).first.map(Self.edge) else { return nil }
        let color: String? = patch.color ?? cur.color
        try db.run("UPDATE tag_edges SET arrows = ?, color = ?, dashed = ?, note = ?, updated_at = ? WHERE id = ?",
                   [.text((patch.arrows ?? cur.arrows).rawValue), VerseTagsService.s(color),
                    .integer((patch.dashed ?? cur.dashed) ? 1 : 0), .text(patch.note ?? cur.note), .integer(now()), .text(id)])
        onChange("tag_edge", id, "upsert")
        return try edges()
    }

    @discardableResult public func deleteEdge(_ id: String) throws -> [TagEdge] {
        try db.run("DELETE FROM tag_edges WHERE id = ?", [.text(id)])
        onChange("tag_edge", id, "delete")
        return try edges()
    }

    public func setTagPosition(_ tagId: String, x: Double?, y: Double?, pinned: Bool) throws {
        try db.run("UPDATE verse_tags SET graph_x = ?, graph_y = ?, graph_pinned = ? WHERE id = ?",
                   [x.map { .real($0) } ?? .null, y.map { .real($0) } ?? .null, .integer(pinned ? 1 : 0), .text(tagId)])
        onChange("verse_tag", tagId, "upsert")
    }
}
