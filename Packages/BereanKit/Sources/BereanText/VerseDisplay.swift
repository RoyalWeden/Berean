import BereanCore

public struct DisplayToken: Equatable, Sendable { public var word: String, isRedLetter: Bool, isItalic: Bool }
public struct StudyToken: Equatable, Sendable { public var word: String, strongs: [String], isRedLetter: Bool, isItalic: Bool }

/// Verse display text as the reader shows and copies it — port of the display functions in
/// src/lib/verseUtils.ts (word replacer, Strong's restorations, "the" suppression before a restored name).
public enum VerseDisplay {
    static func nums(_ s: TaggedToken.Strongs?) -> [String] {
        switch s { case .none: return []; case .one(let x): return [x]; case .many(let a): return a }
    }
    static func stripTrailingPunct(_ w: String) -> String {
        var u = Array(w.utf16)
        while let l = u.last, [0x2C, 0x3B, 0x3A, 0x2E, 0x21, 0x3F].contains(l) { u.removeLast() }
        return String(decoding: u, as: UTF16.self)
    }

    /// Tokens after replacement with suppressed "the"s removed (shared by text and token builders).
    static func processed(_ tokens: [TaggedToken], replace: Bool, rules: [WordReplacerRule]) -> [TaggedToken] {
        var p = tokens.map { t -> TaggedToken in
            guard replace, !t.isParenthetical, !t.isStrongsBracket else { return t }
            var t = t
            t.word = WordReplacer.applyStrongs(WordReplacer.apply(t.word, rules: rules), strongs: t.strongs, rules: rules)
            return t
        }
        var suppressed = Set<Int>()
        if replace {
            let active = rules.filter { $0.enabled && $0.strongsNum != nil }
            if !active.isEmpty {
                for (i, t) in p.enumerated() {
                    if t.isParenthetical || t.isStrongsBracket || t.strongs == nil { continue }
                    let n = nums(t.strongs)
                    if !active.contains(where: { n.contains($0.strongsNum!) }) { continue }
                    var j = i - 1
                    while j >= 0 {
                        let prev = p[j]
                        if prev.isParenthetical || prev.isStrongsBracket { j -= 1; continue }
                        if JSText.lower(stripTrailingPunct(prev.word)) == "the" { suppressed.insert(j) }
                        break
                    }
                }
            }
        }
        p = p.enumerated().filter { !$0.element.isParenthetical && !$0.element.isStrongsBracket && !suppressed.contains($0.offset) && !$0.element.word.isEmpty }.map(\.element)
        return p
    }

    /// `buildVerseDisplayText`.
    public static func text(_ text: String, tagged: String?, textId: String, replacerEnabled: Bool, rules: [WordReplacerRule]) -> String {
        let replace = replacerEnabled && !rules.isEmpty
        let tokens = textId == "kjva" && !(tagged ?? "").isEmpty ? TaggedText.parse(tagged!) : []
        if textId == "kjva", !(tagged ?? "").isEmpty, replace, !tokens.isEmpty {
            return processed(tokens, replace: true, rules: rules).map(\.word).joined(separator: " ")
        }
        return replace ? WordReplacer.apply(text, rules: rules) : text
    }

    /// `buildVerseDisplayTokens` (red-letter / italic flags for renderers without Strong's chips).
    public static func tokens(_ text: String, tagged: String?, textId: String, replacerEnabled: Bool, rules: [WordReplacerRule]) -> [DisplayToken] {
        let replace = replacerEnabled && !rules.isEmpty
        let tokens = textId == "kjva" && !(tagged ?? "").isEmpty ? TaggedText.parse(tagged!) : []
        if tokens.isEmpty {
            return [DisplayToken(word: replace ? WordReplacer.apply(text, rules: rules) : text, isRedLetter: false, isItalic: false)]
        }
        return processed(tokens, replace: replace, rules: rules).map { DisplayToken(word: $0.word, isRedLetter: $0.isRedLetter, isItalic: $0.isItalic) }
    }

