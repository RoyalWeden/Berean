import BereanText

/// Display text and Strong's match positions before applying query-dependent styling.
public struct ScriptureSearchSnippet: Equatable, Sendable {
    public let text: String
    public let matchWordIndices: [Int]

    init(hit: ScriptureHit, replacerEnabled: Bool, rules: [WordReplacerRule], windowed: Bool) {
        let snippet = hit.strongsSnippet(replacerEnabled: replacerEnabled, rules: rules)
        let window = windowed ? snippet.flatMap { VerseDisplay.wordWindow($0.text, matchIndices: $0.indices) } : nil
        text = window?.text ?? snippet?.text ?? VerseDisplay.text(
            hit.text, tagged: hit.textTagged, textId: hit.textId, replacerEnabled: replacerEnabled, rules: rules
        )
        matchWordIndices = window?.indices ?? snippet?.indices ?? []
    }
}

/// Keeps a bounded set of transformed snippets for a single search view.
@MainActor
public final class ScriptureSearchSnippetCache {
    private struct Key: Hashable {
        let hit: ScriptureHit
        let windowed: Bool
    }
    private static let capacity = 256
    private var entries: [Key: ScriptureSearchSnippet] = [:]
    private var insertionOrder: [Key] = []
    private var oldestIndex = 0
    private var replacerEnabled = false
    private var rules: [WordReplacerRule] = []

    public init() {}

    var cachedEntryCount: Int { entries.count }

    public func snippet(for hit: ScriptureHit, replacerEnabled: Bool, rules: [WordReplacerRule], windowed: Bool = true) -> ScriptureSearchSnippet {
        if self.replacerEnabled != replacerEnabled || self.rules != rules {
            entries.removeAll(keepingCapacity: true)
            insertionOrder.removeAll(keepingCapacity: true)
            oldestIndex = 0
            self.replacerEnabled = replacerEnabled
            self.rules = rules
        }
        let key = Key(hit: hit, windowed: windowed)
        if let cached = entries[key] { return cached }

        let snippet = ScriptureSearchSnippet(hit: hit, replacerEnabled: replacerEnabled, rules: rules, windowed: windowed)
        if insertionOrder.count == Self.capacity {
            entries.removeValue(forKey: insertionOrder[oldestIndex])
            insertionOrder[oldestIndex] = key
            oldestIndex = (oldestIndex + 1) % Self.capacity
        } else {
            insertionOrder.append(key)
        }
        entries[key] = snippet
        return snippet
    }
}
