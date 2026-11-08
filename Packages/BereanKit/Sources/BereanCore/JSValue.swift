/// A JSON value as JavaScript holds it after `JSON.parse`: numbers are IEEE doubles, strings are
/// UTF-16, and object properties follow ECMAScript `OrdinaryOwnPropertyKeys` order.
public enum JSValue: Equatable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(JSString)
    case array([JSValue])
    case object(JSObject)

    public var isNull: Bool { if case .null = self { return true } else { return false } }
    public var stringValue: JSString? { if case .string(let s) = self { return s } else { return nil } }
    public var numberValue: Double? { if case .number(let n) = self { return n } else { return nil } }
    public var boolValue: Bool? { if case .bool(let b) = self { return b } else { return nil } }
    public var arrayValue: [JSValue]? { if case .array(let a) = self { return a } else { return nil } }
    public var objectValue: JSObject? { if case .object(let o) = self { return o } else { return nil } }

    public subscript(key: String) -> JSValue? { objectValue?[JSString(key)] }
}

extension JSValue: ExpressibleByNilLiteral, ExpressibleByBooleanLiteral, ExpressibleByIntegerLiteral,
    ExpressibleByFloatLiteral, ExpressibleByStringLiteral, ExpressibleByArrayLiteral, ExpressibleByDictionaryLiteral {
    public init(nilLiteral: ()) { self = .null }
    public init(booleanLiteral value: Bool) { self = .bool(value) }
    public init(integerLiteral value: Int) { self = .number(Double(value)) }
    public init(floatLiteral value: Double) { self = .number(value) }
    public init(stringLiteral value: String) { self = .string(JSString(value)) }
    public init(arrayLiteral elements: JSValue...) { self = .array(elements) }
    /// Keys are inserted in literal order, then placed by JavaScript property-order rules.
    public init(dictionaryLiteral elements: (String, JSValue)...) {
        var o = JSObject()
        for (k, v) in elements { o[JSString(k)] = v }
        self = .object(o)
    }
}

/// An ordinary JavaScript object's own string-keyed properties, in the order `Object.keys`,
/// `Object.entries` and `JSON.stringify` visit them: array-index keys ("0" … "4294967294",
/// canonical form) first in ascending numeric order, then every other key in insertion order.
/// Re-assigning an existing key keeps its position (JSON.parse duplicate keys: last value wins).
public struct JSObject: Equatable, Sendable {
    public private(set) var keys: [JSString] = []
    private var storage: [JSString: JSValue] = [:]
    /// How many leading entries of `keys` are array indices.
    private var indexKeyCount = 0

    public init() {}
    public init(_ entries: [(JSString, JSValue)]) { for (k, v) in entries { self[k] = v } }

    public var count: Int { keys.count }
    public var isEmpty: Bool { keys.isEmpty }
    public var values: [JSValue] { keys.map { storage[$0]! } }
    public var entries: [(key: JSString, value: JSValue)] { keys.map { ($0, storage[$0]!) } }

    public subscript(key: JSString) -> JSValue? {
        get { storage[key] }
        set {
            guard let newValue else { remove(key); return }
            if storage.updateValue(newValue, forKey: key) != nil { return }
            if let idx = JSObject.arrayIndex(key) {
                var lo = 0, hi = indexKeyCount
                while lo < hi {
                    let mid = (lo + hi) / 2
                    if JSObject.arrayIndex(keys[mid])! < idx { lo = mid + 1 } else { hi = mid }
                }
                keys.insert(key, at: lo)
                indexKeyCount += 1
            } else {
                keys.append(key)
            }
        }
    }

    public subscript(key: String) -> JSValue? {
        get { self[JSString(key)] }
        set { self[JSString(key)] = newValue }
    }

    public mutating func remove(_ key: JSString) {
        guard storage.removeValue(forKey: key) != nil, let i = keys.firstIndex(of: key) else { return }
        keys.remove(at: i)
        if i < indexKeyCount { indexKeyCount -= 1 }
    }

    public static func == (a: JSObject, b: JSObject) -> Bool { a.keys == b.keys && a.storage == b.storage }

    /// ECMAScript array index: the canonical decimal form of an integer in 0 ..< 2^32 - 1.
    public static func arrayIndex(_ key: JSString) -> UInt32? {
        let u = key.units
        guard !u.isEmpty, u.count <= 10 else { return nil }
        if u.count > 1 && u[0] == 0x30 { return nil }
        var v: UInt64 = 0
        for c in u {
            guard c >= 0x30 && c <= 0x39 else { return nil }
            v = v * 10 + UInt64(c - 0x30)
        }
        return v <= 4_294_967_294 ? UInt32(v) : nil
    }
}
