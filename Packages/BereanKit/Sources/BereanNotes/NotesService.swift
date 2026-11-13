import Foundation
import BereanCore
import BereanSQLite
import BereanReference
import BereanBible

/// A note as the apps use it — port of `rowToNote` (src/platform/services/notesService.ts).
public struct Note: Equatable, Sendable, Identifiable {
    public var id, type, title, content: String
    public var verseRef: String?
    public var color: String
    public var icon, status: String?
    public var createdAt, updatedAt: Int64
    public var tags: [String]
    public var importedAt: Int64?
    public var folderId: String?
    public var textId: String
    public var idiomTerm, idiomMeaning: String?
    public var idiomAliases: [String]?
    public var idiomAutoVariants: Bool
    public var idiomData: JSValue?
    public var deletedAt: Int64?
    public var pinned, aiExcluded: Bool

    public var displayTitle: String { title.isEmpty ? "Untitled" : title }

    public init(id: String, type: String, title: String, content: String, verseRef: String?, color: String, icon: String?, status: String?,
                createdAt: Int64, updatedAt: Int64, tags: [String], importedAt: Int64?, folderId: String?, textId: String,
                idiomTerm: String?, idiomMeaning: String?, idiomAliases: [String]?, idiomAutoVariants: Bool, idiomData: JSValue?,
                deletedAt: Int64?, pinned: Bool, aiExcluded: Bool) {
        self.id = id; self.type = type; self.title = title; self.content = content; self.verseRef = verseRef; self.color = color
        self.icon = icon; self.status = status; self.createdAt = createdAt; self.updatedAt = updatedAt; self.tags = tags
        self.importedAt = importedAt; self.folderId = folderId; self.textId = textId; self.idiomTerm = idiomTerm
        self.idiomMeaning = idiomMeaning; self.idiomAliases = idiomAliases; self.idiomAutoVariants = idiomAutoVariants
        self.idiomData = idiomData; self.deletedAt = deletedAt; self.pinned = pinned; self.aiExcluded = aiExcluded
    }
}

public struct NoteFolder: Equatable, Sendable, Identifiable {
    public var id, name: String
    public var parentId: String?
    public var createdAt: Int64
    public var aiExcluded: Bool
}

/// One saved snapshot of a note (`note_versions` row).
public struct NoteVersion: Equatable, Sendable, Identifiable {
    public var id, noteId, title, content, kind: String
    public var createdAt: Int64
}

public enum NoteVersionResult: Equatable, Sendable {
    case created(id: String), skipped
}

public enum NoteRestoreResult: Equatable, Sendable {
    case restored(content: String), versionNotFound, noteNotFound
}

public enum NotesWordMode: String, Sendable { case all, any, phrase }

/// Notes read path (lists, search, verse/chapter lookups with KJV⇄LXX cross-links, trash, daily dates).
/// Writes (create/update/versions) come with the editor milestone (M7).
public final class NotesService: @unchecked Sendable {
    let db: SQLiteConnection
    let now: @Sendable () -> Int64
    let uuid: @Sendable () -> String
    let onChange: @Sendable (_ entity: String, _ id: String, _ op: String) -> Void

