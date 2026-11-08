import BereanCore
import BereanSQLite
import BereanReference

/// Read-only Scripture access — port of src/platform/services/bibleService.ts (same SQL, same
/// result shapes). Text databases are opened read-only on first use.
public struct BookRow: Equatable, Sendable {
    public var id: String, name: String, shortName: String, testament: String, chaptersCount: Int
}
public struct ChapterVerseRow: Equatable, Sendable {
    public var bookId: String, chapter: Int, verseNum: Int, text: String
    public var textTagged: String?, title: String?
    /// Which optional columns the text database has (they appear in TypeScript rows even when NULL).
    public var hasTaggedColumn = false, hasTitleColumn = false
}
public struct VerseSearchRow: Equatable, Sendable {
    public var bookId: String, chapter: Int, verseNum: Int, text: String, textTagged: String?
    public var hasTaggedColumn = false
}
public enum WordMode: String, Sendable { case all, any, phrase }

public actor BibleService {
    private let resolvePath: @Sendable (String) -> String?
    private var connections: [String: SQLiteConnection] = [:]
    private var maxChaptersCache: [String: [String: Int]] = [:]

    /// `resolvePath(textId)` returns the database file for a text id, or nil if unknown.
    public init(resolvePath: @escaping @Sendable (String) -> String?) { self.resolvePath = resolvePath }

    func db(_ textId: String) -> SQLiteConnection? {
        if let c = connections[textId] { return c }
        guard let path = resolvePath(textId), let c = try? SQLiteConnection(readOnlyPath: path) else { return nil }
        connections[textId] = c
        return c
    }

    public func getBooks(_ textId: String = "kjva") -> [BookRow] {
        guard let db = db(textId) else { return [] }
        let orderBy = db.hasColumn("books", "sort_order") ? "ORDER BY COALESCE(sort_order, 9999), rowid" : "ORDER BY rowid"
        var books = ((try? db.query("SELECT id, name, short_name, testament, chapters_count FROM books \(orderBy)")) ?? []).map { r in
            BookRow(id: r.values[0].string ?? "", name: Reference.displayBookName(r.values[1].string, bookId: r.values[0].string ?? ""),
                    shortName: r.values[2].string ?? "", testament: r.values[3].string ?? "", chaptersCount: r.values[4].int ?? 0)
        }
        if books.contains(where: { $0.chaptersCount == 0 }) {
            let maxCh = maxChapters(db, textId)
            books = books.map { b in var b = b; if b.chaptersCount == 0 { b.chaptersCount = maxCh[b.id] ?? 1 }; return b }
        }
        return books
    }

    private func maxChapters(_ db: SQLiteConnection, _ textId: String) -> [String: Int] {
        if let c = maxChaptersCache[textId] { return c }
        var m: [String: Int] = [:]
        for r in (try? db.query("SELECT book_id, MAX(chapter) as max_ch FROM verses GROUP BY book_id")) ?? [] {
            if let id = r.values[0].string, let ch = r.values[1].int { m[id] = ch }
        }
        maxChaptersCache[textId] = m
        return m
    }

    public func queryChapter(_ bookId: String, _ chapter: Int, textId: String = "kjva") -> [ChapterVerseRow] {
        guard let db = db(textId) else { return [] }
        let tagged = db.hasColumn("verses", "text_tagged"), titled = db.hasColumn("verses", "title")
        var cols = ["book_id", "chapter", "verse_num", "text"]
        if tagged { cols.append("text_tagged") }
        if titled { cols.append("title") }
        let rows = (try? db.query("SELECT \(cols.joined(separator: ", ")) FROM verses WHERE book_id = ? AND chapter = ? ORDER BY verse_num",
                                  [.text(bookId), .integer(Int64(chapter))])) ?? []
        return rows.map { r in
            ChapterVerseRow(bookId: r["book_id"]?.string ?? "", chapter: r["chapter"]?.int ?? 0, verseNum: r["verse_num"]?.int ?? 0,
                            text: r["text"]?.string ?? "", textTagged: r["text_tagged"]?.string, title: r["title"]?.string,
                            hasTaggedColumn: tagged, hasTitleColumn: titled)
        }
    }

    public struct VerseRow: Equatable, Sendable { public var verseNum: Int, text: String, textTagged: String?; public var hasTaggedColumn: Bool }

    public func queryVerse(_ bookId: String, _ chapter: Int, _ verse: Int, textId: String = "kjva") -> VerseRow? {
        guard let db = db(textId) else { return nil }
        let tagged = db.hasColumn("verses", "text_tagged")
        guard let r = (try? db.query("SELECT verse_num, text\(tagged ? ", text_tagged" : "") FROM verses WHERE book_id = ? AND chapter = ? AND verse_num = ?",
                                     [.text(bookId), .integer(Int64(chapter)), .integer(Int64(verse))]))?.first else { return nil }
        return VerseRow(verseNum: r.values[0].int ?? 0, text: r.values[1].string ?? "", textTagged: tagged ? r.values[2].string : nil, hasTaggedColumn: tagged)
    }

    public struct VerseText: Equatable, Sendable { public var text: String, textTagged: String?, title: String? }

    /// `queryVerses` — keyed "BOOK.chapter.verse", in TypeScript insertion order (at most 500 refs).
    public func queryVerses(_ refs: [(bookId: String, chapter: Int, verse: Int)], textId: String = "kjva") -> [(key: String, value: VerseText)] {
        guard let db = db(textId), !refs.isEmpty else { return [] }
        let titled = db.hasColumn("verses", "title"), tagged = db.hasColumn("verses", "text_tagged")
        var groupOrder: [String] = []
        var groups: [String: (bookId: String, chapter: Int, verses: [Int])] = [:]
        for r in refs.prefix(500) {
            let k = "\(r.bookId)|\(r.chapter)"
            if groups[k] == nil { groups[k] = (r.bookId, r.chapter, []); groupOrder.append(k) }
            if !groups[k]!.verses.contains(r.verse) { groups[k]!.verses.append(r.verse) }
        }
        var out: [(String, VerseText)] = []
        var index: [String: Int] = [:]
        for k in groupOrder {
            let g = groups[k]!
            let ph = Array(repeating: "?", count: g.verses.count).joined(separator: ", ")
            let rows = (try? db.query("SELECT verse_num, text\(tagged ? ", text_tagged" : "")\(titled ? ", title" : "") FROM verses WHERE book_id = ? AND chapter = ? AND verse_num IN (\(ph))",
                                      [.text(g.bookId), .integer(Int64(g.chapter))] + g.verses.map { .integer(Int64($0)) })) ?? []
            for r in rows {
                let key = "\(g.bookId).\(g.chapter).\(r["verse_num"]?.int ?? 0)"
                let tt = r["text_tagged"]?.string.flatMap { $0.isEmpty ? nil : $0 }
                let title = r["title"]?.string.flatMap { $0.isEmpty ? nil : $0 }
                let v = VerseText(text: r["text"]?.string ?? "", textTagged: tt, title: title)
                if let i = index[key] { out[i].1 = v } else { index[key] = out.count; out.append((key, v)) }
            }
        }
        return out
    }

    /// FTS5 verse search (`searchText`). FTS syntax errors yield no rows, as in TypeScript.
    public func searchText(_ query: String, textId: String = "kjva", mode: WordMode = .all, bookIds: [String]? = nil, chapter: Int? = nil) -> [VerseSearchRow] {
        let trimmed = JSText.trim(query)
        if trimmed.isEmpty { return [] }
        guard let db = db(textId) else { return [] }
        let scoped = !(bookIds ?? []).isEmpty
        let chapterScoped = scoped && chapter != nil
        let bookClause = scoped ? " AND v.book_id IN (\(Array(repeating: "?", count: bookIds!.count).joined(separator: ", ")))" : ""
        let chapterClause = chapterScoped ? " AND v.chapter = ?" : ""
        let tagged = db.hasColumn("verses", "text_tagged")
        let limit = scoped ? 5000 : 2000
        let sql = """

              SELECT v.book_id, v.chapter, v.verse_num, v.text\(tagged ? ", v.text_tagged" : "")
              FROM verses_fts f
              JOIN verses v ON v.id = f.rowid
              WHERE verses_fts MATCH ?\(bookClause)\(chapterClause)
              ORDER BY rank
              LIMIT \(limit)

            """
        func params(_ fts: String) -> [SQLiteValue] {
            scoped ? [.text(fts)] + bookIds!.map { .text($0) } + (chapterScoped ? [.integer(Int64(chapter!))] : []) : [.text(fts)]
        }
        func run(_ fts: String) throws(SQLiteError) -> [VerseSearchRow] {
            try db.query(sql, params(fts)).map { r in
                VerseSearchRow(bookId: r.values[0].string ?? "", chapter: r.values[1].int ?? 0, verseNum: r.values[2].int ?? 0,
                               text: r.values[3].string ?? "", textTagged: tagged ? r.values[4].string : nil, hasTaggedColumn: tagged)
            }
        }
        if mode == .any {
            var seen = Set<String>()
            var rows: [VerseSearchRow] = []
            for term in BibleText.cleanWords(trimmed) {
                let fts = BibleText.safeFtsQuery(term, phrase: false)
                if fts.isEmpty { continue }
                guard let termRows = try? run(fts) else { continue }
                for r in termRows where seen.insert("\(r.bookId)|\(r.chapter)|\(r.verseNum)").inserted { rows.append(r) }
            }
            return scoped ? rows : Array(rows.prefix(3000))
        }
        let fts = BibleText.safeFtsQuery(trimmed, phrase: mode == .phrase)
        if fts.isEmpty { return [] }
        return (try? run(fts)) ?? []
    }
}

