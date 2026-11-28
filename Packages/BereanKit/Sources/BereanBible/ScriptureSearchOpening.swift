/// Shows a Brenton Psalm opening as separate source segments so Strong’s offsets stay local.
public enum ScriptureSearchOpening {
    public struct Segment: Equatable, Sendable, Identifiable {
        public let hit: ScriptureHit
        public let isTitle: Bool
        public var id: Int { hit.verseNum }
    }

    public static func requiresChapter(for hit: ScriptureHit) -> Bool {
        let firstBody = PsalmSuperscription.storedVerseNum(1, bookId: hit.bookId, chapter: hit.chapter, textId: hit.textId)
        return firstBody > 1 && hit.verseNum > 0 && hit.verseNum <= firstBody
    }

    public static func segments(in raw: [ChapterVerseRow], around hit: ScriptureHit) -> [Segment]? {
        guard requiresChapter(for: hit) else { return nil }
        let firstBody = PsalmSuperscription.storedVerseNum(1, bookId: hit.bookId, chapter: hit.chapter, textId: hit.textId)
        let opening = raw.filter {
            $0.bookId == hit.bookId && $0.chapter == hit.chapter && (1...firstBody).contains($0.verseNum)
        }.sorted { $0.verseNum < $1.verseNum }
        guard opening.map(\.verseNum) == Array(1...firstBody),
              opening.allSatisfy({ !$0.text.allSatisfy(\.isWhitespace) }),
              opening[hit.verseNum - 1].text == hit.text,
              let displayed = PsalmSuperscription.apply(opening, textId: hit.textId, bookId: hit.bookId, chapter: hit.chapter).first,
              displayed.verseNum == firstBody, displayed.displayVerseNum == 1, displayed.title?.isEmpty == false else { return nil }
        return opening.map { row in
            let segment = row.verseNum == hit.verseNum ? hit
                : ScriptureHit(textId: hit.textId, bookId: row.bookId, chapter: row.chapter,
                               verseNum: row.verseNum, text: row.text, textTagged: row.textTagged)
            return Segment(hit: segment, isTitle: row.verseNum < firstBody)
        }
    }
}
