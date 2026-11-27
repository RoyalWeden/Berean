import Foundation
import Testing
import BereanNotes
import BereanSQLite
import BereanStore

/// A39: native port of the original finalizeActionFor (finalizeNote.ts, TEST 2026-10-05 rules).
struct NoteFinalizeTests {
    private func n(_ type: String, _ title: String, _ content: String, tags: [String] = [], created: Int64 = 1_759_665_600_000) -> Note {
        Note(id: "x", type: type, title: title, content: content, verseRef: nil, color: "blue", icon: nil, status: nil, createdAt: created, updatedAt: created, tags: tags,
             importedAt: nil, folderId: nil, textId: "kjva", idiomTerm: nil, idiomMeaning: nil, idiomAliases: nil, idiomAutoVariants: false, idiomData: nil,
             deletedAt: nil, pinned: false, aiExcluded: false)
    }

    @Test func abandonedUntitledNotesGoToTrashAndUntitledNotesWithTextGetADateName() {
        #expect(NoteFinalize.action(for: n("general", "", "")) == .trash)
        #expect(NoteFinalize.action(for: n("general", "  ", "  \n- \n# \n> ")) == .trash)          // only empty markers
        #expect(NoteFinalize.action(for: n("general", "", "---\ntags: []\n---\n")) == .trash)      // front matter only
        let en = Locale(identifier: "en_US")
        let utc = TimeZone(secondsFromGMT: 0)!
        #expect(NoteFinalize.action(for: n("general", "", "real text"), locale: en, timeZone: utc) == .name("October 5, 2025"))
    }

    @Test func titledSystemAndIdiomNotesAreNeverTouched() {
        #expect(NoteFinalize.action(for: n("general", "Kept", "")) == .none)
        #expect(NoteFinalize.action(for: n("verse", "", "")) == .none)                // verse notes are system notes
        #expect(NoteFinalize.action(for: n("daily", "", "")) == .none)
        #expect(NoteFinalize.action(for: n("general", "Daily — 2026-11-26", "")) == .none)
        #expect(NoteFinalize.action(for: n("general", "", "", tags: ["esword"])) == .none)
        #expect(NoteFinalize.action(for: n("idiom", "", "")) == .none)
    }

    @Test func meaningfulBodyMatchesTheOriginal() {
        #expect(!NoteFinalize.hasMeaningfulBody("1. \n2. \n- [ ] "))
        #expect(NoteFinalize.hasMeaningfulBody("1. Grace"))
        #expect(NoteFinalize.hasMeaningfulBody("Yehovah"))
    }

    @Test func dateNamingUsesExistingFormatsAndTheLocalCalendarDay() {
        let date = Date(timeIntervalSince1970: 1_759_622_400)
        let en = Locale(identifier: "en_US")
        let utc = TimeZone(secondsFromGMT: 0)!
        let west = TimeZone(secondsFromGMT: -3600)!
        #expect(NoteFinalize.untitledName(date, format: .iso, locale: en, timeZone: utc) == "2025-10-05")
        #expect(NoteFinalize.untitledName(date, format: .iso, locale: en, timeZone: west) == "2025-10-04")
        #expect(NoteFinalize.untitledName(date, format: .medium, locale: en, timeZone: utc) == "Oct 5, 2025")
        #expect(NoteFinalize.untitledName(date, format: .numeric, locale: en, timeZone: utc) == "10/5/2025")
    }

    @Test func staleEditorsCannotOverwriteOrFinalizeTheLatestSavedNote() throws {
        let db = try SQLiteConnection(readWritePath: ":memory:", create: true)
        try Migrator.migrate(db)
        let notes = NotesService(db: db, now: { 42 })
        let baseline = try notes.create(.init(id: "draft")).note
        try notes.update(baseline.id, .init(content: "Newer text"))
        #expect(try !notes.update(baseline.id, .init(content: "Stale edit"), ifUnchanged: baseline))
        #expect(try notes.finalizeUnchanged(baseline) == .none)
        let current = try #require(try notes.one(baseline.id))
        #expect(current.content == "Newer text")
        #expect(current.deletedAt == nil)
        guard case .name(let title) = try notes.finalizeUnchanged(current, format: .iso) else {
            Issue.record("An unchanged untitled note containing text should be named")
            return
        }
        #expect(try notes.one(baseline.id)?.title == title)
        let abandoned = try notes.create(.init(id: "abandoned")).note
        #expect(try notes.finalizeUnchanged(abandoned) == .trash)
        #expect(try notes.one(abandoned.id)?.deletedAt == 42)
        #expect(try notes.finalizeUnchanged(abandoned) == .none)
    }
}
