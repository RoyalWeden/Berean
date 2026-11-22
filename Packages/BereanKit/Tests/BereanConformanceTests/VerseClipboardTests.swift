import Testing
import BereanBible
import BereanText

@Suite("Verse clipboard") struct VerseClipboardTests {
    @Test func singleVerseIsOneLineWithNoEditionSuffix() {
        let verse = row(1, " In the beginning\nGod created the heaven and the earth. ")
        let text = VerseClipboard(textId: "kjva").passage("Genesis 1:1", rows: [verse])
        #expect(text == "Genesis 1:1 In the beginning God created the heaven and the earth.")
        #expect(VerseClipboard.reference("Genesis 1:1", textId: "kjva") == "Genesis 1:1")
        #expect(VerseClipboard.reference("Genesis 1:1", textId: "lxx") == "Genesis 1:1 LXX")
        #expect(VerseClipboard.reference("Genesis 1:1", textId: "LXX") == "Genesis 1:1 LXX")
        #expect(VerseClipboard.reference("1 Enoch 1:1", textId: "enoch") == "1 Enoch 1:1")
    }

    @Test func multipleVersesKeepNumberedLinesAndGaps() {
        let first = row(1, "In the beginning God created the heaven and the earth.")
        let second = row(2, "And the earth was without form, and void;")
        let third = row(3, "And God said, Let there be light: and there was light.")
        let fifth = row(5, "And God called the light Day,")
        let clipboard = VerseClipboard(textId: "kjva")
        #expect(clipboard.passage("Genesis 1:1–3, 5", rows: [first, second, third, fifth]) == """
        Genesis 1:1-3, 5
        1 In the beginning God created the heaven and the earth.
        2 And the earth was without form, and void;
        3 And God said, Let there be light: and there was light.
        5 And God called the light Day,
        """)
        #expect(clipboard.passage("Genesis 1", rows: [first], wholeChapter: true) == """
        Genesis 1
        1 In the beginning God created the heaven and the earth.
        """)
    }

    @Test func selectedFragmentsUseTheSameLayoutWithoutExpandingTheSelection() {
        let first = VerseClipboard.Line(number: "1", text: "God created ")
        let second = VerseClipboard.Line(number: "2", text: "\n And the earth")
        #expect(VerseClipboard.passage(reference: "Genesis 1:1", verses: [first]) == "Genesis 1:1 God created")
        #expect(VerseClipboard.passage(reference: "Genesis 1:1-2", verses: [first, second]) == """
        Genesis 1:1-2
        1 God created
        2 And the earth
        """)
    }

    @Test func wordReplacementAndTheVisibleAnnotationSettingsApplyBeforeFormatting() {
        let restore = WordReplacerRule(id: "restore", queries: [], replacement: "Yehovah", wholeWord: false,
                                      enabled: true, strongsNum: "H3068")
        let kjva = VerseClipboard(textId: "kjva", replacerEnabled: true, rules: [restore],
                                  hiddenAnnotations: [AnnotationFilters.kjvaSuppliedWords])
        let tagged = row(1, "The LORD is my shepherd.", tagged: "The{} LORD{H3068} *is{} my{} shepherd.{H7462}")
        #expect(kjva.passage("Psalms 23:1", rows: [tagged]) == "Psalms 23:1 Yehovah my shepherd.")

        let lxx = VerseClipboard(textId: "LXX", hiddenAnnotations: ["lxx_supply"])
        let supplied = row(1, "Blessed [is] the man{G435}. ~{G1}")
        #expect(lxx.passage("Psalms 1:1", rows: [supplied]) == "Psalms 1:1 LXX Blessed the man.")
        #expect(VerseClipboard(textId: "lxx").passage("Psalms 1:1", rows: [supplied]) == "Psalms 1:1 LXX Blessed [is] the man.")
    }

    @Test func psalmTitleAndFirstBodyAreOneDisplayedVerseForEitherStoredMatch() {
        let raw = [row(1, "A Psalm of David, when he fled.", book: "PSA", chapter: 3),
                   row(2, "O Lord, why are they?", book: "PSA", chapter: 3),
                   row(3, "Many say concerning my soul.", book: "PSA", chapter: 3)]
        let clipboard = VerseClipboard(textId: "lxx")
        for stored in [1, 2] {
            let first = clipboard.readerRows(raw, bookId: "PSA", chapter: 3, from: stored, through: stored)
            #expect(first.map(\.verseNum) == [2])
            #expect(clipboard.passage("Psalms 3:1", rows: first) == "Psalms 3:1 LXX A Psalm of David, when he fled. O Lord, why are they?")
        }
        let range = clipboard.readerRows(raw, bookId: "PSA", chapter: 3, from: 1, through: 3)
        #expect(clipboard.passage("Psalms 3:1–2", rows: range) == """
        Psalms 3:1-2 LXX
        1 A Psalm of David, when he fled. O Lord, why are they?
        2 Many say concerning my soul.
        """)
    }

    @Test func combinedPsalmReaderLabelAndCopyableTitleSurviveWithoutMissingVerseNotice() {
        let raw = [row(4, "I will take the cup of salvation. I will pay my vows.", book: "PSA", chapter: 115,
                       title: "— v.3 not in LXX —\nA genuine\nheading."),
                   row(6, "Precious in the sight of the Lord.", book: "PSA", chapter: 115)]
        let clipboard = VerseClipboard(textId: "lxx")
        let range = clipboard.readerRows(raw, bookId: "PSA", chapter: 115, from: 4, through: 6)
        #expect(clipboard.passage("Psalms 115:4–6", rows: range) == """
        Psalms 115:4-6 LXX
        4–5 A genuine heading. I will take the cup of salvation. I will pay my vows.
        6 Precious in the sight of the Lord.
        """)
    }

    private func row(_ number: Int, _ text: String, book: String = "GEN", chapter: Int = 1,
                     tagged: String? = nil, title: String? = nil) -> ChapterVerseRow {
        ChapterVerseRow(bookId: book, chapter: chapter, verseNum: number, text: text, textTagged: tagged, title: title)
    }
}
