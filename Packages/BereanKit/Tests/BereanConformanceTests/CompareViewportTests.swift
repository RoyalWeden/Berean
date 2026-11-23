import BereanCore
import BereanWorkspace
import Foundation
import Testing

struct CompareViewportTests {
    private func destination(_ chapter: Int = 1) throws -> CompareBookmarkDestination {
        try #require(CompareBookmarkDestination(textID: "lxx", bookID: "JON", chapter: chapter))
    }

    @Test func scrollOnlyChangesLocalStateAndPreservesLegacyColumns() throws {
        let address = try destination()
        let id = UUID()
        let column: JSValue = [
            "textId": "lxx", "bookId": "JON", "chapter": 1,
            CompareViewports.columnIDField: .string(JSString(id.uuidString)),
            "scrollPos": ["verseNum": 4, "frac": 0.25],
            "futureColumnMetadata": true,
        ]
        let original: JSValue = [
            "bookId": "JON", "chapter": 1, "compareColumns": [column],
            "futureStateMetadata": true, "scrollPosition": 55,
        ]
        let state = try #require(original.objectValue)
        let scope = CompareBookmarkScope.independent(.init(id: id, destination: address))
        let anchor = try #require(CompareBookmarkAnchor(verse: 7))
        let result = CompareViewports.updating(state, scope: scope, position: anchor)
        #expect(result["futureStateMetadata"] == true)
        #expect(result["compareColumns"] == [column])
        let before = TabFields.split(type: .bible, state: state)
        let after = TabFields.split(type: .bible, state: result)
        var localWithoutBookmark = after.local
        localWithoutBookmark[CompareViewports.field] = nil
        #expect(localWithoutBookmark == before.local)
        #expect(JSON.stableJSON(.object(after.sync)) == JSON.stableJSON(.object(before.sync)))
        #expect(after.sync["compareColumns"]?.arrayValue?.first?[CompareViewports.columnIDField] == column[CompareViewports.columnIDField])
        #expect(after.local["compareColumns"]?.arrayValue?.first?["scrollPos"] == column["scrollPos"])
        let reloaded = TabFields.merge(type: .bible, sync: after.sync, local: after.local)
        #expect(CompareViewports.position(in: reloaded, scope: scope) == anchor)
    }

    @Test func sameDestinationColumnsStaySeparateAndSharedScopesRequireMatchingConfiguration() throws {
        let address = try destination()
        let nextChapter = try destination(2)
        let a = CompareBookmarkColumn(id: UUID(), destination: address)
        let b = CompareBookmarkColumn(id: UUID(), destination: address)
        let first = try #require(CompareBookmarkAnchor(verse: 3))
        let second = try #require(CompareBookmarkAnchor(verse: 8))
        let stacked = try #require(CompareBookmarkAnchor(verse: 6, columnID: b.id))
        let alignedScope = CompareBookmarkScope.aligned(source: address, columns: [a, b])
        let stackedScope = CompareBookmarkScope.stacked(source: address, columns: [a, b])
        var state = CompareViewports.updating(JSObject(), scope: .independent(a), position: first)
        state = CompareViewports.updating(state, scope: .independent(b), position: second)
        state = CompareViewports.updating(state, scope: alignedScope, position: first)
        state = CompareViewports.updating(state, scope: stackedScope, position: stacked)

        #expect([b, a].map { CompareViewports.position(in: state, scope: .independent($0)) } == [second, first])
        #expect(CompareViewports.position(in: state, scope: .independent(.init(id: a.id, destination: nextChapter))) == nil)
        #expect(CompareViewports.position(in: state, scope: alignedScope) == first)
        #expect(CompareViewports.position(in: state, scope: stackedScope) == stacked)
        #expect(CompareViewports.position(in: state, scope: .aligned(source: address, columns: [b, a])) == nil)
        #expect(CompareViewports.position(in: state, scope: .stacked(source: address, columns: [b])) == nil)
        #expect(CompareViewports.position(in: state, scope: .stacked(source: nextChapter, columns: [a, b])) == nil)
        #expect(CompareViewports.updating(state, scope: .aligned(source: address, columns: [a, a]), position: first) == state)
        #expect(CompareViewports.updating(state, scope: stackedScope, position: first) == state)
        let wrongColumn = try #require(CompareBookmarkAnchor(verse: 6, columnID: UUID()))
        #expect(CompareViewports.updating(state, scope: stackedScope, position: wrongColumn) == state)
    }

