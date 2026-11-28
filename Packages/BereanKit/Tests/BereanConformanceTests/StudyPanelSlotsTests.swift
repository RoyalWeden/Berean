import Testing
import BereanCore
import BereanWorkspace

@Test func restoresSingleKeyLegacyInspectorSplit() {
    var stored = JSObject()
    stored["rightPanelTab"] = .string("lexicon")
    stored["rightPanelSlotB"] = .string("lexicon")
    stored["rightPanelLexiconEntryB"] = .string("G32")
    let persisted = TabFields.split(type: .bible, state: stored)
    stored = TabFields.merge(type: .bible, sync: persisted.sync, local: persisted.local)
    var slots = StudyPanelSlots(stored)

    #expect(slots.primary == .notes)
    #expect(slots.secondary == .lexicon)
    #expect(slots.secondaryTabs == [.lexicon])
    slots.move(.lexicon, toSecondary: false)
    slots.write(to: &stored)
    #expect(StudyPanelSlots(stored).primary == .lexicon)
    #expect(StudyPanelSlots(stored).secondary == nil)
    #expect(stored["rightPanelLexiconEntryB"] == .string("G32"))
}

@Test func preservesLegacyInspectorOrderAndNormalizesInvalidSelections() {
    var stored = JSObject()
    stored["rightPanelTab"] = .string("notes")
    stored["rightPanelSlotBTabs"] = .array([.string("crossrefs"), .string("lexicon"), .string("crossrefs"), .string("unknown")])
    stored["rightPanelSlotB"] = .string("notes")
    var slots = StudyPanelSlots(stored)

    #expect(slots.secondaryTabs == [.crossrefs, .lexicon])
    #expect(slots.secondary == .crossrefs)
    slots.move(.notes, toSecondary: true)
    #expect(slots.primaryTabs == [.notes])
    slots.focusSecondary(.lexicon)
    slots.write(to: &stored)
    #expect(StudyPanelSlots(stored).secondary == .lexicon)
    slots.closeSecondary()
    #expect(slots.primaryTabs == [.notes, .lexicon, .crossrefs])
}
