import Testing
import BereanCore
import BereanSQLite
import BereanStore
import BereanNotes

final class EventStrings: @unchecked Sendable { var items: [String] = [] }

@Suite("highlights golden") struct HighlightsConformanceTests {
    @Test func applyingVerseColorPreservesExistingAndPartialHighlights() throws {
        let db = try SQLiteConnection(readWritePath: ":memory:", create: true)
        try Migrator.migrate(db)
        let events = EventStrings()
        let service = HighlightsService(db: db, onChange: { _, id, operation, _ in
            events.items.append("\(operation):\(id ?? "")")
        })
        try service.toggle(bookId: "JON", chapter: 1, verse: 1, color: "blue", startChar: 0, endChar: 4)
        try service.setVerseColor(bookId: "JON", chapter: 1, verse: 1, color: "yellow")
        let before = try service.chapter("JON", 1)
        try service.setVerseColor(bookId: "JON", chapter: 1, verse: 1, color: "yellow")
        try service.setVerseColor(bookId: "JON", chapter: 1, verse: 2, color: "yellow")
        let after = try service.chapter("JON", 1)
        #expect(after[1] == before[1])
        #expect(after[2]?.map(\.color) == ["yellow"])
        #expect(events.items.count == 3)
        try service.setVerseColor(bookId: "JON", chapter: 1, verse: 1, color: "green")
        let recolored = try service.chapter("JON", 1)[1]
        #expect(recolored?.first(where: { $0.startChar != nil }) == before[1]?.first(where: { $0.startChar != nil }))
        #expect(recolored?.first(where: { $0.startChar == nil })?.color == "green")
    }

    @Test func toggleScript() throws {
        let g = try Golden.load("highlights")
        let db = try SQLiteConnection(readWritePath: ":memory:", create: true)
        try Migrator.migrate(db)
        let clock = FakeClock(); clock.t = 70_000
        let ev = EventStrings()
        let svc = HighlightsService(db: db, now: { clock.t }, onChange: { e, id, op, scope in ev.items.append("\(e)|\(id ?? "-")|\(op)|\(scope ?? "-")") })
        var results: [JSValue] = []
        for p in g.arr("script") {
            let o = p.object
            clock.t += 5
            let r = try svc.toggle(bookId: o["bookId"]!.str, chapter: o["chapter"]!.int, verse: o["verseNum"]!.int, color: o["color"]!.str, textId: o["textId"]?.optionalString ?? "kjva",
                                   startWord: o["startWord"]?.numberValue.map { Int($0) }, endWord: o["endWord"]?.numberValue.map { Int($0) },
                                   startChar: o["startChar"]?.numberValue.map { Int($0) }, endChar: o["endChar"]?.numberValue.map { Int($0) })
            var x = JSObject()
            switch r {
            case .created(let id, let c): x["created"] = .bool(true); x["id"] = js(id); x["color"] = js(c)
            case .updated(let id, let c): x["updated"] = .bool(true); x["id"] = js(id); x["color"] = js(c)
            case .removed(let id): x["removed"] = .bool(true); x["id"] = js(id)
            }
            results.append(.object(x))
        }
        #expect(JSValue.array(results) == g["results"]!)
        func chap(_ m: [Int: [Highlight]]) -> JSValue {
            var o = JSObject()
            for k in m.keys.sorted() {
                o[JSString(String(k))] = .array(m[k]!.map { h in
                    var x = JSObject(); x["id"] = js(h.id); x["color"] = js(h.color)
                    for (n, v) in [("startWord", h.startWord), ("endWord", h.endWord), ("startChar", h.startChar), ("endChar", h.endChar)] { x[JSString(n)] = v.map { .number(Double($0)) } ?? .null }
                    return .object(x)
                })
            }
            return .object(o)
        }
        #expect(chap(try svc.chapter("JHN", 3)) == g["chapter"]!)
        #expect(chap(try svc.chapter("GEN", 1, textId: "lxx")) == g["lxx"]!)
        try svc.remove(bookId: "JHN", chapter: 3, verse: 17)
        #expect(chap(try svc.chapter("JHN", 3)) == g["after"]!)
        #expect(rowsJSON(try db.query("SELECT * FROM highlights ORDER BY id")) == g["rows"]!)
        #expect(ev.items == g.arr("events").map { "\($0["entity"]!.str)|\($0["id"]?.optionalString ?? "-")|\($0["op"]!.str)|\($0["scope"]?.optionalString ?? "-")" })
    }
}
