import BereanCore
import Synchronization

/// A Word Replacer rule — port of `WordReplacerRule` (src/store). Strong's rules (`strongsNum`) apply
/// only to KJVA tagged tokens; text rules apply to plain text everywhere.
public struct WordReplacerRule: Equatable, Sendable, Identifiable {
    public var id: String
    public var queries: [String]
    public var replacement: String
    public var wholeWord: Bool
    public var enabled: Bool
    public var strongsNum: String?

    public init(id: String, queries: [String], replacement: String, wholeWord: Bool, enabled: Bool, strongsNum: String? = nil) {
        self.id = id; self.queries = queries; self.replacement = replacement; self.wholeWord = wholeWord; self.enabled = enabled; self.strongsNum = strongsNum
    }
}

/// Port of src/lib/wordReplacer.ts. Matching reproduces JavaScript's `/\bquery\b/gi` exactly
/// (non-Unicode `i` canonicalisation, ASCII word boundaries) without regular expressions.
public enum WordReplacer {
    // MARK: JavaScript case-insensitive literal matching

    /// ECMAScript Canonicalize (non-unicode `i`): uppercase a code unit unless that changes its
    /// length or maps a non-ASCII unit to ASCII.
    static func computeCanon(_ u: UInt16) -> UInt16 {
        if u < 0x80 { return (0x61...0x7A).contains(u) ? u - 32 : u }
        if (0xD800...0xDFFF).contains(u) { return u }
        guard let scalar = Unicode.Scalar(u) else { return u }
        let up = Array(String(scalar).uppercased().utf16)
        guard up.count == 1 else { return u }
        return up[0] < 0x80 ? u : up[0]
    }
    /// Canonicalize for every BMP code unit, computed once.
    static let canonTable: [UInt16] = (0...0xFFFF).map { computeCanon(UInt16($0)) }
    @inline(__always) static func canon(_ u: UInt16) -> UInt16 { canonTable[Int(u)] }

    static func isWord(_ u: UInt16) -> Bool { (0x30...0x39).contains(u) || (0x41...0x5A).contains(u) || (0x61...0x7A).contains(u) || u == 0x5F }
    static func boundary(_ t: [UInt16], _ i: Int) -> Bool {
        let a = i > 0 && isWord(t[i - 1]), b = i < t.count && isWord(t[i])
        return a != b
    }

    /// Start offsets of non-overlapping case-insensitive matches of `needle`, scanning like a `g` regex.
    static func matches(_ t: [UInt16], _ needle: [UInt16], wholeWord: Bool) -> [Int] {
        matches(canonical: t.map(canon), raw: t, needle.map(canon), wholeWord: wholeWord)
    }

    static func matches(canonical ct: [UInt16], raw t: [UInt16], _ n: [UInt16], wholeWord: Bool) -> [Int] {
        guard !n.isEmpty, n.count <= ct.count else { return [] }
        var out: [Int] = []
        let first = n[0]
        var i = 0
        let last = ct.count - n.count
        while i <= last {
            if ct[i] == first && (!wholeWord || boundary(t, i)) {
                var ok = true
                var k = 1
                while k < n.count { if ct[i + k] != n[k] { ok = false; break }; k += 1 }
                if ok && wholeWord && !boundary(t, i + n.count) { ok = false }
                if ok { out.append(i); i += n.count; continue }
            }
            i += 1
        }
        return out
    }

    static func replaceAll(_ text: String, _ needle: String, wholeWord: Bool, with make: (ArraySlice<UInt16>) -> [UInt16]) -> String {
        var t = Array(text.utf16)
        var ct = t.map(canon)
        if replace(&t, &ct, Array(needle.utf16).map(canon), wholeWord: wholeWord, with: make) { return String(decoding: t, as: UTF16.self) }
        return text
    }

    /// In-place replacement on raw + canonical buffers; returns whether anything changed.
    static func replace(_ t: inout [UInt16], _ ct: inout [UInt16], _ n: [UInt16], wholeWord: Bool, with make: (ArraySlice<UInt16>) -> [UInt16]) -> Bool {
        let hits = matches(canonical: ct, raw: t, n, wholeWord: wholeWord)
        if hits.isEmpty { return false }
        var out: [UInt16] = []
        out.reserveCapacity(t.count + 8)
        var last = 0
        for h in hits {
            out.append(contentsOf: t[last..<h])
            out.append(contentsOf: make(t[h..<(h + n.count)]))
            last = h + n.count
        }
        out.append(contentsOf: t[last...])
        t = out
        ct = out.map(canon)
        return true
    }

    /// Text rules in application order with pre-canonicalised needles (cached per rule set).
    struct Compiled: Sendable {
        struct Rule: Sendable { var replacement: [UInt16]; var capitalized: [UInt16]; var wholeWord: Bool; var needles: [[UInt16]] }
        var rules: [Rule]
    }
    static let compiledCache = Mutex<(key: [WordReplacerRule], value: Compiled)?>(nil)

    static func compiled(_ rules: [WordReplacerRule]) -> Compiled {
        if let hit = compiledCache.withLock({ c -> Compiled? in c.flatMap { $0.key == rules ? $0.value : nil } }) { return hit }
        let textRules = stableSorted(rules.filter { $0.enabled && $0.strongsNum == nil }) { r in r.queries.map(\.utf16.count).max() ?? Int.min }
        let c = Compiled(rules: textRules.map { rule in
            let r = Array(rule.replacement.utf16)
            let cap = r.first.map { Array(String(decoding: [$0], as: UTF16.self).uppercased().utf16) + r.dropFirst() } ?? r
            return .init(replacement: r, capitalized: cap, wholeWord: rule.wholeWord,
                         needles: stableSorted(rule.queries, by: { $0.utf16.count }).map { Array($0.utf16).map(canon) })
        })
        compiledCache.withLock { $0 = (rules, c) }
        return c
    }

