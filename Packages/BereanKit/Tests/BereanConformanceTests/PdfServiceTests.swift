import Testing
import BereanCore
import BereanSQLite
import BereanStore
import BereanNotes
import BereanWorkspace

@Suite("pdf service") struct PdfServiceTests {
    @Test func libraryHighlightsBookmarks() throws {
        let db = try SQLiteConnection(readWritePath: ":memory:", create: true)
        try Migrator.migrate(db)
        let clock = FakeClock(); clock.t = 5_000
        let ids = FakeClock(); ids.t = 0
        let log = EventLog()
        let svc = PdfService(db: db, now: { clock.t }, uuid: { ids.t += 1; return "h\(ids.t)" },
                             onChange: { e, id, op in log.items.append(DataChange(entity: e, id: id ?? "", op: op)) })
        try svc.insert(id: "p1", title: "Charles Enoch", filename: "p1.pdf", fileSize: 1200, importedAt: 10, fileHash: "abc")
        try svc.insert(id: "p2", title: "Synced", filename: "p2.pdf", fileSize: 0, importedAt: 20, fileHash: nil)
        #expect(try svc.list().map(\.id) == ["p2", "p1"])
        #expect(try svc.findByHash("abc")?.id == "p1")
        let attached = try svc.attachFile("p2", filename: "p2.pdf", fileSize: 900, fileHash: "def")
        #expect(attached?.fileSize == 900 && attached?.fileHash == "def")
        try svc.attachFile("p1", filename: "p1.pdf", fileSize: 5, fileHash: "zzz")
        #expect(try svc.get("p1")?.fileSize == 1200 && svc.get("p1")?.fileHash == "abc")   // synced fields kept
        try svc.setPageCount("p1", 42); try svc.rename("p1", "")
        #expect(try svc.get("p1")?.pageCount == 42 && svc.get("p1")?.title == "Untitled")

        let rects = [PdfRect(x: 0.1, y: 0.25, w: 0.5, h: 0.03125)]
        let h = try svc.addHighlight(pdfId: "p1", page: 3, rects: rects, color: "yellow", text: "the Watchers")
        #expect(try db.query("SELECT rects_json FROM pdf_highlights").first?["rects_json"]?.string == #"[{"x":0.1,"y":0.25,"w":0.5,"h":0.03125}]"#)
        try svc.setHighlightNote(h, "1 En 6")
        let hl = try svc.highlights("p1")
        #expect(hl.count == 1 && hl[0].rects == rects && hl[0].note == "1 En 6" && hl[0].page == 3)
        #expect(PdfService.parseRects(#"[{"x":1,"y":2,"w":3,"h":4},{"bad":1}]"#) == [PdfRect(x: 1, y: 2, w: 3, h: 4)])

        let b = try svc.addBookmark("p1", page: 7, label: "Book of Watchers")
        #expect(try svc.bookmarks("p1") == [b])
        try svc.removeBookmark(b.id)
        #expect(try svc.bookmarks("p1").isEmpty)
        let blank = try svc.addBookmark("p1", page: 1, label: "")
        try svc.renameBookmark(blank.id, label: "Prologue")
        #expect(try svc.bookmarks("p1").first?.label == "Prologue")
        #expect(log.items.last == DataChange(entity: "pdf_bookmark", id: blank.id, op: "upsert"))

        #expect(try svc.deleteRow("p1") == "p1.pdf")
        #expect(try svc.highlights("p1").isEmpty && svc.bookmarks("p1").isEmpty && svc.get("p1") == nil)
        #expect(log.items.last == DataChange(entity: "pdf", id: "p1", op: "delete"))
    }
}

@Suite("pdf geometry") struct PdfGeometryTests {
    let crop = PdfGeometry.Box(x: 10, y: 20, width: 600, height: 800)

    @Test func unrotatedTopLeftOrigin() {
        let r = PdfRect(x: 0.1, y: 0.25, w: 0.5, h: 0.05)
        let b = PdfGeometry.pageRect(r, crop: crop, rotation: 0)
        #expect(abs(b.x - 70) < 1e-9 && abs(b.y - 580) < 1e-9 && abs(b.width - 300) < 1e-9 && abs(b.height - 40) < 1e-9)
    }

    @Test func roundTripsEveryRotation() {
        let r = PdfRect(x: 0.2, y: 0.3, w: 0.4, h: 0.1)
        for rot in [0, 90, 180, 270, -90, 450] {
            let back = PdfGeometry.normalizedRect(PdfGeometry.pageRect(r, crop: crop, rotation: rot), crop: crop, rotation: rot)
            #expect(abs(back.x - r.x) < 1e-9 && abs(back.y - r.y) < 1e-9 && abs(back.w - r.w) < 1e-9 && abs(back.h - r.h) < 1e-9, "rotation \(rot)")
        }
        // 90°: the displayed top-left corner is the page's bottom-left corner.
        let corner = PdfGeometry.pageRect(PdfRect(x: 0, y: 0, w: 0.01, h: 0.01), crop: crop, rotation: 90)
        #expect(abs(corner.x - 10) < 1e-9 && abs(corner.y - 20) < 1e-9)
    }
}
