import Foundation
import BereanText

/// Plain scripture clipboard output follows the original reader's Copy Verse and Copy Verses actions.
public struct VerseClipboard: Sendable {
    public struct Line {
        let number: String
        let text: String

        public init(number: String, text: String) {
            self.number = number
            self.text = text
        }
    }

    public let textId: String
    let replacerEnabled: Bool
    let rules: [WordReplacerRule]
    let hiddenAnnotations: Set<String>

    public init(textId: String, replacerEnabled: Bool = false, rules: [WordReplacerRule] = [], hiddenAnnotations: Set<String> = []) {
        let edition = textId.lowercased()
        self.textId = edition
        self.replacerEnabled = replacerEnabled
        self.rules = rules
        self.hiddenAnnotations = hiddenAnnotations.intersection(AnnotationFilters.keys[edition, default: []].map(\.id))
    }

    public static func reference(_ label: String, textId: String) -> String {
        guard !label.isEmpty else { return label }
        return label.replacingOccurrences(of: "–", with: "-") + (textId.lowercased() == "lxx" ? " LXX" : "")
    }

    public func reference(_ label: String) -> String { Self.reference(label, textId: textId) }

    private func renderedBody(_ text: String, tagged: String?) -> String {
        let visible = AnnotationFilters.strip(text, textId: textId, hidden: hiddenAnnotations)
        return VerseDisplay.text(visible, tagged: tagged, textId: textId, replacerEnabled: replacerEnabled,
                                 rules: rules, hideSuppliedWords: hiddenAnnotations.contains(AnnotationFilters.kjvaSuppliedWords))
    }

    public func body(_ row: ChapterVerseRow) -> String { Self.clean(renderedBody(row.text, tagged: row.textTagged)) }

    public func passage(_ label: String, rows: [ChapterVerseRow], wholeChapter: Bool = false) -> String {
        let verses = rows.map { row in
            // An attached LXX superscription belongs to the same verse. Missing-verse notices are reader chrome.
            let title = textId == "lxx" ? row.title?.split(whereSeparator: \.isNewline)
                .filter { line in
                    let notice = line.hasSuffix(" not in LXX —") && (line.hasPrefix("— v.") || line.hasPrefix("— vv."))
                    return !notice
                }
                .joined(separator: " ") : nil
            let text = [title, renderedBody(row.text, tagged: row.textTagged)].compactMap { $0 }.joined(separator: " ")
            return Line(number: row.readerVerseLabel, text: text)
        }
        return Self.passage(reference: reference(label), verses: verses, wholeChapter: wholeChapter)
    }

    /// A reference from search or the cross-reference list stores raw verse IDs. Copy the matching reader rows,
    /// including any superscription folded onto the first displayed verse.
    public func readerRows(_ raw: [ChapterVerseRow], bookId: String, chapter: Int, from: Int, through: Int) -> [ChapterVerseRow] {
        let stored = from...max(from, through)
        let first = PsalmSuperscription.readerVerseNum(from, bookId: bookId, chapter: chapter, textId: textId)
        let last = PsalmSuperscription.readerVerseNumbers(stored.upperBound, bookId: bookId, chapter: chapter, textId: textId).upperBound
        let displayed = first...last
        return PsalmSuperscription.apply(raw, textId: textId, bookId: bookId, chapter: chapter)
            .filter { row in
                stored.contains(row.verseNum) || ((row.displayVerseNum != nil || row.displayVerseEndNum != nil)
                    && row.readerVerseNumbers.overlaps(displayed))
            }
    }

    private static func singleVerse(reference: String, text: String) -> String {
        let body = clean(text)
        return body.isEmpty ? reference : "\(reference) \(body)"
    }

    public static func passage(reference: String, verses: [Line], wholeChapter: Bool = false) -> String {
        if verses.count == 1, !wholeChapter, let verse = verses.first {
            return singleVerse(reference: reference, text: verse.text)
        }
        let lines = verses.map { singleVerse(reference: $0.number, text: $0.text) }
        return ([reference] + lines).joined(separator: "\n")
    }

    private static func clean(_ text: String) -> String {
        text.replacingOccurrences(of: #"~?\{[HG]\d+(?:\|[HG]\d+)*\}"#, with: "", options: .regularExpression)
            .split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }
}
