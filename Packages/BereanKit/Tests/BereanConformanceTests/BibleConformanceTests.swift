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

    /// Exact order is required except among equal-rank rows: FTS `ORDER BY rank` has no tie-breaker
    /// and SQLite versions order ties differently (DECISIONS F-05). Such cases must still return the
    /// identical row set; they are reported, not failed.
    @Test func search() async {
        var failures: [String] = [], tieOrder: [String] = []
        for c in g.arr("search") {
            let books = c["bookIds"]?.arrayValue?.map(\.str)
            let rows = await svc.searchText(c["query"]!.str, textId: c["text"]!.str, mode: WordMode(rawValue: c["mode"]!.str)!,
                                            bookIds: books, chapter: c["chapter"]?.numberValue.map { Int($0) })
            let json = rows.map(\.json)
            let d = digest(json)
            let label = "\(c["text"]!.str) \(c["query"]!.str.debugDescription) \(c["mode"]!.str) \(books ?? [])"
            if d["count"] == c["count"] && d["hash"] == c["hash"] { continue }
            let sorted = json.map { JSON.stringify($0) }.sorted().map { JSValue.string($0) }
            let setHash = SyncHash.shortHash(JSON.stringify(.array(sorted)).units)
            if d["count"] == c["count"] && setHash == c["setHash"]!.str { tieOrder.append(label); continue }
            failures.append("\(label): got \(rows.count), want \(c["count"]!.int)")
        }
        if !tieOrder.isEmpty { print("bible golden: \(tieOrder.count) searches differ only in equal-rank order (SQLite \(SQLiteConnection.libraryVersion)): \(tieOrder)") }
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
