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
        // A visible selection inside an existing style must be edited by its
        // semantic mark, not by adjacent punctuation: '*' beside bold text is
        // part of '**', not evidence that Italic is already enabled.
        if selection.length > 0, let kind = styleKind(opening),
           spans.contains(where: { isStyle($0.kind) && NSIntersectionRange($0.range, selection).length > 0 }),
           !spans.contains(where: { $0.kind == .hidden && NSIntersectionRange($0.range, selection).length > 0 }) {
            return styledTextEdit(in: text, selection: selection, opening: opening, closing: closing, kind: kind, spans: spans)
        }
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
                        for range in editableParts(cellSelection(cell, selection: selection, in: text), excluding: protected, in: text) {
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

    public enum HighlightAction {
        case toggle
        case color(String)
        case remove
    }

    private static func styleKind(_ opening: String) -> MarkdownLiveSpans.Kind? {
        switch opening {
        case "**", "__": return .bold
        case "*", "_": return .italic
        case "<u>": return .underline
        case "~~": return .strike
        default: return nil
        }
    }

    private static func isStyle(_ kind: MarkdownLiveSpans.Kind) -> Bool {
        switch kind {
        case .bold, .italic, .underline, .strike, .highlight: return true
        default: return false
        }
    }

    private static func styledTextEdit(in text: NSString, selection: NSRange, opening: String, closing: String,
                                       kind: MarkdownLiveSpans.Kind, spans: [MarkdownLiveSpans.Span]) -> Edit? {
        guard !spans.contains(where: {
            ($0.kind == .code || $0.kind == .codeBlock) && NSIntersectionRange($0.range, selection).length > 0
        }) else { return nil }
        func coverage(_ spans: [MarkdownLiveSpans.Span], kind: MarkdownLiveSpans.Kind, selection: NSRange) -> IndexSet {
            var result = IndexSet()
            for span in spans where span.kind == kind {
                let overlap = NSIntersectionRange(span.range, selection)
                if overlap.length > 0 {
                    result.insert(integersIn: (overlap.location - selection.location)..<(overlap.upperBound - selection.location))
                }
            }
            return result
        }
        let current = coverage(spans, kind: kind, selection: selection)
        let edit: Edit
        if !current.isEmpty {
            // Partial removal needs to split the enclosing mark. Keep the source
            // intact until that operation can preserve every neighbouring style.
            guard current.count == selection.length,
                  spans.contains(where: { $0.kind == kind && $0.range == selection }),
                  selection.location >= opening.utf16.count,
                  closing.utf16.count <= text.length - selection.upperBound,
                  text.substring(with: NSRange(location: selection.location - opening.utf16.count, length: opening.utf16.count)) == opening,
                  text.substring(with: NSRange(location: selection.upperBound, length: closing.utf16.count)) == closing else { return nil }
            let start = selection.location - opening.utf16.count
            edit = Edit(range: NSRange(location: start, length: opening.utf16.count + selection.length + closing.utf16.count),
                        replacement: text.substring(with: selection), selection: NSRange(location: start, length: selection.length))
        } else {
            edit = Edit(range: selection, replacement: opening + text.substring(with: selection) + closing,
                        selection: NSRange(location: selection.location + opening.utf16.count, length: selection.length))
        }
        let result = text.replacingCharacters(in: edit.range, with: edit.replacement)
        let next = MarkdownLiveSpans.spans(result)
        guard MarkdownLiveSpans.plainText(result) == MarkdownLiveSpans.plainText(text as String) else { return nil }
        let resultingMark = coverage(next, kind: kind, selection: edit.selection)
        guard current.isEmpty ? resultingMark.count == selection.length : resultingMark.isEmpty else { return nil }
        // Preserve overlapping styles, including partial ones and named colors.
        for other in styleKinds(spans) where other != kind {
            guard coverage(spans, kind: other, selection: selection).isSubset(of: coverage(next, kind: other, selection: edit.selection)) else { return nil }
        }
        return edit
    }

    private static func styleKinds(_ spans: [MarkdownLiveSpans.Span]) -> [MarkdownLiveSpans.Kind] {
        var kinds: [MarkdownLiveSpans.Kind] = []
        for span in spans where isStyle(span.kind) && !kinds.contains(span.kind) { kinds.append(span.kind) }
        return kinds
    }

    /// Highlight visible text, leaving structural Markdown and existing inline
    /// code/links/other marks intact. A color is applied idempotently; Toggle
    /// removes an entirely yellow selection or applies yellow to mixed text.
    public static func highlightEdit(in text: NSString, selection: NSRange, action: HighlightAction) -> Edit? {
        guard selection.location >= 0, selection.length >= 0,
              selection.location <= text.length, selection.length <= text.length - selection.location else { return nil }
        if case .color(let color) = action {
            guard !color.isEmpty, color.utf8.allSatisfy({ (97...122).contains($0) }) else { return nil }
        }
        let spans = MarkdownLiveSpans.spans(text as String)
        let runs = spans.compactMap { span -> HighlightRun? in
            guard case .highlight(let color) = span.kind else { return nil }
            let opening = color.map { "<mark class=\"hl-\($0)\">" } ?? "=="
            let closing = color == nil ? "==" : "</mark>"
            let start = span.range.location - opening.utf16.count
            let length = opening.utf16.count + span.range.length + closing.utf16.count
            guard start >= 0, length <= text.length - start,
                  text.substring(with: NSRange(location: start, length: opening.utf16.count)) == opening,
                  text.substring(with: NSRange(location: span.range.upperBound, length: closing.utf16.count)) == closing else { return nil }
            return HighlightRun(outer: NSRange(location: start, length: length), inner: span.range, color: color)
        }
        if selection.length == 0 {
            if let run = runs.first(where: { NSLocationInRange(selection.location, $0.inner) }) {
                if case .color = action { return nil }
                return Edit(range: run.outer, replacement: text.substring(with: run.inner),
                            selection: NSRange(location: run.outer.location + selection.location - run.inner.location, length: 0))
            }
            if spans.contains(where: { span in
                guard NSLocationInRange(selection.location, span.range) else { return false }
                switch span.kind {
                case .hidden, .bold, .italic, .underline, .strike, .code, .codeBlock, .link, .wikilink, .image: return true
                default: return false
                }
            }) { return nil }
            if case .toggle = action {
                return edit(in: text, selection: selection, opening: "==", closing: "==")
            }
            return nil
        }
        let scopes = contentRanges(in: text, selection: selection)
        let protected = spans.compactMap { span -> NSRange? in
            switch span.kind {
            case .hidden:
                // A table escape belongs to its pipe, not to the structural
                // markup excluded from a newly highlighted cell.
                if span.range.length == 1, text.character(at: span.range.location) == 92,
                   span.range.upperBound < text.length, text.character(at: span.range.upperBound) == 124 { return nil }
                return span.range
            case .bold, .italic, .underline, .strike, .code, .codeBlock,
                 .link, .wikilink, .image, .bullet, .task, .calloutLabel, .rule, .structure:
                return span.range
            default: return nil
            }
        }
        let plain = scopes.flatMap { editableParts($0, excluding: protected + runs.map(\.outer), in: text) }
        let selectedRuns = runs.filter { run in scopes.contains { NSIntersectionRange($0, run.inner).length > 0 } }
        let removing: Bool
        let desiredColor: String?
        switch action {
        case .remove: removing = true; desiredColor = nil
        case .color(let color): removing = false; desiredColor = color
        case .toggle:
            removing = plain.isEmpty && !selectedRuns.isEmpty && selectedRuns.allSatisfy { $0.color == nil }
            desiredColor = nil
        }
        var edits: [Edit] = []
        for run in selectedRuns {
            guard removing || run.color != desiredColor else { continue }
            var selected = NSIntersectionRange(run.inner, selection)
            guard selected.length > 0 else { continue }
            let crossesProtectedRun = spans.contains { span in
                guard NSIntersectionRange(span.range, selected).length > 0 else { return false }
                switch span.kind {
                case .bold, .italic, .underline, .strike, .code, .link, .wikilink, .image: return true
                default: return false
                }
            }
            if crossesProtectedRun {
                var remainingVisible = IndexSet(integersIn: run.inner.location..<run.inner.upperBound)
                for span in spans where span.kind == .hidden {
                    remainingVisible.remove(integersIn: span.range.location..<span.range.upperBound)
                }
                remainingVisible.remove(integersIn: selected.location..<selected.upperBound)
                // Splitting through a code/link/style delimiter can put a new
                // highlight tag inside literal syntax. Whole visible runs can
                // safely include their hidden delimiters; partial ones wait for
                // the structural rich-mark edit path.
                guard remainingVisible.isEmpty else { continue }
                selected = run.inner
            }
            let before = text.substring(with: NSRange(location: run.inner.location, length: selected.location - run.inner.location))
            let after = text.substring(with: NSRange(location: selected.upperBound, length: run.inner.upperBound - selected.upperBound))
            let body = text.substring(with: selected)
            let left = highlighted(before, color: run.color)
            let middle = removing ? (source: body, body: NSRange(location: 0, length: selected.length)) : highlighted(body, color: desiredColor)
            let right = highlighted(after, color: run.color)
            let replacement = left.source + middle.source + right.source
            guard replacement != text.substring(with: run.outer) else { continue }
            edits.append(Edit(range: run.outer, replacement: replacement,
                              selection: NSRange(location: run.outer.location + left.source.utf16.count + middle.body.location,
                                                 length: middle.body.length)))
        }
        if !removing {
            for range in plain {
                let rendered = highlighted(text.substring(with: range), color: desiredColor)
                edits.append(Edit(range: range, replacement: rendered.source,
                                  selection: NSRange(location: range.location + rendered.body.location, length: rendered.body.length)))
            }
        }
        guard !edits.isEmpty else { return nil }
        let range = edits.reduce(selection) { NSUnionRange($0, $1.range) }
        let replacement = NSMutableString(string: text.substring(with: range))
        for edit in edits.sorted(by: { $0.range.location > $1.range.location }) {
            replacement.replaceCharacters(in: NSRange(location: edit.range.location - range.location, length: edit.range.length), with: edit.replacement)
        }
        func mapped(_ index: Int, end: Bool) -> Int {
            var delta = 0
            for edit in edits.sorted(by: { $0.range.location < $1.range.location }) {
                if index < edit.range.location { break }
                if index <= edit.range.upperBound {
                    return delta + (end ? edit.selection.upperBound : edit.selection.location)
                }
                delta += edit.replacement.utf16.count - edit.range.length
            }
            return index + delta
        }
        let start = mapped(selection.location, end: false)
        let end = mapped(selection.upperBound, end: true)
        return Edit(range: range, replacement: replacement as String,
                    selection: NSRange(location: start, length: max(0, end - start)))
    }

    private struct HighlightRun {
        let outer: NSRange
        let inner: NSRange
        let color: String?
    }

    private static func highlighted(_ source: String, color: String?) -> (source: String, body: NSRange) {
        let text = source as NSString
        guard let body = trimmed(NSRange(location: 0, length: text.length), in: text) else {
            return (source, NSRange(location: 0, length: text.length))
        }
        let opening = color.map { "<mark class=\"hl-\($0)\">" } ?? "=="
        let closing = color == nil ? "==" : "</mark>"
        let leading = text.substring(to: body.location)
        let trailing = text.substring(from: body.upperBound)
        return (leading + opening + text.substring(with: body) + closing + trailing,
                NSRange(location: leading.utf16.count + opening.utf16.count, length: body.length))
    }

    private static func contentRanges(in text: NSString, selection: NSRange) -> [NSRange] {
        let table = tableLines(in: text)
        var result: [NSRange] = [], position = selection.location
        while position < selection.upperBound {
            var lineEnd = 0, contentEnd = 0
            text.getLineStart(nil, end: &lineEnd, contentsEnd: &contentEnd, for: NSRange(location: position, length: 0))
            let line = text.lineRange(for: NSRange(location: position, length: 0))
            if let row = table.first(where: { $0.range.location == line.location }) {
                if !row.rule {
                    result += MarkdownLiveSpans.tableCells(in: text, range: row.range).map { cellSelection($0, selection: selection, in: text) }.filter { $0.length > 0 }
                }
            } else if contentEnd > position {
                result.append(NSIntersectionRange(NSRange(location: position, length: contentEnd - position), selection))
            }
            guard lineEnd > position else { break }
            position = lineEnd
        }
        return result
    }

    private static func cellSelection(_ cell: NSRange, selection: NSRange, in text: NSString) -> NSRange {
        let overlap = NSIntersectionRange(cell, selection)
        guard overlap.length > 0 else { return overlap }
        func escapedPipe(at pipe: Int) -> Bool {
            guard pipe < cell.upperBound, text.character(at: pipe) == 124 else { return false }
            var start = pipe
            while start > cell.location, text.character(at: start - 1) == 92 { start -= 1 }
            return (pipe - start) % 2 == 1
        }
        let start = escapedPipe(at: overlap.location) ? overlap.location - 1 : overlap.location
        let end = escapedPipe(at: overlap.upperBound) ? overlap.upperBound + 1 : overlap.upperBound
        return NSRange(location: start, length: end - start)
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
