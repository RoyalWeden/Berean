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

    @Test func exclusionsMatchOriginalTests() {
        let book: (String) -> String? = { $0.range(of: "romans", options: .caseInsensitive) != nil ? "ROM" : $0.range(of: "enoch", options: .caseInsensitive) != nil ? "ENO" : nil }
        #expect(ModelFreeAsk.exclusions("Find passages on obedience to God but not human rulers", resolveBook: book)
                == .init(remainder: "Find passages on obedience to God", terms: ["human", "rulers"], bookIds: []))
        #expect(ModelFreeAsk.exclusions("verses about fire excluding the lake", resolveBook: book).terms == ["lake"])
        #expect(ModelFreeAsk.exclusions("verses on circumcision of the heart, not from Romans", resolveBook: book)
                == .init(remainder: "verses on circumcision of the heart", terms: [], bookIds: ["ROM"]))
        let w = ModelFreeAsk.exclusions("the watchers, but not from Enoch", resolveBook: book)
        #expect(w.remainder == "the watchers" && w.bookIds == ["ENO"])
        for q in ["persecuted, but not forsaken", "except a man be born again", "verses about not worrying about tomorrow", "I was not in Rome", "faith without works"] {
            #expect(ModelFreeAsk.exclusions(q, resolveBook: book) == .init(remainder: q, terms: [], bookIds: []))
        }
        #expect(ModelFreeAsk.mentionsExcluded("the ruler of the feast", terms: ["rulers"]))
        #expect(ModelFreeAsk.mentionsExcluded("rulers are not a terror", terms: ["ruler"]))
        #expect(!ModelFreeAsk.mentionsExcluded("misruled", terms: ["ruled"]))
    }

    @Test func comparisonsAndParallels() {
        #expect(ModelFreeAsk.strongsIds("Compare H2617 and h7356, and H2617 again") == ["H2617", "H7356"])
        #expect(ModelFreeAsk.strongsIds("G0026 vs G5368") == ["G26", "G5368"])
        #expect(ModelFreeAsk.asksTranslationParallel("How does Isaiah 7:14 read in the Septuagint?"))
        #expect(ModelFreeAsk.asksTranslationParallel("compare Genesis 1:1 KJV and LXX"))
        #expect(!ModelFreeAsk.asksTranslationParallel("Isaiah 7:14"))
        #expect(ModelFreeAsk.referenceCandidates("How does Isaiah 7:14 read in the Septuagint?").contains("Isaiah 7:14"))
        #expect(ModelFreeAsk.referenceCandidates("compare 1 John 4:8 KJV and LXX").contains("1 John 4:8"))
    }

    @Test func passageComparisonGroups() {
        let g = ModelFreeAsk.referenceGroups("compare Genesis 1:1 and John 1:1")
        #expect(g.count == 2 && g[0].contains("Genesis 1:1") && g[1].contains("John 1:1"))
        #expect(ModelFreeAsk.asksPassageComparison("compare Genesis 1:1 and John 1:1"))
        #expect(!ModelFreeAsk.asksPassageComparison("Genesis 1:1 and John 1:1"))
        #expect(!ModelFreeAsk.asksPassageComparison("compare H2617 and H7356"))
    }

    @Test func collectionsScope() {
        #expect(ModelFreeAsk.collection(textId: "kjva", bookId: "WIS") == .apocrypha)
        #expect(ModelFreeAsk.collection(textId: "kjva", bookId: "GEN") == .canon)
        #expect(ModelFreeAsk.collection(textId: "enoch", bookId: "ENO") == .pseudepigrapha)
        #expect(ModelFreeAsk.activeCollections("wisdom") == ModelFreeAsk.defaultCollections)
        #expect(ModelFreeAsk.activeCollections("wisdom only in the Apocrypha") == [.apocrypha])
        #expect(ModelFreeAsk.activeCollections("wisdom without the apocrypha") == [.canon, .pseudepigrapha, .earlyChristian])
        #expect(ModelFreeAsk.activeCollections("just the 66 books on wisdom") == [.canon])
        #expect(ModelFreeAsk.withoutScopeWords(["wisdom", "apocrypha", "books"]) == ["wisdom"])
    }
}
