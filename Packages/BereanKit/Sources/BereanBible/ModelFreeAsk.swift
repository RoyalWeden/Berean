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

    // MARK: Exclusions (original lib/research/exclusions.ts)

    public struct Exclusions: Equatable, Sendable {
        public var remainder: String
        public var terms: [String]
        public var bookIds: [String]
    }

    static let asksForVerses = try! NSRegularExpression(pattern: #"\b(?:verses?|passages?|scriptures?|find|show|list)\b"#, options: .caseInsensitive)
    static let clause = try! NSRegularExpression(pattern: #"[,;]?\s*\b(?:but\s+not|and\s+not|not\s+including|excluding|except\s+for|other\s+than|leaving\s+out|leave\s+out)\s+([^,.;?!]+)"#, options: .caseInsensitive)
    static let bookClause = try! NSRegularExpression(pattern: #"[,;]?\s*\b(?:(?:but|and)\s+)?not\s+(?:from|in)\s+((?:the\s+book\s+of\s+)?[^,.;?!]+)"#, options: .caseInsensitive)
    static let filler: Set<String> = ["the", "a", "an", "of", "to", "from", "in", "about", "on", "book", "any", "those", "that", "mention", "mentioning", "verses", "passages"]

    public static func exclusions(_ question: String, resolveBook: (String) -> String?) -> Exclusions {
        let none = Exclusions(remainder: question, terms: [], bookIds: [])
        let ns = question as NSString
        let all = NSRange(location: 0, length: ns.length)
        func removing(_ m: NSTextCheckingResult) -> String {
            ns.replacingCharacters(in: m.range, with: "").trimmingCharacters(in: .whitespaces)
        }
        if let m = bookClause.firstMatch(in: question, range: all), let book = resolveBook(ns.substring(with: m.range(at: 1))) {
            return Exclusions(remainder: removing(m), terms: [], bookIds: [book])
        }
        guard asksForVerses.firstMatch(in: question, range: all) != nil, let m = clause.firstMatch(in: question, range: all) else { return none }
        let phrase = ns.substring(with: m.range(at: 1))
        if let book = resolveBook(phrase) { return Exclusions(remainder: removing(m), terms: [], bookIds: [book]) }
        let terms = words(phrase).filter { $0.count > 2 && !filler.contains($0) }
        return terms.isEmpty ? none : Exclusions(remainder: removing(m), terms: terms, bookIds: [])
    }

    static func words(_ text: String) -> [String] {
        text.lowercased().split(whereSeparator: { !$0.isLetter && $0 != "'" }).map(String.init)
    }

    /// Whole word, tolerant of a plural either side ("rulers" also excludes "ruler").
    public static func mentionsExcluded(_ text: String, terms: [String]) -> Bool {
        let w = Set(words(text))
        return terms.contains { t in w.contains(t) || w.contains(t + "s") || (t.hasSuffix("s") && w.contains(String(t.dropLast()))) }
    }

    // MARK: Strong's comparison and translation parallels (original compareIntent / lexicalIntent)

    /// Every Strong's id written in the question, in order, without repeats ("H2617 and h7356").
    public static func strongsIds(_ question: String) -> [String] {
        let re = try! NSRegularExpression(pattern: #"\b([HhGg])0*(\d{1,5})([a-z]?)\b"#)
        var out: [String] = []
        let ns = question as NSString
        for m in re.matches(in: question, range: NSRange(location: 0, length: ns.length)) {
            let id = ns.substring(with: m.range(at: 1)).uppercased() + ns.substring(with: m.range(at: 2)) + ns.substring(with: m.range(at: 3))
            if !out.contains(id) { out.append(id) }
        }
        return out
    }

    static let lxx = try! NSRegularExpression(pattern: #"\b(septuagint|lxx|brenton)\b"#, options: .caseInsensitive)
    static let compareWord = try! NSRegularExpression(pattern: #"\b(compare|comparison|compared|contrast|versus|vs\.?|side[\s-]+by[\s-]+side|alongside)\b"#, options: .caseInsensitive)
    static let kjv = try! NSRegularExpression(pattern: #"\b(kjv|king\s+james)\b"#, options: .caseInsensitive)
    static let read = try! NSRegularExpression(pattern: #"\bhow\s+(?:does|do|did|is|was)\b[^?]*\b(?:read|say|render|translate|translated|rendered|worded)\b"#, options: .caseInsensitive)

    /// One reference read in the KJV and Brenton's LXX ("How does Isaiah 7:14 read in the Septuagint?").
    public static func asksTranslationParallel(_ question: String) -> Bool {
        let r = NSRange(location: 0, length: (question as NSString).length)
        guard lxx.firstMatch(in: question, range: r) != nil else { return false }
        return compareWord.firstMatch(in: question, range: r) != nil || kjv.firstMatch(in: question, range: r) != nil
            || read.firstMatch(in: question, range: r) != nil
    }

    /// Reference candidates inside a sentence, longest first: for each chapter(:verse) number, the
    /// one to three words before it ("How does Isaiah 7:14 read" → "does Isaiah 7:14", "Isaiah 7:14").
    /// The caller keeps the first that resolves to a real passage.
    public static func referenceCandidates(_ question: String) -> [String] { referenceGroups(question).flatMap { $0 } }

    /// Candidates grouped per chapter(:verse) number, so each passage in "compare Genesis 1:1 and
    /// John 1:1" resolves on its own (original passage comparison, up to four).
    public static func referenceGroups(_ question: String) -> [[String]] {
        let re = try! NSRegularExpression(pattern: #"\d{1,3}(?::\d{1,3}(?:\s?[-–]\s?\d{1,3})?)?"#)
        let ns = question as NSString
        var out: [[String]] = []
        for m in re.matches(in: question, range: NSRange(location: 0, length: ns.length)) {
            let before = ns.substring(to: m.range.location).trimmingCharacters(in: .whitespaces)
            let words = before.split(separator: " ").map(String.init)
            guard let last = words.last, last.first?.isLetter == true else { continue }
            let number = ns.substring(with: m.range)
            out.append(stride(from: min(3, words.count), through: 1, by: -1).map { (words.suffix($0) + [number]).joined(separator: " ") })
        }
        return out
    }

    /// "compare Genesis 1:1 and John 1:1" (two to four passages, original passage-compare).
    public static func asksPassageComparison(_ question: String) -> Bool {
        compareWord.firstMatch(in: question, range: NSRange(location: 0, length: (question as NSString).length)) != nil
            && referenceGroups(question).count >= 2 && strongsIds(question).isEmpty
    }

    // MARK: Collections (original lib/research/collections.ts)

    public enum Collection: String, CaseIterable, Sendable { case canon, apocrypha, pseudepigrapha, earlyChristian = "early-christian", lxx }

    /// kjva.db `books.testament = 'Apocrypha'`.
    public static let kjvaApocrypha: Set<String> = ["1ES", "2ES", "TOB", "JDT", "ESG", "WIS", "SIR", "BAR", "PRA", "SUS", "BEL", "PRM", "1MA", "2MA"]
    static let textCollection: [String: Collection] = [
        "kjva": .canon, "kjv": .canon, "lxx": .lxx,
        "enoch": .pseudepigrapha, "jubilees": .pseudepigrapha, "apoc_elijah": .pseudepigrapha, "asc_isaiah": .pseudepigrapha,
        "t12p": .pseudepigrapha, "gad": .pseudepigrapha, "t_job": .pseudepigrapha, "apoc_abraham": .pseudepigrapha,
        "t_jacob": .pseudepigrapha, "2baruch": .pseudepigrapha,
        "hermas": .earlyChristian, "hermas_taylor": .earlyChristian, "1clement": .earlyChristian,
        "didache_hoole": .earlyChristian, "ep_barnabas": .earlyChristian, "recog_clement": .earlyChristian,
    ]
    public static let defaultCollections: [Collection] = [.canon, .apocrypha, .pseudepigrapha, .earlyChristian]

    public static func collection(textId: String, bookId: String) -> Collection {
        let c = textCollection[textId] ?? .pseudepigrapha
        return c == .canon && kjvaApocrypha.contains(bookId) ? .apocrypha : c
    }

    static let scopeNames: [(Collection, String)] = [
        (.apocrypha, #"\b(apocrypha|apocryphal|deuterocanon(?:ical|s)?)\b"#),
        (.pseudepigrapha, #"\bpseudepigrapha(?:l)?\b"#),
        (.earlyChristian, #"\b(early christian writings|apostolic fathers)\b"#),
        (.lxx, #"\b(septuagint|lxx)\b"#),
        (.canon, #"\b(66 books|protestant canon|the canon|canonical books|canonical scriptures?|the bible only|only the bible|just the bible)\b"#),
    ]

    /// The collections a question searches: an explicit "only …" scope, else the defaults, minus "without …".
    public static func activeCollections(_ question: String, setting: [Collection]? = nil) -> [Collection] {
        let named = scopeNames.filter { match($0.1, question) }.map(\.0)
        var only: [Collection] = [], exclude: [Collection] = []
        if !named.isEmpty {
            if match(#"\b(without|exclude|excluding|except|not (?:the|including|from)|remove|no)\b"#, question) {
                exclude = named.filter { $0 != .canon }
            } else if match(#"\b(only|just|solely|exclusively|in the|from the|within)\b"#, question) || match(#"\bcanonical\b"#, question) {
                only = named
            }
        }
        let base = !only.isEmpty ? only : (setting?.isEmpty == false ? setting! : defaultCollections)
        let out = base.filter { !exclude.contains($0) }
        return out.isEmpty ? [.canon] : out
    }

    /// Scope words never become search keywords ("only the apocrypha wisdom" searches "wisdom").
    public static func withoutScopeWords(_ keywords: [String]) -> [String] {
        keywords.filter { k in !scopeNames.contains { match($0.1, k) } && !["canon", "canonical", "books", "testament"].contains(k) }
    }

    static func match(_ pattern: String, _ text: String) -> Bool {
        (try? NSRegularExpression(pattern: pattern, options: .caseInsensitive))?
            .firstMatch(in: text, range: NSRange(location: 0, length: (text as NSString).length)) != nil
    }

    /// "every word and Strong's number in John 3:16", "word by word John 1:1": the passage part.
    public static func wordTableRequest(_ question: String) -> String? {
        guard match(#"\b(every word|each word|word by word|word table|strong'?s numbers? (?:in|for|of))\b"#, question) else { return nil }
        return referenceCandidates(question).isEmpty ? nil : question
    }
}
