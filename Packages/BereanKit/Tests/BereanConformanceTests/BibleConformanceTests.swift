import Testing
import BereanCore
import BereanSync
import BereanSQLite
import BereanBible

/// Repository `data/` (symlinked in worktrees; downloaded in CI). Tests skip when absent.
let repoDataDir: String = {
    var parts = #filePath.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
    parts.removeLast(5)   // …/Packages/BereanKit/Tests/BereanConformanceTests/<file>
    return parts.joined(separator: "/") + "/data"
}()
func dataFile(_ textId: String) -> String? {
    let p = "\(repoDataDir)/\(textId).db"
    return (try? SQLiteConnection(readOnlyPath: p)) != nil ? p : nil
}
let bibleDataPresent = dataFile("kjva") != nil

extension ChapterVerseRow {
    var json: JSValue {
        var o = JSObject()
        o["book_id"] = .string(JSString(bookId)); o["chapter"] = .number(Double(chapter)); o["verse_num"] = .number(Double(verseNum)); o["text"] = .string(JSString(text))
        if hasTaggedColumn { o["text_tagged"] = textTagged.map { .string(JSString($0)) } ?? .null }
        if hasTitleColumn { o["title"] = title.map { .string(JSString($0)) } ?? .null }
        return .object(o)
    }
}
extension VerseSearchRow {
    var json: JSValue {
        var o = JSObject()
        o["book_id"] = .string(JSString(bookId)); o["chapter"] = .number(Double(chapter)); o["verse_num"] = .number(Double(verseNum)); o["text"] = .string(JSString(text))
        if hasTaggedColumn { o["text_tagged"] = textTagged.map { .string(JSString($0)) } ?? .null }
        return .object(o)
    }
}
func digest(_ rows: [JSValue]) -> JSObject {
    var o = JSObject()
    o["count"] = .number(Double(rows.count))
    o["hash"] = .string(JSString(SyncHash.shortHash(JSON.stringify(.array(rows)).units)))
    return o
}

@Suite("bible golden", .enabled(if: bibleDataPresent, "data/*.db not present")) struct BibleConformanceTests {
    let g: JSObject
    let svc = BibleService(resolvePath: { dataFile($0) })
    init() throws { g = try Golden.load("bible") }

    @Test func booksChaptersAndVerses() async throws {
        var failures: [String] = []
        for (textId, tv) in g["texts"]!.object.entries {
            let t = tv.object
            let books = await svc.getBooks(textId.string)
            let booksJSON = JSValue.array(books.map { b in
                var o = JSObject()
                o["id"] = .string(JSString(b.id)); o["name"] = .string(JSString(b.name)); o["short_name"] = .string(JSString(b.shortName))
                o["testament"] = .string(JSString(b.testament)); o["chapters_count"] = .number(Double(b.chaptersCount))
                return .object(o)
            })
            if booksJSON != t["books"]! { failures.append("\(textId) books differ") }
            for c in t.arr("chapters") {
                let rows = await svc.queryChapter(c["bookId"]!.str, c["chapter"]!.int, textId: textId.string)
                let d = digest(rows.map(\.json))
                if d["count"] != c["count"] || d["hash"] != c["hash"] { failures.append("\(textId) \(c["bookId"]!.str) \(c["chapter"]!.int)") }
            }
            if let first = t.arr("firstChapterFull").first {
                let rows = await svc.queryChapter(first["book_id"]!.str, 1, textId: textId.string)
                if JSValue.array(rows.map(\.json)) != t["firstChapterFull"]! { failures.append("\(textId) first chapter full") }
                let v = await svc.queryVerse(first["book_id"]!.str, 1, 1, textId: textId.string)
                var vo = JSObject()
                if let v {
                    vo["verse_num"] = .number(Double(v.verseNum)); vo["text"] = .string(JSString(v.text))
                    if v.hasTaggedColumn { vo["text_tagged"] = v.textTagged.map { .string(JSString($0)) } ?? .null }
                }
                if (v == nil ? JSValue.null : .object(vo)) != t["verse"]! { failures.append("\(textId) verse") }
                if await svc.queryVerse(first["book_id"]!.str, 1, 9999, textId: textId.string) != nil { failures.append("\(textId) missing verse") }
            }
        }
        #expect(failures.isEmpty, Comment(rawValue: "\(failures.count) mismatches:\n" + failures.prefix(30).joined(separator: "\n")))
    }

    @Test func queryVersesSample() async {
        let got = await svc.queryVerses([("GEN", 1, 1), ("GEN", 1, 3), ("JHN", 3, 16), ("PSA", 119, 176), ("GEN", 1, 9999), ("XYZ", 1, 1), ("GEN", 1, 1)], textId: "kjva")
        var o = JSObject()
        for (k, v) in got {
            var e = JSObject()
            e["text"] = .string(JSString(v.text))
            if let tt = v.textTagged { e["text_tagged"] = .string(JSString(tt)) }
            if let t = v.title { e["title"] = .string(JSString(t)) }
            o[JSString(k)] = .object(e)
        }
        #expect(JSValue.object(o) == g["versesSample"]!)
    }

    /// Exact order required (ADR-0008: `ORDER BY rank, v.id` is stable across SQLite builds).
    @Test func search() async {
        var failures: [String] = []
        for c in g.arr("search") {
            let books = c["bookIds"]?.arrayValue?.map(\.str)
            let rows = await svc.searchText(c["query"]!.str, textId: c["text"]!.str, mode: WordMode(rawValue: c["mode"]!.str)!,
                                            bookIds: books, chapter: c["chapter"]?.numberValue.map { Int($0) })
            let d = digest(rows.map(\.json))
            let first = rows.prefix(3).map { "\($0.bookId).\($0.chapter).\($0.verseNum)" }
            if d["count"] != c["count"] || d["hash"] != c["hash"] || first != c["first"]!.array.map(\.str) {
                failures.append("\(c["text"]!.str) \(c["query"]!.str.debugDescription) \(c["mode"]!.str) \(books ?? []): got \(rows.count) \(first), want \(c["count"]!.int)")
            }
        }
        #expect(failures.isEmpty, Comment(rawValue: "SQLite \(SQLiteConnection.libraryVersion) — \(failures.count) mismatches:\n" + failures.prefix(30).joined(separator: "\n")))
    }

    @Test func queryHelpers() {
        for c in g.arr("fts") {
            #expect(BibleText.safeFtsQuery(c["query"]!.str, phrase: c["mode"]!.str == "phrase") == c["result"]!.str, "\(c["query"]!.str)")
        }
        for c in g.arr("numberWords") {
            #expect(BibleText.numberTokenAlternates(c["token"]!.str) == c["result"]!.array.map(\.str), "\(c["token"]!.str)")
        }
    }
}

