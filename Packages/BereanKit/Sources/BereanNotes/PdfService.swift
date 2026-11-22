import Foundation
import BereanCore
import BereanSQLite

public struct PdfRecord: Equatable, Sendable, Identifiable {
    public var id, title, filename: String
    public var pageCount: Int
    public var fileSize: Int64
    public var importedAt: Int64
    public var fileHash: String?
}

/// Normalised (0…1, top-left origin) rectangle on a page — the original's `rects_json` element.
public struct PdfRect: Equatable, Sendable {
    public var x, y, w, h: Double
    public init(x: Double, y: Double, w: Double, h: Double) { self.x = x; self.y = y; self.w = w; self.h = h }
}

public struct PdfHighlight: Equatable, Sendable, Identifiable {
    public var id, pdfId: String
    public var page: Int
    public var rects: [PdfRect]
    public var color, text: String
    public var note: String?
    public var createdAt: Int64
}

public struct PdfBookmark: Equatable, Sendable, Identifiable {
    public var id, pdfId: String
    public var page: Int
    public var label: String
    public var createdAt: Int64
}

/// Port of src/platform/services/pdfService.ts — `pdfs`, `pdf_highlights`, `pdf_bookmarks` rows
/// (same SQL, result shapes and change events). File copy/hash/unlink stays with the caller, as in
/// the original's IPC layer.
public final class PdfService: @unchecked Sendable {
    let db: SQLiteConnection
    let now: @Sendable () -> Int64
    let uuid: @Sendable () -> String
    let onChange: @Sendable (_ entity: String, _ id: String?, _ op: String) -> Void

