import BereanCore
import Foundation

/// Spoken-only preparation, after the existing display/Strong's substitutions.
/// Matches src/lib/tts/textPrep.ts; it never rewrites stored or displayed verses.
public enum SpeechPreparation {
    private static let ones = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
    private static let tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
    private static let ordinalOnes = ["zeroth", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth", "eleventh", "twelfth", "thirteenth", "fourteenth", "fifteenth", "sixteenth", "seventeenth", "eighteenth", "nineteenth"]
    private static let ordinalTens = ["", "", "twentieth", "thirtieth", "fortieth", "fiftieth", "sixtieth", "seventieth", "eightieth", "ninetieth"]
    private static let scales: [(Int64, String)] = [(1_000_000_000, "billion"), (1_000_000, "million"), (1_000, "thousand")]
    private static let maximum: Double = 999_999_999_999
    private static let number = JSRegex(#"^([([{"'‘“]*)(\d{1,3}(?:,\d{3})*|\d+)(st|nd|rd|th)?([)\]}"'’”,;:.!?]*)$"#, ignoreCase: true)
    private static let decimal = JSRegex(#"^([([{"'‘“]*)(\d+)\.(\d+)([)\]}"'’”,;:.!?]*)$"#)
    private static let leading = JSRegex(#"^([([{"'‘“]*)(.*)$"#)
    private static let respelling = JSRegex(#"^([([{"'‘“]*)([A-Za-z]+)(?:('s|’s))?([)\]}"'’”,;:.!?]*)$"#)
    private static let abbreviations = ["mr.": "mister", "mrs.": "missus", "ms.": "miss", "dr.": "doctor", "st.": "saint", "vs.": "versus", "etc.": "et cetera", "e.g.": "for example", "i.e.": "that is", "cf.": "compare", "no.": "number", "ch.": "chapter", "chs.": "chapters", "v.": "verse", "vv.": "verses", "ff.": "and following", "approx.": "approximately"]
    private static let pronunciations = ["yehovah": "Yehovuh", "yehovahs": "Yehovuh's", "yeshua": "Yeshuwa", "yeshuas": "Yeshuwa's"]

    public static func numberToWords(_ value: Int64, ordinal: Bool = false) -> String {
        guard value != Int64.min else { return String(value) }
        if value < 0 { return "negative " + numberToWords(-value, ordinal: ordinal) }
        if value < 20 { return (ordinal ? ordinalOnes : ones)[Int(value)] }
        if value < 100 {
            let rest = value % 10
            return rest == 0 ? (ordinal ? ordinalTens : tens)[Int(value / 10)]
                : tens[Int(value / 10)] + "-" + (ordinal ? ordinalOnes : ones)[Int(rest)]
        }
        if value < 1_000 {
            let head = ones[Int(value / 100)]
            return value % 100 == 0 ? head + (ordinal ? " hundredth" : " hundred")
                : head + " hundred and " + numberToWords(value % 100, ordinal: ordinal)
        }
        for (scale, name) in scales where value >= scale {
            let rest = value % scale
            let head = numberToWords(value / scale) + " " + name
            return rest == 0 ? head + (ordinal ? "th" : "")
                : head + (rest < 100 ? " and " : " ") + numberToWords(rest, ordinal: ordinal)
        }
        return String(value)
    }

    public static func expandNumbers(_ token: String) -> String {
        if let match = decimal.match(token), let whole = Double(match[2] ?? ""), whole <= maximum {
            let fraction = (match[3] ?? "").utf16.map { ones[Int($0 - 48)] }.joined(separator: " ")
            return (match[1] ?? "") + numberToWords(Int64(whole)) + " point " + fraction + (match[4] ?? "")
        }
        guard let match = number.match(token),
              let value = Double((match[2] ?? "").replacingOccurrences(of: ",", with: "")), value <= maximum else { return token }
        return (match[1] ?? "") + numberToWords(Int64(value), ordinal: match[3] != nil) + (match[4] ?? "")
    }

    public static func expandAbbreviation(_ token: String) -> String {
        let match = leading.match(token)
        let prefix = match?[1] ?? ""
        let rest = match?[2] ?? token
        guard var expansion = abbreviations[JSText.lower(rest)] else { return token }
        if let first = rest.utf16.first {
            let source = String(decoding: [first], as: UTF16.self)
            if source == source.uppercased(), source != source.lowercased() {
                expansion = String(expansion.prefix(1)).uppercased() + expansion.dropFirst()
            }
        }
        return prefix + expansion
    }

    public static func applyPronunciation(_ token: String) -> String {
        guard let match = respelling.match(token),
              let value = pronunciations[JSText.lower((match[2] ?? "") + (match[3] == nil ? "" : "s"))] else { return token }
        return (match[1] ?? "") + value + (match[4] ?? "")
    }

    public static func normalizePunctuation(_ token: String) -> String {
        let changed = token.replacingOccurrences(of: "...", with: ",").replacingOccurrences(of: "…", with: ",")
            .replacingOccurrences(of: "—", with: ",").replacingOccurrences(of: "–", with: ",")
        let punctuation = Set("!?.,;:".utf16)
        var units: [UInt16] = []
        for unit in changed.utf16 {
            if units.last == unit, punctuation.contains(unit) { continue }
            units.append(unit)
        }
        return String(decoding: units, as: UTF16.self).replacingOccurrences(of: "‘", with: "'")
            .replacingOccurrences(of: "’", with: "'").replacingOccurrences(of: "“", with: "\"")
            .replacingOccurrences(of: "”", with: "\"")
    }

    public static func prepare(_ word: String) -> String {
        let spoken = applyPronunciation(word)
        let abbreviation = expandAbbreviation(spoken)
        return normalizePunctuation(abbreviation == spoken ? expandNumbers(spoken) : abbreviation)
    }
}
