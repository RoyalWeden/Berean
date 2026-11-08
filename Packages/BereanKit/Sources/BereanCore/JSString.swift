/// A JavaScript string: a sequence of UTF-16 code units.
///
/// Swift `String` cannot hold an unpaired surrogate, but JavaScript strings (and therefore
/// `JSON.parse("\"\\ud800\"")`, field values typed on another device, and the sync hashes
/// computed over them) can. Everything that must reproduce TypeScript byte-for-byte works on
/// code units, exactly as `String.prototype.length`, `charCodeAt` and `<` do.
public struct JSString: Hashable, Sendable, Comparable, CustomStringConvertible, ExpressibleByStringLiteral {
    public var units: [UInt16]

    public init(units: [UInt16]) { self.units = units }
    public init(_ string: String) { self.units = Array(string.utf16) }
    public init(stringLiteral value: String) { self.init(value) }

    /// The Swift string (an unpaired surrogate becomes U+FFFD — use `units` when fidelity matters).
    public var string: String { String(decoding: units, as: UTF16.self) }
    public var description: String { string }
    /// `String.prototype.length` — code units, not characters or bytes.
    public var length: Int { units.count }
    public var isEmpty: Bool { units.isEmpty }

    /// JavaScript `<` on strings: lexicographic over UTF-16 code units (not Unicode scalar or
    /// canonical order, which is what Swift's `String <` uses).
    public static func < (a: JSString, b: JSString) -> Bool {
        a.units.lexicographicallyPrecedes(b.units)
    }

    public static func + (a: JSString, b: JSString) -> JSString { JSString(units: a.units + b.units) }
}

public extension Array where Element == UInt16 {
    /// JavaScript string comparison result (-1, 0, 1) over code units.
    static func jsCompare(_ a: [UInt16], _ b: [UInt16]) -> Int {
        if a == b { return 0 }
        return a.lexicographicallyPrecedes(b) ? -1 : 1
    }
}

/// JavaScript string comparison on Swift strings (UTF-16 code-unit order).
@inlinable public func jsCompare(_ a: String, _ b: String) -> Int {
    let x = Array(a.utf16), y = Array(b.utf16)
    if x == y { return 0 }
    return x.lexicographicallyPrecedes(y) ? -1 : 1
}

public enum JSWhitespace {
    /// ECMAScript WhiteSpace ∪ LineTerminator — the set `String.prototype.trim` strips and the
    /// regular-expression class `\s` matches (Unicode 15 Zs category plus the listed controls).
    public static func isWhitespace(_ u: UInt16) -> Bool {
        switch u {
        case 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A,
             0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF:
            return true
        default:
            return false
        }
    }

    /// `String.prototype.trim`.
    public static func trim(_ s: ArraySlice<UInt16>) -> ArraySlice<UInt16> {
        var lo = s.startIndex, hi = s.endIndex
        while lo < hi, isWhitespace(s[lo]) { lo += 1 }
        while hi > lo, isWhitespace(s[hi - 1]) { hi -= 1 }
        return s[lo..<hi]
    }
}
