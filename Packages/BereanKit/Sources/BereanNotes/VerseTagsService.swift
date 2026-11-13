import Foundation
import BereanCore
import BereanSQLite

/// One location a tag member covers: verse spans within a chapter, or the whole chapter (translation-agnostic).
public struct TagRange: Equatable, Sendable {
    public var bookId: String
    public var chapter: Double
    public var spans: [(s: Double, e: Double)]?
    public var whole: Bool?
    public init(bookId: String, chapter: Double, spans: [(s: Double, e: Double)]? = nil, whole: Bool? = nil) {
        self.bookId = bookId; self.chapter = chapter; self.spans = spans; self.whole = whole
    }
    public static func == (a: TagRange, b: TagRange) -> Bool {
        a.bookId == b.bookId && a.chapter == b.chapter && a.whole == b.whole
            && a.spans?.map { [$0.s, $0.e] } == b.spans?.map { [$0.s, $0.e] }
    }

    /// The object JSON.stringify writes for the `ranges` column (keys in the order callers build them).
    public var jsValue: JSValue {
        var o = JSObject()
        o["bookId"] = .string(JSString(bookId)); o["chapter"] = .number(chapter)
        if let spans { o["spans"] = .array(spans.map { var x = JSObject(); x["s"] = .number($0.s); x["e"] = .number($0.e); return .object(x) }) }
        if let whole { o["whole"] = .bool(whole) }
        return .object(o)
    }

    public init?(_ v: JSValue) {
        guard let o = v.objectValue, let b = o["bookId"]?.stringValue?.string, let c = o["chapter"]?.numberValue else { return nil }
        bookId = b; chapter = c
        spans = o["spans"]?.arrayValue?.compactMap { s in s["s"]?.numberValue.flatMap { a in s["e"]?.numberValue.map { (a, $0) } } }
        whole = o["whole"]?.boolValue
    }
}

public struct TaggedVerse: Equatable, Sendable { public var bookId: String; public var chapter: Int; public var verse: Int }

public struct VerseTagSummary: Equatable, Sendable, Identifiable {
    public var id, name: String
    public var color: String?
    public var createdAt: Int64
    public var colorSlot: Int?
    public var graphX, graphY: Double?
    public var graphPinned: Bool
    public var memberCount, verseCount, chapterCount: Int
}

public struct TagLite: Equatable, Sendable, Identifiable { public var id, name: String; public var color: String?; public var colorSlot: Int? }

public struct TagMemberDetail: Equatable, Sendable, Identifiable {
    public var id: String { memberId }
    public var memberId, tagId, tagName: String
    public var tagColor: String?
    public var tagColorSlot: Int?
    public var kind, label: String
    /// The stored `ranges` JSON, parsed.
    public var ranges: JSValue
    public var verses: [TaggedVerse]
    public var wholeChapters: [(bookId: String, chapter: Int)]
    public static func == (a: TagMemberDetail, b: TagMemberDetail) -> Bool {
        a.memberId == b.memberId && a.tagId == b.tagId && a.label == b.label && a.kind == b.kind && a.ranges == b.ranges && a.verses == b.verses
            && a.wholeChapters.map { "\($0.bookId).\($0.chapter)" } == b.wholeChapters.map { "\($0.bookId).\($0.chapter)" }
    }
}

public enum TagDeleteResult: Equatable, Sendable { case deleted([VerseTagSummary]), blocked(noteRefCount: Int, name: String), notFound }

/// Verse tags — port of src/platform/services/verseTagsService.ts (golden `verse-tags.json`).
public final class VerseTagsService: @unchecked Sendable {
    public static let slotCount = 12
    static let maxSpanExpansion = 400.0
    let db: SQLiteConnection
    let now: @Sendable () -> Int64
    let uuid: @Sendable () -> String
    /// Picks an index among the least-used colour slots (JS: `Math.floor(Math.random() * n)`).
    let pick: @Sendable (Int) -> Int
    let onChange: @Sendable (_ entity: String, _ id: String?, _ op: String) -> Void

