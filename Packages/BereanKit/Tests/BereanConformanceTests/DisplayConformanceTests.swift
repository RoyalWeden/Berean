import Testing
import BereanCore
import BereanSync
import BereanSQLite
import BereanText

extension WordReplacerRule {
    init(json o: JSObject) {
        self.init(id: o["id"]!.str, queries: o["queries"]!.array.map(\.str), replacement: o["replacement"]!.str,
                  wholeWord: o["wholeWord"]!.boolValue!, enabled: o["enabled"]!.boolValue!, strongsNum: o["strongsNum"]?.optionalString)
    }
}
func strongsArg(_ v: JSValue?) -> TaggedToken.Strongs? {
    if let s = v?.stringValue { return .one(s.string) }
    if let a = v?.arrayValue { return .many(a.map(\.str)) }
    return nil
}
func js(_ s: String) -> JSValue { .string(JSString(s)) }
func jsInts(_ a: [Int]) -> JSValue { .array(a.map { .number(Double($0)) }) }

@Suite("display golden", .enabled(if: bibleDataPresent, "data/*.db not present")) struct DisplayConformanceTests {
    let g: JSObject
    let rules: [WordReplacerRule]
    let custom: [WordReplacerRule]
    init() throws {
        g = try Golden.load("display")
        rules = g.arr("defaultRules").map { WordReplacerRule(json: $0.object) }
        custom = g.arr("customRules").map { WordReplacerRule(json: $0.object) }
    }

    @Test func generatedDefaultsMatchTheStore() { #expect(WordReplacer.defaultRules == rules) }

    @Test func everyVerse() throws {
        var failures: [String] = []
        for (textId, want) in g["texts"]!.object.entries {
            let t = textId.string
            let db = try SQLiteConnection(readOnlyPath: dataFile(t)!)
            let tagged = db.hasColumn("verses", "text_tagged")
            let whereClause = t == "kjva" ? "" : " WHERE id % 7 = 0"
            let rows = try db.query("SELECT book_id, text\(tagged ? ", text_tagged" : "") FROM verses\(whereClause) ORDER BY id")
            var order: [String] = [], groups: [String: [JSValue]] = [:]
            for r in rows {
                let book = r.values[0].string!, text = r.values[1].string ?? "", tt = tagged ? r.values[2].string : nil
                func dt(_ a: [DisplayToken]) -> JSValue { .array(a.map { var o = JSObject(); o["word"] = js($0.word); o["isRedLetter"] = .bool($0.isRedLetter); o["isItalic"] = .bool($0.isItalic); return .object(o) }) }
                let study = JSValue.array(VerseDisplay.studyTokens(text, tagged: tt, textId: t, replacerEnabled: true, rules: rules).map {
                    var o = JSObject(); o["word"] = js($0.word); o["strongs"] = .array($0.strongs.map(js)); o["isRedLetter"] = .bool($0.isRedLetter); o["isItalic"] = .bool($0.isItalic); return .object(o)
                })
                let row: JSValue = .array([
                    js(VerseDisplay.text(text, tagged: tt, textId: t, replacerEnabled: true, rules: rules)),
                    js(VerseDisplay.text(text, tagged: tt, textId: t, replacerEnabled: false, rules: rules)),
                    js(VerseDisplay.text(text, tagged: tt, textId: t, replacerEnabled: true, rules: custom)),
                    dt(VerseDisplay.tokens(text, tagged: tt, textId: t, replacerEnabled: true, rules: rules)),
                    dt(VerseDisplay.tokens(text, tagged: tt, textId: t, replacerEnabled: false, rules: rules)),
                    study,
                    jsInts(VerseDisplay.matchWordIndices(tagged: tt, plainText: text, strongsNum: "H3068", fallbackWords: ["lord", "jehovah"])),
                    jsInts(VerseDisplay.matchWordIndices(tagged: tt, plainText: text, strongsNum: "g5485", fallbackWords: [])),
                ])
                if groups[book] == nil { order.append(book); groups[book] = [] }
                groups[book]!.append(row)
            }
            let w = want.object
            for b in order where JSValue.object(digest(groups[b]!)) != w[JSString(b)] { failures.append("\(t) \(b)") }
        }
        #expect(failures.isEmpty, Comment(rawValue: "\(failures.count) mismatches: " + failures.prefix(40).joined(separator: ", ")))
    }

    @Test func handWrittenCases() {
        for c in g.arr("replacer") {
            #expect(WordReplacer.apply(c["text"]!.str, rules: rules) == c["defaults"]!.str, "\(c["text"]!.str)")
            #expect(WordReplacer.apply(c["text"]!.str, rules: custom) == c["custom"]!.str, "custom \(c["text"]!.str)")
        }
        for c in g.arr("strongs") {
            #expect(WordReplacer.applyStrongs(c["word"]!.str, strongs: strongsArg(c["num"]), rules: rules) == c["result"]!.str, "\(c["word"]!.str)")
        }
        for c in g.arr("variants") {
            #expect(WordReplacer.searchVariants(c["query"]!.str, rules: rules) == c["defaults"]!.array.map(\.str), "\(c["query"]!.str)")
            #expect(WordReplacer.searchVariants(c["query"]!.str, rules: custom) == c["custom"]!.array.map(\.str), "custom \(c["query"]!.str)")
        }
        for c in g.arr("strongsSearch") {
            let got: JSValue = WordReplacer.strongsSearch(c["query"]!.str, rules: rules).map { r in
                var o = JSObject(); o["strongsNums"] = .array(r.strongsNums.map(js)); o["residualWords"] = .array(r.residualWords.map(js))
                if let rp = r.replacement { o["replacement"] = js(rp) }
                return .object(o)
            } ?? .null
            #expect(got == c["result"]!, "\(c["query"]!.str)")
        }
        for c in g.arr("glosses") { #expect(VerseDisplay.glossWords(c["def"]!.str) == c["words"]!.array.map(\.str), "\(c["def"]!.str)") }
        for c in g.arr("windows") {
            let w = VerseDisplay.wordWindow(c["text"]!.str, matchIndices: c["indices"]!.array.map(\.int))
            let got: JSValue = w.map { var o = JSObject(); o["windowText"] = js($0.text); o["windowMatchIndices"] = jsInts($0.indices); return .object(o) } ?? .null
            #expect(got == c["result"]!, "\(c["indices"]!.array.map(\.int))")
        }
    }
}
