import Foundation
import BereanCore
import BereanSQLite

/// Port of electron/ipc/eSwordImport.ts: reads an e-Sword user folder (study.notx, topic.topx,
/// journal.jnlx — SQLite, opened read-only), converts the RTF notes to plain text (hyperlinks →
/// Markdown, Windows-1252, \u escapes), expands e-Sword references (`Exo_17:6` → `Exodus 17:6`),
/// classifies each against notes already imported (tag "esword": new / updated / duplicate) and
/// saves the chosen ones exactly as the original: id `esw-<uuid>`, tag `esword`, colour blue,
/// verse notes keyed `BOOK.ch.v`, journal entries titled `Daily — YYYY-MM-DD`.
public enum ESwordImport {
    public enum Kind: String, Sendable { case verse, topic, daily }
    public enum Status: String, Sendable { case new, updated, duplicate }

    public struct Candidate: Equatable, Sendable, Identifiable {
        public var id = UUID().uuidString.lowercased()
        public var kind: Kind
        public var title: String
        public var passage: String?
        public var body: String
        public var status: Status = .new
        public var existingId: String?
    }

    public struct Sources: OptionSet, Sendable {
        public let rawValue: Int
        public init(rawValue: Int) { self.rawValue = rawValue }
        public static let study = Sources(rawValue: 1), topics = Sources(rawValue: 2), journal = Sources(rawValue: 4)
        public static let all: Sources = [.study, .topics, .journal]
    }

    // MARK: folders

    public static func detectFolder(home: URL = URL(fileURLWithPath: NSHomeDirectory())) -> URL? {
        let candidates = [
            "Library/CloudStorage/OneDrive-Personal/Documents/e-Sword", "OneDrive/Documents/e-Sword", "Documents/e-Sword", "Desktop/e-Sword",
        ].map { home.appendingPathComponent($0) }
        return candidates.first { FileManager.default.fileExists(atPath: $0.path) }
    }

    public static func availableSources(in folder: URL) -> Sources {
        var s: Sources = []
        if FileManager.default.fileExists(atPath: folder.appendingPathComponent("study.notx").path) { s.insert(.study) }
        if FileManager.default.fileExists(atPath: folder.appendingPathComponent("topic.topx").path) { s.insert(.topics) }
        if FileManager.default.fileExists(atPath: folder.appendingPathComponent("journal.jnlx").path) { s.insert(.journal) }
        return s
    }

    // MARK: reading

    static let bookIds: [Int: String] = {
        let ids = ["GEN","EXO","LEV","NUM","DEU","JOS","JDG","RUT","1SA","2SA","1KI","2KI","1CH","2CH","EZR","NEH","EST","JOB","PSA","PRO","ECC","SNG",
                   "ISA","JER","LAM","EZK","DAN","HOS","JOL","AMO","OBA","JON","MIC","NAM","HAB","ZEP","HAG","ZEC","MAL","MAT","MRK","LUK","JHN","ACT",
                   "ROM","1CO","2CO","GAL","EPH","PHP","COL","1TH","2TH","1TI","2TI","TIT","PHM","HEB","JAS","1PE","2PE","1JN","2JN","3JN","JUD","REV"]
        return Dictionary(uniqueKeysWithValues: ids.enumerated().map { ($0.offset + 1, $0.element) })
    }()

    static let bookNames: [String: String] = [
        "GEN":"Genesis","EXO":"Exodus","LEV":"Leviticus","NUM":"Numbers","DEU":"Deuteronomy","JOS":"Joshua","JDG":"Judges","RUT":"Ruth","1SA":"1 Samuel","2SA":"2 Samuel",
        "1KI":"1 Kings","2KI":"2 Kings","1CH":"1 Chronicles","2CH":"2 Chronicles","EZR":"Ezra","NEH":"Nehemiah","EST":"Esther","JOB":"Job","PSA":"Psalms","PRO":"Proverbs",
        "ECC":"Ecclesiastes","SNG":"Song of Solomon","ISA":"Isaiah","JER":"Jeremiah","LAM":"Lamentations","EZK":"Ezekiel","DAN":"Daniel","HOS":"Hosea","JOL":"Joel","AMO":"Amos",
        "OBA":"Obadiah","JON":"Jonah","MIC":"Micah","NAM":"Nahum","HAB":"Habakkuk","ZEP":"Zephaniah","HAG":"Haggai","ZEC":"Zechariah","MAL":"Malachi","MAT":"Matthew",
        "MRK":"Mark","LUK":"Luke","JHN":"John","ACT":"Acts","ROM":"Romans","1CO":"1 Corinthians","2CO":"2 Corinthians","GAL":"Galatians","EPH":"Ephesians",
        "PHP":"Philippians","COL":"Colossians","1TH":"1 Thessalonians","2TH":"2 Thessalonians","1TI":"1 Timothy","2TI":"2 Timothy","TIT":"Titus","PHM":"Philemon",
        "HEB":"Hebrews","JAS":"James","1PE":"1 Peter","2PE":"2 Peter","1JN":"1 John","2JN":"2 John","3JN":"3 John","JUD":"Jude","REV":"Revelation",
    ]

