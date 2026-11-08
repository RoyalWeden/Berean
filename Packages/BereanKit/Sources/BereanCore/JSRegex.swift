/// Compiles a JavaScript (non-`u`) regular-expression source for Swift Regex with JavaScript's
/// meaning: `\d` = [0-9], `\w` = [A-Za-z0-9_], `\s` = the ECMAScript whitespace set, `$` = end
/// of input, and the `i` flag as explicit ASCII case classes (Swift's Unicode case folding would
/// also equate e.g. U+017F with "s", which JavaScript's non-`u` `i` does not). `\b` is only
/// supported directly after a word character, where it equals `(?![A-Za-z0-9_])`.
/// Matching uses Unicode-scalar semantics (JavaScript never matches grapheme clusters).
public struct JSRegex: @unchecked Sendable {
    public let regex: Regex<AnyRegexOutput>

    static let word = "A-Za-z0-9_"
    // U+2000…U+200A are listed one by one: Swift Regex rejects a class range starting at U+2000
    // ("invalid bound for character class range", Xcode 27.2).
    static let space = #"\t\n\x{0B}\f\r \x{A0}\x{1680}"# + (0x2000...0x200A).map { "\\x{\(String($0, radix: 16))}" }.joined()
        + #"\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}"#

    public init(_ source: String, ignoreCase: Bool = false) {
        regex = try! Regex(JSRegex.translate(source, ignoreCase: ignoreCase)).matchingSemantics(.unicodeScalar)
    }

    static func translate(_ src: String, ignoreCase: Bool) -> String {
        var out = ""
        var inClass = false
        let it = Array(src)
        var k = 0
        func caseClass(_ c: Character) -> String {
            let l = String(c).lowercased(), u = String(c).uppercased()
            return l == u ? String(c) : "[\(l)\(u)]"
        }
        while k < it.count {
            let c = it[k]
            if c == "\\", k + 1 < it.count {
                let e = it[k + 1]
                k += 2
                switch e {
                case "d": out += inClass ? "0-9" : "[0-9]"
                case "w": out += inClass ? word : "[\(word)]"
                case "s": out += inClass ? space : "[\(space)]"
                case "b":
                    precondition(!inClass, "\\b in class unsupported")
                    out += "(?![\(word)])"
                default: out += "\\\(e)"
                }
                continue
            }
            if inClass {
                if c == "]" { inClass = false; out.append(c); k += 1; continue }
                // JavaScript has no nested classes; Swift Regex would read a bare "[" as one.
                if c == "[" { out += "\\["; k += 1; continue }
                if ignoreCase, c.isASCII, c.isLetter {
                    if k + 2 < it.count, it[k + 1] == "-", it[k + 2].isASCII, it[k + 2].isLetter {
                        let a = String(it[k]), b = String(it[k + 2])
                        let swap = { (x: String) in x == x.lowercased() ? x.uppercased() : x.lowercased() }
                        out += "\(a)-\(b)\(swap(a))-\(swap(b))"
                        k += 3
                        continue
                    }
                    let l = String(c).lowercased(), u = String(c).uppercased()
                    out += l == u ? String(c) : l + u
                    k += 1
                    continue
                }
                out.append(c); k += 1
                continue
            }
            switch c {
            case "[": inClass = true; out.append(c)
                if k + 1 < it.count, it[k + 1] == "^" { out.append("^"); k += 1 }
            case "$": out += #"\z"#
            case "(":
                out.append(c)
                // Copy group syntax verbatim: (?: (?= (?! (?<! (?<=
                if k + 1 < it.count, it[k + 1] == "?" {
                    var j = k + 1
                    out.append("?"); j += 1
                    if j < it.count, it[j] == "<" { out.append("<"); j += 1 }
                    if j < it.count, ":=!".contains(it[j]) { out.append(it[j]); j += 1 }
                    k = j
                    continue
                }
            case "{":
                // quantifier — copy through the closing brace
                var j = k
                while j < it.count, it[j] != "}" { out.append(it[j]); j += 1 }
                if j < it.count { out.append("}") }
                k = j
            default:
                if ignoreCase, c.isASCII, c.isLetter { out += caseClass(c) } else { out.append(c) }
            }
            k += 1
        }
        return out
    }

    /// First match as an array of optional capture strings (index 0 = whole match).
    public func match(_ s: String) -> [String?]? {
        guard let m = try? regex.firstMatch(in: s) else { return nil }
        return (0..<m.output.count).map { m.output[$0].substring.map(String.init) }
    }

    /// `s.replace(/re/g, template)` — `$1`…`$9` in the template insert capture groups (an unmatched
    /// group inserts nothing, as in JavaScript).
    public func replaceAll(_ s: String, with template: String) -> String {
        let t = Array(template)
        return s.replacing(regex) { m -> String in
            var out = ""
            var i = 0
            while i < t.count {
                if t[i] == "$", i + 1 < t.count, let d = t[i + 1].wholeNumberValue, d >= 1, d < m.output.count {
                    out += m.output[d].substring.map(String.init) ?? ""
                    i += 2
                } else {
                    out.append(t[i]); i += 1
                }
            }
            return out
        }
    }
}
