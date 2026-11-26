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

    @Test func independentPrecisionRoundTripsLocallyAndClearsOnSemanticUpdate() throws {
        let address = try destination()
        let a = CompareBookmarkColumn(id: UUID(), destination: address)
        let b = CompareBookmarkColumn(id: UUID(), destination: address)
        let scope = CompareBookmarkScope.independent(a)
        let layout = String(repeating: "a", count: 64)
        let precision = try #require(CompareBookmarkPrecision(crop: 23.5, rowHeight: 72, layout: layout))
        let anchor = try #require(CompareBookmarkAnchor(verse: 7, precision: precision))
        let saved = CompareViewports.updating(JSObject(), scope: scope, position: anchor)
        let split = TabFields.split(type: .bible, state: saved)
        #expect(split.sync[CompareViewports.field] == nil)
        let local = try #require(try JSON.parse(JSON.stableJSON(.object(split.local))).objectValue)
        let reloaded = TabFields.merge(type: .bible, sync: split.sync, local: local)
        #expect(CompareViewports.position(in: reloaded, scope: scope) == anchor)
        #expect(CompareViewports.position(in: reloaded, scope: .independent(b)) == nil)

        #expect(!JSON.stableJSON(.object(saved)).contains("\"sharedPrecision\""))

        let semantic = try #require(CompareBookmarkAnchor(verse: 7))
        let cleared = CompareViewports.updating(reloaded, scope: scope, position: semantic)
        #expect(CompareViewports.position(in: cleared, scope: scope) == semantic)
        #expect(!JSON.stableJSON(.object(cleared)).contains("\"precision\""))
    }

    @Test func independentHistoryVisitKeepsItsOwnCropAndCanBeEmpty() throws {
        let layout = String(repeating: "a", count: 64)
        let oldCrop = try #require(CompareBookmarkPrecision(crop: 5, rowHeight: 72, layout: layout))
        let newCrop = try #require(CompareBookmarkPrecision(crop: 40, rowHeight: 72, layout: layout))
        let earlier = try #require(CompareBookmarkAnchor(verse: 7, precision: oldCrop))
        let latest = try #require(CompareBookmarkAnchor(verse: 7, precision: newCrop))
        let arrival = try #require(CompareBookmarkAnchor(verse: 8))
        let fallback = try #require(CompareBookmarkAnchor(verse: 1))

        #expect(CompareViewports.independentPosition(visit: .history(earlier), arrival: arrival,
                                                    durable: latest, fallback: fallback) == earlier)
        #expect(CompareViewports.independentPosition(visit: .history(nil), arrival: arrival,
                                                    durable: latest, fallback: fallback) == nil)
        #expect(CompareViewports.independentPosition(visit: .ordinary, arrival: arrival,
                                                    durable: latest, fallback: fallback) == arrival)
        #expect(CompareViewports.independentPosition(visit: .ordinary, arrival: nil,
                                                    durable: latest, fallback: fallback) == latest)
    }

    @Test func stagedActiveVisitSurvivesSaveBeforeLayoutAndKeepsItsUnmovedPeer() throws {
        let address = try destination()
        let left = CompareBookmarkColumn(id: UUID(), destination: address)
        let right = CompareBookmarkColumn(id: UUID(), destination: address)
        let context = try #require(CompareActiveVisitContext(source: address, columns: [left, right], syncScrolling: false))
        let layout = String(repeating: "d", count: 64)
        let crop = try #require(CompareBookmarkPrecision(crop: 33, rowHeight: 70, layout: layout))
        let older = try #require(CompareBookmarkAnchor(verse: 6, precision: crop))
        let latest = try #require(CompareBookmarkAnchor(verse: 19))
        let otherPane = try #require(CompareBookmarkAnchor(verse: 9, precision: crop))

        let position = CompareViewports.updating(JSObject(), scope: .independent(left), position: latest)
        let staged = CompareViewports.settingActiveVisit(in: position, context: context, anchors: [left: older, right: otherPane])
        let split = TabFields.split(type: .bible, state: staged)
        #expect(split.sync[CompareViewports.field] == nil)
        let local = try #require(try JSON.parse(JSON.stableJSON(.object(split.local))).objectValue)
        let reloaded = TabFields.merge(type: .bible, sync: split.sync, local: local)
        let panes = try #require(CompareViewports.activeVisit(in: reloaded, context: context))
        #expect(panes == [left: older, right: otherPane])
        #expect(CompareViewports.position(in: reloaded, scope: .independent(left)) == latest)
        #expect(CompareViewports.independentPosition(visit: .active(panes[left]), arrival: nil,
                                                    durable: latest, fallback: nil) == older)

        let explicitJump = try #require(CompareBookmarkAnchor(verse: 24))
        let afterJump = CompareViewports.updatingActiveVisit(in: reloaded, context: context, anchors: [left: explicitJump])
        let jumpedPanes = try #require(CompareViewports.activeVisit(in: afterJump, context: context))
        #expect(jumpedPanes == [left: explicitJump, right: otherPane])
        #expect(CompareViewports.independentPosition(visit: .active(jumpedPanes[left]), arrival: nil,
                                                    durable: latest, fallback: nil) == explicitJump)
        #expect(CompareViewports.position(in: afterJump, scope: .independent(left)) == latest)
    }

    @Test func activeVisitDistinguishesEmptyFromAbsentAndRejectsIncompatibleSettings() throws {
        let address = try destination()
        let another = try destination(2)
        let left = CompareBookmarkColumn(id: UUID(), destination: address)
        let right = CompareBookmarkColumn(id: UUID(), destination: address)
        let replacement = CompareBookmarkColumn(id: UUID(), destination: address)
        let moved = CompareBookmarkColumn(id: left.id, destination: another)
        let anchor = try #require(CompareBookmarkAnchor(verse: 15))
        let context = try #require(CompareActiveVisitContext(source: address, columns: [left, right], syncScrolling: false))
        let state = CompareViewports.updating(JSObject(), scope: .independent(left), position: anchor)
        let empty = CompareViewports.settingActiveVisit(in: state, context: context, anchors: [:])
        #expect(CompareViewports.activeVisit(in: state, context: context) == nil)
        #expect(CompareViewports.activeVisit(in: empty, context: context)?.isEmpty == true)
        #expect(CompareViewports.independentPosition(visit: .active(nil), arrival: nil, durable: anchor, fallback: anchor) == nil)
        #expect(CompareViewports.independentPosition(visit: .active(nil), arrival: anchor, durable: nil, fallback: nil) == anchor)
        #expect(CompareViewports.independentPosition(visit: .history(nil), arrival: anchor, durable: nil, fallback: nil) == nil)
        #expect(CompareViewports.clearingActiveVisit(in: empty) == state)

        let mismatches = [
            CompareActiveVisitContext(source: another, columns: [left, right], syncScrolling: false),
            CompareActiveVisitContext(source: address, columns: [left, right], syncScrolling: true),
            CompareActiveVisitContext(source: address, columns: [left, right], syncScrolling: false, pinnedColumnIDs: [left.id]),
            CompareActiveVisitContext(source: address, columns: [right, left], syncScrolling: false),
            CompareActiveVisitContext(source: address, columns: [replacement, right], syncScrolling: false),
            CompareActiveVisitContext(source: address, columns: [moved, right], syncScrolling: false),
        ]
        for candidate in mismatches {
            let candidate = try #require(candidate)
            #expect(CompareViewports.activeVisit(in: empty, context: candidate) == nil)
        }
        #expect(CompareActiveVisitContext(source: address, columns: [left, left], syncScrolling: false) == nil)
    }

    @Test func sharedHistoryStagesOlderAndEmptyVisitsWithoutRewindingLatestBookmarks() throws {
        let source = try destination()
        let pinned = CompareBookmarkColumn(id: UUID(), destination: try destination(2))
        let following = CompareBookmarkColumn(id: UUID(), destination: source)
        for layout in [CompareActiveVisitContext.Layout.aligned, .stacked] {
            let pins: Set<UUID> = layout == .stacked ? [pinned.id] : []
            let columns = layout == .stacked ? [following, pinned] : [following]
            let context = try #require(CompareActiveVisitContext(source: source, columns: columns, syncScrolling: true,
                                                                 pinnedColumnIDs: pins, layout: layout))
            let scope = try #require(context.sharedBookmarkScope)
            let columnID = layout == .stacked ? pinned.id : nil
            let old = try #require(CompareBookmarkAnchor(verse: 4, columnID: columnID))
            let latest = try #require(CompareBookmarkAnchor(verse: 12, columnID: columnID))
            let historical = CompareViewports.updating(JSObject([("futureState", true)]), scope: scope, position: old)
            let current = CompareViewports.updating(historical, scope: scope, position: latest)
            let merged = CompareViewports.merging(current: current, into: historical)
            for visit in [CompareViewports.SharedVisit.position(old), .empty] {
                let staged = CompareViewports.settingSharedActiveVisit(in: merged, context: context, visit: visit)
                let fields = TabFields.split(type: .bible, state: staged)
                let local = try #require(try JSON.parse(JSON.stableJSON(.object(fields.local))).objectValue)
                let reopened = TabFields.merge(type: .bible, sync: fields.sync, local: local)
                #expect(fields.sync == TabFields.split(type: .bible, state: current).sync)
                let active = CompareViewports.sharedActiveVisit(in: reopened, context: context)
                #expect(active == visit)
                #expect(CompareViewports.position(in: reopened, scope: scope) == latest)
                #expect(CompareViewports.sharedActiveVisit(in: CompareViewports.clearingActiveVisit(in: reopened),
                                                           context: context) == nil)
            }
        }
    }

    @Test func sharedCropRestoresCompatibleOlderVisitWithoutChangingLatestOrLegacyRow() throws {
        let source = try destination()
        let pinned = CompareBookmarkColumn(id: UUID(), destination: try destination(2))
        let following = CompareBookmarkColumn(id: UUID(), destination: source)
        let fingerprint = String(repeating: "a", count: 64)
        let reflow = String(repeating: "b", count: 64)
        let previousCrop = try #require(CompareBookmarkPrecision(crop: 21.5, rowHeight: 153, layout: fingerprint))
        let newerCrop = try #require(CompareBookmarkPrecision(crop: 99, rowHeight: 153, layout: fingerprint))

        for layout in [CompareActiveVisitContext.Layout.aligned, .stacked] {
            let columns = layout == .stacked ? [following, pinned] : [following]
            let pins: Set<UUID> = layout == .stacked ? [pinned.id] : []
            let context = try #require(CompareActiveVisitContext(source: source, columns: columns, syncScrolling: true,
                                                                 pinnedColumnIDs: pins, layout: layout))
            let scope = try #require(context.sharedBookmarkScope)
            let columnID = layout == .stacked ? pinned.id : nil
            let older = try #require(CompareBookmarkAnchor(verse: 3, columnID: columnID, precision: previousCrop))
            let newer = try #require(CompareBookmarkAnchor(verse: 3, columnID: columnID, precision: newerCrop))
            let semantic = try #require(CompareBookmarkAnchor(verse: 3, columnID: columnID))

            let latest = CompareViewports.updating(JSObject(), scope: scope, position: newer)
            let staged = CompareViewports.settingSharedActiveVisit(in: latest, context: context, visit: .position(older))
            let split = TabFields.split(type: .bible, state: staged)
            #expect(split.sync[CompareViewports.field] == nil)
            let local = try #require(try JSON.parse(JSON.stableJSON(.object(split.local))).objectValue)
            let reloaded = TabFields.merge(type: .bible, sync: split.sync, local: local)
            let visit = try #require(CompareViewports.sharedActiveVisit(in: reloaded, context: context))
            guard case .position(let anchor) = visit else { Issue.record("Expected saved shared row"); continue }
            #expect(anchor == older)
            #expect(anchor.precision?.correction(layout: fingerprint, rowHeight: 153, currentCrop: 0.5) == 21)
            #expect(anchor.precision?.correction(layout: reflow, rowHeight: 153, currentCrop: 0.5) == nil)
            #expect(anchor.precision?.correction(layout: fingerprint, rowHeight: 160, currentCrop: 0.5) == nil)
            #expect(CompareViewports.position(in: reloaded, scope: scope) == newer)

            var positions = try #require(reloaded[CompareViewports.field]?.objectValue)
            var active = try #require(positions["$activeVisit"]?.objectValue)
            var stored = try #require(active["anchor"]?.objectValue)
            #expect(stored["precision"] == nil)
            #expect(stored["sharedPrecision"] != nil)
            stored["sharedPrecision"] = ["crop": 1000, "rowHeight": 153, "layout": .string(JSString(fingerprint))]
            active["anchor"] = .object(stored)
            positions["$activeVisit"] = .object(active)
            var malformed = reloaded
            malformed[CompareViewports.field] = .object(positions)
            #expect(CompareViewports.sharedActiveVisit(in: malformed, context: context) == .position(semantic))
            #expect(CompareViewports.position(in: malformed, scope: scope) == newer)
            let cleared = CompareViewports.updating(reloaded, scope: scope, position: semantic)
            #expect(CompareViewports.position(in: cleared, scope: scope) == semantic)
        }
    }

    @Test func sharedActiveVisitRequiresCurrentModeAndCompleteConfigurationEvenWithinSameLayout() throws {
        let source = try destination()
        let other = try destination(2)
        let first = CompareBookmarkColumn(id: UUID(), destination: source)
        let second = CompareBookmarkColumn(id: UUID(), destination: source)
        let moved = CompareBookmarkColumn(id: second.id, destination: other)
        let context = try #require(CompareActiveVisitContext(source: source, columns: [first, second], syncScrolling: false,
                                                             pinnedColumnIDs: [second.id], layout: .stacked))
        let old = try #require(CompareBookmarkAnchor(verse: 8, columnID: second.id))
        let state = CompareViewports.settingSharedActiveVisit(in: JSObject(), context: context, visit: .position(old))
        for mismatch in [
            CompareActiveVisitContext(source: source, columns: [first, second], syncScrolling: false, pinnedColumnIDs: [second.id]),
            CompareActiveVisitContext(source: source, columns: [first, second], syncScrolling: false, pinnedColumnIDs: [second.id], layout: .aligned),
            CompareActiveVisitContext(source: source, columns: [first, second], syncScrolling: true, pinnedColumnIDs: [second.id], layout: .stacked),
            CompareActiveVisitContext(source: source, columns: [first, second], syncScrolling: false, layout: .stacked),
            CompareActiveVisitContext(source: source, columns: [second, first], syncScrolling: false, pinnedColumnIDs: [second.id], layout: .stacked),
            CompareActiveVisitContext(source: source, columns: [first, moved], syncScrolling: false, pinnedColumnIDs: [second.id], layout: .stacked),
            CompareActiveVisitContext(source: other, columns: [first, second], syncScrolling: false, pinnedColumnIDs: [second.id], layout: .stacked),
        ] {
            let mismatch = try #require(mismatch)
            #expect(CompareViewports.sharedActiveVisit(in: state, context: mismatch) == nil)
        }
        let wrong = try #require(CompareBookmarkAnchor(verse: 8, columnID: UUID()))
        #expect(CompareViewports.settingSharedActiveVisit(in: state, context: context, visit: .position(wrong)) == state)
        let refreshed = try #require(CompareActiveVisitContext(source: source, columns: [second, first], syncScrolling: false,
                                                               pinnedColumnIDs: [second.id], layout: .stacked))
        let afterFreshScroll = CompareViewports.settingSharedActiveVisit(in: state, context: refreshed, visit: .position(old))
        #expect(CompareViewports.sharedActiveVisit(in: afterFreshScroll, context: context) == nil)
        #expect(CompareViewports.sharedActiveVisit(in: afterFreshScroll, context: refreshed) == .position(old))
    }

    @Test func stackedJumpStaysASourceRequestUntilRowsResolveAndKeepsTheLatestDestination() throws {
        let source = try destination()
        let following = CompareBookmarkColumn(id: UUID(), destination: source)
        let pinned = CompareBookmarkColumn(id: UUID(), destination: try destination(2))
        let context = try #require(CompareActiveVisitContext(source: source, columns: [following, pinned], syncScrolling: false,
                                                             pinnedColumnIDs: [pinned.id], layout: .stacked))
        let scope = try #require(context.sharedBookmarkScope)
        let old = try #require(CompareBookmarkAnchor(verse: 9, columnID: pinned.id))
        let latest = try #require(CompareBookmarkAnchor(verse: 18, columnID: pinned.id))
        let resolved = try #require(CompareBookmarkAnchor(verse: 5, columnID: following.id))
        let durable = CompareViewports.updating(JSObject(), scope: scope, position: latest)
        let active = CompareViewports.settingSharedActiveVisit(in: durable, context: context, visit: .position(old))
        let unidentified = try #require(CompareActiveVisitContext(source: source, columns: [following, pinned], syncScrolling: false,
                                                                  pinnedColumnIDs: [pinned.id]))
        let staged = CompareViewports.settingPendingSourceJump(in: active, context: unidentified, verse: 6)
        let reopened = try #require(try JSON.parse(JSON.stableJSON(.object(staged))).objectValue)
        #expect(CompareViewports.sharedActiveVisit(in: reopened, context: context) == .position(old))
        #expect(CompareViewports.activeVisit(in: reopened, context: unidentified) == nil)
        #expect(CompareViewports.pendingSourceJump(in: reopened, context: context, selectedVerse: 6) == 6)
        #expect(CompareViewports.pendingSourceJump(in: reopened, context: context, selectedVerse: 7) == nil)
        let changed = try #require(CompareActiveVisitContext(source: source, columns: [pinned, following], syncScrolling: false,
                                                             pinnedColumnIDs: [pinned.id], layout: .stacked))
        #expect(CompareViewports.pendingSourceJump(in: reopened, context: changed, selectedVerse: 6) == nil)
        let cleared = CompareViewports.clearingPendingSourceJump(in: reopened)
        #expect(CompareViewports.pendingSourceJump(in: cleared, context: context, selectedVerse: 6) == nil)
        #expect(CompareViewports.sharedActiveVisit(in: cleared, context: context) == .position(old))
        let placed = CompareViewports.settingSharedActiveVisit(in: cleared, context: context, visit: .position(resolved))
        #expect(CompareViewports.sharedActiveVisit(in: placed, context: context) == .position(resolved))
        #expect(CompareViewports.position(in: placed, scope: scope) == latest)
    }

    @Test func activeVisitDoesNotConsumeDestinationCapacityOrResurrectEvictedPositions() throws {
        let address = try destination()
        let left = CompareBookmarkColumn(id: UUID(), destination: address)
        let context = try #require(CompareActiveVisitContext(source: address, columns: [left], syncScrolling: false))
        let old = try #require(CompareBookmarkAnchor(verse: 3))
        let latest = try #require(CompareBookmarkAnchor(verse: 21))
        let history = CompareViewports.settingActiveVisit(in: JSObject(), context: context, anchors: [left: old])
        let historicalState = CompareViewports.updating(history, scope: .independent(left), position: old)

        var current = historicalState
        var currentScopes: [CompareBookmarkScope] = []
        for _ in 1...CompareViewports.capacity {
            let scope = CompareBookmarkScope.independent(.init(id: UUID(), destination: address))
            currentScopes.append(scope)
            current = CompareViewports.updating(current, scope: scope, position: latest)
        }
        let merged = CompareViewports.merging(current: current, into: historicalState)
        #expect(CompareViewports.activeVisit(in: merged, context: context) == [left: old])
        #expect(CompareViewports.position(in: merged, scope: .independent(left)) == nil)
        #expect(currentScopes.allSatisfy { CompareViewports.position(in: merged, scope: $0) == latest })
        let cleared = CompareViewports.clearingActiveVisit(in: merged)
        let reopening = CompareViewports.merging(current: cleared, into: historicalState)
        #expect(!CompareViewports.hasActiveVisit(in: reopening))
        #expect(currentScopes.allSatisfy { CompareViewports.position(in: reopening, scope: $0) == latest })
    }

    @Test func malformedPrecisionRetainsSemanticAnchorAndReflowDiscardsCrop() throws {
        let address = try destination()
        let scope = CompareBookmarkScope.independent(.init(id: UUID(), destination: address))
        let layout = String(repeating: "b", count: 64)
        let precision = try #require(CompareBookmarkPrecision(crop: -12, rowHeight: 80, layout: layout))
        #expect(precision.correction(layout: layout, rowHeight: 80.25, currentCrop: 20) == -32)
        #expect(precision.correction(layout: layout, rowHeight: 82, currentCrop: 20) == nil)
        #expect(precision.correction(layout: String(repeating: "c", count: 64), rowHeight: 80, currentCrop: 20) == nil)
        #expect(precision.correction(layout: layout, rowHeight: 80, currentCrop: .infinity) == nil)
        #expect(CompareBookmarkPrecision(crop: .nan, rowHeight: 80, layout: layout) == nil)
        #expect(CompareBookmarkPrecision(crop: 81, rowHeight: 80, layout: layout) == nil)
        #expect(CompareBookmarkPrecision(crop: 20, rowHeight: .infinity, layout: layout) == nil)

        let source = try #require(CompareBookmarkAnchor(verse: 5, precision: precision))
        var saved = CompareViewports.updating(JSObject(), scope: scope, position: source)
        var records = try #require(saved[CompareViewports.field]?.objectValue)
        let entry = try #require(records.entries.first)
        var record = try #require(entry.value.objectValue)
        record["precision"] = ["crop": 200, "rowHeight": 80, "layout": "malformed"]
        records[entry.key] = .object(record)
        saved[CompareViewports.field] = .object(records)
        #expect(CompareViewports.position(in: saved, scope: scope) == CompareBookmarkAnchor(verse: 5))
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