    static let abbreviations: [String: String] = [
        "Gen":"Genesis","Exo":"Exodus","Lev":"Leviticus","Num":"Numbers","Deu":"Deuteronomy","Jos":"Joshua","Jdg":"Judges","Rut":"Ruth","1Sa":"1 Samuel","2Sa":"2 Samuel",
        "1Ki":"1 Kings","2Ki":"2 Kings","1Ch":"1 Chronicles","2Ch":"2 Chronicles","Ezr":"Ezra","Neh":"Nehemiah","Est":"Esther","Job":"Job","Psa":"Psalms","Pro":"Proverbs",
        "Ecc":"Ecclesiastes","Sng":"Song of Solomon","Isa":"Isaiah","Jer":"Jeremiah","Lam":"Lamentations","Eze":"Ezekiel","Dan":"Daniel","Hos":"Hosea","Joe":"Joel","Amo":"Amos",
        "Oba":"Obadiah","Jon":"Jonah","Mic":"Micah","Nah":"Nahum","Hab":"Habakkuk","Zep":"Zephaniah","Hag":"Haggai","Zec":"Zechariah","Mal":"Malachi","Mat":"Matthew",
        "Mar":"Mark","Luk":"Luke","Joh":"John","Act":"Acts","Rom":"Romans","1Co":"1 Corinthians","2Co":"2 Corinthians","Gal":"Galatians","Eph":"Ephesians",
        "Php":"Philippians","Col":"Colossians","1Th":"1 Thessalonians","2Th":"2 Thessalonians","1Ti":"1 Timothy","2Ti":"2 Timothy","Tit":"Titus","Phm":"Philemon",
        "Heb":"Hebrews","Jas":"James","1Pe":"1 Peter","2Pe":"2 Peter","1Jo":"1 John","2Jo":"2 John","3Jo":"3 John","Jde":"Jude","Rev":"Revelation",
    ]

    public static func read(folder: URL, sources: Sources, calendar: Calendar = .current) throws -> [Candidate] {
        var out: [Candidate] = []
        if sources.contains(.study), let db = open(folder, "study.notx") {
            for r in try db.query("SELECT Book, Chapter, Verse, Notes FROM Verses") {
                guard let book = bookIds[int(r["Book"])] else { continue }
                let body = expandVerseRefs(stripRtf(r["Notes"]?.string ?? ""))
                guard !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
                let ch = int(r["Chapter"]), v = int(r["Verse"])
                out.append(Candidate(kind: .verse, title: "\(bookNames[book] ?? book) \(ch):\(v)", passage: "\(book).\(ch).\(v)", body: body))
            }
        }
        if sources.contains(.topics), let db = open(folder, "topic.topx") {
            for r in try db.query("SELECT Title, Notes FROM Topics") {
                let body = expandVerseRefs(stripRtf(r["Notes"]?.string ?? ""))
                guard !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
                let title = r["Title"]?.string ?? ""
                out.append(Candidate(kind: .topic, title: title.isEmpty ? "Untitled Topic" : title, body: body))
            }
        }
        if sources.contains(.journal), let db = open(folder, "journal.jnlx") {
            for r in try db.query("SELECT Date, Notes FROM Dates") {
                let body = expandVerseRefs(stripRtf(r["Notes"]?.string ?? ""))
                guard !body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
                let date = oleDate(double(r["Date"]), calendar: calendar)
                let c = calendar.dateComponents([.year, .month, .day], from: date)
                out.append(Candidate(kind: .daily, title: String(format: "Daily — %04d-%02d-%02d", c.year!, c.month!, c.day!), body: body))
            }
        }
        return out
    }

    static func open(_ folder: URL, _ name: String) -> SQLiteConnection? {
        let path = folder.appendingPathComponent(name).path
        guard FileManager.default.fileExists(atPath: path) else { return nil }
        return try? SQLiteConnection(readOnlyPath: path)
    }

    static func int(_ v: SQLiteValue?) -> Int { if case .integer(let x) = v { return Int(x) }; if case .real(let d) = v { return Int(d) }; return 0 }
    static func double(_ v: SQLiteValue?) -> Double { if case .integer(let x) = v { return Double(x) }; if case .real(let d) = v { return d }; return 0 }

