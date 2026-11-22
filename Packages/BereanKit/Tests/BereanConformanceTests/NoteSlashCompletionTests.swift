import Foundation
import Testing
import BereanNotes

@Suite("note slash commands") struct NoteSlashCompletionTests {
    @Test func detectsAtLineStartAndAfterSpaceOnly() {
        let a = "Intro\n/he"
        #expect(NoteSlashCompletion.detect(in: a, selection: NSRange(location: 9, length: 0)) == NoteSlashCompletion(range: NSRange(location: 6, length: 3), query: "he"))
        let b = "word /ta"
        #expect(NoteSlashCompletion.detect(in: b, selection: NSRange(location: 8, length: 0))?.range == NSRange(location: 5, length: 3))
        #expect(NoteSlashCompletion.detect(in: "and/or", selection: NSRange(location: 6, length: 0)) == nil)
        #expect(NoteSlashCompletion.detect(in: "https://x", selection: NSRange(location: 9, length: 0)) == nil)
        #expect(NoteSlashCompletion.detect(in: "```\n/h", selection: NSRange(location: 6, length: 0)) == nil)   // inside code
        #expect(NoteSlashCompletion.detect(in: "/", selection: NSRange(location: 1, length: 0))?.query == "")
    }

    @Test func editValidatesTriggerAndPlacesCaret() {
        let text = "x\n/code"
        let c = NoteSlashCompletion.detect(in: text, selection: NSRange(location: 7, length: 0))!
        let e = c.edit(in: text, selection: NSRange(location: 7, length: 0), replacement: "```\n\n```", caretOffset: 4)
        #expect(e?.range == NSRange(location: 2, length: 5) && e?.selection == NSRange(location: 6, length: 0))
        #expect(c.edit(in: "x\n/cod", selection: NSRange(location: 6, length: 0), replacement: "", caretOffset: 0) == nil)
    }

    @Test func filtersLikeTheOriginal() {
        #expect(NoteSlashCommand.matching("").count == NoteSlashCommand.all.count)
        #expect(NoteSlashCommand.matching("head").map(\.id) == ["h1", "h2", "h3"])
        #expect(NoteSlashCommand.matching("list").map(\.id) == ["bullet", "numbered", "task"])
        #expect(NoteSlashCommand.matching("callout").map(\.id).count == 5)
        #expect(NoteSlashCommand.matching("tab").map(\.id) == ["table"])
    }
}
