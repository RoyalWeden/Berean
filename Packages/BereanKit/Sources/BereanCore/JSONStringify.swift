/// `JSON.stringify(value)` with no replacer and no indentation, producing UTF-16 code units.
///
/// The output is what the sync hashes are computed over, so it must equal V8's byte-for-byte:
/// ES2019 well-formed stringify (unpaired surrogates escaped as lowercase `\udxxx`), lowercase
/// `\u00xx` for other control characters, ECMAScript `Number::toString` for numbers, `null` for
/// non-finite numbers, and object keys in `JSObject` (JavaScript property) order.
public extension JSON {
    static func stringify(_ value: JSValue) -> JSString {
        var out: [UInt16] = []
        out.reserveCapacity(64)
        write(value, into: &out)
        return JSString(units: out)
    }

    static func stringifyString(_ value: JSValue) -> String { stringify(value).string }

    /// Every plain object's keys sorted by UTF-16 order (arrays untouched) — the shape `stableJson`
    /// (src/platform/sync/tabFields.ts) and `hashFields` stringify.
    static func sortedDeep(_ v: JSValue) -> JSValue {
        switch v {
        case .array(let a): return .array(a.map(sortedDeep))
        case .object(let o):
            var out = JSObject()
            for k in o.keys.sorted() { out[k] = sortedDeep(o[k]!) }
            return .object(out)
        default: return v
        }
    }

    /// `stableJson` — sorted-key JSON for change detection.
    static func stableJSON(_ v: JSValue) -> String { stringify(sortedDeep(v)).string }

    static func write(_ value: JSValue, into out: inout [UInt16]) {
        switch value {
        case .null: out.append(contentsOf: "null".utf16)
        case .bool(let b): out.append(contentsOf: (b ? "true" : "false").utf16)
        case .number(let d):
            if d.isFinite { out.append(contentsOf: JSNumber.toString(d).utf16) } else { out.append(contentsOf: "null".utf16) }
        case .string(let s): quote(s.units, into: &out)
        case .array(let a):
            out.append(0x5B)
            for (n, v) in a.enumerated() {
                if n > 0 { out.append(0x2C) }
                write(v, into: &out)
            }
            out.append(0x5D)
        case .object(let o):
            out.append(0x7B)
            for (n, (k, v)) in o.entries.enumerated() {
                if n > 0 { out.append(0x2C) }
                quote(k.units, into: &out)
                out.append(0x3A)
                write(v, into: &out)
            }
            out.append(0x7D)
        }
    }

    /// ECMAScript `QuoteJSONString`.
    static func quote(_ s: [UInt16], into out: inout [UInt16]) {
        out.append(0x22)
        var k = 0
        while k < s.count {
            let c = s[k]
            switch c {
            case 0x08: out.append(contentsOf: [0x5C, 0x62])
            case 0x09: out.append(contentsOf: [0x5C, 0x74])
            case 0x0A: out.append(contentsOf: [0x5C, 0x6E])
            case 0x0C: out.append(contentsOf: [0x5C, 0x66])
            case 0x0D: out.append(contentsOf: [0x5C, 0x72])
            case 0x22: out.append(contentsOf: [0x5C, 0x22])
            case 0x5C: out.append(contentsOf: [0x5C, 0x5C])
            case 0x00..<0x20: unicodeEscape(c, into: &out)
            case 0xD800...0xDBFF:
                if k + 1 < s.count, (0xDC00...0xDFFF).contains(s[k + 1]) {
                    out.append(c); out.append(s[k + 1]); k += 1
                } else {
                    unicodeEscape(c, into: &out)
                }
            case 0xDC00...0xDFFF: unicodeEscape(c, into: &out)
            default: out.append(c)
            }
            k += 1
        }
        out.append(0x22)
    }

    private static func unicodeEscape(_ c: UInt16, into out: inout [UInt16]) {
        let hex: [UInt16] = Array("0123456789abcdef".utf16)
        out.append(contentsOf: [0x5C, 0x75,
                                hex[Int(c >> 12 & 0xF)], hex[Int(c >> 8 & 0xF)],
                                hex[Int(c >> 4 & 0xF)], hex[Int(c & 0xF)]])
    }
}
