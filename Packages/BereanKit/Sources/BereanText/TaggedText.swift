import BereanCore

/// One `text_tagged` token — port of src/lib/taggedTokens.ts.
public struct TaggedToken: Equatable, Sendable {
    public enum Strongs: Equatable, Sendable { case one(String), many([String]) }
    public var word: String
    public var strongs: Strongs?
    public var isItalic: Bool
    public var isRedLetter: Bool
    /// `~{H853}` — grammatical particle with no English word.
    public var isParenthetical: Bool
    /// The visible bracket of a `sup>` alignment marker — never rendered as text.
    public var isStrongsBracket: Bool

    /// True when the token contributes no characters to the plain verse text (`tokenHasNoPlainText`).
    public var hasNoPlainText: Bool { isParenthetical || isStrongsBracket || word.isEmpty }

    public var json: JSValue {
        var o = JSObject()
        o["word"] = .string(JSString(word))
        switch strongs {
        case .none: o["strongsNum"] = .null
        case .one(let s): o["strongsNum"] = .string(JSString(s))
        case .many(let a): o["strongsNum"] = .array(a.map { .string(JSString($0)) })
        }
        o["isItalic"] = .bool(isItalic); o["isRedLetter"] = .bool(isRedLetter)
        o["isParenthetical"] = .bool(isParenthetical); o["isStrongsBracket"] = .bool(isStrongsBracket)
        return .object(o)
    }
}

public struct AnnotationRange: Equatable, Sendable {
    /// UTF-16 offsets into the plain verse text (as stored highlights use).
    public var start: Int, end: Int, isRedLetter: Bool, isItalic: Bool
    public var json: JSValue {
        var o = JSObject()
        o["start"] = .number(Double(start)); o["end"] = .number(Double(end))
        o["isRedLetter"] = .bool(isRedLetter); o["isItalic"] = .bool(isItalic)
        return .object(o)
    }
}

public enum TaggedText {
    static let boldFragment = JSRegex(#"<?\/?b>"#, ignoreCase: true)
    static let bracketOnly = JSRegex(#"^[()[\]]+$"#)

    static func dropPrefixCI(_ s: inout String, _ prefix: String) -> Bool {
        let u = Array(s.utf16), p = Array(prefix.utf16)
        guard u.count >= p.count else { return false }
        for k in 0..<p.count {
            var c = u[k]; if (0x41...0x5A).contains(c) { c += 32 }
            if c != p[k] { return false }
        }
        s = String(decoding: u[p.count...], as: UTF16.self)
        return true
    }

    /// `parseTaggedTokens`. Format per space-separated token: `word{H7225}`, `word{}`, `*italic{}`,
    /// `!redLetter{G1063}`, `~{H853}`, `word{H914|H996}`; stray `sup>`/`blu>`/`b>` fragments are removed.
    public static func parse(_ tagged: String) -> [TaggedToken] {
        var tokens: [TaggedToken] = []
        for sub in tagged.split(separator: " ", omittingEmptySubsequences: false) {
            var part = String(sub)
            if part.isEmpty { continue }
            let lowerHead = String(part.prefix(5)).lowercased()
            let wasSupWrapped = lowerHead.hasPrefix("/sup>") || lowerHead.hasPrefix("sup>")
            _ = dropPrefixCI(&part, "/sup>"); _ = dropPrefixCI(&part, "sup>")
            _ = dropPrefixCI(&part, "/blu>"); _ = dropPrefixCI(&part, "blu>")
            // /<?\/?b>/gi can only match where a '>' is present (fast path: nearly every token).
            if part.utf16.contains(0x3E) { part = boldFragment.replaceAll(part, with: "") }
            if part.isEmpty { continue }
            let u = Array(part.utf16)
            if u.count >= 2, u[0] == 0x7E, u[1] == 0x7B, u.last == 0x7D, u.count >= 3 {
                let sr = JSText.trim(String(decoding: u[2..<(u.count - 1)], as: UTF16.self))
                tokens.append(TaggedToken(word: "", strongs: sr.isEmpty ? nil : .one(sr), isItalic: false, isRedLetter: false, isParenthetical: true, isStrongsBracket: false))
                continue
            }
            let isRed = u.first == 0x21
            let afterRed = isRed ? Array(u.dropFirst()) : u
            let isItalic = afterRed.first == 0x2A
            let raw = isItalic ? Array(afterRed.dropFirst()) : afterRed
            if let brace = raw.lastIndex(of: 0x7B), raw.last == 0x7D {
                let word = String(decoding: raw[..<brace], as: UTF16.self)
                let sr = JSText.trim(String(decoding: raw[(brace + 1)..<(raw.count - 1)], as: UTF16.self))
                let parts = sr.isEmpty ? [] : sr.split(separator: "|", omittingEmptySubsequences: false).map(String.init)
                let strongs: TaggedToken.Strongs? = parts.count > 1 ? .many(parts) : (parts.first.flatMap { $0.isEmpty ? nil : .one($0) })
                let bracket = wasSupWrapped && strongs == nil && bracketOnly.match(word) != nil
                tokens.append(TaggedToken(word: word, strongs: strongs, isItalic: isItalic, isRedLetter: isRed, isParenthetical: false, isStrongsBracket: bracket))
            } else {
                tokens.append(TaggedToken(word: String(decoding: raw, as: UTF16.self), strongs: nil, isItalic: isItalic, isRedLetter: isRed, isParenthetical: false, isStrongsBracket: false))
            }
        }
        return tokens
    }

    /// `getAnnotationRanges` — italic / red-letter spans (KJVA and LXX only), re-anchored to the
    /// real position of each word in `plainText` when given.
    public static func annotationRanges(_ tagged: String?, textId: String, plainText: String? = nil) -> [AnnotationRange] {
        guard let tagged, !tagged.isEmpty, textId == "kjva" || textId == "lxx" else { return [] }
        let plain = plainText.flatMap { $0.isEmpty ? nil : Array($0.utf16) }
        var ranges: [AnnotationRange] = []
        var charPos = 0
        for t in parse(tagged) {
            if t.hasNoPlainText || t.word.isEmpty { continue }
            let w = Array(t.word.utf16)
            var start = charPos
            if let plain {
                guard let idx = indexOf(plain, w, from: charPos) else { charPos += w.count + 1; continue }
                start = idx
            }
            let end = start + w.count
            if t.isRedLetter || t.isItalic { ranges.append(AnnotationRange(start: start, end: end, isRedLetter: t.isRedLetter, isItalic: t.isItalic)) }
            charPos = end + 1
        }
        return ranges
    }

    /// `String.prototype.indexOf(needle, from)` over code units.
    static func indexOf(_ hay: [UInt16], _ needle: [UInt16], from: Int) -> Int? {
        let start = max(0, min(from, hay.count))
        if needle.isEmpty { return start }
        if needle.count > hay.count { return nil }
        var i = start
        while i + needle.count <= hay.count {
            if hay[i] == needle[0] && Array(hay[i..<(i + needle.count)]) == needle { return i }
            i += 1
        }
        return nil
    }
}
