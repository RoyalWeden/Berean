import Testing
import BereanNotes
import BereanBible
import BereanReference

struct NoteScriptureSelectionTests {
    private func rows(_ chapter: Int, _ verses: [Int], book: String = "JHN") -> [ChapterVerseRow] {
        verses.map { .init(bookId: book, chapter: chapter, verseNum: $0, text: "Verse \($0)", textTagged: nil, title: nil) }
    }
    @Test func selectsCompleteSingleDisjointAndChapterReferences() throws {
        let chapter = rows(3, Array(1...20))
        let single = try #require(Reference.parse("John 3:16"))
        #expect(NoteScriptureSelection.rows(for: single, chapters: [3: chapter], textId: "kjva")?.map(\.verseNum) == [16])
        let disjoint = try #require(Reference.parse("John 3:1,3–4"))
        #expect(NoteScriptureSelection.rows(for: disjoint, chapters: [3: chapter], textId: "kjva")?.map(\.verseNum) == [1,3,4])
        let whole = try #require(Reference.parse("John 3"))
        #expect(NoteScriptureSelection.rows(for: whole, chapters: [3: chapter], textId: "kjva") == chapter)
    }
    @Test func crossChapterRangeUsesOnlyRequestedEndpoints() throws {
        let ref = try #require(Reference.parse("John 3:19–4:2"))
        let selected = NoteScriptureSelection.rows(for: ref, chapters: [3: rows(3, Array(1...20)),4: rows(4, Array(1...10))], textId: "kjva")
        #expect(selected?.map { "\($0.chapter):\($0.verseNum)" } == ["3:19","3:20","4:1","4:2"])
        #expect(NoteScriptureSelection.rows(for: ref, chapters: [3: rows(3, Array(1...20))], textId: "kjva") == nil)
    }
    @Test func missingWrongAndDuplicateRowsDoNotEstablishCoverage() throws {
        let ref = try #require(Reference.parse("John 3:16–18"))
        for chapter in [rows(3,[16,18]), rows(4,[16,17,18]), rows(3,[16,17,18],book:"MAT"),rows(3,[16,16,17,18]), []] {
            #expect(NoteScriptureSelection.rows(for: ref, chapters:[3:chapter],textId:"kjva") == nil)
        }
    }
    @Test func foldsLXXTitleWithoutRenumberingStoredIdentity() throws {
        let ref = try #require(Reference.parse("Psalm 3:1 LXX"))
        let raw = [ChapterVerseRow(bookId:"PSA",chapter:3,verseNum:1,text:"A Psalm of David",textTagged:nil,title:nil),
                   .init(bookId:"PSA",chapter:3,verseNum:2,text:"O Lord, why?",textTagged:nil,title:nil),
                   .init(bookId:"PSA",chapter:3,verseNum:3,text:"Many say",textTagged:nil,title:nil)]
        let row = try #require(NoteScriptureSelection.rows(for:ref,chapters:[3:raw],textId:"lxx")?.first)
        #expect(row.verseNum == 2)
        #expect(row.readerVerseNum == 1)
        #expect(row.title == "A Psalm of David")
        #expect(row.text == "O Lord, why?")
    }
    @Test func combinedPsalmRecordRequiresFullRequestedCoverage() throws {
        let raw = [ChapterVerseRow(bookId:"PSA",chapter:115,verseNum:4,
            text:"I will take the cup of salvation. I will pay my vows.",textTagged:nil,title:nil)]
        for reference in ["Psalm 115:4 LXX","Psalm 115:5 LXX"] {
            let ref = try #require(Reference.parse(reference))
            #expect(NoteScriptureSelection.rows(for:ref,chapters:[115:raw],textId:"lxx") == nil)
        }
        let both = try #require(Reference.parse("Psalm 115:4–5 LXX"))
        #expect(NoteScriptureSelection.rows(for:both,chapters:[115:raw],textId:"lxx")?.first?.readerVerseLabel == "4–5")
    }
    @Test func thresholdClampsInvalidImportedValues() {
        #expect(NoteScriptureSelection.threshold(.nan) == 0.9)
        #expect(NoteScriptureSelection.threshold(.infinity) == 0.9)
        #expect(NoteScriptureSelection.threshold(-1) == 0)
        #expect(NoteScriptureSelection.threshold(2) == 1)
        #expect(NoteScriptureSelection.threshold(0.8) == 0.8)
    }
}
