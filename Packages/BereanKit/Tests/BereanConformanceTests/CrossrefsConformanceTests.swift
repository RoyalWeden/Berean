import Testing
import BereanCore
import BereanSync
import BereanBible
import BereanReference

func optInt(_ i: Int?) -> JSValue { i.map { .number(Double($0)) } ?? .null }
func optStr(_ s: String?) -> JSValue { s.map { .string(JSString($0)) } ?? .null }
extension CrossRef {
    var json: JSValue { var o = JSObject(); o["bookId"] = js(bookId); o["chapter"] = .number(Double(chapter)); o["verse"] = .number(Double(verse)); o["endVerse"] = optInt(endVerse); o["votes"] = .number(Double(votes)); o["text"] = js(text); return .object(o) }
}
extension TskeGroup {
    var json: JSValue {
        var o = JSObject(); o["heading"] = optStr(heading); o["isReciprocal"] = .bool(isReciprocal)
        o["refs"] = .array(refs.map { r in var x = JSObject(); x["bookId"] = js(r.bookId); x["chapter"] = .number(Double(r.chapter)); x["verse"] = .number(Double(r.verse)); x["endVerse"] = optInt(r.endVerse); x["text"] = js(r.text); x["context"] = optStr(r.context); return .object(x) })
        return .object(o)
    }
}
func hash(_ v: JSValue) -> String { SyncHash.shortHash(JSON.stringify(v).units) }

@Suite("crossrefs golden", .enabled(if: dataFile("cross_references") != nil, "data/*.db not present")) struct CrossrefsConformanceTests {
    let g: JSObject
    let svc = CrossrefsService(dataPath: { dataFile($0) })
    init() throws { g = try Golden.load("crossrefs") }

    func chapterJSON(_ b: String, _ c: Int, _ t: String) async -> (JSValue, JSValue) {
        let r = await svc.forChapter(b, c, textId: t)
        var a = JSObject(); a["verseRefs"] = .array(r.verseRefs.map { var o = JSObject(); o["verseNum"] = .number(Double($0.verseNum)); o["refs"] = .array($0.refs.map(\.json)); return .object(o) }); a["error"] = .bool(r.error)
        let k = await svc.tskeForChapter(b, c, textId: t)
        var b2 = JSObject(); b2["verseRefs"] = .array(k.verseRefs.map { var o = JSObject(); o["verseNum"] = .number(Double($0.verseNum)); o["groups"] = .array($0.groups.map(\.json)); return .object(o) }); b2["error"] = .bool(k.error)
        return (.object(a), .object(b2))
    }

    @Test func chapters() async {
        var failures: [String] = []
        for c in g.arr("chapters") {
            let (a, b) = await chapterJSON(c["bookId"]!.str, c["chapter"]!.int, "kjva")
            if hash(a) != c["refs"]!.str || hash(b) != c["tske"]!.str { failures.append("\(c["bookId"]!.str) \(c["chapter"]!.int)") }
        }
        for c in g.arr("lxxChapters") {
            let (a, b) = await chapterJSON("PSA", c["chapter"]!.int, "lxx")
            if hash(a) != c["refs"]!.str || hash(b) != c["tske"]!.str { failures.append("LXX PSA \(c["chapter"]!.int)") }
        }
        #expect(failures.isEmpty, Comment(rawValue: "\(failures.count): " + failures.prefix(30).joined(separator: ", ")))
    }

    @Test func versesHermasAndStatus() async {
        for c in g.arr("verses") {
            let b = c["bookId"]!.str, ch = c["chapter"]!.int, v = c["verse"]!.int, t = c["textId"]!.str
            let r = await svc.forVerse(b, ch, v, textId: t)
            var a = JSObject(); a["refs"] = .array(r.refs.map(\.json)); a["loading"] = .bool(false); a["error"] = .bool(r.error)
            #expect(JSValue.object(a) == c["refs"]!, "refs \(b) \(ch):\(v) \(t)")
            let k = await svc.tskeForVerse(b, ch, v, textId: t)
            var x = JSObject(); x["groups"] = .array(k.groups.map(\.json)); x["loading"] = .bool(false); x["error"] = .bool(k.error)
            #expect(JSValue.object(x) == c["tske"]!, "tske \(b) \(ch):\(v) \(t)")
        }
        for c in g.arr("hermas") {
            let r = await svc.hermasTaylorChapter(c["bookId"]!.str, c["chapter"]!.int)
            var o = JSObject()
            o["refs"] = .array(r.refs.map { var x = JSObject(); x["bookId"] = js($0.bookId); x["chapter"] = .number(Double($0.chapter)); x["verse"] = .number(Double($0.verse)); x["raw"] = js($0.raw); x["text"] = js($0.text); return .object(x) })
            o["error"] = .bool(r.error)
            #expect(JSValue.object(o) == c["result"]!, "hermas \(c["bookId"]!.str) \(c["chapter"]!.int)")
        }
        #expect(await svc.hasData() == g["status"]!["hasData"]!.boolValue!)
    }

    @Test func chapterMap() {
        var failures = 0
        for row in g.arr("chapterMap") {
            let a = row.array
            let b = a[0].str, c = a[1].int
            let got: [JSValue] = [js(b), .number(Double(c)),
                .number(Double(ChapterMap.mapChapter(b, c, from: "kjva", to: "lxx"))), .number(Double(ChapterMap.mapChapter(b, c, from: "LXX", to: "kjv"))),
                .number(Double(ChapterMap.mapChapter(b, c, from: "kjva", to: "kjv"))),
                jsInts(ChapterMap.canonicalChapters(b, c, textId: "lxx")), jsInts(ChapterMap.canonicalChapters(b, c, textId: "kjva")),
                jsInts(ChapterMap.equivalentChapters(b, c, from: "lxx", to: "kjva")), jsInts(ChapterMap.equivalentChapters(b, c, from: "kjva", to: "lxx")),
                jsInts(ChapterMap.equivalentChapters(b, c, from: "enoch", to: "lxx")),
                optStr(ChapterMap.versificationNote(b, c, textId: "lxx")), optStr(ChapterMap.versificationNote(b, c, textId: "kjva"))]
            if JSValue.array(got) != row { failures += 1; if failures < 5 { print("chapterMap mismatch \(b) \(c): \(JSON.stringify(.array(got)).string) want \(JSON.stringify(row).string)") } }
        }
        #expect(failures == 0)
    }
}
