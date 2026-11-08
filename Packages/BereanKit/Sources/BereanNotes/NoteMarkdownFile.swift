import BereanCore
import BereanReference

/// One note ⇄ one Markdown file in the vault's frontmatter dialect — port of src/lib/noteMarkdownFile.ts
/// (golden `note-markdown.json`). Implemented over UTF-16 code units, like the JavaScript it mirrors,
/// so CRLF, BOMs, U+2028/U+2029 and surrogate pairs behave exactly as they do in the existing apps.
public enum NoteMarkdownFile {
    static let colorEmoji: [String: String] = [
        "yellow": "🟡", "orange": "🟠", "amber": "🟡", "red": "🔴", "rose": "🔴", "pink": "💗",
        "violet": "🟣", "purple": "🟣", "indigo": "🔵", "blue": "🔵", "sky": "🔵", "cyan": "🔵",
        "teal": "🟢", "green": "🟢", "lime": "🟢",
    ]
    static let emojiColor: [String: String] = ["🟡": "yellow", "🟠": "orange", "🔴": "red", "🟢": "green", "🔵": "blue", "🟣": "purple", "💗": "pink"]

    static func isVerseType(_ t: String) -> Bool { t == "verse" || t == "esword" || t == "biblegateway" }

    public struct Parsed: Equatable, Sendable {
        public var bereanId: String?
        public var type: String
        public var title: String
        public var content: String
        public var tags: [String]
        public var verseRef, color, icon, status, folderId: String?
        /// Only ever set (true) by a file that says so; never cleared by import.
        public var aiExcluded: Bool?

        /// `JSON.stringify(parseNoteMarkdownFile(...))` key order — for conformance tests.
        public var jsValue: JSValue {
            func s(_ v: String?) -> JSValue { v.map { .string(JSString($0)) } ?? .null }
            var o = JSObject()
            o["bereanId"] = s(bereanId); o["type"] = s(type); o["title"] = s(title); o["content"] = s(content)
            o["tags"] = .array(tags.map { .string(JSString($0)) })
            o["verseRef"] = s(verseRef); o["color"] = s(color); o["icon"] = s(icon); o["status"] = s(status); o["folderId"] = s(folderId)
            if let aiExcluded { o["aiExcluded"] = .bool(aiExcluded) }
            return .object(o)
        }
    }

    // MARK: export

    public static func markdown(for note: Note) -> String {
        let typeLabel = isVerseType(note.type) ? "verse-note" : note.type == "daily" ? "daily-note" : "general-note"
        var displayTitle = note.title.isEmpty ? "Untitled" : note.title
        var verseProps: [String] = []
        if isVerseType(note.type), let verseRef = note.verseRef, !verseRef.isEmpty {
            let parts = split(Array(verseRef.utf16), on: 0x2E).map { String(decoding: $0, as: UTF16.self) }
            let bookId = parts.count > 0 ? parts[0] : "", chapter = parts.count > 1 ? parts[1] : "", verse = parts.count > 2 ? parts[2] : ""
            let ch = chapter.isEmpty ? chapter : JSNumber.toString(Reference.displayChapter(bookId, JSText.number(chapter)))
            let ref = "\(Reference.bookName(bookId)) \(ch):\(verse)"
            displayTitle = ref
            verseProps = ["verse: \"[[\(ref)]]\"", "book: \(Reference.bookName(bookId))", "chapter: \(chapter)"]
        }
        let date = note.type == "daily" ? firstISODate(Array(note.title.utf16)) : nil
        var links: [String] = []
        for l in wikiLinks(Array(note.content.utf16)) where !links.contains(l) { links.append(l) }
        var lines: [String] = ["---", "type: \(typeLabel)"]
        if let r = note.verseRef, !r.isEmpty { lines.append("ref: \(r)") }
        if note.type == "esword" { lines.append("source: esword") } else if note.type == "biblegateway" { lines.append("source: biblegateway") }
        lines.append("title: \(JSON.stringifyString(.string(JSString(displayTitle))))")
        lines.append("created: \(JSDate.isoString(note.createdAt))")
        lines.append("updated: \(JSDate.isoString(note.updatedAt))")
        lines.append("tags: [\(note.tags.joined(separator: ", "))]")
        if !note.color.isEmpty, note.color != "blue" { lines.append("color: \(colorEmoji[note.color] ?? "🔵")") }
        if let i = note.icon, !i.isEmpty { lines.append("icon: \(i)") }
        if let s = note.status, !s.isEmpty { lines.append("status: \(s)") }
        lines += verseProps
        if let date { lines.append("date: \(date)") }
        if !links.isEmpty { lines.append("links:"); lines += links.map { "  - \"[[\($0)]]\"" } }
        lines.append("berean_id: \(note.id)")
        if let f = note.folderId, !f.isEmpty { lines.append("folder_id: \(f)") }
        if note.aiExcluded { lines.append("ai_excluded: true") }
        lines.append("---")
        return lines.joined(separator: "\n") + "\n\n" + note.content
    }