    /// OLE Automation date: days since 1899-12-30 local midnight.
    public static func oleDate(_ days: Double, calendar: Calendar = .current) -> Date {
        let epoch = calendar.date(from: DateComponents(year: 1899, month: 12, day: 30))!
        return epoch.addingTimeInterval(days * 86_400)
    }

    // MARK: text

    nonisolated(unsafe) static let refPattern = try! NSRegularExpression(pattern: "\\b([1-3]?[A-Z][a-z]{1,2})_(\\d+:\\d+(?:-\\d+)?)\\b")

    public static func expandVerseRefs(_ text: String) -> String {
        let ns = text as NSString
        var out = "", last = 0
        for m in refPattern.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            out += ns.substring(with: NSRange(location: last, length: m.range.location - last))
            let abbr = ns.substring(with: m.range(at: 1)), ref = ns.substring(with: m.range(at: 2))
            out += "\(abbreviations[abbr] ?? abbr) \(ref)"
            last = NSMaxRange(m.range)
        }
        return out + ns.substring(from: last)
    }

    static let cp1252: [UInt16: UInt16] = [
        0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6, 0x89: 0x2030,
        0x8A: 0x0160, 0x8B: 0x2039, 0x8C: 0x0152, 0x8E: 0x017D, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022,
        0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A, 0x9C: 0x0153, 0x9E: 0x017E, 0x9F: 0x0178,
    ]

    nonisolated(unsafe) static let hyperlink = try! NSRegularExpression(pattern:
        #"\{\\field(?:[^{}]|\{[^{}]*\})*?HYPERLINK\s+"([^"]+)"(?:[^{}]|\{[^{}]*\})*?\{\\fldrslt((?:[^{}]|\{[^{}]*\})*)\}(?:[^{}]|\{[^{}]*\})*\}"#)
    nonisolated(unsafe) static let controlWord = try! NSRegularExpression(pattern: #"\\[a-zA-Z]+-?\d*\s?"#)

    static func preprocessHyperlinks(_ rtf: String) -> String {
        let ns = rtf as NSString
        var out = "", last = 0
        for m in hyperlink.matches(in: rtf, range: NSRange(location: 0, length: ns.length)) {
            out += ns.substring(with: NSRange(location: last, length: m.range.location - last))
            let url = ns.substring(with: m.range(at: 1))
            let raw = ns.substring(with: m.range(at: 2)) as NSString
            let text = controlWord.stringByReplacingMatches(in: raw as String, range: NSRange(location: 0, length: raw.length), withTemplate: "")
                .replacingOccurrences(of: "{", with: "").replacingOccurrences(of: "}", with: "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            out += text.isEmpty ? url : "[\(text)](\(url))"
            last = NSMaxRange(m.range)
        }
        return out + ns.substring(from: last)
    }

    /// Faithful port of the original character scanner (UTF-16 based, like the JavaScript).
    public static func stripRtf(_ rtf: String) -> String {
        let trimmedStart = String(rtf.drop(while: { $0.isWhitespace }))
        guard trimmedStart.hasPrefix("{\\rtf") else { return rtf }
        let s = Array(preprocessHyperlinks(trimmedStart).utf16)
        let ignorable: Set<String> = ["fonttbl", "colortbl", "stylesheet", "info", "pict", "fldinst", "fldtype", "lsdstyles", "themedata",
                                      "colorschememapping", "datastore", "wgrffmtfilter"]
        func isLetter(_ u: UInt16) -> Bool { (u >= 65 && u <= 90) || (u >= 97 && u <= 122) }
        func isLower(_ u: UInt16) -> Bool { u >= 97 && u <= 122 }
        func isDigit(_ u: UInt16) -> Bool { u >= 48 && u <= 57 }
        var result: [UInt16] = []
        var i = 0, depth = 0, skip = -1
        let n = s.count
        while i < n {
            let ch = s[i]
            if ch == 123 {   // {
                depth += 1
                if skip < 0, i + 1 < n, s[i + 1] == 92 {
                    if i + 2 < n, s[i + 2] == 42 { skip = depth }
                    else {
                        var j = i + 2, name: [UInt16] = []
                        while j < n, isLower(s[j]) { name.append(s[j]); j += 1 }
                        if ignorable.contains(String(decoding: name, as: UTF16.self)) { skip = depth }
                    }
                }
                i += 1
            } else if ch == 125 {   // }
                if skip == depth { skip = -1 }
                depth -= 1; i += 1
            } else if ch == 92 {   // \
                i += 1
                guard i < n else { break }
                let nc = s[i]
                if nc == 92 || nc == 123 || nc == 125 { if skip < 0 { result.append(nc) }; i += 1 }
                else if nc == 39 {   // \'xx
                    i += 1
                    let hex = String(decoding: s[i..<min(i + 2, n)], as: UTF16.self)
                    if skip < 0, let code = UInt16(hex, radix: 16) { result.append(cp1252[code] ?? code) }
                    i += 2
                } else if nc == 10 || nc == 13 { if skip < 0 { result.append(10) }; i += 1 }
                else if nc == 126 { if skip < 0 { result.append(32) }; i += 1 }
                else if nc == 45 || nc == 95 || nc == 42 { i += 1 }
                else if isLetter(nc) {
                    var word: [UInt16] = []
                    while i < n, isLetter(s[i]) { word.append(s[i]); i += 1 }
                    var negative = false, param: [UInt16] = []
                    if i < n, s[i] == 45 { negative = true; i += 1 }
                    while i < n, isDigit(s[i]) { param.append(s[i]); i += 1 }
                    if i < n, s[i] == 32 { i += 1 }
                    if skip < 0 {
                        let w = String(decoding: word, as: UTF16.self)
                        if w == "par" || w == "sect" || w == "line" { result.append(10) }
                        else if w == "tab" { result.append(9) }
                        else if w == "u", let p = Int(String(decoding: param, as: UTF16.self)) {
                            let code = negative ? -p : p
                            result.append(UInt16(truncatingIfNeeded: code < 0 ? code + 65_536 : code))
                            if i < n, s[i] != 92, s[i] != 125, s[i] != 123 { i += 1 }
                        }
                    }
                } else { i += 1 }
            } else {
                if skip < 0 { result.append(ch) }
                i += 1
            }
        }
        var text = String(decoding: result, as: UTF16.self)
            .replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        while text.contains("\n\n\n") { text = text.replacingOccurrences(of: "\n\n\n", with: "\n\n") }
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: classify + save

    nonisolated(unsafe) static let importedFooter = try! NSRegularExpression(pattern: #"\n\n---\n\*Imported from e-Sword[^*]*\*\s*$"#, options: [.dotMatchesLineSeparators])

    /// Marks each candidate new / updated / duplicate against notes already tagged "esword".
    public static func classify(_ candidates: [Candidate], db: SQLiteConnection) throws -> [Candidate] {
        var byKey: [String: [(id: String, core: String)]] = [:]
        for r in try db.query(#"SELECT id, title, verse_ref, content FROM notes WHERE tags LIKE '%"esword"%'"#) {
            let key = r["verse_ref"]?.string ?? r["title"]?.string ?? ""
            let content = r["content"]?.string ?? ""
            let core = importedFooter.stringByReplacingMatches(in: content, range: NSRange(location: 0, length: (content as NSString).length), withTemplate: "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            byKey[key, default: []].append((r["id"]?.string ?? "", core))
        }
        return candidates.map { c in
            var c = c
            guard let existing = byKey[c.passage ?? c.title], let first = existing.first else { c.status = .new; return c }
            if let dup = existing.first(where: { $0.core == c.body.trimmingCharacters(in: .whitespacesAndNewlines) }) {
                c.status = .duplicate; c.existingId = dup.id
            } else {
                c.status = .updated; c.existingId = first.id
            }
            return c
        }
    }

    /// Saves the selected candidates (duplicates skipped) through NotesService; returns counts.
    @discardableResult
    public static func save(_ selected: [Candidate], notes: NotesService, db: SQLiteConnection,
                            now: () -> Int64 = { Int64(Date().timeIntervalSince1970 * 1000) }) throws -> (imported: Int, updated: Int) {
        var imported = 0, updated = 0
        for c in selected where c.status != .duplicate {
            let content = c.body.trimmingCharacters(in: .whitespacesAndNewlines)
            if c.status == .updated, let id = c.existingId {
                if try notes.update(id, .init(content: content)) { updated += 1 }
            } else {
                let type = c.kind == .verse ? "verse" : c.kind == .daily ? "daily" : "general"
                let id = "esw-\(UUID().uuidString.lowercased())"
                _ = try notes.create(.init(id: id, type: type, title: c.title, content: content, verseRef: c.passage, color: "blue",
                                           status: .some(nil), tags: ["esword"]))
                try db.run("UPDATE notes SET imported_at = ? WHERE id = ?", [.integer(now()), .text(id)])
                imported += 1
            }
        }
        return (imported, updated)
    }
}
