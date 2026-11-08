import Testing
import BereanCore
import BereanSQLite
import BereanStore
import BereanNotes
import BereanWorkspace

func noteJSON(_ n: Note) -> JSValue {
    var o = JSObject()
    func num(_ x: Int64) -> JSValue { .number(Double(x)) }
    o["id"] = js(n.id); o["type"] = js(n.type); o["title"] = js(n.title); o["content"] = js(n.content); o["verseRef"] = n.verseRef.map(js) ?? .null
    o["color"] = js(n.color)
    if let x = n.icon { o["icon"] = js(x) }
    if let x = n.status { o["status"] = js(x) }
    o["createdAt"] = num(n.createdAt); o["updatedAt"] = num(n.updatedAt); o["tags"] = .array(n.tags.map(js))
    if let x = n.importedAt { o["importedAt"] = num(x) }
    o["folderId"] = n.folderId.map(js) ?? .null; o["textId"] = js(n.textId)
    if let x = n.idiomTerm { o["idiomTerm"] = js(x) }
    if let x = n.idiomMeaning { o["idiomMeaning"] = js(x) }
    if let x = n.idiomAliases { o["idiomAliases"] = .array(x.map(js)) }
    if n.idiomAutoVariants { o["idiomAutoVariants"] = .bool(true) }
    if let x = n.idiomData { o["idiomData"] = x }
    if let x = n.deletedAt { o["deletedAt"] = num(x) }
    o["pinned"] = .bool(n.pinned); o["aiExcluded"] = .bool(n.aiExcluded)
    return .object(o)
}

@Suite("notes golden") struct NotesConformanceTests {
    let g: JSObject
    let svc: NotesService
    init() throws {
        g = try Golden.load("notes")
        let db = try SQLiteConnection(readWritePath: ":memory:", create: true)
        try Migrator.migrate(db)
        for f in g.arr("folderRows") {
            let o = f.object
            try db.run("INSERT INTO note_folders (id, name, parent_id, created_at, ai_excluded) VALUES (?, ?, ?, ?, ?)",
                       [.text(o["id"]!.str), .text(o["name"]!.str), o["parent_id"]!.optionalString.map { .text($0) } ?? .null, .integer(Int64(o["created_at"]!.int)), .integer(Int64(o["ai_excluded"]!.int))])
        }
        for r in g.arr("rows") {
            let o = r.object
            let cols = o.keys.map(\.string)
            let vals: [SQLiteValue] = o.values.map { v in
                switch v { case .null: return .null; case .number(let d): return .integer(Int64(d)); case .string(let s): return .text(s.string); default: return .null }
            }
            try db.run("INSERT INTO notes (\(cols.joined(separator: ", "))) VALUES (\(cols.map { _ in "?" }.joined(separator: ", ")))", vals)
        }
        svc = NotesService(db: db)
    }

    @Test func listsAndLookups() throws {
        #expect(JSValue.array(try svc.all().map(noteJSON)) == g["all"]!)
        #expect(try svc.all(limit: 3, offset: 2).map(\.id) == g.arr("page").map(\.str))
        #expect(try svc.one("n16").map(noteJSON) == g["one"]!)
        #expect(try svc.one("nope") == nil)
        #expect(try svc.trash().map(\.id) == g.arr("trash").map(\.str))
        let folders = JSValue.array(try svc.folders().map { f in
            var o = JSObject(); o["id"] = js(f.id); o["name"] = js(f.name); o["parentId"] = f.parentId.map(js) ?? .null; o["createdAt"] = .number(Double(f.createdAt)); o["aiExcluded"] = .bool(f.aiExcluded); return .object(o)
        })
        #expect(folders == g["folders"]!)
        let daily = JSValue.array(try svc.dailyDates().map { d in var o = JSObject(); o["dateKey"] = js(d.dateKey); o["noteId"] = js(d.noteId); o["length"] = .number(Double(d.length)); return .object(o) })
        #expect(daily == g["daily"]!)
    }

    @Test func search() throws {
        for c in g.arr("searches") {
            let got = try svc.search(c["query"]!.str, mode: NotesWordMode(rawValue: c["mode"]!.str)!).map(\.id)
            #expect(got == c["results"]!.array.map(\.str), "\(c["query"]!.str.debugDescription) \(c["mode"]!.str)")
        }
    }

