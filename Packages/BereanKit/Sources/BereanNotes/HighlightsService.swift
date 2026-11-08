import Foundation
import BereanSQLite

/// Verse highlights — port of src/platform/services/highlightsService.ts (whole verse, word range or
/// character range; toggling the same colour removes, another colour recolours). Ids are deterministic
/// (`hl-<text>-<book>-<ch>-<v>-<range>`), as in TypeScript, so two devices highlighting the same span converge.
public struct Highlight: Equatable, Sendable, Identifiable {
    public var id: String, color: String
    public var startWord: Int?, endWord: Int?, startChar: Int?, endChar: Int?
}

public enum HighlightToggle: Equatable, Sendable { case created(String, String), updated(String, String), removed(String) }

public final class HighlightsService: @unchecked Sendable {
    let db: SQLiteConnection
    let now: @Sendable () -> Int64
    let onChange: @Sendable (_ entity: String, _ id: String?, _ op: String, _ scope: String?) -> Void

    public init(db: SQLiteConnection, now: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) },
                onChange: @escaping @Sendable (_ entity: String, _ id: String?, _ op: String, _ scope: String?) -> Void = { _, _, _, _ in }) {
        self.db = db; self.now = now; self.onChange = onChange
    }

    /// `getChapter` — verse number → highlights (by creation time).
    public func chapter(_ bookId: String, _ chapter: Int, textId: String = "kjva") throws -> [Int: [Highlight]] {
        var out: [Int: [Highlight]] = [:]
        for r in try db.query("""

                  SELECT id, verse_num, color, start_word, end_word, start_char, end_char, created_at
                  FROM highlights
                  WHERE text_id = ? AND book_id = ? AND chapter = ?
                  ORDER BY verse_num, created_at

            """, [.text(textId), .text(bookId), .integer(Int64(chapter))]) {
            out[r["verse_num"]?.int ?? 0, default: []].append(Highlight(id: r["id"]!.string!, color: r["color"]?.string ?? "yellow",
                startWord: r["start_word"]?.int, endWord: r["end_word"]?.int, startChar: r["start_char"]?.int, endChar: r["end_char"]?.int))
        }
        return out
    }

    /// `toggle`. Character offsets win over word offsets; both are optional (whole verse).
    @discardableResult
    public func toggle(bookId: String, chapter: Int, verse: Int, color: String, textId: String = "kjva",
                       startWord: Int? = nil, endWord: Int? = nil, startChar: Int? = nil, endChar: Int? = nil) throws -> HighlightToggle {
        let isChar = startChar != nil && endChar != nil
        let isWord = !isChar && startWord != nil && endWord != nil
        let base: [SQLiteValue] = [.text(textId), .text(bookId), .integer(Int64(chapter)), .integer(Int64(verse))]
        let existing: SQLiteRow?
        if isChar {
            existing = try db.query("SELECT id, color FROM highlights WHERE text_id = ? AND book_id = ? AND chapter = ? AND verse_num = ? AND start_char = ? AND end_char = ? LIMIT 1",
                                    base + [.integer(Int64(startChar!)), .integer(Int64(endChar!))]).first
        } else if isWord {
            existing = try db.query("SELECT id, color FROM highlights WHERE text_id = ? AND book_id = ? AND chapter = ? AND verse_num = ? AND start_word = ? AND end_word = ? AND start_char IS NULL LIMIT 1",
                                    base + [.integer(Int64(startWord!)), .integer(Int64(endWord!))]).first
        } else {
            existing = try db.query("SELECT id, color FROM highlights WHERE text_id = ? AND book_id = ? AND chapter = ? AND verse_num = ? AND start_word IS NULL AND start_char IS NULL LIMIT 1", base).first
        }
        if let existing, let id = existing.values[0].string {
            if existing.values[1].string == color {
                try db.run("DELETE FROM highlights WHERE id = ?", [.text(id)])
                onChange("highlight", id, "delete", nil)
                return .removed(id)
            }
            try db.run("UPDATE highlights SET color = ? WHERE id = ?", [.text(color), .text(id)])
            onChange("highlight", id, "upsert", nil)
            return .updated(id, color)
        }
        let range = isChar ? "c\(startChar!)-\(endChar!)" : isWord ? "w\(startWord!)-\(endWord!)" : "v"
        let id = "hl-\(textId)-\(bookId)-\(chapter)-\(verse)-\(range)"
        func i(_ x: Int?, _ on: Bool) -> SQLiteValue { on && x != nil ? .integer(Int64(x!)) : .null }
        try db.run("""

                  INSERT INTO highlights (id, text_id, book_id, chapter, verse_num, color, start_word, end_word, start_char, end_char, created_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

            """, [.text(id)] + base + [.text(color), i(startWord, isWord), i(endWord, isWord), i(startChar, isChar), i(endChar, isChar), .integer(now())])
        onChange("highlight", id, "upsert", nil)
        return .created(id, color)
    }

    /// `remove` — every highlight on a verse.
    public func remove(bookId: String, chapter: Int, verse: Int, textId: String = "kjva") throws {
        try db.run("\n      DELETE FROM highlights WHERE text_id = ? AND book_id = ? AND chapter = ? AND verse_num = ?\n    ",
                   [.text(textId), .text(bookId), .integer(Int64(chapter)), .integer(Int64(verse))])
        onChange("highlight", nil, "bulk", "\(textId):\(bookId):\(chapter):\(verse)")
    }
}
