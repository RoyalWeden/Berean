import BereanCore

/// Fractional order keys — port of src/platform/sync/fractional.ts (base-62 fractional
/// indexing). Keys compare as JavaScript strings; the TypeScript is the oracle, including its
/// edge cases, so this works on UTF-16 code units throughout.
public enum OrderKey {
    public struct InvalidOrderKey: Error, Equatable, Sendable { public let message: String }

    static let digits: [UInt16] = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz".utf16)
    static let smallestInt: [UInt16] = [0x41] + Array(repeating: 0x30, count: 26)
    static let a: UInt16 = 0x61, z: UInt16 = 0x7A, A: UInt16 = 0x41, Z: UInt16 = 0x5A, zero: UInt16 = 0x30

    typealias U = [UInt16]
    static func lt(_ x: U, _ y: U) -> Bool { x.lexicographicallyPrecedes(y) }
    static func fail(_ m: String) -> InvalidOrderKey { InvalidOrderKey(message: m) }
    static func digitIndex(_ c: UInt16?) -> Int { c.flatMap { digits.firstIndex(of: $0) } ?? -1 }

    static func integerLength(_ head: UInt16?) throws(InvalidOrderKey) -> Int {
        guard let head else { throw fail("invalid order key head") }
        if head >= a && head <= z { return Int(head - a) + 2 }
        if head >= A && head <= Z { return Int(Z - head) + 2 }
        throw fail("invalid order key head")
    }

    static func integerPart(_ key: U) throws(InvalidOrderKey) -> U {
        let n = try integerLength(key.first)
        guard n <= key.count else { throw fail("invalid order key") }
        return Array(key[0..<n])
    }

    static func validateInteger(_ int: U) throws(InvalidOrderKey) {
        guard int.count == (try integerLength(int.first)) else { throw fail("invalid integer part") }
    }

    static func validate(_ key: U) throws(InvalidOrderKey) {
        if key == smallestInt { throw fail("invalid order key") }
        let i = try integerPart(key)
        let f = key[i.count...]
        if f.last == zero { throw fail("invalid order key (trailing 0)") }
        for ch in key.dropFirst() where !digits.contains(ch) { throw fail("invalid order key character") }
    }

    static func increment(_ x: U) throws(InvalidOrderKey) -> U? {
        try validateInteger(x)
        let head = x[0]
        var digs = Array(x.dropFirst())
        var carry = true
        var i = digs.count - 1
        while carry && i >= 0 {
            let d = digitIndex(digs[i]) + 1
            if d == digits.count { digs[i] = zero } else { digs[i] = digits[d]; carry = false }
            i -= 1
        }
        if carry {
            if head == Z { return [a, zero] }
            if head == z { return nil }
            let h = head + 1
            if h > a { digs.append(zero) } else { digs.removeLast() }
            return [h] + digs
        }
        return [head] + digs
    }

    static func decrement(_ x: U) throws(InvalidOrderKey) -> U? {
        try validateInteger(x)
        let head = x[0]
        var digs = Array(x.dropFirst())
        var borrow = true
        var i = digs.count - 1
        while borrow && i >= 0 {
            let d = digitIndex(digs[i]) - 1
            if d == -1 { digs[i] = digits.last! } else { digs[i] = digits[d]; borrow = false }
            i -= 1
        }
        if borrow {
            if head == a { return [Z, digits.last!] }
            if head == A { return nil }
            let h = head - 1
            if h < Z { digs.append(digits.last!) } else { digs.removeLast() }
            return [h] + digs
        }
        return [head] + digs
    }

    /// `midpoint(a, b)`; `b == nil` is the open upper end. As in TypeScript, an empty `b`
    /// is falsy in the `if (b)` tests but not in the `b !== null` ones.
    static func midpoint(_ lo: U, _ hi: U?) throws(InvalidOrderKey) -> U {
        if let hi, !lt(lo, hi) { throw fail("midpoint: a >= b") }
        if lo.last == zero || (hi.map { !$0.isEmpty && $0.last == zero } ?? false) { throw fail("midpoint: trailing zero") }
        if let hi, !hi.isEmpty {
            var n = 0
            while n < hi.count && (n < lo.count ? lo[n] : zero) == hi[n] { n += 1 }
            if n > 0 { return Array(hi[0..<n]) + (try midpoint(Array(lo.dropFirst(min(n, lo.count))), Array(hi[n...]))) }
        }
        let digitA = lo.isEmpty ? 0 : digitIndex(lo[0])
        let digitB = hi != nil ? digitIndex(hi!.first) : digits.count
        if digitB - digitA > 1 {
            // Math.round(0.5 * (a + b)) — rounds half toward +∞.
            let m = Int((0.5 * Double(digitA + digitB) + 0.5).rounded(.down))
            return [digits[m]]
        }
        if let hi, hi.count > 1 { return [hi[0]] }
        return [digits[digitA]] + (try midpoint(Array(lo.dropFirst()), nil))
    }

    /// `keyBetween(a, b)` — a key strictly between; nil = open end.
    public static func between(_ a: String?, _ b: String?) throws(InvalidOrderKey) -> String {
        let r = try between(units: a.map { Array($0.utf16) }, b.map { Array($0.utf16) })
        return String(decoding: r, as: UTF16.self)
    }

    static func between(units a: U?, _ b: U?) throws(InvalidOrderKey) -> U {
        if let a { try validate(a) }
        if let b { try validate(b) }
        if let a, let b, !lt(a, b) { throw fail("keyBetween: a is not < b") }
        guard let a else {
            guard let b else { return [OrderKey.a, zero] }
            let ib = try integerPart(b)
            let fb = Array(b[ib.count...])
            if ib == smallestInt { return ib + (try midpoint([], fb)) }
            if lt(ib, b) { return ib }
            guard let res = try decrement(ib) else { throw fail("keyBetween: range underflow") }
            return res
        }
        guard let b else {
            let ia = try integerPart(a)
            let fa = Array(a[ia.count...])
            if let i = try increment(ia) { return i }
            return ia + (try midpoint(fa, nil))
        }
        let ia = try integerPart(a), fa = Array(a[ia.count...])
        let ib = try integerPart(b), fb = Array(b[ib.count...])
        if ia == ib { return ia + (try midpoint(fa, fb)) }
        guard let i = try increment(ia) else { throw fail("keyBetween: range overflow") }
        if lt(i, b) { return i }
        return ia + (try midpoint(fa, nil))
    }

    /// `keysAfter(a, n)`.
    public static func keysAfter(_ a: String?, count: Int) throws(InvalidOrderKey) -> [String] {
        var out: [String] = []
        var prev = a
        for _ in 0..<max(0, count) {
            let k = try between(prev, nil)
            out.append(k); prev = k
        }
        return out
    }

    /// `compareOrder` — by order key, ties broken by id (JavaScript string order).
    public static func compare(orderKey ka: String, id ia: String, orderKey kb: String, id ib: String) -> Int {
        let c = jsCompare(ka, kb)
        return c != 0 ? c : jsCompare(ia, ib)
    }

    public static func isValid(_ key: String) -> Bool {
        do { try validate(Array(key.utf16)); return true } catch { return false }
    }
}
