import BereanBible
import BereanReference

/// Canonical reader rows for a note's human-entered reference. This never
/// rewrites raw verse IDs or accepts partial/missing chapter results.
public enum NoteScriptureSelection {
    public static func rows(for reference: ParsedRef, chapters: [Int: [ChapterVerseRow]],
                            textId: String) -> [ChapterVerseRow]? {
        let first = reference.chapter
        let last = reference.endChapter ?? first
        guard first >= 0, last >= first, last <= 999,
              reference.verse.map({ (1...999).contains($0) }) ?? true,
              reference.endVerse.map({ (1...999).contains($0) }) ?? true,
              last == first || reference.verseGroups == nil else { return nil }
        var result: [ChapterVerseRow] = []
        for chapter in first...last {
            guard let raw = chapters[chapter], !raw.isEmpty,
                  raw.allSatisfy({ $0.bookId == reference.bookId && $0.chapter == chapter }),
                  Set(raw.map(\.verseNum)).count == raw.count else { return nil }
            let prepared = PsalmSuperscription.apply(raw, textId: textId, bookId: reference.bookId, chapter: chapter)
            let available = Set(prepared.flatMap { Array($0.readerVerseNumbers) }.filter { $0 > 0 })
            guard let maximum = available.max() else { return nil }
            var selected = Set<Int>()
            if first == last, let groups = reference.verseGroups, !groups.isEmpty {
                for group in groups {
                    let end = group.endVerse ?? group.verse
                    guard group.verse > 0, end >= group.verse, end <= 999 else { return nil }
                    selected.formUnion(group.verse...end)
                }
            } else if let verse = reference.verse {
                let start = chapter == first ? verse : 1
                let end = chapter == last ? reference.endVerse ?? (first == last ? verse : maximum) : maximum
                guard start > 0, end >= start, end <= 999 else { return nil }
                selected.formUnion(start...end)
            } else {
                selected = available
            }
            guard let rows = PsalmSuperscription.readerSelection(selected, rows: raw,
                textId: textId, bookId: reference.bookId, chapter: chapter) else { return nil }
            result.append(contentsOf: rows)
        }
        return result.isEmpty ? nil : result
    }

    /// Legacy preference range, made safe for malformed/non-finite imported settings.
    public static func threshold(_ value: Double) -> Double {
        value.isFinite ? min(1, max(0, value)) : 0.9
    }
}
