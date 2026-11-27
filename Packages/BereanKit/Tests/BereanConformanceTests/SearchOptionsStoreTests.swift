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
}
