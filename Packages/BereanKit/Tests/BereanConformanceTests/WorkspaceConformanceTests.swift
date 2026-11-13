import Testing
import BereanCore
import BereanSQLite
import BereanStore
import BereanWorkspace

func rowsJSON(_ rows: [SQLiteRow]) -> JSValue {
    .array(rows.map { r in
        var o = JSObject()
        for (i, c) in r.columns.enumerated() {
            switch r.values[i] {
            case .null: o[JSString(c)] = .null
            case .integer(let x): o[JSString(c)] = .number(Double(x))
            case .real(let d): o[JSString(c)] = .number(d)
            case .text(let s): o[JSString(c)] = .string(JSString(s))
            case .blob: o[JSString(c)] = .null
            }
        }
        return .object(o)
    })
}
func tabFromJSON(_ o: JSObject) -> Tab {
    Tab(id: o["id"]!.str, spaceId: SpaceId(rawValue: o["spaceId"]!.str)!, type: o["type"]!.str, title: o["title"]?.str ?? "", state: o["state"]?.objectValue ?? JSObject(),
        isPinned: o["isPinned"]?.boolValue ?? false, originTabId: o["originTabId"]?.optionalString, originSpaceId: o["originSpaceId"]?.optionalString.flatMap(SpaceId.init))
}
func tabJSON(_ t: Tab) -> JSValue {
    var o = JSObject()
    o["id"] = js(t.id); o["spaceId"] = js(t.spaceId.rawValue); o["type"] = js(t.type); o["title"] = js(t.title); o["state"] = .object(t.state)
    if t.isPinned { o["isPinned"] = .bool(true) }
    if let x = t.originTabId { o["originTabId"] = js(x) }
    if let x = t.originSpaceId { o["originSpaceId"] = js(x.rawValue) }
    return .object(o)
}
func spacesObject<T>(_ f: (SpaceId) -> T, _ conv: (T) -> JSValue) -> JSValue {
    var o = JSObject(); for sp in SpaceId.allCases { o[JSString(sp.rawValue)] = conv(f(sp)) }; return .object(o)
}

final class FakeClock: @unchecked Sendable { var t: Int64 = 1_800_000_000_000 }
final class EventLog: @unchecked Sendable { var items: [DataChange] = [] }

@Suite("tabs golden") struct WorkspaceConformanceTests {
    let g: JSObject
    init() throws { g = try Golden.load("tabs") }

    @Test func disjointVerseSelectionStaysOnThisDevice() {
        var state = JSObject()
        state["verse"] = .number(3)
        state["nativeSelectedVerses"] = .array([.number(1), .number(3)])
        let split = TabFields.split(type: .bible, state: state)
        #expect(split.sync["verse"] == .number(3))
        #expect(split.sync["nativeSelectedVerses"] == nil)
        #expect(split.local["nativeSelectedVerses"] == state["nativeSelectedVerses"])
        #expect(TabFields.merge(type: .bible, sync: split.sync, local: split.local) == state)
    }

