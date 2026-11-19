import Foundation
import Testing
import BereanNotes

@Suite("native note inline formatting")
struct NoteInlineFormatTests {
    private let table = "| Topic | Verse |\n| :--- | ---: |\n| Prayer | Romans 8:1 |"

    private func applying(_ source: String, selection: NSRange? = nil, open: String = "**", close: String = "**") throws -> (String, NSRange) {
        let text = source as NSString
        let edit = try #require(NoteInlineFormat.edit(in: text, selection: selection ?? NSRange(location: 0, length: text.length), opening: open, closing: close))
        return (text.replacingCharacters(in: edit.range, with: edit.replacement), edit.selection)
    }

    @Test func wholeTablePreservesGridAndAlignment() throws {
        let (formatted, selection) = try applying(table)
        #expect(formatted == "| **Topic** | **Verse** |\n| :--- | ---: |\n| **Prayer** | **Romans 8:1** |")
        #expect(MarkdownLiveSpans.spans(formatted).filter { $0.kind == .tableHeader }.count == 1)
        #expect(try applying(formatted, selection: selection).0 == table)
    }

    @Test func rowAndCrossCellSelectionKeepDelimitersOutsideMarks() throws {
        let row = (table as NSString).range(of: "| Prayer | Romans 8:1 |")
        #expect(try applying(table, selection: row).0.hasSuffix("| **Prayer** | **Romans 8:1** |"))
        let partial = (table as NSString).range(of: "ayer | Romans")
        #expect(try applying(table, selection: partial, open: "<u>", close: "</u>").0.hasSuffix("| Pr<u>ayer</u> | <u>Romans</u> 8:1 |"))
    }

    @Test func partialEscapedPipeStaysInsideItsCell() throws {
        let source = "| A\\|B | Other |\n| --- | --- |\n| C | D |"
        let pipe = (source as NSString).range(of: "\\|").location + 1
        let formatted = try applying(source, selection: NSRange(location: pipe, length: 1)).0
        #expect(formatted.contains("**\\|**"))
        #expect(MarkdownLiveSpans.spans(formatted).filter { $0.kind == .tableHeader }.count == 1)
        #expect(MarkdownLiveSpans.plainText(formatted) == MarkdownLiveSpans.plainText(source))
    }

    @Test func mixedCellsBecomeUniformAndStaySelectedForToggle() throws {
        let mixed = table.replacingOccurrences(of: "Topic", with: "**Topic**")
            .replacingOccurrences(of: "Verse", with: "**Verse**")
            .replacingOccurrences(of: "Prayer", with: "**Prayer**")
        let (formatted, selection) = try applying(mixed)
        #expect(formatted == "| **Topic** | **Verse** |\n| :--- | ---: |\n| **Prayer** | **Romans 8:1** |")
        #expect(try applying(formatted, selection: selection).0 == table)
    }

    @Test func unicodeEscapesAndCodeCellSurvive() throws {
        let source = "| α😀 | A\\|B |\n| --- | --- |\n| `a\\|b` | שלום |"
        let (formatted, selection) = try applying(source, open: "<u>", close: "</u>")
        #expect(formatted.contains("<u>α😀</u>"))
        #expect(formatted.contains("<u>A\\|B</u>"))
        #expect(MarkdownLiveSpans.plainText(formatted) == MarkdownLiveSpans.plainText(source))
        #expect(MarkdownLiveSpans.spans(formatted).filter { $0.kind == .tableRow }.count == 2)
        #expect(try applying(formatted, selection: selection, open: "<u>", close: "</u>").0 == source)
    }

    @Test func existingLinksAndOtherMarksKeepReadableTextAndDestinations() throws {
        let source = "| *Topic* | [Verse](https://example.com/a) |\n| --- | --- |\n| Prayer and `code` | ==important== |"
        let (formatted, selection) = try applying(source)
        #expect(formatted.contains("*Topic*"))
        #expect(formatted.contains("[Verse](https://example.com/a)"))
        #expect(formatted.contains("**Prayer and** `code`"))
        #expect(MarkdownLiveSpans.plainText(formatted) == MarkdownLiveSpans.plainText(source))
        #expect(try applying(formatted, selection: selection).0 == source)
    }

    @Test func proseAndMultipleTablesRetainSourceOrderAndLineEndings() throws {
        let source = "Before\r\n\r\n" + table.replacingOccurrences(of: "\n", with: "\r\n") + "\r\n\r\nBetween\r\n\r\n" + table + "\nAfter"
        let (formatted, selection) = try applying(source)
        #expect(formatted.hasPrefix("**Before**\r\n\r\n| **Topic**"))
        #expect(formatted.contains("**Between**\r\n"))
        #expect(formatted.hasSuffix("\n**After**"))
        #expect(try applying(formatted, selection: selection).0 == source)
    }

