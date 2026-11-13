/// KJV ⇄ LXX chapter numbering — port of src/lib/translationChapterMap.ts.
public enum ChapterMap {
    public static func isLxx(_ textId: String) -> Bool { textId.lowercased() == "lxx" }
    public static func isKjv(_ textId: String) -> Bool { ["kjva", "kjv"].contains(textId.lowercased()) }

    static func psalmKjvToLxx(_ c: Int) -> Int {
        if c <= 8 { return c }
        if c <= 10 { return 9 }
        if c <= 113 { return c - 1 }
        if c <= 115 { return 113 }
        if c == 116 { return 114 }
        if c == 117 { return 116 }
        if c == 118 { return 117 }
        if c <= 146 { return c - 1 }
        if c == 147 { return 146 }
        return c
    }
    static func psalmLxxToKjv(_ c: Int) -> Int {
        if c <= 8 { return c }
        if c == 9 { return 9 }
        if c <= 112 { return c + 1 }
        if c == 113 { return 114 }
        if c == 114 || c == 115 { return 116 }
        if c == 116 { return 117 }
        if c == 117 { return 118 }
        if c <= 145 { return c + 1 }
        if c == 146 || c == 147 { return 147 }
        return c
    }
    static let jerKjvToLxx: [Int: Int] = [26: 33, 27: 34, 28: 35, 29: 36, 30: 37, 31: 38, 32: 39, 33: 40, 34: 41, 35: 42, 36: 43, 37: 44, 38: 45, 39: 46,
                                           40: 47, 41: 48, 42: 49, 43: 50, 44: 51, 45: 51, 46: 26, 47: 29, 48: 31, 49: 30, 50: 27, 51: 28]
    static let jerLxxToKjv: [Int: Int] = [26: 46, 27: 50, 28: 51, 29: 47, 30: 49, 31: 48, 33: 26, 34: 27, 35: 28, 36: 29, 37: 30, 38: 31, 39: 32,
                                           40: 33, 41: 34, 42: 35, 43: 36, 44: 37, 45: 38, 46: 39, 47: 40, 48: 41, 49: 42, 50: 43, 51: 44]
    static let jolKjvToLxx = [1: 1, 2: 2, 3: 4], jolLxxToKjv = [1: 1, 2: 2, 3: 2, 4: 3]
    static let malKjvToLxx = [1: 1, 2: 2, 3: 3, 4: 3], malLxxToKjv = [1: 1, 2: 2, 3: 3]

    /// `mapChapterOnTranslationSwitch`.
    public static func mapChapter(_ bookId: String, _ chapter: Int, from: String, to: String) -> Int {
        if isLxx(from) == isLxx(to) { return chapter }
        let k2l = isKjv(from) && isLxx(to), l2k = isLxx(from) && isKjv(to)
        switch bookId.uppercased() {
        case "PSA": if k2l { return psalmKjvToLxx(chapter) }; if l2k { return psalmLxxToKjv(chapter) }
        case "JER": if k2l { return jerKjvToLxx[chapter] ?? chapter }; if l2k { return jerLxxToKjv[chapter] ?? chapter }
        case "JOL": if k2l { return jolKjvToLxx[chapter] ?? chapter }; if l2k { return jolLxxToKjv[chapter] ?? chapter }
        case "MAL": if k2l { return malKjvToLxx[chapter] ?? chapter }; if l2k { return malLxxToKjv[chapter] ?? chapter }
        default: break
        }
        return chapter
    }

    /// `toCanonicalChapters` — KJV chapter(s) for a chapter shown in `textId` (LXX Psalms 9 and 113 span two).
    public static func canonicalChapters(_ bookId: String, _ chapter: Int, textId: String) -> [Int] {
        if bookId.uppercased() != "PSA" || !isLxx(textId) { return [chapter] }
        if chapter == 9 { return [9, 10] }
        if chapter == 113 { return [114, 115] }
        return [psalmLxxToKjv(chapter)]
    }

    /// `equivalentChapters`.
    public static func equivalentChapters(_ bookId: String, _ chapter: Int, from: String, to: String) -> [Int] {
        if isLxx(from) == isLxx(to) { return [chapter] }
        if bookId.uppercased() == "PSA" {
            if isLxx(from) && isKjv(to) { return canonicalChapters(bookId, chapter, textId: from) }
            if isKjv(from) && isLxx(to) {
                if chapter == 116 { return [114, 115] }
                if chapter == 147 { return [146, 147] }
                return [psalmKjvToLxx(chapter)]
            }
        }
        return [mapChapter(bookId, chapter, from: from, to: to)]
    }

    /// Exact verse correspondences for editions whose Jonah chapter boundary differs.
    public static func jonahCounterpart(chapter: Int, verse: Int, from: String, to: String) -> (chapter: Int, verse: Int)? {
        if isKjv(from), isLxx(to) {
            if chapter == 1, verse == 17 { return (2, 1) }
            if chapter == 2, (1...10).contains(verse) { return (2, verse + 1) }
        }
        if isLxx(from), isKjv(to), chapter == 2 {
            if verse == 1 { return (1, 17) }
            if (2...11).contains(verse) { return (2, verse - 1) }
        }
        return nil
    }

    /// `versificationNote` — the explanatory note for an LXX chapter whose numbering differs.
    public static func versificationNote(_ bookId: String, _ chapter: Int, textId: String) -> String? {
        let book = bookId.uppercased()
        if let n = ReferenceTables.structuralNotes[book], isLxx(textId) { return n }
        if !isLxx(textId) { return nil }
        if !["PSA", "JER", "JOL", "MAL"].contains(book) { return nil }
        let kjv = mapChapter(book, chapter, from: textId, to: "kjva")
        if kjv == chapter && book != "PSA" && !(book == "MAL" && chapter == 3) { return nil }
        switch book {
        case "PSA":
            if chapter == 9 { return "This LXX chapter combines MT/KJV Psalms 9 and 10." }
            if chapter == 113 { return "This LXX chapter combines MT/KJV Psalms 114 and 115." }
            if chapter == 114 || chapter == 115 { return "This LXX chapter is part of MT/KJV Psalm 116 (\(chapter == 114 ? "verses 1-9" : "verses 10-19"))." }
            if chapter == 146 || chapter == 147 { return "This LXX chapter is part of MT/KJV Psalm 147 (\(chapter == 146 ? "verses 1-11" : "verses 12-20"))." }
            if chapter == 151 { return "Psalm 151 has no Masoretic/KJV counterpart — it survives only in the Septuagint and among the Dead Sea Scrolls." }
            if kjv == chapter { return nil }
            return "LXX Psalm \(chapter) = MT/KJV Psalm \(kjv)."
        case "JOL":
            if chapter == 3 { return "This LXX chapter is MT/KJV Joel 2:28-32." }
            if kjv == chapter { return nil }
            return "LXX Joel \(chapter) = MT/KJV Joel \(kjv)."
        case "MAL":
            if chapter == 3 { return "This LXX chapter includes MT/KJV Malachi 3 and, from verse 19, Malachi 4." }
            return nil
        default:
            if kjv == chapter { return nil }
            return "LXX Jeremiah \(chapter) = MT/KJV Jeremiah \(kjv) — the Septuagint reorders the second half of Jeremiah."
        }
    }
}
