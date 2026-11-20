import Foundation

/// Deterministic follow-ups for model-free Ask Berean (subset of the original
/// lib/research/conversationState.ts): a short reply is rewritten into a complete request against
/// what the conversation already resolved, with an "Interpreted as …" reason.
public enum AskFollowUp {
    public struct State: Equatable, Sendable {
        public var topicQuestion: String?
        public var term: String?
        public var lang: String?          // "H" / "G"
        public var strongs: [String] = [] // most recent answer first
        public var refs: [String] = []    // references shown last ("Isaiah 7:14")
        public init(topicQuestion: String? = nil, term: String? = nil, lang: String? = nil, strongs: [String] = [], refs: [String] = []) {
            self.topicQuestion = topicQuestion; self.term = term; self.lang = lang; self.strongs = strongs; self.refs = refs
        }
    }

    public struct Resolved: Equatable, Sendable {
        public var question: String
        public var reason: String
        public var excludeRefs: [String] = []
        public var limit: Int?
    }

    static let followUp = try! NSRegularExpression(pattern: #"^(?:(?:what(?:'s|\s+is)\s+)?(?:the\s+)?(?:greek|hebrew)\s+(?:equivalent|counterpart|one)|and|now|any|anything|ok(?:ay)?|also|then|what about|how about|same|more|show|give|just|only|try|compare|contrast|switch|no,|actually|i meant)\b|\b(?:that|those|these|them|it|more|the same|again|the (?:first|second|third|last) (?:one|passage|verse|entry))\b"#, options: .caseInsensitive)
    static let ordinals: [String: Int] = ["first": 0, "second": 1, "third": 2, "fourth": 3, "fifth": 4, "last": -1]
    static let numberWords: [String: Int] = ["one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10]

    static func match(_ pattern: String, _ text: String) -> [String]? {
        guard let re = try? NSRegularExpression(pattern: pattern, options: .caseInsensitive),
              let m = re.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) else { return nil }
        return (0..<m.numberOfRanges).map { i in Range(m.range(at: i), in: text).map { String(text[$0]) } ?? "" }
    }

    public static func isFollowUp(_ question: String) -> Bool {
        let q = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty, q.split(separator: " ").count <= 14 else { return false }
        return followUp.firstMatch(in: q, range: NSRange(q.startIndex..., in: q)) != nil
    }

    /// "only 2", "just the best one", "give me five".
    public static func limit(_ q: String) -> Int? {
        if match(#"\bjust the (?:best|top) one\b|\bonly (?:the )?(?:best|top) one\b"#, q) != nil { return 1 }
        guard let m = match(#"\b(?:only|just|give me|show me)\s+(?:the\s+)?(?:top\s+)?(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b"#, q) else { return nil }
        return Int(m[1]) ?? numberWords[m[1].lowercased()]
    }

    public static func resolve(_ question: String, state: State) -> Resolved? {
        let q = question.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isFollowUp(q) else { return nil }
        // "try again"
        if match(#"^(?:please\s+)?try again\b"#, q) != nil, let base = state.topicQuestion {
            return Resolved(question: base, reason: "Asked again: “\(base)”")
        }
        // "now only Greek", "what about the Hebrew?", "the Greek equivalent"
        if let m = match(#"\b(?:what about|how about|i meant|now only|now|only|and|switch to|in)\s+(?:the\s+)?(greek|hebrew)\b"#, q)
            ?? match(#"^(?:what(?:'s|\s+is)\s+)?(?:the\s+)?(greek|hebrew)\s+(?:one|equivalent|counterpart)\??$"#, q) {
            let lang = m[1].lowercased()
            if let term = state.term {
                return Resolved(question: "\(term) in \(lang)", reason: "The \(lang.capitalized) word for “\(term)”")
            }
        }
        // "compare the first two" / "compare the second with the first"
        if match(#"\b(compare|contrast)\b"#, q) != nil, state.strongs.count >= 2 {
            if match(#"\bfirst two\b"#, q) != nil {
                return Resolved(question: "compare \(state.strongs[0]) and \(state.strongs[1])", reason: "Compared \(state.strongs[0]) and \(state.strongs[1])")
            }
            let re = try! NSRegularExpression(pattern: #"\b(first|second|third|fourth|fifth|last)\b"#, options: .caseInsensitive)
            let picks = re.matches(in: q, range: NSRange(q.startIndex..., in: q)).compactMap { m -> String? in
                guard let r = Range(m.range(at: 1), in: q), let i = ordinals[q[r].lowercased()] else { return nil }
                let idx = i < 0 ? state.strongs.count + i : i
                return state.strongs.indices.contains(idx) ? state.strongs[idx] : nil
            }
            if picks.count >= 2 { return Resolved(question: "compare \(picks[0]) and \(picks[1])", reason: "Compared \(picks[0]) and \(picks[1])") }
        }
        // "show that in the LXX", "and in the Septuagint?"
        if match(#"\b(lxx|septuagint|brenton)\b"#, q) != nil, let ref = state.refs.first {
            return Resolved(question: "compare \(ref) KJV and LXX", reason: "\(ref) in the KJV and the Septuagint")
        }
        // "more", "five more", "show me more"
        if let m = match(#"\b(?:(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+)?more\b"#, q), let base = state.topicQuestion {
            let n = Int(m[1]) ?? numberWords[m[1].lowercased()]
            return Resolved(question: base, reason: "More for “\(base)”", excludeRefs: state.refs, limit: n)
        }
        // "only 2", "just the best one" — the same request, fewer results.
        if let n = limit(q), let base = state.topicQuestion {
            return Resolved(question: base, reason: "“\(base)”, \(n) result\(n == 1 ? "" : "s")", limit: n)
        }
        return nil
    }
}
