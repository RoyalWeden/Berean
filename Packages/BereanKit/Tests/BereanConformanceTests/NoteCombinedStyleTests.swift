import Foundation
import Testing
import BereanNotes

@Suite("combined native note styles")
struct NoteCombinedStyleTests {
    private func styled(_ source: String, word: String, kind: MarkdownLiveSpans.Kind) -> Bool {
        let range = (source as NSString).range(of: word)
        var coverage = IndexSet()
        for span in MarkdownLiveSpans.spans(source) where span.kind == kind {
            coverage.insert(integersIn: span.range.location..<span.range.upperBound)
        }
        return coverage.contains(integersIn: range.location..<range.upperBound)
    }

    @Test func sharedAndPartialEmphasisBoundaries() {
        for source in ["***word***", "___word___", "***word** rest*", "**rest *word***", "*rest **word***"] {
            #expect(styled(source, word: "word", kind: .bold), "\(source)")
            #expect(styled(source, word: "word", kind: .italic), "\(source)")
            #expect(!MarkdownLiveSpans.plainText(source).contains("*"), "\(source)")
            #expect(!MarkdownLiveSpans.plainText(source).contains("_"), "\(source)")
        }
        #expect(!styled("***word** rest*", word: "rest", kind: .bold))
        #expect(styled("***word** rest*", word: "rest", kind: .italic))
    }

    @Test func underlineHighlightAndEmphasisCombineInEitherOrder() {
        for source in ["**<u>word</u>**", "<u>**word**</u>", "<mark class=\"hl-blue\">***word***</mark>", "***<mark class=\"hl-blue\">word</mark>***"] {
            #expect(styled(source, word: "word", kind: .bold), "\(source)")
            #expect(MarkdownLiveSpans.plainText(source) == "word", "\(source)")
            if source.contains("<u>") { #expect(styled(source, word: "word", kind: .underline)) }
            else {
                #expect(styled(source, word: "word", kind: .italic))
                #expect(styled(source, word: "word", kind: .highlight("blue")))
            }
        }
    }

    @Test func outerFormattingKeepsCodeLiteralAndMonospaceScope() {
        for source in ["**`code *literal*`**", "<u>`code *literal*`</u>", "<mark class=\"hl-blue\">`code *literal*`</mark>"] {
            #expect(styled(source, word: "code *literal*", kind: .code))
            #expect(!styled(source, word: "literal", kind: .italic))
            #expect(MarkdownLiveSpans.plainText(source) == "code *literal*")
        }
        #expect(styled("**`code`**", word: "code", kind: .bold))
    }

    @Test func linkLabelsCombineWhileDestinationsStayLiteral() {
        let source = "***[word](https://example.com/`opaque`_path)***"
        #expect(styled(source, word: "word", kind: .bold))
        #expect(styled(source, word: "word", kind: .italic))
        #expect(MarkdownLiveSpans.plainText(source) == "word")
        #expect(MarkdownLiveSpans.spans(source).contains { $0.kind == .link("https://example.com/`opaque`_path") })
        #expect(!styled(source, word: "opaque", kind: .code))
        #expect(MarkdownLiveSpans.plainText("`[word](https://example.com)`") == "[word](https://example.com)")
    }

    @Test func utf16RangesRemainOnOriginalEmojiCombiningAndHebrewText() {
        let source = "😀 ***שָׁלוֹם e\u{301}*** and <u>**α😀**</u>"
        #expect(styled(source, word: "שָׁלוֹם e\u{301}", kind: .bold))
        #expect(styled(source, word: "שָׁלוֹם e\u{301}", kind: .italic))
        #expect(styled(source, word: "α😀", kind: .bold))
        #expect(styled(source, word: "α😀", kind: .underline))
        #expect(MarkdownLiveSpans.plainText(source) == "😀 שָׁלוֹם e\u{301} and α😀")
        let length = (source as NSString).length
        #expect(MarkdownLiveSpans.spans(source).allSatisfy { $0.range.location >= 0 && $0.range.upperBound <= length })
    }

    @Test func reusedBodiesKeepTheirOwnBlockAndUtf16Offsets() {
        for prefix in ["# ", "> ", "> > ", "- ", "## "] {
            let source = "😀前置\n" + prefix + "***word***"
            #expect(styled(source, word: "word", kind: .bold))
            #expect(styled(source, word: "word", kind: .italic))
            #expect(MarkdownLiveSpans.spans(source).allSatisfy { $0.range.upperBound <= (source as NSString).length })
        }
    }

    @Test func concurrentNotesCannotReuseAnotherNotesRanges() async {
        let sources = (0..<32).map { "😀 \($0) ***word*** <u>**α**</u>" }
        let results = await withTaskGroup(of: (Int, String).self, returning: [(Int, String)].self) { group in
            for (index, source) in sources.enumerated() {
                group.addTask { (index, MarkdownLiveSpans.plainText(source)) }
            }
            var result: [(Int, String)] = []
            for await value in group { result.append(value) }
            return result
        }
        #expect(results.allSatisfy { $0.1 == "😀 \($0.0) word α" })
    }

    @Test func partialHighlightEditsCannotInsertTagsInsideNestedCodeOrLinks() {
        for inner in ["`Alpha Bravo`", "**Alpha Bravo**", "[Alpha Bravo](https://example.com)"] {
            let source = "<mark class=\"hl-blue\">\(inner)</mark>"
            let partial = (source as NSString).range(of: "Bravo")
            #expect(NoteInlineFormat.highlightEdit(in: source as NSString, selection: partial, action: .remove) == nil)
            #expect(NoteInlineFormat.highlightEdit(in: source as NSString, selection: partial, action: .color("green")) == nil)
            let edit = NoteInlineFormat.highlightEdit(in: source as NSString, selection: (source as NSString).range(of: "Alpha Bravo"), action: .remove)
            #expect(edit.map { (source as NSString).replacingCharacters(in: $0.range, with: $0.replacement) } == inner)
        }
    }

    @Test func tableGridAndWikiLinkTargetAreUnchanged() {
        let source = "| ***word*** | <u>**α😀**</u> |\n| --- | --- |\n| other | **`a\\|b`** |\n\n[[Exact target|***alias***]]"
        #expect(MarkdownLiveSpans.spans(source).filter { $0.kind == .tableHeader }.count == 1)
        #expect(styled(source, word: "alias", kind: .bold))
        #expect(styled(source, word: "alias", kind: .italic))
        #expect(MarkdownLiveSpans.spans(source).contains { $0.kind == .wikilink("Exact target") })
        #expect(MarkdownLiveSpans.plainText(source) == "| word | α😀 |\n| --- | --- |\n| other | a|b |\n\nalias")
    }
}