    @Test func splitMergeStable() {
        for c in g.arr("split") {
            let type = TabType(rawValue: c["type"]!.str)!
            let st = c["state"]!.object
            let s = TabFields.split(type: type, state: st)
            #expect(JSValue.object(s.sync) == c["sync"]!, "sync \(type)")
            #expect(JSValue.object(s.local) == c["local"]!, "local \(type)")
            #expect(JSValue.object(TabFields.merge(type: type, sync: s.sync, local: s.local)) == c["merged"]!, "merged \(type)")
            #expect(JSON.stableJSON(.object(s.sync)) == c["syncJson"]!.str)
            #expect(JSON.stableJSON(.object(s.local)) == c["localJson"]!.str)
        }
        for c in g.arr("stable") { #expect(JSON.stableJSON(c["value"] ?? .null) == c["json"]!.str) }
        for c in g.arr("orderKeys") {
            var existing: [String: String] = [:]
            for (k, v) in c["existing"]!.object.entries { existing[k.string] = v.str }
            var o = JSObject()
            for (id, k) in TabPersistence.assignOrderKeys(c["ids"]!.array.map(\.str), existing: existing) { o[JSString(id)] = js(k) }
            #expect(JSValue.object(o) == c["result"]!)
        }
    }

    func sessionsFromStore() -> ([Session], [String: [String]], [ArchivedGroup]) {
        let st = g["storeState"]!.object
        let current = st["currentSessionId"]!.str
        let sessions = st.arr("sessions").map { sv -> Session in
            let s = sv.object
            let isCurrent = s["id"]!.str == current
            let tabsObj = (isCurrent ? st["tabs"] : s["tabs"])?.objectValue ?? JSObject()
            let activeObj = (isCurrent ? st["activeTabId"] : s["activeTabId"])?.objectValue ?? JSObject()
            var tabs: [SpaceId: [Tab]] = [:], active: [SpaceId: String?] = [:]
            for sp in SpaceId.allCases {
                tabs[sp] = tabsObj[sp.rawValue]?.arrayValue?.map { tabFromJSON($0.object) } ?? []
                if let a = activeObj[sp.rawValue] { active[sp] = a.optionalString }
            }
            return Session(id: s["id"]!.str, name: s["name"]!.str, icon: s["icon"]?.optionalString, tabFilter: s["tabFilter"]?.optionalString, tabs: tabs, activeTabId: active)
        }
        var orders: [String: [String]] = [:]
        for (k, v) in st["sessionDisplayOrders"]!.object.entries { orders[k.string] = v.array.map(\.str) }
        let groups = st.arr("archivedGroups").map { gv -> ArchivedGroup in
            let o = gv.object
            return ArchivedGroup(id: o["id"]!.str, label: o["label"]!.str, archivedAt: Int64(o["archivedAt"]!.numberValue!), tabsJSON: JSON.stringify(o["tabs"]!).string)
        }
        return (sessions, orders, groups)
    }

    func snapshotJSON(_ s: TabPersistence.Snapshot) -> JSValue {
        func t(_ x: String?) -> JSValue { x.map(js) ?? .null }
        var o = JSObject()
        o["sessions"] = .array(s.sessions.map { r in var x = JSObject(); x["id"] = js(r.id); x["name"] = js(r.name); x["icon"] = t(r.icon); x["tab_filter"] = t(r.tabFilter); x["order_key"] = js(r.orderKey); return .object(x) })
        o["tabs"] = .array(s.tabs.map { r in
            var x = JSObject(); x["id"] = js(r.id); x["session_id"] = js(r.sessionId); x["space_id"] = js(r.spaceId); x["type"] = js(r.type); x["title"] = js(r.title)
            x["is_pinned"] = .number(r.isPinned ? 1 : 0); x["order_key"] = js(r.orderKey); x["display_order_key"] = js(r.displayOrderKey); x["origin_tab_id"] = t(r.originTabId)
            x["origin_space_id"] = t(r.originSpaceId); x["sync_state_json"] = js(r.syncStateJSON); x["local_state_json"] = t(r.localStateJSON); return .object(x) })
        o["archivedGroups"] = .array(s.archivedGroups.map { r in var x = JSObject(); x["id"] = js(r.id); x["label"] = js(r.label); x["archived_at"] = .number(Double(r.archivedAt)); x["tabs_json"] = js(r.tabsJSON); return .object(x) })
        return .object(o)
    }

    @Test func snapshotServiceScriptAndHydrate() throws {
        let (sessions, orders, groups) = sessionsFromStore()
        let built = TabPersistence.buildSnapshot(sessions: sessions, displayOrders: orders, archivedGroups: groups)
        #expect(snapshotJSON(built.snapshot) == g["snapshot"]!)
        func keysObj(_ m: [String: String], order: [String]) -> JSValue { var o = JSObject(); for k in order { if let v = m[k] { o[JSString(k)] = js(v) } }; return .object(o) }
        let wantKeys = g["keys"]!.object
        for (name, m) in [("sessions", built.keys.sessions), ("tabs", built.keys.tabs), ("display", built.keys.display)] {
            #expect(keysObj(m, order: wantKeys[name]!.object.keys.map(\.string)) == wantKeys[name]!, "keys \(name)")
        }

        let db = try SQLiteConnection(readWritePath: ":memory:", create: true)
        try db.exec("PRAGMA foreign_keys = ON")
        try Migrator.migrate(db)
        let clock = FakeClock(), log = EventLog()
        let svc = SessionsService(db: db, now: { clock.t }, onChange: { log.items.append($0) })
        var dumps: [JSValue] = []
        func dump(_ label: String) throws {
            var o = JSObject()
            o["label"] = js(label)
            o["sessions"] = rowsJSON(try db.query("SELECT * FROM sessions ORDER BY id")); o["tabs"] = rowsJSON(try db.query("SELECT * FROM tabs ORDER BY id"))
            o["archived"] = rowsJSON(try db.query("SELECT * FROM archived_groups ORDER BY id")); o["local"] = rowsJSON(try db.query("SELECT * FROM session_local_state ORDER BY session_id"))
            o["listSessions"] = rowsJSON(try db.query("SELECT * FROM sessions WHERE deleted_at IS NULL ORDER BY order_key, id"))
            #expect(try svc.listSessions().map(\.id) == (o["listSessions"]!.array.map { $0["id"]!.str }))
            o["listTabs"] = rowsJSON(try db.query("SELECT * FROM tabs WHERE deleted_at IS NULL ORDER BY session_id, order_key, id"))
            #expect(try svc.listTabs().map(\.id) == o["listTabs"]!.array.map { $0["id"]!.str })
            o["listTabsS1"] = rowsJSON(try db.query("SELECT * FROM tabs WHERE session_id = 's1' AND deleted_at IS NULL ORDER BY order_key, id"))
            #expect(try svc.listTabs(sessionId: "s1").map(\.id) == o["listTabsS1"]!.array.map { $0["id"]!.str })
            o["groups"] = rowsJSON(try db.query("SELECT * FROM archived_groups WHERE deleted_at IS NULL ORDER BY archived_at DESC, id"))
            o["localS1"] = .object(try svc.localState(sessionId: "s1")); o["hasAny"] = .bool(try svc.hasAny())
            dumps.append(.object(o))
        }
        func counts(_ r: (upserted: SessionsService.Counts, tombstoned: SessionsService.Counts)) -> JSValue {
            func c(_ x: SessionsService.Counts) -> JSValue { var o = JSObject(); o["sessions"] = .number(Double(x.sessions)); o["tabs"] = .number(Double(x.tabs)); o["archivedGroups"] = .number(Double(x.archivedGroups)); return .object(o) }
            var o = JSObject(); o["upserted"] = c(r.upserted); o["tombstoned"] = c(r.tombstoned); return .object(o)
        }
        var diffs: [JSValue] = []
        try dump("empty")
        clock.t += 1000; diffs.append(counts(try svc.applySnapshot(built.snapshot))); try dump("snapshot")
        clock.t += 1000; diffs.append(counts(try svc.applySnapshot(built.snapshot))); try dump("same snapshot (no churn)")
        var active = JSObject()
        for sp in SpaceId.allCases { if let v = built.localState["s1"]?[sp] { active[JSString(sp.rawValue)] = v.map(js) ?? .null } }
        try svc.setLocalState(sessionId: "s1", activeTab: active)
        clock.t += 1000
        var t1 = built.snapshot.tabs.first { $0.id == "t1" }!
        var t1Local = t1; t1Local.localStateJSON = #"{"scrollPosition":999}"#
        try svc.upsertTab(t1Local); try dump("local-only change keeps updated_at")
        clock.t += 1000; t1.title = "John 3 (KJV)"; try svc.upsertTab(t1); try dump("synced change bumps updated_at")
        clock.t += 1000; try svc.upsertSession(SessionRowUpsert(id: "s3", name: "New", icon: nil, tabFilter: nil, orderKey: "a5")); try dump("new session")
        clock.t += 1000; try svc.deleteTab("t2"); try dump("tab tombstoned")
        clock.t += 1000; try svc.deleteSession("s2"); try dump("session + its tabs tombstoned")
        clock.t += 1000
        var smaller = built.snapshot; smaller.tabs.removeAll { $0.id == "t4" }; smaller.archivedGroups = []
        diffs.append(counts(try svc.applySnapshot(smaller))); try dump("snapshot drops t4 and g1")
        clock.t += 1000; diffs.append(counts(try svc.applySnapshot(built.snapshot))); try dump("resurrect")
        clock.t += 10_000; let purged = try svc.purgeTombstones(olderThan: 5000); try dump("purged")

        #expect(JSValue.array(diffs) == g["diffs"]!)
        #expect(purged == g["purged"]!.int)
        #expect(log.items.map { "\($0.entity)/\($0.id)/\($0.op)" } == g.arr("events").map { "\($0["entity"]!.str)/\($0["id"]!.str)/\($0["op"]!.str)" })
        let want = g.arr("dumps")
        #expect(dumps.count == want.count)
        for (a, b) in zip(dumps, want) { #expect(a == b, "dump \(b["label"]!.str)") }

        var ls = JSObject(); ls["scripture"] = js("t1"); ls["notes"] = .null
        try svc.setLocalState(sessionId: "s1", activeTab: ls)
        let local = try svc.localState(sessionId: "s1")
        var lsMap: [String: String?] = [:]
        for (k, v) in local.entries { lsMap[k.string] = v.optionalString }
        let rows = try svc.allRows()
        let h = TabPersistence.hydrate(sessions: rows.sessions, tabs: rows.tabs, groups: rows.groups, localState: ["s1": lsMap])
        var o = JSObject()
        o["sessions"] = .array(h.sessions.map { s in
            var x = JSObject(); x["id"] = js(s.id); x["name"] = js(s.name)
            x["tabs"] = spacesObject({ s.tabs(in: $0) }) { .array($0.map(tabJSON)) }
            x["activeTabId"] = spacesObject({ s.activeTabId[$0] ?? nil }) { $0.map(js) ?? .null }
            if let i = s.icon { x["icon"] = js(i) }; if let f = s.tabFilter { x["tabFilter"] = js(f) }
            return .object(x)
        })
        var dord = JSObject(); for s in h.sessions { dord[JSString(s.id)] = .array((h.displayOrders[s.id] ?? []).map(js)) }
        o["sessionDisplayOrders"] = .object(dord)
        o["archivedGroups"] = .array(h.archivedGroups.map { a in var x = JSObject(); x["id"] = js(a.id); x["label"] = js(a.label); x["archivedAt"] = .number(Double(a.archivedAt)); x["tabs"] = (try? JSON.parse(a.tabsJSON)) ?? .array([]); return .object(x) })
        #expect(JSValue.object(o) == g["hydrated"]!)
    }
}

@Suite("workspaces golden") struct WorkspacesConformanceTests {
    @Test func script() throws {
        let g = try Golden.load("workspaces")
        let db = try SQLiteConnection(readWritePath: ":memory:", create: true)
        try Migrator.migrate(db)
        let clock = FakeClock(); clock.t = 90_000
        let ids = FakeClock(); ids.t = 0
        let log = EventLog()
        let svc = WorkspacesService(db: db, now: { clock.t }, uuid: { ids.t += 1; return "ws\(ids.t)" }, onChange: { log.items.append($0) })
        func summary(_ w: SavedWorkspace) -> JSValue { var o = JSObject(); o["id"] = js(w.id); o["name"] = js(w.name); o["created_at"] = .number(Double(w.createdAt)); return .object(o) }
        var saved = [summary(try svc.save(name: "Study", layoutJSON: #"{"direction":"row"}"#, stateJSON: #"{"tabs":[]}"#))]
        clock.t += 10; saved.append(summary(try svc.save(name: "Compare", layoutJSON: #""bible""#, stateJSON: "{}")))
        clock.t += 10; try svc.rename("ws1", to: "Study Mode")
        #expect(JSValue.array(saved) == g["saved"]!)
        #expect(JSValue.array(try svc.list().map(summary)) == g["list1"]!)
        let l = try svc.load("ws1")!
        var lo = JSObject(); lo["id"] = js(l.id); lo["name"] = js(l.name); lo["layout_json"] = js(l.layoutJSON!); lo["created_at"] = .number(Double(l.createdAt)); lo["state_json"] = js(l.stateJSON!)
        #expect(JSValue.object(lo) == g["loaded"]!.array[0])
        #expect(g["loaded"]!.array[1] == .null)
        #expect(try svc.load("nope") == nil)
        try svc.delete("ws2")
        #expect(JSValue.array(try svc.list().map(summary)) == g["list2"]!)
        #expect(rowsJSON(try db.query("SELECT * FROM workspaces ORDER BY id")) == g["rows"]!)
        #expect(log.items.map { "\($0.entity)/\($0.id)/\($0.op)" } == g.arr("events").map { "\($0["entity"]!.str)/\($0["id"]!.str)/\($0["op"]!.str)" })
    }
}

@Suite("workspace snapshot golden") struct WorkspaceSnapshotConformanceTests {
    @Test func build() throws {
        let g = try Golden.load("workspaces")["snapshot"]!.object
        let inputs = g.arr("buildInputs"), built = g.arr("built")
        #expect(inputs.count == built.count && !inputs.isEmpty)
        for (i, input) in inputs.enumerated() {
            var tabs: [SpaceId: [JSValue]] = [:]
            for (k, v) in (input["tabs"]?.object ?? JSObject()).entries { if let sp = SpaceId(rawValue: k.string) { tabs[sp] = v.array } }
            let out = WorkspaceSnapshot.build(tabs: tabs, activeTabId: input["activeTabId"]?.object ?? JSObject(),
                                              displayOrder: input["displayOrder"]?.arrayValue?.map(\.str), icon: input["icon"]?.optionalString)
            #expect(JSON.stringifyString(out) == built[i].str, "build case \(i)")
        }
    }

    @Test func parse() throws {
        let g = try Golden.load("workspaces")["snapshot"]!.object
        let cases = g.arr("parsed")
        #expect(cases.count >= 10)
        for (i, c) in cases.enumerated() {
            let out = WorkspaceSnapshot.parse(c["input"]?.optionalString)
            #expect(JSON.stringifyString(out.jsValue) == c["output"]!.str, "parse case \(i)")
        }
    }

    @Test func sessionRoundTrip() {
        let s = Session(id: "s1", name: "Study", icon: "book", tabs: [
            .scripture: [Tab(id: "t1", spaceId: .scripture, type: "bible", title: "John 3", state: JSValue(dictionaryLiteral: ("book", "John"), ("chapter", 3)).object)],
            .notes: [Tab(id: "t2", spaceId: .notes, type: "note", title: "N", isPinned: true)],
        ], activeTabId: [.scripture: "t1"])
        let json = WorkspaceSnapshot.stateJSON(for: s, displayOrder: ["t2", "gone"])
        let p = WorkspaceSnapshot.parse(json)
        #expect(p.version == 2 && p.icon == "book" && p.displayOrder == ["t2", "t1"])
        #expect(p.activeTabId[.notes]! == "t2")
        #expect(p.tabs(in: .scripture).compactMap { Tab(jsObject: $0) } == s.tabs(in: .scripture))
        #expect(p.tabs(in: .notes).compactMap { Tab(jsObject: $0) } == s.tabs(in: .notes))
        #expect(WorkspaceSnapshot.sessionId("abc") == "ws:abc")
    }
}

@Test func restoringOneArchivedTabPreservesOtherRecords() throws {
    let first = Tab(id: "first", spaceId: .scripture, type: "bible", title: "Jonah 1")
    let last = Tab(id: "last", spaceId: .notes, type: "note", title: "Study note")
    let future = try JSON.parse(#"{"id":"future","spaceId":"futureSpace","payload":{"newField":true}}"#)
    let records: [JSValue] = [.object(first.jsObject), future, .object(last.jsObject)]
    let group = ArchivedGroup(id: "group", label: "Jonah 1 and 2 more", archivedAt: 42,
                              tabsJSON: JSON.stringifyString(.array(records)))
    let remaining = try #require(group.afterRestoring(tabID: first.id))
    #expect(remaining.id == group.id)
    #expect(remaining.archivedAt == group.archivedAt)
    #expect(try JSON.parse(remaining.tabsJSON) == .array([future, .object(last.jsObject)]))
    #expect(remaining.afterRestoring(tabID: "missing") == remaining)

    let afterBulk = try #require(group.afterRestoring(tabIDs: [first.id, last.id, "future"]))
    #expect(try JSON.parse(afterBulk.tabsJSON) == .array([future]))
    #expect(afterBulk.tabs.isEmpty)
    #expect(afterBulk.label == "Archived tabs")

    let single = ArchivedGroup(id: "single", label: last.title, archivedAt: 42,
                               tabsJSON: JSON.stringifyString(.array([.object(last.jsObject)])))
    #expect(single.afterRestoring(tabID: last.id) == nil)
}

@Test func copiedTabsRedirectOnlyOriginsIncludedInTheCopy() {
    let tab = Tab(id: "copied-lexicon", spaceId: .lexicon, type: "lexicon", title: "H3068",
                  originTabId: "reader", originSpaceId: .scripture)
    var expected = tab
    expected.originTabId = "copied-reader"
    #expect(tab.remappingOrigin(using: ["reader": "copied-reader"]) == expected)
    #expect(tab.remappingOrigin(using: ["other": "copied-other"]) == tab)
}

@Test func restoredSnapshotKeepsUniqueTabsAndLocalRelationships() {
    let reader = Tab(id: "reader", spaceId: .scripture, type: "bible", title: "Jonah 1")
    let duplicate = Tab(id: "reader", spaceId: .scripture, type: "bible", title: "Jonah 2")
    let lexicon = Tab(id: "lexicon", spaceId: .lexicon, type: "lexicon", title: "H3068",
                      originTabId: reader.id, originSpaceId: .scripture)
    let source = Session(id: "source", name: "Study",
                         tabs: [.scripture: [reader, duplicate], .lexicon: [lexicon]],
                         activeTabId: [.scripture: reader.id, .lexicon: lexicon.id])
    let parsed = WorkspaceSnapshot.parse(WorkspaceSnapshot.stateJSON(for: source, displayOrder: ["lexicon", "reader"]))
    var generated = ["reserved", "reader-copy", "duplicate-copy"].makeIterator()
    let restored = parsed.restoreSession(id: "snapshot", name: "Study", reservedIDs: ["reader", "reserved"]) {
        generated.next()!
    }

    #expect(restored.session.tabs(in: .scripture).map(\.id) == ["reader-copy", "duplicate-copy"])
    #expect(restored.session.activeTabId[.scripture] == "reader-copy")
    #expect(restored.session.tabs(in: .lexicon).first?.originTabId == "reader-copy")
    #expect(restored.displayOrder == ["lexicon", "reader-copy", "duplicate-copy"])
}

@Test func restoredSnapshotUsesOriginSpaceWhenIDsAreAmbiguous() {
    let scripture = Tab(id: "shared", spaceId: .scripture, type: "bible", title: "Jonah 1")
    let note = Tab(id: "shared", spaceId: .notes, type: "note", title: "Study note")
    let lookup = Tab(id: "lookup", spaceId: .lexicon, type: "lexicon", title: "H3068",
                     originTabId: note.id, originSpaceId: .notes)
    let session = Session(id: "source", name: "Study", tabs: [
        .scripture: [scripture], .notes: [note], .lexicon: [lookup]
    ])
    let parsed = WorkspaceSnapshot.parse(WorkspaceSnapshot.stateJSON(for: session, displayOrder: nil))
    let result = parsed.restoreSession(id: "copy", name: "Study", reservedIDs: []) { "note-copy" }
    #expect(result.session.tabs(in: .scripture).first?.id == "shared")
    #expect(result.session.tabs(in: .notes).first?.id == "note-copy")
    #expect(result.session.tabs(in: .lexicon).first?.originTabId == "note-copy")
}

@Test func snapshotRemembersPreferredSpaceWhenItHasTabs() {
    let note = Tab(id: "note", spaceId: .notes, type: "note", title: "Study note")
    let session = Session(id: "source", name: "Study", tabs: [.notes: [note]])
    let saved = WorkspaceSnapshot.stateJSON(for: session, displayOrder: nil, preferredSpace: .notes)
    #expect(WorkspaceSnapshot.parse(saved).preferredSpace == .notes)
    let emptySpace = WorkspaceSnapshot.stateJSON(for: session, displayOrder: nil, preferredSpace: .scripture)
    #expect(WorkspaceSnapshot.parse(emptySpace).preferredSpace == nil)
    #expect(WorkspaceSnapshot.parse(WorkspaceSnapshot.stateJSON(for: session, displayOrder: nil)).preferredSpace == nil)
}
