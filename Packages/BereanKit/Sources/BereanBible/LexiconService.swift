import BereanCore
import BereanSQLite

/// Strong's lexicon lookups — port of src/platform/services/lexiconService.ts (same SQL).
public struct LexiconEntry: Equatable, Sendable {
    public var strongsNum: String, lemma: String, transliteration: String, pronunciation: String
    public var gloss: String, definition: String, derivation: String, extendedDef: String, occurrences: Int
}
public struct LexiconRelated: Equatable, Sendable { public var strongsNum: String, lemma: String, transliteration: String, gloss: String }
public struct LexiconOccurrencePage: Equatable, Sendable {
    public struct Row: Equatable, Sendable { public var bookId: String, chapter: Int, verseNum: Int, text: String }
    public var rows: [Row]
    public var hasMore: Bool
}

public actor LexiconService {
    private let lexiconPath: @Sendable (Character) -> String?   // "H" / "G"
    private let textPath: @Sendable (String) -> String?
    private var open: [String: SQLiteConnection] = [:]
    static let occurrenceTexts: [Character: [String]] = ["H": ["kjva"], "G": ["kjva", "lxx"]]
    static let pageMax = 50

    public init(lexiconPath: @escaping @Sendable (Character) -> String?, textPath: @escaping @Sendable (String) -> String?) {
        self.lexiconPath = lexiconPath; self.textPath = textPath
    }

    private func connection(_ path: String?) -> SQLiteConnection? {
        guard let path else { return nil }
        if let c = open[path] { return c }
        guard let c = try? SQLiteConnection(readOnlyPath: path) else { return nil }
        open[path] = c
        return c
    }
    private func lexicon(_ lang: Character) -> SQLiteConnection? { connection(lexiconPath(lang)) }

    static func mapEntry(_ r: SQLiteRow) -> LexiconEntry {
        func s(_ k: String) -> String { r[k]?.string ?? "" }
        return LexiconEntry(strongsNum: s("strongs_id"), lemma: s("word"), transliteration: s("transliteration"), pronunciation: s("pronunciation"),
                            gloss: s("short_def"), definition: s("full_def"), derivation: s("derivation"), extendedDef: s("bdb_def"),
                            occurrences: r["occurrence_count"]?.int ?? 0)
    }

    static func normalizedId(_ s: String) -> String { JSText.upper(JSText.trim(s)) }

    /// `getEntry`.
    public func entry(_ strongsNum: String) -> LexiconEntry? {
        let num = Self.normalizedId(strongsNum)
        guard let lang = num.first, lang == "H" || lang == "G", let db = lexicon(lang) else { return nil }
        return (try? db.query("SELECT * FROM entries WHERE strongs_id = ?", [.text(num)]))?.first.map(Self.mapEntry)
    }

    /// `getRelated` — entries whose derivation cites this one (Hebrew: bare number as a whole token).
    public func related(_ strongsNum: String) -> [LexiconRelated] {
        let num = Self.normalizedId(strongsNum)
        let sql = "SELECT strongs_id, word, transliteration, short_def, derivation FROM entries WHERE derivation LIKE ? AND strongs_id != ? LIMIT ?"
        var rows: [SQLiteRow] = []
        if num.hasPrefix("H") {
            var bare = String(num.dropFirst())
            while bare.count > 1, bare.first == "0", let second = bare.dropFirst().first, second.isASCII, second.isNumber { bare.removeFirst() }
            if !bare.isEmpty, let db = lexicon("H") {
                let candidates = (try? db.query(sql, [.text("%\(bare)%"), .text(num), .integer(400)])) ?? []
                rows = Array(candidates.filter { r in
                    guard let d = r["derivation"]?.string, !d.isEmpty else { return false }
                    return Self.containsWholeNumber(d, bare)
                }.prefix(12))
            }
        } else if num.hasPrefix("G"), let db = lexicon("G") {
            rows = (try? db.query(sql, [.text("%\(num)%"), .text(num), .integer(12)])) ?? []
        }
        return rows.map { r in
            LexiconRelated(strongsNum: r["strongs_id"]?.string ?? "", lemma: r["word"]?.string ?? "",
                           transliteration: r["transliteration"]?.string ?? "", gloss: r["short_def"]?.string ?? "")
        }
    }

    /// `/(^|[^0-9])<bare>(?![0-9])/` with `bare` matched literally (TypeScript interpolates it unescaped;
    /// identical for the digit strings real ids produce).
    static func containsWholeNumber(_ hay: String, _ bare: String) -> Bool {
        let h = Array(hay.utf16), b = Array(bare.utf16)
        guard b.count <= h.count else { return false }
        func digit(_ c: UInt16) -> Bool { (0x30...0x39).contains(c) }
        for i in 0...(h.count - b.count) where Array(h[i..<(i + b.count)]) == b {
            if (i == 0 || !digit(h[i - 1])) && (i + b.count == h.count || !digit(h[i + b.count])) { return true }
        }
        return false
    }

    /// `search` — gloss/definition search over one or both lexicons (30 per lexicon).
    public func search(_ query: String, lang: String) -> [LexiconEntry] {
        let q = SQLiteValue.text("%\(JSText.trim(query))%")
        let sql = """

              SELECT * FROM entries
              WHERE strongs_id LIKE ? OR word LIKE ? OR transliteration LIKE ?
                 OR short_def LIKE ? OR full_def LIKE ? OR bdb_def LIKE ?
              ORDER BY
                CASE
                  WHEN short_def LIKE ? THEN 0
                  WHEN strongs_id LIKE ? OR word LIKE ? OR transliteration LIKE ? THEN 1
                  ELSE 2
                END,
                strongs_id
              LIMIT 30

            """
        var out: [LexiconEntry] = []
        for l: Character in ["H", "G"] where lang == String(l) || lang == "all" {
            guard let db = lexicon(l), let rows = try? db.query(sql, Array(repeating: q, count: 10)) else { break }
            out += rows.map(Self.mapEntry)
        }
        return out
    }

    /// `getOccurrencePage` — one page of verses tagged with the id in one text and book.
    public func occurrencePage(_ strongsNum: String, textId: String, bookId: String, offset: Int = 0, limit: Int = 20) -> LexiconOccurrencePage {
        let num = Self.normalizedId(strongsNum)
        let empty = LexiconOccurrencePage(rows: [], hasMore: false)
        guard let lang = num.first, Self.occurrenceTexts[lang]?.contains(textId) == true, let db = connection(textPath(textId)) else { return empty }
        let lim = min(max(limit, 1), Self.pageMax), off = max(offset, 0)
        let sql = """
            SELECT book_id, chapter, verse_num, text FROM verses
                     WHERE (text_tagged LIKE ? OR text_tagged LIKE ? OR text_tagged LIKE ? OR text_tagged LIKE ?) AND book_id = ?
                     ORDER BY chapter, verse_num LIMIT ? OFFSET ?
            """
        guard let rows = try? db.query(sql, [.text("%{\(num)}%"), .text("%{\(num)|%"), .text("%|\(num)}%"), .text("%|\(num)|%"),
                                             .text(JSText.upper(bookId)), .integer(Int64(lim + 1)), .integer(Int64(off))]) else { return empty }
        return LexiconOccurrencePage(rows: rows.prefix(lim).map { r in
            .init(bookId: r.values[0].string ?? "", chapter: r.values[1].int ?? 0, verseNum: r.values[2].int ?? 0, text: r.values[3].string ?? "")
        }, hasMore: rows.count > lim)
    }
}
