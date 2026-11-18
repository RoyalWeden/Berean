import Foundation
import BereanReference

/// Psalm superscriptions as a title line above the first body verse — port of src/lib/psalmSuperscription.ts.
///
/// KJV / KJVA: the curated title (`PsalmTitleData.kjv`) goes on verse 1; KJVA's `text_tagged` verse 1 carries the
/// title words, which are split off (tolerating the stray `b>` / `/b>` tokens in 39 Psalms) so they don't render in
/// the verse. Brenton: leading title rows belong to the first body verse, whose reader number is 1;
/// subsequent body numbers exclude those title rows. Stored verse IDs remain unchanged.
/// Inline verse-1 prefixes are trimmed. A data mismatch leaves the verse untouched (title shown twice)
/// rather than eating verse text. Nothing is written to any database.
public enum PsalmSuperscription {
    /// Translate only presentation numbers. Stored app links and annotation keys
    /// continue to use the bundled edition's original verse identifiers.
    public static func readerVerseNum(_ stored: Int, bookId: String, chapter: Int, textId: String) -> Int {
        guard textId == "lxx", bookId == "PSA", stored > 0 else { return stored }
        return max(1, stored - (PsalmTitleData.brentonVerseCount[chapter] ?? 0))
    }

    public static func storedVerseNum(_ displayed: Int, bookId: String, chapter: Int, textId: String) -> Int {
        guard textId == "lxx", bookId == "PSA", displayed > 0 else { return displayed }
        return displayed + (PsalmTitleData.brentonVerseCount[chapter] ?? 0)
    }

    /// Exact bundled correspondences win for combined/split Psalms. For the
    /// remaining Psalms, align body numbers while preserving storage numbering.
    public static func verseCounterpart(_ bookId: String, chapter: Int, verse: Int, from: String, to: String) -> (chapter: Int, verse: Int)? {
        if let exact = ChapterMap.verseCounterpart(bookId, chapter: chapter, verse: verse, from: from, to: to) { return exact }
        guard bookId == "PSA", (ChapterMap.isLxx(from) && ChapterMap.isKjv(to)) ||
                (ChapterMap.isKjv(from) && ChapterMap.isLxx(to)) else { return nil }
        // These chapters need the exact runs above; do not invent a match for
        // title-only rows, missing verses or the end of a split chapter.
        if (ChapterMap.isLxx(from) && [9, 113, 114, 115, 146, 147, 151].contains(chapter)) ||
            (ChapterMap.isKjv(from) && [9, 10, 114, 115, 116, 147].contains(chapter)) { return nil }
        let targetChapter = ChapterMap.mapChapter(bookId, chapter, from: from, to: to)
        return (targetChapter, storedVerseNum(readerVerseNum(verse, bookId: bookId, chapter: chapter, textId: from),
                                             bookId: bookId, chapter: targetChapter, textId: to))
    }

    public static func synchronizedVerse(_ bookId: String, chapter: Int, verse: Int, from: String,
                                         destinationChapter: Int, to: String) -> Int? {
        if let mapped = verseCounterpart(bookId, chapter: chapter, verse: verse, from: from, to: to) {
            return mapped.chapter == destinationChapter ? mapped.verse : nil
        }
        return ChapterMap.synchronizedVerse(bookId, chapter: chapter, verse: verse, from: from,
                                             destinationChapter: destinationChapter, to: to)
    }

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
                // Match the body-first Brenton presentation used by Bible Hub and
                // BiblIndex, while keeping every annotation/link on its stored ID.
                // Only fold a complete title + first body, never a partial query.
                if out.contains(where: { $0.displayVerseNum != nil }) { return rows }
                let titles = out.filter { (1...count).contains($0.verseNum) }
                guard titles.map(\.verseNum) == Array(1...count),
                      let firstBody = out.firstIndex(where: { $0.verseNum == count + 1 }) else { return rows }
                out[firstBody].title = joinTitle(titles.map(\.text).joined(separator: "\n"), out[firstBody].title)
                out.removeAll { (1...count).contains($0.verseNum) }
                for index in out.indices { out[index].displayVerseNum = out[index].verseNum - count }
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
