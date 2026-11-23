import Testing
import BereanText

@Suite("Match-centered occurrence excerpts")
struct MatchingWordWindowTests {
    @Test func finalWordKeepsAReadablePhrase() {
        let text = "And Cush begat Nimrod: he began to be mighty upon the earth."
        let result = VerseDisplay.matchingWordWindow(text, matchIndices: [11], leadingCharacters: 56)
        #expect(result?.text == "… he began to be mighty upon the earth.")
        #expect(result?.indices == [8])
    }

    @Test func compactContextStillKeepsLateMatchNearStart() {
        let text = (0..<40).map { "word\($0)" }.joined(separator: " ")
        let result = VerseDisplay.matchingWordWindow(text, matchIndices: [35], leadingCharacters: 56)
        #expect(result?.text.hasPrefix("… word28 ") == true)
        #expect(result?.indices == [8])
        #expect(result?.text.hasSuffix("word39") == true)
    }

    @Test func narrowPaneStartsWithLateMatch() {
        let text = (0..<40).map { "word\($0)" }.joined(separator: " ")
        let result = VerseDisplay.matchingWordWindow(text, matchIndices: [35], leadingCharacters: 0)
        #expect(result?.text.hasPrefix("… word35 ") == true)
        #expect(result?.indices == [1])
        #expect(result?.text.contains("word0 ") == false)
    }

    @Test func shortVersesAlsoKeepTheirMatchVisible() {
        let text = "An unusually elaborate beginning before the highlighted word"
        #expect(text.utf16.count < 160)
        let result = VerseDisplay.matchingWordWindow(text, matchIndices: [7], leadingCharacters: 0)
        #expect(result?.text == "… word")
        #expect(result?.indices == [1])
    }

    @Test func sortAndValidateMatchesBeforeRebasing() {
        let text = (0..<30).map { "word\($0)" }.joined(separator: " ")
        let result = VerseDisplay.matchingWordWindow(text, matchIndices: [12, -1, 5, 200], leadingCharacters: 0)
        #expect(result?.text.hasPrefix("… word5 ") == true)
        #expect(result?.indices == [1, 8])
        #expect(result?.text.hasSuffix(" …") == true)
    }

    @Test func leadingContextIsBoundedByCharacters() {
        let text = "small extraordinarilylongcontextword target following"
        let result = VerseDisplay.matchingWordWindow(text, matchIndices: [2], leadingCharacters: 18)
        #expect(result?.text == "… target following")
        #expect(result?.indices == [1])
    }

    @Test func absentMatchesAndCompleteShortVersesNeedNoWindow() {
        #expect(VerseDisplay.matchingWordWindow("one two", matchIndices: []) == nil)
        #expect(VerseDisplay.matchingWordWindow("one two", matchIndices: [-1, 2]) == nil)
        #expect(VerseDisplay.matchingWordWindow("target following", matchIndices: [0]) == nil)
    }

    @Test func boundsAndWhitespaceDoNotMoveTheMatch() {
        let result = VerseDisplay.matchingWordWindow("before\n\ttarget after", matchIndices: [1],
                                                    leadingCharacters: -1, maximumWords: 1)
        #expect(result?.text == "… target …")
        #expect(result?.indices == [1])
        #expect(VerseDisplay.matchingWordWindow("before target", matchIndices: [1], maximumWords: .max) == nil)
    }
}
