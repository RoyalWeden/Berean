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

    @Test func brentonWholeVerseTitleFolds() {
        let rows = [row(1, "A Psalm of David, when he fled from the presence of his son Abessalom."), row(2, "O Lord, why are they")]
        let out = PsalmSuperscription.apply(rows, textId: "lxx", bookId: "PSA", chapter: 3)
        #expect(out.count == 1)
        #expect(out[0].verseNum == 2)
        #expect(out[0].title == "A Psalm of David, when he fled from the presence of his son Abessalom.")
    }

    @Test func brentonInlinePrefixTrims() {
        let rows = [row(1, "A Psalm for David on the first day of the week. The earth is the Lord's",
                        tagged: "A{} Psalm{G5568} for{G3588} David{G1138} on{G1520} the{G3588} first{} day{} of{} the{} week.{G4521} The{G3588} earth{G1093} is{} the{} Lord's{G2962}")]
        let out = PsalmSuperscription.apply(rows, textId: "lxx", bookId: "PSA", chapter: 23)
        #expect(out[0].text == "The earth is the Lord's")
        #expect(out[0].textTagged == "The{G3588} earth{G1093} is{} the{} Lord's{G2962}")
        #expect(out[0].title == "A Psalm for David on the first day of the week.")
    }

    @Test func untitledAndOtherBooksUnchanged() {
        let rows = [row(1, "Blessed is the man")]
        #expect(PsalmSuperscription.apply(rows, textId: "kjva", bookId: "PSA", chapter: 1) == rows)
        #expect(PsalmSuperscription.apply(rows, textId: "kjva", bookId: "GEN", chapter: 3) == rows)
    }
}
