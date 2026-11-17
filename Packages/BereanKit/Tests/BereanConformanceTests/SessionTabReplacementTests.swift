import Testing
import BereanCore
import BereanWorkspace

struct SessionTabReplacementTests {
    private func space(_ type: TabType) -> SpaceId {
        switch type {
        case .bible: .scripture
        case .note, .pdf, .tags, .settings, .calendar: .notes
        case .lexicon: .lexicon
        case .youtube: .youtube
        case .search, .history: .search
        }
    }

    @Test func everyTypeReplacesEveryDestinationWithStableIdentity() throws {
        for from in TabType.allCases {
            for to in TabType.allCases {
                for pinned in [false, true] {
                    let source = Tab(id: "source", spaceId: space(from), type: from.rawValue, title: "old", isPinned: pinned)
                    let destination = Tab(id: "unused", spaceId: space(to), type: to.rawValue, title: "new", state: JSObject([("unknown", .string("preserved"))]), originTabId: "origin", originSpaceId: .search)
                    let existing = Tab(id: "existing", spaceId: space(to), type: to.rawValue, title: "new", state: destination.state)
                    var session = Session(id: "s", name: "Session", tabs: [space(from): [source]], activeTabId: [space(from): source.id])
                    session.tabs[space(to), default: []].append(existing)
                    let count = session.allTabs.count
                    #expect(session.replaceTabContent(source.id, with: destination) == source)
                    var expected = destination
                    expected.id = source.id
                    expected.isPinned = pinned
                    #expect(session.allTabs.first(where: { $0.id == source.id }) == expected)
                    #expect(session.allTabs.first(where: { $0.id == existing.id }) == existing)
                    #expect(session.allTabs.count == count)
                    #expect(Set(session.allTabs.map(\.id)).count == count)
                    #expect(session.activeTabId[space(to)] == source.id)
                    #expect(session.tabs(in: space(to)).last?.id == (space(from) == space(to) ? existing.id : source.id))
                }
            }
        }
    }

    @Test func repairsOnlyRemovedActiveTabToNearestNeighbor() {
        let a = Tab(id: "a", spaceId: .notes, type: "note", title: "A")
        let b = Tab(id: "b", spaceId: .notes, type: "note", title: "B")
        let c = Tab(id: "c", spaceId: .notes, type: "note", title: "C")
        let target = Tab(id: "target", spaceId: .scripture, type: "bible", title: "Bible")
        for (removed, active, expected) in [("b", "b", "c"), ("c", "c", "b"), ("b", "a", "a")] {
            var session = Session(id: "s", name: "S", tabs: [.notes: [a,b,c]], activeTabId: [.notes: active])
            session.replaceTabContent(removed, with: target)
            #expect(session.activeTabId[.notes] == expected)
        }
        var session = Session(id: "s", name: "S", tabs: [.notes: [a]], activeTabId: [.notes: "a"])
        session.replaceTabContent("a", with: target)
        #expect(session.tabs(in: .notes).isEmpty)
        #expect(session.activeTabId[.notes] == .some(nil))
        let unchanged = session
        #expect(session.replaceTabContent("missing", with: target) == nil)
        #expect(session == unchanged)
    }
}
