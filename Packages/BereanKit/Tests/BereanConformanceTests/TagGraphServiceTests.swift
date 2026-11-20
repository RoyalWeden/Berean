import Foundation
import Testing
import BereanCore
import BereanSQLite
import BereanStore
import BereanNotes
import BereanWorkspace

@Suite("tag graph service") struct TagGraphServiceTests {
    func setup() throws -> (SQLiteConnection, VerseTagsService, TagGraphService, EventLog) {
        let db = try SQLiteConnection(readWritePath: ":memory:", create: true)
        try db.exec("PRAGMA foreign_keys = ON")
        try Migrator.migrate(db)
        let clock = FakeClock(); clock.t = 1_000
        let ids = FakeClock(); ids.t = 0
        let log = EventLog()
        let tags = VerseTagsService(db: db, now: { clock.t }, uuid: { ids.t += 1; return "t\(ids.t)" }, pick: { _ in 0 })
        let graph = TagGraphService(db: db, tags: tags, now: { clock.t }, uuid: { ids.t += 1; return "e\(ids.t)" },
                                    onChange: { e, id, op in log.items.append(DataChange(entity: e, id: id ?? "", op: op)) })
        return (db, tags, graph, log)
    }

    @Test func edgesCoOccurrenceAndPositions() throws {
        let (_, tags, graph, log) = try setup()
        try tags.create("Sabbath"); try tags.create("Covenant"); try tags.create("Feasts")
        let r = TagRange(bookId: "EXO", chapter: 31, spans: [(13, 17)])
        _ = try tags.addMembers(tagIds: ["t1", "t2"], ranges: [r], label: "Exodus 31:13-17")
        _ = try tags.addMembers(tagIds: ["t3"], ranges: [TagRange(bookId: "EXO", chapter: 31, spans: [(13, 13)])], label: "Exodus 31:13")

        var g = try graph.graph()
        #expect(g.tags.count == 3)
        #expect(g.coOccurrence == [TagCoOccurrence(a: "t1", b: "t2", weight: 5)])   // t3 overlaps only once (< 2)
        #expect(!g.coOccurrenceOmitted)

        guard case .created(let edge) = try graph.createEdge("t1", "t2") else { Issue.record("not created"); return }
        #expect(edge.arrows == .none && edge.note.isEmpty && !edge.dashed)
        #expect(try graph.createEdge("t1", "t2") == .conflict(existing: edge))
        #expect(try graph.createEdge("t1", "t1") == .invalid)
        guard case .created = try graph.createEdge("t2", "t1") else { Issue.record("reverse should be allowed"); return }

        let updated = try graph.updateEdge(edge.id, .init(arrows: .forward, color: .some("#ff0000"), dashed: true, note: "sign"))
        let e = updated?.first { $0.id == edge.id }
        #expect(e?.arrows == .forward && e?.color == "#ff0000" && e?.dashed == true && e?.note == "sign")
        let cleared = try graph.updateEdge(edge.id, .init(color: .some(nil)))
        #expect(cleared?.first { $0.id == edge.id }?.color == nil)
        #expect(cleared?.first { $0.id == edge.id }?.arrows == .forward)   // untouched fields kept
        #expect(try graph.updateEdge("missing", .init(note: "x")) == nil)

        try graph.setTagPosition("t1", x: 12.5, y: -4, pinned: true)
        g = try graph.graph()
        let t1 = g.tags.first { $0.id == "t1" }
        #expect(t1?.graphX == 12.5 && t1?.graphY == -4 && t1?.graphPinned == true)

        #expect(try graph.deleteEdge(edge.id).count == 1)
        #expect(log.items.map(\.entity) == ["tag_edge", "tag_edge", "tag_edge", "tag_edge", "verse_tag", "tag_edge"])

        _ = try tags.merge("t2", into: "t1")   // merging tags must not leave self-edges behind
        #expect(try graph.edges().allSatisfy { $0.source != $0.target })
    }
}

@Suite("tag force layout") struct TagForceLayoutTests {
    func tag(_ id: String, verses: Int = 0, x: Double? = nil, y: Double? = nil, pinned: Bool = false) -> VerseTagSummary {
        VerseTagSummary(id: id, name: id, color: nil, createdAt: 0, colorSlot: 0, graphX: x, graphY: y, graphPinned: pinned,
                        memberCount: 0, verseCount: verses, chapterCount: 0)
    }

    @Test func radiusMatchesOriginalFormula() {
        #expect(TagForceLayout.nodeRadius(verseCount: 0, chapterCount: 0, edgeCount: 0) == 14)
        #expect(TagForceLayout.nodeRadius(verseCount: 4, chapterCount: 0, edgeCount: 1) == 14 + 2.6 * 2 + 3.2)
        #expect(TagForceLayout.nodeRadius(verseCount: 10_000, chapterCount: 0, edgeCount: 0) == 40)
    }

    @Test func seedKeepsSavedPositionsAndSettlesWithoutOverlap() {
        let tags = [tag("a", x: 5, y: 6, pinned: true)] + (0..<12).map { tag("t\($0)", verses: $0 * 3) }
        var nodes = TagForceLayout.seed(tags, edges: [], center: (0, 0))
        #expect(nodes[0] == .init(id: "a", x: 5, y: 6, r: 14, pinned: true))
        var steps = 0
        while TagForceLayout.step(&nodes, edges: [], center: (0, 0), jitter: { 0.25 }) > 0.05 && steps < 2_000 { steps += 1 }
        #expect(nodes[0].x == 5 && nodes[0].y == 6)   // pinned node holds
        for i in nodes.indices { for j in nodes.indices where j > i {
            #expect(hypot(nodes[i].x - nodes[j].x, nodes[i].y - nodes[j].y) >= nodes[i].r + nodes[j].r + 11.9)
        } }
    }
}
