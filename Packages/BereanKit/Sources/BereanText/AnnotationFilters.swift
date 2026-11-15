import Foundation

/// Per-tab "hide this annotation" toggles — port of src/lib/annotationFilters.ts and the regex-backed entries of
/// `ANNOTATION_KEYS` (src/lib/bibleTexts.ts). Keys are stored in the tab's existing `hiddenAnnotations` array.
public enum AnnotationFilters {
    public struct Key: Identifiable, Sendable, Equatable { public let id: String, symbol: String, meaning: String }

    public static let kjvaSuppliedWords = "kjva_italics"

    public static let keys: [String: [Key]] = [
        "kjva": [Key(id: kjvaSuppliedWords, symbol: "Italic words", meaning: "Words supplied by the KJV translators. Shown in italics when visible.")],
        "lxx": [Key(id: "lxx_supply", symbol: "[word]", meaning: "Word supplied by the translator — not present in the Greek Septuagint text.")],
        "enoch": [
            Key(id: "enoch_supply", symbol: "(word)", meaning: "Word supplied or paraphrased for clarity by the translator."),
            Key(id: "enoch_uncertain", symbol: "[word]", meaning: "Textually uncertain or reconstructed passage."),
            Key(id: "enoch_restored", symbol: "〈word〉", meaning: "Text restored from Ethiopic manuscripts."),
        ],
        "jubilees": [
            Key(id: "jubilees_date", symbol: "[1307 A.M.]", meaning: "Anno Mundi — \"Year of the World.\" Chronological dates from creation embedded in the text by R.H. Charles."),
            Key(id: "jubilees_bracket", symbol: "[word]", meaning: "Translator insertion — text added by R.H. Charles for clarity or to supply repeated/parallel wording."),
            Key(id: "jubilees_supply", symbol: "(word)", meaning: "Word or phrase supplied by the translator; not in the Ethiopic source but implied by context."),
            Key(id: "jubilees_stanza", symbol: "(b) (c) …", meaning: "Stanza marker — single letter in parentheses dividing lines of embedded poetry (e.g. blessings, songs)."),
            Key(id: "jubilees_restored", symbol: "<word>", meaning: "Text restored from other manuscript witnesses where the Ethiopic is defective or missing."),
        ],
    ]

    private static func re(_ p: String, _ o: NSRegularExpression.Options = []) -> NSRegularExpression { try! NSRegularExpression(pattern: p, options: o) }
    nonisolated(unsafe) private static let jubDate = re(#"\s*\[[\d][\d\s\-,]*\s*(?:A\.M\.|Anno\s+Mundi)\s*\]"#, .caseInsensitive)
    nonisolated(unsafe) private static let jubBracket = re(#"\s*\[(?![\d][\d\s\-,]*\s*(?:A\.M\.|Anno\s+Mundi))[^\]]*\]"#)
    nonisolated(unsafe) private static let jubRestored = re(#"\s*<([^>]*)>"#)
    nonisolated(unsafe) private static let jubStanza = re(#"\s*\([a-z]\)\s*"#)
    nonisolated(unsafe) private static let jubSupply = re(#"\s*\((?![a-z]\))([^)]*)\)"#)
    nonisolated(unsafe) private static let square = re(#"\s*\[([^\]]*)\]"#)
    nonisolated(unsafe) private static let paren = re(#"\s*\(([^)]*)\)"#)
    nonisolated(unsafe) private static let angleCJK = re(#"\s*〈([^〉]*)〉"#)

    private static func replace(_ s: String, _ r: NSRegularExpression, _ with: String = "") -> String {
        r.stringByReplacingMatches(in: s, range: NSRange(s.startIndex..., in: s), withTemplate: with)
    }

    static func cleanPunctuation(_ s: String) -> String {
        var r = s.replacingOccurrences(of: #",\s*,"#, with: ",", options: .regularExpression)
        r = r.replacingOccurrences(of: #"\s+([,;:.!?])"#, with: "$1", options: .regularExpression)
        r = r.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        return r.trimmingCharacters(in: .whitespaces)
    }

    /// `stripAnnotations` — plain verse text.
    public static func strip(_ text: String, textId: String, hidden: Set<String>) -> String {
        guard !hidden.isEmpty else { return text }
        var r = text
        switch textId {
        case "lxx":
            if hidden.contains("lxx_supply") { r = replace(r, square) }
        case "enoch":
            if hidden.contains("enoch_supply") { r = replace(r, paren) }
            if hidden.contains("enoch_uncertain") { r = replace(r, square) }
            if hidden.contains("enoch_restored") { r = replace(r, angleCJK) }
        case "jubilees":
            if hidden.contains("jubilees_date") { r = replace(r, jubDate) }
            if hidden.contains("jubilees_bracket") { r = replace(r, jubBracket) }
            if hidden.contains("jubilees_restored") { r = replace(r, jubRestored) }
            if hidden.contains("jubilees_stanza") { r = replace(r, jubStanza, " ") }
            if hidden.contains("jubilees_supply") { r = replace(r, jubSupply) }
        default:
            return text
        }
        return cleanPunctuation(r)
    }

    /// Brenton's Strong's-tagged text: drops the `word{G…}` tokens inside `[ … ]` so the tagged words stay aligned
    /// with the stripped plain text.
    public static func stripTagged(_ tagged: String, textId: String, hidden: Set<String>) -> String {
        guard textId == "lxx", hidden.contains("lxx_supply") else { return tagged }
        var out: [String] = [], inside = false
        for token in tagged.split(whereSeparator: \.isWhitespace) {
            let word = token.replacingOccurrences(of: #"\{[^}]*\}"#, with: "", options: .regularExpression)
            if !inside, word.hasPrefix("[") {
                if !word.contains("]") { inside = true }
                if let close = word.firstIndex(of: "]"), word.index(after: close) < word.endIndex, let last = out.indices.last {
                    out[last] += String(word[word.index(after: close)...])   // keep trailing punctuation: "[a Psalm]," → ","
                }
                continue
            }
            if inside {
                if word.contains("]") {
                    inside = false
                    if let close = word.firstIndex(of: "]"), word.index(after: close) < word.endIndex, let last = out.indices.last {
                        out[last] += String(word[word.index(after: close)...])
                    }
                }
                continue
            }
            out.append(String(token))
        }
        return out.joined(separator: " ")
    }
}
