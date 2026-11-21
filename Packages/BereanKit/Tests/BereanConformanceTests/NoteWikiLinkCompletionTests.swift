import Foundation
import Testing
import BereanNotes
import BereanSQLite

struct NoteWikiLinkCompletionTests {
    @Test func titleTargetsExcludeTrashAndDoNotRequireContent() throws {
        let db = try SQLiteConnection(readWritePath: ":memory:", create: true)
        try db.exec("CREATE TABLE notes (id TEXT, title TEXT, deleted_at INTEGER, updated_at INTEGER)")
        try db.exec("INSERT INTO notes VALUES ('older', 'שָׁלוֹם', NULL, 1), ('newer', 'Study', NULL, 2), ('trash', 'Hidden', 3, 3), ('empty', '', NULL, 4)")
        let targets = try NotesService(db: db).wikiLinkTargets()
        #expect(targets.map(\.id) == ["newer", "older"])
        #expect(targets.map(\.title) == ["Study", "שָׁלוֹם"])
    }
    private func detect(_ text: String) -> NoteWikiLinkCompletion? {
        NoteWikiLinkCompletion.detect(in: text, selection: NSRange(location: (text as NSString).length, length: 0))
    }

    @Test func detectsEmptyMultiwordAndUnicodeQueries() throws {
        #expect(detect("[[")?.query == "")
        #expect(detect("before [[Song of Songs")?.query == "Song of Songs")
        let completion = try #require(detect("😀 café [[שָׁלוֹם 🌿"))
        #expect(completion.range.location == ("😀 café " as NSString).length)
        #expect(completion.range.length == ("[[שָׁלוֹם 🌿" as NSString).length)
        #expect(completion.query == "שָׁלוֹם 🌿")
        #expect(detect("[[" + String(repeating: "x", count: 257)) == nil)
    }

    @Test func rejectsClosedMultilineEscapedAndCode() {
        for text in ["[[Done]]", "[[first\nsecond", "[[first\rsecond", #"\[[escaped"#, "`[[inline`", "``[[inline``", "`[[unfinished", "```swift\n[[fenced", "~~~\n[[fenced"] {
            #expect(detect(text) == nil, "Unexpected trigger in \(text)")
        }
        #expect(detect(#"\\[[allowed"#)?.query == "allowed")
        #expect(detect("`code` [[allowed")?.query == "allowed")
        #expect(detect("```\ncode\n```\n[[allowed")?.query == "allowed")
        #expect(NoteWikiLinkCompletion.detect(in: "[[Done]]", selection: NSRange(location: 4, length: 0)) == nil)
    }

    @Test func rejectsInvalidSelectionsAndStaleEdits() throws {
        let text = "😀 [[query"
        let caret = NSRange(location: (text as NSString).length, length: 0)
        let completion = try #require(detect(text))
        #expect(NoteWikiLinkCompletion.detect(in: text, selection: NSRange(location: 1, length: 0)) == nil)
        #expect(NoteWikiLinkCompletion.detect(in: text, selection: NSRange(location: 50, length: 0)) == nil)
        #expect(NoteWikiLinkCompletion.detect(in: text, selection: NSRange(location: 3, length: 2)) == nil)
        #expect(completion.edit(in: "😀 [[other", selection: caret, title: "Title") == nil)
        #expect(completion.edit(in: text, selection: NSRange(location: caret.location - 1, length: 0), title: "Title") == nil)
        for title in ["", "  ", "[unsafe", "unsafe]", "ambiguous|alias", "two\nlines", "two\r lines"] {
            #expect(completion.edit(in: text, selection: caret, title: title) == nil)
        }
    }

    @Test func singleReplacementPreservesSurroundingSource() throws {
        let text = "**😀**\r\n- [[que trailing"
        let caret = NSRange(location: ("**😀**\r\n- [[que" as NSString).length, length: 0)
        let completion = try #require(NoteWikiLinkCompletion.detect(in: text, selection: caret))
        let edit = try #require(completion.edit(in: text, selection: caret, title: "Café 🌿"))
        let result = (text as NSString).replacingCharacters(in: edit.range, with: edit.replacement)
        #expect(result == "**😀**\r\n- [[Café 🌿]] trailing")
        #expect(edit.selection == NSRange(location: ("**😀**\r\n- [[Café 🌿]]" as NSString).length, length: 0))
        #expect((result as NSString).replacingCharacters(in: NSRange(location: edit.range.location, length: (edit.replacement as NSString).length), with: (text as NSString).substring(with: edit.range)) == text)
    }
}
