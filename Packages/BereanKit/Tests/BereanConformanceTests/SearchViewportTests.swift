import BereanCore
import BereanWorkspace
import Testing

struct SearchViewportTests {
    private func visit(_ state: JSObject, context: String, row: String?) throws -> SearchViewportVisit {
        try #require(SearchViewportVisit(configuration: SearchViewports.configuration(in: state),
                                         context: SearchViewports.fingerprint(.string(JSString(context))), row: row))
    }

    @Test func viewportRoundTripsAsLocalOpaqueFiltersAndPreservesLegacySiblings() throws {
        let original = try #require((["query": "voice of joy", "scrollTop": 124,
            "filters": ["textId": "lxx", "future": ["nested": true]], "results": []] as JSValue).objectValue)
        let saved = try visit(original, context: "lxx/phrase", row: "lxx|JER|33|11")
        let record = SearchViewports.updating(JSObject(), visit: saved)
        let updated = SearchViewports.installing(record, in: original)
        let previous = TabFields.split(type: .search, state: original)
        let split = TabFields.split(type: .search, state: updated)
        #expect(split.sync == previous.sync)
        #expect(split.local["filters"]?["future"] == previous.local["filters"]?["future"])
        #expect(split.local["filters"]?["textId"] == "lxx")
        #expect(split.local["scrollTop"] == 124)
        #expect(split.local["results"] == [])
        let local = try #require(try JSON.parse(JSON.stableJSON(.object(split.local))).objectValue)
        let reopened = TabFields.merge(type: .search, sync: split.sync, local: local)
        let reopenedRecord = try #require(SearchViewports.record(in: reopened))
        let context = try #require(saved.context)
        #expect(SearchViewports.destination(in: reopenedRecord, context: context) == saved.row)

        var unexpected = original
        unexpected["filters"] = "legacy-malformed"
        #expect(SearchViewports.installing(record, in: unexpected) == unexpected)
    }

    @Test func activeHistoryReopensTheOlderOrEmptyVisitAndKeepsTheLatestDestination() throws {
        let state = JSObject()
        let earlier = try visit(state, context: "current", row: "lxx|JER|33|11")
        let latest = try visit(state, context: "current", row: "kjva|REV|21|4")
        let context = try #require(latest.context)
        let record = SearchViewports.updating(JSObject(), visit: latest)
        let selected = SearchViewports.settingActive(earlier, in: record)
        #expect(SearchViewports.restoration(in: selected, configuration: latest.configuration, context: context)?.row == earlier.row)
        #expect(SearchViewports.destination(in: selected, context: context) == latest.row)
        let empty = try #require(SearchViewportVisit(configuration: latest.configuration, context: nil, row: nil))
        let emptyState = SearchViewports.installing(SearchViewports.settingActive(empty, in: record), in: state)
        let local = try #require(try JSON.parse(JSON.stableJSON(.object(emptyState))).objectValue)
        let emptyRecord = try #require(SearchViewports.record(in: local))
        #expect(SearchViewports.active(in: emptyRecord) == empty)
        #expect(SearchViewports.restoration(in: emptyRecord, configuration: latest.configuration, context: context) == nil)
        #expect(SearchViewports.restoration(in: SearchViewports.settingActive(nil, in: emptyRecord),
                                            configuration: latest.configuration, context: context)?.row == latest.row)

        let changed = try visit(state, context: "other result rendering", row: "kjva|JER|33|11")
        let changedContext = try #require(changed.context)
        #expect(SearchViewports.restoration(in: selected, configuration: changed.configuration, context: changedContext) == nil)
    }

    @Test func centeredReturnRoundTripsSeparatelyFromManualTopPosition() throws {
        let state = JSObject()
        let manual = try visit(state, context: "results", row: "kjva|JHN|3|29")
        let context = try #require(manual.context)
        let centered = try #require(SearchViewportVisit(configuration: manual.configuration, context: context,
                                                         row: manual.row, alignment: .center))
        let latest = SearchViewports.updating(JSObject(), visit: manual)
        let staged = SearchViewports.settingActive(centered, in: latest)
        let loaded = try #require(try JSON.parse(JSON.stableJSON(.object(staged))).objectValue)
        #expect(SearchViewports.restoration(in: loaded, configuration: manual.configuration, context: context) == centered)
        #expect(SearchViewports.destination(in: loaded, context: context) == manual.row)
        let anotherContext = SearchViewports.fingerprint("other")
        #expect(SearchViewports.restoration(in: loaded, configuration: manual.configuration, context: anotherContext) == nil)

        let newer = try visit(state, context: "results", row: "kjva|JHN|3|26")
        let scrolled = SearchViewports.updating(loaded, visit: newer)
        #expect(SearchViewports.restoration(in: scrolled, configuration: manual.configuration, context: context) == newer)
        #expect(SearchViewports.destination(in: scrolled, context: context) == newer.row)

        var malformed = loaded
        var value = try #require(malformed["active"]?.objectValue)
        value["alignment"] = ["unexpected", "array"]
        malformed["active"] = .object(value)
        #expect(SearchViewports.restoration(in: malformed, configuration: manual.configuration, context: context) == manual)
    }

    @Test func scrollingToStartClearsOnlyThatDestinationAndPreservesOlderCenteredVisit() throws {
        let state = JSObject()
        let firstRow = try visit(state, context: "current", row: "kjva|1CH|15|16")
        let alternate = try visit(state, context: "other", row: "kjva|JHN|3|1")
        let start = try visit(state, context: "current", row: nil)
        let context = try #require(firstRow.context)
        let alternateContext = try #require(alternate.context)
        let centered = try #require(SearchViewportVisit(configuration: firstRow.configuration, context: context,
                                                         row: "kjva|JHN|3|29", alignment: .center))
        var record = SearchViewports.updating(JSObject(), visit: firstRow)
        record = SearchViewports.updating(record, visit: alternate)
        record = SearchViewports.settingActive(centered, in: record)
        let older = SearchViewports.active(in: record)
        let moved = SearchViewports.updating(record, visit: start)
        #expect(SearchViewports.active(in: moved) == start)
        #expect(SearchViewports.destination(in: moved, context: context) == nil)
        #expect(SearchViewports.destination(in: moved, context: alternateContext) == alternate.row)
        #expect(SearchViewports.restoration(in: moved, configuration: start.configuration, context: context) == nil)
        let back = SearchViewports.settingActive(older, in: moved)
        #expect(SearchViewports.restoration(in: back, configuration: start.configuration, context: context) == centered)
        #expect(SearchViewports.destination(in: back, context: context) == nil)
    }

    @Test func contextKeysAreCanonicalAndDestinationsStayBounded() throws {
        var a = JSObject()
        a["query"] = "words"
        a["grouping"] = "book"
        var b = JSObject()
        b["grouping"] = "book"
        b["query"] = "words"
        #expect(SearchViewports.configuration(in: a) == SearchViewports.configuration(in: b))
        b["grouping"] = "text"
        #expect(SearchViewports.configuration(in: a) != SearchViewports.configuration(in: b))
        #expect(SearchViewports.fingerprint(["x|y", "z"]) != SearchViewports.fingerprint(["x", "y|z"]))

        let old = try visit(a, context: "old", row: "lxx|GEN|1|2")
        let oldContext = try #require(old.context)
        var record = SearchViewports.settingActive(old, in: SearchViewports.updating(JSObject(), visit: old))
        for index in 0..<SearchViewports.capacity {
            let next = try visit(a, context: "context \(index)", row: "lxx|GEN|1|\(index)")
            record = SearchViewports.updating(record, visit: next)
        }
        #expect(record["positions"]?.arrayValue?.count == SearchViewports.capacity)
        #expect(SearchViewports.destination(in: record, context: oldContext) == nil)
        #expect(SearchViewportVisit(configuration: "bad", context: oldContext, row: old.row) == nil)
        #expect(SearchViewportVisit(configuration: old.configuration, context: oldContext, row: "\n") == nil)
        #expect(SearchViewportVisit(configuration: old.configuration, context: nil, row: old.row) == nil)
    }
}
