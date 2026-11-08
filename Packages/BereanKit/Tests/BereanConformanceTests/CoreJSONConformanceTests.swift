import Testing
import BereanCore

@Suite("core-json golden") struct CoreJSONConformanceTests {
    let g: JSObject
    init() throws { g = try Golden.load("core-json") }

    static func double(fromHex h: String) -> Double {
        Double(bitPattern: UInt64(h, radix: 16)!)
    }

    @Test func numberToStringMatchesECMAScript() {
        let cases = g.arr("numbers")
        #expect(cases.count > 400)
        for c in cases {
            let x = Self.double(fromHex: c["bits"]!.str)
            #expect(JSNumber.toString(x) == c["toString"]!.str, "bits \(c["bits"]!.str)")
            #expect(JSON.stringify(.number(x)).string == c["json"]!.str, "bits \(c["bits"]!.str)")
        }
    }

    @Test func stringQuotingMatchesWellFormedStringify() {
        for c in g.arr("strings") {
            let u = c["units"]!.units
            #expect(JSON.stringify(.string(JSString(units: u))).units == c["json"]!.jsstr.units, "units \(u)")
        }
    }

    @Test func parseThenStringifyRoundTrips() throws {
        for c in g.arr("parse") {
            let text = c["text"]!.jsstr
            let v = try JSON.parse(units: text.units)
            #expect(JSON.stringify(v).units == c["json"]!.jsstr.units, "text \(text)")
        }
    }

    @Test func invalidJSONIsRejected() {
        for c in g.arr("invalid") {
            #expect(throws: JSONParseError.self, "text \(c.str.debugDescription)") { try JSON.parse(units: c.jsstr.units) }
        }
    }
}