    static func stableSorted<T>(_ xs: [T], by key: (T) -> Int) -> [T] {
        xs.enumerated().sorted { a, b in key(a.element) != key(b.element) ? key(a.element) > key(b.element) : a.offset < b.offset }.map(\.element)
    }

    // MARK: API

    /// `applyWordReplacer` — longest phrases first, keeping a leading capital.
    public static func apply(_ text: String, rules: [WordReplacerRule]) -> String {
        let c = compiled(rules)
        if c.rules.isEmpty || text.isEmpty { return text }
        var t = Array(text.utf16)
        var ct = t.map(canon)
        var changed = false
        for rule in c.rules {
            for n in rule.needles {
                changed = replace(&t, &ct, n, wholeWord: rule.wholeWord) { m in
                    let first = String(decoding: [m.first!], as: UTF16.self)
                    return first == first.uppercased() && first != first.lowercased() ? rule.capitalized : rule.replacement
                } || changed
            }
        }
        return changed ? String(decoding: t, as: UTF16.self) : text
    }

    /// `applyStrongsWordReplacer` — keeps a possessive `'s` and trailing punctuation ("LORD'S." → "Yehovah's.").
    public static func applyStrongs(_ word: String, strongs: TaggedToken.Strongs?, rules: [WordReplacerRule]) -> String {
        guard let strongs else { return word }
        let nums: [String]
        switch strongs { case .one(let s): nums = [s]; case .many(let a): nums = a }
        for rule in rules where rule.enabled {
            guard let n = rule.strongsNum, nums.contains(n) else { continue }
            // /^[A-Za-z]+('[Ss])?([\W]*)$/
            let u = Array(word.utf16)
            let letters = u.prefix { (0x41...0x5A).contains($0) || (0x61...0x7A).contains($0) }.count
            if letters > 0 {
                let rest = u[letters...]
                func nonWord(_ s: ArraySlice<UInt16>) -> Bool { s.allSatisfy { !isWord($0) } }
                if rest.count >= 2, rest.first == 0x27, rest[rest.startIndex + 1] == 0x53 || rest[rest.startIndex + 1] == 0x73,
                   nonWord(rest.dropFirst(2)) {
                    return rule.replacement + "'s" + String(decoding: rest.dropFirst(2), as: UTF16.self)
                }
                if nonWord(rest) { return rule.replacement + String(decoding: rest, as: UTF16.self) }
            }
            return rule.replacement
        }
        return word
    }

    /// `getWordReplacerSearchVariants` — the query plus each rule's substitution in either direction.
    public static func searchVariants(_ query: String, rules: [WordReplacerRule]) -> [String] {
        let trimmed = JSText.trim(query)
        if trimmed.isEmpty { return [query] }
        let lq = Array(JSText.lower(trimmed).utf16)
        var variants: [String] = [trimmed]
        func add(_ v: String) { if !variants.contains(v) { variants.append(v) } }
        for rule in stableSorted(rules.filter { $0.enabled && $0.strongsNum == nil }, by: { $0.replacement.utf16.count }) {
            for orig in rule.queries {
                if !matches(lq, Array(rule.replacement.utf16), wholeWord: true).isEmpty {
                    add(replaceAll(trimmed, rule.replacement, wholeWord: true) { _ in Array(orig.utf16) })
                }
                if !matches(lq, Array(orig.utf16), wholeWord: true).isEmpty {
                    add(replaceAll(trimmed, orig, wholeWord: true) { _ in Array(rule.replacement.utf16) })
                }
            }
        }
        return variants
    }

    public struct StrongsSearch: Equatable, Sendable {
        public var strongsNums: [String]
        public var residualWords: [String]
        public var replacement: String?
    }

    /// `getWordReplacerStrongsSearch` — the typed restored name ("yehovah") becomes a Strong's search.
    public static func strongsSearch(_ query: String, rules: [WordReplacerRule]) -> StrongsSearch? {
        let tokens = JSText.collapseWhitespace(JSText.trim(query)).split(separator: " ").map(String.init)
        if tokens.isEmpty { return nil }
        func norm(_ s: String) -> String {
            String(String.UnicodeScalarView(JSText.lower(s).unicodeScalars.filter { sc in
                sc == "'" || { switch sc.properties.generalCategory {
                    case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter, .decimalNumber, .letterNumber, .otherNumber: return true
                    default: return false } }()
            }))
        }
        let normTokens = tokens.map(norm)
        var nums: [String] = []
        var matched = Set<Int>()
        for rule in rules where rule.enabled {
            guard let n = rule.strongsNum else { continue }
            let repl = norm(rule.replacement)
            if repl.isEmpty { continue }
            for (i, t) in normTokens.enumerated() where t == repl {
                if !nums.contains(n) { nums.append(n) }
                matched.insert(i)
            }
        }
        if nums.isEmpty { return nil }
        let first = rules.first { $0.enabled && $0.strongsNum.map { nums.contains($0) } == true }
        return StrongsSearch(strongsNums: nums, residualWords: tokens.enumerated().filter { !matched.contains($0.offset) }.map(\.element), replacement: first?.replacement)
    }
}
