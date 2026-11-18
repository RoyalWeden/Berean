import Testing
import BereanBible

@Suite("Psalm superscriptions") struct PsalmSuperscriptionTests {
    func row(_ v: Int, _ text: String, tagged: String? = nil) -> ChapterVerseRow {
        ChapterVerseRow(bookId: "PSA", chapter: 3, verseNum: v, text: text, textTagged: tagged, title: nil)
    }

    @Test func kjvaTitleMovesOutOfTaggedVerseOne() {
        let rows = [row(1, "LORD, how are they increased",
                        tagged: "A{} Psalm{H4210} of{} David,{H1732} when{} he{} fled{H1272} from{H6440} Absalom{H53} his{} son.{H1121} LORD,{H3068} how{H4100}"),
                    row(2, "Many there be")]
        let out = PsalmSuperscription.apply(rows, textId: "kjva", bookId: "PSA", chapter: 3)
        #expect(out[0].title == "A Psalm of David, when he fled from Absalom his son.")
        #expect(out[0].textTagged == "LORD,{H3068} how{H4100}")
        #expect(out.count == 2)
    }

    @Test func brentonTitleBelongsToFirstBodyVerse() {
        let rows = [row(1, "A Psalm of David, when he fled from the presence of his son Abessalom."),
                    row(2, "O Lord, why are they"), row(3, "Many say concerning my soul")]
        let out = PsalmSuperscription.apply(rows, textId: "lxx", bookId: "PSA", chapter: 3)
        #expect(out.map(\.verseNum) == [2, 3], "Saved annotation identities stay unchanged")
        #expect(out.map(\.readerVerseNum) == [1, 2])
        #expect(out.map(\.text) == Array(rows.dropFirst()).map(\.text))
        #expect(out[0].title == rows[0].text)
        #expect(rows[0].displayVerseNum == nil, "Preparing the reader must not modify raw rows")
        #expect(PsalmSuperscription.apply(out, textId: "lxx", bookId: "PSA", chapter: 3) == out)
    }

    @Test func brentonInlinePrefixTrims() {
        let rows = [row(1, "A Psalm for David on the first day of the week. The earth is the Lord's",
                        tagged: "A{} Psalm{G5568} for{G3588} David{G1138} on{G1520} the{G3588} first{} day{} of{} the{} week.{G4521} The{G3588} earth{G1093} is{} the{} Lord's{G2962}")]
        let out = PsalmSuperscription.apply(rows, textId: "lxx", bookId: "PSA", chapter: 23)
        #expect(out[0].text == "The earth is the Lord's")
        #expect(out[0].textTagged == "The{G3588} earth{G1093} is{} the{} Lord's{G2962}")
        #expect(out[0].title == "A Psalm for David on the first day of the week.")
    }

    @Test func twoTitleRowsBelongToOneFirstVerse() {
        let rows = (1...4).map { verse in
            ChapterVerseRow(bookId: "PSA", chapter: 50, verseNum: verse,
                            text: "Original line \(verse)", textTagged: "Original{} line{} \(verse){}", title: nil)
        }
        let out = PsalmSuperscription.apply(rows, textId: "lxx", bookId: "PSA", chapter: 50)
        #expect(out.map(\.verseNum) == [3, 4])
        #expect(out.map(\.readerVerseNum) == [1, 2])
        #expect(out[0].title == "Original line 1\nOriginal line 2")
        #expect(out.map(\.textTagged) == Array(rows.dropFirst(2)).map(\.textTagged))
        #expect(PsalmSuperscription.apply(out, textId: "lxx", bookId: "PSA", chapter: 50) == out)
    }

    @Test func incompleteTitleQueryIsNeverDiscarded() {
        let rows = [row(1, "A title without a body")]
        #expect(PsalmSuperscription.apply(rows, textId: "lxx", bookId: "PSA", chapter: 3) == rows)
    }

    @Test func readerAndStoredReferencesRoundTripAcrossThePsalter() {
        for chapter in 1...151 {
            for readerVerse in 1...30 {
                let stored = PsalmSuperscription.storedVerseNum(readerVerse, bookId: "PSA", chapter: chapter, textId: "lxx")
                #expect(PsalmSuperscription.readerVerseNum(stored, bookId: "PSA", chapter: chapter, textId: "lxx") == readerVerse)
            }
        }
        #expect(PsalmSuperscription.storedVerseNum(1, bookId: "PSA", chapter: 3, textId: "lxx") == 2)
        #expect(PsalmSuperscription.storedVerseNum(1, bookId: "PSA", chapter: 50, textId: "lxx") == 3)
        #expect(PsalmSuperscription.storedVerseNum(1, bookId: "PSA", chapter: 1, textId: "lxx") == 1)
        #expect(PsalmSuperscription.storedVerseNum(1, bookId: "GEN", chapter: 3, textId: "lxx") == 1)
        #expect(PsalmSuperscription.storedVerseNum(1, bookId: "PSA", chapter: 3, textId: "kjva") == 1)
    }

    @Test func compareAndFlipUseBodyCorrespondences() {
        let psalm3 = PsalmSuperscription.verseCounterpart("PSA", chapter: 3, verse: 1, from: "kjva", to: "lxx")
        #expect(psalm3?.chapter == 3 && psalm3?.verse == 2)
        let psalm51 = PsalmSuperscription.verseCounterpart("PSA", chapter: 51, verse: 1, from: "kjva", to: "lxx")
        #expect(psalm51?.chapter == 50 && psalm51?.verse == 3)
        let reverse = PsalmSuperscription.verseCounterpart("PSA", chapter: 50, verse: 3, from: "lxx", to: "kjva")
        #expect(reverse?.chapter == 51 && reverse?.verse == 1)
        let combined = PsalmSuperscription.verseCounterpart("PSA", chapter: 9, verse: 22, from: "lxx", to: "kjva")
        #expect(combined?.chapter == 10 && combined?.verse == 1)
        #expect(PsalmSuperscription.synchronizedVerse("PSA", chapter: 3, verse: 2, from: "lxx", destinationChapter: 3, to: "kjva") == 1)
    }

    @Test func untitledAndOtherBooksUnchanged() {
        let rows = [row(1, "Blessed is the man")]
        #expect(PsalmSuperscription.apply(rows, textId: "kjva", bookId: "PSA", chapter: 1) == rows)
        #expect(PsalmSuperscription.apply(rows, textId: "kjva", bookId: "GEN", chapter: 3) == rows)
    }
}
