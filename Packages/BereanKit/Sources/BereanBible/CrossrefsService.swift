import BereanCore
import BereanSQLite
import BereanReference

/// Cross references — port of src/platform/services/crossrefsService.ts: the voted "Classic" set
/// (cross_references.db), TSKe (tske_refs.db, grouped by heading) and Taylor-Hermas footnotes, with
/// target verse text from KJVA. Ordering follows ADR-0008 (votes, then rowid).
public struct CrossRef: Equatable, Sendable { public var bookId: String, chapter: Int, verse: Int, endVerse: Int?, votes: Int, text: String }
public struct TskeRef: Equatable, Sendable { public var bookId: String, chapter: Int, verse: Int, endVerse: Int?, text: String, context: String? }
public struct TskeGroup: Equatable, Sendable {
    public var heading: String?
    public var isReciprocal: Bool
    public var refs: [TskeRef]
}
public struct HermasFootnoteRef: Equatable, Sendable { public var bookId: String, chapter: Int, verse: Int, raw: String, text: String }

public actor CrossrefsService {
    private let dataPath: @Sendable (String) -> String?   // "cross_references" | "tske_refs" | "hermas_taylor" | "kjva"
    private var open: [String: SQLiteConnection] = [:]

    public init(dataPath: @escaping @Sendable (String) -> String?) { self.dataPath = dataPath }

    private func db(_ id: String) -> SQLiteConnection? {
        if let c = open[id] { return c }
        guard let p = dataPath(id), let c = try? SQLiteConnection(readOnlyPath: p) else { return nil }
        open[id] = c
        return c
    }

    static let entity = JSRegex("&#x0027;", ignoreCase: true)
    /// `decodeTskeText` — tske_refs.db stores apostrophes as `&#x0027;`.
    public static func decodeTske(_ s: String?) -> String? { s.map { entity.replaceAll($0, with: "'") } }

    func verseTexts(_ tuples: [(String, Int, Int)]) -> [String: String] {
        var out: [String: String] = [:]
        guard let kjva = db("kjva"), !tuples.isEmpty else { return out }
        var seen = Set<String>(), list: [(String, Int, Int)] = []
        for t in tuples where seen.insert("\(t.0)|\(t.1)|\(t.2)").inserted { list.append(t) }
        for start in stride(from: 0, to: list.count, by: 300) {
            let chunk = list[start..<min(start + 300, list.count)]
            let values = Array(repeating: "(?,?,?)", count: chunk.count).joined(separator: ",")
            let params = chunk.flatMap { [SQLiteValue.text($0.0), .integer(Int64($0.1)), .integer(Int64($0.2))] }
            for r in (try? kjva.query("SELECT book_id, chapter, verse_num, text FROM verses\n       WHERE (book_id, chapter, verse_num) IN (VALUES \(values))", params)) ?? [] {
                let k = "\(r.values[0].string ?? "")|\(r.values[1].int ?? 0)|\(r.values[2].int ?? 0)"
                if out[k] == nil { out[k] = r.values[3].string ?? "" }
            }
        }
        return out
    }

    public func hasData() -> Bool { db("cross_references") != nil }

    /// `getCrossRefsForVerse` (nil = database unavailable / error).
    func crossRefs(_ bookId: String, _ chapter: Int, _ verse: Int) -> [CrossRef]? {
        guard let d = db("cross_references"),
              let rows = try? d.query("SELECT to_book, to_ch, to_vs, to_vs_end, votes FROM refs WHERE from_book = ? AND from_ch = ? AND from_vs = ? ORDER BY votes DESC, rowid LIMIT 150",
                                      [.text(bookId.uppercased()), .integer(Int64(chapter)), .integer(Int64(verse))]) else { return nil }
        let texts = verseTexts(rows.map { ($0.values[0].string ?? "", $0.values[1].int ?? 0, $0.values[2].int ?? 0) })
        return rows.map { r in
            let b = r.values[0].string ?? "", c = r.values[1].int ?? 0, v = r.values[2].int ?? 0
            return CrossRef(bookId: b, chapter: c, verse: v, endVerse: r.values[3].int, votes: r.values[4].int ?? 0, text: texts["\(b)|\(c)|\(v)"] ?? "")
        }
    }

    static func groupKey(_ reciprocal: Bool, _ heading: String?) -> String { reciprocal ? "__RECIPROCAL__" : (heading ?? "__NONE__") }

    func tske(_ bookId: String, _ chapter: Int, _ verse: Int) -> [TskeGroup]? {
        guard let d = db("tske_refs"),
              let rows = try? d.query("""
                SELECT heading, is_reciprocal, to_book, to_ch, to_vs, to_vs_end, sort_order, context
                       FROM tske_refs
                       WHERE from_book = ? AND from_ch = ? AND from_vs = ?
                       ORDER BY is_reciprocal ASC, rowid ASC
                """, [.text(bookId.uppercased()), .integer(Int64(chapter)), .integer(Int64(verse))]) else { return nil }
        return groups(rows, offset: 0)
    }

    /// Groups TSKe rows (columns starting at `offset`: heading, is_reciprocal, to_book, to_ch, to_vs, to_vs_end, sort_order, context).
    func groups(_ rows: [SQLiteRow], offset o: Int) -> [TskeGroup] {
        let texts = verseTexts(rows.map { ($0.values[o + 2].string ?? "", $0.values[o + 3].int ?? 0, $0.values[o + 4].int ?? 0) })
        var order: [String] = [], map: [String: TskeGroup] = [:]
        for r in rows {
            let recip = r.values[o + 1].int == 1, heading = r.values[o].string
            let key = Self.groupKey(r.values[o + 1].int != 0 && r.values[o + 1].int != nil, heading)
            if map[key] == nil { order.append(key); map[key] = TskeGroup(heading: recip || (r.values[o + 1].int ?? 0) != 0 ? nil : Self.decodeTske(heading), isReciprocal: recip, refs: []) }
            let b = r.values[o + 2].string ?? "", c = r.values[o + 3].int ?? 0, v = r.values[o + 4].int ?? 0
            map[key]!.refs.append(TskeRef(bookId: b, chapter: c, verse: v, endVerse: r.values[o + 5].int, text: texts["\(b)|\(c)|\(v)"] ?? "", context: Self.decodeTske(r.values[o + 7].string)))
        }
        return order.map { map[$0]! }
    }

    /// `getForChapter` — Classic refs grouped by source verse (LXX Psalm chapters mapped to KJV).
    public func forChapter(_ bookId: String, _ chapter: Int, textId: String = "kjva") -> (verseRefs: [(verseNum: Int, refs: [CrossRef])], error: Bool) {
        guard let d = db("cross_references") else { return ([], true) }
        let chapters = ChapterMap.canonicalChapters(bookId, chapter, textId: textId)
        let ph = Array(repeating: "?", count: chapters.count).joined(separator: ", ")
        guard let rows = try? d.query("SELECT from_vs, to_book, to_ch, to_vs, to_vs_end, votes FROM refs WHERE from_book = ? AND from_ch IN (\(ph)) ORDER BY from_vs ASC, votes DESC, rowid",
                                      [.text(bookId.uppercased())] + chapters.map { .integer(Int64($0)) }) else { return ([], true) }
        let texts = verseTexts(rows.map { ($0.values[1].string ?? "", $0.values[2].int ?? 0, $0.values[3].int ?? 0) })
        var order: [Int] = [], grouped: [Int: [CrossRef]] = [:]
        for r in rows {
            let fv = r.values[0].int ?? 0
            if grouped[fv] == nil { order.append(fv); grouped[fv] = [] }
            let b = r.values[1].string ?? "", c = r.values[2].int ?? 0, v = r.values[3].int ?? 0
            grouped[fv]!.append(CrossRef(bookId: b, chapter: c, verse: v, endVerse: r.values[4].int, votes: r.values[5].int ?? 0, text: texts["\(b)|\(c)|\(v)"] ?? ""))
        }
        return (order.sorted().map { ($0, grouped[$0]!) }, false)
    }

    /// `getTSKeForChapter`.
    public func tskeForChapter(_ bookId: String, _ chapter: Int, textId: String = "kjva") -> (verseRefs: [(verseNum: Int, groups: [TskeGroup])], error: Bool) {
        guard let d = db("tske_refs") else { return ([], true) }
        let chapters = ChapterMap.canonicalChapters(bookId, chapter, textId: textId)
        let ph = Array(repeating: "?", count: chapters.count).joined(separator: ", ")
        guard let rows = try? d.query("""
            SELECT from_vs, heading, is_reciprocal, to_book, to_ch, to_vs, to_vs_end, sort_order, context
                     FROM tske_refs
                     WHERE from_book = ? AND from_ch IN (\(ph))
                     ORDER BY from_vs ASC, is_reciprocal ASC, rowid ASC
            """, [.text(bookId.uppercased())] + chapters.map { .integer(Int64($0)) }) else { return ([], true) }
        var order: [Int] = [], byVerse: [Int: [SQLiteRow]] = [:]
        for r in rows { let fv = r.values[0].int ?? 0; if byVerse[fv] == nil { order.append(fv); byVerse[fv] = [] }; byVerse[fv]!.append(r) }
        return (order.sorted().map { ($0, groups(byVerse[$0]!, offset: 1)) }, false)
    }

    /// `getHermasTaylorChapter`.
    public func hermasTaylorChapter(_ bookId: String, _ chapter: Int) -> (refs: [HermasFootnoteRef], error: Bool) {
        guard let d = db("hermas_taylor"),
              let rows = try? d.query("SELECT to_book, to_chapter, to_verse, raw FROM crossrefs WHERE from_book = ? AND from_chapter = ? ORDER BY id ASC",
                                      [.text(bookId.uppercased()), .integer(Int64(chapter))]) else { return ([], true) }
        let texts = verseTexts(rows.map { ($0.values[0].string ?? "", $0.values[1].int ?? 0, $0.values[2].int ?? 0) })
        return (rows.map { r in
            let b = r.values[0].string ?? "", c = r.values[1].int ?? 0, v = r.values[2].int ?? 0
            return HermasFootnoteRef(bookId: b, chapter: c, verse: v, raw: r.values[3].string ?? "", text: texts["\(b)|\(c)|\(v)"] ?? "")
        }, false)
    }

    /// `getForVerse` — merged over both KJV chapters for an LXX merge chapter.
    public func forVerse(_ bookId: String, _ chapter: Int, _ verse: Int, textId: String = "kjva") -> (refs: [CrossRef], error: Bool) {
        let chapters = ChapterMap.canonicalChapters(bookId, chapter, textId: textId)
        let results = chapters.map { crossRefs(bookId, $0, verse) }
        var seen = Set<String>(), refs: [CrossRef] = []
        for r in results.compactMap({ $0 }).flatMap({ $0 }) where seen.insert("\(r.bookId)|\(r.chapter)|\(r.verse)|\(r.endVerse.map(String.init) ?? "")").inserted { refs.append(r) }
        return (refs, results.allSatisfy { $0 == nil })
    }

    /// `getTSKeForVerse`.
    public func tskeForVerse(_ bookId: String, _ chapter: Int, _ verse: Int, textId: String = "kjva") -> (groups: [TskeGroup], error: Bool) {
        let chapters = ChapterMap.canonicalChapters(bookId, chapter, textId: textId)
        let results = chapters.map { tske(bookId, $0, verse) }
        if chapters.count == 1 { return (results[0] ?? [], results[0] == nil) }
        var order: [String] = [], map: [String: TskeGroup] = [:]
        for g in results.compactMap({ $0 }).flatMap({ $0 }) {
            let key = Self.groupKey(g.isReciprocal, g.heading)
            if map[key] == nil { order.append(key); map[key] = TskeGroup(heading: g.heading, isReciprocal: g.isReciprocal, refs: []) }
            for r in g.refs {
                let k = "\(r.bookId)|\(r.chapter)|\(r.verse)|\(r.endVerse.map(String.init) ?? "")"
                if !map[key]!.refs.contains(where: { "\($0.bookId)|\($0.chapter)|\($0.verse)|\($0.endVerse.map(String.init) ?? "")" == k }) { map[key]!.refs.append(r) }
            }
        }
        return (order.map { map[$0]! }, results.allSatisfy { $0 == nil })
    }
}
