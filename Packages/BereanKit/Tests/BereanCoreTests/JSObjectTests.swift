import Testing
import BereanCore

@Suite struct JSObjectTests {
    @Test func arrayIndexKeysComeFirstInNumericOrder() {
        var o = JSObject()
        for k in ["b", "10", "a", "2", "01", "4294967295", "4294967294", "0"] { o[k] = .null }
        #expect(o.keys.map(\.string) == ["0", "2", "10", "4294967294", "b", "a", "01", "4294967295"])
    }

    @Test func reassignmentKeepsPositionAndRemovalWorks() {
        var o = JSObject()
        o["x"] = 1; o["y"] = 2; o["x"] = 3
        #expect(o.keys.map(\.string) == ["x", "y"])
        #expect(o["x"] == 3)
        o["1"] = 0; o.remove("1"); o["0"] = 0
        #expect(o.keys.map(\.string) == ["0", "x", "y"])
    }

    @Test func negativeZeroStringifiesAsZero() {
        #expect(JSON.stringify(.number(-0.0)).string == "0")
        #expect(JSON.stringify(.number(.nan)).string == "null")
    }

    @Test func jsStringOrderIsUTF16NotScalar() {
        // U+FFFF sorts after U+1F600 by scalar value but before it by UTF-16 code unit (0xD83D).
        #expect(JSString("\u{1F600}") < JSString("\u{FFFF}"))
        #expect(jsCompare("\u{1F600}", "\u{FFFF}") == -1)
    }
}
