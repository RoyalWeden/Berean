import Foundation
import BereanSQLite

public struct NoteWikiLinkTarget: Equatable, Sendable, Identifiable {
    public let id: String
    public let title: String
}

extension NotesService {
    /// Completion needs titles only, including older notes beyond the paged Notes list.
    public func wikiLinkTargets() throws -> [NoteWikiLinkTarget] {
        try db.query("SELECT id, title FROM notes WHERE deleted_at IS NULL AND title <> '' ORDER BY updated_at DESC, id")
            .compactMap { row in
                guard let id = row["id"]?.string, let title = row["title"]?.string else { return nil }
                return NoteWikiLinkTarget(id: id, title: title)
            }
    }
}

/// A pending source-level wikilink replacement. All ranges use UTF-16 offsets.
public struct NoteWikiLinkCompletion: Equatable, Sendable {
    public let range: NSRange
    public let query: String

    /// Detects an unfinished wikilink on the caret's line, with at most 256 UTF-16 query units.
    public static func detect(in text: String, selection: NSRange) -> Self? {
        let source = text as NSString
        guard selection.length == 0, selection.location >= 0, selection.location <= source.length,
              Range(selection, in: text) != nil else { return nil }
        let caret = selection.location
        var start = 0, end = 0
        source.getLineStart(&start, end: nil, contentsEnd: &end, for: selection)
        let before = NSRange(location: start, length: caret - start)
        let opening = source.range(of: "[[", options: .backwards, range: before)
        guard opening.location != NSNotFound else { return nil }
        let queryRange = NSRange(location: opening.location + 2, length: caret - opening.location - 2)
        guard queryRange.length <= 256 else { return nil }
        let query = source.substring(with: queryRange)
        guard !query.contains("["), !query.contains("]"),
              !isEscaped(at: opening.location, in: source) else { return nil }
        // Moving into an already completed link must not offer an insertion that duplicates its suffix.
        let suffix = NSRange(location: caret, length: end - caret)
        guard source.range(of: "]]", range: suffix).location == NSNotFound else { return nil }
        let range = NSRange(location: opening.location, length: caret - opening.location)
        guard !MarkdownLiveSpans.spans(text).contains(where: { span in
            switch span.kind {
            case .code, .codeBlock: return NSIntersectionRange(span.range, range).length > 0
            default: return false
            }
        }) else { return nil }
        // Also suppress completion while the user is still typing an unfinished inline code span.
        var delimiter: Int?
        var offset = start
        while offset < opening.location {
            if source.character(at: offset) == 96, !isEscaped(at: offset, in: source) {
                var next = offset + 1
                while next < opening.location, source.character(at: next) == 96 { next += 1 }
                let count = next - offset
                if delimiter == count { delimiter = nil } else if delimiter == nil { delimiter = count }
                offset = next
            } else { offset += 1 }
        }
        guard delimiter == nil else { return nil }
        return Self(range: range, query: query)
    }

    /// Returns one replacement suitable for a single native text edit and undo operation.
    public func edit(in text: String, selection: NSRange, title: String) -> NoteWikiLinkEdit? {
        guard Self.detect(in: text, selection: selection) == self,
              !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              title.rangeOfCharacter(from: CharacterSet(charactersIn: "[]|").union(.newlines)) == nil else { return nil }
        let replacement = "[[\(title)]]"
        return NoteWikiLinkEdit(range: range, replacement: replacement,
                                selection: NSRange(location: range.location + (replacement as NSString).length, length: 0))
    }

    private static func isEscaped(at offset: Int, in source: NSString) -> Bool {
        var preceding = offset
        while preceding > 0, source.character(at: preceding - 1) == 92 { preceding -= 1 }
        return (offset - preceding) % 2 == 1
    }
}

public struct NoteWikiLinkEdit: Equatable, Sendable {
    public let range: NSRange
    public let replacement: String
    public let selection: NSRange
}
