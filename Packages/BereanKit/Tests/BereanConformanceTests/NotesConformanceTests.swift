import Foundation
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
        // Version history.
        func vr(_ r: NoteVersionResult) -> JSValue {
            var o = JSObject(); o["success"] = .bool(true)
            switch r { case .created(let id): o["id"] = js(id); case .skipped: o["skipped"] = .bool(true) }
            return .object(o)
        }
        func rr(_ r: NoteRestoreResult) -> JSValue {
            var o = JSObject()
            switch r {
            case .restored(let c): o["success"] = .bool(true); o["content"] = js(c)
            case .versionNotFound: o["success"] = .bool(false); o["error"] = js("Version not found")
            case .noteNotFound: o["success"] = .bool(false); o["error"] = js("Note not found")
            }
            return .object(o)
        }
        var versions: [JSValue] = []
        let vn = try w.create(.init(title: "Versioned", content: "v0")).note.id
        clock.t += 10; versions.append(vr(try w.createVersion(noteId: vn, title: "Versioned", content: "v0")))
        clock.t += 10; versions.append(vr(try w.createVersion(noteId: vn, title: "Versioned", content: "v0")))
        clock.t += 10; versions.append(vr(try w.createVersion(noteId: vn, title: "", content: "v1", kind: "manual")))
        _ = try w.update(vn, .init(content: "v2 typed"))
        let firstVersionId = try w.versions(of: vn).last!.id
        clock.t += 10; versions.append(rr(try w.restoreVersion(noteId: vn, versionId: firstVersionId)))
        clock.t += 10; versions.append(rr(try w.restoreVersion(noteId: vn, versionId: firstVersionId)))
        versions.append(rr(try w.restoreVersion(noteId: vn, versionId: "nope"))); versions.append(rr(try w.restoreVersion(noteId: "nope", versionId: firstVersionId)))
        let hour: Int64 = 3_600_000
        for i in 0..<60 { clock.t += 6 * hour; versions.append(vr(try w.createVersion(noteId: vn, title: "Versioned", content: "c\(i)", kind: i % 17 == 0 ? "manual" : "auto"))) }
        clock.t += 10 * 24 * hour; versions.append(vr(try w.createVersion(noteId: vn, title: "Versioned", content: "latest")))
        let list: [JSValue] = try w.versions(of: vn).map { v in
            var o = JSObject(); o["id"] = js(v.id); o["noteId"] = js(v.noteId); o["title"] = js(v.title); o["content"] = js(v.content)
            o["kind"] = js(v.kind); o["createdAt"] = .number(Double(v.createdAt)); return .object(o)
        }
        let want = g["writes"]!.object
        #expect(JSValue.array(versions) == want["versions"]!)
        #expect(JSValue.array(list) == want["versionList"]!)
        #expect(JSValue.array(results) == want["results"]!)
        #expect(log.items.map { "\($0.entity)/\($0.id)/\($0.op)" } == want.arr("events").map { "\($0["entity"]!.str)/\($0["id"]!.str)/\($0["op"]!.str)" })
        #expect(rowsJSON(try db.query("SELECT * FROM notes ORDER BY id")) == want["notes"]!)
        #expect(rowsJSON(try db.query("SELECT * FROM note_folders ORDER BY id")) == want["folders"]!)
    }
}

@Suite("note markdown golden") struct NoteMarkdownConformanceTests {
    static func note(_ v: JSValue) -> Note {
        func s(_ k: String) -> String? { v[k]?.optionalString }
        return Note(id: s("id")!, type: s("type")!, title: s("title") ?? "", content: s("content") ?? "", verseRef: s("verseRef"),
                    color: s("color") ?? "blue", icon: s("icon"), status: s("status"),
                    createdAt: Int64(v["createdAt"]!.numberValue!), updatedAt: Int64(v["updatedAt"]!.numberValue!),
                    tags: v["tags"]?.array.map(\.str) ?? [], importedAt: nil, folderId: s("folderId"), textId: "kjva",
                    idiomTerm: nil, idiomMeaning: nil, idiomAliases: nil, idiomAutoVariants: false, idiomData: nil, deletedAt: nil,
                    pinned: false, aiExcluded: v["aiExcluded"]?.boolValue ?? false)
    }