    @Test func verseAndChapter() throws {
        for c in g.arr("byVerse") {
            #expect(try svc.byVerse(c["ref"]!.str, textId: c["textId"]!.str).map(\.id) == c["ids"]!.array.map(\.str), "\(c["ref"]!.str) \(c["textId"]!.str)")
        }
        for c in g.arr("byChapter") {
            let b = c["bookId"]!.str, ch = c["chapter"]!.int, t = c["textId"]!.str
            #expect(try svc.byChapter(b, ch, textId: t).map(\.id) == c["ids"]!.array.map(\.str), "\(b) \(ch) \(t)")
            var want: [Int: Int] = [:]
            for (k, v) in c["counts"]!.object.entries { want[Int(k.string)!] = v.int }
            #expect(try svc.chapterCounts(b, ch, textId: t) == want, "counts \(b) \(ch) \(t)")
        }
    }

    @Test func writeScript() throws {
        let db = try SQLiteConnection(readWritePath: ":memory:", create: true)
        try Migrator.migrate(db)
        let clock = FakeClock(); clock.t = 50_000
        let counter = FakeClock(); counter.t = 0
        let log = EventLog()
        let w = NotesService(db: db, now: { clock.t }, uuid: { counter.t += 1; return "id\(counter.t)" }, onChange: { log.items.append(DataChange(entity: $0, id: $1, op: $2)) })
        var results: [JSValue] = []
        func created(_ r: (note: Note, existed: Bool)) -> JSValue {
            var o = JSObject(); o["success"] = .bool(true); o["note"] = noteJSON(r.note); if r.existed { o["existed"] = .bool(true) }; return .object(o)
        }
        func ok(_ b: Bool) -> JSValue { var o = JSObject(); o["success"] = .bool(b); if !b { o["error"] = js("Note not found") }; return .object(o) }
        results.append(created(try w.create(.init(title: "First", content: "Hello", tags: ["a"]))))
        clock.t += 10; results.append(created(try w.create(.init(type: "daily", title: "Daily — 2026-11-07", content: "today"))))
        clock.t += 10; results.append(created(try w.create(.init(type: "daily", title: "Daily — 2026-11-07", content: "second same day"))))
        clock.t += 10; results.append(created(try w.create(.init(id: "share-1", title: "Shared", content: "x"))))
        clock.t += 10; results.append(created(try w.create(.init(id: "share-1", title: "Shared again", content: "y"))))
        try db.run(#"INSERT INTO settings (key, value) VALUES ('defaultNoteStatus', '"todo"') ON CONFLICT(key) DO UPDATE SET value = excluded.value"#)
        clock.t += 10; results.append(created(try w.create(.init(type: "verse", title: "Gen 1:1", verseRef: "GEN.1.1", color: "green", textId: "lxx", idiomAliases: ["x"], idiomAutoVariants: true))))
        clock.t += 10; results.append(created(try w.create(.init(title: "No status", status: .some(nil)))))
        clock.t += 10; results.append(ok(try w.update("id1", .init(title: "First (edited)", content: "Hello world", icon: .some(""), status: .some("done"), tags: [], idiomAliases: [], idiomData: .some(["k": 1])))))
        clock.t += 10; results.append(ok(try w.update("missing", .init(title: "x"))))
        let folder = try w.createFolder("Studies"); clock.t += 10; _ = try w.createFolder("", parentId: folder)
        try w.setFolder("id1", folder); try w.setPinned("id1", true); try w.renameFolder(folder, to: "Bible Studies")
        clock.t += 10; try w.delete("id1"); clock.t += 10
        try db.run("DELETE FROM note_folders WHERE id = ?", [.text(folder)])
        results.append(ok(try w.restore("id1"))); results.append(ok(try w.restore("nope")))
        let want = g["writes"]!.object
        #expect(JSValue.array(results) == want["results"]!)
        #expect(log.items.map { "\($0.entity)/\($0.id)/\($0.op)" } == want.arr("events").map { "\($0["entity"]!.str)/\($0["id"]!.str)/\($0["op"]!.str)" })
        #expect(rowsJSON(try db.query("SELECT * FROM notes ORDER BY id")) == want["notes"]!)
        #expect(rowsJSON(try db.query("SELECT * FROM note_folders ORDER BY id")) == want["folders"]!)
    }
}
