import BereanCore

/// Strong's-number parsing — port of src/lib/research/strongsId.ts. Only reads ids the user
/// typed; never infers one.
public struct StrongsIdMatch: Equatable, Sendable {
    /// Canonical id used by the lexicon databases: "G5485", "H2617" (no leading zeros).
    public var id: String
    public var lang: Character   // "H" or "G"
    public var number: Int
    /// The exact matched text and its UTF-16 offset (JavaScript `match.index`).
    public var raw: String
    public var index: Int
}

public enum StrongsId {
    // Matching is per Unicode scalar (the TypeScript regexes use the `u` flag); offsets are
    // reported in UTF-16 code units.
    static func isLetterOrNumber(_ s: Unicode.Scalar) -> Bool {
        switch s.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
             .decimalNumber, .letterNumber, .otherNumber: return true
        default: return false
        }
    }
    static func isSpace(_ s: Unicode.Scalar) -> Bool { s.value <= 0xFFFF && JSWhitespace.isWhitespace(UInt16(s.value)) }
    static func isDigit(_ s: Unicode.Scalar) -> Bool { ("0"..."9").contains(s) }

    /// `/(?<![\p{L}\p{N}])([HhGg])[\s ]?[-‐-–]?[\s ]?0*(\d{1,5})(?:[a-z])?(?![\p{L}\p{N}])/gu`
    /// as a backtracking search in the same priority order as the regex engine.
    static func scan(_ text: String) -> [(start: Int, end: Int, lang: Unicode.Scalar, digits: String)] {
        let u = Array(text.unicodeScalars)
        var out: [(Int, Int, Unicode.Scalar, String)] = []
        var start = 0
        func tryAt(_ s: Int) -> (Int, String)? {
            guard "HhGg".unicodeScalars.contains(u[s]) else { return nil }
            if s > 0 && isLetterOrNumber(u[s - 1]) { return nil }
            let p0 = s + 1
            for a in [true, false] {
                let p1 = a ? (p0 < u.count && isSpace(u[p0]) ? p0 + 1 : -1) : p0
                if p1 < 0 { continue }
                for b in [true, false] {
                    let p2 = b ? (p1 < u.count && (u[p1] == "-" || (0x2010...0x2013).contains(u[p1].value)) ? p1 + 1 : -1) : p1
                    if p2 < 0 { continue }
                    for c in [true, false] {
                        let p3 = c ? (p2 < u.count && isSpace(u[p2]) ? p2 + 1 : -1) : p2
                        if p3 < 0 { continue }
                        var zeros = 0
                        while p3 + zeros < u.count && u[p3 + zeros] == "0" { zeros += 1 }
                        for z in stride(from: zeros, through: 0, by: -1) {
                            let p4 = p3 + z
                            var avail = 0
                            while avail < 5 && p4 + avail < u.count && isDigit(u[p4 + avail]) { avail += 1 }
                            for n in stride(from: avail, through: 1, by: -1) {
                                let p5 = p4 + n
                                for letter in [true, false] {
                                    let p6 = letter ? (p5 < u.count && ("a"..."z").contains(u[p5]) ? p5 + 1 : -1) : p5
                                    if p6 < 0 { continue }
                                    if p6 < u.count && isLetterOrNumber(u[p6]) { continue }
                                    return (p6, String(String.UnicodeScalarView(u[p4..<p5])))
                                }
                            }
                        }
                    }
                }
            }
            return nil
        }
        while start < u.count {
            if let (end, digits) = tryAt(start) {
                out.append((start, end, u[start], digits))
                start = end
            } else {
                start += 1
            }
        }
        // Convert scalar offsets to UTF-16 offsets.
        var utf16At = [Int](repeating: 0, count: u.count + 1)
        for i in 0..<u.count { utf16At[i + 1] = utf16At[i] + (u[i].value > 0xFFFF ? 2 : 1) }
        return out.map { (utf16At[$0.0], utf16At[$0.1], $0.2, $0.3) }
    }

    /// `parseStrongsIds` — every distinct id typed in `text`, in order of first appearance.
    public static func parse(_ text: String) -> [StrongsIdMatch] {
        var seen = Set<String>()
        var out: [StrongsIdMatch] = []
        let units = Array(text.utf16)
        for m in scan(text) {
            let lang: Character = (m.lang == "H" || m.lang == "h") ? "H" : "G"
            guard let number = Int(m.digits), number > 0 else { continue }
            let id = "\(lang)\(number)"
            if !seen.insert(id).inserted { continue }
            out.append(StrongsIdMatch(id: id, lang: lang, number: number,
                                      raw: String(decoding: units[m.start..<m.end], as: UTF16.self), index: m.start))
        }
        return out
    }

    /// `normalizeStrongsId` ("g-05485" → "G5485"), nil when the whole value is not one id.
    public static func normalize(_ value: String) -> String? {
        let t = JSText.trim(value)
        let hits = parse(t)
        return hits.count == 1 && JSText.length(hits[0].raw) == JSText.length(t) ? hits[0].id : nil
    }
}
