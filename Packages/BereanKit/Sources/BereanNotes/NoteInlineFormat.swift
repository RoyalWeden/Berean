import Foundation

/// Source-preserving inline formatting shared by both native editors.
public enum NoteInlineFormat {
    public struct Edit {
        public let range: NSRange
        public let replacement: String
        public let selection: NSRange
    }

    public static func edit(in text: NSString, selection: NSRange, opening: String, closing: String) -> Edit? {
        guard selection.location >= 0, selection.length >= 0,
              selection.location <= text.length, selection.length <= text.length - selection.location else { return nil }
        let table = tableLines(in: text)
        let spans = MarkdownLiveSpans.spans(text as String)
        // Existing inline constructs keep their own source and rendering. The
        // live renderer gives these runs precedence over an enclosing new mark.
        let protected = spans.compactMap { span -> NSRange? in
            let ownsMark: Bool
            switch span.kind {
            case .code: ownsMark = !opening.allSatisfy { $0 == "`" }
            case .link, .wikilink, .image: ownsMark = true
            case .bold: ownsMark = opening != "**" && opening != "__"
            case .italic: ownsMark = opening != "*" && opening != "_"
            case .underline: ownsMark = opening != "<u>"
            case .strike: ownsMark = opening != "~~"
            case .highlight: ownsMark = opening != "==" && !opening.hasPrefix("<mark ")
            default: ownsMark = false
            }
            guard ownsMark else { return nil }
            var range = span.range
            for marker in spans.filter({ $0.kind == .hidden }).sorted(by: { $0.range.location > $1.range.location })
                where marker.range.upperBound == range.location {
                range = NSUnionRange(range, marker.range)
            }
            for marker in spans.filter({ $0.kind == .hidden }).sorted(by: { $0.range.location < $1.range.location })
                where marker.range.location == range.upperBound {
                range = NSUnionRange(range, marker.range)
            }
            return range
        }
        let touchesTable = table.contains { line in
            selection.length == 0 ? NSLocationInRange(selection.location, line.range)
                : NSIntersectionRange(line.range, selection).length > 0
        }
        guard touchesTable else { return wrapped(in: text, selection: selection, opening: opening, closing: closing).edit }

        guard !opening.contains("\n"), !closing.contains("\n") else { return nil }
        if selection.length == 0 {
            guard let row = table.first(where: { !$0.rule && NSLocationInRange(selection.location, $0.range) }),
                  let cell = MarkdownLiveSpans.tableCells(in: text, range: row.range).first(where: {
                      selection.location >= $0.location && selection.location <= $0.upperBound
                  }) else { return nil }
            let caret = NSRange(location: min(max(selection.location, cell.location), cell.upperBound), length: 0)
            return wrapped(in: text, selection: caret, opening: opening, closing: closing).edit
        }

        var parts: [(edit: Edit, removing: Bool)] = []
        var position = selection.location
        let end = NSMaxRange(selection)
        while position < end {
            var lineEnd = 0, contentEnd = 0
            text.getLineStart(nil, end: &lineEnd, contentsEnd: &contentEnd, for: NSRange(location: position, length: 0))
            let line = text.lineRange(for: NSRange(location: position, length: 0))
            if let row = table.first(where: { $0.range.location == line.location }) {
                if !row.rule {
                    for cell in MarkdownLiveSpans.tableCells(in: text, range: row.range) {
                        for range in editableParts(NSIntersectionRange(cell, selection), excluding: protected, in: text) {
                            parts.append(wrapped(in: text, selection: range, opening: opening, closing: closing))
                        }
                    }
                }
            } else if let range = trimmed(NSIntersectionRange(NSRange(location: position, length: max(0, contentEnd - position)), selection), in: text) {
                parts.append(wrapped(in: text, selection: range, opening: opening, closing: closing))
            }
            guard lineEnd > position else { break }
            position = lineEnd
        }
        guard !parts.isEmpty else { return nil }
        // A mixed selection becomes uniformly formatted. A second invocation
        // removes the mark, without toggling already-formatted cells off first.
        let removing = parts.allSatisfy(\.removing)
        let edits = parts.filter { removing || !$0.removing }.map(\.edit)
        if parts.count == 1 { return edits[0] }
        let range = edits.reduce(selection) { NSUnionRange($0, $1.range) }
        let replacement = NSMutableString(string: text.substring(with: range))
        for edit in edits.sorted(by: { $0.range.location > $1.range.location }) {
            replacement.replaceCharacters(in: NSRange(location: edit.range.location - range.location, length: edit.range.length), with: edit.replacement)
        }
        return Edit(range: range, replacement: replacement as String,
                    selection: NSRange(location: range.location, length: replacement.length))
    }

