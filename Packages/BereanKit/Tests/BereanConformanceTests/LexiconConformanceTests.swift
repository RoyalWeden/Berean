import Testing
import BereanCore
import BereanSync
import BereanBible

extension LexiconEntry {
    var json: JSValue {
        var o = JSObject()
        for (k, v) in [("strongsNum", strongsNum), ("lemma", lemma), ("transliteration", transliteration), ("pronunciation", pronunciation),
                       ("gloss", gloss), ("definition", definition), ("derivation", derivation), ("extendedDef", extendedDef)] { o[k] = .string(JSString(v)) }
        o["occurrences"] = .number(Double(occurrences))
        return .object(o)
    }
}

@Suite("lexicon golden", .enabled(if: dataFile("strongs_hebrew") != nil, "data/*.db not present")) struct LexiconConformanceTests {
    let g: JSObject
    let svc = LexiconService(lexiconPath: { dataFile($0 == "H" ? "strongs_hebrew" : "strongs_greek") }, textPath: { dataFile($0) })
    init() throws { g = try Golden.load("lexicon") }

    @Test func everyEntry() async {
        var failures: [String] = []
        for b in g.arr("entryBlocks") {
            let lang = b["lang"]!.str, start = b["start"]!.int
            let max = lang == "H" ? 8674 : 5624
            var rows: [JSValue] = []
            var n = start
            while n < start + 250 && n <= max + 2 { rows.append(await svc.entry("\(lang)\(n)")?.json ?? .null); n += 1 }
            if SyncHash.shortHash(JSON.stringify(.array(rows)).units) != b["hash"]!.str { failures.append("\(lang)\(start)…") }
        }
        for c in g.arr("entryCases") where (await svc.entry(c["id"]!.str)?.json ?? .null) != c["entry"]! { failures.append("entry \(c["id"]!.str.debugDescription)") }
        #expect(failures.isEmpty, Comment(rawValue: failures.joined(separator: "\n")))
    }

    @Test func relatedSearchAndPages() async {
        var failures: [String] = []
        for c in g.arr("related") {
            let got = JSValue.array(await svc.related(c["id"]!.str).map { r in
                var o = JSObject()
                o["strongsNum"] = .string(JSString(r.strongsNum)); o["lemma"] = .string(JSString(r.lemma))
                o["transliteration"] = .string(JSString(r.transliteration)); o["gloss"] = .string(JSString(r.gloss))
                return .object(o)
            })
            if got != c["related"]! { failures.append("related \(c["id"]!.str)") }
        }
        for c in g.arr("search") where JSValue.array(await svc.search(c["query"]!.str, lang: c["lang"]!.str).map(\.json)) != c["results"]! {
            failures.append("search \(c["query"]!.str.debugDescription) \(c["lang"]!.str)")
        }
        for c in g.arr("pages") {
            let off = Int((c["offset"]!.numberValue!).rounded(.down)), lim = Int((c["limit"]!.numberValue!).rounded(.down))
            let p = await svc.occurrencePage(c["num"]!.str, textId: c["textId"]!.str, bookId: c["bookId"]!.str, offset: off, limit: lim)
            var o = JSObject()
            o["rows"] = .array(p.rows.map { r in
                var x = JSObject()
                x["book_id"] = .string(JSString(r.bookId)); x["chapter"] = .number(Double(r.chapter)); x["verse_num"] = .number(Double(r.verseNum)); x["text"] = .string(JSString(r.text))
                return .object(x)
            })
            o["hasMore"] = .bool(p.hasMore)
            if .object(o) != c["page"]! { failures.append("page \(c["num"]!.str) \(c["textId"]!.str) \(c["bookId"]!.str) \(off) \(lim)") }
        }
        #expect(failures.isEmpty, Comment(rawValue: failures.joined(separator: "\n")))
    }

    @Test func occurrences() async {
        var failures: [String] = []
        for c in g.arr("occurrences") {
            let rows = await svc.occurrences(c["num"]!.str, bookId: c["bookId"]?.optionalString, quickLimit: c["quickLimit"]?.numberValue.map { Int($0) })
            let json = rows.map { r -> JSValue in
                var o = JSObject()
                o["book_id"] = .string(JSString(r.bookId)); o["chapter"] = .number(Double(r.chapter)); o["verse_num"] = .number(Double(r.verseNum))
                o["text"] = .string(JSString(r.text)); o["text_tagged"] = r.textTagged.map { .string(JSString($0)) } ?? .null
                o["text_id"] = .string(JSString(r.textId)); o["matchWordIndices"] = .array(r.matchWordIndices.map { .number(Double($0)) })
                return .object(o)
            }
            let d = digest(json)
            if d["count"] != c["count"] || d["hash"] != c["hash"] { failures.append("\(c["num"]!.str) \(c["bookId"]?.optionalString ?? "-") \(rows.count)") }
        }
        #expect(failures.isEmpty, Comment(rawValue: failures.joined(separator: "\n")))
    }
}