    @Test func export() throws {
        let g = try Golden.load("note-markdown")
        let notes = g.arr("notes"), exported = g.arr("exported")
        #expect(notes.count == exported.count && notes.count >= 10)
        for (i, n) in notes.enumerated() { #expect(NoteMarkdownFile.markdown(for: Self.note(n)) == exported[i].str, "note \(i)") }
    }

    @Test func parse() throws {
        let g = try Golden.load("note-markdown")
        for (i, t) in g.arr("exported").enumerated() {
            #expect(NoteMarkdownFile.parse(t.str).jsValue == g.arr("roundTrip")[i], "round trip \(i)")
        }
        for (i, c) in g.arr("parsed").enumerated() {
            #expect(NoteMarkdownFile.parse(c["input"]!.str, fallbackTitle: "Fallback").jsValue == c["output"]!, "file \(i)")
        }
    }

    @Test func fileNames() throws {
        let g = try Golden.load("note-markdown")
        let extra: [(String, String)] = [("  a/b\\c:d*e?f\"g<h>i|j  ", "abcdef123456"), ("|||", "zz"), (String(repeating: "é", count: 100), "long"), ("a\u{2003}\u{3000}b\n\tc", "ws")]
        let inputs = g.arr("notes").map { ($0["title"]?.str ?? "", $0["id"]!.str) } + extra
        #expect(inputs.map { NoteMarkdownFile.fileName(title: $0.0, id: $0.1) } == g.arr("names").map(\.str))
    }

    @Test func isoDates() {
        #expect(JSDate.isoString(0) == "1970-01-01T00:00:00.000Z")
        #expect(JSDate.isoString(-1) == "1969-12-31T23:59:59.999Z")
        #expect(JSDate.isoString(951_782_400_999) == "2000-02-29T00:00:00.999Z")
        #expect(JSDate.isoString(253_402_300_800_000) == "+010000-01-01T00:00:00.000Z")
    }
}

@Suite("note markdown import") struct NoteImportTests {
    @Test func importCreatesThenUpdatesByBereanId() throws {
        let db = try SQLiteConnection(readWritePath: ":memory:", create: true)
        try Migrator.migrate(db)
        let w = NotesService(db: db)
        guard case .created(let id) = try w.importMarkdown("# Sabbath\n\nRemember the sabbath day.", fileName: "sabbath.MD") else { Issue.record("expected create"); return }
        let n = try w.one(id)!
        #expect(n.title == "Sabbath" && n.content == "Remember the sabbath day." && n.type == "general")
        let file = NoteMarkdownFile.markdown(for: n).replacingOccurrences(of: "Remember the sabbath day.", with: "Keep it holy.")
            .replacingOccurrences(of: "---\n\n", with: "ai_excluded: true\n---\n\n")
        #expect(try w.importMarkdown(file, fileName: "x.md") == .updated(id))
        let u = try w.one(id)!
        #expect(u.content == "Keep it holy." && u.aiExcluded)
        try w.delete(id)
        guard case .created(let other) = try w.importMarkdown(file, fileName: "x.md") else { Issue.record("trashed note must not be updated"); return }
        #expect(other != id)
        guard case .created(let plain) = try w.importMarkdown("", fileName: "Empty file.markdown") else { return }
        #expect(try w.one(plain)!.title == "Empty file")
    }
}

@Suite("verse tags golden") struct VerseTagsConformanceTests {
    static func ranges(_ v: JSValue) -> [TagRange] { v.array.compactMap(TagRange.init) }
    static func verses(_ list: [TaggedVerse]) -> JSValue {
        .array(list.map { var o = JSObject(); o["bookId"] = js($0.bookId); o["chapter"] = .number(Double($0.chapter)); o["verse"] = .number(Double($0.verse)); return .object(o) })
    }
    static func summary(_ l: [VerseTagSummary]) -> JSValue {
        .array(l.map { t in
            var o = JSObject()
            o["id"] = js(t.id); o["name"] = js(t.name); o["color"] = t.color.map(js) ?? .null; o["createdAt"] = .number(Double(t.createdAt))
            o["colorSlot"] = t.colorSlot.map { .number(Double($0)) } ?? .null; o["graphX"] = t.graphX.map { .number($0) } ?? .null
            o["graphY"] = t.graphY.map { .number($0) } ?? .null; o["graphPinned"] = .bool(t.graphPinned)
            o["memberCount"] = .number(Double(t.memberCount)); o["verseCount"] = .number(Double(t.verseCount)); o["chapterCount"] = .number(Double(t.chapterCount))
            return .object(o)
        })
    }
    static func lite(_ t: TagLite) -> JSValue {
        var o = JSObject(); o["id"] = js(t.id); o["name"] = js(t.name); o["color"] = t.color.map(js) ?? .null; o["colorSlot"] = t.colorSlot.map { .number(Double($0)) } ?? .null; return .object(o)
    }
    static func chapter(_ r: (verseTags: [Int: [TagLite]], chapterTags: [TagLite])) -> JSValue {
        var vt = JSObject()
        for k in r.verseTags.keys.sorted() { vt[String(k)] = .array(r.verseTags[k]!.map(lite)) }
        var o = JSObject(); o["verseTags"] = .object(vt); o["chapterTags"] = .array(r.chapterTags.map(lite)); return .object(o)
    }
    static func members(_ l: [TagMemberDetail]) -> JSValue {
        .array(l.map { m in
            var o = JSObject()
            o["memberId"] = js(m.memberId); o["tagId"] = js(m.tagId); o["tagName"] = js(m.tagName); o["tagColor"] = m.tagColor.map(js) ?? .null
            o["tagColorSlot"] = m.tagColorSlot.map { .number(Double($0)) } ?? .null; o["kind"] = js(m.kind); o["label"] = js(m.label); o["ranges"] = m.ranges
            o["verses"] = verses(m.verses)
            o["wholeChapters"] = .array(m.wholeChapters.map { var w = JSObject(); w["bookId"] = js($0.bookId); w["chapter"] = .number(Double($0.chapter)); return .object(w) })
            return .object(o)
        })
    }
    static func del(_ r: TagDeleteResult) -> JSValue {
        var o = JSObject()
        switch r {
        case .deleted(let l): o["deleted"] = .bool(true); o["list"] = summary(l)
        case .blocked(let n, let name): o["deleted"] = .bool(false); o["blocked"] = .bool(true); o["noteRefCount"] = .number(Double(n)); o["name"] = js(name)
        case .notFound: o["deleted"] = .bool(false); o["notFound"] = .bool(true)
        }
        return .object(o)
    }