    public init(db: SQLiteConnection,
                now: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) },
                uuid: @escaping @Sendable () -> String = { UUID().uuidString.lowercased() },
                onChange: @escaping @Sendable (_ entity: String, _ id: String?, _ op: String) -> Void = { _, _, _ in }) {
        self.db = db; self.now = now; self.uuid = uuid; self.onChange = onChange
    }

    static func i(_ v: SQLiteValue?) -> Int64 { if case .integer(let x) = v { return x }; if case .real(let d) = v { return Int64(d) }; return 0 }
    static func f(_ v: SQLiteValue?) -> Double { if case .integer(let x) = v { return Double(x) }; if case .real(let d) = v { return d }; return 0 }

    static func pdf(_ r: SQLiteRow) -> PdfRecord {
        PdfRecord(id: r["id"]?.string ?? "", title: r["title"]?.string ?? "", filename: r["filename"]?.string ?? "",
                  pageCount: Int(i(r["page_count"])), fileSize: i(r["file_size"]), importedAt: i(r["imported_at"]),
                  fileHash: r["file_hash"]?.string)
    }

    public static func parseRects(_ json: String) -> [PdfRect] {
        guard case .array(let items)? = try? JSON.parse(json) else { return [] }
        return items.compactMap { v in
            guard let x = v["x"]?.numberValue, let y = v["y"]?.numberValue, let w = v["w"]?.numberValue, let h = v["h"]?.numberValue else { return nil }
            return PdfRect(x: x, y: y, w: w, h: h)
        }
    }

    /// `JSON.stringify(rects)` — key order x, y, w, h, JavaScript number formatting.
    public static func rectsJSON(_ rects: [PdfRect]) -> String {
        JSON.stringifyString(.array(rects.map { r in
            var o = JSObject()
            o["x"] = .number(r.x); o["y"] = .number(r.y); o["w"] = .number(r.w); o["h"] = .number(r.h)
            return .object(o)
        }))
    }

    static func highlight(_ r: SQLiteRow) -> PdfHighlight {
        PdfHighlight(id: r["id"]?.string ?? "", pdfId: r["pdf_id"]?.string ?? "", page: Int(i(r["page"])),
                     rects: parseRects(r["rects_json"]?.string ?? "[]"), color: r["color"]?.string ?? "yellow",
                     text: r["text"]?.string ?? "", note: r["note"]?.string, createdAt: i(r["created_at"]))
    }

    static func bookmark(_ r: SQLiteRow) -> PdfBookmark {
        PdfBookmark(id: r["id"]?.string ?? "", pdfId: r["pdf_id"]?.string ?? "", page: Int(i(r["page"])),
                    label: r["label"]?.string ?? "", createdAt: i(r["created_at"]))
    }

    @discardableResult
    public func insert(id: String, title: String, filename: String, fileSize: Int64, importedAt: Int64, fileHash: String?) throws -> PdfRecord {
        try db.run("INSERT INTO pdfs (id, title, filename, page_count, file_size, imported_at, file_hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
                   [.text(id), .text(title), .text(filename), .integer(0), .integer(fileSize), .integer(importedAt), fileHash.map { .text($0) } ?? .null])
        onChange("pdf", id, "upsert")
        return PdfRecord(id: id, title: title, filename: filename, pageCount: 0, fileSize: fileSize, importedAt: importedAt, fileHash: fileHash)
    }

    public func findByHash(_ hash: String) throws -> PdfRecord? {
        try db.query("SELECT * FROM pdfs WHERE file_hash = ?", [.text(hash)]).first.map(Self.pdf)
    }

    @discardableResult
    public func attachFile(_ id: String, filename: String, fileSize: Int64, fileHash: String) throws -> PdfRecord? {
        try db.run("UPDATE pdfs SET filename = ?, file_size = CASE WHEN file_size > 0 THEN file_size ELSE ? END, file_hash = COALESCE(file_hash, ?) WHERE id = ?",
                   [.text(filename), .integer(fileSize), .text(fileHash), .text(id)])
        onChange("pdf", id, "upsert")
        return try get(id)
    }

    public func list() throws -> [PdfRecord] { try db.query("SELECT * FROM pdfs ORDER BY imported_at DESC").map(Self.pdf) }
    public func get(_ id: String) throws -> PdfRecord? { try db.query("SELECT * FROM pdfs WHERE id = ?", [.text(id)]).first.map(Self.pdf) }

    public func setPageCount(_ id: String, _ count: Int) throws {
        try db.run("UPDATE pdfs SET page_count = ? WHERE id = ?", [.integer(Int64(count)), .text(id)])
        onChange("pdf", id, "upsert")
    }

    public func rename(_ id: String, _ title: String) throws {
        try db.run("UPDATE pdfs SET title = ? WHERE id = ?", [.text(title.isEmpty ? "Untitled" : title), .text(id)])
        onChange("pdf", id, "upsert")
    }

    /// Deletes the row, its highlights and bookmarks; returns the stored filename so the caller can remove the file.
    @discardableResult
    public func deleteRow(_ id: String) throws -> String? {
        let filename = try db.query("SELECT filename FROM pdfs WHERE id = ?", [.text(id)]).first?["filename"]?.string
        try db.exec("SAVEPOINT pdf_delete")
        do {
            try db.run("DELETE FROM pdf_highlights WHERE pdf_id = ?", [.text(id)])
            try db.run("DELETE FROM pdf_bookmarks WHERE pdf_id = ?", [.text(id)])
            try db.run("DELETE FROM pdfs WHERE id = ?", [.text(id)])
            try db.exec("RELEASE pdf_delete")
        } catch { try? db.exec("ROLLBACK TO pdf_delete"); try? db.exec("RELEASE pdf_delete"); throw error }
        onChange("pdf", id, "delete")
        return filename
    }

    public func highlights(_ pdfId: String) throws -> [PdfHighlight] {
        try db.query("SELECT * FROM pdf_highlights WHERE pdf_id = ? ORDER BY page ASC, created_at ASC", [.text(pdfId)]).map(Self.highlight)
    }

    @discardableResult
    public func addHighlight(pdfId: String, page: Int, rects: [PdfRect], color: String, text: String, note: String? = nil) throws -> String {
        let id = uuid(), t = now()
        try db.run("INSERT INTO pdf_highlights (id, pdf_id, page, rects_json, color, text, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                   [.text(id), .text(pdfId), .integer(Int64(page)), .text(Self.rectsJSON(rects)), .text(color), .text(text),
                    note.map { .text($0) } ?? .null, .integer(t)])
        onChange("pdf_highlight", id, "upsert")
        return id
    }

    public func removeHighlight(_ id: String) throws {
        try db.run("DELETE FROM pdf_highlights WHERE id = ?", [.text(id)])
        onChange("pdf_highlight", id, "delete")
    }

    public func setHighlightNote(_ id: String, _ note: String) throws {
        try db.run("UPDATE pdf_highlights SET note = ? WHERE id = ?", [.text(note), .text(id)])
        onChange("pdf_highlight", id, "upsert")
    }

    public func bookmarks(_ pdfId: String) throws -> [PdfBookmark] {
        try db.query("SELECT * FROM pdf_bookmarks WHERE pdf_id = ? ORDER BY page ASC, created_at ASC", [.text(pdfId)]).map(Self.bookmark)
    }

    @discardableResult
    public func addBookmark(_ pdfId: String, page: Int, label: String, createdAt: Int64? = nil) throws -> PdfBookmark {
        let id = uuid(), t = now()
        try db.run("INSERT INTO pdf_bookmarks (id, pdf_id, page, label, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                   [.text(id), .text(pdfId), .integer(Int64(page)), .text(label), .integer(createdAt ?? t), .integer(t)])
        onChange("pdf_bookmark", id, "upsert")
        return PdfBookmark(id: id, pdfId: pdfId, page: page, label: label, createdAt: createdAt ?? t)
    }

    /// Renames a bookmark (the original stores "Page N" when no label is given).
    public func renameBookmark(_ id: String, label: String) throws {
        try db.run("UPDATE pdf_bookmarks SET label = ?, updated_at = ? WHERE id = ?", [.text(label), .integer(now()), .text(id)])
        onChange("pdf_bookmark", id, "upsert")
    }

    public func removeBookmark(_ id: String) throws {
        try db.run("DELETE FROM pdf_bookmarks WHERE id = ?", [.text(id)])
        onChange("pdf_bookmark", id, "delete")
    }
}