/// Query helpers shared with search surfaces (ports of `cleanWords`, `safeFtsQuery`,
/// `numberTokenAlternates`).
public enum BibleText {
    public static func cleanWords(_ q: String) -> [String] {
        JSText.collapseWhitespace(JSText.trim(q)).split(separator: " ").map { w in
            String(String.UnicodeScalarView(w.unicodeScalars.filter { $0.isASCII && ($0.properties.isAlphabetic || ("0"..."9").contains($0) || $0 == "'") }))
        }.filter { !$0.isEmpty }
    }

    public static func safeFtsQuery(_ q: String, phrase: Bool) -> String {
        let words = cleanWords(q)
        if words.isEmpty { return "" }
        if phrase { return "\"\(words.joined(separator: " "))\"" }
        return words.map { w in
            let alts = numberTokenAlternates(w)
            return alts.count > 1 ? "(\(alts.map { "\($0)*" }.joined(separator: " OR ")))" : "\(w)*"
        }.joined(separator: " AND ")
    }

    // NUMBER_TO_WORD after its later `set` calls: 20 → "score", 60 → "threescore", 80 → "fourscore"
    // replace "twenty"/"sixty"/"eighty" (legacy behaviour, reproduced exactly; see DECISIONS F-04).
    static let numberToWord: [Int: String] = {
        var m: [Int: String] = [:]
        for (i, w) in ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"].enumerated() { m[i] = w }
        for (i, w) in ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"].enumerated() { m[10 + i] = w }
        for (i, w) in ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"].enumerated() { m[20 + i * 10] = w }
        m[100] = "hundred"; m[1000] = "thousand"; m[20] = "score"; m[60] = "threescore"; m[80] = "fourscore"
        return m
    }()
    static let wordToNumber: [String: Int] = Dictionary(numberToWord.map { ($1, $0) }, uniquingKeysWith: { a, _ in a })

    public static func numberTokenAlternates(_ token: String) -> [String] {
        if !token.isEmpty, token.utf16.allSatisfy({ (0x30...0x39).contains($0) }) {
            let n = JSText.number(token)
            if let i = Int(exactly: n), let w = numberToWord[i] { return [token, w] }
            return [token]
        }
        if let n = wordToNumber[JSText.lower(token)] { return [token, String(n)] }
        return [token]
    }
}
