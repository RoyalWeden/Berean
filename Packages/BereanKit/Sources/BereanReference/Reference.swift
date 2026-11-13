import BereanCore

/// A parsed Scripture reference — port of `ParsedRef` (src/lib/parseRef.ts).
public struct ParsedRef: Equatable, Sendable {
    public struct VerseGroup: Equatable, Sendable {
        public var verse: Int
        public var endVerse: Int?
    }
    public var bookId: String
    public var chapter: Int
    public var verse: Int?
    public var endVerse: Int?
    public var endChapter: Int?
    public var forcedTranslation: String?
    public var verseGroups: [VerseGroup]?
}

/// Shepherd of Hermas translation whose section map is used ("hermas" = Roberts-Donaldson,
/// "hermas_taylor" = Taylor). TypeScript keeps this in a module variable; Swift passes it.
public enum HermasText: String, Sendable {
    case robertsDonaldson = "hermas"
    case taylor = "hermas_taylor"

    public init(textId: String) { self = textId == "hermas_taylor" ? .taylor : .robertsDonaldson }
    var sections: [String: [(name: String, num: Int, chapters: [Int])]] {
        self == .taylor ? ReferenceTables.hermasSections_taylor : ReferenceTables.hermasSections_rd
    }
}

/// Book catalogue and reference grammar — port of src/lib/parseRef.ts, chapterNumbering.ts and the
/// parts of hermasMap.ts it uses. Table data is generated from the TypeScript (ReferenceTables).
public enum Reference {
    // MARK: tables

    static let idToName: [String: String] = Dictionary(ReferenceTables.books.map { ($0.id, $0.name) }, uniquingKeysWith: { _, b in b })
    static let order: [String: Int] = {
        var o: [String: Int] = [:]
        for (i, b) in ReferenceTables.books.enumerated() where o[b.id] == nil { o[b.id] = i }
        return o
    }()
    static let namesNoSpace: [(id: String, name: String)] = ReferenceTables.books.map { ($0.id, removeWhitespace(JSText.lower($0.name))) }
    static let romanToArabic: [String: String] = [
        "I": "1", "II": "2", "III": "3", "IV": "4", "V": "5", "VI": "6", "VII": "7", "VIII": "8", "IX": "9", "X": "10",
        "XI": "11", "XII": "12", "XIII": "13", "XIV": "14", "XV": "15",
    ]
    static let fullWorkName = ["Recognitions": "Recognitions of Clement", "Hermas": "Shepherd of Hermas"]
    static let dedicatedTranslations: Set<String> = Set(ReferenceTables.bookTranslation.values).union(["hermas_taylor"])

    public static var allBooks: [(id: String, name: String, patterns: [String])] { ReferenceTables.books }
    public static var ambiguousPatterns: Set<String> { ReferenceTables.ambiguousPatterns }

    /// `bookOrder` — canonical position, 9999 when unknown.
    public static func bookOrder(_ bookId: String) -> Int { order[bookId] ?? 9999 }
    /// `maxChapterFor`.
    public static func maxChapter(_ bookId: String) -> Int? { ReferenceTables.maxChapters[bookId] }

    // MARK: chapter numbering (chapterNumbering.ts)

    static let shifted: [String: (firstShifted: Double, offset: Double, storedMax: Double)] = ["RCL3": (2, 10, 65)]

    public static func hasCustomChapterNumbering(_ bookId: String) -> Bool { shifted[bookId] != nil }

    /// Stored chapter → displayed chapter (`displayChapter`).
    public static func displayChapter(_ bookId: String?, _ stored: Double) -> Double {
        guard let bookId, let s = shifted[bookId], !(stored < s.firstShifted) else { return stored }
        return stored + s.offset
    }

    /// Displayed chapter → stored chapter, nil when that display chapter does not exist.
    public static func storedChapter(_ bookId: String, _ display: Double) -> Double? {
        guard let s = shifted[bookId] else { return display }
        if display < s.firstShifted { return display }
        if display < s.firstShifted + s.offset { return nil }
        let stored = display - s.offset
        return stored > s.storedMax ? nil : stored
    }

