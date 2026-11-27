import BereanCore
import BereanWorkspace
import Testing

/// CC-09: native Search options survive the query-only sync/local split via the local `filters` bag.
struct SearchOptionsStoreTests {
    private func state(_ value: JSValue) throws -> JSObject { try #require(value.objectValue) }

    @Test func optionsSurviveTheColdLaunchSplitAndKeepLegacyFilterSiblings() throws {
        let warm = try state(["query": "voice of joy", "sort": "relevanceLast", "grouping": "book",
                              "scopeTexts": ["kjva", "lxx"], "wordMode": "phrase", "testament": "OT",
                              "bookIds": ["ISA"], "tagFilter": ["t1"], "tagFilterAll": true,
                              "nativeSearchFocusText": "lxx",
                              "filters": ["textId": "lxx", "future": ["nested": true]]])
        let captured = SearchOptionsStore.capturing(warm)
        let split = TabFields.split(type: .search, state: captured)
        #expect(split.sync == TabFields.split(type: .search, state: warm).sync)   // sync allowlist untouched
        #expect(split.local["filters"]?["future"] == ["nested": true])
        #expect(split.local["filters"]?["textId"] == "lxx")
        let local = try state(try JSON.parse(JSON.stableJSON(.object(split.local))))
        let cold = TabFields.merge(type: .search, sync: split.sync, local: local)
        #expect(cold["sort"] == nil)                                            // dropped without the store
        let restored = SearchOptionsStore.restoring(cold)
        for key in SearchOptionsStore.keys { #expect(restored[JSString(key)] == warm[JSString(key)], "\(key)") }
        #expect(SearchViewports.configuration(in: restored) == SearchViewports.configuration(in: warm))
    }

    @Test func resetRemovesStaleValuesAndWarmKeysWin() throws {
        let saved = SearchOptionsStore.capturing(try state(["query": "q", "sort": "bookOrderReverse", "filters": ["keep": 1]]))
        var reset = saved
        for key in SearchOptionsStore.keys { reset[JSString(key)] = nil }
        let cleared = SearchOptionsStore.capturing(reset)
        #expect(SearchOptionsStore.saved(in: cleared) == nil)
        #expect(cleared["filters"] == ["keep": 1])
        #expect(SearchOptionsStore.restoring(cleared)["sort"] == nil)
        var warm = saved
        warm["sort"] = "relevance"
        #expect(SearchOptionsStore.restoring(warm)["sort"] == "relevance")
    }

    @Test func malformedOrForeignFiltersAreNeverOverwritten() throws {
        let malformed = try state(["query": "q", "sort": "relevance", "filters": "legacy-malformed"])
        #expect(SearchOptionsStore.capturing(malformed) == malformed)
        let unversioned = try state(["query": "q", "filters": ["$nativeSearchOptions": ["sort": "relevance"]]])
        #expect(SearchOptionsStore.saved(in: unversioned) == nil)
        #expect(SearchOptionsStore.restoring(unversioned) == unversioned)
        let empty = try state(["query": "q"])
        #expect(SearchOptionsStore.capturing(empty) == empty)
    }
    @Test func sessionHydratesBeforeFirstRequestWithoutChangingTheSavedVisit() throws {
        var warm = try state(["query": "voice of joy", "sort": "relevanceLast", "grouping": "book", "filters": ["future": 1]])
        let configuration = SearchViewports.configuration(in: warm)
        let context = SearchViewports.fingerprint("result context")
        let visit = try #require(SearchViewportVisit(configuration: configuration, context: context, row: "ISA.1.1", alignment: .center))
        warm = SearchViewports.installing(SearchViewports.settingActive(visit, in: JSObject()), in: warm)
        let split = TabFields.split(type: .search, state: SearchOptionsStore.capturing(warm))
        let cold = TabFields.merge(type: .search, sync: split.sync, local: split.local)
        let search = Tab(id: "search", spaceId: .scripture, type: "search", title: "Search", state: cold)
        let other = Tab(id: "note", spaceId: .notes, type: "note", title: "Note", state: cold)
        let session = Session(id: "session", name: "Study", tabs: [.scripture: [search], .notes: [other]], activeTabId: [.scripture: "search"])
        let hydrated = SearchOptionsStore.restoring(in: session)
        let initial = try #require(hydrated.tabs[.scripture]?.first?.state)
        #expect(SearchViewports.configuration(in: initial) == configuration)
        #expect(SearchViewports.active(in: try #require(SearchViewports.record(in: initial))) == visit)
        #expect(hydrated.tabs[.notes] == [other])
        #expect(hydrated.activeTabId == session.activeTabId)
        #expect(initial["filters"]?["future"] == 1)
        var reset = initial
        for key in SearchOptionsStore.keys { reset[JSString(key)] = nil }
        let capturedReset = SearchOptionsStore.capturing(reset)
        let resetSplit = TabFields.split(type: .search, state: capturedReset)
        #expect(SearchOptionsStore.saved(in: TabFields.merge(type: .search, sync: resetSplit.sync, local: resetSplit.local)) == nil)
    }

}