    public init(db: SQLiteConnection, now: @escaping @Sendable () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) },
                uuid: @escaping @Sendable () -> String = { UUID().uuidString.lowercased() },
                onChange: @escaping @Sendable (_ entity: String, _ id: String, _ op: String) -> Void = { _, _, _ in }) {
        self.db = db; self.now = now; self.uuid = uuid; self.onChange = onChange
    }

    static func i64(_ v: SQLiteValue?) -> Int64? { if case .integer(let i) = v { return i }; if case .real(let d) = v { return Int64(d) }; return nil }

    static func note(_ r: SQLiteRow) -> Note {
        func s(_ k: String) -> String? { r[k]?.string }
        func parse(_ t: String?) -> JSValue? { t.flatMap { try? JSON.parse($0) } }
        return Note(id: s("id")!, type: s("type") ?? "general", title: s("title") ?? "", content: s("content") ?? "", verseRef: s("verse_ref"),
                    color: s("color") ?? "blue", icon: s("icon"), status: s("status"), createdAt: i64(r["created_at"]) ?? 0, updatedAt: i64(r["updated_at"]) ?? 0,
                    tags: parse(s("tags"))?.arrayValue?.compactMap { $0.stringValue?.string } ?? [], importedAt: i64(r["imported_at"]), folderId: s("folder_id"),
                    textId: s("text_id") ?? "kjva", idiomTerm: s("idiom_term"), idiomMeaning: s("idiom_meaning"),
                    idiomAliases: s("idiom_aliases").flatMap { $0.isEmpty ? nil : parse($0)?.arrayValue?.compactMap { $0.stringValue?.string } },
                    idiomAutoVariants: i64(r["idiom_auto_variants"]) == 1, idiomData: s("idiom_data").flatMap { $0.isEmpty ? nil : parse($0) },
                    deletedAt: i64(r["deleted_at"]), pinned: i64(r["pinned"]) == 1, aiExcluded: i64(r["ai_excluded"]) == 1)
    }

    public func all(limit: Int = 200, offset: Int = 0) throws -> [Note] {
        try db.query("SELECT * FROM notes WHERE deleted_at IS NULL ORDER BY updated_at DESC LIMIT ? OFFSET ?", [.integer(Int64(limit)), .integer(Int64(offset))]).map(Self.note)
    }
    public func one(_ id: String) throws -> Note? { try db.query("SELECT * FROM notes WHERE id = ?", [.text(id)]).first.map(Self.note) }
    public func trash() throws -> [Note] { try db.query("SELECT * FROM notes WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC").map(Self.note) }
    public func folders() throws -> [NoteFolder] {
        try db.query("SELECT * FROM note_folders ORDER BY name COLLATE NOCASE").map { r in
            NoteFolder(id: r["id"]!.string!, name: r["name"]?.string ?? "", parentId: r["parent_id"]?.string, createdAt: Self.i64(r["created_at"]) ?? 0, aiExcluded: Self.i64(r["ai_excluded"]) == 1)
        }
    }

    // MARK: search

    /// `cleanNotesWords` — split on anything but ASCII letters, digits and apostrophes (like the unicode61 tokenizer).
    public static func cleanWords(_ q: String) -> [String] {
        var out: [String] = [], cur = ""
        for ch in q.trimmingCharacters(in: .whitespacesAndNewlines).unicodeScalars {
            if ch.isASCII && (ch.properties.isAlphabetic || ("0"..."9").contains(ch) || ch == "'") { cur.unicodeScalars.append(ch) }
            else if !cur.isEmpty { out.append(cur); cur = "" }
        }
        if !cur.isEmpty { out.append(cur) }
        return out
    }

    /// `safeNotesFts`.
    public static func ftsQuery(_ q: String, phrase: Bool) -> String {
        let words = cleanWords(q)
        if words.isEmpty { return "" }
        if phrase { return "\"\(words.joined(separator: " "))\"" }
        return words.map { w in
            let alts = BibleText.numberTokenAlternates(w)
            return alts.count > 1 ? "(\(alts.map { "\"\($0)\"*" }.joined(separator: " OR ")))" : "\"\(w)\"*"
        }.joined(separator: " AND ")
    }

    func untitled(_ limit: Int) throws -> [Note] {
        try db.query("SELECT * FROM notes WHERE (title = '' OR title IS NULL) AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT ?", [.integer(Int64(limit))]).map(Self.note)
    }

    static let matchSQL = """

                SELECT n.* FROM notes_fts f
                JOIN notes n ON n.rowid = f.rowid
                WHERE notes_fts MATCH ? AND n.deleted_at IS NULL
                ORDER BY n.updated_at DESC, n.id
                LIMIT ?

        """

    public func search(_ query: String, limit: Int = 20, mode: NotesWordMode = .all) throws -> [Note] {
        let includeUntitled = Self.cleanWords(query).contains { $0.lowercased() == "untitled" }
        var rows: [Note] = []
        var seen = Set<String>()
        if mode == .any {
            for term in Self.cleanWords(query) {
                let fts = Self.ftsQuery(term, phrase: false)
                if fts.isEmpty { continue }
                guard let r = try? db.query(Self.matchSQL, [.text(fts), .integer(Int64(max(limit * 3, 100)))]) else { continue }
                for n in r.map(Self.note) where seen.insert(n.id).inserted { rows.append(n) }
            }
        } else {
            let fts = Self.ftsQuery(query, phrase: mode == .phrase)
            if !fts.isEmpty { rows = ((try? db.query(Self.matchSQL, [.text(fts), .integer(Int64(limit))])) ?? []).map(Self.note) }
            seen = Set(rows.map(\.id))
        }
        if includeUntitled { for n in try untitled(limit) where seen.insert(n.id).inserted { rows.append(n) } }
        return Array(rows.prefix(limit))
    }

    /// Match Notes home filters against the full result set without loading note content a second time.
    public func matchingNoteIDs(_ query: String, mode: NotesWordMode = .all) throws -> Set<String> {
        let words = Self.cleanWords(query)
        guard !words.isEmpty else { return [] }
        // Like `search`, issue one query per prefix in Any Word mode.
        let expressions = mode == .any
            ? words.map { Self.ftsQuery($0, phrase: false) }
            : [Self.ftsQuery(query, phrase: mode == .phrase)]
        let sql = """
            SELECT n.id FROM notes_fts
            JOIN notes n ON n.rowid = notes_fts.rowid
            WHERE notes_fts MATCH ? AND n.deleted_at IS NULL
            """
        var ids = Set<String>()
        for expression in expressions {
            let rows = try db.query(sql, [.text(expression)])
            ids.formUnion(rows.compactMap { $0["id"]?.string })
        }
        if words.contains(where: { $0.lowercased() == "untitled" }) {
            let untitled = try db.query("SELECT id FROM notes WHERE (title = '' OR title IS NULL) AND deleted_at IS NULL")
            ids.formUnion(untitled.compactMap { $0["id"]?.string })
        }
        return ids
    }

    // MARK: verse / chapter (KJV and LXX cross-linked)

    static func tidClause(_ t: String) -> String { t == "kjva" ? "(text_id = 'kjva' OR text_id IS NULL)" : "text_id = 'lxx'" }

    public func byVerse(_ verseRef: String, textId: String = "kjva") throws -> [Note] {
        let parts = verseRef.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        if textId != "kjva" && textId != "lxx" {
            return try db.query("SELECT * FROM notes WHERE verse_ref = ? AND text_id = ? AND deleted_at IS NULL ORDER BY created_at ASC", [.text(verseRef), .text(textId)]).map(Self.note)
        }
        let other = textId == "kjva" ? "lxx" : "kjva"
        let own = try db.query("SELECT * FROM notes WHERE verse_ref = ? AND \(Self.tidClause(textId)) AND deleted_at IS NULL ORDER BY created_at ASC", [.text(verseRef)]).map(Self.note)
        var others: [Note] = []
        if parts.count > 2, let ch = Int(parts[1]), !parts[0].isEmpty, !parts[2].isEmpty {
            var seen = Set<String>()
            for c in ChapterMap.equivalentChapters(parts[0], ch, from: textId, to: other) {
                for n in try db.query("SELECT * FROM notes WHERE verse_ref = ? AND \(Self.tidClause(other)) AND deleted_at IS NULL ORDER BY created_at ASC", [.text("\(parts[0]).\(c).\(parts[2])")]).map(Self.note)
                where seen.insert(n.id).inserted { others.append(n) }
            }
        }
        return Self.stableSort(own + others) { $0.createdAt < $1.createdAt }
    }

    func chapterNotes(_ bookId: String, _ chapter: Int, tid: String, param: String? = nil) throws -> [Note] {
        let ref = "\(bookId).\(chapter)", prefix = "\(ref)."
        var params: [SQLiteValue] = [.text(ref), .text(prefix + "%"), .text(prefix + "%.%")]
        if let param { params.append(.text(param)) }
        return try db.query("SELECT * FROM notes WHERE (verse_ref = ? OR (verse_ref LIKE ? AND verse_ref NOT LIKE ?)) AND deleted_at IS NULL AND \(tid)", params).map(Self.note)
    }

    static func stableSort(_ a: [Note], _ less: (Note, Note) -> Bool) -> [Note] {
        a.enumerated().sorted { less($0.element, $1.element) || (!less($1.element, $0.element) && $0.offset < $1.offset) }.map(\.element)
    }
    /// `localeCompare` on verse refs (uppercase ids, digits and dots: code-unit order with case-insensitive letters).
    static func refLess(_ a: Note, _ b: Note) -> Bool { (a.verseRef ?? "").uppercased().utf16.lexicographicallyPrecedes((b.verseRef ?? "").uppercased().utf16) }

    public func byChapter(_ bookId: String, _ chapter: Int, textId: String = "kjva") throws -> [Note] {
        if textId != "kjva" && textId != "lxx" { return Self.stableSort(try chapterNotes(bookId, chapter, tid: "text_id = ?", param: textId), Self.refLess) }
        let own = try chapterNotes(bookId, chapter, tid: Self.tidClause(textId))
        let other = textId == "kjva" ? "lxx" : "kjva"
        var seen = Set(own.map(\.id)), others: [Note] = []
        for c in ChapterMap.equivalentChapters(bookId, chapter, from: textId, to: other) {
            for n in try chapterNotes(bookId, c, tid: Self.tidClause(other)) where seen.insert(n.id).inserted { others.append(n) }
        }
        return Self.stableSort(own + others, Self.refLess)
    }

    /// Notes attached to this verse or to a range that contains it. Chapter notes
    /// remain available in the chapter view.
    public func coveringVerse(_ bookId: String, _ chapter: Int, _ verse: Int, textId: String) throws -> [Note] {
        let candidates = try byChapter(bookId, chapter, textId: textId)
        let matching = candidates.filter { note in
            guard let ref = note.verseRef, let attachment = Reference.parseNoteAttachment(ref),
                  attachment.bookId == bookId, let start = attachment.verse else { return false }
            // byChapter has already matched the attachment chapter for the note's edition.
            return verse >= start && verse <= (attachment.endVerse ?? start)
        }
        return Self.stableSort(matching) { $0.createdAt < $1.createdAt }
    }

    func verseRefs(_ bookId: String, _ chapter: Int, tid: String, param: String? = nil) throws -> [String] {
        let prefix = "\(bookId).\(chapter)."
        var params: [SQLiteValue] = [.text(prefix + "%"), .text(prefix + "%.%")]
        if let param { params.append(.text(param)) }
        return try db.query("SELECT verse_ref FROM notes WHERE verse_ref LIKE ? AND verse_ref NOT LIKE ? AND deleted_at IS NULL AND \(tid)", params).compactMap { $0.values[0].string }
    }

    /// `getChapterCounts` — verse number → note count (for the verse dots).
    public func chapterCounts(_ bookId: String, _ chapter: Int, textId: String = "kjva") throws -> [Int: Int] {
        var refs: [String]
        if textId != "kjva" && textId != "lxx" { refs = try verseRefs(bookId, chapter, tid: "text_id = ?", param: textId) } else {
            refs = try verseRefs(bookId, chapter, tid: Self.tidClause(textId))
            let other = textId == "kjva" ? "lxx" : "kjva"
            for c in ChapterMap.equivalentChapters(bookId, chapter, from: textId, to: other) { refs += try verseRefs(bookId, c, tid: Self.tidClause(other)) }
        }
        var counts: [Int: Int] = [:]
        for r in refs {
            let p = r.split(separator: ".", omittingEmptySubsequences: false)
            if p.count > 2, let v = JSText.parseInt(String(p[2])), v != 0, let iv = Int(exactly: v) { counts[iv, default: 0] += 1 }
        }
        return counts
    }

    // MARK: daily notes

    static let longDate: DateFormatter = { let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "MMMM d, yyyy"; return f }()

    /// `dailyTitleDateKey` ("Daily — 2026-01-09" or the older "Daily — January 9, 2026").
    public static func dailyDateKey(_ title: String) -> String? {
        var s = title
        for p in ["Daily — ", "Journal — "] where s.hasPrefix(p) { s.removeFirst(p.count); break }
        if s.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil { return s }
        guard let d = longDate.date(from: s) else { return nil }
        let c = Calendar.current.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    public func dailyDates() throws -> [(dateKey: String, noteId: String, length: Int)] {
        var best: [String: (String, Int)] = [:]
        for r in try db.query("SELECT id, title, type, length(content) AS len FROM notes WHERE deleted_at IS NULL AND (type IN ('daily', 'journal') OR title LIKE 'Daily — %' OR title LIKE 'Journal — %')") {
            guard let key = Self.dailyDateKey(r["title"]?.string ?? "") else { continue }
            let len = r["len"]?.int ?? 0
            if best[key] == nil || len > best[key]!.1 { best[key] = (r["id"]!.string!, len) }
        }
        return best.keys.sorted().map { ($0, best[$0]!.0, best[$0]!.1) }
    }

    // MARK: writes (create / update / trash / folders) — same rules and change events as notesService.ts

    public struct Draft: Sendable {
        public var id: String?
        public var type: String?, title: String?, content: String?, verseRef: String?, color: String?, icon: String?
        /// `.some(nil)` = explicitly no status; `nil` = apply the user's default status setting.
        public var status: String??
        public var tags: [String]?, textId: String?, folderId: String?, idiomTerm: String?, idiomMeaning: String?, idiomAliases: [String]?, idiomAutoVariants: Bool?
        public init(id: String? = nil, type: String? = nil, title: String? = nil, content: String? = nil, verseRef: String? = nil, color: String? = nil, icon: String? = nil,
                    status: String?? = nil, tags: [String]? = nil, textId: String? = nil, folderId: String? = nil, idiomTerm: String? = nil, idiomMeaning: String? = nil,
                    idiomAliases: [String]? = nil, idiomAutoVariants: Bool? = nil) {
            self.id = id; self.type = type; self.title = title; self.content = content; self.verseRef = verseRef; self.color = color; self.icon = icon; self.status = status
            self.tags = tags; self.textId = textId; self.folderId = folderId; self.idiomTerm = idiomTerm; self.idiomMeaning = idiomMeaning; self.idiomAliases = idiomAliases
            self.idiomAutoVariants = idiomAutoVariants
        }
    }

    static func t(_ s: String?) -> SQLiteValue { s.map { .text($0) } ?? .null }
    static func jsonArray(_ a: [String]) -> String { JSON.stringify(.array(a.map { .string(JSString($0)) })).string }

    /// `create` — returns the note and whether a note with the caller-chosen id already existed.
    public func create(_ d: Draft) throws -> (note: Note, existed: Bool) {
        let dateKey = d.type == "daily" ? d.title.flatMap(Self.dailyDateKey) : nil
        let dailyId = dateKey.map { "daily-\($0)" }
        if let id = d.id, try one(id) != nil { return (try one(id)!, true) }
        var id = d.id
        if id == nil {
            if let dailyId, try db.query("SELECT 1 FROM notes WHERE id = ?", [.text(dailyId)]).isEmpty { id = dailyId } else { id = uuid() }
        }
        let n = now()
        var status: String? = d.status ?? nil
        if d.status == nil {
            let raw = try db.query("SELECT value FROM settings WHERE key = ?", [.text("defaultNoteStatus")]).first?.values.first?.string
            let def = raw.flatMap { try? JSON.parse($0) }?.stringValue?.string ?? "none"
            status = !def.isEmpty && def != "none" ? def : nil
        }
        try db.run("""

              INSERT INTO notes (id, type, title, content, verse_ref, color, icon, status, created_at, updated_at, tags, text_id, folder_id, idiom_term, idiom_meaning, idiom_aliases, idiom_auto_variants)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

            """, [.text(id!), .text(d.type ?? "general"), Self.t(d.title), .text(d.content ?? ""), Self.t(d.verseRef), .text(d.color ?? "blue"), Self.t(d.icon), Self.t(status),
                  .integer(n), .integer(n), .text(Self.jsonArray(d.tags ?? [])), .text(d.textId ?? "kjva"), Self.t(d.folderId), Self.t(d.idiomTerm), Self.t(d.idiomMeaning),
                  d.idiomAliases.map { .text(Self.jsonArray($0)) } ?? .null, .integer(d.idiomAutoVariants == true ? 1 : 0)])
        onChange("note", id!, "upsert")
        return (try one(id!)!, false)
    }

    public struct Update: Sendable {
        public var title: String?, content: String?, color: String?, icon: String??, status: String??, tags: [String]?
        public var idiomTerm: String?, idiomMeaning: String?, idiomAliases: [String]?, idiomAutoVariants: Bool?, idiomData: JSValue??
        public init(title: String? = nil, content: String? = nil, color: String? = nil, icon: String?? = nil, status: String?? = nil, tags: [String]? = nil,
                    idiomTerm: String? = nil, idiomMeaning: String? = nil, idiomAliases: [String]? = nil, idiomAutoVariants: Bool? = nil, idiomData: JSValue?? = nil) {
            self.title = title; self.content = content; self.color = color; self.icon = icon; self.status = status; self.tags = tags; self.idiomTerm = idiomTerm
            self.idiomMeaning = idiomMeaning; self.idiomAliases = idiomAliases; self.idiomAutoVariants = idiomAutoVariants; self.idiomData = idiomData
        }
    }

    /// `update` — false when the note does not exist. Empty strings clear icon/status/idiom fields, as in TypeScript.
    @discardableResult
    public func update(_ id: String, _ u: Update) throws -> Bool {
        if try db.query("SELECT id FROM notes WHERE id = ?", [.text(id)]).isEmpty { return false }
        var fields = ["updated_at = ?"], values: [SQLiteValue] = [.integer(now())]
        func nonEmpty(_ s: String?) -> SQLiteValue { (s?.isEmpty ?? true) ? .null : .text(s!) }
        if let v = u.title { fields.append("title = ?"); values.append(.text(v)) }
        if let v = u.content { fields.append("content = ?"); values.append(.text(v)) }
        if let v = u.color { fields.append("color = ?"); values.append(.text(v)) }
        if let v = u.icon { fields.append("icon = ?"); values.append(nonEmpty(v)) }
        if let v = u.status { fields.append("status = ?"); values.append(nonEmpty(v)) }
        if let v = u.tags { fields.append("tags = ?"); values.append(.text(Self.jsonArray(v))) }
        if let v = u.idiomTerm { fields.append("idiom_term = ?"); values.append(nonEmpty(v)) }
        if let v = u.idiomMeaning { fields.append("idiom_meaning = ?"); values.append(nonEmpty(v)) }
        if let v = u.idiomAliases { fields.append("idiom_aliases = ?"); values.append(v.isEmpty ? .null : .text(Self.jsonArray(v))) }
        if let v = u.idiomAutoVariants { fields.append("idiom_auto_variants = ?"); values.append(.integer(v ? 1 : 0)) }
        if let v = u.idiomData { fields.append("idiom_data = ?"); values.append(v.map { .text(JSON.stringify($0).string) } ?? .null) }
        values.append(.text(id))
        try db.run("UPDATE notes SET \(fields.joined(separator: ", ")) WHERE id = ?", values)
        onChange("note", id, "upsert")
        return true
    }

    public func setAiExcluded(_ noteId: String, _ excluded: Bool) throws {
        try db.run("UPDATE notes SET ai_excluded = ? WHERE id = ?", [.integer(excluded ? 1 : 0), .text(noteId)])
        onChange("note", noteId, "upsert")
    }

    public enum ImportOutcome: Equatable, Sendable { case created(String), updated(String) }

    /// Imports one Markdown file as the iPhone Notes "Import" does (NotesHomePage.importMarkdown): a file whose
    /// `berean_id` names an existing (not trashed) note updates it; anything else becomes a new note. The file
    /// name minus .md/.markdown/.txt is the fallback title. `ai_excluded: true` is applied, never cleared.
    @discardableResult
    public func importMarkdown(_ text: String, fileName: String) throws -> ImportOutcome {
        var base = fileName
        for ext in [".md", ".markdown", ".txt"] where base.lowercased().hasSuffix(ext) { base = String(base.dropLast(ext.count)); break }
        let p = NoteMarkdownFile.parse(text, fallbackTitle: base)
        if let id = p.bereanId, let existing = try one(id), existing.deletedAt == nil {
            _ = try update(existing.id, .init(title: p.title, content: p.content, color: p.color, icon: p.icon.map { .some($0) }, tags: p.tags))
            if p.aiExcluded == true { try setAiExcluded(existing.id, true) }
            return .updated(existing.id)
        }
        let note = try create(.init(type: p.type, title: p.title, content: p.content, verseRef: p.verseRef, color: p.color, icon: p.icon, tags: p.tags)).note
        if p.aiExcluded == true { try setAiExcluded(note.id, true) }
        return .created(note.id)
    }

    // MARK: version history (createVersion / getVersions / restoreVersion in notesService.ts)

    /// Snapshots a note unless the content equals its latest snapshot. `kind`: auto, manual (pre-restore is internal).
    @discardableResult
    public func createVersion(noteId: String, title: String, content: String, kind: String = "auto") throws -> NoteVersionResult {
        if let last = try db.query("SELECT content FROM note_versions WHERE note_id = ? ORDER BY created_at DESC LIMIT 1", [.text(noteId)]).first,
           last.values[0].string == content { return .skipped }
        let id = uuid()
        try db.run("INSERT INTO note_versions (id, note_id, title, content, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                   [.text(id), .text(noteId), .text(title), .text(content), .text(kind), .integer(now())])
        try pruneVersions(noteId)
        onChange("note_version", id, "upsert")
        return .created(id: id)
    }

    public func versions(of noteId: String) throws -> [NoteVersion] {
        try db.query("SELECT * FROM note_versions WHERE note_id = ? ORDER BY created_at DESC", [.text(noteId)]).map { r in
            NoteVersion(id: r["id"]?.string ?? "", noteId: r["note_id"]?.string ?? "", title: r["title"]?.string ?? "",
                        content: r["content"]?.string ?? "", kind: r["kind"]?.string ?? "", createdAt: Self.i64(r["created_at"]) ?? 0)
        }
    }

    /// Restores a version's content, first snapshotting the current content as `pre-restore` so it can be undone.
    @discardableResult
    public func restoreVersion(noteId: String, versionId: String) throws -> NoteRestoreResult {
        guard let ver = try db.query("SELECT * FROM note_versions WHERE id = ?", [.text(versionId)]).first else { return .versionNotFound }
        guard let cur = try db.query("SELECT title, content FROM notes WHERE id = ?", [.text(noteId)]).first else { return .noteNotFound }
        let content = ver["content"]?.string ?? ""
        if cur["content"]?.string != ver["content"]?.string {
            let pre = uuid()
            try db.run("INSERT INTO note_versions (id, note_id, title, content, kind, created_at) VALUES (?, ?, ?, ?, 'pre-restore', ?)",
                       [.text(pre), .text(noteId), cur["title"]?.string.map { .text($0) } ?? .null, Self.t(cur["content"]?.string), .integer(now())])
            onChange("note_version", pre, "upsert")
        }
        try db.run("UPDATE notes SET content = ?, updated_at = ? WHERE id = ?", [Self.t(ver["content"]?.string), .integer(now()), .text(noteId)])
        try pruneVersions(noteId)
        onChange("note", noteId, "upsert")
        return .restored(content: content)
    }

    /// Keep everything from the last 7 days, then one (newest) per UTC day, always the newest and manual /
    /// pre-restore snapshots — capped at 50 in all.
    func pruneVersions(_ noteId: String) throws {
        let rows = try db.query("SELECT id, kind, created_at FROM note_versions WHERE note_id = ? ORDER BY created_at DESC", [.text(noteId)])
        guard rows.count > 50 else { return }
        let weekAgo = now() - 7 * 24 * 60 * 60 * 1000
        var keep = Set<String>(), seenDay = Set<String>()
        for (i, r) in rows.enumerated() {
            let id = r["id"]?.string ?? "", kind = r["kind"]?.string ?? "", at = Self.i64(r["created_at"]) ?? 0
            if i == 0 || kind == "manual" || kind == "pre-restore" || at >= weekAgo { keep.insert(id); continue }
            let day = String(JSDate.isoString(at).prefix(10))
            if seenDay.insert(day).inserted { keep.insert(id) }
        }
        let finalKeep = Set(rows.compactMap { $0["id"]?.string }.filter { keep.contains($0) }.prefix(50))
        let toDelete = rows.compactMap { $0["id"]?.string }.filter { !finalKeep.contains($0) }
        if !toDelete.isEmpty {
            try db.run("DELETE FROM note_versions WHERE id IN (\(Array(repeating: "?", count: toDelete.count).joined(separator: ", ")))", toDelete.map { .text($0) })
        }
    }

    /// Soft delete (Trash).
    public func delete(_ id: String) throws {
        try db.run("UPDATE notes SET deleted_at = ? WHERE id = ?", [.integer(now()), .text(id)])
        onChange("note", id, "delete")
    }

    /// Restore from Trash (into root if its folder no longer exists).
    @discardableResult
    public func restore(_ id: String) throws -> Bool {
        guard let row = try db.query("SELECT folder_id FROM notes WHERE id = ?", [.text(id)]).first else { return false }
        var folder = row.values[0].string
        if let f = folder, try db.query("SELECT 1 FROM note_folders WHERE id = ?", [.text(f)]).isEmpty { folder = nil }
        try db.run("UPDATE notes SET deleted_at = NULL, folder_id = ? WHERE id = ?", [Self.t(folder), .text(id)])
        onChange("note", id, "upsert")
        return true
    }

    // MARK: folders and trash — folderDelete / folderDeleteDeep / folderSetParent / purgeTrashItem / emptyTrash

    /// Deletes a folder: its subfolders move up to its parent and its notes move to the root.
    public func deleteFolder(_ id: String) throws {
        let parent = try db.query("SELECT parent_id FROM note_folders WHERE id = ?", [.text(id)]).first?["parent_id"]?.string
        try tx {
            try db.run("UPDATE note_folders SET parent_id = ? WHERE parent_id = ?", [Self.t(parent), .text(id)])
            try db.run("UPDATE notes SET folder_id = NULL WHERE folder_id = ?", [.text(id)])
            try db.run("DELETE FROM note_folders WHERE id = ?", [.text(id)])
        }
        onChange("note_folder", id, "delete")
    }

    /// Deletes a folder and everything in it: descendant folders are removed and their notes go to Trash.
    @discardableResult
    public func deleteFolderDeep(_ id: String) throws -> [String] {
        var trashed: [String] = []
        try tx {
            var children: [String?: [String]] = [:]
            for r in try db.query("SELECT id, parent_id FROM note_folders") { children[r["parent_id"]?.string, default: []].append(r["id"]?.string ?? "") }
            var stack = [id], toDelete: [String] = []
            while let cur = stack.popLast() { toDelete.append(cur); stack += children[cur] ?? [] }
            let n = now()
            for fid in toDelete {
                trashed += try db.query("SELECT id FROM notes WHERE folder_id = ? AND deleted_at IS NULL", [.text(fid)]).compactMap { $0["id"]?.string }
                try db.run("UPDATE notes SET deleted_at = ? WHERE folder_id = ?", [.integer(n), .text(fid)])
                try db.run("DELETE FROM note_folders WHERE id = ?", [.text(fid)])
            }
        }
        onChange("note_folder", id, "delete")
        if !trashed.isEmpty { onChange("note", "", "bulk") }
        return trashed
    }

    /// Nests a folder; refuses a move that would create a cycle.
    @discardableResult
    public func setFolderParent(_ id: String, _ parentId: String?) throws -> Bool {
        var cur = parentId
        while let c = cur {
            if c == id { return false }
            cur = try db.query("SELECT parent_id FROM note_folders WHERE id = ?", [.text(c)]).first?["parent_id"]?.string
        }
        try db.run("UPDATE note_folders SET parent_id = ? WHERE id = ?", [Self.t(parentId), .text(id)])
        onChange("note_folder", id, "upsert")
        return true
    }

    /// Permanently deletes one trashed note (and its versions / collapse state).
    @discardableResult
    public func purgeTrashItem(_ id: String) throws -> Bool {
        guard let r = try db.query("SELECT deleted_at FROM notes WHERE id = ?", [.text(id)]).first, Self.i64(r["deleted_at"]) != nil else { return false }
        for t in ["note_versions", "note_heading_collapse", "note_thread_collapse"] { try db.run("DELETE FROM \(t) WHERE note_id = ?", [.text(id)]) }
        try db.run("DELETE FROM notes WHERE id = ?", [.text(id)])
        onChange("note", id, "delete")
        return true
    }

    @discardableResult
    public func emptyTrash() throws -> [String] {
        let ids = try db.query("SELECT id FROM notes WHERE deleted_at IS NOT NULL").compactMap { $0["id"]?.string }
        try tx {
            for id in ids {
                for t in ["note_versions", "note_heading_collapse", "note_thread_collapse"] { try db.run("DELETE FROM \(t) WHERE note_id = ?", [.text(id)]) }
                try db.run("DELETE FROM notes WHERE id = ?", [.text(id)])
            }
        }
        onChange("note", "", "bulk")
        return ids
    }

    func tx(_ body: () throws -> Void) throws {
        let name = "ns_\(UInt32.random(in: 0...UInt32.max))"
        try db.exec("SAVEPOINT \(name)")
        do { try body(); try db.exec("RELEASE \(name)") } catch { try? db.exec("ROLLBACK TO \(name)"); try? db.exec("RELEASE \(name)"); throw error }
    }

    /// The system folder a note belongs to when not filed in a user folder (noteMovability.ts `systemFolderOf`).
    public static func systemFolder(_ n: Note) -> String? {
        if n.tags.contains("biblegateway") { return "biblegateway" }
        if n.tags.contains("esword") { return "esword" }
        if n.type == "daily" || n.type == "journal" || n.title.hasPrefix("Daily — ") || n.title.hasPrefix("Journal — ") { return "daily" }
        if n.verseRef != nil || n.type == "verse" { return "verse" }
        return nil
    }

    public func createFolder(_ name: String, parentId: String? = nil) throws -> String {
        let id = uuid()
        try db.run("INSERT INTO note_folders (id, name, parent_id, created_at) VALUES (?, ?, ?, ?)", [.text(id), .text(name.isEmpty ? "New Folder" : name), Self.t(parentId), .integer(now())])
        onChange("note_folder", id, "upsert")
        return id
    }
    public func renameFolder(_ id: String, to name: String) throws {
        try db.run("UPDATE note_folders SET name = ? WHERE id = ?", [.text(name), .text(id)]); onChange("note_folder", id, "upsert")
    }
    public func setFolder(_ noteId: String, _ folderId: String?) throws {
        try db.run("UPDATE notes SET folder_id = ? WHERE id = ?", [Self.t(folderId), .text(noteId)]); onChange("note", noteId, "upsert")
    }
    public func setPinned(_ noteId: String, _ pinned: Bool) throws {
        try db.run("UPDATE notes SET pinned = ? WHERE id = ?", [.integer(pinned ? 1 : 0), .text(noteId)]); onChange("note", noteId, "upsert")
    }
}
