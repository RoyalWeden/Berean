import BereanCore

/// The persisted `wordReplacerRules` array, as the original apps store it (store/index.ts
/// `WordReplacerRule[]`, persisted alongside `wordReplacerEnabled`).
///
/// - Keeps every stored object verbatim (unknown/future fields survive a round trip); a toggle
///   rewrites only that object's `enabled` property.
/// - Hydration merges default rules missing by `id` exactly like the original `onRehydrateStorage`:
///   multi-word defaults are prepended, single-word defaults appended, existing order kept.
/// - Malformed entries are retained in `raw` (never discarded) but are not applied.
public struct WordReplacerRuleSet: Equatable, Sendable {
    public private(set) var raw: [JSValue]
    public private(set) var rules: [WordReplacerRule]

    public init(stored: JSValue?, defaults: [WordReplacerRule] = WordReplacer.defaultRules) {
        guard let array = stored?.arrayValue else {
            raw = defaults.map(Self.encode)
            rules = defaults
            return
        }
        let existing = Set(array.compactMap { Self.decode($0)?.id })
        let missing = defaults.filter { !existing.contains($0.id) }
        let multi = missing.filter { $0.queries.contains { $0.contains(" ") } }
        let single = missing.filter { !$0.queries.contains { $0.contains(" ") } }
        raw = multi.map(Self.encode) + array + single.map(Self.encode)
        rules = raw.compactMap(Self.decode)
    }

    /// The value to persist under `wordReplacerRules`.
    public var stored: JSValue { .array(raw) }

    /// A stable fingerprint of the rules that affect rendering (for cache/task keys).
    public var revisionKey: String {
        rules.filter(\.enabled).map(\.id).joined(separator: ",")
    }

    public mutating func setEnabled(_ id: String, _ enabled: Bool) {
        for i in raw.indices {
            guard var object = raw[i].objectValue, object["id"]?.stringValue?.string == id else { continue }
            object["enabled"] = .bool(enabled)
            raw[i] = .object(object)
        }
        rules = raw.compactMap(Self.decode)
    }

    /// Resets every rule's switch to its default (custom rules are enabled), keeping all rules.
    public mutating func enableAll(defaults: [WordReplacerRule] = WordReplacer.defaultRules) {
        let defaultState = Dictionary(defaults.map { ($0.id, $0.enabled) }, uniquingKeysWith: { a, _ in a })
        for rule in rules { setEnabled(rule.id, defaultState[rule.id] ?? true) }
    }

    public static func decode(_ value: JSValue) -> WordReplacerRule? {
        guard let id = value["id"]?.stringValue?.string,
              let replacement = value["replacement"]?.stringValue?.string else { return nil }
        let queries = (value["queries"]?.arrayValue ?? []).compactMap { $0.stringValue?.string }
        let strongs = value["strongsNum"]?.stringValue?.string
        guard !queries.isEmpty || strongs != nil else { return nil }
        return WordReplacerRule(id: id, queries: queries, replacement: replacement,
                                wholeWord: value["wholeWord"]?.boolValue ?? false,
                                enabled: value["enabled"]?.boolValue ?? true,
                                strongsNum: strongs)
    }

    /// Same property order as the original DEFAULT_WORD_REPLACER_RULES literals.
    public static func encode(_ rule: WordReplacerRule) -> JSValue {
        var object = JSObject()
        object["id"] = .string(JSString(rule.id))
        object["queries"] = .array(rule.queries.map { .string(JSString($0)) })
        if let strongs = rule.strongsNum { object["strongsNum"] = .string(JSString(strongs)) }
        object["replacement"] = .string(JSString(rule.replacement))
        object["wholeWord"] = .bool(rule.wholeWord)
        object["enabled"] = .bool(rule.enabled)
        return .object(object)
    }
}