    @Test func expand() throws {
        let g = try Golden.load("verse-tags")
        for (i, c) in g.arr("expandCases").enumerated() { #expect(Self.verses(VerseTagsService.expand(Self.ranges(c))) == g.arr("expanded")[i], "case \(i)") }
    }

    @Test func script() throws {
        let g = try Golden.load("verse-tags")
        let db = try SQLiteConnection(readWritePath: ":memory:", create: true)
        try db.exec("PRAGMA foreign_keys = ON")   // as UserDatabase and the TS test adapter (members cascade on tag delete)
        try Migrator.migrate(db)
        let clock = FakeClock(); clock.t = 70_000
        let ids = FakeClock(); ids.t = 0
        let log = EventLog()
        let svc = VerseTagsService(db: db, now: { clock.t }, uuid: { ids.t += 1; return "t\(ids.t)" }, pick: { _ in 0 },
                                   onChange: { e, id, op in log.items.append(DataChange(entity: e, id: id ?? "", op: op)) })
        var steps: [JSValue] = []
        func r(_ b: String, _ c: Double, _ s: Double, _ e: Double) -> TagRange { TagRange(bookId: b, chapter: c, spans: [(s, e)]) }
        steps.append(Self.summary(try svc.create("Sabbath")))
        clock.t += 10; steps.append(Self.summary(try svc.create("sabbath")))
        clock.t += 10; steps.append(Self.summary(try svc.create("Feasts", color: "#ff0000")))
        clock.t += 10; steps.append(Self.summary(try svc.addMembers(tagIds: ["t1"], newTagNames: ["Covenant", "Feasts"], ranges: [r("EXO", 20, 8, 11)], label: "Exodus 20:8-11")))
        clock.t += 10; steps.append(Self.summary(try svc.addMembers(tagIds: ["t1"], ranges: [TagRange(bookId: "GEN", chapter: 2, whole: true)], label: "Genesis 2", kind: "chapter")))
        clock.t += 10; steps.append(Self.summary(try svc.rename("t3", to: "Appointed Times")))
        steps.append(Self.summary(try svc.setColor("t1", "#00aa00")))
        steps.append(Self.summary(try svc.setColorSlot("t1", 15)))
        steps.append(Self.summary(try svc.reorder(["t3", "t1"])))
        steps.append(Self.chapter(try svc.forChapter("EXO", 20))); steps.append(Self.chapter(try svc.forChapter("GEN", 2))); steps.append(Self.chapter(try svc.forChapter("JHN", 3)))
        steps.append(Self.members(try svc.members(["t1", "t3"]))); steps.append(Self.members(try svc.members([])))
        let first = try db.query("SELECT id FROM verse_tag_members WHERE label = 'Exodus 20:8-11' AND tag_id = 't1'").first!["id"]!.string!
        clock.t += 10; steps.append(Self.summary(try svc.updateMemberRanges(first, ranges: [r("EXO", 20, 8, 8)], label: "Exodus 20:8")))
        steps.append(Self.summary(try svc.updateMemberRanges(first, ranges: [TagRange(bookId: "EXO", chapter: 20, whole: true)], label: "Exodus 20", kind: "chapter")))
        steps.append(Self.summary(try svc.updateMemberRanges("nope", ranges: [], label: "x")))
        steps.append(Self.summary(try svc.merge("t4", into: "t1")))
        try db.run("INSERT INTO notes (id, type, title, content, created_at, updated_at) VALUES ('n1', 'general', 'x', 'see #Appointed Times', 1, 1)")
        steps.append(Self.del(try svc.delete("t3"))); steps.append(Self.del(try svc.delete("t3", force: true))); steps.append(Self.del(try svc.delete("missing")))
        steps.append(Self.summary(try svc.removeMember(first)))
        let want = g.arr("steps")
        #expect(steps.count == want.count)
        for (i, s) in steps.enumerated() where i < want.count { #expect(s == want[i], "step \(i)") }
        #expect(log.items.map { "\($0.entity)/\($0.id)/\($0.op)" } == g.arr("events").map { "\($0["entity"]!.str)/\($0["id"]?.optionalString ?? "")/\($0["op"]!.str)" })
        let tables = g["tables"]!.object
        for t in ["verse_tags", "verse_tag_members", "verse_tag_verse", "tag_edges"] {
            #expect(rowsJSON(try db.query("SELECT * FROM \(t) ORDER BY rowid")) == tables[t]!, "table \(t)")
        }
    }
}

@Suite("markdown live preview spans") struct MarkdownLiveSpansTests {
    func plain(_ s: String) -> String { MarkdownLiveSpans.plainText(s) }

    @Test func inlineMarkupIsHidden() {
        #expect(plain("A **bold** and *italic* and ~~gone~~ and ==hi== word") == "A bold and italic and gone and hi word")
        #expect(plain("<u>under</u> <mark class=\"hl-red\">red</mark> `code *not italic*`") == "under red code *not italic*")
        #expect(plain("See [Exodus](https://x.y/z) and [[Gen 1:1]] and [[Note title|alias]]") == "See Exodus and Gen 1:1 and alias")
        #expect(plain("**bold with *italic* inside**") == "bold with italic inside")
        #expect(plain("2 * 3 * 4 and snake_case_name") == "2 * 3 * 4 and snake_case_name")
    }

    @Test func blocks() {
        #expect(plain("## Heading\nBody") == "Heading\nBody")
        #expect(plain("- one\n- two\n  - nested") == "• one\n• two\n  • nested")
        #expect(plain("1. first\n2. second") == "1. first\n2. second")
        #expect(plain("- [ ] todo\n- [x] done") == "• □ todo\n• ☑ done")
        #expect(plain("> quoted **text**") == "quoted text")
        #expect(plain("> [!note] Remember") == "Note: Remember")
        #expect(plain("![Diagram|w300](data:image/png;base64,AAAA)") == "Diagram")
    }

    @Test func structuresKeptButHidden() {
        let md = "<!-- berean:columns -->\n<!-- berean:col -->\nLeft\n<!-- /berean:col -->\n<!-- /berean:columns -->"
        #expect(plain(md).trimmingCharacters(in: .whitespacesAndNewlines) == "Left")
        let spans = MarkdownLiveSpans.spans(md)
        #expect(spans.filter { $0.kind == .structure }.count == 4)
    }

    @Test func codeFenceContentsAreLiteral() {
        let md = "```swift\nlet x = **y**\n```"
        let spans = MarkdownLiveSpans.spans(md)
        #expect(!spans.contains { $0.kind == .bold })
        #expect(spans.filter { $0.kind == .codeBlock }.count == 3)
    }

    @Test func tables() {
        let spans = MarkdownLiveSpans.spans("| a | b |\n| --- | :---: |\n| 1 | 2 |")
        #expect(spans.filter { $0.kind == .tableRow }.count == 2)
        #expect(spans.filter { $0.kind == .tableRule }.count == 1)
    }

    @Test func rangesStayInsideTheString() throws {
        let g = try Golden.load("note-markdown")
        for n in g.arr("notes") {
            let s = n["content"]?.str ?? ""
            let len = (s as NSString).length
            for sp in MarkdownLiveSpans.spans(s) { #expect(sp.range.location >= 0 && NSMaxRange(sp.range) <= len, "\(s)") }
        }
    }
}

@Suite("note folders and trash") struct NoteFolderTrashTests {
    @Test func folderOperations() throws {
        let db = try SQLiteConnection(readWritePath: ":memory:", create: true)
        try db.exec("PRAGMA foreign_keys = ON")
        try Migrator.migrate(db)
        let w = NotesService(db: db)
        let a = try w.createFolder("A"), b = try w.createFolder("B", parentId: a), c = try w.createFolder("C", parentId: b)
        #expect(try w.setFolderParent(a, c) == false)            // cycle refused
        let n1 = try w.create(.init(title: "in B", content: "x", folderId: b)).note.id
        let n2 = try w.create(.init(title: "in C", content: "y", folderId: c)).note.id
        try w.deleteFolder(b)                                       // C moves up to A, n1 to root
        #expect(try w.one(n1)!.folderId == nil)
        #expect(try w.folders().first { $0.id == c }?.parentId == a)
        let trashed = try w.deleteFolderDeep(a)                    // A and C removed, n2 trashed
        #expect(trashed == [n2])
        #expect(try w.folders().isEmpty)
        #expect(try w.trash().map(\.id) == [n2])
        #expect(try w.purgeTrashItem(n1) == false)                 // not in trash
        try w.delete(n1)
        #expect(try w.emptyTrash().sorted() == [n1, n2].sorted())
        #expect(try w.trash().isEmpty && w.one(n1) == nil)
    }

    @Test func systemFolders() {
        func n(_ type: String, _ title: String, ref: String? = nil, tags: [String] = []) -> Note {
            Note(id: "x", type: type, title: title, content: "", verseRef: ref, color: "blue", icon: nil, status: nil, createdAt: 0, updatedAt: 0, tags: tags,
                 importedAt: nil, folderId: nil, textId: "kjva", idiomTerm: nil, idiomMeaning: nil, idiomAliases: nil, idiomAutoVariants: false, idiomData: nil,
                 deletedAt: nil, pinned: false, aiExcluded: false)
        }
        #expect(NotesService.systemFolder(n("daily", "Daily — 2026-11-12")) == "daily")
        #expect(NotesService.systemFolder(n("general", "Daily — 2026-01-01")) == "daily")
        #expect(NotesService.systemFolder(n("verse", "x", ref: "JHN.3.16")) == "verse")
        #expect(NotesService.systemFolder(n("general", "x", tags: ["esword"])) == "esword")
        #expect(NotesService.systemFolder(n("general", "Topic")) == nil)
    }
}

@Suite("navigation history") struct HistoryServiceTests {
    @Test func addDedupPageDeleteClear() throws {
        let db = try SQLiteConnection(readWritePath: ":memory:", create: true)
        try Migrator.migrate(db)
        let h = HistoryService(db: db)
        func e(_ id: String, _ ts: Int64, ch: Int = 3) -> HistoryEntry { HistoryEntry(id: id, type: "bible", title: "John \(ch)", timestamp: ts, bookId: "JHN", chapter: ch) }
        #expect(try h.add(e("a", 1_000)))
        #expect(try h.add(e("b", 1_000 + 60_000)) == false)            // same place within 5 minutes
        #expect(try h.add(e("c", 1_000 + 6 * 60_000)))                  // same place later
        #expect(try h.add(e("d", 1_000 + 7 * 60_000, ch: 4)))
        #expect(try h.all().map(\.id) == ["d", "c", "a"])
        #expect(try h.page(before: 1_000 + 6 * 60_000).map(\.id) == ["a"])
        _ = try h.add(HistoryEntry(id: "s", type: "search", title: "\"grace\"", timestamp: 9_999_999, query: "grace"), maxEntries: 2)
        #expect(try h.all().map(\.id) == ["s", "d"])                   // capped to 2
        try h.delete("s")
        #expect(try h.all().map(\.id) == ["d"])
        try h.clear()
        #expect(try h.all().isEmpty)
    }
}
