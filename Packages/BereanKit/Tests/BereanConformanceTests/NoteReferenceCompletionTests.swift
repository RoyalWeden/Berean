import Foundation
import Testing
import BereanNotes

struct NoteReferenceCompletionTests {
    private func detect(_ text: String) -> NoteReferenceCompletion? {
        NoteReferenceCompletion.detect(in: text, selection: NSRange(location: text.utf16.count, length: 0))
    }

    @Test func detectsNormalizedStrongsAndUTF16Range() throws {
        let text = "😀 café h00548"
        let completion = try #require(detect(text))
        #expect(completion.target == .strongs("H548"))
        #expect(completion.range == NSRange(location: "😀 café ".utf16.count, length: "h00548".utf16.count))
        #expect(detect("G5485")?.target == .strongs("G5485"))
        for text in ["H0", "G00000", "G123456", "wordG5485", "αG5485", "G5485a", "G-5485", "G 5485"] {
            #expect(detect(text) == nil, "Unexpected trigger: \(text)")
        }
    }

    @Test func detectsVerseRangesLXXAndMultiwordBooks() throws {
        for reference in ["John 3:16", "John 3:16–18", "Psalm 3:1 LXX", "Song of Songs 2:1", "1 Samuel 3:4", "Jude 1:5"] {
            let text = "😀 Consider " + reference
            let completion = try #require(detect(text), "Missing trigger: \(reference)")
            #expect(completion.target == .scripture(reference))
            #expect(completion.range == NSRange(location: "😀 Consider ".utf16.count, length: reference.utf16.count))
        }
        for reference in ["John 3", "John", "Jude 5", "John 999:1", "John 3:0"] {
            #expect(detect(reference) == nil)
        }
    }

    @Test func suppressesCodeEscapesLinksAndWikilinkChooser() {
        for reference in ["G5485", "John 3:16"] {
            for text in ["`" + reference, "``" + reference, "```swift\n" + reference, "~~~\n" + reference,
                         "[" + reference, "![" + reference, "[[" + reference, "[label](" + reference,
                         "\\" + reference] {
                #expect(detect(text) == nil, "Unexpected trigger: \(text)")
            }
            for template in ["`%@`", "[%@](https://example.org)", "![%@](image.png)", "[[%@]]"] {
                let text = template.replacingOccurrences(of: "%@", with: reference)
                let caret = (text as NSString).range(of: reference).upperBound
                #expect(NoteReferenceCompletion.detect(in: text, selection: NSRange(location: caret, length: 0)) == nil)
            }
        }
        #expect(detect("`code` G5485")?.target == .strongs("G5485"))
        #expect(detect("```\ncode\n```\nJohn 3:16")?.target == .scripture("John 3:16"))
        #expect(detect("\\\\G5485")?.target == .strongs("G5485"))
        #expect(detect("[label](https://example.org) John 3:16")?.target == .scripture("John 3:16"))
    }

