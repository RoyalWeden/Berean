import BereanCore

extension Reference {
    static let chapterVerseToken = JSRegex(#"^(\d{1,3})(?:[:.](\d{1,3})(?:[-–](\d{1,3}))?)?[.,!?;:)]?$"#)
    static let leadNumeral = JSRegex(#"^(?:[1-3]|I{1,3})$"#, ignoreCase: true)

    /// `text.split(/\s+/)` — empty leading/trailing tokens kept, like JavaScript.
    static func jsSplitWhitespace(_ text: String) -> [String] {
        var out: [String] = []
        var cur: [UInt16] = []
        var inRun = false
        for u in text.utf16 {
            if JSWhitespace.isWhitespace(u) {
                if !inRun { out.append(String(decoding: cur, as: UTF16.self)); cur = []; inRun = true }
            } else { cur.append(u); inRun = false }
        }
        out.append(String(decoding: cur, as: UTF16.self))
        return out
    }

    /// Keep only ASCII word characters (and, when `keepSpace`, ECMAScript whitespace).
    static func stripNonWord(_ s: String, keepSpace: Bool) -> String {
        String(decoding: s.utf16.filter { u in
            (0x30...0x39).contains(u) || (0x41...0x5A).contains(u) || (0x61...0x7A).contains(u) || u == 0x5F
                || (keepSpace && JSWhitespace.isWhitespace(u))
        }, as: UTF16.self)
    }

    /// `findReferencesInText` (src/lib/research/references.ts): every reference-shaped substring
    /// that resolves to a known book, deduplicated, in text order.
    public static func findReferences(in text: String, hermas: HermasText = .robertsDonaldson) -> [ParsedRef] {
        let tokens = jsSplitWhitespace(text)
        var out: [ParsedRef] = []
        var seen = Set<String>()
        for i in tokens.indices {
            guard let m = chapterVerseToken.match(tokens[i]) else { continue }
            var found = false
            for windowLen in [1, 2, 3] {
                if found { break }
                let start = i - windowLen
                if start < 0 { break }
                let bookToken = JSText.trim(stripNonWord(tokens[start..<i].joined(separator: " "), keepSpace: true))
                var candidates = [bookToken]
                if start > 0 {
                    let lead = stripNonWord(tokens[start - 1], keepSpace: false)
                    if leadNumeral.match(lead) != nil { candidates.insert("\(lead) \(bookToken)", at: 0) }
                }
                for cand in candidates {
                    if cand.isEmpty || !isExactBookToken(cand) { continue }
                    var refText = "\(cand) \(m[1]!)"
                    if let v = m[2] { refText += ":\(v)"; if let e = m[3] { refText += "-\(e)" } }
                    guard let parsed = parse(refText, hermas: hermas) else { continue }
                    let key = "\(parsed.bookId)|\(parsed.chapter)|\(parsed.verse.map(String.init) ?? "")|\(parsed.endVerse.map(String.init) ?? "")"
                    if seen.insert(key).inserted { out.append(parsed) }
                    found = true
                    break
                }
            }
        }
        return out
    }
}
