import Testing
@testable import BereanBible

@Suite struct AskFollowUpTests {
    @Test func resolvesFollowUps() {
        let study = AskFollowUp.State(topicQuestion: "word study on grace", term: "grace", lang: "H", strongs: ["H2580", "G5485"])
        #expect(AskFollowUp.resolve("now only Greek", state: study)?.question == "grace in greek")
        #expect(AskFollowUp.resolve("what about the Hebrew?", state: study)?.question == "grace in hebrew")
        #expect(AskFollowUp.resolve("the Greek equivalent", state: study)?.question == "grace in greek")
        #expect(AskFollowUp.resolve("compare the first two", state: study)?.question == "compare H2580 and G5485")
        #expect(AskFollowUp.resolve("compare the second with the first", state: study)?.question == "compare G5485 and H2580")

        let search = AskFollowUp.State(topicQuestion: "Sabbath rest", refs: ["Leviticus 26:35", "Luke 23:56"])
        let more = AskFollowUp.resolve("five more", state: search)
        #expect(more?.question == "Sabbath rest" && more?.limit == 5 && more?.excludeRefs == ["Leviticus 26:35", "Luke 23:56"])
        #expect(AskFollowUp.resolve("show me more", state: search)?.limit == nil)
        #expect(AskFollowUp.resolve("only 2", state: search)?.limit == 2)
        #expect(AskFollowUp.resolve("just the best one", state: search)?.limit == 1)
        #expect(AskFollowUp.resolve("try again", state: search)?.question == "Sabbath rest")

        let passage = AskFollowUp.State(topicQuestion: "Isaiah 7:14", refs: ["Isaiah 7:14"])
        #expect(AskFollowUp.resolve("show that in the LXX", state: passage)?.question == "compare Isaiah 7:14 KJV and LXX")

        // Stand-alone questions are not follow-ups.
        #expect(AskFollowUp.resolve("word study on mercy", state: study) == nil)
        #expect(AskFollowUp.resolve("John 3:16", state: study) == nil)
    }

    @Test func occurrencesInABook() {
        let study = AskFollowUp.State(topicQuestion: "word study on grace", term: "grace", lang: "H", strongs: ["H2580"])
        let r = AskFollowUp.resolve("any in Proverbs?", state: study)
        #expect(r?.occurrencesOf == "H2580" && r?.inBook == "Proverbs")
        #expect(AskFollowUp.resolve("is it in 1 Samuel", state: study)?.inBook == "1 Samuel")
        #expect(AskFollowUp.resolve("what about in the Greek?", state: study)?.inBook == nil)   // a language switch, not a book
        #expect(AskFollowUp.resolve("any in Proverbs?", state: .init())?.occurrencesOf == nil)
    }
}
