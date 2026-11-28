import Foundation
import Testing
import BereanNotes

@Suite("native paragraph styles preserve table structure")
struct NoteParagraphStyleTests {
    private let source = "Before\n\n| Topic | Verse |\n| :--- | ---: |\n| Prayer | Romans 8:1 |\n\nAfter"

    @Test func everyTablePartRejectsParagraphPrefixes() {
        let text = source as NSString
        for word in ["Topic", ":---", "Prayer", "Romans 8:1"] {
            let range = text.range(of: word)
            #expect(!NoteInlineFormat.allowsParagraphStyle(in: text, selection: range))
            #expect(!NoteInlineFormat.allowsParagraphStyle(in: text, selection: NSRange(location: range.location, length: 0)))
        }
    }

    @Test func wholeAndMixedSelectionsCannotDestroyTheGrid() {
        let text = source as NSString
        #expect(!NoteInlineFormat.allowsParagraphStyle(in: text, selection: NSRange(location: 0, length: text.length)))
        let end = NSMaxRange(text.range(of: "Topic"))
        #expect(!NoteInlineFormat.allowsParagraphStyle(in: text, selection: NSRange(location: 0, length: end)))
    }

    @Test func proseAndSelectionEndingBeforeTableRemainEditable() {
        let text = source as NSString
        #expect(NoteInlineFormat.allowsParagraphStyle(in: text, selection: text.range(of: "Before")))
        #expect(NoteInlineFormat.allowsParagraphStyle(in: text, selection: text.range(of: "After")))
        let tableStart = text.range(of: "| Topic").location
        #expect(NoteInlineFormat.allowsParagraphStyle(in: text, selection: NSRange(location: 0, length: tableStart)))
        #expect(NoteInlineFormat.allowsParagraphStyle(in: text, selection: NSRange(location: text.length, length: 0)))
    }

    @Test func literalPipesAndFencedExamplesAreNotTables() {
        for value in ["Love | hope", "| A | B |\nThis is prose", "```\n| A | B |\n| --- | --- |\n| C | D |\n```"] {
            let text = value as NSString
            #expect(NoteInlineFormat.allowsParagraphStyle(in: text, selection: NSRange(location: 0, length: text.length)))
        }
    }

    @Test func utf16AndInvalidRanges() {
        let text = ("🙂\n" + source) as NSString
        #expect(!NoteInlineFormat.allowsParagraphStyle(in: text, selection: text.range(of: "Prayer")))
        for range in [NSRange(location: -1, length: 0), NSRange(location: 0, length: -1),
                      NSRange(location: NSNotFound, length: 0), NSRange(location: text.length, length: 1)] {
            #expect(!NoteInlineFormat.allowsParagraphStyle(in: text, selection: range))
        }
    }

    @Test func endOfTableAndWindowsLineEndings() {
        let table = "| A | B |\n| --- | --- |\n| C | D |" as NSString
        #expect(!NoteInlineFormat.allowsParagraphStyle(in: table, selection: NSRange(location: table.length, length: 0)))
        let windows = source.replacingOccurrences(of: "\n", with: "\r\n") as NSString
        #expect(!NoteInlineFormat.allowsParagraphStyle(in: windows, selection: windows.range(of: "Prayer")))
        #expect(NoteInlineFormat.allowsParagraphStyle(in: windows, selection: windows.range(of: "After")))
    }

    @Test func headerOnlyTablesStillNeedProtection() {
        let table = "| A | B |\n| --- | --- |" as NSString
        #expect(!NoteInlineFormat.allowsParagraphStyle(in: table, selection: table.range(of: "A")))
        #expect(!NoteInlineFormat.allowsParagraphStyle(in: table, selection: NSRange(location: 0, length: table.length)))
    }
}