    @Test func repairReplacesEveryConflictingIDAndNeverRecoversByIndex() throws {
        let conflict = UUID()
        let unique = UUID()
        var first = JSObject()
        first[CompareViewports.columnIDField] = .string(JSString(conflict.uuidString))
        first["future"] = 42
        var second = first
        second[CompareViewports.columnIDField] = .string(JSString(conflict.uuidString.lowercased()))
        let missing = JSObject()
        var valid = JSObject()
        valid[CompareViewports.columnIDField] = .string(JSString(unique.uuidString))
        var malformed = JSObject()
        malformed[CompareViewports.columnIDField] = false
        let repaired = CompareViewports.repairColumnIDs(in: [first, second, missing, valid, malformed])
        let repairedIDs = repaired.compactMap(CompareViewports.columnID(in:))
        #expect(Set(repairedIDs).count == 5)
        #expect(repairedIDs[3] == unique)
        #expect(!repairedIDs.contains(conflict))
        #expect(repaired[0]["future"] == 42)
        #expect(repaired[1]["future"] == 42)
        #expect(CompareViewports.repairColumnIDs(in: repaired.reversed()) == Array(repaired.reversed()))

        let scope = CompareBookmarkScope.independent(.init(id: conflict, destination: try destination()))
        let anchor = try #require(CompareBookmarkAnchor(verse: 4))
        let saved = CompareViewports.updating(JSObject(), scope: scope, position: anchor)
        for id in [repairedIDs[0], repairedIDs[1], repairedIDs[2], repairedIDs[4]] {
            let newScope = CompareBookmarkScope.independent(.init(id: id, destination: try destination()))
            #expect(CompareViewports.position(in: saved, scope: newScope) == nil)
        }
    }

    @Test func boundsMalformedRecordsAndUnknownMetadata() throws {
        #expect(CompareBookmarkDestination(textID: "", bookID: "JON", chapter: 1) == nil)
        #expect(CompareBookmarkDestination(textID: String(repeating: "a", count: 129), bookID: "JON", chapter: 1) == nil)
        #expect(CompareBookmarkDestination(textID: "lxx", bookID: "JON", chapter: -1) == nil)
        #expect(CompareBookmarkAnchor(verse: -1) == nil)
        #expect(CompareBookmarkAnchor(verse: 1_000_000) == nil)
        let column = CompareBookmarkColumn(id: UUID(), destination: try destination())
        let scope = CompareBookmarkScope.independent(column)
        let anchor = try #require(CompareBookmarkAnchor(verse: 0))
        var state = CompareViewports.updating(JSObject(), scope: scope, position: anchor)
        var entries = try #require(state[CompareViewports.field]?.objectValue)
        let key = try #require(entries.keys.first)
        var record = try #require(entries[key]?.objectValue)
        record["future"] = 42
        for badVerse: JSValue in [.number(.infinity), .number(.nan), 1.5, -1, "0"] {
            record["verse"] = badVerse
            entries[key] = .object(record)
            state[CompareViewports.field] = .object(entries)
            #expect(CompareViewports.position(in: state, scope: scope) == nil)
        }
        let recovered = CompareViewports.updating(state, scope: scope, position: anchor)
        #expect(CompareViewports.position(in: recovered, scope: scope) == anchor)
        #expect(recovered[CompareViewports.field]?.objectValue?[key]?.objectValue?["future"] == 42)
        record["verse"] = 0
        record["columnID"] = "bad"
        entries[key] = .object(record)
        state[CompareViewports.field] = .object(entries)
        #expect(CompareViewports.position(in: state, scope: scope) == nil)
    }

    @Test func recencySurvivesSerializationAndHistoryKeepsCurrentMap() throws {
        let id = UUID()
        let firstScope = CompareBookmarkScope.independent(.init(id: id, destination: try destination(0)))
        let oldestScope = CompareBookmarkScope.independent(.init(id: id, destination: try destination(1)))
        let newestScope = CompareBookmarkScope.independent(.init(id: id, destination: try destination(CompareViewports.capacity)))
        let first = try #require(CompareBookmarkAnchor(verse: 8))
        let recent = try #require(CompareBookmarkAnchor(verse: 41))
        var state = JSObject()
        for chapter in 0..<CompareViewports.capacity {
            let scope = CompareBookmarkScope.independent(.init(id: id, destination: try destination(chapter)))
            state = CompareViewports.updating(state, scope: scope, position: first)
        }
        var oldVisit = state
        oldVisit["chapter"] = 1
        state = CompareViewports.updating(state, scope: firstScope, position: recent)
        state = try #require(JSON.parse(JSON.stableJSON(.object(state))).objectValue)
        state = CompareViewports.updating(state, scope: newestScope, position: recent)
        let restored = CompareViewports.merging(current: state, into: oldVisit)
        #expect(restored["chapter"] == 1)
        #expect(restored[CompareViewports.field]?.objectValue?.count == CompareViewports.capacity)
        #expect(CompareViewports.position(in: restored, scope: firstScope) == recent)
        #expect(CompareViewports.position(in: restored, scope: newestScope) == recent)
        #expect(CompareViewports.position(in: restored, scope: oldestScope) == nil)
        #expect(CompareViewports.merging(current: JSObject(), into: oldVisit)[CompareViewports.field] == nil)
        let removed = CompareViewports.updating(restored, scope: firstScope, position: nil)
        #expect(CompareViewports.position(in: removed, scope: firstScope) == nil)
        #expect(CompareViewports.position(in: removed, scope: newestScope) == recent)
    }
}
