/// `JSON.parse` (ECMA-404 grammar, ECMAScript semantics) over UTF-16 code units.
///
/// Matches JavaScript exactly where it matters for sync: `\uD800`-style escapes produce unpaired
/// surrogates, numbers round to the nearest double (overflow → ±Infinity, underflow → ±0),
/// duplicate keys keep the last value in the first key's position, and only space, tab, LF and
/// CR count as whitespace.
public struct JSONParseError: Error, Equatable, Sendable, CustomStringConvertible {
    public let offset: Int
    public let message: String
    public var description: String { "JSON parse error at \(offset): \(message)" }
}

public enum JSON {
    public static func parse(_ text: String) throws(JSONParseError) -> JSValue {
        try parse(units: Array(text.utf16))
    }

    public static func parse(units: [UInt16]) throws(JSONParseError) -> JSValue {
        var p = Parser(units: units)
        p.skipWhitespace()
        let v = try p.value(depth: 0)
        p.skipWhitespace()
        if p.i != units.count { throw p.error("unexpected trailing content") }
        return v
    }

    public static func parse(units: ArraySlice<UInt16>) throws(JSONParseError) -> JSValue {
        try parse(units: Array(units))
    }
}

private struct Parser {
    let units: [UInt16]
    var i = 0
    static let maxDepth = 10_000

    init(units: [UInt16]) { self.units = units }

    func error(_ m: String) -> JSONParseError { JSONParseError(offset: i, message: m) }

    mutating func skipWhitespace() {
        while i < units.count {
            switch units[i] {
            case 0x20, 0x09, 0x0A, 0x0D: i += 1
            default: return
            }
        }
    }

    mutating func value(depth: Int) throws(JSONParseError) -> JSValue {
        guard depth < Parser.maxDepth else { throw error("nesting too deep") }
        guard i < units.count else { throw error("unexpected end of input") }
        switch units[i] {
        case 0x7B: return try object(depth: depth)
        case 0x5B: return try array(depth: depth)
        case 0x22: return .string(JSString(units: try string()))
        case 0x74: try literal("true"); return .bool(true)
        case 0x66: try literal("false"); return .bool(false)
        case 0x6E: try literal("null"); return .null
        case 0x2D, 0x30...0x39: return .number(try number())
        default: throw error("unexpected character")
        }
    }

    mutating func literal(_ word: String) throws(JSONParseError) {
        for c in word.utf16 {
            guard i < units.count, units[i] == c else { throw error("invalid literal") }
            i += 1
        }
    }

    mutating func object(depth: Int) throws(JSONParseError) -> JSValue {
        i += 1
        var o = JSObject()
        skipWhitespace()
        if i < units.count, units[i] == 0x7D { i += 1; return .object(o) }
        while true {
            skipWhitespace()
            guard i < units.count, units[i] == 0x22 else { throw error("expected property name") }
            let key = JSString(units: try string())
            skipWhitespace()
            guard i < units.count, units[i] == 0x3A else { throw error("expected ':'") }
            i += 1
            skipWhitespace()
            o[key] = try value(depth: depth + 1)
            skipWhitespace()
            guard i < units.count else { throw error("unterminated object") }
            if units[i] == 0x2C { i += 1; continue }
            if units[i] == 0x7D { i += 1; return .object(o) }
            throw error("expected ',' or '}'")
        }
    }

    mutating func array(depth: Int) throws(JSONParseError) -> JSValue {
        i += 1
        var a: [JSValue] = []
        skipWhitespace()
        if i < units.count, units[i] == 0x5D { i += 1; return .array(a) }
        while true {
            skipWhitespace()
            a.append(try value(depth: depth + 1))
            skipWhitespace()
            guard i < units.count else { throw error("unterminated array") }
            if units[i] == 0x2C { i += 1; continue }
            if units[i] == 0x5D { i += 1; return .array(a) }
            throw error("expected ',' or ']'")
        }
    }

    mutating func string() throws(JSONParseError) -> [UInt16] {
        i += 1
        var out: [UInt16] = []
        while true {
            guard i < units.count else { throw error("unterminated string") }
            let c = units[i]
            if c == 0x22 { i += 1; return out }
            if c < 0x20 { throw error("control character in string") }
            if c != 0x5C { out.append(c); i += 1; continue }
            i += 1
            guard i < units.count else { throw error("unterminated escape") }
            let e = units[i]
            i += 1
            switch e {
            case 0x22: out.append(0x22)
            case 0x5C: out.append(0x5C)
            case 0x2F: out.append(0x2F)
            case 0x62: out.append(0x08)
            case 0x66: out.append(0x0C)
            case 0x6E: out.append(0x0A)
            case 0x72: out.append(0x0D)
            case 0x74: out.append(0x09)
            case 0x75:
                var v: UInt16 = 0
                for _ in 0..<4 {
                    guard i < units.count, let d = hexValue(units[i]) else { throw error("invalid \\u escape") }
                    v = v << 4 | d
                    i += 1
                }
                out.append(v)
            default: throw error("invalid escape")
            }
        }
    }

    func hexValue(_ c: UInt16) -> UInt16? {
        switch c {
        case 0x30...0x39: return c - 0x30
        case 0x41...0x46: return c - 0x41 + 10
        case 0x61...0x66: return c - 0x61 + 10
        default: return nil
        }
    }

    mutating func number() throws(JSONParseError) -> Double {
        let start = i
        func isDigit(_ k: Int) -> Bool { k < units.count && units[k] >= 0x30 && units[k] <= 0x39 }
        if units[i] == 0x2D { i += 1 }
        guard isDigit(i) else { throw error("invalid number") }
        if units[i] == 0x30 { i += 1 } else { while isDigit(i) { i += 1 } }
        if i < units.count, units[i] == 0x2E {
            i += 1
            guard isDigit(i) else { throw error("invalid number fraction") }
            while isDigit(i) { i += 1 }
        }
        if i < units.count, units[i] == 0x65 || units[i] == 0x45 {
            i += 1
            if i < units.count, units[i] == 0x2B || units[i] == 0x2D { i += 1 }
            guard isDigit(i) else { throw error("invalid number exponent") }
            while isDigit(i) { i += 1 }
        }
        let text = String(decoding: units[start..<i], as: UTF16.self)
        // strtod rounding (correctly rounded, round-half-even) == ECMAScript StringToNumber.
        guard let d = Double(text) else { throw error("unrepresentable number") }
        return d
    }
}
