import Foundation
import BereanCore

/// Kokoro's English preprocessing around eSpeak. Run after spoken-word preparation;
/// punctuation is kept outside the phonemizer rather than pronounced or discarded.
public enum KokoroEnglish {
    public struct Part: Equatable, Sendable {
        public let text: String
        public let isPunctuation: Bool
        public init(text: String, isPunctuation: Bool) {
            self.text = text; self.isPunctuation = isPunctuation
        }
    }

    private static let punctuation = ";:,.!?¡¿—…\"«»“”(){}[]"
    // ECMAScript whitespace, including BOM but excluding Unicode-only NEL.
    private static let space = #"\x{0009}-\x{000D}\x{0020}\x{00A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}"#
    private static let boundary = #"(?:(?<=[A-Za-z0-9_])(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])(?=[A-Za-z0-9_]))"#

    private static func pattern(_ source: String) -> NSRegularExpression {
        // Keep JS ASCII digit/word-boundary semantics when using ICU lookbehind.
        try! NSRegularExpression(pattern: source.replacingOccurrences(of: #"\b"#, with: boundary)
            .replacingOccurrences(of: #"\d"#, with: "[0-9]"))
    }

    private static func sub(_ input: String, _ expression: String, firstOnly: Bool = false,
                            _ transform: (String, [String]) -> String) -> String {
        let source = input as NSString
        let matches = pattern(expression).matches(in: input, range: NSRange(location: 0, length: source.length))
        var result = "", cursor = 0
        for match in firstOnly ? Array(matches.prefix(1)) : matches {
            result += source.substring(with: NSRange(location: cursor, length: match.range.location - cursor))
            let captures = (0..<match.numberOfRanges).map { index in
                let range = match.range(at: index)
                return range.location == NSNotFound ? "" : source.substring(with: range)
            }
            result += transform(captures[0], captures)
            cursor = NSMaxRange(match.range)
        }
        return result + source.substring(from: cursor)
    }

    private static func sub(_ input: String, _ expression: String, _ replacement: String) -> String {
        sub(input, expression) { _, _ in replacement }
    }

    public static func normalize(_ input: String) -> String {
        var text = sub(input, "[‘’]", "'")
        for (from, to) in [("«", "“"), ("»", "”"), ("“", "\""), ("”", "\""),
                           ("(", "«"), (")", "»"), ("、", ", "), ("。", ". "), ("！", "! "),
                           ("，", ", "), ("：", ": "), ("；", "; "), ("？", "? ")] {
            text = text.replacingOccurrences(of: from, with: to)
        }
        // All JS whitespace except ordinary space and LF.
        text = sub(text, "[\\t\\x{000B}\\f\\r\\x{00A0}\\x{1680}\\x{2000}-\\x{200A}\\x{2028}\\x{2029}\\x{202F}\\x{205F}\\x{3000}\\x{FEFF}]", " ")
        text = sub(text, "  +", firstOnly: true) { _, _ in " " }
        text = sub(text, #"(?<=\n) +(?=\n)"#, "")
        text = sub(text, #"\bD[Rr]\.(?= [A-Z])"#, "Doctor")
        text = sub(text, #"\b(?:Mr\.|MR\.(?= [A-Z]))"#, "Mister")
        text = sub(text, #"\b(?:Ms\.|MS\.(?= [A-Z]))"#, "Miss")
        text = sub(text, #"\b(?:Mrs\.|MRS\.(?= [A-Z]))"#, "Mrs")
        text = sub(text, #"\b[eE][tT][cC]\.(?! [A-Za-z])"#, "etc")
        text = sub(text, #"\b([yY])[eE][aA][hH]?\b"#) { _, groups in groups[1] + "e'a" }
        text = sub(text, #"\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)"#) { value, _ in
            splitNumber(value)
        }
        text = sub(text, #"(?<=\d),(?=\d)"#, "")
        text = sub(text, #"[$£]\d+(?:\.\d+)?(?: [hH][uU][nN][dD][rR][eE][dD]| [tT][hH][oO][uU][sS][aA][nN][dD]| (?:[bBmM]|[tT][rR])[iI][lL][lL][iI][oO][nN])*\b|[$£]\d+\.\d\d?\b"#) { value, _ in
            currency(value)
        }
        text = sub(text, #"\d*\.\d+"#) { value, _ in
            let pieces = value.components(separatedBy: ".")
            return pieces[0] + " point " + pieces[1].map(String.init).joined(separator: " ")
        }
        text = sub(text, #"(?<=\d)-(?=\d)"#, " to ")
        text = sub(text, #"(?<=\d)S"#, " S")
        text = sub(text, #"(?<=[BCDFGHJ-NP-TV-Z])'?s\b"#, "'S")
        text = sub(text, #"(?<=X')S\b"#, "s")
        text = sub(text, #"(?:[A-Za-z]\.){2,} [a-z]"#) { value, _ in value.replacingOccurrences(of: ".", with: "-") }
        text = sub(text, #"(?<=[A-Za-z])\.(?=[A-Za-z])"#, "-")
        return JSText.trim(text)
    }

    private static func splitNumber(_ value: String) -> String {
        if value.contains(".") { return value }
        if value.contains(":"), let hour = Int(value.components(separatedBy: ":")[0]),
           let minute = Int(value.components(separatedBy: ":")[1]) {
            return minute == 0 ? "\(hour) o'clock" : minute < 10 ? "\(hour) oh \(minute)" : "\(hour) \(minute)"
        }
        guard let year = Int(value.prefix(4)), year >= 1100, year % 1000 >= 10 else { return value }
        let century = String(value.prefix(2)), rest = year % 100, suffix = value.hasSuffix("s") ? "s" : ""
        if (100...999).contains(year % 1000) {
            if rest == 0 { return century + " hundred" + suffix }
            if rest < 10 { return century + " oh \(rest)" + suffix }
        }
        return century + " \(rest)" + suffix
    }

    private static func currency(_ value: String) -> String {
        let dollars = value.first == "$", unit = dollars ? "dollar" : "pound"
        let amount = String(value.dropFirst())
        guard Double(amount) != nil else { return amount + " " + unit + "s" }
        let pieces = amount.components(separatedBy: ".")
        guard pieces.count > 1 else { return amount + " " + unit + (amount == "1" ? "" : "s") }
        let fraction = pieces[1].count < 2 ? pieces[1] + "0" : pieces[1]
        // A decimal can contain arbitrarily many digits; follow JavaScript Number formatting.
        let cents = Double(fraction) ?? 0
        let count = JSNumber.toString(cents)
        let minor = dollars ? (cents == 1 ? "cent" : "cents") : (cents == 1 ? "penny" : "pence")
        return pieces[0] + " " + unit + (pieces[0] == "1" ? "" : "s") + " and " + count + " " + minor
    }

    public static func parts(_ input: String, normalize shouldNormalize: Bool = true) -> [Part] {
        let text = shouldNormalize ? normalize(input) : input
        let source = text as NSString
        // escapedPattern is for a complete regex, not a class: on Darwin it
        // leaves ']' bare, which makes this punctuation class match nothing.
        let escaped = punctuation.map { "\\[]^-".contains($0) ? "\\" + String($0) : String($0) }.joined()
        let regex = try! NSRegularExpression(pattern: "([\(space)]*[\(escaped)]+[\(space)]*)+")
        var parts: [Part] = [], cursor = 0
        for match in regex.matches(in: text, range: NSRange(location: 0, length: source.length)) {
            if cursor < match.range.location {
                parts.append(Part(text: source.substring(with: NSRange(location: cursor, length: match.range.location - cursor)), isPunctuation: false))
            }
            parts.append(Part(text: source.substring(with: match.range), isPunctuation: true))
            cursor = NSMaxRange(match.range)
        }
        if cursor < source.length { parts.append(Part(text: source.substring(from: cursor), isPunctuation: false)) }
        return parts
    }

    public static func postprocess(_ input: String, american: Bool = true) -> String {
        var ipa = input.replacingOccurrences(of: "kəkˈoːɹoʊ", with: "kˈoʊkəɹoʊ")
            .replacingOccurrences(of: "kəkˈɔːɹəʊ", with: "kˈəʊkəɹəʊ")
        for (from, to) in [("ʲ", "j"), ("r", "ɹ"), ("x", "k"), ("ɬ", "l")] {
            ipa = ipa.replacingOccurrences(of: from, with: to)
        }
        ipa = sub(ipa, #"(?<=[a-zɹː])(?=hˈʌndɹɪd)"#, " ")
        ipa = sub(ipa, #" z(?=[;:,.!?¡¿—…"«»“” ]|\z)"#, "z")
        if american { ipa = sub(ipa, #"(?<=nˈaɪn)ti(?!ː)"#, "di") }
        return JSText.trim(ipa)
    }
}
