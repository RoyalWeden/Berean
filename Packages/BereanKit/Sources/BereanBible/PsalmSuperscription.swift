import Foundation

/// Psalm superscriptions as a title line above the first body verse — port of src/lib/psalmSuperscription.ts.
///
/// KJV / KJVA: the curated title (`PsalmTitleData.kjv`) goes on verse 1; KJVA's `text_tagged` verse 1 carries the
/// title words, which are split off (tolerating the stray `b>` / `/b>` tokens in 39 Psalms) so they don't render in
/// the verse. Brenton: whole leading title verses are folded into the title line (body keeps its real verse
/// numbers), or the inline verse-1 prefix is trimmed. A data mismatch leaves the verse untouched (title shown twice)
/// rather than eating verse text. Nothing is written to any database.
public enum PsalmSuperscription {
    public static func apply(_ rows: [ChapterVerseRow], textId: String, bookId: String, chapter: Int) -> [ChapterVerseRow] {
        guard bookId == "PSA", !rows.isEmpty else { return rows }
        var out = rows
        switch textId {
        case "kjv", "kjva":
            guard let title = PsalmTitleData.kjv[chapter], let i = out.firstIndex(where: { $0.verseNum == 1 }) else { return rows }
            if textId == "kjva", let tagged = out[i].textTagged, let body = taggedBody(tagged, title: title) { out[i].textTagged = body }
            out[i].title = joinTitle(title, out[i].title)
            return out
        case "lxx":
            if let count = PsalmTitleData.brentonVerseCount[chapter], count > 0 {
                let hidden = out.filter { $0.verseNum <= count }
                let line = hidden.map { $0.text.trimmingCharacters(in: .whitespaces) }.joined(separator: " ")
                    .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
                out.removeAll { $0.verseNum <= count }
                guard !out.isEmpty, !line.isEmpty else { return rows }
                out[0].title = joinTitle(line, out[0].title)
                return out
            }
            guard let prefix = PsalmTitleData.brentonPrefix[chapter], let i = out.firstIndex(where: { $0.verseNum == 1 }) else { return rows }
            let trimmed = trimPrefix(out[i].text, prefix: prefix)
            guard trimmed != out[i].text else { return rows }
            out[i].text = trimmed
            if let tagged = out[i].textTagged, let body = taggedBody(tagged, title: prefix) { out[i].textTagged = body }
            out[i].title = joinTitle(prefix, out[i].title)
            return out
        default:
            return rows
        }
    }

    private static func joinTitle(_ superscription: String, _ existing: String?) -> String {
        guard let existing, !existing.isEmpty else { return superscription }
        return existing + "\n" + superscription
    }

    static func normalizeWords(_ s: String) -> String {
        s.lowercased().replacingOccurrences(of: #"[^a-z0-9]+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
    }

    /// `trimVerseOneText`: exact prefix first, then a normalized-word walk; unchanged when nothing matches.
    static func trimPrefix(_ text: String, prefix: String) -> String {
        if text.hasPrefix(prefix) { return String(text.dropFirst(prefix.count)).replacingOccurrences(of: #"^\s+"#, with: "", options: .regularExpression) }
        let np = normalizeWords(prefix), nt = normalizeWords(text)
        guard !np.isEmpty, nt.hasPrefix(np) else { return text }
        let want = np.split(separator: " ").count
        let chars = Array(text)
        func isWord(_ c: Character) -> Bool { c.isASCII && (c.isLetter || c.isNumber) }
        var i = 0, seen = 0
        while i < chars.count, seen < want {
            while i < chars.count, !isWord(chars[i]) { i += 1 }
            while i < chars.count, isWord(chars[i]) { i += 1 }
            seen += 1
        }
        while i < chars.count, !isWord(chars[i]) { i += 1 }
        return i > 0 && i < chars.count ? String(chars[i...]) : text
    }

    private static let artifacts: Set<String> = ["b>", "/b>", "", "~"]

    private static func detag(_ t: String) -> String {
        t.replacingOccurrences(of: #"^[*!]+"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\{[^}]*\}"#, with: "", options: .regularExpression)
            .trimmingCharacters(in: .whitespaces)
    }

    /// `splitVerseOneTagged` body half: nil when the leading tokens don't read as the title.
    static func taggedBody(_ tagged: String, title: String) -> String? {
        let titleWords = title.split(whereSeparator: \.isWhitespace).count
        let tokens = tagged.split(whereSeparator: \.isWhitespace).map(String.init)
        guard tokens.count > titleWords else { return nil }
        var words = 0, i = 0
        var consumed: [String] = []
        while i < tokens.count, words < titleWords {
            let d = detag(tokens[i]); i += 1
            if artifacts.contains(d) { continue }
            consumed.append(d); words += 1
        }
        while i < tokens.count, artifacts.contains(detag(tokens[i])) { i += 1 }
        guard normalizeWords(consumed.joined(separator: " ")) == normalizeWords(title) else { return nil }
        return tokens[i...].joined(separator: " ")
    }
}
