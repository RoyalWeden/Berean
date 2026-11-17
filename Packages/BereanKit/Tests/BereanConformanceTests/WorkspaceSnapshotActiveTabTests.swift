import Testing
import BereanWorkspace

struct WorkspaceSnapshotActiveTabTests {
    @Test func restoresFirstTabWhenParsedActiveIsMissingNilOrStale() {
        let first = Tab(id: "first", spaceId: .notes, type: "note", title: "First")
        let second = Tab(id: "second", spaceId: .notes, type: "note", title: "Second")
        let source = Session(id: "source", name: "Study", tabs: [.notes: [first, second]])
        for active in [nil, .some(nil), .some(.some("gone"))] as [String??] {
            var parsed = WorkspaceSnapshot.parse(WorkspaceSnapshot.stateJSON(for: source, displayOrder: nil))
            parsed.activeTabId[.notes] = active
            let restored = parsed.restoreSession(id: "copy", name: "Study", reservedIDs: [first.id]) { "first-copy" }
            #expect(restored.session.tabs(in: .notes).map(\.id) == ["first-copy", second.id])
            #expect(restored.session.activeTabId[.notes] == "first-copy")
            #expect(restored.displayOrder == ["first-copy", second.id])
            #expect((restored.session.activeTabId[.scripture] ?? nil) == nil)
            #expect(restored.session.tabs(in: .scripture).isEmpty)
        }
    }

    @Test func preservesValidActiveChoiceWhenItsIDIsRemapped() {
        let first = Tab(id: "first", spaceId: .notes, type: "note", title: "First")
        let selected = Tab(id: "selected", spaceId: .notes, type: "note", title: "Selected")
        let source = Session(id: "source", name: "Study", tabs: [.notes: [first, selected]], activeTabId: [.notes: selected.id])
        let parsed = WorkspaceSnapshot.parse(WorkspaceSnapshot.stateJSON(for: source, displayOrder: nil))
        let restored = parsed.restoreSession(id: "copy", name: "Study", reservedIDs: [selected.id]) { "selected-copy" }
        #expect(restored.session.tabs(in: .notes).map(\.id) == [first.id, "selected-copy"])
        #expect(restored.session.activeTabId[.notes] == "selected-copy")
        #expect(restored.displayOrder == [first.id, "selected-copy"])
    }
}
