import BereanText

/// Context previews use the same displayed rows as the reader. The search hit keeps its raw identity.
public enum ScriptureSearchContext {
    public enum Edge: Hashable, Sendable { case before, after }

    public struct Line: Equatable, Sendable, Identifiable {
        public let id: Int
        public let label: String
        public let text: String
    }

    public static func lines(in chapter: [ChapterVerseRow], around hit: ScriptureHit, span: Int, edge: Edge,
                             replacerEnabled: Bool, rules: [WordReplacerRule]) -> [Line] {
        guard span > 0, hit.verseNum > 0 else { return [] }
        let raw = chapter.filter { $0.bookId == hit.bookId && $0.chapter == hit.chapter }
        guard raw.contains(where: { $0.verseNum == hit.verseNum }) else { return [] }
        let displayed = PsalmSuperscription.apply(raw, textId: hit.textId, bookId: hit.bookId, chapter: hit.chapter)
        let index = displayed.firstIndex { $0.verseNum == hit.verseNum }
            // A folded superscription is shown with the first body row.
            ?? displayed.firstIndex { row in
                row.readerVerseNumbers.overlaps(PsalmSuperscription.readerVerseNumbers(
                    hit.verseNum, bookId: hit.bookId, chapter: hit.chapter, textId: hit.textId
                ))
            }
        guard let index else { return [] }
        let active = displayed[index].readerVerseNumbers
        let neighbors = switch edge {
        case .before:
            displayed[..<index].filter { row in
                let numbers = row.readerVerseNumbers
                return numbers.lowerBound < active.lowerBound && numbers.upperBound >= active.lowerBound - span
            }
        case .after:
            displayed[(index + 1)...].filter { row in
                let numbers = row.readerVerseNumbers
                return numbers.upperBound > active.upperBound && numbers.lowerBound - span <= active.upperBound
            }
        }
        return neighbors.map { row in
            Line(id: row.verseNum, label: row.readerVerseLabel,
                 text: VerseDisplay.text(row.text, tagged: row.textTagged, textId: hit.textId,
                                         replacerEnabled: replacerEnabled, rules: rules))
        }
    }
}
