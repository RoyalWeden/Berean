import Testing
@testable import BereanBible

@Suite struct ModelFreeAskTests {
    @Test func keywordsFollowOriginalRules() {
        #expect(ModelFreeAsk.keywords("What does the Bible say about the Sabbath day?") == ["sabbath", "day"])
        #expect(ModelFreeAsk.keywords("Show verses where Yehovah keeps covenant, covenant!") == ["yehovah", "keeps", "covenant"])
        #expect(ModelFreeAsk.keywords("a an of to") == [])
        #expect(ModelFreeAsk.keywords("one two three four five six seven eight").count == 6)
        #expect(ModelFreeAsk.stems(["jubilee", "shew", "sabbaths"]) == ["jubil", "shew", "sabbat"])
    }

    @Test func detectsWordStudies() {
        #expect(ModelFreeAsk.wordStudy("word study on grace")! == ("grace", nil))
        #expect(ModelFreeAsk.wordStudy("What is the meaning of shalom in Hebrew?")! == ("shalom", "H"))
        #expect(ModelFreeAsk.wordStudy("grace in Greek")! == ("grace", "G"))
        #expect(ModelFreeAsk.wordStudy("Greek word for love")! == ("love", "G"))
        #expect(ModelFreeAsk.wordStudy("strong's for righteousness")! == ("righteousness", nil))
        #expect(ModelFreeAsk.wordStudy("What does the Bible say about grace") == nil)
    }

    @Test func picksMostFrequentWholeWordGloss() {
        func e(_ id: String, _ gloss: String, _ n: Int) -> LexiconEntry {
            LexiconEntry(strongsNum: id, lemma: "", transliteration: "", pronunciation: "", gloss: gloss, definition: "", derivation: "", extendedDef: "", occurrences: n)
        }
        let entries = [e("G2143", "grace", 1), e("G5485", "grace, favour", 156), e("G5483", "gracious, forgive", 23), e("G9999", "disgraceful", 400)]
        #expect(ModelFreeAsk.best(entries, for: "grace")?.strongsNum == "G5485")
        #expect(ModelFreeAsk.best([e("H1", "kindness", 3)], for: "grace")?.strongsNum == "H1")   // no whole-word gloss: best of all
        #expect(ModelFreeAsk.best([], for: "grace") == nil)
    }
}