    /// `buildVerseStudyTokens` (word + its Strong's numbers; particles attach "(H853)" to the previous word).
    public static func studyTokens(_ text: String, tagged: String?, textId: String, replacerEnabled: Bool, rules: [WordReplacerRule]) -> [StudyToken] {
        let replace = replacerEnabled && !rules.isEmpty
        let tokens = (tagged ?? "").isEmpty ? [] : TaggedText.parse(tagged!)
        if tokens.isEmpty { return [StudyToken(word: replace ? WordReplacer.apply(text, rules: rules) : text, strongs: [], isRedLetter: false, isItalic: false)] }
        var out: [StudyToken] = []
        for t in tokens {
            if t.isStrongsBracket { continue }
            let n = nums(t.strongs)
            if t.isParenthetical {
                if !out.isEmpty && !n.isEmpty { out[out.count - 1].strongs += n.map { "(\($0))" } }
                continue
            }
            var w = t.word
            if replace { w = WordReplacer.applyStrongs(WordReplacer.apply(w, rules: rules), strongs: t.strongs, rules: rules) }
            if w.isEmpty { continue }
            out.append(StudyToken(word: w, strongs: n, isRedLetter: t.isRedLetter, isItalic: t.isItalic))
        }
        return out
    }

    static let tagRegex = JSRegex(#"\*?([^{}*]+)\{([^}]*)\}"#)

    /// `findMatchWordIndices` — word indices carrying a Strong's number (gloss-word fallback for untagged text).
    public static func matchWordIndices(tagged: String?, plainText: String, strongsNum: String, fallbackWords: [String]) -> [Int] {
        if let tagged, !tagged.isEmpty {
            var indices: [Int] = []
            for (i, m) in tagRegex.allMatches(tagged).enumerated() {
                let tag = JSText.trim(m[2] ?? "")
                if !tag.isEmpty && JSText.upper(tag) == JSText.upper(strongsNum) { indices.append(i) }
            }
            if !indices.isEmpty { return indices }
        }
        guard !fallbackWords.isEmpty, !plainText.isEmpty else { return [] }
        var out: [Int] = []
        for (idx, word) in plainText.split(separator: " ", omittingEmptySubsequences: false).enumerated() {
            let clean = String(JSText.lower(String(word)).unicodeScalars.filter { ("a"..."z").contains($0) }.map(Character.init))
            if clean.utf16.count >= 4 && fallbackWords.contains(where: { $0 == clean || $0 == clean + "s" || $0 + "s" == clean }) { out.append(idx) }
        }
        return out
    }

    static let parenRegex = JSRegex(#"\([^)]*\)"#)
    static let glossPunct = JSRegex(#"[××+\-]"#)
    static let glossSplit = JSRegex(#"[,\s]+"#)

    /// `extractGlossWords`.
    public static func glossWords(_ shortDef: String) -> [String] {
        let s = glossSplit.replaceAll(glossPunct.replaceAll(parenRegex.replaceAll(JSText.lower(shortDef), with: " "), with: " "), with: "\u{0}")
        return s.split(separator: "\u{0}", omittingEmptySubsequences: false)
            .map { String($0.unicodeScalars.filter { ("a"..."z").contains($0) }.map(Character.init)) }
            .filter { $0.utf16.count >= 4 }
    }

    /// `getWordWindow` — a 14-word window around the first match for long verses (nil = show all).
    public static func wordWindow(_ text: String, matchIndices: [Int]) -> (text: String, indices: [Int])? {
        guard let firstMatch = matchIndices.first, text.utf16.count >= 160 else { return nil }
        let words = text.split(separator: " ").map(String.init)
        if firstMatch < 10 || firstMatch >= words.count { return nil }
        let start = max(0, firstMatch - 3), end = min(words.count, start + 14)
        if start >= end { return nil }
        let prefix = start > 0, suffix = end < words.count
        var parts: [String] = []
        if prefix { parts.append("…") }
        parts += words[start..<end]
        if suffix { parts.append("…") }
        let off = prefix ? 1 : 0
        return (parts.joined(separator: " "), matchIndices.filter { $0 >= start && $0 < end }.map { $0 - start + off })
    }
}