/// B-15 evidence: the platform SQLite has FTS5 and the bundled corpora's FTS tables work on it.
@Suite struct SQLiteEnvironmentTests {
    @Test func fts5Available() throws {
        let db = try SQLiteConnection(readOnlyPath: ":memory:")
        let options = try db.query("PRAGMA compile_options").compactMap { $0.values.first?.string }
        print("SQLite \(SQLiteConnection.libraryVersion); FTS5=\(options.contains("ENABLE_FTS5")); \(options.filter { $0.hasPrefix("ENABLE_") }.joined(separator: ","))")
        #expect(options.contains("ENABLE_FTS5"))
    }
}

/// Every book of every shipped text is navigable: it has chapters, each chapter has verses, and single-chapter books
/// and prologue chapters (0) are listed (owner report 2026-11-12: single-chapter books showed no chapter to pick).
@Suite("book and chapter catalog", .enabled(if: bibleDataPresent)) struct BookCatalogTests {
    static let texts = ["kjva", "kjv", "lxx_brenton", "enoch", "jubilees", "apoc_elijah", "recog_clement", "hermas", "hermas_taylor", "asc_isaiah",
                        "ep_barnabas", "t12p", "gad", "t_job", "1clement", "apoc_abraham", "didache_hoole", "t_jacob", "2baruch"]

    @Test(arguments: texts) func everyBookHasNavigableChapters(_ textId: String) async {
        let svc = BibleService(resolvePath: { dataFile($0) })
        guard dataFile(textId) != nil else { return }
        let books = await svc.getBooks(textId)
        #expect(!books.isEmpty, "\(textId) has no books")
        for b in books {
            let chapters = await svc.chapterNumbers(b.id, textId: textId)
            #expect(!chapters.isEmpty, "\(textId) \(b.id) has no chapters")
            #expect(b.chaptersCount >= 1, "\(textId) \(b.id) chapter count \(b.chaptersCount)")
            for c in [chapters.first!, chapters.last!] {
                let rows = await svc.queryChapter(b.id, c, textId: textId)
                #expect(!rows.isEmpty, "\(textId) \(b.id) \(c) empty")
            }
        }
    }

    @Test func singleChapterAndPrologueBooks() async {
        let svc = BibleService(resolvePath: { dataFile($0) })
        for id in ["OBA", "PHM", "2JN", "3JN", "JUD", "PRA", "SUS", "BEL", "PRM"] { let c = await svc.chapterNumbers(id, textId: "kjva"); #expect(c == [1], "\(id)") }
        let sir = await svc.chapterNumbers("SIR", textId: "kjva"), cl = await svc.chapterNumbers("1CL", textId: "1clement"), ob = await svc.chapterNumbers("OBA", textId: "lxx_brenton")
        #expect(sir.first == 0); #expect(cl.first == 0); #expect(ob == [1])
    }
}

@Suite("multi-text scripture search", .enabled(if: bibleDataPresent)) struct ScriptureSearchTests {
    let all = BookCatalogTests.texts.filter { $0 != "kjv" && $0 != "lxx_brenton" } + ["lxx"]
    func svc() -> BibleService { BibleService(resolvePath: { dataFile($0 == "lxx" ? "lxx_brenton" : $0) }) }

    @Test func allTextsFindsExtraBiblicalTexts() async {
        let r = await ScriptureSearch.run("watchers", in: all, mode: .all, bible: svc())
        let texts = Set(r.hits.map(\.textId))
        #expect(texts.contains("enoch"), "\(texts)")
        #expect(texts.count >= 2)
        let one = await ScriptureSearch.run("watchers", in: ["kjva"], mode: .all, bible: svc())
        #expect(one.hits.allSatisfy { $0.textId == "kjva" })
        #expect(r.hits.count > one.hits.count)
    }

    @Test func phraseModeFiltersExactPhrase() async {
        let r = await ScriptureSearch.run("so loved the world", in: ["kjva"], mode: .phrase, bible: svc())
        #expect(!r.hits.isEmpty)
        #expect(r.hits.allSatisfy { ScriptureSearch.stripForPhrase($0.text).contains("so loved the world") })
        #expect(r.hits.contains { $0.bookId == "JHN" && $0.chapter == 3 && $0.verseNum == 16 })
    }

    @Test func noDuplicatesAndReplacerVariants() async {
        // "Yehovah" is the restored rendering of LORD: the variants find KJV "LORD" verses.
        let lex = LexiconService(lexiconPath: { dataFile($0 == "H" ? "strongs_hebrew" : "strongs_greek") }, textPath: { dataFile($0 == "lxx" ? "lxx_brenton" : $0) })
        let r = await ScriptureSearch.run("Yehovah my shepherd", in: ["kjva"], mode: .all, bible: svc(), lexicon: lex)
        #expect(r.hits.contains { $0.bookId == "PSA" && $0.chapter == 23 && $0.verseNum == 1 })
        #expect(Set(r.hits).count == r.hits.count)
    }

    @Test func bookFilterAndShortQuery() async {
        let r = await ScriptureSearch.run("love", in: ["kjva"], mode: .all, bookIds: ["1JN"], bible: svc())
        #expect(!r.hits.isEmpty && r.hits.allSatisfy { $0.bookId == "1JN" })
        let short = await ScriptureSearch.run("a", in: ["kjva"], mode: .all, bible: svc())
        #expect(short.hits.isEmpty)
    }

    @Test func deterministicOrder() async {
        let a = await ScriptureSearch.run("grace", in: all, mode: .any, bible: svc())
        let b = await ScriptureSearch.run("grace", in: all, mode: .any, bible: svc())
        #expect(a.hits == b.hits)
    }
}

@Suite("strong's number search", .enabled(if: bibleDataPresent)) struct StrongsQueryTests {
    @Test func numbersAndWords() async {
        let lex = LexiconService(lexiconPath: { dataFile($0 == "H" ? "strongs_hebrew" : "strongs_greek") }, textPath: { dataFile($0 == "lxx" ? "lxx_brenton" : $0) })
        let g = await ScriptureSearch.strongs("G5485", lexicon: lex)
        #expect((g?.count ?? 0) > 100)
        let both = await ScriptureSearch.strongs("H7225 H430", lexicon: lex)
        #expect(both?.contains { $0.bookId == "GEN" && $0.chapter == 1 && $0.verseNum == 1 } == true)
        let none = await ScriptureSearch.strongs("grace", lexicon: lex)
        #expect(none == nil)
    }
}
