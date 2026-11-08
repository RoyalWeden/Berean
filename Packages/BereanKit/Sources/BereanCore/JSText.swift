/// JavaScript string-library semantics for Swift strings (UTF-16 based, like V8).
public enum JSText {
    /// `s.trim()`.
    public static func trim(_ s: String) -> String {
        String(decoding: JSWhitespace.trim(Array(s.utf16)[...]), as: UTF16.self)
    }

    /// `s.replace(/\s+/g, replacement)`.
    public static func collapseWhitespace(_ s: String, with replacement: String = " ") -> String {
        var out: [UInt16] = []
        let rep = Array(replacement.utf16)
        var inRun = false
        for u in s.utf16 {
            if JSWhitespace.isWhitespace(u) {
                if !inRun { out.append(contentsOf: rep); inRun = true }
            } else {
                out.append(u); inRun = false
            }
        }
        return String(decoding: out, as: UTF16.self)
    }

    /// `s.toLowerCase()` / `toUpperCase()` (locale-independent full case mapping).
    /// Known gap: V8 applies the Final_Sigma context rule; Swift does not. Only Greek capital
    /// sigma at a word end differs, which no reference grammar depends on.
    public static func lower(_ s: String) -> String { s.lowercased() }
    public static func upper(_ s: String) -> String { s.uppercased() }

    /// `s.length`.
    public static func length(_ s: String) -> Int { s.utf16.count }

    /// `a.startsWith(b)` over code units.
    public static func startsWith(_ a: String, _ b: String) -> Bool { a.utf16.starts(with: b.utf16) }

    /// `parseInt(s, 10)` → NaN as nil.
    public static func parseInt(_ s: String) -> Double? {
        var u = Array(JSWhitespace.trim(Array(s.utf16)[...]))
        var negative = false
        if let f = u.first, f == 0x2B || f == 0x2D { negative = f == 0x2D; u.removeFirst() }
        let digits = u.prefix { $0 >= 0x30 && $0 <= 0x39 }
        guard !digits.isEmpty, let v = Double(String(decoding: digits, as: UTF16.self)) else { return nil }
        return negative ? -v : v
    }

    /// `Number(s)` for strings (StringToNumber): whitespace-trimmed decimal, `0x`/`0o`/`0b`,
    /// `Infinity`; empty → 0; anything else NaN (returned as `.nan`).
    public static func number(_ s: String) -> Double {
        let t = String(decoding: JSWhitespace.trim(Array(s.utf16)[...]), as: UTF16.self)
        if t.isEmpty { return 0 }
        for (p, radix) in [("0x", 16), ("0X", 16), ("0o", 8), ("0O", 8), ("0b", 2), ("0B", 2)] where t.hasPrefix(p) {
            let body = t.dropFirst(2)
            guard !body.isEmpty, let v = UInt64(body, radix: radix) else { return .nan }
            return Double(v)
        }
        switch t {
        case "Infinity", "+Infinity": return .infinity
        case "-Infinity": return -.infinity
        default: break
        }
        // StrDecimalLiteral: [+-] (digits [. digits] | . digits) [e [+-] digits]
        var i = t.startIndex
        func digits() -> Bool { let s = i; while i < t.endIndex, t[i].isASCII, t[i].isNumber { i = t.index(after: i) }; return i > s }
        if i < t.endIndex, t[i] == "+" || t[i] == "-" { i = t.index(after: i) }
        let intPart = digits()
        var fracPart = false
        if i < t.endIndex, t[i] == "." { i = t.index(after: i); fracPart = digits() }
        guard intPart || fracPart else { return .nan }
        if i < t.endIndex, t[i] == "e" || t[i] == "E" {
            i = t.index(after: i)
            if i < t.endIndex, t[i] == "+" || t[i] == "-" { i = t.index(after: i) }
            guard digits() else { return .nan }
        }
        guard i == t.endIndex else { return .nan }
        return Double(t) ?? .nan
    }
}
