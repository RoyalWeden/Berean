import Foundation
import Testing
import BereanNotes

@Suite("native note highlight edits")
struct NoteHighlightFormatTests {
    private let table = "| Topic | Verse |\n| :--- | ---: |\n| Prayer | Romans 8:1 |"

    private func applying(_ source: String, selection: NSRange? = nil, action: NoteInlineFormat.HighlightAction) throws -> (String, NSRange) {
        let text = source as NSString
        let edit = try #require(NoteInlineFormat.highlightEdit(in: text, selection: selection ?? NSRange(location: 0, length: text.length), action: action))
        return (text.replacingCharacters(in: edit.range, with: edit.replacement), edit.selection)
    }

    @Test func coloredTableKeepsGridAndCanRemoveAllAtOnce() throws {
        let (colored, selected) = try applying(table, action: .color("blue"))
        #expect(colored == "| <mark class=\"hl-blue\">Topic</mark> | <mark class=\"hl-blue\">Verse</mark> |\n| :--- | ---: |\n| <mark class=\"hl-blue\">Prayer</mark> | <mark class=\"hl-blue\">Romans 8:1</mark> |")
        #expect(MarkdownLiveSpans.spans(colored).filter { $0.kind == .tableHeader }.count == 1)
        #expect(try applying(colored, selection: selected, action: .remove).0 == table)
        #expect(NoteInlineFormat.highlightEdit(in: colored as NSString, selection: selected, action: .color("blue")) == nil)
    }

    @Test func yellowTableTogglesAndMixedColorsConvertWithoutNesting() throws {
        let (yellow, selected) = try applying(table, action: .toggle)
        #expect(yellow.contains("| ==Topic== | ==Verse== |"))
        #expect(try applying(yellow, selection: selected, action: .toggle).0 == table)
        let mixed = "| ==Topic== | <mark class=\"hl-pink\">Verse</mark> |\n| :--- | ---: |\n| Prayer | Romans 8:1 |"
        let blue = try applying(mixed, action: .color("blue")).0
        #expect(blue.components(separatedBy: "<mark").count == 5)
        #expect(!blue.contains("hl-pink"))
        #expect(!blue.contains("=="))
        #expect(MarkdownLiveSpans.plainText(blue) == MarkdownLiveSpans.plainText(table))
    }

    @Test func partialRecolorPreservesOutsideTextAndSelection() throws {
        let source = "<mark class=\"hl-pink\">Alpha Bravo Charlie</mark>"
        let (colored, selected) = try applying(source, selection: (source as NSString).range(of: "Bravo"), action: .color("blue"))
        #expect(colored == "<mark class=\"hl-pink\">Alpha</mark> <mark class=\"hl-blue\">Bravo</mark> <mark class=\"hl-pink\">Charlie</mark>")
        #expect((colored as NSString).substring(with: selected) == "Bravo")
        #expect(MarkdownLiveSpans.plainText(colored) == "Alpha Bravo Charlie")
        let (cleared, caretSelection) = try applying(colored, selection: selected, action: .remove)
        #expect(cleared.contains("</mark> Bravo <mark"))
        #expect((cleared as NSString).substring(with: caretSelection) == "Bravo")
    }

    @Test func partialYellowSplitsKeepValidDelimiters() throws {
        let source = "==Alpha Bravo Charlie=="
        let colored = try applying(source, selection: (source as NSString).range(of: "Bravo"), action: .color("green")).0
        #expect(colored == "==Alpha== <mark class=\"hl-green\">Bravo</mark> ==Charlie==")
        #expect(MarkdownLiveSpans.plainText(colored) == "Alpha Bravo Charlie")
    }

    @Test func paragraphsListsAndHeadingPrefixesSurvive() throws {
        let source = "# Title\r\n\r\n- First item\r\n> Quote\nLast paragraph"
        let (colored, selection) = try applying(source, action: .color("purple"))
        #expect(colored.hasPrefix("# <mark class=\"hl-purple\">Title</mark>\r\n\r\n- "))
        #expect(colored.contains("> <mark class=\"hl-purple\">Quote</mark>"))
        #expect(MarkdownLiveSpans.plainText(colored) == MarkdownLiveSpans.plainText(source))
        #expect(try applying(colored, selection: selection, action: .remove).0 == source)
    }

    @Test func codeLinksAndOtherMarksRemainLiteralAndReadable() throws {
        let source = "| A\\|B | **bold** and `code` |\n| --- | --- |\n| [Link](https://example.com/a) | plain 😀 שלום |"
        let (colored, selected) = try applying(source, action: .color("orange"))
        #expect(colored.contains("**bold**"))
        #expect(colored.contains("`code`"))
        #expect(colored.contains("[Link](https://example.com/a)"))
        #expect(MarkdownLiveSpans.plainText(colored) == MarkdownLiveSpans.plainText(source))
        #expect(try applying(colored, selection: selected, action: .remove).0 == source)
    }

    @Test func partialEscapedPipeSelectionCannotCreateAColumn() throws {
        let source = "| A\\|B | other |\n| --- | --- |\n| C | D |"
        let pipe = (source as NSString).range(of: "\\|").location + 1
        for selection in [NSRange(location: pipe, length: 1), NSRange(location: pipe - 1, length: 1)] {
            let (colored, selected) = try applying(source, selection: selection, action: .color("blue"))
            #expect(MarkdownLiveSpans.spans(colored).filter { $0.kind == .tableHeader }.count == 1)
            #expect(colored.contains("<mark class=\"hl-blue\">\\|</mark>"))
            #expect(MarkdownLiveSpans.plainText(colored) == MarkdownLiveSpans.plainText(source))
            #expect(try applying(colored, selection: selected, action: .remove).0 == source)
        }
    }

    @Test func caretInsideCodeOrLinkCannotEditItsMarkup() {
        for source in ["`code`", "[Link](https://example.com)", "**bold**"] {
            #expect(NoteInlineFormat.highlightEdit(in: source as NSString, selection: NSRange(location: 2, length: 0), action: .toggle) == nil)
        }
    }

    @Test func caretRemovalAndTypingHaveValidOffsets() throws {
        let source = "α😀 ==word== last"
        let caret = (source as NSString).range(of: "word").location + 2
        let (cleared, selected) = try applying(source, selection: NSRange(location: caret, length: 0), action: .remove)
        #expect(cleared == "α😀 word last")
        #expect(selected == NSRange(location: caret - 2, length: 0))
        let typing = try applying("ab", selection: NSRange(location: 1, length: 0), action: .toggle)
        #expect(typing.0 == "a====b")
        #expect(typing.1 == NSRange(location: 3, length: 0))
    }

    @Test func structuralSelectionsInvalidColorsAndRangesDoNothing() {
        let rule = (table as NSString).range(of: "| :--- | ---: |")
        #expect(NoteInlineFormat.highlightEdit(in: table as NSString, selection: rule, action: .color("blue")) == nil)
        for range in [NSRange(location: -1, length: 0), NSRange(location: 0, length: -1), NSRange(location: NSNotFound, length: 0), NSRange(location: 0, length: Int.max)] {
            #expect(NoteInlineFormat.highlightEdit(in: table as NSString, selection: range, action: .remove) == nil)
        }
        #expect(NoteInlineFormat.highlightEdit(in: table as NSString, selection: NSRange(location: 0, length: 5), action: .color("blue\">bad")) == nil)
        #expect(NoteInlineFormat.highlightEdit(in: "abc" as NSString, selection: NSRange(location: 0, length: 0), action: .color("blue")) == nil)
    }
}
