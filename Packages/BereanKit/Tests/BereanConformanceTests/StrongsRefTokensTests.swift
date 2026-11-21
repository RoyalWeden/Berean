import Testing
import BereanBible

@Suite("Strong's reference tokens") struct StrongsRefTokensTests {
    @Test func prefixedAndBareNumbersLink() {
        #expect(StrongsRefTokens.tokens("from H07941 and 2165", lang: "H") ==
                [.text("from "), .ref("H7941"), .text(" and "), .ref("H2165")])
        #expect(StrongsRefTokens.tokens("See 7495.", lang: "H") == [.text("See "), .ref("H7495"), .text(".")])
        #expect(StrongsRefTokens.tokens("Compare 3050, 3069.", lang: "G") ==
                [.text("Compare "), .ref("G3050"), .text(", "), .ref("G3069"), .text(".")])
    }

    @Test func chapterVerseStaysPlain() {
        #expect(StrongsRefTokens.tokens("(Deuteronomy 32:38)", lang: "H") == [.text("(Deuteronomy 32:38)")])
    }
}