    public init(db: SQLiteConnection, now: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) },
                uuid: @escaping @Sendable () -> String = { UUID().uuidString.lowercased() },
                pick: @escaping @Sendable (Int) -> Int = { Int.random(in: 0..<max(1, $0)) },
                onChange: @escaping @Sendable (_ entity: String, _ id: String?, _ op: String) -> Void = { _, _, _ in }) {
        self.db = db; self.now = now; self.uuid = uuid; self.pick = pick; self.onChange = onChange
    }

    /// Expands ranges into (book, chapter, verse) rows; a whole chapter is verse 0. Duplicates dropped, spans capped at 400 verses.
    public static func expand(_ ranges: [TagRange]) -> [TaggedVerse] {
        var out: [TaggedVerse] = [], seen = Set<String>()
        for r in ranges where r.chapter.isFinite {
            let ch = Int(r.chapter)
            if r.whole == true {
                if seen.insert("\(r.bookId)|\(JSNumber.toString(r.chapter))|0").inserted { out.append(TaggedVerse(bookId: r.bookId, chapter: ch, verse: 0)) }
                continue
            }
            for span in r.spans ?? [] {
                let s = max(1, span.s.rounded(.down))
                let e = min(s + maxSpanExpansion, max(s, span.e.rounded(.down)))
                guard s <= e else { continue }
                var v = s
                while v <= e {
                    if seen.insert("\(r.bookId)|\(JSNumber.toString(r.chapter))|\(JSNumber.toString(v))").inserted { out.append(TaggedVerse(bookId: r.bookId, chapter: ch, verse: Int(v))) }
                    v += 1
                }
            }
        }
        return out
    }

    /// Nest-safe write transaction (SAVEPOINT), like the adapter's `transaction`.
    func transaction(_ body: () throws -> Void) throws {
        let name = "vt_\(UInt32.random(in: 0...UInt32.max))"
        try db.exec("SAVEPOINT \(name)")
        do { try body(); try db.exec("RELEASE \(name)") } catch { try? db.exec("ROLLBACK TO \(name)"); try? db.exec("RELEASE \(name)"); throw error }
    }

    static func i(_ v: SQLiteValue?) -> Int? { if case .integer(let x) = v { return Int(x) }; if case .real(let d) = v { return Int(d) }; return nil }
    static func d(_ v: SQLiteValue?) -> Double? { if case .integer(let x) = v { return Double(x) }; if case .real(let d) = v { return d }; return nil }
    static func s(_ v: String?) -> SQLiteValue { v.map { .text($0) } ?? .null }

    func pickLeastUsedSlot() throws -> Int {
        var counts = Array(repeating: 0, count: Self.slotCount)
        for r in try db.query("SELECT color_slot AS slot, COUNT(*) AS c FROM verse_tags WHERE color_slot IS NOT NULL GROUP BY color_slot") {
            if let slot = Self.i(r["slot"]), slot >= 0, slot < Self.slotCount { counts[slot] = Self.i(r["c"]) ?? 0 }
        }
        let m = counts.min() ?? 0
        let candidates = counts.indices.filter { counts[$0] == m }
        return candidates[min(candidates.count - 1, max(0, pick(candidates.count)))]
    }

    func rebuildMemberVerses(tagId: String, memberId: String, ranges: [TagRange]) throws {
        try db.run("DELETE FROM verse_tag_verse WHERE member_id = ?", [.text(memberId)])
        for v in Self.expand(ranges) {
            try db.run("INSERT OR IGNORE INTO verse_tag_verse (tag_id, member_id, book_id, chapter, verse) VALUES (?, ?, ?, ?, ?)",
                       [.text(tagId), .text(memberId), .text(v.bookId), .integer(Int64(v.chapter)), .integer(Int64(v.verse))])
        }
    }

    public func list() throws -> [VerseTagSummary] {
        try db.query("""
            SELECT t.id, t.name, t.color, t.sort_order, t.created_at,
              t.color_slot, t.graph_x, t.graph_y, t.graph_pinned,
              (SELECT COUNT(*) FROM verse_tag_members m WHERE m.tag_id = t.id) AS memberCount,
              (SELECT COUNT(*) FROM verse_tag_verse v WHERE v.tag_id = t.id AND v.verse > 0) AS verseCount,
              (SELECT COUNT(*) FROM verse_tag_verse v WHERE v.tag_id = t.id AND v.verse = 0) AS chapterCount
            FROM verse_tags t
            ORDER BY COALESCE(t.sort_order, 999999), t.name COLLATE NOCASE
            """).map { r in
            VerseTagSummary(id: r["id"]?.string ?? "", name: r["name"]?.string ?? "", color: r["color"]?.string, createdAt: Int64(Self.i(r["created_at"]) ?? 0),
                            colorSlot: Self.i(r["color_slot"]), graphX: Self.d(r["graph_x"]), graphY: Self.d(r["graph_y"]), graphPinned: (Self.i(r["graph_pinned"]) ?? 0) != 0,
                            memberCount: Self.i(r["memberCount"]) ?? 0, verseCount: Self.i(r["verseCount"]) ?? 0, chapterCount: Self.i(r["chapterCount"]) ?? 0)
        }
    }

    func findOrCreate(_ name: String, color: String? = nil) throws -> String {
        let trimmed = JSText.trim(name)
        guard !trimmed.isEmpty else { throw TagError.nameRequired }
        if let id = try db.query("SELECT id FROM verse_tags WHERE name = ? COLLATE NOCASE", [.text(trimmed)]).first?["id"]?.string { return id }
        let id = uuid()
        let slot = try pickLeastUsedSlot()
        try db.run("INSERT INTO verse_tags (id, name, color, color_slot, sort_order, created_at) VALUES (?, ?, ?, ?, NULL, ?)",
                   [.text(id), .text(trimmed), Self.s(color), .integer(Int64(slot)), .integer(now())])
        onChange("verse_tag", id, "upsert")
        return id
    }
    public enum TagError: Error { case nameRequired }

    @discardableResult public func create(_ name: String, color: String? = nil) throws -> [VerseTagSummary] { _ = try findOrCreate(name, color: color); return try list() }

    @discardableResult public func rename(_ id: String, to name: String) throws -> [VerseTagSummary] {
        try db.run("UPDATE verse_tags SET name = ? WHERE id = ?", [.text(JSText.trim(name)), .text(id)]); onChange("verse_tag", id, "upsert"); return try list()
    }

    @discardableResult public func setColor(_ id: String, _ color: String?) throws -> [VerseTagSummary] {
        try db.run("UPDATE verse_tags SET color = ? WHERE id = ?", [Self.s(color), .text(id)]); onChange("verse_tag", id, "upsert"); return try list()
    }

    /// Palette slot 0…11; clears a literal colour so the theme-adaptive slot colour applies.
    @discardableResult public func setColorSlot(_ id: String, _ slot: Double) throws -> [VerseTagSummary] {
        let s = Int(max(0, min(Double(Self.slotCount - 1), slot.rounded(.down))))
        try db.run("UPDATE verse_tags SET color_slot = ?, color = NULL WHERE id = ?", [.integer(Int64(s)), .text(id)]); onChange("verse_tag", id, "upsert"); return try list()
    }

    @discardableResult public func reorder(_ ids: [String]) throws -> [VerseTagSummary] {
        try transaction { for (i, id) in ids.enumerated() { try db.run("UPDATE verse_tags SET sort_order = ? WHERE id = ?", [.integer(Int64(i)), .text(id)]) } }
        onChange("verse_tag", nil, "bulk"); return try list()
    }

    @discardableResult public func merge(_ fromId: String, into intoId: String) throws -> [VerseTagSummary] {
        try transaction {
            try db.run("UPDATE verse_tag_members SET tag_id = ? WHERE tag_id = ?", [.text(intoId), .text(fromId)])
            try db.run("UPDATE OR IGNORE verse_tag_verse SET tag_id = ? WHERE tag_id = ?", [.text(intoId), .text(fromId)])
            try db.run("DELETE FROM verse_tag_verse WHERE tag_id = ?", [.text(fromId)])
            try db.run("UPDATE OR IGNORE tag_edges SET source_tag_id = ? WHERE source_tag_id = ?", [.text(intoId), .text(fromId)])
            try db.run("UPDATE OR IGNORE tag_edges SET target_tag_id = ? WHERE target_tag_id = ?", [.text(intoId), .text(fromId)])
            try db.run("DELETE FROM tag_edges WHERE source_tag_id = ? OR target_tag_id = ? OR source_tag_id = target_tag_id", [.text(fromId), .text(fromId)])
            try db.run("DELETE FROM verse_tags WHERE id = ?", [.text(fromId)])
        }
        onChange("verse_tag", fromId, "delete"); onChange("verse_tag", intoId, "upsert"); return try list()
    }

    /// Refuses while a live note still mentions "#name", unless `force`.
    public func delete(_ id: String, force: Bool = false) throws -> TagDeleteResult {
        guard let name = try db.query("SELECT name FROM verse_tags WHERE id = ?", [.text(id)]).first?["name"]?.string else { return .notFound }
        if !force {
            let n = Self.i(try db.query("SELECT COUNT(*) AS n FROM notes WHERE deleted_at IS NULL AND content LIKE '%#' || ? || '%'", [.text(name)]).first?["n"]) ?? 0
            if n > 0 { return .blocked(noteRefCount: n, name: name) }
        }
        try transaction {
            try db.run("DELETE FROM verse_tag_verse WHERE tag_id = ?", [.text(id)])
            try db.run("DELETE FROM verse_tags WHERE id = ?", [.text(id)])
        }
        onChange("verse_tag", id, "delete")
        return .deleted(try list())
    }

    /// Adds `ranges` as one member to each tag in `tagIds` and each (found or created) `newTagNames` tag.
    @discardableResult
    public func addMembers(tagIds: [String] = [], newTagNames: [String] = [], ranges: [TagRange], label: String, kind: String = "verses") throws -> [VerseTagSummary] {
        var touched: [String] = []
        let rangesJSON = JSON.stringifyString(.array(ranges.map(\.jsValue)))
        try transaction {
            var ids: [String] = []
            for id in tagIds where !ids.contains(id) { ids.append(id) }
            for n in newTagNames { let id = try findOrCreate(n); if !ids.contains(id) { ids.append(id) } }
            for tagId in ids {
                let memberId = uuid()
                try db.run("INSERT INTO verse_tag_members (id, tag_id, kind, ranges, label, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                           [.text(memberId), .text(tagId), .text(kind), .text(rangesJSON), .text(label), .integer(now())])
                try rebuildMemberVerses(tagId: tagId, memberId: memberId, ranges: ranges)
                touched.append(memberId)
            }
        }
        for id in touched { onChange("verse_tag_member", id, "upsert") }
        return try list()
    }

    @discardableResult public func removeMember(_ memberId: String) throws -> [VerseTagSummary] {
        try transaction {
            try db.run("DELETE FROM verse_tag_verse WHERE member_id = ?", [.text(memberId)])
            try db.run("DELETE FROM verse_tag_members WHERE id = ?", [.text(memberId)])
        }
        onChange("verse_tag_member", memberId, "delete"); return try list()
    }

    @discardableResult
    public func updateMemberRanges(_ memberId: String, ranges: [TagRange], label: String, kind: String? = nil) throws -> [VerseTagSummary] {
        guard let tagId = try db.query("SELECT tag_id FROM verse_tag_members WHERE id = ?", [.text(memberId)]).first?["tag_id"]?.string else { return try list() }
        let json = JSON.stringifyString(.array(ranges.map(\.jsValue)))
        try transaction {
            if kind == "verses" || kind == "chapter" {
                try db.run("UPDATE verse_tag_members SET ranges = ?, label = ?, kind = ? WHERE id = ?", [.text(json), .text(label), .text(kind!), .text(memberId)])
            } else {
                try db.run("UPDATE verse_tag_members SET ranges = ?, label = ? WHERE id = ?", [.text(json), .text(label), .text(memberId)])
            }
            try rebuildMemberVerses(tagId: tagId, memberId: memberId, ranges: ranges)
        }
        onChange("verse_tag_member", memberId, "upsert"); return try list()
    }

    /// Reader lookup: tags per verse, and whole-chapter tags.
    public func forChapter(_ bookId: String, _ chapter: Int) throws -> (verseTags: [Int: [TagLite]], chapterTags: [TagLite]) {
        var verseTags: [Int: [TagLite]] = [:], chapterTags: [TagLite] = [], seen = Set<String>()
        for r in try db.query("""
            SELECT v.verse, t.id, t.name, t.color, t.color_slot AS colorSlot
            FROM verse_tag_verse v JOIN verse_tags t ON t.id = v.tag_id
            WHERE v.book_id = ? AND v.chapter = ?
            ORDER BY t.name COLLATE NOCASE
            """, [.text(bookId), .integer(Int64(chapter))]) {
            let tag = TagLite(id: r["id"]?.string ?? "", name: r["name"]?.string ?? "", color: r["color"]?.string, colorSlot: Self.i(r["colorSlot"]))
            let verse = Self.i(r["verse"]) ?? 0
            if verse == 0 { if seen.insert(tag.id).inserted { chapterTags.append(tag) } } else { verseTags[verse, default: []].append(tag) }
        }
        return (verseTags, chapterTags)
    }

    public func members(_ tagIds: [String]) throws -> [TagMemberDetail] {
        guard !tagIds.isEmpty else { return [] }
        let ph = Array(repeating: "?", count: tagIds.count).joined(separator: ", ")
        return try db.query("""
            SELECT m.id, m.tag_id, m.kind, m.ranges, m.label, m.created_at,
              t.name AS tagName, t.color AS tagColor, t.color_slot AS tagColorSlot
            FROM verse_tag_members m JOIN verse_tags t ON t.id = m.tag_id
            WHERE m.tag_id IN (\(ph))
            ORDER BY t.name COLLATE NOCASE, m.created_at
            """, tagIds.map { .text($0) }).map { m in
            let id = m["id"]?.string ?? ""
            let rows = try db.query("SELECT book_id, chapter, verse FROM verse_tag_verse WHERE member_id = ?", [.text(id)])
            return TagMemberDetail(memberId: id, tagId: m["tag_id"]?.string ?? "", tagName: m["tagName"]?.string ?? "", tagColor: m["tagColor"]?.string,
                                   tagColorSlot: Self.i(m["tagColorSlot"]), kind: m["kind"]?.string ?? "verses", label: m["label"]?.string ?? "",
                                   ranges: (try? JSON.parse(m["ranges"]?.string ?? "[]")) ?? .array([]),
                                   verses: rows.compactMap { r in (Self.i(r["verse"]) ?? 0) > 0 ? TaggedVerse(bookId: r["book_id"]?.string ?? "", chapter: Self.i(r["chapter"]) ?? 0, verse: Self.i(r["verse"]) ?? 0) : nil },
                                   wholeChapters: rows.compactMap { r in (Self.i(r["verse"]) ?? 0) == 0 ? (r["book_id"]?.string ?? "", Self.i(r["chapter"]) ?? 0) : nil })
        }
    }
}
