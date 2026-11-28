import Foundation
import Testing
import BereanNotes

struct NoteStrongsLinksTests {
    @Test func preservesUTF16OffsetsAndEveryNormalizedOccurrence() {
        let text = "😀 h00548 and G-05485; H548 again"
        let spans = NoteStrongsLinks.spans(in: text)
        #expect(spans.map(\.number) == ["H548", "G5485", "H548"])
        #expect(spans.map { (text as NSString).substring(with: $0.range) } == ["h00548", "G-05485", "H548"])
        #expect(spans.first?.range.location == "😀 ".utf16.count)
    }

    @Test func dictionaryHeadingAndDerivationReferencesRemainLinks() {
        let text = "**H2617 lovingkindness;**\nFrom H2603; compare ==G5485== and <mark class=\"hl-blue\">H2617</mark>."
        #expect(NoteStrongsLinks.spans(in: text).map(\.number) == ["H2617", "H2603", "G5485", "H2617"])
        #expect(NoteStrongsLinks.spans(in: "*G5485* ~~H2617~~ <u>H2603</u>").map(\.number) == ["G5485", "H2617", "H2603"])
    }

    @Test func excludesWholeLinkImageWikiURLAndCommentSyntax() {
        let text = """
        [G5485](https://example.org/H2617)
        ![G5485](assets/H2617.png)
        [label](path/nested(H2617)/G5485)
        [[G5485|H2617]]
        [G5485]
        [G5485]: /dictionary
        [G5485][lexicon]
        ![H2617][picture]
        [lexicon]: /path/G5485 "H2617"
        https://example.org/H2617 www.example.org/G5485 example.org/H2603
        <https://example.org/G5485> G5485@example.org
        <a href="path/H2617">G5485</a>
        <!-- berean:columns G5485 H2617 -->
        <!-- multi
        G5485
        -->
        H2603
        """
        #expect(NoteStrongsLinks.spans(in: text).map(\.number) == ["H2603"])
    }

    @Test func excludesCodeFencesEscapesAndUnfinishedCode() {
        let text = """
        `G5485` ``H2617``
        ```swift
        G5485
        ```
        ~~~
        H2617
        ~~~
        \\H2617
        `unfinished G5485
        H2603
        """
        #expect(NoteStrongsLinks.spans(in: text).map(\.number) == ["H2603"])
        #expect(NoteStrongsLinks.spans(in: #"\\H2617"#).map(\.number) == ["H2617"])
    }

    @Test func unfinishedWikiLinkDoesNotHideLaterParagraphs() {
        let text = "Preview [[G5485\n\nG5485 grace;\nFrom H2617 and G5485.\n[[Dev H2617 title]]\nH2617"
        let spans = NoteStrongsLinks.spans(in: text)
        #expect(spans.map(\.number) == ["G5485", "H2617", "G5485", "H2617"])
        #expect(spans.map { (text as NSString).substring(with: $0.range) } == ["G5485", "H2617", "G5485", "H2617"])
        #expect(spans.first?.range.location == "Preview [[G5485\n\n".utf16.count)
        let cached = NoteStrongsLinks.spans(in: text, markdownSpans: MarkdownLiveSpans.spans(text))
        #expect(cached.map(\.range) == spans.map(\.range))
        #expect(NoteStrongsLinks.spans(in: "Preview [[\r\nH2617\r\n[[G5485]]\r\nH2617").map(\.number) == ["H2617", "H2617"])
    }

    @Test func acceptsExistingMarkdownSpansWithoutChangingResults() {
        let text = "😀 **G5485** `H2617` [H2603](path/G5485)\n~~~\nG5485\n~~~\nH2617"
        let expected = NoteStrongsLinks.spans(in: text)
        let reused = NoteStrongsLinks.spans(in: text, markdownSpans: MarkdownLiveSpans.spans(text))
        #expect(reused.map(\.number) == expected.map(\.number))
        #expect(reused.map(\.range) == expected.map(\.range))
    }

    @Test func neverInfersNumbersOrMatchesEmbeddedWords() {
        #expect(NoteStrongsLinks.spans(in: "5485 2617 grace lovingkindness John 3:16 H0 G00000 xG5485 αH2617 G123456").isEmpty)
        #expect(NoteStrongsLinks.spans(in: "H 2617; g5485a").map(\.number) == ["H2617", "G5485"])
    }
    @Test func backlinksIncludeExplicitLexiconLinksWithoutReinterpretingNoteTitles() {
        let source = """
        h00430 G-05485 G5485
        [love](berean-native-dev://lexicon/G26)
        [father](berean://lexicon/H1)
        [word](berean-lexicon:H2)
        [[H3]] [[G4|H5]]
        [H6](https://example.org/H7)
        ![G8](berean://lexicon/H9)
        `[hidden](berean://lexicon/H10)`
        ```
        [hidden](berean://lexicon/H11)
        ```
        <!-- [hidden](berean://lexicon/H12) -->
        """
        #expect(NoteStrongsLinks.references(in: source) == ["H430", "G5485", "G26", "H1", "H2"])
        #expect(NoteStrongsLinks.references(in: "No reference here").isEmpty)
    }

}
