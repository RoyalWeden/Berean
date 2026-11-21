import Foundation

public extension LexiconEntry {
    /// Plain-text dictionary block used by the legacy editor's Strong's block detector.
    var dictionaryCopyText: String {
        let pronunciationLine = [transliteration, pronunciation]
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: ", ")
        let heading = [strongsNum, lemma.trimmingCharacters(in: .whitespacesAndNewlines), pronunciationLine]
            .filter { !$0.isEmpty }.joined(separator: " ") + ";"

        let language = strongsNum.hasPrefix("H") ? "H" : "G"
        let origin = Self.normalizeCopyReferences(derivation.trimmingCharacters(in: .whitespacesAndNewlines), language: language)
        let basic = definition.trimmingCharacters(in: .whitespacesAndNewlines)
        let meaning = Self.normalizeCopyReferences(basic.isEmpty ? Self.cleanExtendedCopyText(extendedDef) : basic, language: language)
        let body = if origin.isEmpty || meaning.isEmpty {
            origin + meaning
        } else {
            origin + (origin.hasSuffix(";") ? " " : "; ") + meaning
        }

        let renderings = gloss.trimmingCharacters(in: .whitespacesAndNewlines)
        if renderings.isEmpty { return body.isEmpty ? heading : heading + "\n" + body }
        let trimmedBody = body.replacingOccurrences(of: #"[;,\s]+$"#, with: "", options: .regularExpression)
        return heading + "\n" + (trimmedBody.isEmpty ? renderings : trimmedBody + ":—" + renderings)
    }

    private static func cleanExtendedCopyText(_ text: String) -> String {
        text.replacingOccurrences(of: #"\[[^\]]*[\u0590-\u05FF\u0370-\u03FF][^\]]*\]"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\s{2,}"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func normalizeCopyReferences(_ text: String, language: String) -> String {
        let unpaddedPrefixes = text.replacingOccurrences(of: #"\b([HG])0+(\d)"#, with: "$1$2", options: .regularExpression)
        return unpaddedPrefixes.replacingOccurrences(of: #"(?<![HGa-zA-Z/:])\b(?=\d{1,5}\b)0*(\d{1,5})\b(?!\s*:)"#,
                                                    with: language + "$1", options: .regularExpression)
    }
}
