import Testing
import BereanNotes
import BereanReference

struct NoteAttachmentLabelTests {
    @Test func lxxPsalmAttachmentsUseReaderNumbers() {
        #expect(NoteAttachmentLabel.display("PSA.3.2", textId: "lxx") == "Psalms 3:1 LXX")
        #expect(NoteAttachmentLabel.display("PSA.3.2-4", textId: "lxx") == "Psalms 3:1–3 LXX")
        #expect(NoteAttachmentLabel.display("PSA.3.1-2", textId: "lxx") == "Psalms 3:1 LXX")
        #expect(NoteAttachmentLabel.display("PSA.115.4", textId: "lxx") == "Psalms 115:4–5 LXX")
        #expect(NoteAttachmentLabel.display("PSA.115.3-4", textId: "lxx") == "Psalms 115:3–5 LXX")
    }

    @Test func wholeChapterAndMixedAttachmentsKeepOneEditionSuffix() {
        #expect(NoteAttachmentLabel.display("PSA.3", textId: "lxx") == "Psalm 3 LXX")
        #expect(NoteAttachmentLabel.display("PSA.3.0", textId: "lxx") == "Psalm 3 LXX")
        #expect(NoteAttachmentLabel.display("PSA.3.2, GEN.1.1", textId: "LXX") == "Psalms 3:1, Genesis 1:1 LXX")
    }

    @Test func legacyFormatterAndOtherEditionsRemainUnchanged() {
        let raw = "PSA.3.2"
        #expect(Reference.verseRefDisplay(raw, textId: "lxx") == "Psalms 3:2 LXX")
        #expect(NoteAttachmentLabel.display(raw, textId: "kjva") == Reference.verseRefDisplay(raw, textId: "kjva"))
        for text in ["hermas", "hermas-lightfoot", "kjv"] {
            let ref = "GEN.1.1-3, PSA.3.2"
            #expect(NoteAttachmentLabel.display(ref, textId: text) == Reference.verseRefDisplay(ref, textId: text, hermas: HermasText(textId: text)))
        }
        #expect(NoteAttachmentLabel.display("unknown", textId: "lxx") == Reference.verseRefDisplay("unknown", textId: "lxx"))
        #expect(NoteAttachmentLabel.display("", textId: "lxx").isEmpty)
    }
}
