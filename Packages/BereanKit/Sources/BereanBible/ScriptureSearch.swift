import Foundation
import BereanCore
import BereanText
import BereanReference

/// One search hit in one text.
public struct ScriptureHit: Equatable, Sendable, Hashable {
    public var textId: String
    public var bookId: String
    public var chapter: Int
    public var verseNum: Int
    public var text: String
    public var textTagged: String?
    public init(textId: String, bookId: String, chapter: Int, verseNum: Int, text: String, textTagged: String?) {
        self.textId = textId; self.bookId = bookId; self.chapter = chapter; self.verseNum = verseNum; self.text = text; self.textTagged = textTagged
    }
    public func hash(into h: inout Hasher) { h.combine(textId); h.combine(bookId); h.combine(chapter); h.combine(verseNum) }
}

/// The result of a search across texts: hits in engine order, and which texts reached the per-text row limit.
public struct ScriptureSearchResult: Sendable {
    public var hits: [ScriptureHit]
    public var truncatedTexts: Set<String>
    public init(hits: [ScriptureHit], truncatedTexts: Set<String>) { self.hits = hits; self.truncatedTexts = truncatedTexts }
}

/// Multi-text Scripture search — port of src/lib/scriptureSearch.ts `runRawScriptureSearch`:
/// every target text × every word-replacer variant (WordReplacer.searchVariants), de-duplicated per text/verse in first-seen
/// order, then for phrase mode the punctuation-insensitive post-filter against every variant. Each text keeps the FTS
/// `ORDER BY rank, v.id` order (ADR-0008).
public enum ScriptureSearch {
    public static let perTextLimit = 2000

    public static func run(_ query: String, in targets: [String], mode: WordMode, bookIds: [String]? = nil,
                           replacer: Bool = true, rules: [WordReplacerRule] = WordReplacer.defaultRules, bible: BibleService,
                           lexicon: LexiconService? = nil) async -> ScriptureSearchResult {
        let trimmed = JSText.trim(query)
        guard trimmed.utf16.count >= 2 else { return ScriptureSearchResult(hits: [], truncatedTexts: []) }
        let variants = replacer ? WordReplacer.searchVariants(trimmed, rules: rules) : [trimmed]
        var seen = Set<String>(), hits: [ScriptureHit] = [], truncated = Set<String>()
        for textId in targets {
            for variant in variants {
                let rows = await bible.searchText(variant, textId: textId, mode: mode, bookIds: bookIds)
                let limit = (bookIds ?? []).isEmpty ? perTextLimit : 5000
                if rows.count >= limit { truncated.insert(textId) }
                for r in rows where seen.insert("\(textId)|\(r.bookId)|\(r.chapter)|\(r.verseNum)").inserted {
                    hits.append(ScriptureHit(textId: textId, bookId: r.bookId, chapter: r.chapter, verseNum: r.verseNum, text: r.text, textTagged: r.textTagged))
                }
            }
        }
        if mode == .phrase {
            let phrases = variants.map(stripForPhrase)
            hits = hits.filter { h in let t = stripForPhrase(h.text); return phrases.contains { t.contains($0) } }
        }
        // Strong's bridge (runScriptureSearch): a restored name ("Yehovah") also finds the verses carrying its Strong's
        // number in the tagged texts (kjva, lxx), e.g. KJV "LORD" for H3068.
        let bridgeTargets = Set(targets).intersection(["kjva", "lxx"])
        if replacer, let lexicon, !bridgeTargets.isEmpty, let bridge = WordReplacer.strongsSearch(trimmed, rules: rules) {
            var found = await occurrences(bridge.strongsNums, words: bridge.residualWords, requireAll: false, lexicon: lexicon)
            if mode == .phrase {
                let phrases = variants.map(stripForPhrase)
                found = found.filter { h in let t = stripForPhrase(h.text); return phrases.contains { t.contains($0) } }
            }
            let scope = bookIds.flatMap { $0.isEmpty ? nil : Set($0) }
            for h in found where bridgeTargets.contains(h.textId) && (scope?.contains(h.bookId) ?? true) {
                if seen.insert("\(h.textId)|\(h.bookId)|\(h.chapter)|\(h.verseNum)").inserted { hits.append(h) }
            }
        }
        return ScriptureSearchResult(hits: hits, truncatedTexts: truncated)
    }

    /// "G5485", "H7225 H430", "G5485 jacob" → the verses carrying every number (and containing every word)
    /// — `runStrongsSearch` / `searchMultiStrongs`. nil when the query has no Strong's number.
    public static func strongs(_ query: String, lexicon: LexiconService) async -> [ScriptureHit]? {
        let tokens = JSText.collapseWhitespace(JSText.trim(query)).split(separator: " ").map(String.init)
        var nums: [String] = [], words: [String] = []
        for t in tokens { if let n = StrongsId.normalize(t) { nums.append(n) } else { words.append(t) } }
        guard !nums.isEmpty else { return nil }
        return await occurrences(nums, words: words, requireAll: true, lexicon: lexicon)
    }

    static func occurrences(_ nums: [String], words: [String], requireAll: Bool, lexicon: LexiconService) async -> [ScriptureHit] {
        var order: [String] = [], rows: [String: ScriptureHit] = [:], counts: [String: Int] = [:]
        for n in nums {
            var seenHere = Set<String>()
            for o in await lexicon.occurrences(n, quickLimit: 100_000) {   // search needs every occurrence (the lexicon view keeps the legacy 1000/500 cap)
                let k = "\(o.textId)|\(o.bookId)|\(o.chapter)|\(o.verseNum)"
                guard seenHere.insert(k).inserted else { continue }
                if rows[k] == nil { order.append(k); rows[k] = ScriptureHit(textId: o.textId, bookId: o.bookId, chapter: o.chapter, verseNum: o.verseNum, text: o.text, textTagged: o.textTagged) }
                counts[k, default: 0] += 1
            }
        }
        var out = order.compactMap { k in (!requireAll || counts[k] == nums.count) ? rows[k] : nil }
        if !words.isEmpty {
            let lw = words.map { $0.lowercased() }
            out = out.filter { h in let t = h.text.lowercased(); return lw.allSatisfy { t.contains($0) } }
        }
        return out
    }

    /// `s.toLowerCase().replace(/[,;]/g, ' ').replace(/\s+/g, ' ').trim()`
    public static func stripForPhrase(_ s: String) -> String {
        let lowered = s.lowercased().replacingOccurrences(of: ",", with: " ").replacingOccurrences(of: ";", with: " ")
        return JSText.trim(JSText.collapseWhitespace(lowered))
    }
}
