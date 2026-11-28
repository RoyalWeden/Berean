import Foundation

/// Splits lexicon text into plain runs and Strong's cross-references — port of `DerivationText` in
/// src/components/lexicon/LexiconPanel.tsx. `H1234` / `G05` link as written (leading zeros dropped);
/// bare 1–5 digit numbers ("from 2165", "See 7495.") link in the entry's own language. A bare number
/// touching a colon (chapter:verse such as "32:38") or preceded by "." or a digit stays plain text.
public enum StrongsRefTokens {
    public enum Token: Equatable, Sendable { case text(String), ref(String) }

    nonisolated(unsafe) private static let pattern = try! NSRegularExpression(pattern: #"\b[HG]\d{1,5}\b|(?<![:.\d])\b\d{1,5}\b(?!\s*:)"#)

    public static func tokens(_ text: String, lang: Character) -> [Token] {
        let ns = text as NSString
        var out: [Token] = []
        var cursor = 0
        for m in pattern.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            if m.range.location > cursor { out.append(.text(ns.substring(with: NSRange(location: cursor, length: m.range.location - cursor)))) }
            let part = ns.substring(with: m.range)
            if let first = part.first, first == "H" || first == "G", let n = Int(part.dropFirst()) {
                out.append(.ref("\(first)\(n)"))
            } else if let n = Int(part) {
                out.append(.ref("\(lang)\(n)"))
            } else {
                out.append(.text(part))
            }
            cursor = m.range.location + m.range.length
        }
        if cursor < ns.length { out.append(.text(ns.substring(from: cursor))) }
        return out
    }
}
