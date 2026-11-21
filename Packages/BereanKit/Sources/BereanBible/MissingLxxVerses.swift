/// "— v.5 not in LXX —" markers — port of ChapterView.tsx's missingLxxVerses effect. KJV verse numbers absent from a Brenton
/// chapter (below its last verse) are reported against the LXX verse they precede. Psalms, Joel, Malachi and Jeremiah 26+
/// are skipped (their LXX numbering differs wholesale, as in the original).
public enum MissingLxxVerses {
    public static func eligible(bookId: String, chapter: Int) -> Bool {
        let b = bookId.uppercased()
        return !["PSA", "JOL", "MAL"].contains(b) && !(b == "JER" && chapter >= 26)
    }

    public static func annotate(_ rows: [ChapterVerseRow], comparingTo kjv: [ChapterVerseRow]) -> [ChapterVerseRow] {
        let marks = markers(lxxVerses: rows.map(\.verseNum), kjvVerses: kjv.map(\.verseNum))
        guard !marks.isEmpty else { return rows }
        return rows.map { row in
            guard let mark = marks[row.verseNum] else { return row }
            var annotated = row
            annotated.title = row.title.map { mark + "\n" + $0 } ?? mark
            return annotated
        }
    }

    /// LXX verse number → marker text for the KJV verses missing just before it.
    public static func markers(lxxVerses: [Int], kjvVerses: [Int]) -> [Int: String] {
        guard let maxLxx = lxxVerses.max() else { return [:] }
        let present = Set(lxxVerses)
        let missing = kjvVerses.filter { $0 < maxLxx && !present.contains($0) }.sorted()
        guard !missing.isEmpty else { return [:] }
        var out: [Int: String] = [:]
        let ordered = lxxVerses.sorted()
        var previous = 0
        for v in ordered {
            let gap = missing.filter { $0 > previous && $0 < v }
            previous = v
            guard let first = gap.first, let last = gap.last else { continue }
            let contiguous = zip(gap, gap.dropFirst()).allSatisfy { $1 == $0 + 1 }
            let label = gap.count == 1 ? "v.\(first)" : contiguous ? "vv.\(first)-\(last)" : "vv.\(gap.map(String.init).joined(separator: ", "))"
            out[v] = "— \(label) not in LXX —"
        }
        return out
    }
}