    // MARK: book tokens

    static func normalizeRomanBookPrefix(_ key: String) -> String {
        for (prefix, arabic) in [("iii ", "3"), ("ii ", "2"), ("i ", "1")] where key.hasPrefix(prefix) {
            return arabic + key.dropFirst(prefix.count - 1)
        }
        return key
    }

    static func tokenKey(_ raw: String) -> String {
        normalizeRomanBookPrefix(JSText.collapseWhitespace(JSText.lower(JSText.trim(raw))))
    }

    static func removeWhitespace(_ s: String) -> String { JSText.collapseWhitespace(s, with: "") }

    /// `isExactBookToken` — tier-1 matches only (a literal pattern or a full book name).
    public static func isExactBookToken(_ raw: String) -> Bool {
        let key = tokenKey(raw)
        if ReferenceTables.patternLookup[key] != nil { return true }
        let noSpace = removeWhitespace(key)
        return namesNoSpace.contains { $0.name == noSpace }
    }

    /// `resolveBookToken`: exact pattern, then name prefix, then pattern prefix (canonical order),
    /// then a narrow edit-distance fallback for misspelt full names.
    public static func resolveBookToken(_ raw: String) -> String? {
        let key = tokenKey(raw)
        if let exact = ReferenceTables.patternLookup[key] { return exact }
        let noSpace = removeWhitespace(key)
        let n = JSText.length(noSpace)
        if n < 2 { return nil }
        for b in namesNoSpace where JSText.startsWith(b.name, noSpace) { return b.id }
        for b in ReferenceTables.books where b.patterns.contains(where: { JSText.startsWith(removeWhitespace($0), noSpace) }) {
            return b.id
        }
        if n >= 4, let last = noSpace.utf16.last, !(0x30...0x39).contains(last) {
            var best: (id: String, dist: Int)?
            let a = Array(noSpace.utf16)
            for b in namesNoSpace {
                let cand = Array(b.name.utf16)
                if cand.count < 5 { continue }
                if abs(cand.count - a.count) > 1 { continue }
                let maxDist = cand.count <= 7 ? 1 : 2
                let d = editDistance(a, cand)
                if d <= maxDist && (best == nil || d < best!.dist) { best = (b.id, d) }
            }
            if let best { return best.id }
        }
        return nil
    }

    static func editDistance(_ a: [UInt16], _ b: [UInt16]) -> Int {
        if a.isEmpty { return b.count }
        if b.isEmpty { return a.count }
        var prev = Array(0...b.count)
        for i in 1...a.count {
            var cur = [i] + Array(repeating: 0, count: b.count)
            for j in 1...b.count {
                cur[j] = a[i - 1] == b[j - 1] ? prev[j - 1] : 1 + min(prev[j - 1], prev[j], cur[j - 1])
            }
            prev = cur
        }
        return prev[b.count]
    }

    // MARK: names and labels

