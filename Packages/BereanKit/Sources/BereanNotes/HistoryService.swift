import Foundation
import BereanCore
import BereanSQLite

/// One navigation history entry (`history` table; device-local, never synced).
public struct HistoryEntry: Equatable, Sendable, Identifiable {
    public var id, type, title: String
    public var timestamp: Int64
    public var sessionId, sessionName, bookId: String?
    public var chapter, verse: Int?
    public var noteId, strongsNum, videoId, query, parentId, importSource: String?
    public var importCount: Int?
    public init(id: String, type: String, title: String, timestamp: Int64, sessionId: String? = nil, sessionName: String? = nil, bookId: String? = nil,
                chapter: Int? = nil, verse: Int? = nil, noteId: String? = nil, strongsNum: String? = nil, videoId: String? = nil, query: String? = nil,
                parentId: String? = nil, importSource: String? = nil, importCount: Int? = nil) {
        self.id = id; self.type = type; self.title = title; self.timestamp = timestamp; self.sessionId = sessionId; self.sessionName = sessionName
        self.bookId = bookId; self.chapter = chapter; self.verse = verse; self.noteId = noteId; self.strongsNum = strongsNum; self.videoId = videoId
        self.query = query; self.parentId = parentId; self.importSource = importSource; self.importCount = importCount
    }
    /// The fields the existing store compares to skip a duplicate within 5 minutes (addHistoryEntry).
    func sameDestination(_ o: HistoryEntry) -> Bool {
        type == o.type && bookId == o.bookId && chapter == o.chapter && verse == o.verse && noteId == o.noteId && strongsNum == o.strongsNum
            && videoId == o.videoId && query == o.query && parentId == o.parentId
    }
}

/// Port of src/platform/services/historyService.ts (add with optional cap, getAll, getPage, delete, clear) plus the store's
/// 5-minute duplicate rule from `addHistoryEntry`.
public final class HistoryService: @unchecked Sendable {
    let db: SQLiteConnection
    public static let dedupWindowMs: Int64 = 5 * 60 * 1000
    public init(db: SQLiteConnection) { self.db = db }

    static func t(_ s: String?) -> SQLiteValue { s.map { .text($0) } ?? .null }
    static func i(_ v: Int?) -> SQLiteValue { v.map { .integer(Int64($0)) } ?? .null }

    /// Adds an entry unless the newest entry is the same destination and less than 5 minutes old. Returns false when skipped.
    @discardableResult
    public func add(_ e: HistoryEntry, maxEntries: Int? = nil) throws -> Bool {
        if let last = try page(before: Int64.max, limit: 1).first, e.timestamp - last.timestamp < Self.dedupWindowMs, last.sameDestination(e) { return false }
        try db.run("""
            INSERT OR REPLACE INTO history (id, type, title, timestamp, session_id, session_name, book_id, chapter, verse,
              note_id, strongs_num, video_id, query, parent_id, import_source, import_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [.text(e.id), .text(e.type), .text(e.title), .integer(e.timestamp), Self.t(e.sessionId), Self.t(e.sessionName), Self.t(e.bookId),
                  Self.i(e.chapter), Self.i(e.verse), Self.t(e.noteId), Self.t(e.strongsNum), Self.t(e.videoId), Self.t(e.query), Self.t(e.parentId),
                  Self.t(e.importSource), Self.i(e.importCount)])
        if let maxEntries, maxEntries > 0 {
            try db.run("DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY timestamp DESC LIMIT ?)", [.integer(Int64(maxEntries))])
        }
        return true
    }

    public func all(limit: Int = 300) throws -> [HistoryEntry] { try page(before: Int64.max, limit: limit) }

    public func page(before ts: Int64, limit: Int = 300) throws -> [HistoryEntry] {
        try db.query("SELECT * FROM history WHERE timestamp < ? ORDER BY timestamp DESC LIMIT ?", [.integer(ts), .integer(Int64(limit))]).map { r in
            func s(_ k: String) -> String? { r[k]?.string }
            func n(_ k: String) -> Int? { if case .integer(let x) = r[k] { return Int(x) }; return nil }
            return HistoryEntry(id: s("id") ?? "", type: s("type") ?? "", title: s("title") ?? "", timestamp: Int64(n("timestamp") ?? 0), sessionId: s("session_id"),
                                sessionName: s("session_name"), bookId: s("book_id"), chapter: n("chapter"), verse: n("verse"), noteId: s("note_id"),
                                strongsNum: s("strongs_num"), videoId: s("video_id"), query: s("query"), parentId: s("parent_id"),
                                importSource: s("import_source"), importCount: n("import_count"))
        }
    }

    public func delete(_ id: String) throws { try db.run("DELETE FROM history WHERE id = ?", [.text(id)]) }
    public func clear() throws { try db.run("DELETE FROM history") }
}
