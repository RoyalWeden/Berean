import Foundation
import BereanReference

/// An ephemeral, source-derived lookup. No new persisted identities or arbitrary verse associations.
public struct NoteStrongsIndex: Sendable {
    private var byNumber: [String: [Note]] = [:]

    public init(notes: [Note]) {
        // Sort once, rather than separately for every entry. IDs break equal-timestamp ties.
        for note in notes.filter({ $0.deletedAt == nil }).sorted(by: {
            $0.updatedAt == $1.updatedAt ? $0.id < $1.id : $0.updatedAt > $1.updatedAt
        }) {
            for number in NoteStrongsLinks.references(in: note.content) {
                byNumber[number, default: []].append(note)
            }
        }
    }

    public func notes(citing number: String) -> [Note] {
        guard let id = StrongsId.normalize(number) else { return [] }
        return byNumber[id] ?? []
    }
}
