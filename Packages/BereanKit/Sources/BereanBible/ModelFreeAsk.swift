import Foundation

/// Ask Berean without a model (original modelFreeLookup.ts): pure question parsing.
public enum ModelFreeAsk {
    /// The original's stop words (modelFreeLookup.ts STOP).
    static let stop: Set<String> = ["what", "where", "which", "when", "who", "whom", "why", "how", "does", "did", "the", "and", "for", "about",
        "with", "from", "that", "this", "these", "those", "are", "was", "were", "show", "find", "give", "list", "tell", "verses", "verse",
        "passages", "passage", "scripture", "scriptures", "bible", "say", "says", "said", "mean", "means", "any", "all", "some", "into",
        "unto", "have", "has", "can", "you", "your", "please", "only", "just"]

    /// Up to six distinct keywords (letters, apostrophes, hyphens; ≥ 3 characters; not stop words).
    public static func keywords(_ question: String) -> [String] {
        let cleaned = String(question.lowercased().unicodeScalars.map { CharacterSet.letters.contains($0) || $0 == "'" || $0 == "-" || CharacterSet.whitespaces.contains($0) ? Character($0) : " " })
        var out: [String] = []
        for w in cleaned.split(whereSeparator: \.isWhitespace).map(String.init) where w.count >= 3 && !stop.contains(w) && !out.contains(w) {
            out.append(w)
            if out.count == 6 { break }
        }
        return out
    }

    /// KJV spellings differ ("jubile", "shew"): long keywords shortened by two letters for a prefix search.
    public static func stems(_ keywords: [String]) -> [String] {
        keywords.map { $0.count >= 6 ? String($0.dropLast(2)) : $0 }
    }

    /// A word-study request: "word study on grace", "meaning of shalom", "define grace in Greek",
    /// "grace in Hebrew", "strong's for love". Language: "H", "G" or nil.
    public static func wordStudy(_ question: String) -> (word: String, lang: String?)? {
        let q = question.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let lang: String? = q.contains("hebrew") ? "H" : q.contains("greek") ? "G" : nil
        let patterns = [#"word study (?:on |of |for )?(?:the word )?["“']?([\p{L}'-]+)"#, #"meaning of (?:the word )?["“']?([\p{L}'-]+)"#,
                        #"^define ["“']?([\p{L}'-]+)"#, #"strong'?s (?:number )?for ["“']?([\p{L}'-]+)"#,
                        #"^["“']?([\p{L}'-]+)["”']? in (?:the )?(?:hebrew|greek)\b"#, #"(?:hebrew|greek) (?:word )?for ["“']?([\p{L}'-]+)"#]
        for p in patterns {
            guard let re = try? NSRegularExpression(pattern: p),
                  let m = re.firstMatch(in: q, range: NSRange(q.startIndex..., in: q)), m.numberOfRanges > 1,
                  let r = Range(m.range(at: 1), in: q) else { continue }
            let word = String(q[r])
            if !stop.contains(word) && word.count >= 2 { return (word, lang) }
        }
        return nil
    }

    /// The best lexicon entry for an English word: gloss contains it as a whole word (else any
    /// result), then the most frequent — "grace" → charis (G5485), not a rare synonym.
    public static func best(_ entries: [LexiconEntry], for word: String) -> LexiconEntry? {
        let w = word.lowercased()
        func wholeWord(_ text: String) -> Bool {
            text.lowercased().split(whereSeparator: { !$0.isLetter && $0 != "'" }).contains { $0 == w }
        }
        let glossed = entries.filter { wholeWord($0.gloss) }
        return (glossed.isEmpty ? entries : glossed).max { $0.occurrences < $1.occurrences }
    }
}