    /// `/(\d{4}-\d{2}-\d{2})/` (ASCII digits).
    static func firstISODate(_ u: [UInt16]) -> String? {
        func d(_ i: Int) -> Bool { i < u.count && u[i] >= 0x30 && u[i] <= 0x39 }
        guard u.count >= 10 else { return nil }
        for i in 0...(u.count - 10) where d(i) && d(i + 1) && d(i + 2) && d(i + 3) && u[i + 4] == 0x2D && d(i + 5) && d(i + 6) && u[i + 7] == 0x2D && d(i + 8) && d(i + 9) {
            return String(decoding: u[i..<(i + 10)], as: UTF16.self)
        }
        return nil
    }

    /// `content.matchAll(/\[\[([^\]]+)\]\]/g)` group 1, in order (duplicates kept).
    static func wikiLinks(_ u: [UInt16]) -> [String] {
        var out: [String] = [], i = 0
        while i + 1 < u.count {
            if u[i] == 0x5B, u[i + 1] == 0x5B {
                var j = i + 2
                while j < u.count, u[j] != 0x5D { j += 1 }
                if j > i + 2, j + 1 < u.count, u[j + 1] == 0x5D {
                    out.append(String(decoding: u[(i + 2)..<j], as: UTF16.self)); i = j + 2; continue
                }
            }
            i += 1
        }
        return out
    }

    // MARK: import

    static func isTerminator(_ c: UInt16) -> Bool { c == 0x0A || c == 0x0D || c == 0x2028 || c == 0x2029 }
    static func str(_ s: ArraySlice<UInt16>) -> String { String(decoding: s, as: UTF16.self) }
    static func trim(_ s: ArraySlice<UInt16>) -> ArraySlice<UInt16> { JSWhitespace.trim(s) }
    static func split(_ u: [UInt16], on sep: UInt16) -> [ArraySlice<UInt16>] { u.split(separator: sep, omittingEmptySubsequences: false) }
    static func find(_ needle: [UInt16], in u: [UInt16], from: Int = 0) -> Int? {
        guard !needle.isEmpty, u.count >= needle.count, from <= u.count - needle.count else { return needle.isEmpty ? from : nil }
        for p in from...(u.count - needle.count) where u[p] == needle[0] && Array(u[p..<(p + needle.count)]) == needle { return p }
        return nil
    }
    static func units(_ s: String) -> [UInt16] { Array(s.utf16) }

    /// `/^#\s+(.+)$/m` → (whole match range, group 1).
    static func heading(_ u: [UInt16]) -> (Range<Int>, ArraySlice<UInt16>)? {
        let n = u.count
        var i = 0
        while i < n {
            if i == 0 || isTerminator(u[i - 1]), u[i] == 0x23 {
                var j = i + 1
                while j < n, JSWhitespace.isWhitespace(u[j]) { j += 1 }
                // \s+ is greedy (≥ 1 char), then backtracks until `.+` can start on a non-terminator.
                var start = j
                while start >= i + 2, !(start < n && !isTerminator(u[start])) { start -= 1 }
                if start >= i + 2 {
                    var k = start
                    while k < n, !isTerminator(u[k]) { k += 1 }
                    return (i..<k, u[start..<k])
                }
            }
            i += 1
        }
        return nil
    }

