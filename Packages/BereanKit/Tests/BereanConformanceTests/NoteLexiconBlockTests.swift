import Foundation
import Testing
import BereanNotes

struct NoteLexiconBlockTests {
    @Test func detectsCopiedEntriesWithoutChangingUTF16Source() throws {
        let text = "😀 Before\r\n\r\nG5485 χάρις cháris;\r\nfrom G5463; grace:—favour\r\n\r\nAfter"
        let block = try #require(NoteLexiconBlock.detect(in: text).first)
        #expect(block.number == "G5485")
        #expect((text as NSString).substring(with: block.heading) == "G5485 χάρις cháris;")
        #expect((text as NSString).substring(with: block.definition) == "from G5463; grace:—favour")
        #expect((text as NSString).substring(with: block.range) == "G5485 χάρις cháris;\r\nfrom G5463; grace:—favour")
    }
    @Test func recognizesHebrewAndAdjacentEntries() {
        let text = "h03068 יהוה Yehovah;\nThe divine name\nG5485 χάρις cháris;\nGrace"
        #expect(NoteLexiconBlock.detect(in: text).map(\.number) == ["H3068", "G5485"])
    }
    @Test func doesNotBoxPlainReferencesOrUnfinishedEntries() {
        for text in ["G5485", "G5485\nGrace", "G5485 grace;", "G5485 grace;\n\nNext",
                     "G0 word;\nDefinition", "G123456 word;\nDefinition", "Word G5485 grace;\nDefinition",
                     "G5485 grace;\n# Heading"] {
            #expect(NoteLexiconBlock.detect(in: text).isEmpty, "Unexpected block: \(text)")
        }
    }
    @Test func excludesCodeLinksTablesAndOtherStructuredBlocks() {
        for text in ["```\nG5485 grace;\nDefinition\n```", "~~~\nG5485 grace;\nDefinition\n~~~",
                     "`G5485 grace;`\nDefinition", "[G5485 grace;](url)\nDefinition",
                     "# G5485 grace;\nDefinition", "> G5485 grace;\n> Definition",
                     "- G5485 grace;\nDefinition", "| G5485 grace; |\n| --- |\n| Definition |"] {
            #expect(NoteLexiconBlock.detect(in: text).isEmpty, "Unexpected block: \(text)")
        }
    }
    @Test func stopsAtTwoLinesAndSupportsLoneCarriageReturns() throws {
        let text = "H3068 יהוה;\rDivine name\rMy commentary"
        let block = try #require(NoteLexiconBlock.detect(in: text).first)
        #expect((text as NSString).substring(with: block.range) == "H3068 יהוה;\rDivine name")
    }
}
