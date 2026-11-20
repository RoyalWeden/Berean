import Foundation
import Testing
import BereanNotes

struct NoteEditingFocusTests {
    @Test func normalEditingAndDuplicateEnd() {
        let owner = UUID()
        var focus = NoteEditingFocus()
        #expect(focus.receive(.init(owner: owner, isEditing: true)) == true)
        #expect(focus.owner == owner)
        #expect(focus.receive(.init(owner: owner, isEditing: false)) == false)
        #expect(focus.owner == nil)
        #expect(focus.receive(.init(owner: owner, isEditing: false)) == nil)
    }

    @Test func removedEditorsDeferredEndDoesNotClearNewEditor() {
        let removed = UUID(), current = UUID()
        var focus = NoteEditingFocus()
        #expect(focus.receive(.init(owner: removed, isEditing: true)) == true)
        #expect(focus.receive(.init(owner: current, isEditing: true)) == true)
        #expect(focus.receive(.init(owner: removed, isEditing: false)) == nil)
        #expect(focus.owner == current)
        #expect(focus.receive(.init(owner: current, isEditing: false)) == false)
    }

    @Test func unmatchedEndDoesNotDismissAnotherEditorsDockState() {
        var focus = NoteEditingFocus()
        #expect(focus.receive(.init(owner: UUID(), isEditing: false)) == nil)
        let current = UUID()
        #expect(focus.receive(.init(owner: current, isEditing: true)) == true)
        #expect(focus.receive(.init(owner: UUID(), isEditing: false)) == nil)
        #expect(focus.owner == current)
    }
}