    public static func parse(_ text: String, fallbackTitle: String = "Imported note") -> Parsed {
        // \r\n? → \n, then a leading BOM.
        var normalized: [UInt16] = []
        let raw = Array(text.utf16)
        var x = 0
        while x < raw.count {
            if raw[x] == 0x0D { normalized.append(0x0A); x += (x + 1 < raw.count && raw[x + 1] == 0x0A) ? 2 : 1 } else { normalized.append(raw[x]); x += 1 }
        }
        if normalized.first == 0xFEFF { normalized.removeFirst() }
        var out = Parsed(bereanId: nil, type: "general", title: "", content: str(trim(normalized[...])), tags: [])

        // /^---\n([\s\S]*?)\n---\n?\n?([\s\S]*)$/
        var fmRange: Range<Int>?, restStart = 0
        if normalized.starts(with: units("---\n")), let p = find(units("\n---"), in: normalized, from: 4) {
            fmRange = 4..<p
            var q = p + 4
            if q < normalized.count, normalized[q] == 0x0A { q += 1 }
            if q < normalized.count, normalized[q] == 0x0A { q += 1 }
            restStart = q
        }
        guard let fmRange else {
            let h = heading(normalized)
            let firstLine = split(normalized, on: 0x0A).first { !trim($0).isEmpty }
            let title = h?.1 ?? firstLine ?? units(fallbackTitle)[...]
            out.title = str(trim(title).prefix(200))
            if let h {
                let whole = Array(normalized[h.0])
                if let at = find(whole, in: normalized) {
                    out.content = str(trim((normalized[..<at] + normalized[(at + whole.count)...])[...]))
                }
            }
            return out
        }

        var fm: [String: String] = [:]
        for line in split(Array(normalized[fmRange]), on: 0x0A) {
            var k = line.startIndex
            while k < line.endIndex, let c = Optional(line[k]), (c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A) || c == 0x5F { k += 1 }
            guard k > line.startIndex, k < line.endIndex, line[k] == 0x3A else { continue }
            var w = k + 1
            while w < line.endIndex, JSWhitespace.isWhitespace(line[w]) { w += 1 }
            let value = line[w...]
            guard !value.contains(where: isTerminator) else { continue }
            fm[str(line[line.startIndex..<k])] = str(trim(value))
        }

        var body = Array(normalized[restStart...])
        let open = units("<!-- berean:highlight-preview -->"), close = units("<!-- /berean:highlight-preview -->")
        if let a = find(open, in: body), let c = find(close, in: body, from: a + open.count) {
            var e = c + close.count
            if e < body.count, body[e] == 0x0A { e += 1 }
            if e < body.count, body[e] == 0x0A { e += 1 }
            body.removeSubrange(a..<e)
        }
        out.content = str(trim(body[...]))
        out.bereanId = fm["berean_id"].flatMap { $0.isEmpty ? nil : $0 }
        let t = fm["type"] ?? ""
        out.type = fm["source"] == "esword" ? "esword" : fm["source"] == "biblegateway" ? "biblegateway"
            : t == "verse-note" ? "verse" : t == "daily-note" ? "daily" : "general"
        var title = fm["title"] ?? ""
        if title.hasPrefix("\"") {
            if let v = try? JSON.parse(title), let s = v.stringValue { title = s.string } else { title = stripEdges(title, 0x22, 0x22) }
        }
        out.title = title.isEmpty ? fallbackTitle : title
        out.tags = split(units(stripEdges(fm["tags"] ?? "", 0x5B, 0x5D)), on: 0x2C).map { str(trim($0)) }.filter { !$0.isEmpty }
        func nonEmpty(_ k: String) -> String? { fm[k].flatMap { $0.isEmpty ? nil : $0 } }
        out.verseRef = nonEmpty("ref")
        if let c = nonEmpty("color") {
            out.color = emojiColor[c] ?? (c.utf16.allSatisfy { $0 >= 0x61 && $0 <= 0x7A } ? c : nil)
        }
        out.icon = nonEmpty("icon"); out.status = nonEmpty("status"); out.folderId = nonEmpty("folder_id")
        if fm["ai_excluded"] == "true" { out.aiExcluded = true }
        return out
    }

    /// `s.replace(/^L|R$/g, '')` for single code units L and R.
    static func stripEdges(_ s: String, _ l: UInt16, _ r: UInt16) -> String {
        let u = Array(s.utf16)
        var lo = 0, hi = u.count
        if hi > 0, u[0] == l { lo = 1 }
        if hi > lo, u[hi - 1] == r { hi -= 1 }
        return str(u[lo..<hi])
    }

    /// `noteFileName` — a safe export file name.
    public static func fileName(title: String, id: String) -> String {
        var u: [UInt16] = []
        var inRun = false
        for c in title.utf16 {
            // [\\/:*?"<>|]+ → ' '
            if [0x5C, 0x2F, 0x3A, 0x2A, 0x3F, 0x22, 0x3C, 0x3E, 0x7C].contains(c) { if !inRun { u.append(0x20) }; inRun = true } else { u.append(c); inRun = false }
        }
        var collapsed: [UInt16] = []
        for c in u {
            if JSWhitespace.isWhitespace(c) { if collapsed.last.map(JSWhitespace.isWhitespace) != true { collapsed.append(0x20) } } else { collapsed.append(c) }
        }
        let base = trim(collapsed[...]).prefix(80)
        return (base.isEmpty ? String(decoding: Array(id.utf16).prefix(8), as: UTF16.self) : str(base)) + ".md"
    }
}

/// `Date.prototype.toISOString` for a millisecond timestamp.
public enum JSDate {
    public static func isoString(_ ms: Int64) -> String {
        let day = Int64((Double(ms) / 86_400_000).rounded(.down))
        let msOfDay = ms - day * 86_400_000
        // Civil-from-days (Howard Hinnant), proleptic Gregorian.
        let z = day + 719_468
        let era = (z >= 0 ? z : z - 146_096) / 146_097
        let doe = z - era * 146_097
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365
        var y = yoe + era * 400
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        let mp = (5 * doy + 2) / 153
        let d = doy - (153 * mp + 2) / 5 + 1
        let m = mp < 10 ? mp + 3 : mp - 9
        if m <= 2 { y += 1 }
        func p(_ v: Int64, _ w: Int) -> String { let s = String(v); return String(repeating: "0", count: max(0, w - s.count)) + s }
        let year = (0...9999).contains(y) ? p(y, 4) : (y < 0 ? "-" : "+") + p(abs(y), 6)
        return "\(year)-\(p(m, 2))-\(p(d, 2))T\(p(msOfDay / 3_600_000, 2)):\(p(msOfDay / 60_000 % 60, 2)):\(p(msOfDay / 1000 % 60, 2)).\(p(msOfDay % 1000, 3))Z"
    }
}
