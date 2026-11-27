import Foundation
import Testing
import BereanNotes

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
        #expect(NoteFinalize.action(for: n("general", "", "real text"), locale: en) == .name("October 5, 2025"))
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
}