    static let bookRomanRegex = JSRegex(#"Book\s+([IVX]+)\b"#)

    /// `normalizeBookName` — roman-numeral prefixes to arabic, "Revelation of John" → "Revelation",
    /// and the first standalone "Book <roman>" to "Book <n>".
    public static func normalizeBookName(_ name: String) -> String {
        var s = name
        for (p, r) in [("IV ", "4 "), ("III ", "3 "), ("II ", "2 "), ("I ", "1 ")] where s.hasPrefix(p) {
            s = r + s.dropFirst(p.count)
        }
        if s == "Revelation of John" { s = "Revelation" }
        // /\bBook\s+([IVX]+)\b/ (first match only): the leading \b is checked by hand.
        var searchFrom = s.startIndex
        while searchFrom < s.endIndex, let m = try? bookRomanRegex.regex.firstMatch(in: s[searchFrom...]) {
            let start = m.range.lowerBound
            let prevIsWord = start > s.startIndex && s.unicodeScalars[s.unicodeScalars.index(before: start)].isASCIIWord
            if prevIsWord { searchFrom = s.unicodeScalars.index(after: start); continue }
            if let roman = m.output[1].substring.map(String.init), let arabic = romanToArabic[roman] {
                s.replaceSubrange(m.range, with: "Book \(arabic)")
            }
            break
        }
        return s
    }

    /// `displayBookName`.
    public static func displayBookName(_ name: String?, bookId: String? = nil) -> String {
        let n = normalizeBookName(JSText.trim(name ?? ""))
        if let bookId, n.isEmpty || JSText.upper(n) == JSText.upper(bookId) { return bookName(bookId) }
        return n
    }

    /// `bookName` — canonical display name, or the id itself when unknown.
    public static func bookName(_ bookId: String) -> String { normalizeBookName(idToName[bookId] ?? bookId) }

    static func num(_ x: Double) -> String { JSNumber.toString(x) }

    /// `bookChapterVerseLabel`.
    public static func bookChapterVerseLabel(_ bookId: String, chapter: Double, verse: Double? = nil, hermas: HermasText = .robertsDonaldson) -> String {
        if isHermasBook(bookId) {
            let label = hermasChapterLabel(bookId, chapter: chapter, hermas: hermas)
            return verse.map { "Shepherd of Hermas, \(label):\(num($0))" } ?? "Shepherd of Hermas, \(label)"
        }
        let ch = displayChapter(bookId, chapter)
        let name = bookName(bookId)
        if let r = name.ranges(of: ", Book ").last, name[r.upperBound...].allSatisfy({ $0.isASCII && $0.isNumber }), !name[r.upperBound...].isEmpty, r.lowerBound > name.startIndex {
            let prefix = String(name[..<r.lowerBound])
            let qualifier = String(name[name.index(r.lowerBound, offsetBy: 2)...])
            let full = fullWorkName[prefix] ?? prefix
            let chapterLabel = verse.map { "\(num(ch)):\(num($0))" } ?? "Chapter \(num(ch))"
            return "\(full), \(qualifier), \(chapterLabel)"
        }
        return verse.map { "\(name) \(num(ch)):\(num($0))" } ?? "\(name) \(num(ch))"
    }

    public static func bookChapterVerseLabel(_ bookId: String, chapter: Int, verse: Int? = nil, hermas: HermasText = .robertsDonaldson) -> String {
        bookChapterVerseLabel(bookId, chapter: Double(chapter), verse: verse.map(Double.init), hermas: hermas)
    }

    /// `bookChapterHoverLabel`.
    public static func bookChapterHoverLabel(_ bookId: String, chapter: Double) -> String {
        let ch = displayChapter(bookId, chapter)
        let name = bookName(bookId)
        guard let r = name.firstRange(of: ", ") else { return "\(name) \(num(ch))" }
        let prefix = String(name[..<r.lowerBound]), qualifier = String(name[r.upperBound...])
        return "\(fullWorkName[prefix] ?? prefix) \(num(ch)), \(qualifier)"
    }

    /// `bookChapterLabel` ("Psalm 23", not "Psalms 23").
    public static func bookChapterLabel(_ bookId: String, chapter: Double) -> String {
        if bookId == "PSA" { return "Psalm \(num(chapter))" }
        return "\(bookName(bookId)) \(num(displayChapter(bookId, chapter)))"
    }

    /// `formatDottedVerseRef` ("PRO.30.26" → "Proverbs 30:26").
    public static func formatDottedVerseRef(_ ref: String, hermas: HermasText = .robertsDonaldson) -> String {
        let parts = ref.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        guard let bookId = parts.first, !bookId.isEmpty, parts.count > 1, !parts[1].isEmpty else { return ref }
        let ch = JSText.number(parts[1])
        guard ch.isFinite else { return ref }
        let v: Double? = parts.count > 2 && !parts[2].isEmpty ? JSText.number(parts[2]) : nil
        return bookChapterVerseLabel(bookId, chapter: ch, verse: (v?.isFinite ?? false) ? v : nil, hermas: hermas)
    }

    static let dottedRefRegex = JSRegex(#"^([^.]+)\.(\d+)(?:\.(\d+)(?:-(\d+))?)?$"#)

    /// Parses one stored note attachment, including its optional same-chapter range.
    public static func parseNoteAttachment(_ ref: String) -> (bookId: String, chapter: Int, verse: Int?, endVerse: Int?)? {
        guard let match = dottedRefRegex.match(JSText.trim(ref)),
              let book = match[1], let rawChapter = match[2], let chapter = Int(rawChapter) else { return nil }
        let verse = match[3].flatMap(Int.init).flatMap { $0 > 0 ? $0 : nil }
        let end = match[4].flatMap(Int.init).flatMap { value in verse.flatMap { value > $0 ? value : nil } }
        return (book, chapter, verse, end)
    }

    /// `verseRefDisplay` — appends " LXX" only for the Septuagint.
    public static func verseRefDisplay(_ ref: String?, textId: String? = nil, hermas: HermasText = .robertsDonaldson) -> String {
        guard let ref, !ref.isEmpty else { return "" }
        func one(_ part: String) -> String {
            let t = JSText.trim(part)
            guard let m = dottedRefRegex.match(t) else { return t }
            let label = bookChapterVerseLabel(m[1]!, chapter: JSText.number(m[2]!), verse: m[3].map { JSText.number($0) }, hermas: hermas)
            if let end = m[4], end != m[3] { return "\(label)-\(end)" }
            return label
        }
        let body = ref.split(separator: ",", omittingEmptySubsequences: false).map { one(String($0)) }.joined(separator: ", ")
        return textId.map { JSText.lower($0) == "lxx" } == true ? "\(body) LXX" : body
    }

    /// `getTranslationForBook` — the dedicated text a book lives in, nil for canonical books.
    public static func translation(forBook bookId: String, hermas: HermasText = .robertsDonaldson) -> String? {
        let base = ReferenceTables.bookTranslation[bookId]
        return base == "hermas" ? hermas.rawValue : base
    }

    /// `isDedicatedTranslation`.
    public static func isDedicatedTranslation(_ textId: String) -> Bool { dedicatedTranslations.contains(JSText.lower(textId)) }

    // MARK: Hermas sections

    public static func isHermasBook(_ bookId: String) -> Bool { bookId == "HER_VIS" || bookId == "HER_MAN" || bookId == "HER_SIM" }

    static func hermasChapterLabel(_ bookId: String, chapter: Double, hermas: HermasText) -> String {
        guard let section = hermas.sections[bookId]?.first(where: { $0.chapters.contains { Double($0) == chapter } }) else {
            return "Chapter \(num(chapter))"
        }
        if section.chapters.count == 1 { return section.name }
        let idx = section.chapters.firstIndex { Double($0) == chapter }! + 1
        return "\(section.name).\(idx)"
    }

    static func hermasDbChapter(_ bookId: String, section num: Double, sub: Double?, hermas: HermasText) -> Double? {
        guard let s = hermas.sections[bookId]?.first(where: { Double($0.num) == num }) else { return nil }
        guard let sub else { return s.chapters.first.map(Double.init) }
        guard sub >= 1, sub.rounded(.towardZero) == sub, Int(sub) - 1 < s.chapters.count else { return nil }
        return Double(s.chapters[Int(sub) - 1])
    }

    // MARK: misc

    static let strongsRegex = JSRegex(#"^[HGhg]\d{1,5}$"#)
    /// `isStrongsRef`.
    public static func isStrongsRef(_ input: String) -> Bool { strongsRegex.match(JSText.trim(input)) != nil }

    /// `safeFtsQuery`.
    public static func safeFtsQuery(_ q: String) -> String {
        let words = JSText.collapseWhitespace(JSText.trim(q)).split(separator: " ").map(String.init)
        let clean = words.map { w in String(w.unicodeScalars.filter { $0.isASCII && ($0.properties.isAlphabetic || ("0"..."9").contains($0) || $0 == "'") }.map(Character.init)) }
            .filter { JSText.length($0) > 1 }
        return clean.isEmpty ? "" : clean.map { "\($0)*" }.joined(separator: " ")
    }
}

extension Unicode.Scalar {
    var isASCIIWord: Bool { isASCII && (properties.isAlphabetic || ("0"..."9").contains(self) || self == "_") }
}
