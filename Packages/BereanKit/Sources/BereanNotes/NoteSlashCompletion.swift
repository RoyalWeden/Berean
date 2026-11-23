import Foundation

/// The original editor's "/" command trigger (pm/autocomplete.ts): a `/word` typed at the start
/// of a line or after whitespace, outside code. `range` covers "/" plus the query.
public struct NoteSlashCompletion: Equatable, Sendable {
    public let range: NSRange
    public let query: String
    public init(range: NSRange, query: String) { self.range = range; self.query = query }

    private static let trigger = try! NSRegularExpression(pattern: #"(?:^|(?<=\s))/(\w*)$"#)

    public static func detect(in text: String, selection: NSRange) -> Self? {
        let source = text as NSString
        guard selection.length == 0, selection.location >= 0, selection.location <= source.length else { return nil }
        var lineStart = 0, lineEnd = 0
        source.getLineStart(&lineStart, end: nil, contentsEnd: &lineEnd, for: NSRange(location: selection.location, length: 0))
        guard selection.location <= lineEnd else { return nil }
        let prefix = source.substring(with: NSRange(location: lineStart, length: selection.location - lineStart))
        guard let match = trigger.firstMatch(in: prefix, range: NSRange(location: 0, length: (prefix as NSString).length)),
              !prefix.hasPrefix("    "), !prefix.hasPrefix("\t"),
              !insideFence(source, before: lineStart),
              NoteInlineFormat.allowsParagraphStyle(in: source, selection: selection) else { return nil }
        let query = (prefix as NSString).substring(with: match.range(at: 1))
        let slash = match.range(at: 0)
        // The match may include no leading whitespace (lookbehind), so it starts at "/".
        return Self(range: NSRange(location: lineStart + slash.location, length: slash.length), query: query)
    }

    /// Validates the trigger is still in place and returns the edit replacing it.
    public func edit(in text: String, selection: NSRange, replacement: String, caretOffset: Int) -> NoteWikiLinkEdit? {
        let source = text as NSString
        guard range.location >= 0, range.location <= source.length,
              range.length >= 0, range.length <= source.length - range.location,
              source.substring(with: range) == "/" + query,
              selection.location == NSMaxRange(range), selection.length == 0 else { return nil }
        let caret = range.location + min(max(0, caretOffset), (replacement as NSString).length)
        return NoteWikiLinkEdit(range: range, replacement: replacement, selection: NSRange(location: caret, length: 0))
    }

    private static func insideFence(_ source: NSString, before location: Int) -> Bool {
        var fences = 0
        source.substring(to: location).enumerateLines { line, _ in
            if MarkdownLiveSpans.fence.firstMatch(in: line, range: NSRange(location: 0, length: line.utf16.count)) != nil { fences += 1 }
        }
        return fences % 2 == 1
    }
}

/// The original SLASH_COMMANDS that have a native equivalent (Columns, Thread and Study Trail
/// blocks are web-editor node types the native Markdown editors don't have).
public struct NoteSlashCommand: Identifiable, Equatable, Sendable {
    public enum Effect: Equatable, Sendable {
        case text(String, caret: Int)       // replace the trigger with Markdown
        case heading(Int)
        case list(String)                   // "bullet" | "numbered" | "checklist"
        case callout(String)                // note | tip | warning | important | caution
        case table
        case image
    }
    public let id: String
    public let label: String
    public let symbol: String
    public let effect: Effect

    public static let all: [NoteSlashCommand] = [
        .init(id: "text", label: "Text", symbol: "text.alignleft", effect: .text("", caret: 0)),
        .init(id: "h1", label: "Heading 1", symbol: "textformat.size.larger", effect: .heading(1)),
        .init(id: "h2", label: "Heading 2", symbol: "textformat.size", effect: .heading(2)),
        .init(id: "h3", label: "Heading 3", symbol: "textformat.size.smaller", effect: .heading(3)),
        .init(id: "bullet", label: "Bulleted list", symbol: "list.bullet", effect: .list("bullet")),
        .init(id: "numbered", label: "Numbered list", symbol: "list.number", effect: .list("numbered")),
        .init(id: "task", label: "Task list", symbol: "checklist", effect: .list("checklist")),
        .init(id: "quote", label: "Quote", symbol: "text.quote", effect: .text("> ", caret: 2)),
        .init(id: "code", label: "Code block", symbol: "chevron.left.forwardslash.chevron.right", effect: .text("```\n\n```", caret: 4)),
        .init(id: "table", label: "Table", symbol: "tablecells", effect: .table),
        .init(id: "image", label: "Image", symbol: "photo", effect: .image),
        .init(id: "divider", label: "Divider", symbol: "minus", effect: .text("---\n", caret: 4)),
        .init(id: "callout-note", label: "Note", symbol: "info.circle", effect: .callout("note")),
        .init(id: "callout-tip", label: "Tip", symbol: "lightbulb", effect: .callout("tip")),
        .init(id: "callout-warning", label: "Warning", symbol: "exclamationmark.triangle", effect: .callout("warning")),
        .init(id: "callout-important", label: "Important", symbol: "exclamationmark.circle", effect: .callout("important")),
        .init(id: "callout-caution", label: "Caution", symbol: "xmark.octagon", effect: .callout("caution")),
    ]

    /// Original filtering: the query matches the start of the id or any word of the label.
    public static func matching(_ query: String) -> [NoteSlashCommand] {
        let q = query.lowercased()
        guard !q.isEmpty else { return all }
        return all.filter { cmd in
            cmd.id.hasPrefix(q) || cmd.label.lowercased().split(separator: " ").contains { $0.hasPrefix(q) }
                || cmd.label.lowercased().hasPrefix(q)
        }
    }
}
