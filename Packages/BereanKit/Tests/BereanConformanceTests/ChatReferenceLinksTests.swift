import Foundation
import Testing
import BereanNotes
import BereanReference

@Suite("Chat reference presentation")
struct ChatReferenceLinksTests {
    @Test func unicodeRangesRepeatedReferencesAndEditions() throws {
        let source = "😀 **John 3:16**; Psalm 3:1 LXX; h-07225; John 3:16; G5485."
        let links = ChatReferenceLinks.links(in: source)
        #expect(links.map { (source as NSString).substring(with: $0.range) }
                == ["John 3:16", "Psalm 3:1 LXX", "h-07225", "John 3:16", "G5485"])
        #expect(links.map { DeepLink.parse($0.url.absoluteString) } == [
            .verse(bookId: "JHN", chapter: 3, verse: 16),
            .verse(bookId: "PSA", chapter: 3, verse: 1, textId: "lxx"),
            .lexicon(strongsNum: "H7225"),
            .verse(bookId: "JHN", chapter: 3, verse: 16),
            .lexicon(strongsNum: "G5485"),
        ])
        let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        let original = try AttributedString(markdown: source, options: options)
        let rendered = try AttributedString(markdown: ChatReferenceLinks.markdown(source), options: options)
        #expect(String(rendered.characters) == String(original.characters))
    }

    @Test func codeLinksImagesCommentsAndURLsRemainLiteral() {
        let source = """
        ```text
        John 3:16 H7225
        ```
        `Psalm 3:1 G5485`
        [John 3:16 H7225](https://example.com/G5485)
        ![Psalm 3:1 H7225](data:image/png;base64,abc123)
        <!-- John 3:16 G5485 -->
        https://example.com/John%203:16/H7225
        [[John 3:16]]
        Jude 1:5 and H2603
        """
        let links = ChatReferenceLinks.links(in: source)
        #expect(links.map { (source as NSString).substring(with: $0.range) } == ["Jude 1:5", "H2603"])
    }

    @Test func incompleteCodeAndReferenceLinksDoNotAcquireNestedLinks() {
        let source = """
        `John 3:16 G5485
        [John 3:16][passage]
        [passage]: https://example.com/H7225
        H2603
        """
        #expect(ChatReferenceLinks.links(in: source).map { (source as NSString).substring(with: $0.range) } == ["H2603"])
    }

    @Test func presentationIsIdempotentAndKeepsTableStructure() {
        let source = "| Passage | Word |\n| --- | --- |\n| John 3:16 | ==G5485== |"
        let rendered = ChatReferenceLinks.markdown(source)
        #expect(ChatReferenceLinks.markdown(rendered) == rendered)
        #expect(rendered.components(separatedBy: "\n").count == 3)
        #expect(rendered.filter { $0 == "|" }.count == source.filter { $0 == "|" }.count)
        #expect(rendered.contains("==[G5485]("))
    }

    @Test func nonbreakingSpacesKeepOriginalVisibleCharacters() throws {
        let source = "Read John\u{00A0}3:16 and H\u{00A0}7225."
        let rendered = ChatReferenceLinks.markdown(source)
        let parsed = try AttributedString(markdown: rendered, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))
        #expect(String(parsed.characters) == source)
        #expect(ChatReferenceLinks.links(in: source).count == 2)
    }
}
