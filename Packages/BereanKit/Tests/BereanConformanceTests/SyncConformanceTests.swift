import Testing
import BereanCore
@testable import BereanSync

@Suite("sync-hash golden") struct SyncHashConformanceTests {
    @Test func recordAndFieldHashes() throws {
        let g = try Golden.load("sync-hash")
        let cases = g.arr("cases")
        #expect(cases.count > 300)
        for (n, c) in cases.enumerated() {
            let fields = c["fields"]!.object
            #expect(SyncHash.recordHash(fields) == c["recordHash"]!.str, "case \(n)")
            #expect(SyncHash.fieldHashes(fields) == c["fieldHashes"]!.object, "case \(n)")
        }
    }
}

@Suite("hlc golden") struct HLCConformanceTests {
    let g: JSObject
    init() throws { g = try Golden.load("hlc") }

    @Test func zero() { #expect(HLC.zero == g["zero"]!.str) }

    @Test func format() {
        for c in g.arr("formatCases") {
            let h = HLC(wallMs: Int64(c["wallMs"]!.numberValue!), counter: c["counter"]!.int, deviceId: c["deviceId"]!.str)
            #expect(h.formatted == c["formatted"]!.str)
        }
    }

    @Test func parse() {
        for c in g.arr("parse") {
            let input = c["input"]!.str
            let parsed = try? HLC.parse(input)
            if let r = c["result"]!.objectValue {
                #expect(parsed == HLC(wallMs: Int64(r["wallMs"]!.numberValue!), counter: r["counter"]!.int, deviceId: r["deviceId"]!.str), "\(input.debugDescription)")
            } else {
                #expect(parsed == nil, "\(input.debugDescription) should not parse")
            }
        }
    }

    @Test func compare() {
        for c in g.arr("compare") {
            #expect(HLC.compare(c["a"]!.str, c["b"]!.str) == c["result"]!.int, "\(c["a"]!.str) vs \(c["b"]!.str)")
        }
    }

    @Test func clockScripts() throws {
        for (n, s) in g.arr("scripts").enumerated() {
            let box = NowBox()
            var clock = try HybridLogicalClock(deviceId: s["deviceId"]!.str, last: s["last"]?.optionalString, now: { box.value })
            for (i, step) in s["steps"]!.array.enumerated() {
                box.value = Int64(step["now"]!.numberValue!)
                if step["tick"] != nil {
                    #expect(clock.tick() == step["result"]!.str, "script \(n) step \(i)")
                } else {
                    let drift = try clock.receive(step["receive"]!.str)
                    #expect(clock.latest() == step["result"]!.str, "script \(n) step \(i)")
                    #expect(drift.map(Double.init) == step["drift"]?.numberValue, "script \(n) step \(i) drift")
                }
            }
        }
    }
}

final class NowBox: @unchecked Sendable { var value: Int64 = 0 }

@Suite("journal golden") struct JournalConformanceTests {
    let g: JSObject
    init() throws { g = try Golden.load("journal") }

    static func info(_ i: Journal.FileInfo?) -> JSValue {
        guard let i else { return .null }
        var o = JSObject()
        o["name"] = .string(JSString(i.name)); o["seqFrom"] = .number(Double(i.seqFrom)); o["seqTo"] = .number(Double(i.seqTo))
        if let b = i.bytes { o["bytes"] = .number(Double(b)) }
        return .object(o)
    }

    @Test func fileNames() {
        for c in g.arr("fileNames") { #expect(Journal.snapshotFileName(seq: c["seq"]!.int) == c["snapshot"]!.str) }
        for c in g.arr("journalNames") { #expect(Journal.journalFileName(seqFrom: c["seqFrom"]!.int, seqTo: c["seqTo"]!.int) == c["name"]!.str) }
        for c in g.arr("parseNames") { #expect(Self.info(Journal.parseJournalFileName(c["name"]!.str)) == c["result"]!, "\(c["name"]!.str)") }
    }

    @Test func encode() {
        let ops = g.arr("ops").map(\.object)
        #expect(Journal.encode(ops) == g["encoded"]!.jsstr)
    }

    @Test func isValidOp() {
        for (n, c) in g.arr("isValid").enumerated() {
            #expect(Journal.isValidOp(c["value"] ?? .null) == c["valid"]!.boolValue!, "variant \(n)")
        }
    }

    @Test func decode() {
        for (n, c) in g.arr("decode").enumerated() {
            let d = Journal.decode(c["text"]!.jsstr)
            let r = c["result"]!.object
            #expect(d.ops == r.arr("ops").map(\.object), "text \(n)")
            #expect(d.unreadable == r["unreadable"]!.int, "text \(n) unreadable")
            #expect(d.truncated == r["truncated"]!.boolValue!, "text \(n) truncated")
        }
    }

    @Test func chunkForFiles() {
        let chunk = g["chunk"]!.object
        let got = Journal.chunkForFiles(chunk.arr("ops").map(\.object))
        let want = chunk.arr("chunks")
        #expect(got.count == want.count)
        #expect(want.count > 3)
        for (c, w) in zip(got, want) {
            #expect(Self.info(c.info) == w["info"]!)
            #expect(c.content.length == w["length"]!.int)
            #expect(FNV1a32.hex8(FNV1a32.hash(c.content.units)) == w["fnv"]!.str)
        }
    }
}

@Suite("fractional golden") struct FractionalConformanceTests {
    let g: JSObject
    init() throws { g = try Golden.load("fractional") }

    @Test func keyBetween() {
        for c in g.arr("between") + g.arr("walk") {
            let a = c["a"]!.optionalString, b = c["b"]!.optionalString
            let got = try? OrderKey.between(a, b)
            #expect(got == c["result"]!.optionalString, "between(\(a ?? "nil"), \(b ?? "nil"))")
        }
    }

    @Test func keysAfter() throws {
        for c in g.arr("after") {
            #expect(try OrderKey.keysAfter(c["a"]!.optionalString, count: c["n"]!.int) == c["result"]!.array.map(\.str))
        }
    }

    @Test func validity() {
        for c in g.arr("valid") { #expect(OrderKey.isValid(c["key"]!.str) == c["valid"]!.boolValue!, "\(c["key"]!.str.debugDescription)") }
    }

    @Test func compareOrder() {
        for c in g.arr("compare") {
            let a = c["a"]!.object, b = c["b"]!.object
            #expect(OrderKey.compare(orderKey: a["orderKey"]!.str, id: a["id"]!.str, orderKey: b["orderKey"]!.str, id: b["id"]!.str) == c["result"]!.int)
        }
    }
}