    @Test func separatorAndEmptyCellsDoNotBreakTheTable() {
        let rule = (table as NSString).range(of: "| :--- | ---: |")
        #expect(NoteInlineFormat.edit(in: table as NSString, selection: rule, opening: "**", closing: "**") == nil)
        let blank = "|  |  |\n| --- | --- |\n|  |  |" as NSString
        #expect(NoteInlineFormat.edit(in: blank, selection: NSRange(location: 0, length: blank.length), opening: "**", closing: "**") == nil)
        #expect(NoteInlineFormat.edit(in: table as NSString, selection: NSRange(location: 0, length: 0), opening: "**", closing: "**") == nil)
    }

    @Test func ordinaryTextAndTypingKeepExistingContract() throws {
        let (formatted, selected) = try applying("α😀 text", selection: NSRange(location: 0, length: 3))
        #expect(formatted == "**α😀** text")
        #expect(selected == NSRange(location: 2, length: 3))
        #expect(try applying(formatted, selection: selected).0 == "α😀 text")
        #expect(try applying("ab", selection: NSRange(location: 1, length: 0)).1 == NSRange(location: 3, length: 0))
    }

    @Test func visibleStyledTextCanGainAnotherStyleWithoutLosingTheFirst() throws {
        for base in ["**Prayer**", "<u>Prayer</u>", "==Prayer==", "<mark class=\"hl-blue\">Prayer</mark>"] {
            for wrapped in [base, "| Topic | Verse |\n| --- | --- |\n| \(base) | Romans 8:1 |"] {
                let range = (wrapped as NSString).range(of: "Prayer")
                let (italic, selected) = try applying(wrapped, selection: range, open: "*", close: "*")
                #expect(MarkdownLiveSpans.spans(italic).contains { $0.kind == .italic && $0.range == selected })
                #expect(try applying(italic, selection: selected, open: "*", close: "*").0 == wrapped)
                #expect(MarkdownLiveSpans.plainText(italic) == MarkdownLiveSpans.plainText(wrapped))
            }
        }
    }

    @Test func boldAndItalicToggleIndependentlyAtSharedBoundaries() throws {
        for source in ["***Prayer***", "| ***Prayer*** | Other |\n| --- | --- |\n| a | b |"] {
            let selected = (source as NSString).range(of: "Prayer")
            let italicOnly = try applying(source, selection: selected).0
            #expect(italicOnly == source.replacingOccurrences(of: "***Prayer***", with: "*Prayer*"))
            let boldOnly = try applying(source, selection: selected, open: "*", close: "*").0
            #expect(boldOnly == source.replacingOccurrences(of: "***Prayer***", with: "**Prayer**"))
        }
    }

    @Test func partialNewStyleRetainsItsEnclosingStyleAndUnicodeSelection() throws {
        let source = "**α😀 Prayer last**"
        let range = (source as NSString).range(of: "α😀 Prayer")
        let (underlined, selection) = try applying(source, selection: range, open: "<u>", close: "</u>")
        #expect(underlined == "**<u>α😀 Prayer</u> last**")
        #expect((underlined as NSString).substring(with: selection) == "α😀 Prayer")
        #expect(try applying(underlined, selection: selection, open: "<u>", close: "</u>").0 == source)
        #expect(NoteInlineFormat.edit(in: source as NSString, selection: (source as NSString).range(of: "Prayer"), opening: "**", closing: "**") == nil)
    }

    @Test func combinedStyleEditsLeaveCodeAndLinkDestinationsIntact() throws {
        let source = "**[Prayer](https://example.com/Prayer)** and **`Prayer`**"
        let range = (source as NSString).range(of: "Prayer")
        let (italic, selection) = try applying(source, selection: range, open: "*", close: "*")
        #expect(italic.contains("https://example.com/Prayer"))
        #expect(try applying(italic, selection: selection, open: "*", close: "*").0 == source)
        let code = (source as NSString).range(of: "Prayer", options: .backwards)
        #expect(NoteInlineFormat.edit(in: source as NSString, selection: code, opening: "*", closing: "*") == nil)
    }

    @Test func invalidRangesAndBlockWrappersAreRejected() {
        for range in [NSRange(location: -1, length: 0), NSRange(location: 0, length: -1), NSRange(location: NSNotFound, length: 0), NSRange(location: 0, length: Int.max)] {
            #expect(NoteInlineFormat.edit(in: table as NSString, selection: range, opening: "**", closing: "**") == nil)
        }
        #expect(NoteInlineFormat.edit(in: table as NSString, selection: NSRange(location: 0, length: 10), opening: "\n> ", closing: "") == nil)
    }
}
