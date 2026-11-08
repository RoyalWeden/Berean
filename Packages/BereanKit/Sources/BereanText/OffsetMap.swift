import BereanCore

/// Display ⇄ original verse-text offset alignment — port of the mapping in src/lib/verseUtils.ts.
/// Highlights are stored against `verse.text`; selections are measured on the displayed text
/// (word replacer, hidden annotations, token-rebuilt text). Offsets are UTF-16 code units.
public enum OffsetMap {
    typealias U = [UInt16]

    static func normalizeQuote(_ c: UInt16) -> UInt16 {
        switch c {
        case 0x2018, 0x2019, 0x201A, 0x201B, 0x2032: return 0x27
        case 0x201C, 0x201D, 0x201E, 0x201F, 0x2033: return 0x22
        default: return c
        }
    }
    static func normalizeForAlign(_ s: U) -> U {
        Array(JSText.trim(JSText.collapseWhitespace(String(decoding: s.map(normalizeQuote), as: UTF16.self))).utf16)
    }
    static func normalizeWord(_ w: ArraySlice<UInt16>) -> U {
        var u = w.map(normalizeQuote)
        while let l = u.last, [0x2C, 0x3B, 0x3A, 0x2E, 0x21, 0x3F].contains(l) { u.removeLast() }
        return u
    }

    static func splitWordSpans(_ t: U) -> [(text: ArraySlice<UInt16>, start: Int)] {
        var out: [(ArraySlice<UInt16>, Int)] = []
        var pos = 0
        for w in t.split(separator: 0x20, omittingEmptySubsequences: false) {
            out.append((w, pos)); pos += w.count + 1
        }
        return out
    }

    static func lcsPairs(_ D: [(text: ArraySlice<UInt16>, start: Int)], _ O: [(text: ArraySlice<UInt16>, start: Int)]) -> [(Int, Int)] {
        let n = D.count, m = O.count
        let dn = D.map { normalizeWord($0.text) }, on = O.map { normalizeWord($0.text) }
        // dp[i][j] = LCS length of D[i...] and O[j...], stored flat (row stride m + 1).
        let w = m + 1
        var dp = [Int](repeating: 0, count: (n + 1) * w)
        if n > 0 && m > 0 {
            for i in stride(from: n - 1, through: 0, by: -1) {
                for j in stride(from: m - 1, through: 0, by: -1) {
                    dp[i * w + j] = dn[i] == on[j] ? dp[(i + 1) * w + j + 1] + 1 : max(dp[(i + 1) * w + j], dp[i * w + j + 1])
                }
            }
        }
        var pairs: [(Int, Int)] = []
        var i = 0, j = 0
        while i < n && j < m {
            if dn[i] == on[j] { pairs.append((i, j)); i += 1; j += 1 }
            else if dp[(i + 1) * w + j] >= dp[i * w + j + 1] { i += 1 }
            else { j += 1 }
        }
        return pairs
    }

    static func cosmetic(_ from: U, _ to: U, _ offset: Int) -> Int? {
        let target = max(0, min(offset, from.count))
        var fi = 0, ti = 0
        while fi < target {
            let fWs = fi < from.count && JSWhitespace.isWhitespace(from[fi])
            let tWs = ti < to.count && JSWhitespace.isWhitespace(to[ti])
            if fWs || tWs { if fWs { fi += 1 }; if tWs { ti += 1 }; continue }
            if fi >= from.count || ti >= to.count { return nil }
            if normalizeQuote(from[fi]) != normalizeQuote(to[ti]) { return nil }
            fi += 1; ti += 1
        }
        return max(0, min(ti, to.count))
    }

    static func alignment(_ d: U, _ o: U) -> (d: [Int], o: [Int]) {
        let D = splitWordSpans(d), O = splitWordSpans(o)
        var db = [0], ob = [0]
        func push(_ dv: Int, _ ov: Int) { if dv > db.last! && ov >= ob.last! { db.append(dv); ob.append(ov) } }
        for (di, oj) in lcsPairs(D, O) {
            push(D[di].start, O[oj].start)
            push(D[di].start + D[di].text.count, O[oj].start + O[oj].text.count)
        }
        push(d.count, o.count)
        return (db, ob)
    }

    static func interp(_ from: [Int], _ to: [Int], _ x: Int) -> Int {
        if x <= from[0] { return to[0] }
        let last = from.count - 1
        if x >= from[last] { return to[last] }
        for k in 0..<last where x >= from[k] && x <= from[k + 1] {
            let span = from[k + 1] - from[k]
            if span == 0 { return to[k] }
            let v = Double(to[k]) + (Double(x - from[k]) / Double(span)) * Double(to[k + 1] - to[k])
            return Int((v + 0.5).rounded(.down))   // Math.round
        }
        return to[last]
    }

