import Testing
import BereanText

@Suite("Match-centered occurrence excerpts")
struct MatchingWordWindowTests {
    @Test(arguments: [14, 20])
    func earlyMatchUsesRemainingSpaceForFollowingWords(budget: Int) {
        let range = VerseDisplay.matchingWordWindow(wordCount: 40, matchIndices: [1], maximumWords: budget)
        #expect(range == 0..<budget)
    }

    @Test(arguments: [14, 20])
    func middleMatchHasContextOnBothSides(budget: Int) {
        let range = VerseDisplay.matchingWordWindow(wordCount: 40, matchIndices: [22, 14, 50, -1], maximumWords: budget)
        #expect(range == 10..<(10 + budget))
        #expect(range.contains(14))
        #expect(range.contains(22))
    }

    @Test(arguments: [14, 20])
    func endMatchUsesRemainingSpaceForPrecedingWords(budget: Int) {
        let range = VerseDisplay.matchingWordWindow(wordCount: 40, matchIndices: [39], maximumWords: budget)
        #expect(range == (40 - budget)..<40)
    }

    @Test func shortVerseKeepsAllContextAroundFinalWord() {
        let words = "And Cush begat Nimrod: he began to be mighty upon the earth.".split(separator: " ")
        let range = VerseDisplay.matchingWordWindow(wordCount: words.count, matchIndices: [11])
        #expect(range == words.indices)
        #expect(words[range].last == "earth.")
    }

    @Test func missingOrInvalidMatchesUseBeginningOfVerse() {
        #expect(VerseDisplay.matchingWordWindow(wordCount: 40, matchIndices: []) == 0..<14)
        #expect(VerseDisplay.matchingWordWindow(wordCount: 40, matchIndices: [-1, 40]) == 0..<14)
    }

    @Test func emptyVerseAndExtremeBudgetsStayInBounds() {
        #expect(VerseDisplay.matchingWordWindow(wordCount: 0, matchIndices: [0]) == 0..<0)
        #expect(VerseDisplay.matchingWordWindow(wordCount: 3, matchIndices: [1], maximumWords: 0) == 1..<2)
        #expect(VerseDisplay.matchingWordWindow(wordCount: 3, matchIndices: [1], maximumWords: .max) == 0..<3)
    }
}
