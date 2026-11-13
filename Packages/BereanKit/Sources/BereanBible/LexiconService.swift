import BereanCore
import BereanSQLite
import BereanText

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

/// One verse carrying a Strong's number, with the word positions to highlight (`LexiconOccurrence`).
public struct LexiconOccurrence: Equatable, Sendable {
    public var bookId: String, chapter: Int, verseNum: Int, text: String, textTagged: String?, textId: String
    public var matchWordIndices: [Int]
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

    /// Find the nearest existing entries in the same lexicon, ordered by Strong's number.
    public func adjacentEntries(_ strongsNum: String) -> (previous: String?, next: String?) {
        let id = Self.normalizedId(strongsNum)
        guard let language = id.first, language == "H" || language == "G",
              let number = Int64(id.dropFirst().prefix(while: \.isNumber)),
              let db = lexicon(language) else { return (nil, nil) }
        func neighbor(before: Bool) -> String? {
            let comparison = before ? "<" : ">"
            let direction = before ? "DESC" : "ASC"
            let sql = """
                SELECT strongs_id FROM entries
                WHERE (CAST(SUBSTR(strongs_id, 2) AS INTEGER), strongs_id) \(comparison) (?, ?)
                ORDER BY CAST(SUBSTR(strongs_id, 2) AS INTEGER) \(direction), strongs_id \(direction)
                LIMIT 1
                """
            return (try? db.query(sql, [.integer(number), .text(id)]))?.first?["strongs_id"]?.string
        }
        return (neighbor(before: true), neighbor(before: false))
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

    // MARK: getOccurrences

    static let tagRegex = JSRegex(#"([!*~]?)([^{}!*~]*)\{([^}]*)\}"#)
    static let functionWords: Set<String> = ["the", "a", "an", "his", "her", "its", "our", "your", "their", "my", "thy", "thine", "by", "in", "of", "on", "at",
        "to", "for", "or", "and", "but", "yet", "so", "if", "as", "he", "she", "it", "we", "us", "me", "him", "be", "is", "was", "are", "not", "no", "do",
        "did", "had", "who", "whom", "now", "with", "from", "unto", "upon", "into", "than", "then", "that", "this", "these", "those", "them", "they",
        "i", "you", "ye", "thou", "thee", "shall", "will", "hath", "have", "been", "were", "am", "up", "out", "over", "under", "again", "also", "even"]

    static func clean(_ w: String) -> String { String(JSText.lower(w).unicodeScalars.filter { ("a"..."z").contains($0) }.map(Character.init)) }

    /// `findMatchWordIndices` inside `getOccurrences`: tag positions re-anchored past function words the
    /// LXX tagging sometimes carries the number on, then expanded over adjacent untagged gloss words.
    static func occurrenceIndices(tagged: String?, plain: String, num: String, gloss: [String]) -> [Int] {
        let plainWords = JSText.collapseWhitespace(JSText.trim(plain)).split(separator: " ").map(String.init)
        if let tagged, !tagged.isEmpty {
            var wordTags: [String] = []
            for m in tagRegex.allMatches(tagged) where m[1] != "~" { wordTags.append(JSText.trim(m[3] ?? "")) }
            var matched: [Int] = []
            for (i, t) in wordTags.enumerated() where !t.isEmpty {
                if t.split(separator: "|", omittingEmptySubsequences: false).map({ JSText.upper(JSText.trim(String($0))) }).contains(num) { matched.append(i) }
            }
            if !matched.isEmpty {
                func word(_ i: Int) -> String { i < plainWords.count ? clean(plainWords[i]) : "" }
                let glossHasContent = gloss.contains { $0.utf16.count >= 5 }
                var reanchored: [Int] = []
                for idx in matched {
                    let mc = word(idx)
                    if gloss.contains(mc) { reanchored.append(idx); continue }
                    if !glossHasContent || !functionWords.contains(mc) { reanchored.append(idx); continue }
                    var found = false
                    for d in 1...4 {
                        let j = idx + d
                        if j >= plainWords.count { break }
                        let w = word(j)
                        if w.utf16.count >= 4 && gloss.contains(where: { $0 == w || $0 == w + "s" || $0 + "s" == w }) { reanchored.append(j); found = true; break }
                    }
                    if !found {
                        for d in 1...3 {
                            let j = idx + d
                            if j >= plainWords.count { break }
                            let w = word(j)
                            if w.utf16.count >= 5 && !functionWords.contains(w) { reanchored.append(j); found = true; break }
                        }
                    }
                    if !found { reanchored.append(idx) }
                }
                var expanded = Set(reanchored)
                if !gloss.isEmpty {
                    for idx in reanchored {
                        for dir in [-1, 1] {
                            var j = idx + dir
                            while j >= 0 && j < wordTags.count && wordTags[j].isEmpty {
                                let c = word(j)
                                if c.utf16.count >= 3 && gloss.contains(c) { expanded.insert(j); j += dir } else { break }
                            }
                        }
                    }
                }
                return expanded.sorted()
            }
        }
        guard !gloss.isEmpty, !plainWords.isEmpty else { return [] }
        return plainWords.enumerated().compactMap { idx, w in
            let c = clean(w)
            return c.utf16.count >= 4 && gloss.contains(where: { $0 == c || $0 == c + "s" || $0 + "s" == c }) ? idx : nil
        }
    }

    /// `getOccurrences` — verses whose own tagged text carries the number (KJVA for Hebrew; KJVA + LXX for Greek,
    /// up to 1000 / 500 per text, or `quickLimit`), optionally scoped to one book.
    public func occurrences(_ strongsNum: String, bookId: String? = nil, quickLimit: Int? = nil) -> [LexiconOccurrence] {
        let num = Self.normalizedId(strongsNum)
        guard let lang = num.first, lang == "H" || lang == "G", let lex = lexicon(lang) else { return [] }
        let isGreek = lang == "G"
        let scope = bookId.map { JSText.upper($0) }
        let kjva = connection(textPath("kjva")), lxx = connection(textPath("lxx"))
        func scan(_ db: SQLiteConnection?, _ textId: String, _ limit: Int) -> [(String, Int, Int, String)] {
            guard let db else { return [] }
            var params: [SQLiteValue] = [.text("%{\(num)}%"), .text("%{\(num)|%"), .text("%|\(num)}%"), .text("%|\(num)|%")]
            if let scope { params.append(.text(scope)) }
            params.append(.integer(Int64(limit)))
            let sql = """
                SELECT book_id, chapter, verse_num as verse FROM verses
                           WHERE (text_tagged LIKE ? OR text_tagged LIKE ? OR text_tagged LIKE ? OR text_tagged LIKE ?)\(scope != nil ? " AND book_id = ?" : "")
                           ORDER BY book_id, chapter, verse_num LIMIT ?
                """
            return ((try? db.query(sql, params)) ?? []).map { ($0.values[0].string ?? "", $0.values[1].int ?? 0, $0.values[2].int ?? 0, textId) }
        }
        let raw = isGreek ? scan(kjva, "kjva", quickLimit ?? 500) + scan(lxx, "lxx", quickLimit ?? 500) : scan(kjva, "kjva", quickLimit ?? 1000)
        if raw.isEmpty { return [] }
        let shortDef = (try? lex.query("SELECT short_def FROM entries WHERE strongs_id = ?", [.text(num)]))?.first?.values.first?.string ?? ""
        let gloss = VerseDisplay.glossWords(shortDef)
        return raw.map { b, c, v, t in
            let db = t == "lxx" ? lxx : kjva
            let row = (try? db?.query("SELECT text, text_tagged FROM verses WHERE book_id = ? AND chapter = ? AND verse_num = ? LIMIT 1",
                                      [.text(b), .integer(Int64(c)), .integer(Int64(v))]))??.first
            let text = row?.values[0].string ?? "", tagged = row?.values[1].string
            return LexiconOccurrence(bookId: b, chapter: c, verseNum: v, text: text, textTagged: tagged, textId: t,
                                     matchWordIndices: Self.occurrenceIndices(tagged: tagged, plain: text, num: num, gloss: gloss))
        }
    }
}