    /// `mapDisplayOffsetToOriginal`.
    public static func displayToOriginal(display: String, original: String, offset: Int) -> Int {
        displayToOriginal(display: display, original: original, offsets: [offset])[0]
    }

    /// `mapOriginalOffsetToDisplay`.
    public static func originalToDisplay(display: String, original: String, offset: Int) -> Int {
        originalToDisplay(display: display, original: original, offsets: [offset])[0]
    }

    /// Batch form: aligns the two texts once and maps every offset (same results as one call each).
    public static func displayToOriginal(display: String, original: String, offsets: [Int]) -> [Int] {
        let d = Array(display.utf16), o = Array(original.utf16)
        if d == o { return offsets.map { max(0, min($0, o.count)) } }
        if normalizeForAlign(d) == normalizeForAlign(o) {
            let m = offsets.map { cosmetic(d, o, $0) }
            if !m.contains(where: { $0 == nil }) { return m.map { $0! } }
            let a = alignment(d, o)
            return zip(offsets, m).map { off, v in v ?? interp(a.d, a.o, off) }
        }
        let a = alignment(d, o)
        return offsets.map { interp(a.d, a.o, $0) }
    }

    public static func originalToDisplay(display: String, original: String, offsets: [Int]) -> [Int] {
        let d = Array(display.utf16), o = Array(original.utf16)
        if d == o { return offsets.map { max(0, min($0, d.count)) } }
        if normalizeForAlign(d) == normalizeForAlign(o) {
            let m = offsets.map { cosmetic(o, d, $0) }
            if !m.contains(where: { $0 == nil }) { return m.map { $0! } }
            let a = alignment(d, o)
            return zip(offsets, m).map { off, v in v ?? interp(a.o, a.d, off) }
        }
        let a = alignment(d, o)
        return offsets.map { interp(a.o, a.d, $0) }
    }
}

/// Annotation stripping for the bracket conventions in plain verse text — port of
/// src/lib/annotationFilters.ts (`stripAnnotations`).
public enum Annotations {
    static let commaComma = JSRegex(#",\s*,"#)
    static let spaceBeforePunct = JSRegex(#"\s+([,;:.!?])"#)
    static let spaces = JSRegex(#"\s+"#)
    static let square = JSRegex(#"\s*\[([^\]]*)\]"#)
    static let paren = JSRegex(#"\s*\(([^)]*)\)"#)
    static let angleRestored = JSRegex(#"\s*〈([^〉]*)〉"#)
    static let jubDate = JSRegex(#"\s*\[[\d][\d\s\-,]*\s*(?:A\.M\.|Anno\s+Mundi)\s*\]"#, ignoreCase: true)
    static let jubBracket = JSRegex(#"\s*\[(?![\d][\d\s\-,]*\s*(?:A\.M\.|Anno\s+Mundi))[^\]]*\]"#)
    static let jubRestored = JSRegex(#"\s*<([^>]*)>"#)
    static let jubStanza = JSRegex(#"\s*\([a-z]\)\s*"#)
    static let jubSupply = JSRegex(#"\s*\((?![a-z]\))([^)]*)\)"#)

    static func cleanPunctuation(_ s: String) -> String {
        JSText.trim(spaces.replaceAll(spaceBeforePunct.replaceAll(commaComma.replaceAll(s, with: ","), with: "$1"), with: " "))
    }

    public static func strip(_ text: String, textId: String, hidden: [String]) -> String {
        if hidden.isEmpty { return text }
        var r = text
        switch textId {
        case "lxx":
            if hidden.contains("lxx_supply") { r = square.replaceAll(r, with: "") }
            return cleanPunctuation(r)
        case "enoch":
            if hidden.contains("enoch_supply") { r = paren.replaceAll(r, with: "") }
            if hidden.contains("enoch_uncertain") { r = square.replaceAll(r, with: "") }
            if hidden.contains("enoch_restored") { r = angleRestored.replaceAll(r, with: "") }
            return cleanPunctuation(r)
        case "jubilees":
            if hidden.contains("jubilees_date") { r = jubDate.replaceAll(r, with: "") }
            if hidden.contains("jubilees_bracket") { r = jubBracket.replaceAll(r, with: "") }
            if hidden.contains("jubilees_restored") { r = jubRestored.replaceAll(r, with: "") }
            if hidden.contains("jubilees_stanza") { r = jubStanza.replaceAll(r, with: " ") }
            if hidden.contains("jubilees_supply") { r = jubSupply.replaceAll(r, with: "") }
            return cleanPunctuation(r)
        default:
            return text
        }
    }
}
