import Foundation
import Testing
import BereanNotes
import BereanReference

struct NoteScriptureBlockTests {
    @Test func detectsSingleLineAndRetainsExactUTF16Source() throws {
        let text = "😀 Earlier\r\n\r\nJohn 3:16 For God so loved the world.\r\nAfter"
        let block = try #require(NoteScriptureBlock.candidates(in: text).first)
        #expect(block.reference == "John 3:16")
        #expect(block.body == "For God so loved the world.")
        #expect((text as NSString).substring(with: block.referenceRange) == "John 3:16")
        #expect((text as NSString).substring(with: block.range) == "John 3:16 For God so loved the world.")
        #expect(block.isCurrent(in: text))
        #expect(!block.isCurrent(in: "short"))
        #expect(!block.isCurrent(in: text.replacingOccurrences(of: "world", with: "earth")))
    }
    @Test func keepsFormattedSourceButMatchesVisibleBody() throws {
        let text = "**John 3:16** For **God** so *loved* the ==world==."
        let block = try #require(NoteScriptureBlock.candidates(in: text).first)
        #expect(block.reference == "John 3:16")
        #expect(block.body == "For God so loved the world.")
        #expect((text as NSString).substring(with: block.referenceRange) == "John 3:16")
        #expect(block.isCurrent(in: text))
    }
    @Test func collectsNumberedLinesAcrossBlankGapsAndStopsAtCommentary() throws {
        let text = "John 3:16–17\n16 For God so loved the world.\n\n17 For God sent not his Son.\nMy commentary\n18 Not part of the block"
        let block = try #require(NoteScriptureBlock.candidates(in: text).first)
        #expect(block.body == "For God so loved the world.\nFor God sent not his Son.")
        #expect((text as NSString).substring(with: block.range).hasSuffix("17 For God sent not his Son."))
        #expect(!block.body.contains("My commentary"))
    }
    @Test func detectsChapterAndCombinedLabelsWithoutEatingNumberedBookReferences() {
        let text = "Psalm 115 LXX\n4–5 I will take the cup.\n1 John 3:16 Hereby perceive we the love."
        let blocks = NoteScriptureBlock.candidates(in: text)
        #expect(blocks.map(\.reference) == ["Psalm 115 LXX", "1 John 3:16"])
        #expect(blocks.first?.body == "I will take the cup.")
        #expect(blocks.last?.body == "Hereby perceive we the love.")
    }
    @Test func excludesCodeLinksTablesAndStructuralText() {
        for text in ["```\nJohn 3:16 For God\n```", "~~~\nJohn 3:16 For God\n~~~",
                     "`John 3:16 For God`", "[John 3:16](https://example.org) For God",
                     "[[John 3:16]] For God", "# John 3:16 For God", "> John 3:16 For God",
                     "- John 3:16 For God", "| John 3:16 For God |\n| --- |", "John 3:16 `For God`",
                     "John 3:16\n> 16 For God", "John 3:16\n```\n16 For God\n```"] {
            #expect(NoteScriptureBlock.candidates(in: text).isEmpty, "Unexpected candidate: \(text)")
        }
    }
    @Test func preservesSeparateBlocksAndRejectsReferenceOnlyOrEmbeddedProse() {
        #expect(NoteScriptureBlock.candidates(in: "John 3:16\n\nPsalm 3:1 LXX").isEmpty)
        #expect(NoteScriptureBlock.candidates(in: "Consider John 3:16 For God").isEmpty)
        #expect(NoteScriptureBlock.candidates(in: "John 3 discusses love").isEmpty)
        #expect(NoteScriptureBlock.candidates(in: "John 3:16 For God\rPsalm 3:1 LXX O Lord").count == 2)
    }
    @Test func normalizesReferenceSpacesWithoutShiftingOffsets() throws {
        let text = "😀\nSong\u{00a0}of\u{2009}Songs 2:1 I am the rose."
        let block = try #require(NoteScriptureBlock.candidates(in: text).first)
        #expect(block.reference == "Song of Songs 2:1")
        #expect((text as NSString).substring(with: block.referenceRange) == "Song\u{00a0}of\u{2009}Songs 2:1")
    }
    @Test func cacheKeySurvivesPositionOnlyChanges() throws {
        let first = try #require(NoteScriptureBlock.candidates(in: "John 3:16 For God").first)
        let moved = try #require(NoteScriptureBlock.candidates(in: "😀 Before\n\nJohn 3:16 For God").first)
        #expect(first.verificationKey == moved.verificationKey)
        #expect(first.range != moved.range)
        #expect(!first.isCurrent(in: "😀 Before\n\nJohn 3:16 For God"))
    }
    @Test func usesFullHermasGrammarAndEditionWithoutShorteningTheHeading() throws {
        let reference = "Hermas Vision 2 3:1"
        for edition in [HermasText.taylor, .robertsDonaldson] {
            #expect(Reference.parse(reference, hermas: edition) != nil)
            let text = reference + " This is the copied passage."
            let block = try #require(NoteScriptureBlock.candidates(in: text, hermas: edition).first)
            #expect(block.reference == reference)
            #expect(block.body == "This is the copied passage.")
            #expect((text as NSString).substring(with: block.referenceRange) == reference)
        }
    }
    @Test func matchesLegacyMultisetRatioAndIgnoresStrongsIDs() {
        #expect(NoteScriptureBlock.matchRatio(candidate: "G2316 For GOD, H3068", actual: "For God") == 1)
        #expect(NoteScriptureBlock.matchRatio(candidate: "love love love", actual: "Love love") == 2.0 / 3.0)
        #expect(NoteScriptureBlock.matchRatio(candidate: "For God loves everyone", actual: "For God so loved the world") == 0.5)
        #expect(NoteScriptureBlock.matchRatio(candidate: "G1 H2 !", actual: "For God") == 0)
        #expect(NoteScriptureBlock.matchRatio(candidate: "", actual: "For God") == 0)
        #expect(NoteScriptureBlock.matchRatio(candidate: "For God", actual: "") == 0)
    }
}
