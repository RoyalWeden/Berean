/// ECMAScript number formatting.
public enum JSNumber {
    /// `Number::toString(x)` (radix 10) — what `String(x)`, template literals and JSON.stringify
    /// print. Swift's `description` already yields the shortest round-tripping digit string
    /// (closest on ties, like ECMA-262 §6.1.6.1.20 step 5); only the layout differs, so this
    /// re-lays those digits out by the ECMAScript rules.
    public static func toString(_ x: Double) -> String {
        if x.isNaN { return "NaN" }
        if x == 0 { return "0" }   // also -0
        if x.isInfinite { return x < 0 ? "-Infinity" : "Infinity" }
        let negative = x < 0
        let (digits, n) = shortestDigits(abs(x))
        let k = digits.count
        var s: String
        if k <= n && n <= 21 {
            s = digits + String(repeating: "0", count: n - k)
        } else if 0 < n && n <= 21 {
            let idx = digits.index(digits.startIndex, offsetBy: n)
            s = digits[..<idx] + "." + digits[idx...]
        } else if -6 < n && n <= 0 {
            s = "0." + String(repeating: "0", count: -n) + digits
        } else {
            let e = n - 1
            let exp = (e < 0 ? "-" : "+") + String(abs(e))
            if k == 1 {
                s = digits + "e" + exp
            } else {
                let first = digits.prefix(1), rest = digits.dropFirst()
                s = first + "." + rest + "e" + exp
            }
        }
        return negative ? "-" + s : s
    }

    /// Decimal digits d1…dk (no leading/trailing zeros) and exponent n with x = 0.d1…dk × 10^n.
    static func shortestDigits(_ x: Double) -> (String, Int) {
        let desc = x.description            // e.g. "100.0", "1e-07", "1.2345e+20", "5e-324"
        var mantissa = Substring(desc)
        var exp10 = 0
        if let e = desc.firstIndex(where: { $0 == "e" || $0 == "E" }) {
            mantissa = desc[..<e]
            exp10 = Int(desc[desc.index(after: e)...])!
        }
        var intPart = mantissa, fracPart: Substring = ""
        if let dot = mantissa.firstIndex(of: ".") {
            intPart = mantissa[..<dot]
            fracPart = mantissa[mantissa.index(after: dot)...]
        }
        var all = Array(intPart + fracPart)
        var pointPos = intPart.count + exp10   // digits before the decimal point
        while let f = all.first, f == "0" { all.removeFirst(); pointPos -= 1 }
        while let l = all.last, l == "0" { all.removeLast() }
        return (String(all), pointPos)
    }

    /// `Number.prototype.toString(radix)` for non-negative safe integers.
    public static func toString(_ value: Int, radix: Int) -> String {
        precondition(value >= 0)
        return String(value, radix: radix, uppercase: false)
    }

    /// `Number.isInteger`.
    public static func isInteger(_ x: Double) -> Bool { x.isFinite && x.rounded(.towardZero) == x }
}

/// 32-bit FNV-1a over UTF-16 code units, using `Math.imul` + `>>> 0` arithmetic (wrapping).
public enum FNV1a32 {
    public static let offsetBasis: UInt32 = 0x811c9dc5
    public static let prime: UInt32 = 0x01000193

    public static func hash(_ units: [UInt16]) -> UInt32 {
        var h = offsetBasis
        for u in units {
            h ^= UInt32(u)
            h = h &* prime
        }
        return h
    }

    /// `h.toString(16).padStart(8, '0')`.
    public static func hex8(_ h: UInt32) -> String {
        let s = String(h, radix: 16, uppercase: false)
        return String(repeating: "0", count: 8 - s.count) + s
    }
}