    private static func editableParts(_ range: NSRange, excluding protected: [NSRange], in text: NSString) -> [NSRange] {
        var parts = [range]
        for excluded in protected {
            parts = parts.flatMap { part -> [NSRange] in
                let overlap = NSIntersectionRange(part, excluded)
                guard overlap.length > 0 else { return [part] }
                return [NSRange(location: part.location, length: overlap.location - part.location),
                        NSRange(location: overlap.upperBound, length: part.upperBound - overlap.upperBound)]
            }
        }
        return parts.compactMap { trimmed($0, in: text) }
    }

    private static func trimmed(_ range: NSRange, in text: NSString) -> NSRange? {
        guard range.length > 0 else { return nil }
        var start = range.location, end = NSMaxRange(range)
        while start < end, let scalar = UnicodeScalar(text.character(at: start)), CharacterSet.whitespaces.contains(scalar) { start += 1 }
        while end > start, let scalar = UnicodeScalar(text.character(at: end - 1)), CharacterSet.whitespaces.contains(scalar) { end -= 1 }
        return end > start ? NSRange(location: start, length: end - start) : nil
    }

    private static func wrapped(in text: NSString, selection: NSRange, opening: String, closing: String) -> (edit: Edit, removing: Bool) {
        let prefix = opening.utf16.count, suffix = closing.utf16.count
        let end = NSMaxRange(selection)
        let inner = text.substring(with: selection)
        if prefix > 0, suffix > 0, selection.length >= prefix + suffix,
           inner.hasPrefix(opening), inner.hasSuffix(closing),
           MarkdownLiveSpans.spans(inner).contains(where: {
               guard $0.range == NSRange(location: prefix, length: selection.length - prefix - suffix) else { return false }
               switch $0.kind {
               case .bold, .italic, .underline, .strike, .highlight, .code: return true
               default: return false
               }
           }) {
            let body = (inner as NSString).substring(with: NSRange(location: prefix, length: selection.length - prefix - suffix))
            return (Edit(range: selection, replacement: body, selection: NSRange(location: selection.location, length: body.utf16.count)), true)
        }
        if selection.location >= prefix, suffix <= text.length - end,
           text.substring(with: NSRange(location: selection.location - prefix, length: prefix)) == opening,
           text.substring(with: NSRange(location: end, length: suffix)) == closing {
            let start = selection.location - prefix
            return (Edit(range: NSRange(location: start, length: prefix + selection.length + suffix), replacement: inner,
                         selection: NSRange(location: start, length: selection.length)), true)
        }
        return (Edit(range: selection, replacement: opening + inner + closing,
                     selection: NSRange(location: selection.location + prefix, length: selection.length)), false)
    }

    private struct TableLine { let range: NSRange; let rule: Bool }

    private static func tableLines(in text: NSString) -> [TableLine] {
        let spans = MarkdownLiveSpans.spans(text as String).filter {
            $0.kind == .tableRow || $0.kind == .tableHeader || $0.kind == .tableRule
        }
        var result: [TableLine] = [], index = 0
        while index + 2 < spans.count {
            let row = spans[index], header = spans[index + 1], rule = spans[index + 2]
            guard row.kind == .tableRow, header.kind == .tableHeader, row.range == header.range, rule.kind == .tableRule else {
                index += 1; continue
            }
            let columns = MarkdownLiveSpans.tableCells(in: text, range: row.range).count
            result += [TableLine(range: row.range, rule: false), TableLine(range: rule.range, rule: true)]
            index += 3
            var previous = rule.range
            while index < spans.count, spans[index].kind == .tableRow,
                  text.lineRange(for: previous).upperBound == spans[index].range.location,
                  MarkdownLiveSpans.tableCells(in: text, range: spans[index].range).count == columns,
                  index + 1 == spans.count || spans[index + 1].kind != .tableHeader {
                previous = spans[index].range
                result.append(TableLine(range: previous, rule: false))
                index += 1
            }
        }
        return result
    }
}
