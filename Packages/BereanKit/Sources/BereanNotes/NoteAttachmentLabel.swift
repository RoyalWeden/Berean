import Foundation
import BereanBible
import BereanReference

/// Native reader labels for stored attachments. Storage keys and the legacy
/// Reference formatter keep their original numbering for sync compatibility.
public enum NoteAttachmentLabel {
    public static func display(_ source: String, textId: String) -> String {
        guard !source.isEmpty else { return "" }
        let hermas = HermasText(textId: textId)
        guard textId.lowercased() == "lxx" else {
            return Reference.verseRefDisplay(source, textId: textId, hermas: hermas)
        }
        let labels = source.split(separator: ",", omittingEmptySubsequences: false).map { part -> String in
            let raw = String(part).trimmingCharacters(in: .whitespacesAndNewlines)
            guard let link = Reference.parseNoteAttachment(raw), link.bookId == "PSA" else {
                return Reference.verseRefDisplay(raw, hermas: hermas)
            }
            guard let verse = link.verse else {
                return Reference.bookChapterLabel(link.bookId, chapter: Double(link.chapter))
            }
            let start = PsalmSuperscription.readerVerseNumbers(verse, bookId: link.bookId,
                chapter: link.chapter, textId: "lxx").lowerBound
            let end = PsalmSuperscription.readerVerseNumbers(link.endVerse ?? verse, bookId: link.bookId,
                chapter: link.chapter, textId: "lxx").upperBound
            let label = Reference.bookChapterVerseLabel(link.bookId, chapter: link.chapter, verse: start)
            return end > start ? "\(label)–\(end)" : label
        }
        return labels.joined(separator: ", ") + " LXX"
    }
}
