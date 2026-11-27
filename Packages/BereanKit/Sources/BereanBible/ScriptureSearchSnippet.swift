import BereanText

/// Display text and Strong's match positions before applying query-dependent styling.
public struct ScriptureSearchSnippet: Equatable, Sendable {
    public let text: String
    public let matchWordIndices: [Int]

    init(hit: ScriptureHit, replacerEnabled: Bool, rules: [WordReplacerRule]) {
        let snippet = hit.strongsSnippet(replacerEnabled: replacerEnabled, rules: rules)
        let window = snippet.flatMap { VerseDisplay.wordWindow($0.text, matchIndices: $0.indices) }
        text = window?.text ?? snippet?.text ?? VerseDisplay.text(
            hit.text, tagged: hit.textTagged, textId: hit.textId, replacerEnabled: replacerEnabled, rules: rules
        )
        matchWordIndices = window?.indices ?? snippet?.indices ?? []
    }
}

/// Keeps a bounded set of transformed snippets for a single search view.
@MainActor
public final class ScriptureSearchSnippetCache {
    private static let capacity = 256
    private var entries: [ScriptureHit: ScriptureSearchSnippet] = [:]
    private var insertionOrder: [ScriptureHit] = []
    private var oldestIndex = 0
    private var replacerEnabled = false
    private var rules: [WordReplacerRule] = []

    public init() {}

    var cachedEntryCount: Int { entries.count }

    public func snippet(for hit: ScriptureHit, replacerEnabled: Bool, rules: [WordReplacerRule]) -> ScriptureSearchSnippet {
        if self.replacerEnabled != replacerEnabled || self.rules != rules {
            entries.removeAll(keepingCapacity: true)
            insertionOrder.removeAll(keepingCapacity: true)
            oldestIndex = 0
            self.replacerEnabled = replacerEnabled
            self.rules = rules
        }
        if let cached = entries[hit] { return cached }

        let snippet = ScriptureSearchSnippet(hit: hit, replacerEnabled: replacerEnabled, rules: rules)
        if insertionOrder.count == Self.capacity {
            entries.removeValue(forKey: insertionOrder[oldestIndex])
            insertionOrder[oldestIndex] = hit
            oldestIndex = (oldestIndex + 1) % Self.capacity
        } else {
            insertionOrder.append(hit)
        }
        entries[hit] = snippet
        return snippet
    }
}