    @Test func suppressesCompleteAndUnfinishedInlineFormatting() {
        for reference in ["G5485", "John 3:16"] {
            for (opening, closing) in [("**", "**"), ("__", "__"), ("*", "*"), ("_", "_"), ("~~", "~~"),
                                       ("==", "=="), ("<u>", "</u>"), ("<mark class=\"hl-blue\">", "</mark>"),
                                       ("***", "***"), ("**_", "_**")] {
                let unfinished = opening + reference
                #expect(detect(unfinished) == nil, "Unexpected trigger: \(unfinished)")
                #expect(NoteReferenceCompletion.detect(in: unfinished + closing,
                    selection: NSRange(location: unfinished.utf16.count, length: 0)) == nil)
                let after = opening + "earlier" + closing + " " + reference
                #expect(detect(after) != nil, "Missing trigger after closed formatting: \(after)")
            }
        }
        #expect(detect("`**literal` G5485")?.target == .strongs("G5485"))
        #expect(detect("[**literal](https://example.org) G5485")?.target == .strongs("G5485"))
        #expect(detect("2 * 3 G5485")?.target == .strongs("G5485"))
        #expect(detect("word_with_underscores G5485")?.target == .strongs("G5485"))
        #expect(detect(#"\*literal G5485"#)?.target == .strongs("G5485"))
        #expect(detect("**earlier** `code` John 3:16")?.target == .scripture("John 3:16"))
    }

    @Test func suppressesPartialTokensAndFutureReferenceSuffixes() {
        for (text, offset) in [("G5485", 3), ("G5485word", 5), ("John 3:16", 7), ("John 3:16–18", 9),
                               ("John 3:16 LXX", 9), ("John 3:16, 18", 9), ("John 3:16 18", 9)] {
            #expect(NoteReferenceCompletion.detect(in: text, selection: NSRange(location: offset, length: 0)) == nil)
        }
        #expect(NoteReferenceCompletion.detect(in: "John 3:16 trailing", selection: NSRange(location: 9, length: 0))?.target == .scripture("John 3:16"))
        #expect(NoteReferenceCompletion.detect(in: "😀 G5485", selection: NSRange(location: 1, length: 0)) == nil)
        #expect(NoteReferenceCompletion.detect(in: "G5485", selection: NSRange(location: 0, length: 5)) == nil)
        #expect(NoteReferenceCompletion.detect(in: "G5485", selection: NSRange(location: NSNotFound, length: 0)) == nil)
    }

    @Test func editsRequireUnchangedSourceAndCaret() throws {
        let text = "😀 g05485"
        let caret = NSRange(location: text.utf16.count, length: 0)
        let completion = try #require(detect(text))
        #expect(completion.edit(in: "😀 G05485", selection: caret, replacement: "entry") == nil)
        #expect(completion.edit(in: text + "!", selection: caret, replacement: "entry") == nil)
        #expect(completion.edit(in: text, selection: NSRange(location: caret.location - 1, length: 0), replacement: "entry") == nil)
        #expect(completion.edit(in: text, selection: caret, replacement: " \n ") == nil)
        let edit = try #require(completion.edit(in: text, selection: caret, replacement: "G5485 grace"))
        #expect((text as NSString).replacingCharacters(in: edit.range, with: edit.replacement) == "😀 G5485 grace")
        #expect(edit.selection == NSRange(location: "😀 G5485 grace".utf16.count, length: 0))
    }

    @Test func multilineReplacementPreservesSurroundsAndOneUndoContract() throws {
        let text = "**😀**\r\nBefore John 3:16 after\r\nUntouched"
        let caret = NSRange(location: "**😀**\r\nBefore John 3:16".utf16.count, length: 0)
        let completion = try #require(NoteReferenceCompletion.detect(in: text, selection: caret))
        let replacement = "John 3:16–17\n16 First verse\n17 Second verse"
        let edit = try #require(completion.edit(in: text, selection: caret, replacement: replacement))
        let result = (text as NSString).replacingCharacters(in: edit.range, with: edit.replacement)
        #expect(result == "**😀**\r\nBefore \n\n" + replacement + "\n\n after\r\nUntouched")
        #expect(edit.selection.location == edit.range.location + edit.replacement.utf16.count)
        #expect((result as NSString).replacingCharacters(in: NSRange(location: edit.range.location, length: edit.replacement.utf16.count), with: (text as NSString).substring(with: edit.range)) == text)
        let ownLine = try #require(detect("G5485"))
        #expect(ownLine.edit(in: "G5485", selection: NSRange(location: 5, length: 0), replacement: "G5485 grace;\nDefinition")?.replacement == "G5485 grace;\nDefinition")
    }
    @Test func blockSuggestionsCannotSplitExistingTables() {
        for reference in ["John 3:16", "G5485"] {
            let text = "| Heading | Other |\n| --- | --- |\n| " + reference + " | value |"
            let caret = (text as NSString).range(of: reference).upperBound
            #expect(NoteReferenceCompletion.detect(in: text, selection: NSRange(location: caret, length: 0)) == nil)
            #expect(detect(text + "\n\n" + reference) != nil)
        }
    }

}
