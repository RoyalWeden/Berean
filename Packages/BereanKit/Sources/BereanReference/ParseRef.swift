import BereanCore

extension Reference {
    // Regex sources are the TypeScript ones verbatim (JSRegex gives them JavaScript meaning).
    static let recognitionsRegex = JSRegex(
        #"^(?:rcl|recognitions(?: of clement)?|recog clement|rec clem|roc)\s+(\d{1,2}|i|ii|iii|iv|v|vi|vii|viii|ix|x)\b"#
        + #"(?:[\s:]\s*(?:Chapter\s+)?(\d+)(?:\s*[:.]\s*(\d+))?)?"# + #"(?:\s+(LXX)\b)?$"#, ignoreCase: true)
    static let hermasRegex = JSRegex(
        #"^(?:hermas|shepherd of hermas|her|shep hermas)\s*,?\s*(vision|visions|mandate|mandates|similitude|similitudes)\s+(\d{1,2})(?:[.\s](\d{1,2}))?(?:\s*:\s*(\d+))?(?:\s+(LXX)\b)?$"#,
        ignoreCase: true)
    static let mainRegex = JSRegex(
        #"^((?:\d\s*)?\w[\w\s,]*?)\.?(?:,?\s*Book\s+(\d{1,3}))?,?\s*(?:Chapter\s+)?(\d+)(?:\s*[:.]\s*(\d+)(?:\s*[-–]\s*(?:(\d+)\s*[:.]\s*(\d+)|(\d+)))?((?:\s*,\s*\d{1,3}(?:\s*[-–]\s*\d{1,3})?)+)?|\s*[-–]\s*(\d+))?(?:\s+(LXX)\b)?$"#,
        ignoreCase: true)
    static let bareRegex = JSRegex(#"^((?:\d\s*)?\w[\w\s,]*?)\.?\s+(\d+)\s+(\d+)(?:\s+(LXX)\b)?$"#, ignoreCase: true)
    static let verseGroupRegex = JSRegex(#"^(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?$"#)
    static let canonicalInputRegex = JSRegex(#"^((?:\d\s*)?\w[\w\s]*?)\s*(\d+)(?:\s*[:.]\s*(\d+)(?:\s*[-–]\s*(\d+))?|\s*[-–]\s*(\d+))?$"#, ignoreCase: true)

    static let hermasSectionBook = ["vision": "HER_VIS", "visions": "HER_VIS", "mandate": "HER_MAN", "mandates": "HER_MAN",
                                    "similitude": "HER_SIM", "similitudes": "HER_SIM"]

    /// Internal result with JavaScript numbers (doubles) so validation matches TypeScript exactly.
    struct RawRef {
        var bookId: String
        var chapter: Double
        var verse: Double?
        var endVerse: Double?
        var endChapter: Double?
        var forcedTranslation: String?
        var verseGroups: [(Double, Double?)]?
    }

    static func finishResolved(_ bookId: String, _ chapterIn: Double, _ verse: Double?, _ endVerse: Double?, _ endChapterIn: Double?,
                               suffix: String? = nil, commaList: String? = nil) -> RawRef? {
        var chapter = chapterIn, endChapter = endChapterIn
        if chapter.isNaN || chapter < 1 { return nil }
        if idToName[bookId] == nil { return nil }
        if hasCustomChapterNumbering(bookId) {
            guard let sc = storedChapter(bookId, chapter) else { return nil }
            chapter = sc
            if let ec = endChapter {
                guard let se = storedChapter(bookId, ec) else { return nil }
                endChapter = se
            }
        }
        if let maxCh = maxChapter(bookId).map(Double.init) {
            if chapter > maxCh { return nil }
            if let ec = endChapter, ec > maxCh { return nil }
        }
        func badVerse(_ v: Double) -> Bool { v.isNaN || v < 1 || v > 200 }
        if let v = verse, badVerse(v) { return nil }
        if let v = endVerse, badVerse(v) { return nil }
        let forced: String? = suffix.flatMap { JSText.upper($0) == "LXX" ? "LXX" : nil }
        var groups: [(Double, Double?)]?
        if let commaList {
            var g: [(Double, Double?)] = []
            if let v = verse { g.append((v, endVerse)) }
            for seg in commaList.split(separator: ",", omittingEmptySubsequences: false) {
                let t = JSText.trim(String(seg))
                if t.isEmpty { continue }
                guard let gm = verseGroupRegex.match(t), let gv = JSText.parseInt(gm[1]!) else { return nil }
                let gev = gm[2].flatMap { JSText.parseInt($0) }
                if badVerse(gv) { return nil }
                if let e = gev, badVerse(e) { return nil }
                g.append((gv, gev))
            }
            groups = g
        }
        return RawRef(bookId: bookId, chapter: chapter, verse: verse, endVerse: endVerse, endChapter: endChapter, forcedTranslation: forced, verseGroups: groups)
    }

    static func romanOrArabicToNumber(_ tok: String) -> Double? {
        if !tok.isEmpty, tok.utf16.allSatisfy({ (0x30...0x39).contains($0) }) { return JSText.parseInt(tok) }
        return romanToArabic[JSText.upper(tok)].flatMap { JSText.parseInt($0) }
    }

    static func tryGenericRecognitions(_ norm: String) -> RawRef? {
        guard let m = recognitionsRegex.match(norm) else { return nil }
        guard let bookNum = romanOrArabicToNumber(m[1]!), bookNum != 0, let chapter = m[2] else { return nil }
        return finishResolved("RCL\(JSNumber.toString(bookNum))", JSText.parseInt(chapter)!, m[3].flatMap { JSText.parseInt($0) }, nil, nil, suffix: m[4])
    }

    static func tryHermasSection(_ norm: String, hermas: HermasText) -> RawRef? {
        guard let m = hermasRegex.match(norm), let bookId = hermasSectionBook[JSText.lower(m[1]!)] else { return nil }
        let section = JSText.parseInt(m[2]!)!
        let sub = m[3].flatMap { JSText.parseInt($0) }
        guard let chapter = hermasDbChapter(bookId, section: section, sub: sub, hermas: hermas) else { return nil }
        return finishResolved(bookId, chapter, m[4].flatMap { JSText.parseInt($0) }, nil, nil, suffix: m[5])
    }

    /// `/([A-Za-z])\.(?=\s)/g` → "$1": drop an abbreviation period that follows a letter and precedes whitespace.
    static func stripAbbreviationPeriods(_ s: String) -> String {
        let u = Array(s.utf16)
        var out: [UInt16] = []
        out.reserveCapacity(u.count)
        var i = 0
        while i < u.count {
            let c = u[i]
            if c == 0x2E, i > 0, i + 1 < u.count, JSWhitespace.isWhitespace(u[i + 1]),
               (0x41...0x5A).contains(u[i - 1]) || (0x61...0x7A).contains(u[i - 1]) {
                i += 1; continue
            }
            out.append(c); i += 1
        }
        return String(decoding: out, as: UTF16.self)
    }

    static func parseRaw(_ input: String, hermas: HermasText) -> RawRef? {
        let s = JSText.trim(input)
        if s.isEmpty { return nil }
        let norm = stripAbbreviationPeriods(JSText.collapseWhitespace(s))
        if let r = tryGenericRecognitions(norm) ?? tryHermasSection(norm, hermas: hermas) { return r }

        func finish(_ bookRaw: String, _ bookNum: Double?, _ chapter: Double, _ verse: Double?, _ endVerse: Double?, _ endChapter: Double?,
                    _ suffix: String?, _ commaList: String?) -> RawRef? {
            guard var bookId = resolveBookToken(bookRaw) else { return nil }
            if let bookNum {
                var base = bookId
                while let l = base.utf16.last, (0x30...0x39).contains(l) { base.removeLast() }
                let combined = base + JSNumber.toString(bookNum)
                if idToName[combined] == nil { return nil }
                bookId = combined
            }
            return finishResolved(bookId, chapter, verse, endVerse, endChapter, suffix: suffix, commaList: commaList)
        }
        func int(_ x: String?) -> Double? { x.flatMap { $0.isEmpty ? nil : JSText.parseInt($0) } }
        func token(_ x: String) -> String { JSText.collapseWhitespace(JSText.lower(JSText.trim(x))) }

        if let m = mainRegex.match(norm) {
            let cross = int(m[5])
            let r = finish(token(m[1]!), int(m[2]), int(m[3])!, int(m[4]),
                           cross != nil ? int(m[6]) : int(m[7]),
                           cross ?? int(m[9]), m[10], m[8])
            if let r { return r }
        }
        if let m = bareRegex.match(norm) {
            if let r = finish(token(m[1]!), nil, int(m[2])!, int(m[3]), nil, nil, m[4], nil) { return r }
        }
        return nil
    }

    /// `parseRef` — any typed reference ("Gen 1:1", "1 Cor. 13:4-7", "Isaiah 63:17-64:3",
    /// "Deut 32:3,6,9-13", "Recognitions 4:35", "Hermas Vision 2 3:1", "Isaiah 66:3 LXX").
    /// Returns nil for numbers too large for `Int` (TypeScript would keep a huge double; only
    /// possible for Esther, the one book without a chapter cap).
    public static func parse(_ input: String, hermas: HermasText = .robertsDonaldson) -> ParsedRef? {
        guard let r = parseRaw(input, hermas: hermas) else { return nil }
        func i(_ d: Double?) -> Int?? { guard let d else { return .some(nil) }; return Int(exactly: d).map { .some($0) } ?? nil }
        guard let ch = Int(exactly: r.chapter), let v = i(r.verse), let ev = i(r.endVerse), let ec = i(r.endChapter) else { return nil }
        var groups: [ParsedRef.VerseGroup]?
        if let g = r.verseGroups {
            groups = []
            for (a, b) in g {
                guard let ia = Int(exactly: a), let ib = i(b) else { return nil }
                groups!.append(.init(verse: ia, endVerse: ib))
            }
        }
        return ParsedRef(bookId: r.bookId, chapter: ch, verse: v, endVerse: ev, endChapter: ec, forcedTranslation: r.forcedTranslation, verseGroups: groups)
    }

    /// The TypeScript-shaped JSON of a parse (keys in TypeScript order, undefined omitted).
    public static func parseJSON(_ input: String, hermas: HermasText = .robertsDonaldson) -> JSValue {
        guard let r = parseRaw(input, hermas: hermas) else { return .null }
        var o = JSObject()
        o["bookId"] = .string(JSString(r.bookId))
        o["chapter"] = .number(r.chapter)
        if let v = r.verse { o["verse"] = .number(v) }
        if let v = r.endVerse { o["endVerse"] = .number(v) }
        if let v = r.endChapter { o["endChapter"] = .number(v) }
        if let v = r.forcedTranslation { o["forcedTranslation"] = .string(JSString(v)) }
        if let g = r.verseGroups {
            o["verseGroups"] = .array(g.map { a, b in
                var x = JSObject(); x["verse"] = .number(a); if let b { x["endVerse"] = .number(b) }; return .object(x)
            })
        }
        return .object(o)
    }

    // MARK: canonical forms ("GEN.1.1")

    /// `toCanonical` — any reference text to "BOOK.chapter.verse" (verse 0 = whole chapter).
    public static func toCanonical(_ input: String) -> String? {
        let norm = JSText.trim(input)
        if norm.isEmpty { return nil }
        guard let m = canonicalInputRegex.match(norm) else { return nil }
        let bookRaw = JSText.collapseWhitespace(JSText.lower(JSText.trim(m[1]!)))
        guard let chapter = JSText.parseInt(m[2]!), !(chapter < 1) else { return nil }
        let verse = m[3].flatMap { JSText.parseInt($0) }
        guard let bookId = resolveBookToken(bookRaw) else { return nil }
        if let verse, verse != 0 { return "\(bookId).\(num(chapter)).\(num(verse))" }
        return "\(bookId).\(num(chapter)).0"
    }

    static func canonicalParts(_ c: String) -> [String] { c.split(separator: ".", omittingEmptySubsequences: false).map(String.init) }

    /// `toFilename` ("GEN.1.1" → "Genesis 1.1.md").
    public static func toFilename(_ canonical: String) -> String? {
        let p = canonicalParts(canonical)
        guard p.count >= 2 else { return nil }
        let name = bookName(p[0])
        if name.isEmpty || name == p[0] { return nil }
        let verse = p.count > 2 ? p[2] : ""
        return "\(name) \(!verse.isEmpty && verse != "0" ? "\(p[1]).\(verse)" : p[1]).md"
    }

    /// `toUIDisplay` ("GEN.1.1" → "Genesis 1:1").
    public static func toUIDisplay(_ canonical: String) -> String? {
        let p = canonicalParts(canonical)
        guard p.count >= 2 else { return nil }
        let name = bookName(p[0])
        if name.isEmpty || name == p[0] { return nil }
        let ch = num(displayChapter(p[0], JSText.number(p[1])))
        let verse = p.count > 2 ? p[2] : ""
        return !verse.isEmpty && verse != "0" ? "\(name) \(ch):\(verse)" : "\(name) \(ch)"
    }

    /// `toWikilink` ("GEN.1.1" → "[[Verse Notes/Genesis 1:1]]").
    public static func toWikilink(_ canonical: String) -> String? { toUIDisplay(canonical).map { "[[Verse Notes/\($0)]]" } }
    /// `toRelatedVerse`.
    public static func toRelatedVerse(_ canonical: String) -> String? { toUIDisplay(canonical) }

    /// `createCanonical`.
    public static func createCanonical(_ bookId: String, chapter: Int, verse: Int? = nil) -> String { "\(bookId).\(chapter).\(verse ?? 0)" }

    /// `parseCanonical` (verse 0 → nil).
    public static func parseCanonical(_ canonical: String) -> (bookId: String, chapter: Double, verse: Double?)? {
        let p = canonicalParts(canonical)
        guard p.count >= 2 else { return nil }
        guard let chapter = JSText.parseInt(p[1]) else { return nil }
        var verse: Double?
        if p.count > 2, !p[2].isEmpty {
            guard let v = JSText.parseInt(p[2]) else { return nil }
            verse = v
        }
        return (p[0], chapter, verse.flatMap { $0 != 0 ? $0 : nil })
    }
}
