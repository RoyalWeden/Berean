import Foundation

/// A native editor owns its focus signal even when its final end event is
/// deferred until after teardown. Old editors must not clear a newer editor.
public struct NoteEditorActivity: Equatable, Sendable {
    public let owner: UUID
    public let isEditing: Bool
    public init(owner: UUID, isEditing: Bool) {
        self.owner = owner; self.isEditing = isEditing
    }
}

public struct NoteEditingFocus: Equatable, Sendable {
    public private(set) var owner: UUID?
    public init() {}

    /// nil means an obsolete/unmatched end event; retain the current UI state.
    public mutating func receive(_ event: NoteEditorActivity) -> Bool? {
        if event.isEditing {
            owner = event.owner
            return true
        }
        guard owner == event.owner else { return nil }
        owner = nil
        return false
    }
}
