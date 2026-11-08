import Testing
import BereanCore
import BereanSync
import BereanSQLite
import BereanText

@Suite("text golden", .enabled(if: bibleDataPresent, "data/*.db not present")) struct TextConformanceTests {
    let g: JSObject
    init() throws { g = try Golden.load("text") }

    static func verses(_ textId: String) throws -> [(book: String, text: String, tagged: String?)] {
        let db = try SQLiteConnection(readOnlyPath: dataFile(textId)!)
        let tagged = db.hasColumn("verses", "text_tagged")
        return try db.query("SELECT book_id, text\(tagged ? ", text_tagged" : "") FROM verses ORDER BY id").map {
            ($0.values[0].string!, $0.values[1].string ?? "", tagged ? $0.values[2].string : nil)
        }
    }
    static func probes(_ len: Int) -> [Int] {
        let step = len > 120 ? 7 : 1
        var out = [-3]
        var i = 0
        while i <= len { out.append(i); i += step }
        out += [len, len + 5]
        return out
    }
    static func byBook(_ vs: [(book: String, text: String, tagged: String?)], _ f: ((book: String, text: String, tagged: String?)) -> JSValue) -> JSObject {
        var order: [String] = [], groups: [String: [JSValue]] = [:]
        for v in vs { if groups[v.book] == nil { order.append(v.book); groups[v.book] = [] }; groups[v.book]!.append(f(v)) }
        var o = JSObject()
        for b in order { o[JSString(b)] = .object(digest(groups[b]!)) }
        return o
    }
    static func ints(_ a: [Int]) -> JSValue { .array(a.map { .number(Double($0)) }) }

    func check(_ label: String, _ got: JSObject, _ want: JSValue?, _ failures: inout [String]) {
        guard let want = want?.objectValue else { failures.append("\(label): missing in golden"); return }
        for (k, v) in want.entries where got[k] != v { failures.append("\(label) \(k)") }
        if got.count != want.count { failures.append("\(label): book count \(got.count) vs \(want.count)") }
    }

    @Test func tokensRangesAndOffsetsForEveryVerse() throws {
        var failures: [String] = []
        let texts = g["texts"]!.object
        for t in ["kjva", "lxx"] {
            let vs = try Self.verses(t)
            let want = texts[JSString(t)]!.object
            check("\(t) tokens", Self.byBook(vs) { .array(TaggedText.parse($0.tagged ?? "").map(\.json)) }, want["tokens"], &failures)
            check("\(t) ranges", Self.byBook(vs) { .array(TaggedText.annotationRanges($0.tagged, textId: t, plainText: $0.text).map(\.json)) }, want["ranges"], &failures)
            check("\(t) ranges positional", Self.byBook(vs) { .array(TaggedText.annotationRanges($0.tagged, textId: t).map(\.json)) }, want["rangesPositional"], &failures)
            check("\(t) offsets", Self.byBook(vs) { v in
                let display = TaggedText.parse(v.tagged ?? "").filter { !$0.hasNoPlainText }.map(\.word).joined(separator: " ")
                if display.isEmpty { return .null }
                return .array([
                    Self.ints(OffsetMap.displayToOriginal(display: display, original: v.text, offsets: Self.probes(display.utf16.count))),
                    Self.ints(OffsetMap.originalToDisplay(display: display, original: v.text, offsets: Self.probes(v.text.utf16.count))),
                ])
            }, want["offsets"], &failures)
        }
        for t in ["lxx", "enoch", "jubilees"] {
            let vs = try Self.verses(t)
            let want = texts[JSString("strip:\(t)")]!.object
            for (setKey, _) in want.entries {
                let set = setKey.string.split(separator: "+").map(String.init)
                check("strip \(t) \(setKey)", Self.byBook(vs) { v in
                    let display = Annotations.strip(v.text, textId: t, hidden: set)
                    if display == v.text { return .number(0) }
                    return .array([.string(JSString(display)),
                                   Self.ints(OffsetMap.displayToOriginal(display: display, original: v.text, offsets: Self.probes(display.utf16.count))),
                                   Self.ints(OffsetMap.originalToDisplay(display: display, original: v.text, offsets: Self.probes(v.text.utf16.count)))])
                }, want[setKey], &failures)
            }
        }
        #expect(failures.isEmpty, Comment(rawValue: "\(failures.count) mismatches:\n" + failures.prefix(40).joined(separator: "\n")))
    }

    @Test func handWrittenCases() {
        for c in g.arr("tokenCases") {
            let tagged = c["tagged"]!.str
            #expect(JSValue.array(TaggedText.parse(tagged).map(\.json)) == c["tokens"]!, "\(tagged.debugDescription)")
        }
        for c in g.arr("offsets") {
            let d = c["display"]!.str, o = c["original"]!.str
            #expect(Self.ints(Self.probes(d.utf16.count).map { OffsetMap.displayToOriginal(display: d, original: o, offset: $0) }) == c["toOriginal"]!, "\(d) → \(o)")
            #expect(Self.ints(Self.probes(o.utf16.count).map { OffsetMap.originalToDisplay(display: d, original: o, offset: $0) }) == c["toDisplay"]!, "\(o) → \(d)")
        }
        for c in g.arr("stripCases") {
            let got = Annotations.strip(c["text"]!.str, textId: c["textId"]!.str, hidden: c["hidden"]!.array.map(\.str))
            #expect(got == c["result"]!.str, "\(c["textId"]!.str) \(c["hidden"]!.array.map(\.str)) \(c["text"]!.str.debugDescription)")
        }
    }
}
