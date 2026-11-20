import Foundation
import BereanReference

/// A plain reference immediately before the caret that can be expanded into source text.
/// Detection and edits use UTF-16 ranges, without reserializing the surrounding Markdown.
public struct NoteReferenceCompletion: Equatable, Sendable {
    public enum Target: Equatable, Sendable {
        case strongs(String)
        case scripture(String)
    }

    public let range: NSRange
    public let target: Target
    private let source: String

    public static func detect(in text: String, selection: NSRange) -> Self? {
        let source = text as NSString
        guard selection.length == 0, selection.location >= 0, selection.location <= source.length,
              Range(selection, in: text) != nil else { return nil }
        var lineStart = 0, lineEnd = 0
        source.getLineStart(&lineStart, end: nil, contentsEnd: &lineEnd, for: selection)
        let caret = selection.location
        guard caret <= lineEnd else { return nil }
        let prefixRange = NSRange(location: lineStart, length: caret - lineStart)
        let prefix = source.substring(with: prefixRange)
        let suffix = source.substring(with: NSRange(location: caret, length: lineEnd - caret))
        // Do not expand a partial token, reference range, or reference whose LXX marker is still ahead.
        guard suffix.range(of: #"^(?:[\p{L}\p{N}_:]|[.\-–][0-9]|[,\-–][ \t]*[0-9]|[ \t]+(?:LXX\b|(?:[,\-–][ \t]*)?[0-9]))"#,
                           options: [.regularExpression, .caseInsensitive]) == nil else { return nil }

        let range: NSRange
        let target: Target
        if let match = prefix.range(of: #"(?<![\p{L}\p{N}_])[HhGg][0-9]{1,5}$"#, options: .regularExpression),
           let id = StrongsId.normalize(String(prefix[match])) {
            let local = NSRange(match, in: prefix)
            range = NSRange(location: lineStart + local.location, length: local.length)
            target = .strongs(id)
        } else if let span = NoteVerseRefs.linkSpans(content: prefix).last,
                  NSMaxRange(span.range) == (prefix as NSString).length,
                  let parsed = Reference.parse(span.reference), parsed.verse != nil {
            range = NSRange(location: lineStart + span.range.location, length: span.range.length)
            target = .scripture(source.substring(with: range))
        } else { return nil }

        let spans = MarkdownLiveSpans.spans(text)
        // Expansion inserts paragraphs, so a cell must retain ordinary reference links
        // rather than offering an edit that splits its serialized table row.
        guard NoteInlineFormat.allowsParagraphStyle(in: source, selection: selection),
              !isEscaped(at: range.location, in: source),
              !isInsideMarkup(source, lineStart: lineStart, through: NSMaxRange(range)),
              !hasUnclosedFormatting(source, lineStart: lineStart, before: range.location, excluding: spans),
              !spans.contains(where: { span in
                  switch span.kind {
                  case .code, .codeBlock, .link, .wikilink, .image, .bold, .italic, .strike, .underline, .highlight:
                      return NSIntersectionRange(span.range, range).length > 0
                  default: return false
                  }
              }) else { return nil }
        return Self(range: range, target: target, source: text)
    }

    /// One undoable replacement. A delayed lookup cannot overwrite a changed note or moved caret.
    public func edit(in text: String, selection: NSRange, replacement: String) -> NoteWikiLinkEdit? {
        guard Self.detect(in: text, selection: selection) == self,
              !replacement.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        var inserted = replacement
        if replacement.rangeOfCharacter(from: .newlines) != nil {
            let text = text as NSString
            var start = 0, end = 0
            text.getLineStart(&start, end: nil, contentsEnd: &end, for: range)
            let before = text.substring(with: NSRange(location: start, length: range.location - start))
            let after = text.substring(with: NSRange(location: NSMaxRange(range), length: end - NSMaxRange(range)))
            if !before.trimmingCharacters(in: .whitespaces).isEmpty, !inserted.hasPrefix("\n") { inserted = "\n\n" + inserted }
            if !after.trimmingCharacters(in: .whitespaces).isEmpty, !inserted.hasSuffix("\n") { inserted += "\n\n" }
        }
        return NoteWikiLinkEdit(range: range, replacement: inserted,
                                selection: NSRange(location: range.location + inserted.utf16.count, length: 0))
    }

    /// An unfinished formatting opener has no live span yet. Block expansion must not split its delimiters.
    private static func hasUnclosedFormatting(_ source: NSString, lineStart: Int, before end: Int,
                                             excluding spans: [MarkdownLiveSpans.Span]) -> Bool {
        var active = Set<String>()
        var offset = lineStart
        func whitespace(_ unit: unichar) -> Bool {
            UnicodeScalar(unit).map { CharacterSet.whitespacesAndNewlines.contains($0) } ?? false
        }
        while offset < end {
            if let literal = spans.first(where: { span in
                switch span.kind {
                case .code, .codeBlock, .link, .wikilink, .image:
                    return NSLocationInRange(offset, span.range)
                default: return false
                }
            }) { offset = NSMaxRange(literal.range); continue }
            guard !isEscaped(at: offset, in: source) else { offset += 1; continue }
            let remaining = source.substring(with: NSRange(location: offset, length: end - offset))
            if remaining.hasPrefix("<u>") { active.insert("<u>"); offset += 3; continue }
            if remaining.hasPrefix("</u>") { active.remove("<u>"); offset += 4; continue }
            if remaining.hasPrefix("</mark>") { active.remove("<mark>"); offset += 7; continue }
            if remaining.hasPrefix("<mark"), let close = remaining.firstIndex(of: ">") {
                active.insert("<mark>")
                offset += remaining[...close].utf16.count
                continue
            }
            let marker = ["**", "__", "~~", "==", "*", "_"].first { remaining.hasPrefix($0) }
            guard let marker else { offset += 1; continue }
            let next = offset + marker.utf16.count
            let canClose = offset > lineStart && !whitespace(source.character(at: offset - 1))
            let canOpen = next < source.length && !whitespace(source.character(at: next))
            if active.contains(marker), canClose { active.remove(marker) }
            else if canOpen {
                // Underscores inside a word are literal, matching the live-preview grammar.
                let previousIsWord = offset > lineStart && UnicodeScalar(source.character(at: offset - 1))
                    .map { CharacterSet.alphanumerics.contains($0) } == true
                if !marker.contains("_") || !previousIsWord { active.insert(marker) }
            }
            offset = next
        }
        return !active.isEmpty
    }

    private static func isEscaped(at offset: Int, in source: NSString) -> Bool {
        var preceding = offset
        while preceding > 0, source.character(at: preceding - 1) == 92 { preceding -= 1 }
        return (offset - preceding) % 2 == 1
    }

    /// Brackets cover labels, images and unfinished wikilinks; parentheses cover link destinations.
    /// Track unmatched backtick runs too, since a code span under construction has no live span yet.
    private static func isInsideMarkup(_ source: NSString, lineStart: Int, through end: Int) -> Bool {
        var brackets = 0, destination = 0
        var code: Int?
        var offset = lineStart
        while offset < end {
            if isEscaped(at: offset, in: source) { offset += 1; continue }
            let unit = source.character(at: offset)
            if unit == 96 {
                var next = offset + 1
                while next < end, source.character(at: next) == 96 { next += 1 }
                let count = next - offset
                if code == count { code = nil } else if code == nil { code = count }
                offset = next
                continue
            }
            if code == nil {
                if destination > 0 {
                    if unit == 40 { destination += 1 }
                    if unit == 41 { destination -= 1 }
                } else if unit == 91 { brackets += 1 }
                else if unit == 93, brackets > 0 {
                    brackets -= 1
                    if offset + 1 < end, source.character(at: offset + 1) == 40 { destination = 1; offset += 1 }
                }
            }
            offset += 1
        }
        return brackets > 0 || destination > 0 || code != nil
    }
}
