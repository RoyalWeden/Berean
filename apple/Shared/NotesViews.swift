import SwiftUI
import BereanCore
import BereanBible
import BereanNotes
import BereanReference
import BereanText
import UniformTypeIdentifiers

struct NoteRowView: View {
    let note: Note
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                Circle().fill(Color.noteColor(note.color)).frame(width: 8, height: 8)
                Text(note.displayTitle).font(.headline).lineLimit(1)
                if note.pinned { Image(systemName: "pin.fill").font(.caption2).foregroundStyle(.secondary) }
                Spacer()
                Text(Date(timeIntervalSince1970: Double(note.updatedAt) / 1000), format: .dateTime.month(.abbreviated).day()).font(.caption).foregroundStyle(.secondary)
            }
            if let ref = note.verseRef { Text(verseLabel(ref, note.textId)).font(.caption).foregroundStyle(.tint) }
            if !note.content.isEmpty { Text(noteExcerptText(note.content).prefix(200)).font(.callout).foregroundStyle(.secondary).lineLimit(2) }
        }
        .padding(.vertical, 2)
    }
}

/// Sharing is a reader-facing action; source-preserving Markdown has explicit export/copy actions.
func noteReadableShareText(title: String, content: String) -> String {
    let body = noteExcerptText(content).trimmingCharacters(in: .whitespacesAndNewlines)
    return body.isEmpty ? title : title + "\n\n" + body
}

func verseLabel(_ ref: String, _ textId: String) -> String { NoteAttachmentLabel.display(ref, textId: textId) }

extension Color {
    static func noteColor(_ name: String) -> Color {
        switch name { case "red": return .red; case "green": return .green; case "yellow": return .yellow; case "purple": return .purple; case "orange": return .orange; case "pink": return .pink; default: return .blue }
    }
}

private struct NoteLinkSuggestionSurface: ViewModifier {
    @ViewBuilder func body(content: Content) -> some View {
        if #available(macOS 26.0, iOS 26.0, *) {
            content.glassEffect(.regular, in: .rect(cornerRadius: 14))
        } else {
            content.background(.regularMaterial, in: .rect(cornerRadius: 14))
        }
    }
}

enum NoteWikiLinkCommand { case up, down, accept, dismiss }

struct NoteFormatRequest: Equatable {
    let id = UUID()
    enum Action: Equatable {
        case inline(String, String)
        case link(String, selection: NSRange?)
        case wikiLink(NoteWikiLinkCompletion, String)
        case referenceBlock(NoteReferenceCompletion, String)
        case highlight(String?)
        case removeHighlight
        case inlineCode
        case heading(Int)
        case list(NoteListStyle)
        case callout(NoteCalloutKind)
        case insertTable
        case insertImage(String)
        case addTableRow
        case addTableColumn
        case deleteTableRow
        case deleteTableColumn
        case deleteTable
    }

    let action: Action
}

func noteLinkEdit(in text: NSString, selection: NSRange, destination: String)
    -> (range: NSRange, replacement: String, selection: NSRange)? {
    guard selection.location != NSNotFound, NSMaxRange(selection) <= text.length else { return nil }
    let selected = text.substring(with: selection)
    let canUseSelection = !selected.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        && selected.rangeOfCharacter(from: .newlines) == nil && !selected.contains("]")
    let range = canUseSelection ? selection : NSRange(location: NSMaxRange(selection), length: 0)
    let label = canUseSelection ? selected : destination.replacingOccurrences(of: "]", with: "%5D")
    let replacement = "[\(label)](\(destination))"
    return (range, replacement, NSRange(location: range.location + (replacement as NSString).length, length: 0))
}

/// TextKit selections and Markdown delimiter positions both use UTF-16 offsets.
func noteFormatEdit(in text: NSString, selection: NSRange, opening: String, closing: String)
    -> (range: NSRange, replacement: String, selection: NSRange)? {
    guard let edit = NoteInlineFormat.edit(in: text, selection: selection, opening: opening, closing: closing) else { return nil }
    return (edit.range, edit.replacement, edit.selection)
}

func noteInlineCodeEdit(in text: NSString, selection: NSRange)
    -> (range: NSRange, replacement: String, selection: NSRange)? {
    guard selection.location <= text.length, selection.length <= text.length - selection.location else { return nil }
    let selected = text.substring(with: selection)
    guard selected.rangeOfCharacter(from: .newlines) == nil else { return nil }
    let line = text.lineRange(for: NSRange(location: selection.location, length: 0))
    let source = text.substring(with: line)
    for span in MarkdownLiveSpans.spans(source) {
        guard case .code = span.kind else { continue }
        let body = NSRange(location: line.location + span.range.location, length: span.range.length)
        guard body == selection else {
            if NSIntersectionRange(body, selection).length > 0 || NSLocationInRange(selection.location, body) { return nil }
            continue
        }
        var start = body.location
        while start > line.location, text.character(at: start - 1) == 96 { start -= 1 }
        let delimiterLength = body.location - start
        guard delimiterLength > 0, NSMaxRange(body) + delimiterLength <= NSMaxRange(line) else { return nil }
        let delimiter = String(repeating: "`", count: delimiterLength)
        guard text.substring(with: NSRange(location: NSMaxRange(body), length: delimiterLength)) == delimiter else { return nil }
        let inner = selected.hasPrefix(" ") && selected.hasSuffix(" ") ? String(selected.dropFirst().dropLast()) : selected
        let content = inner.hasPrefix("`") || inner.hasSuffix("`") ? inner : selected
        return (NSRange(location: start, length: body.length + 2 * delimiterLength),
                content, NSRange(location: start, length: content.utf16.count))
    }
    // Adjacent backticks need padding to keep the opening and closing runs distinct.
    let ticks = try! NSRegularExpression(pattern: "`+")
    let length = ticks.matches(in: selected, range: NSRange(location: 0, length: selection.length)).map(\.range.length).max() ?? 0
    let delimiter = String(repeating: "`", count: length + 1)
    let pad = selected.hasPrefix("`") || selected.hasSuffix("`") ? " " : ""
    return (selection, delimiter + pad + selected + pad + delimiter,
            NSRange(location: selection.location + delimiter.utf16.count, length: selection.length + 2 * pad.utf16.count))
}

func noteHighlightEdit(in text: NSString, selection: NSRange, color: String?)
    -> (range: NSRange, replacement: String, selection: NSRange)? {
    let action = color.map(NoteInlineFormat.HighlightAction.color) ?? .toggle
    guard let edit = NoteInlineFormat.highlightEdit(in: text, selection: selection, action: action) else { return nil }
    return (edit.range, edit.replacement, edit.selection)
}

func noteRemoveHighlightEdit(in text: NSString, selection: NSRange)
    -> (range: NSRange, replacement: String, selection: NSRange)? {
    guard let edit = NoteInlineFormat.highlightEdit(in: text, selection: selection, action: .remove) else { return nil }
    return (edit.range, edit.replacement, edit.selection)
}

func noteHeadingEdit(in text: NSString, selection: NSRange, level: Int)
    -> (range: NSRange, replacement: String, selection: NSRange)? {
    guard (0...3).contains(level), NoteInlineFormat.allowsParagraphStyle(in: text, selection: selection) else { return nil }
    // A selection ending at the start of the next line does not include that line.
    let covered = NSRange(location: selection.location, length: max(0, selection.length - 1))
    let range = text.lineRange(for: covered)
    let prefix = level == 0 ? "" : String(repeating: "#", count: level) + " "
    let lines = text.substring(with: range).components(separatedBy: "\n")
    let replacement = lines.map { line in
        if line.isEmpty, lines.count > 1 { return line }
        let body = line.replacingOccurrences(of: #"^#{1,6}(?:[ \t]+|$)"#, with: "", options: .regularExpression)
        return prefix + body
    }.joined(separator: "\n")
    guard replacement != text.substring(with: range) else { return nil }
    if selection.length == 0 {
        let content = replacement.trimmingCharacters(in: .newlines)
        return (range, replacement, NSRange(location: range.location + content.utf16.count, length: 0))
    }
    let length = replacement.utf16.count - (replacement.hasSuffix("\n") ? 1 : 0)
    return (range, replacement, NSRange(location: range.location, length: length))
}

func noteCalloutEdit(in text: NSString, selection: NSRange, kind: NoteCalloutKind)
    -> (range: NSRange, replacement: String, selection: NSRange)? {
    guard NoteInlineFormat.allowsParagraphStyle(in: text, selection: selection) else { return nil }
    guard selection.location <= text.length,
          selection.length <= text.length - selection.location else { return nil }
    let covered = NSRange(location: selection.location, length: max(0, selection.length - 1))
    var start = 0, end = 0, contentEnd = 0
    text.getLineStart(&start, end: &end, contentsEnd: &contentEnd, for: covered)
    let range = NSRange(location: start, length: contentEnd - start)
    let lines = text.substring(with: range).replacingOccurrences(of: "\r\n", with: "\n")
        .components(separatedBy: "\n")
    let header = "> [!\(kind.rawValue.uppercased())]\n"
    let body = lines.map { "> " + $0 }.joined(separator: "\n")

    // Keep the new block separate from neighboring paragraphs and quotes.
    let leading = start > 0 ? "\n" : ""
    let trailing = end < text.length ? "\n" : ""
    let replacement = leading + header + body + trailing
    let bodyStart = start + leading.utf16.count + header.utf16.count
    let cursor = selection.length == 0
        ? NSRange(location: bodyStart + body.utf16.count, length: 0)
        : NSRange(location: bodyStart, length: body.utf16.count)
    return (range, replacement, cursor)
}

enum NoteListStyle: CaseIterable {
    case bullet, numbered, checklist

    var title: String {
        switch self {
        case .bullet: "Bullet List"
        case .numbered: "Numbered List"
        case .checklist: "Checklist"
        }
    }

    var symbol: String {
        switch self {
        case .bullet: "list.bullet"
        case .numbered: "list.number"
        case .checklist: "checklist"
        }
    }

    var markerPattern: String {
        switch self {
        case .bullet: #"^[-+*] (?!\[[ xX]\] )"#
        case .numbered: #"^\d+[.)] "#
        case .checklist: #"^[-+*] \[([ xX])\] "#
        }
    }
}

func noteListEdit(in text: NSString, selection: NSRange, style: NoteListStyle)
    -> (range: NSRange, replacement: String, selection: NSRange)? {
    guard NoteInlineFormat.allowsParagraphStyle(in: text, selection: selection) else { return nil }
    let range = text.lineRange(for: NSRange(location: selection.location, length: max(0, selection.length - 1)))
    let original = text.substring(with: range)
    let lines = original.components(separatedBy: "\n")
    let bodies = lines.map { String($0.drop(while: { $0 == " " || $0 == "\t" })) }
    let populated = bodies.filter { !$0.isEmpty }
    let remove = !populated.isEmpty && populated.allSatisfy {
        $0.range(of: style.markerPattern, options: .regularExpression) != nil
    }
    let marker = #"^(?:[-+*] \[[ xX]\] |[-+*] |\d+[.)] )"#
    var number = 0
    let replacement = zip(lines, bodies).map { line, body in
        if body.isEmpty, lines.count > 1 { return line }
        let indent = line.prefix(line.count - body.count)
        let content = body.replacingOccurrences(of: marker, with: "", options: .regularExpression)
        number += 1
        let prefix: String
        switch style {
        case .bullet: prefix = "- "
        case .numbered: prefix = "\(number). "
        case .checklist: prefix = body.range(of: #"^[-+*] \[[xX]\] "#, options: .regularExpression) == nil ? "- [ ] " : "- [x] "
        }
        return indent + (remove ? "" : prefix) + content
    }.joined(separator: "\n")
    guard replacement != original else { return nil }
    let length = replacement.utf16.count - (replacement.hasSuffix("\n") ? 1 : 0)
    let resultSelection = selection.length == 0
        ? NSRange(location: range.location + length, length: 0)
        : NSRange(location: range.location, length: length)
    return (range, replacement, resultSelection)
}

/// Insert the same two-column Markdown block used by the legacy editor.
func noteTableInsertion(in text: NSString, selection: NSRange)
    -> (range: NSRange, replacement: String, selection: NSRange)? {
    guard NoteInlineFormat.allowsParagraphStyle(in: text, selection: selection) else { return nil }
    var lineStart = 0
    var contentsEnd = 0
    text.getLineStart(&lineStart, end: nil, contentsEnd: &contentsEnd,
                      for: NSRange(location: NSMaxRange(selection), length: 0))
    let line = text.substring(with: NSRange(location: lineStart, length: contentsEnd - lineStart))
    let emptyLine = line.trimmingCharacters(in: .whitespaces).isEmpty
    let offset = emptyLine ? lineStart : contentsEnd
    let length = emptyLine ? contentsEnd - lineStart : 0
    let newline = text.range(of: "\r\n").location == NSNotFound ? "\n" : "\r\n"
    let prefix: String
    if !emptyLine {
        prefix = newline + newline
    } else if offset == 0 {
        prefix = ""
    } else {
        let previousLine = text.lineRange(for: NSRange(location: offset - 1, length: 0))
        let previous = text.substring(with: previousLine)
        prefix = previous.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "" : newline
    }
    let suffix = contentsEnd < text.length ? newline : newline + newline
    let table = ["|  |  |", "| --- | --- |", "|  |  |"].joined(separator: newline)
    return (NSRange(location: offset, length: length), prefix + table + suffix,
            NSRange(location: offset + prefix.utf16.count + 2, length: 0))
}

func noteTableContext(in text: NSString, selection: NSRange)
    -> (block: [MarkdownLiveSpans.Span], row: Int)? {
    guard selection.location <= text.length, selection.length <= text.length - selection.location else { return nil }
    let selectedLine = text.lineRange(for: selection)
    guard selectedLine.length > 0, text.character(at: selectedLine.location) == 124 else { return nil }
    let spans = MarkdownLiveSpans.spans(text as String)
    let headers = Set(spans.lazy.filter { $0.kind == .tableHeader }.map(\.range.location))
    var block: [MarkdownLiveSpans.Span] = []
    var columns = 0
    for span in spans where span.kind == .tableRow || span.kind == .tableRule {
        let startsTable = headers.contains(span.range.location)
        let cellCount = MarkdownLiveSpans.tableCells(in: text, range: span.range).count
        let fitsTable = span.kind == .tableRow
            ? cellCount > 0 && cellCount <= columns
            : block.count == 1 && cellCount == columns
        if let last = block.last, startsTable || !fitsTable
            || text.lineRange(for: last.range).upperBound != span.range.location {
            if block.contains(where: { $0.range.location == selectedLine.location }) { break }
            block.removeAll(keepingCapacity: true)
        }
        if startsTable { columns = cellCount }
        if startsTable || !block.isEmpty { block.append(span) }
    }
    guard block.count >= 2, block[0].kind == .tableRow, block[1].kind == .tableRule,
          let row = block.firstIndex(where: { $0.kind == .tableRow && $0.range.location == selectedLine.location }) else {
        return nil
    }
    guard selection.upperBound <= block[row].range.upperBound else { return nil }
    return (block, row)
}

func noteTableRowInsertion(in text: NSString, selection: NSRange)
    -> (range: NSRange, replacement: String, selection: NSRange)? {
    guard let (block, row) = noteTableContext(in: text, selection: selection) else { return nil }
    let columns = MarkdownLiveSpans.tableCells(in: text, range: block[0].range).count
    guard columns > 0 else { return nil }
    // A new body row goes below the alignment rule when the caret is in the header.
    let anchor = block[row == 0 ? 1 : row].range
    let rule = block[1].range
    let ruleEnd = text.lineRange(for: rule).upperBound
    let separator = text.substring(with: NSRange(location: rule.upperBound, length: ruleEnd - rule.upperBound))
    let newline = separator.isEmpty ? "\n" : separator
    let replacement = newline + "|" + String(repeating: "  |", count: columns)
    return (NSRange(location: anchor.upperBound, length: 0), replacement,
            NSRange(location: anchor.upperBound + newline.utf16.count + 2, length: 0))
}

func noteTableColumnInsertion(in text: NSString, selection: NSRange)
    -> (range: NSRange, replacement: String, selection: NSRange)? {
    guard let (block, row) = noteTableContext(in: text, selection: selection),
          let first = block.first, let last = block.last else { return nil }
    let rows = block.map { MarkdownLiveSpans.tableCells(in: text, range: $0.range) }
    let width = rows[0].count
    guard rows[1].count == width,
          rows.allSatisfy({ !$0.isEmpty && $0.count <= width }),
          let column = rows[row].firstIndex(where: {
              $0.location <= selection.location && selection.upperBound <= $0.upperBound
          }) else { return nil }

    let range = NSRange(location: first.range.location, length: last.range.upperBound - first.range.location)
    let replacement = NSMutableString(string: text.substring(with: range))
    var caret = 0
    for index in rows.indices.reversed() {
        let cells = rows[index]
        let delimiter = cells[min(column, cells.count - 1)].upperBound
        let gap = max(0, column + 1 - cells.count)
        let inserted = String(repeating: "  |", count: gap) + (index == 1 ? " --- |" : "  |")
        let offset = delimiter + 1 - range.location
        replacement.insert(inserted, at: offset)
        if index == row {
            caret = range.location + offset + gap * 3 + 1
        } else if index < row {
            caret += inserted.utf16.count
        }
    }
    return (range, replacement as String, NSRange(location: caret, length: 0))
}

func noteWholeTableDeletion(in text: NSString, selection: NSRange)
    -> (range: NSRange, replacement: String, selection: NSRange)? {
    guard let (block, _) = noteTableContext(in: text, selection: selection),
          let first = block.first, let last = block.last,
          block.dropFirst(2).allSatisfy({ $0.kind == .tableRow }) else { return nil }
    let width = MarkdownLiveSpans.tableCells(in: text, range: first.range).count
    guard width > 0, MarkdownLiveSpans.tableCells(in: text, range: block[1].range).count == width else { return nil }
    let start = first.range.location
    let end = text.lineRange(for: last.range).upperBound
    let range = NSRange(location: start, length: end - start)
    return (range, "", NSRange(location: start, length: 0))
}

func noteTableDeletion(in text: NSString, selection: NSRange, columnOnly: Bool)
    -> (range: NSRange, replacement: String, selection: NSRange)? {
    guard let (block, row) = noteTableContext(in: text, selection: selection),
          let first = block.first, let last = block.last else { return nil }
    let rows = block.map { MarkdownLiveSpans.tableCells(in: text, range: $0.range) }
    guard let column = rows[row].firstIndex(where: {
        $0.location <= selection.location && selection.upperBound <= $0.upperBound
    }) else { return nil }

    if !columnOnly {
        guard row > 1 else { return nil }
        let range = text.lineRange(for: block[row].range)
        let previous = rows[row == 2 ? 0 : row - 1]
        guard !previous.isEmpty else { return nil }
        let cell = previous[min(column, previous.count - 1)]
        return (range, "", NSRange(location: noteTableCellCaret(in: text, cell: cell), length: 0))
    }

    let width = rows[0].count
    guard width > 1, rows[1].count == width,
          rows.allSatisfy({ !$0.isEmpty && $0.count <= width }) else { return nil }
    let range = NSRange(location: first.range.location, length: last.range.upperBound - first.range.location)
    let replacement = NSMutableString(string: text.substring(with: range))
    var caret = 0
    for index in rows.indices.reversed() {
        let cells = rows[index]
        guard cells.indices.contains(column) else { continue }
        let cell = cells[column]
        let offset = cell.location - range.location
        if cells.count == 1 {
            // A short body row still needs one empty cell after its only explicit cell is removed.
            replacement.replaceCharacters(in: NSRange(location: offset, length: cell.length), with: "  ")
        } else {
            replacement.deleteCharacters(in: NSRange(location: offset, length: cell.length + 1))
        }
        if index == row {
            if cells.count == 1 {
                caret = cell.location + 1
            } else if column + 1 < cells.count {
                caret = noteTableCellCaret(in: text, cell: cells[column + 1]) - cell.length - 1
            } else {
                caret = noteTableCellCaret(in: text, cell: cells[column - 1])
            }
        } else if index < row {
            caret += cells.count == 1 ? 2 - cell.length : -cell.length - 1
        }
    }
    return (range, replacement as String, NSRange(location: caret, length: 0))
}

/// Navigate the cells of the pipe tables written by the Electron and native editors.
func noteTableCellDestination(in text: NSString, selection: NSRange, backwards: Bool) -> NSRange? {
    guard let (block, row) = noteTableContext(in: text, selection: selection) else { return nil }
    let current = MarkdownLiveSpans.tableCells(in: text, range: block[row].range)
    guard let column = current.firstIndex(where: {
        $0.location <= selection.location && selection.upperBound <= $0.upperBound
    }) else { return nil }

    let nextColumn = column + (backwards ? -1 : 1)
    let target: NSRange
    if current.indices.contains(nextColumn) {
        target = current[nextColumn]
    } else {
        let nextRow = backwards ? (row == 2 ? 0 : row - 1) : (row == 0 ? 2 : row + 1)
        guard block.indices.contains(nextRow), block[nextRow].kind == .tableRow else { return nil }
        let nextCells = MarkdownLiveSpans.tableCells(in: text, range: block[nextRow].range)
        guard let cell = backwards ? nextCells.last : nextCells.first else { return nil }
        target = cell
    }
    return NSRange(location: noteTableCellCaret(in: text, cell: target), length: 0)
}

private func noteTableCellCaret(in text: NSString, cell: NSRange) -> Int {
    var caret = cell.location
    while caret < cell.upperBound {
        let character = text.character(at: caret)
        guard character == 9 || character == 32 else { break }
        caret += 1
    }
    if caret == cell.upperBound, caret > cell.location { caret -= 1 }
    return caret
}

/// A link on the visible checkbox routes activation through the native text editor.
enum NoteTaskLink {
    static let scheme = "berean-note-task"

    static func url(for marker: NSRange) -> URL {
        URL(string: "\(scheme):\(marker.location)")!
    }

    static func edit(for url: URL, in text: NSString) -> (range: NSRange, replacement: String)? {
        guard url.scheme == scheme, let location = Int(url.absoluteString.dropFirst(scheme.count + 1)),
              location >= 0, text.length >= 3, location <= text.length - 3 else { return nil }
        let marker = text.substring(with: NSRange(location: location, length: 3))
        switch marker {
        case "[ ]": return (NSRange(location: location + 1, length: 1), "x")
        case "[x]", "[X]": return (NSRange(location: location + 1, length: 1), " ")
        default: return nil
        }
    }
}

/// Return continues a Markdown list item or quote, and removes one level on an empty line.
func noteBlockReturnEdit(in text: NSString, selection: NSRange)
    -> (range: NSRange, replacement: String, selection: NSRange)? {
    guard selection.length == 0, selection.location <= text.length else { return nil }
    var start = 0, end = 0, contentEnd = 0
    text.getLineStart(&start, end: &end, contentsEnd: &contentEnd, for: selection)
    guard selection.location == contentEnd else { return nil }
    let line = text.substring(with: NSRange(location: start, length: contentEnd - start))
    let quoteRange = line.range(of: #"^(?:[ \t]*> ?)+"#, options: .regularExpression)
    let quote = quoteRange.map { String(line[$0]) } ?? ""
    let afterQuote = line.dropFirst(quote.count)
    let indent = String(afterQuote.prefix { $0 == " " || $0 == "\t" })
    let body = String(afterQuote.dropFirst(indent.count))
    let pattern = #"^(?:[-+*] \[[ xX]\] |[-+*] |[0-9]+[.)] )"#
    guard let markerRange = body.range(of: pattern, options: .regularExpression) else {
        guard let lastMarker = quote.lastIndex(of: ">") else { return nil }
        if body.allSatisfy(\.isWhitespace) {
            let outer = String(quote[..<lastMarker])
            // An empty line separates the following paragraph from a top-level quote.
            let replacement = outer.contains(">") ? outer : "\n"
            return (NSRange(location: start, length: contentEnd - start), replacement,
                    NSRange(location: start + replacement.utf16.count, length: 0))
        }
        let replacement = "\n" + quote
        return (selection, replacement, NSRange(location: contentEnd + replacement.utf16.count, length: 0))
    }
    let marker = String(body[markerRange])
    let remainder = body[markerRange.upperBound...]
    if remainder.allSatisfy(\.isWhitespace) {
        return (NSRange(location: start, length: contentEnd - start), quote,
                NSRange(location: start + quote.utf16.count, length: 0))
    }
    let next: String
    if marker.contains("[") {
        next = String(marker.prefix(2)) + "[ ] "
    } else if let number = Int(String(marker.dropLast(2))), number < Int.max {
        next = String(number + 1) + marker.suffix(2)
    } else {
        next = marker
    }
    let replacement = "\n" + quote + indent + next
    return (selection, replacement, NSRange(location: contentEnd + replacement.utf16.count, length: 0))
}

/// Presents the system print preview for the same Markdown structure used by Notes previews.
@MainActor func printNote(title: String, body: String) {
    let markup = NotePrintMarkup.document(title: title, body: body)
    // Let the originating menu dismiss before the system presents its print panel.
    DispatchQueue.main.async {
        #if os(macOS)
        let printInfo = NSPrintInfo.shared.copy() as? NSPrintInfo ?? NSPrintInfo.shared
        printInfo.isVerticallyCentered = false
        let width = max(1, printInfo.paperSize.width - printInfo.leftMargin - printInfo.rightMargin)
        let view = NSTextView(frame: NSRect(x: 0, y: 0, width: width, height: 1))
        view.isVerticallyResizable = true
        view.isHorizontallyResizable = false
        view.textContainer?.widthTracksTextView = true
        view.textContainer?.lineFragmentPadding = 0
        let formatted = try? NSAttributedString(data: Data(markup.utf8), options: [
            .documentType: NSAttributedString.DocumentType.html,
            .characterEncoding: String.Encoding.utf8.rawValue
        ], documentAttributes: nil)
        if let formatted { view.textStorage?.setAttributedString(formatted) }
        else { view.string = ([title, body].filter { !$0.isEmpty }).joined(separator: "\n\n") }
        if let container = view.textContainer, let layout = view.layoutManager {
            container.containerSize = NSSize(width: width, height: .greatestFiniteMagnitude)
            layout.ensureLayout(for: container)
            let height = ceil(layout.usedRect(for: container).maxY + 2 * view.textContainerInset.height)
            view.setFrameSize(NSSize(width: width, height: max(1, height)))
        }
        let op = NSPrintOperation(view: view, printInfo: printInfo)
        op.jobTitle = title.isEmpty ? "Note" : title
        if let window = NSApp.keyWindow ?? NSApp.mainWindow {
            op.runModal(for: window, delegate: nil, didRun: nil, contextInfo: nil)
        } else {
            op.run()
        }
        #else
        let controller = UIPrintInteractionController.shared
        let info = UIPrintInfo(dictionary: nil)
        info.jobName = title.isEmpty ? "Note" : title
        info.outputType = .general
        controller.printInfo = info
        controller.printFormatter = UIMarkupTextPrintFormatter(markupText: markup)
        controller.present(animated: true)
        #endif
    }
}

/// One note with a native rich editor and version history.
struct NoteDetailView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    let noteId: String
    var performDestination: ((@escaping () -> Void) -> Void)?
    @State private var note: Note?
    @State private var title = ""
    @State private var formatRequest: NoteFormatRequest?
    @State private var editingTable = false
    @State private var content = ""
    @State private var saveTask: Task<Void, Never>?
    @State private var snapshotTask: Task<Void, Never>?
    /// Content of the last version snapshot (or as opened) — a snapshot is only taken after edits.
    @State private var lastSnapshot: String?
    @State private var loadedId: String?
    @State private var showingHistory = false
    #if os(macOS)
    @State private var shareRequest: NativeShareRequest?
    #endif
    @State private var confirmingTrash = false
    @State private var choosingNoteIcon = false
    @State private var noteIconInput = ""
    @State private var insertingReference = false
    @State private var insertingLink = false
    @State private var linkInput = ""
    @State private var linkSelection: NSRange?
    @State private var wikiLinkQuery: NoteWikiLinkCompletion?
    @State private var dismissedWikiLinkQuery: NoteWikiLinkCompletion?
    @State private var wikiLinkTargets: [NoteWikiLinkTarget] = []
    @State private var wikiLinkSelection = 0
    @State private var wikiLinkAnchor = CGRect.zero
    @State private var wikiLinkPreview: Note?
    @State private var referenceCompletion: NoteReferenceCompletion?
    @State private var dismissedReferenceCompletion: NoteReferenceCompletion?
    private struct PreparedReference {
        let completion: NoteReferenceCompletion
        let label: String
        let replacement: String
    }
    @State private var preparedReference: PreparedReference?
    @State private var scriptureBlocks: [NoteScriptureBlock] = []
    @State private var verifiedScriptureInput: ScriptureBlockInput?
    @State private var scriptureRatios: [ScriptureRatioKey: Double] = [:]
    private struct ScriptureRatioKey: Hashable {
        let block: String
        let text: String
        let hermas: String
        let replacer: String
    }
    private struct ScriptureBlockInput: Equatable, Sendable {
        let noteID: String
        let content: String
        let textID: String
        let defaultText: String
        let hermas: HermasText
        let replacer: Bool
        let replacerKey: String
        let enabled: Bool
        let threshold: Double
        let catalogCount: Int

        func matchesContext(_ other: Self) -> Bool {
            noteID == other.noteID && textID == other.textID && defaultText == other.defaultText
                && hermas == other.hermas && replacer == other.replacer && replacerKey == other.replacerKey && enabled == other.enabled
                && threshold == other.threshold && catalogCount == other.catalogCount
        }
    }
    private var scriptureBlockInput: ScriptureBlockInput {
        .init(noteID: noteId, content: content, textID: note?.textId ?? app.defaultText,
              defaultText: app.defaultText,
              hermas: HermasText(rawValue: note?.textId ?? "") ?? app.hermasEdition,
              replacer: app.wordReplacerEnabled, replacerKey: app.wordReplacerKey,
              enabled: app.noteScriptureBlock, threshold: app.noteScriptureBlockThreshold,
              catalogCount: app.bookCatalog.count)
    }
    private var visibleScriptureBlocks: [NoteScriptureBlock] {
        guard app.noteScriptureBlock,
              verifiedScriptureInput?.matchesContext(scriptureBlockInput) == true else { return [] }
        return scriptureBlocks
    }
    @FocusState private var focus: Field?
    enum Field { case title, body }

    private func dailyHeader(_ note: Note) -> String? {
        guard note.type == "daily" || note.type == "journal", let key = NotesService.dailyDateKey(note.title) else { return nil }
        return NotesService.dailyDisplayTitle(key)
    }

    var body: some View {
        Group {
            if let note {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        if let icon = note.icon { Text(icon).font(.largeTitle).accessibilityHidden(true) }
                        if let daily = dailyHeader(note) {
                            // A daily note's stored title ("Daily — 2026-11-14") is its calendar key; show the date
                            // instead and keep it read-only so renaming can't detach the note from its day.
                            Text(daily).font(.largeTitle.bold()).textSelection(.enabled)
                                .accessibilityAddTraits(.isHeader)
                        } else {
                            TextField("Untitled", text: Binding(get: { title }, set: { value in
                                // Wrap visually, while keeping the existing single-line title format.
                                title = value.split(whereSeparator: \.isNewline).joined(separator: " ")
                            }), axis: .vertical)
                                .font(.largeTitle.bold()).textFieldStyle(.plain)
                                .lineLimit(1...5)
                                .focused($focus, equals: .title)
                                .submitLabel(.next)
                                .onSubmit { focus = .body }
                                .onKeyPress(.return) { focus = .body; return .handled }
                                .onChange(of: title) { scheduleSave() }
                        }
                    }
                    if note.type == "idiom" { IdiomHeader(note: note) }
                    if let ref = note.verseRef {
                        let attachments = ref.split(separator: ",").compactMap { part -> ResolvedPassage? in
                            guard let link = Reference.parseNoteAttachment(String(part)) else { return nil }
                            return ResolvedPassage(textId: note.textId, bookId: link.bookId, chapter: link.chapter,
                                                   verse: link.verse, endVerse: link.endVerse)
                        }
                        if let passage = attachments.first, attachments.count == 1 {
                            Button { followAttachment(passage) } label: {
                                Label(verseLabel(ref, note.textId), systemImage: "book")
                                    .font(.subheadline.weight(.medium))
                                    .foregroundStyle(Color.accentColor)
                                    .padding(.vertical, 6)
                                    .contentShape(.rect)
                            }
                            .buttonStyle(.interactivePlain)
                            .accessibilityLabel("Open \(verseLabel(ref, note.textId)) in Scripture")
                            .help("Open in Scripture")
                        } else if !attachments.isEmpty {
                            Menu {
                                ForEach(attachments.indices, id: \.self) { index in
                                    let passage = attachments[index]
                                    Button(passage.label, systemImage: "book") { followAttachment(passage) }
                                }
                            } label: {
                                Label("Scripture Attachments", systemImage: "book")
                            }
                        }
                    }
                    noteEditor
                        .overlay(alignment: .topLeading) { wikiLinkSuggestions }
                        .overlay(alignment: .topLeading) { referenceSuggestion }
                        .task(id: referenceCompletion) { await prepareReference() }
                        .task(id: scriptureBlockInput) { await prepareScriptureBlocks(scriptureBlockInput) }
                }
                .onChange(of: content) { scheduleSave(); scheduleSnapshot() }
                .frame(maxWidth: 720, alignment: .leading)
                .padding(.horizontal, 20)
                .padding(.top, 20)
                .frame(maxWidth: .infinity)
            } else {
                ContentUnavailableView("Note not found", systemImage: "note.text")
            }
        }
        .navigationTitle(note.flatMap(dailyHeader) ?? (title.isEmpty ? "Untitled" : title))
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItemGroup {
                if let performDestination {
                    Button("Open in Notes", systemImage: "arrow.up.right.square") {
                        saveNow()
                        performDestination { app.openNote(noteId) }
                    }
                } else {
                    Button { saveNow(); app.returnToNotesList() } label: { Label(app.notesListReturnTitle, systemImage: "chevron.backward") }
                        .help("Back to \(app.notesListReturnTitle)")
                }
            }
            #if os(macOS)
            if #available(macOS 26.0, *) { ToolbarSpacer(.fixed) }
            #endif
            if let note {
                ToolbarItemGroup {
                    Menu {
                        Section("Paragraph") {
                            Button("Body") { formatRequest = NoteFormatRequest(action: .heading(0)) }
                                .keyboardShortcut("0", modifiers: [.command, .option])
                                .disabled(editingTable)
                            ForEach(1...3, id: \.self) { level in
                                Button("Heading \(level)") { formatRequest = NoteFormatRequest(action: .heading(level)) }
                                    .keyboardShortcut(KeyEquivalent(Character(String(level))), modifiers: [.command, .option])
                                    .disabled(editingTable)
                            }
                        }
                        Section("Lists") {
                            ForEach(NoteListStyle.allCases, id: \.self) { style in
                                Button(style.title, systemImage: style.symbol) {
                                    formatRequest = NoteFormatRequest(action: .list(style))
                                }
                                .disabled(editingTable)
                            }
                        }
                        tableMenu
                        formatButton("Bold", symbol: "bold", prefix: "**", suffix: "**")
                            .keyboardShortcut("b", modifiers: .command)
                        formatButton("Italic", symbol: "italic", prefix: "*", suffix: "*")
                            .keyboardShortcut("i", modifiers: .command)
                        formatButton("Underline", symbol: "underline", prefix: "<u>", suffix: "</u>")
                            .keyboardShortcut("u", modifiers: .command)
                        formatButton("Strikethrough", symbol: "strikethrough", prefix: "~~", suffix: "~~")
                            .keyboardShortcut("x", modifiers: [.command, .shift])
                        Button("Inline Code", systemImage: "chevron.left.forwardslash.chevron.right") {
                            formatRequest = NoteFormatRequest(action: .inlineCode)
                        }
                        Menu("Highlight", systemImage: "highlighter") {
                            Button("Default", systemImage: "highlighter") {
                                formatRequest = NoteFormatRequest(action: .highlight(nil))
                            }
                            .keyboardShortcut("h", modifiers: [.command, .shift])
                            ForEach(highlightColors + ["orange"], id: \.self) { color in
                                Button {
                                    formatRequest = NoteFormatRequest(action: .highlight(color))
                                } label: {
                                    Label {
                                        Text(color.capitalized)
                                    } icon: {
                                        Image(systemName: "circle.fill").foregroundStyle(Color.highlight(color))
                                    }
                                }
                            }
                            Divider()
                            Button("Remove Highlight", systemImage: "eraser") {
                                formatRequest = NoteFormatRequest(action: .removeHighlight)
                            }
                        }
                    } label: {
                        Label("Format", systemImage: "textformat")
                    }
                    .menuIndicator(.hidden)
                    .help("Format selected note text")
                    #if os(macOS)
                    Button("Checklist", systemImage: "checklist") {
                        formatRequest = NoteFormatRequest(action: .list(.checklist))
                    }
                    .labelStyle(.iconOnly).help("Make a checklist")
                    .disabled(editingTable)
                    tableMenu
                        .labelStyle(.iconOnly)
                        .help(editingTable ? "Edit table rows and columns" : "Insert a table")
                    #endif
                    Menu {
                        Button("Scripture Reference…", systemImage: "book") { insertingReference = true }
                        Button("Link…", systemImage: "link") {
                            showLinkPrompt()
                        }
                        Section {
                            Menu("Heading", systemImage: "textformat.size") {
                                ForEach(1...3, id: \.self) { level in
                                    Button("Heading \(level)") { formatRequest = NoteFormatRequest(action: .heading(level)) }
                                }
                            }
                            .disabled(editingTable)
                            Button(NoteListStyle.bullet.title, systemImage: NoteListStyle.bullet.symbol) {
                                formatRequest = NoteFormatRequest(action: .list(.bullet))
                            }
                            .disabled(editingTable)
                            if editingTable {
                                tableMenu
                            } else {
                                Button("Table", systemImage: "tablecells") {
                                    formatRequest = NoteFormatRequest(action: .insertTable)
                                }
                            }
                        }
                        Button("Quote", systemImage: "text.quote") { formatRequest = NoteFormatRequest(action: .inline("\n> ", "")) }
                            .disabled(editingTable)
                        Menu("Callout", systemImage: "exclamationmark.bubble") {
                            ForEach(NoteCalloutKind.allCases, id: \.self) { kind in
                                Button(kind.label, systemImage: kind.symbol) {
                                    formatRequest = NoteFormatRequest(action: .callout(kind))
                                }
                            }
                        }
                        .disabled(editingTable)
                        Button("Image…", systemImage: "photo") {
                            NoteImageInput.chooseImage { markdown in
                                if let markdown { formatRequest = NoteFormatRequest(action: .insertImage(markdown)) }
                            }
                        }
                        .disabled(editingTable)
                        Button("Checklist", systemImage: "checklist") { formatRequest = NoteFormatRequest(action: .list(.checklist)) }
                            .disabled(editingTable)
                        Button("Divider", systemImage: "minus") { formatRequest = NoteFormatRequest(action: .inline("\n\n---\n\n", "")) }
                            .disabled(editingTable)
                    } label: {
                        Label("Insert", systemImage: "plus")
                    }
                    .menuIndicator(.hidden)
                    .help("Insert a Scripture reference, link, or note structure")
                }
                #if os(macOS)
                if #available(macOS 26.0, *) { ToolbarSpacer(.fixed) }
                #endif
                ToolbarItemGroup {
                    // Note details (original editor chrome): status, folder and statistics in one menu.
                    Menu {
                        Picker("Status", selection: Binding(get: { note.status ?? "" }, set: { value in
                            app.attempt("Couldn’t change the status") { _ = try app.notes?.update(note.id, .init(status: .some(value))) }
                            reload()
                        })) {
                            Text("None").tag("")
                            ForEach(NotesHomeView.statuses, id: \.id) { Text($0.label).tag($0.id) }
                        }
                        Menu("Icon", systemImage: "face.smiling") {
                            ForEach(Self.noteIcons, id: \.emoji) { icon in
                                Button(icon.emoji + " " + icon.name) { setNoteIcon(icon.emoji) }
                            }
                            Divider()
                            Button("Custom Emoji…") {
                                noteIconInput = note.icon ?? ""
                                choosingNoteIcon = true
                            }
                            if note.icon != nil {
                                Button("Remove Icon") { setNoteIcon(nil) }
                            }
                        }
                        Menu("Folder", systemImage: "folder") {
                            Button("No Folder") { app.attempt("Couldn’t move the note") { try app.notes?.setFolder(note.id, nil) }; reload() }
                            ForEach((try? app.notes?.folders()) ?? [], id: \.id) { folder in
                                Button(folder.name) { app.attempt("Couldn’t move the note") { try app.notes?.setFolder(note.id, folder.id) }; reload() }
                            }
                        }
                        Divider()
                        let words = content.split(whereSeparator: { $0.isWhitespace || $0.isNewline }).count
                        Text("\(words) word\(words == 1 ? "" : "s") · \(content.count) characters")
                        Text("Edited \(NotesHomeView.dateLabel(note.updatedAt))")
                    } label: { Label("Note Details", systemImage: "info.circle") }
                    .menuIndicator(.hidden)
                    .help("Status, folder and statistics")
                    Button { saveNow(); showingHistory = true } label: { Label("Version History", systemImage: "clock.arrow.circlepath") }
                    Menu {
                        Button("Export as Markdown File…") { saveNow(); app.exportNote(noteId) }
                        Button("Copy as Markdown") { copyMarkdown() }
                        Button("Print…") { saveNow(); printNote(title: dailyHeader(note) ?? title, body: content) }
                        #if os(macOS)
                        Button("Share…") {
                            saveNow()
                            shareRequest = NativeShareRequest(text: noteReadableShareText(title: dailyHeader(note) ?? (title.isEmpty ? "Untitled" : title), content: content))
                        }
                        #else
                        ShareLink(item: noteReadableShareText(title: dailyHeader(note) ?? (title.isEmpty ? "Untitled" : title), content: content)) { Text("Share…") }
                        #endif
                    } label: { Label("Share", systemImage: "square.and.arrow.up") }
                    #if os(macOS)
                    .background { NativeShareAnchor(request: shareRequest) }
                    #endif
                    .menuIndicator(.hidden)
                    .accessibilityLabel("Share note")
                    .help("Share note text, print, or export Markdown")
                    Button { try? app.notes?.setPinned(note.id, !note.pinned); reload() } label: { Label(note.pinned ? "Unpin" : "Pin", systemImage: note.pinned ? "pin.slash" : "pin") }
                    Button(role: .destructive) {
                        if app.confirmNoteDelete && !JSText.trim(content).isEmpty {
                            confirmingTrash = true
                        } else {
                            moveToTrash()
                        }
                    } label: { Label("Move to Trash", systemImage: "trash") }
                }
            }
        }
        .alert("Custom Note Icon", isPresented: $choosingNoteIcon) {
            TextField("Emoji", text: $noteIconInput)
            Button("Set Icon") {
                if let customNoteIcon { setNoteIcon(customNoteIcon) }
            }
            .disabled(customNoteIcon == nil)
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Enter one emoji.")
        }
        .alert("Move Note to Trash?", isPresented: $confirmingTrash) {
            Button("Move to Trash", role: .destructive) { moveToTrash() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("You can restore this note from Trash.")
        }
        .alert("Insert Link", isPresented: $insertingLink) {
            TextField("https://example.com", text: $linkInput)
                #if os(iOS)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                #endif
            Button("Insert") {
                if let destination = noteLinkDestination {
                    formatRequest = NoteFormatRequest(action: .link(destination, selection: linkSelection))
                }
            }
            .disabled(noteLinkDestination == nil)
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Enter a web address.")
        }
        .sheet(isPresented: $insertingReference) {
            NavigationStack {
                PassagePicker(textId: app.defaultText, currentBook: "", currentChapter: 0, onPick: { passage in
                    // The reference is plain text: the editor's reference detection links it, as in the original.
                    let text = passage.label + (passage.textId == "lxx" ? " LXX" : "")
                    formatRequest = NoteFormatRequest(action: .inline(text, ""))
                    insertingReference = false
                }, compact: true)
                .navigationTitle("Insert Reference")
                #if os(iOS)
                .navigationBarTitleDisplayMode(.inline)
                #endif
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { insertingReference = false } } }
            }
            #if os(macOS)
            .frame(minWidth: 460, minHeight: 520)
            #endif
        }
        .sheet(isPresented: $showingHistory) {
            NoteVersionHistoryView(noteId: noteId, currentTitle: title, currentContent: content) { restored in
                content = restored; lastSnapshot = restored; reload()
            }
        }
        .task(id: noteId) { await prepareNote() }
        .onChange(of: app.noteStrongsBlockSuggest) { invalidateDisabledReferenceSuggestion() }
        .onChange(of: app.noteVerseBlockSuggest) { invalidateDisabledReferenceSuggestion() }
        // Reflect changes made elsewhere (import, version restore, another window) unless this view has unsaved edits.
        .onChange(of: app.notesRevision) {
            guard let fresh = try? app.notes?.one(noteId), let note, fresh.updatedAt != note.updatedAt,
                  title == note.title, content == note.content else { return }
            reload(); lastSnapshot = content
        }
        .onChange(of: scenePhase) { _, phase in
            // A suspended scene may never get to finish the editor's debounce task.
            if phase == .background { saveNow() }
        }
        .onDisappear {
            saveNow()
            if !JSText.trim(content).isEmpty { snapshot() }
        }
    }

    private func prepareNote() async {
        // Invalidate any queued native edit before this view is reused for another note.
        formatRequest = nil
        wikiLinkQuery = nil; dismissedWikiLinkQuery = nil; wikiLinkTargets = []
        referenceCompletion = nil; dismissedReferenceCompletion = nil; preparedReference = nil
        scriptureBlocks = []
        if loadedId != nil, loadedId != noteId { saveNow(); snapshot() }
        reload()
        loadedId = noteId; lastSnapshot = content
        if note?.content.isEmpty == true {
            try? await Task.sleep(for: .milliseconds(150))
            guard !Task.isCancelled else { return }
            focus = (note?.title.isEmpty ?? true) ? .title : .body
        }
    }

    /// Keep the toolbar and Format menu in sync with the editor's actual selection.
    private var tableMenu: some View {
        Menu {
            if editingTable {
                Button("Add Row Below", systemImage: "rectangle.split.1x2") {
                    formatRequest = NoteFormatRequest(action: .addTableRow)
                }
                Button("Add Column After", systemImage: "rectangle.split.2x1") {
                    formatRequest = NoteFormatRequest(action: .addTableColumn)
                }
                Divider()
                Button("Delete Row", systemImage: "minus.rectangle") {
                    formatRequest = NoteFormatRequest(action: .deleteTableRow)
                }
                Button("Delete Column", systemImage: "minus.rectangle.portrait") {
                    formatRequest = NoteFormatRequest(action: .deleteTableColumn)
                }
                Button("Delete Table", systemImage: "trash", role: .destructive) {
                    formatRequest = NoteFormatRequest(action: .deleteTable)
                }
            } else {
                Button("Insert Table", systemImage: "tablecells") {
                    formatRequest = NoteFormatRequest(action: .insertTable)
                }
            }
        } label: { Label("Table", systemImage: "tablecells") }
        .menuIndicator(.hidden)
    }

    @ViewBuilder private var noteEditor: some View {
        #if os(macOS)
        RichNoteEditor(text: $content, fontFamily: app.notesFontFamily, detectVerseReferences: app.noteVerseRefsEnabled,
                       detectStrongsReferences: app.noteLexiconRefsEnabled,
                       scriptureBlocks: visibleScriptureBlocks, hermasEdition: scriptureBlockInput.hermas,
                       spellCheck: app.noteSpellCheck, formatRequest: formatRequest,
                       onWikiLinkQuery: receiveWikiLinkQuery, onWikiLinkAnchor: { wikiLinkAnchor = $0 },
                       onReferenceCompletion: receiveReferenceCompletion,
                       onTableContext: { editingTable = $0 },
                       onWikiLinkCommand: handleCompletionCommand, onLink: openLink)
            .focused($focus, equals: .body)
        #else
        RichNoteEditorIOS(text: $content, fontFamily: app.notesFontFamily, detectVerseReferences: app.noteVerseRefsEnabled,
                       detectStrongsReferences: app.noteLexiconRefsEnabled,
                       scriptureBlocks: visibleScriptureBlocks, hermasEdition: scriptureBlockInput.hermas,
                          spellCheck: app.noteSpellCheck, formatRequest: formatRequest,
                          onWikiLinkQuery: receiveWikiLinkQuery, onWikiLinkAnchor: { wikiLinkAnchor = $0 },
                          onReferenceCompletion: receiveReferenceCompletion,
                       onTableContext: { editingTable = $0 },
                          onWikiLinkCommand: handleCompletionCommand,
                          onInsertLink: { showLinkPrompt(selection: $0) }, onLink: openLink)
            .focused($focus, equals: .body)
        #endif
    }

    private func prepareScriptureBlocks(_ input: ScriptureBlockInput) async {
        guard input.enabled else { scriptureBlocks = []; return }
        let scan = Task.detached(priority: .utility) {
            NoteScriptureBlock.candidates(in: input.content, hermas: input.hermas)
        }
        let candidates = await withTaskCancellationHandler {
            await scan.value
        } onCancel: {
            scan.cancel()
        }
        guard !Task.isCancelled, input == scriptureBlockInput, loadedId == input.noteID else { return }
        let rules = app.wordReplacerRules
        // Resolve before the first suspension, using the captured edition context.
        let resolved = candidates.compactMap { block -> (NoteScriptureBlock, ParsedRef, ResolvedPassage, ScriptureRatioKey)? in
            guard let passage = app.resolvePassage(block.reference, preferring: input.textID),
                  let parsed = Reference.parse(block.reference,
                    hermas: HermasText(rawValue: passage.textId) ?? input.hermas) else { return nil }
            let key = ScriptureRatioKey(block: block.verificationKey, text: passage.textId,
                                       hermas: input.hermas.rawValue, replacer: input.replacerKey)
            return (block, parsed, passage, key)
        }
        var verifiedRatios = scriptureRatios
        let cached = resolved.compactMap { block, _, _, key in
            scriptureRatios[key].map { $0 >= input.threshold } == true ? block : nil
        }
        scriptureBlocks = cached
        verifiedScriptureInput = input
        // An edit outside an already verified passage uses the cache immediately.
        // Actual database work waits until typing has settled.
        do { try await Task.sleep(for: .milliseconds(300)) } catch { return }
        var chapters: [String: [ChapterVerseRow]] = [:]
        for (block, parsed, passage, key) in resolved where verifiedRatios[key] == nil {
            guard !Task.isCancelled, input == scriptureBlockInput else { return }
            let end = parsed.endChapter ?? parsed.chapter
            guard parsed.chapter >= 0, end >= parsed.chapter, end <= 999 else { continue }
            var passageChapters: [Int: [ChapterVerseRow]] = [:]
            for chapter in parsed.chapter...end {
                let chapterKey = "\(passage.textId)|\(parsed.bookId)|\(chapter)"
                if let cached = chapters[chapterKey] { passageChapters[chapter] = cached }
                else {
                    let rows = await app.bible.queryChapter(parsed.bookId, chapter, textId: passage.textId)
                    guard !Task.isCancelled, input == scriptureBlockInput else { return }
                    chapters[chapterKey] = rows; passageChapters[chapter] = rows
                }
            }
            guard let rows = NoteScriptureSelection.rows(for: parsed, chapters: passageChapters,
                                                        textId: passage.textId) else { continue }
            let actual = rows.map { row in
                let body = VerseDisplay.text(row.text, tagged: row.textTagged, textId: passage.textId,
                    replacerEnabled: input.replacer, rules: rules)
                let title = passage.textId == "lxx" ? row.title.map { $0 + " " } ?? "" : ""
                return title + body
            }.joined(separator: " ")
            guard !actual.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
            let ratio = NoteScriptureBlock.matchRatio(candidate: block.body, actual: actual)
            // Keep memory bounded during long editing sessions. Cache misses can
            // always be verified again; no missing-data result is cached as valid.
            if scriptureRatios.count >= 500 { scriptureRatios.removeAll(keepingCapacity: true) }
            scriptureRatios[key] = ratio
            verifiedRatios[key] = ratio
        }
        guard !Task.isCancelled, input == scriptureBlockInput, loadedId == input.noteID else { return }
        // Apply a shared lookup to every occurrence, including duplicate quoted
        // passages at different positions in the same note.
        scriptureBlocks = resolved.compactMap { block, _, _, key in
            verifiedRatios[key].map { $0 >= input.threshold } == true ? block : nil
        }.sorted { $0.range.location < $1.range.location }
        verifiedScriptureInput = input
    }

    private func referenceSuggestionEnabled(_ completion: NoteReferenceCompletion) -> Bool {
        switch completion.target {
        case .strongs: return app.noteStrongsBlockSuggest
        case .scripture: return app.noteVerseBlockSuggest
        }
    }

    private func invalidateDisabledReferenceSuggestion() {
        if let completion = referenceCompletion, !referenceSuggestionEnabled(completion) {
            referenceCompletion = nil; preparedReference = nil
        }
        if case .referenceBlock(let completion, _) = formatRequest?.action,
           !referenceSuggestionEnabled(completion) { formatRequest = nil }
    }

    private func receiveReferenceCompletion(_ completion: NoteReferenceCompletion?) {
        guard let completion else {
            referenceCompletion = nil; dismissedReferenceCompletion = nil; preparedReference = nil
            return
        }
        guard completion != dismissedReferenceCompletion else { return }
        guard referenceSuggestionEnabled(completion) else { return }
        referenceCompletion = completion
    }

    private func prepareReference() async {
        preparedReference = nil
        guard let completion = referenceCompletion, referenceSuggestionEnabled(completion) else { return }
        let sourceNoteID = noteId
        let replacement: String
        let label: String
        switch completion.target {
        case .strongs(let number):
            guard let entry = await app.lexicon.entry(number) else { return }
            replacement = entry.dictionaryCopyText
            label = "Insert Strong’s Block"
        case .scripture(let source):
            guard let passage = app.resolvePassage(source, preferring: note?.textId),
                  let parsed = Reference.parse(source, hermas: app.hermasEdition),
                  let first = parsed.verse, parsed.endChapter == nil || parsed.endChapter == parsed.chapter else { return }
            let groups = parsed.verseGroups?.map { ($0.verse, $0.endVerse ?? $0.verse) }
                ?? [(first, parsed.endVerse ?? first)]
            var numbers = Set<Int>()
            for (start, end) in groups {
                guard start > 0, end >= start, end <= 999 else { return }
                numbers.formUnion(start...end)
            }
            let chapter = await app.bible.queryChapter(passage.bookId, passage.chapter, textId: passage.textId)
            guard let rows = PsalmSuperscription.readerSelection(numbers, rows: chapter,
                textId: passage.textId, bookId: passage.bookId, chapter: passage.chapter) else { return }
            let lines = rows.map { row in
                let body = VerseDisplay.text(row.text, tagged: row.textTagged, textId: passage.textId,
                                             replacerEnabled: app.wordReplacerEnabled, rules: app.wordReplacerRules)
                let title = passage.textId == "lxx" ? row.title.map { $0.replacingOccurrences(of: "\n", with: " ") + " " } ?? "" : ""
                let text = title + body
                return rows.count == 1 ? text : "\(row.readerVerseLabel) \(text)"
            }
            let reference = source + (passage.textId == "lxx" && parsed.forcedTranslation != "LXX" ? " LXX" : "")
            replacement = rows.count == 1 ? reference + " " + lines[0] : reference + "\n" + lines.joined(separator: "\n")
            label = "Insert Scripture Block"
        }
        guard !Task.isCancelled, noteId == sourceNoteID, loadedId == sourceNoteID,
              referenceCompletion == completion, referenceSuggestionEnabled(completion) else { return }
        preparedReference = PreparedReference(completion: completion, label: label, replacement: replacement)
    }

    private func insertReferenceBlock(_ prepared: PreparedReference) {
        guard referenceCompletion == prepared.completion, referenceSuggestionEnabled(prepared.completion) else { return }
        formatRequest = NoteFormatRequest(action: .referenceBlock(prepared.completion, prepared.replacement))
        dismissedReferenceCompletion = prepared.completion
        referenceCompletion = nil; preparedReference = nil
    }

    private func handleCompletionCommand(_ command: NoteWikiLinkCommand) -> Bool {
        if wikiLinkQuery != nil { return handleWikiLinkCommand(command) }
        guard let completion = referenceCompletion else { return false }
        switch command {
        case .dismiss:
            dismissedReferenceCompletion = completion
            referenceCompletion = nil; preparedReference = nil
            return true
        case .accept:
            guard let prepared = preparedReference, prepared.completion == completion else { return false }
            insertReferenceBlock(prepared)
            return true
        case .up, .down: return false
        }
    }

    @ViewBuilder private var referenceSuggestion: some View {
        if wikiLinkQuery == nil, let prepared = preparedReference, referenceCompletion == prepared.completion,
           referenceSuggestionEnabled(prepared.completion) {
            GeometryReader { geometry in
                let width = min(360.0, geometry.size.width)
                let height = min(108.0, geometry.size.height)
                let below = wikiLinkAnchor.maxY + 6
                let y = below + height <= geometry.size.height ? below : max(0, wikiLinkAnchor.minY - height - 6)
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 8) {
                        Button { insertReferenceBlock(prepared) } label: {
                            Label(prepared.label, systemImage: "text.badge.plus")
                                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                .contentShape(.rect)
                        }
                        .buttonStyle(.interactivePlain)
                        .optionHover()
                        Button("Dismiss Suggestion", systemImage: "xmark") {
                            _ = handleCompletionCommand(.dismiss)
                        }
                        .labelStyle(.iconOnly).buttonStyle(.interactivePlain)
                        .frame(minWidth: 44, minHeight: 44)
                    }
                    Text(noteExcerptText(prepared.replacement).prefix(240))
                        .font(.callout).foregroundStyle(.secondary).lineLimit(2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(.horizontal, 12).padding(.bottom, 10)
                .frame(width: width, height: height, alignment: .topLeading)
                .modifier(NoteLinkSuggestionSurface())
                .overlay { RoundedRectangle(cornerRadius: 14).strokeBorder(.primary.opacity(0.08)) }
                .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
                .offset(x: min(max(0, wikiLinkAnchor.minX), max(0, geometry.size.width - width)), y: y)
            }
        }
    }

    private var matchingWikiLinkTargets: [NoteWikiLinkTarget] {
        guard let query = wikiLinkQuery?.query else { return [] }
        var seen = Set<String>()
        return Array(wikiLinkTargets.filter { target in
            target.id != noteId && !target.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && target.title.rangeOfCharacter(from: CharacterSet(charactersIn: "[]|").union(.newlines)) == nil
                && (query.isEmpty || target.title.localizedStandardContains(query))
                && seen.insert(target.title).inserted
        }.prefix(5))
    }

    private func receiveWikiLinkQuery(_ query: NoteWikiLinkCompletion?) {
        if query == nil { dismissedWikiLinkQuery = nil }
        guard query != dismissedWikiLinkQuery || query == nil else { return }
        if wikiLinkQuery == nil, query != nil {
            wikiLinkTargets = (try? app.notes?.wikiLinkTargets()) ?? []
        }
        if wikiLinkQuery != query { wikiLinkSelection = 0 }
        wikiLinkQuery = query
    }

    private func insertWikiLink(_ target: NoteWikiLinkTarget) {
        guard let query = wikiLinkQuery else { return }
        formatRequest = NoteFormatRequest(action: .wikiLink(query, target.title))
        dismissedWikiLinkQuery = query; wikiLinkQuery = nil
    }

    private func handleWikiLinkCommand(_ command: NoteWikiLinkCommand) -> Bool {
        guard let query = wikiLinkQuery else { return false }
        if case .dismiss = command {
            dismissedWikiLinkQuery = query; wikiLinkQuery = nil
            return true
        }
        let targets = matchingWikiLinkTargets
        guard !targets.isEmpty else { return false }
        switch command {
        case .up: wikiLinkSelection = max(0, wikiLinkSelection - 1)
        case .down: wikiLinkSelection = min(targets.count - 1, wikiLinkSelection + 1)
        case .accept: insertWikiLink(targets[min(wikiLinkSelection, targets.count - 1)])
        case .dismiss: break
        }
        return true
    }

    @ViewBuilder private var wikiLinkSuggestions: some View {
        let targets = matchingWikiLinkTargets
        if wikiLinkQuery != nil, !targets.isEmpty {
            let selected = targets[min(wikiLinkSelection, targets.count - 1)]
            GeometryReader { geometry in
                let width = min(340.0, geometry.size.width)
                let previewHeight: CGFloat = geometry.size.height >= 320 ? 96 : 0
                let height = min(CGFloat(targets.count) * 44 + 30 + previewHeight, max(74, geometry.size.height - 12))
                let below = wikiLinkAnchor.maxY + 6
                let y = below + height <= geometry.size.height ? below : max(0, wikiLinkAnchor.minY - height - 6)
                VStack(alignment: .leading, spacing: 0) {
                    Text("Link to Note").font(.caption).foregroundStyle(.secondary).padding(.horizontal, 12).frame(height: 30)
                    ScrollView {
                        VStack(spacing: 0) {
                            ForEach(Array(targets.enumerated()), id: \.element.id) { index, target in
                                Button { insertWikiLink(target) } label: {
                                    Label(target.title, systemImage: "note.text")
                                        .lineLimit(1).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                        .padding(.horizontal, 12).contentShape(.rect)
                                        .background(index == wikiLinkSelection ? Color.primary.opacity(0.08) : .clear, in: .rect(cornerRadius: 8))
                                }
                                .buttonStyle(.interactivePlain)
                                .onHover { if $0 { wikiLinkSelection = index } }
                                .accessibilityLabel("Link to \(target.title)")
                            }
                        }
                    }
                    if previewHeight > 0 {
                        Divider()
                        VStack(alignment: .leading, spacing: 4) {
                            if let preview = wikiLinkPreview, preview.id == selected.id {
                                if let reference = preview.verseRef, !reference.isEmpty {
                                    Text(Reference.formatDottedVerseRef(reference, hermas: app.hermasEdition))
                                        .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                }
                                let excerpt = noteExcerptText(String(preview.content.prefix(2000)))
                                    .trimmingCharacters(in: .whitespacesAndNewlines)
                                Text(excerpt.isEmpty ? "No content" : String(excerpt.prefix(400)))
                                    .font(.callout).foregroundStyle(.secondary).lineLimit(3)
                            }
                            Spacer(minLength: 0)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 12).padding(.vertical, 10)
                        .frame(height: previewHeight, alignment: .topLeading)
                        .accessibilityElement(children: .combine)
                    }
                }
                .frame(width: width, height: height)
                .modifier(NoteLinkSuggestionSurface())
                .overlay { RoundedRectangle(cornerRadius: 14).strokeBorder(.primary.opacity(0.08)) }
                .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
                .offset(x: min(max(0, wikiLinkAnchor.minX), max(0, geometry.size.width - width)), y: y)
                .task(id: selected.id) {
                    let preview = try? app.notes?.one(selected.id)
                    wikiLinkPreview = preview?.deletedAt == nil ? preview : nil
                }
            }
        }
    }

    private static let noteIcons: [(emoji: String, name: String)] = [
        ("📖", "Book"), ("📚", "Books"), ("📜", "Scroll"), ("🙏", "Prayer"),
        ("👑", "Crown"), ("🕊️", "Dove"), ("🌿", "Herb"), ("✨", "Sparkles"),
    ]

    private var customNoteIcon: String? {
        let value = JSText.trim(noteIconInput)
        guard value.count == 1,
              value.unicodeScalars.contains(where: { ($0.properties.isEmoji && $0.value > 127) || $0.value == 0x20E3 })
        else { return nil }
        return value
    }

    private func setNoteIcon(_ icon: String?) {
        saveNow()
        app.attempt("Couldn’t change the note icon") {
            _ = try app.notes?.update(noteId, .init(icon: .some(icon)))
        }
        reload()
    }

    private func moveToTrash() {
        saveNow()
        app.attempt("Couldn’t move the note to Trash") {
            try app.notes?.delete(noteId)
            if performDestination != nil { dismiss() } else { app.openNote(nil) }
        }
    }

    /// Wikilinks open the note with that title; verse references and web links open where they belong.
    private func followAttachment(_ passage: ResolvedPassage) {
        saveNow()
        let id = noteId, name = title
        routeFromEditor { app.visitScripture(passage, fromNote: id, title: name) }
    }

    private func routeFromEditor(_ action: @escaping () -> Void) {
        if let performDestination { performDestination(action) } else { action() }
    }

    func openLink(_ url: URL) {
        if url.scheme == "berean-note" {
            saveNow()
            let title = String(url.absoluteString.dropFirst("berean-note:".count)).removingPercentEncoding ?? ""
            if let passage = app.resolvePassage(title, preferring: note?.textId) {
                let id = noteId, name = self.title
                routeFromEditor { app.visitScripture(passage, fromNote: id, title: name) }
                return
            }
            if let n = (try? app.notes?.all(limit: 2000))?.first(where: { $0.title.caseInsensitiveCompare(title) == .orderedSame }) {
                routeFromEditor { app.openNote(n.id) }
            }
            return
        }
        let route = DeepLink.parse(url.absoluteString, hermas: app.hermasEdition)
        if route != nil || AppModel.isBereanLink(url) {
            saveNow()
            routeFromEditor { app.openBereanLink(route) }
            return
        }
        #if os(macOS)
        NSWorkspace.shared.open(url)
        #else
        UIApplication.shared.open(url)
        #endif
    }

    private func showLinkPrompt(selection: NSRange? = nil) {
        linkInput = ""
        linkSelection = selection
        insertingLink = true
    }

    private var noteLinkDestination: String? {
        let address = linkInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: address), let scheme = url.scheme?.lowercased(),
              ["https", "http"].contains(scheme), let host = url.host, !host.isEmpty else { return nil }
        return url.absoluteString.replacingOccurrences(of: ")", with: "%29")
    }

    private func formatButton(_ title: String, symbol: String, prefix: String, suffix: String) -> some View {
        Button(title, systemImage: symbol) {
            formatRequest = NoteFormatRequest(action: .inline(prefix, suffix))
        }
    }

    func copyMarkdown() {
        saveNow()
        guard let note = try? app.notes?.one(noteId) else { return }
        let text = NoteMarkdownFile.markdown(for: note)
        #if os(macOS)
        NSPasteboard.general.clearContents(); NSPasteboard.general.setString(text, forType: .string)
        #else
        UIPasteboard.general.string = text
        #endif
    }

    /// Editing paused for two minutes → snapshot a version (SNAPSHOT_IDLE_MS in the desktop editor).
    func scheduleSnapshot() {
        snapshotTask?.cancel()
        snapshotTask = Task { try? await Task.sleep(for: .seconds(120)); if !Task.isCancelled { saveNow(); snapshot() } }
    }

    func snapshot(kind: String = "auto") {
        snapshotTask?.cancel()
        guard let note, lastSnapshot != content else { return }
        lastSnapshot = content
        try? app.notes?.createVersion(noteId: note.id, title: title, content: content, kind: kind)
    }

    func reload() {
        note = try? app.notes?.one(noteId)
        title = note?.title ?? ""
        content = note?.content ?? ""
        if let note { app.refreshNoteTabTitles(note) }
    }

    func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task { try? await Task.sleep(for: .milliseconds(600)); if !Task.isCancelled { saveNow() } }
    }

    func saveNow() {
        guard let note, title != note.title || content != note.content else { return }
        guard let service = app.notes else { return }
        do {
            try service.update(note.id, .init(title: title, content: content))
            if let saved = try service.one(note.id) {
                self.note = saved
                app.refreshNoteTabTitles(saved)
            }
        } catch {
            app.userMessage = "Could not save the note: \(error)"
        }
    }
}

/// Block-level Markdown for reading notes (headings, quotes, lists, rules, code) with inline Markdown.
struct MarkdownText: View {
    let source: String
    init(_ s: String) { source = s }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(NotePreviewBlock.parse(source).enumerated()), id: \.offset) { _, previewBlock in
                switch previewBlock {
                case .line(let line): block(line)
                case .code(let lines):
                    Text(verbatim: lines.joined(separator: "\n"))
                        .font(.body.monospaced())
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(.quaternary, in: .rect(cornerRadius: 6))
                case .table(let table): tableView(table)
                case .callout(let kind, let title, let body): calloutView(kind, title: title, body: body)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    private func calloutView(_ kind: NoteCalloutKind, title: String, body: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                Image(systemName: kind.symbol)
                    .foregroundStyle(kind.color)
                    .accessibilityHidden(true)
                Text(kind.label).fontWeight(.semibold)
                if !title.isEmpty { inline(title).fontWeight(.semibold) }
            }
            .accessibilityAddTraits(.isHeader)
            if !body.isEmpty { MarkdownText(body) }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(kind.color.opacity(0.09), in: .rect(cornerRadius: 9))
        .overlay { RoundedRectangle(cornerRadius: 9).strokeBorder(kind.color.opacity(0.25)) }
    }

    private func tableView(_ table: NotePreviewTable) -> some View {
        ScrollView(.horizontal) {
            Grid(horizontalSpacing: 0, verticalSpacing: 0) {
                ForEach(table.rows.indices, id: \.self) { row in
                    GridRow {
                        ForEach(table.alignments.indices, id: \.self) { column in
                            let cell = inline(table.rows[row][column])
                            cell
                                .fontWeight(row == 0 ? .semibold : .regular)
                                .multilineTextAlignment(table.alignments[column].text)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                                .frame(minWidth: 88, maxWidth: 240, alignment: table.alignments[column].frame)
                                .gridColumnAlignment(table.alignments[column].frame.horizontal)
                                .accessibilityAddTraits(row == 0 ? .isHeader : [])
                            if column < table.alignments.count - 1 {
                                Rectangle().fill(.quaternary)
                                    .frame(width: 1)
                                    .gridCellUnsizedAxes(.vertical)
                                    .accessibilityHidden(true)
                            }
                        }
                    }
                    .background(row == 0 ? Color.secondary.opacity(0.10) : .clear)
                    if row != table.rows.indices.last {
                        Divider().gridCellUnsizedAxes(.horizontal)
                    }
                }
            }
            .background(.background)
            .clipShape(.rect(cornerRadius: 8))
            .overlay { RoundedRectangle(cornerRadius: 8).strokeBorder(.quaternary) }
        }
        .accessibilityLabel("Table")
    }

    func inline(_ s: String) -> Text {
        var text = AttributedString()
        for (var segment, highlight) in notePreviewInline(s) {
            if let highlight {
                segment.backgroundColor = Color.highlight(highlight).opacity(0.35)
                segment.foregroundColor = .primary
            }
            text += segment
        }
        return Text(text)
    }
    private func standaloneScriptureLink(_ line: String) -> (label: String, url: URL)? {
        guard let parsed = try? AttributedString(markdown: line, options: .init(interpretedSyntax: .inlineOnly)),
              let url = parsed.runs.first?.link,
              parsed.runs.allSatisfy({ $0.link == url }),
              case .verse? = DeepLink.parse(url.absoluteString) else { return nil }
        return (String(parsed.characters), url)
    }

    @ViewBuilder func block(_ line: String) -> some View {
        let t = line.trimmingCharacters(in: .whitespaces)
        if let passage = standaloneScriptureLink(t) {
            Link(destination: passage.url) {
                Label(passage.label, systemImage: "book")
                    .foregroundStyle(Color.accentColor)
                    .padding(.vertical, 4)
                    .contentShape(.rect)
            }
            #if os(macOS)
            .clickableCursor()
            #endif
            .accessibilityLabel("Open \(passage.label) in Scripture")
        } else if t.hasPrefix("### ") { inline(String(t.dropFirst(4))).font(.title3.bold()) }
        else if t.hasPrefix("## ") { inline(String(t.dropFirst(3))).font(.title2.bold()) }
        else if t.hasPrefix("# ") { inline(String(t.dropFirst(2))).font(.title.bold()) }
        else if t.hasPrefix(">") { HStack(spacing: 8) { RoundedRectangle(cornerRadius: 1).fill(.secondary).frame(width: 3); inline(String(t.drop { $0 == ">" || $0 == " " })).foregroundStyle(.secondary) } }
        else if let item = NotePreviewListItem(line) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                if let checked = item.checked {
                    Image(systemName: checked ? "checkmark.square" : "square")
                        .foregroundStyle(checked ? Color.accentColor : Color.secondary)
                        .accessibilityLabel(checked ? "Completed" : "Unchecked")
                } else {
                    Text(item.marker).monospacedDigit()
                }
                inline(item.content)
            }
            .padding(.leading, CGFloat(item.indent) * 12)
        }
        else if t == "---" || t == "***" { Divider() }
        else if t.isEmpty { Spacer().frame(height: 2) }
        else { inline(line) }
    }
}

/// Recognizes the list markers kept by both native editors and by imported Markdown notes.
private struct NotePreviewListItem {
    let marker: String
    let content: String
    let checked: Bool?
    let indent: Int

    init?(_ line: String) {
        let whitespace = line.prefix { $0 == " " || $0 == "\t" }
        let body = line.dropFirst(whitespace.count)
        guard let split = body.firstIndex(where: { $0 == " " || $0 == "\t" }) else { return nil }
        let prefix = body[..<split]
        let unordered = prefix == "-" || prefix == "*" || prefix == "+"
        let digits = prefix.dropLast()
        let ordered = !digits.isEmpty && digits.allSatisfy { $0.isASCII && $0.isNumber }
            && (prefix.last == "." || prefix.last == ")")
        guard unordered || ordered else { return nil }

        let text = body[split...].drop { $0 == " " || $0 == "\t" }
        let taskMarker = text.prefix(3).lowercased()
        let remainder = text.dropFirst(3)
        if unordered, (taskMarker == "[ ]" || taskMarker == "[x]"),
           remainder.isEmpty || remainder.first == " " || remainder.first == "\t" {
            checked = taskMarker == "[x]"
            content = String(remainder.drop { $0 == " " || $0 == "\t" })
        } else {
            checked = nil
            content = String(text)
        }
        marker = unordered ? "•" : String(prefix)
        indent = min(5, whitespace.reduce(0) { $0 + ($1 == "\t" ? 2 : 1) } / 2)
    }

    var printMarker: String {
        if let checked { return checked ? "☑" : "☐" }
        return marker
    }
}

private struct NotePreviewTable {
    enum Alignment {
        case leading, center, trailing

        var frame: SwiftUI.Alignment {
            switch self {
            case .leading: .leading
            case .center: .center
            case .trailing: .trailing
            }
        }

        var text: TextAlignment {
            switch self {
            case .leading: .leading
            case .center: .center
            case .trailing: .trailing
            }
        }
    }

    var rows: [[String]]
    let alignments: [Alignment]

    /// Share delimiter handling with the editor, including escaped pipes.
    static func cells(_ line: String) -> [String]? {
        let text = line.trimmingCharacters(in: .whitespaces) as NSString
        let cells = MarkdownLiveSpans.tableCells(in: text, range: NSRange(location: 0, length: text.length))
        guard !cells.isEmpty else { return nil }
        return cells.map { text.substring(with: $0).trimmingCharacters(in: .whitespaces) }
    }

    static func alignment(_ separator: String) -> Alignment? {
        guard separator.range(of: #"^:?-{3,}:?$"#, options: .regularExpression) != nil else { return nil }
        if separator.hasSuffix(":") { return separator.hasPrefix(":") ? .center : .trailing }
        return .leading
    }
}

enum NoteCalloutKind: String, CaseIterable {
    case note, tip, warning, important, caution

    var label: String { rawValue.capitalized }

    var symbol: String {
        switch self {
        case .note: "info.circle"
        case .tip: "lightbulb"
        case .warning: "exclamationmark.triangle"
        case .important: "exclamationmark.circle"
        case .caution: "xmark.octagon"
        }
    }

    var color: Color {
        switch self {
        case .note: .blue
        case .tip: .green
        case .warning: .orange
        case .important: .purple
        case .caution: .red
        }
    }
}

private enum NotePreviewBlock {
    case line(String)
    case code([String])
    case table(NotePreviewTable)
    case callout(NoteCalloutKind, title: String, body: String)

    private static func quotedContent(_ line: String) -> Substring? {
        let trimmed = line.drop { $0 == " " || $0 == "\t" }
        guard trimmed.first == ">" else { return nil }
        let body = trimmed.dropFirst()
        return body.first == " " ? body.dropFirst() : body
    }

    static func parse(_ source: String) -> [Self] {
        let normalized = source.replacingOccurrences(of: "\r\n", with: "\n")
        let lines = normalized.components(separatedBy: "\n")
        var recoveredRules = Set<Int>()
        if normalized.contains("—") {
            let sourceText = normalized as NSString
            let ruleOffsets = Set(MarkdownLiveSpans.spans(normalized).compactMap { span in
                span.kind == .tableRule && sourceText.substring(with: span.range).contains("—")
                    ? span.range.location : nil
            })
            var offset = 0
            for (lineIndex, line) in lines.enumerated() {
                if ruleOffsets.contains(offset) { recoveredRules.insert(lineIndex) }
                offset += line.utf16.count + 1
            }
        }
        var blocks: [Self] = []
        var index = 0
        while index < lines.count {
            let line = lines[index]
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if let mark = trimmed.first, mark == "`" || mark == "~" {
                let length = trimmed.prefix { $0 == mark }.count
                if length >= 3, mark == "~" || !trimmed.dropFirst(length).contains(mark) {
                    index += 1
                    var code: [String] = []
                    while index < lines.count {
                        let candidate = lines[index].trimmingCharacters(in: .whitespaces)
                        if candidate.count >= length, candidate.allSatisfy({ $0 == mark }) {
                            index += 1
                            break
                        }
                        code.append(lines[index])
                        index += 1
                    }
                    blocks.append(.code(code))
                    continue
                }
            }
            if let quote = quotedContent(line), quote.hasPrefix("[!"),
               let end = quote.firstIndex(of: "]"),
               let kind = NoteCalloutKind(rawValue: quote.dropFirst(2).prefix { $0 != "]" }.lowercased()) {
                let title = quote[quote.index(after: end)...].trimmingCharacters(in: .whitespaces)
                var body: [Substring] = []
                index += 1
                while index < lines.count, let next = quotedContent(lines[index]) {
                    if next.hasPrefix("[!") { break }
                    body.append(next)
                    index += 1
                }
                blocks.append(.callout(kind, title: title, body: body.joined(separator: "\n")))
                continue
            }
            if index + 1 < lines.count,
               let header = NotePreviewTable.cells(line),
               let separator = NotePreviewTable.cells(lines[index + 1]),
               header.count == separator.count {
                let alignments = recoveredRules.contains(index + 1)
                    ? Array(repeating: NotePreviewTable.Alignment.leading, count: separator.count)
                    : separator.compactMap(NotePreviewTable.alignment)
                if alignments.count == header.count {
                    var table = NotePreviewTable(rows: [header], alignments: alignments)
                    index += 2
                    while index < lines.count, let row = NotePreviewTable.cells(lines[index]), row.count == header.count {
                        if index + 1 < lines.count, let rule = NotePreviewTable.cells(lines[index + 1]),
                           rule.count == row.count,
                           recoveredRules.contains(index + 1) || rule.allSatisfy({ NotePreviewTable.alignment($0) != nil }) {
                            break
                        }
                        table.rows.append(row)
                        index += 1
                    }
                    blocks.append(.table(table))
                    continue
                }
            }
            blocks.append(.line(line))
            index += 1
        }
        return blocks
    }
}

/// Compact note rows read across the cells of a table, leaving its Markdown intact.
func noteExcerptText(_ source: String) -> String {
    guard source.contains("|") else { return MarkdownLiveSpans.plainText(source) }
    let blocks = NotePreviewBlock.parse(source)
    guard blocks.contains(where: { if case .table = $0 { true } else { false } }) else {
        return MarkdownLiveSpans.plainText(source)
    }
    return blocks.map { block in
        switch block {
        case .line(let line):
            return MarkdownLiveSpans.plainText(line)
        case .code(let lines):
            return lines.joined(separator: "\n")
        case .callout(let kind, let title, let body):
            return kind.label + ": " + MarkdownLiveSpans.plainText(title + "\n" + body)
        case .table(let table):
            return table.rows.map { row in
                row.map { cell in
                    notePreviewInline(cell).map { String($0.0.characters) }.joined()
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                }.filter { !$0.isEmpty }.joined(separator: " · ")
            }.joined(separator: "\n")
        }
    }.joined(separator: "\n")
}

/// Feed the editor's custom highlight syntax through Foundation Markdown without
/// breaking emphasis or links that span a highlight boundary.
private func notePreviewInline(_ source: String) -> [(AttributedString, String?)] {
    func parse(_ text: String) -> AttributedString {
        (try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)))
            ?? AttributedString(text)
    }

    guard source.contains("==") || source.contains("<mark class=\"hl-") else { return [(parse(source), nil)] }
    let candidates = MarkdownLiveSpans.spans(source).compactMap { span -> (NSRange, String?)? in
        if case .highlight(let color) = span.kind { return (span.range, color) }
        return nil
    }.sorted { $0.0.location < $1.0.location }
    var highlights: [(NSRange, String?)] = []
    var previousEnd = 0
    for (range, color) in candidates {
        let prefixLength = color.map { "<mark class=\"hl-\($0)\">".utf16.count } ?? 2
        let suffixLength = color == nil ? 2 : 7
        guard range.location - prefixLength >= previousEnd else { continue }
        highlights.append((range, color))
        previousEnd = NSMaxRange(range) + suffixLength
    }
    guard !highlights.isEmpty else { return [(parse(source), nil)] }

    // Private-use characters survive inline Markdown parsing and never enter the saved note.
    var marker = "\u{E000}"
    while source.contains(marker) { marker += "\u{E001}" }
    let opening = marker + "\u{E002}"
    let closing = marker + "\u{E003}"
    let marked = NSMutableString(string: source)
    for (range, color) in highlights.reversed() {
        let prefix = color.map { "<mark class=\"hl-\($0)\">" } ?? "=="
        let suffix = color == nil ? "==" : "</mark>"
        marked.replaceCharacters(in: NSRange(location: NSMaxRange(range), length: suffix.utf16.count), with: closing)
        marked.replaceCharacters(in: NSRange(location: range.location - prefix.utf16.count, length: prefix.utf16.count), with: opening)
    }
    let parsed = parse(marked as String)
    let plain = String(parsed.characters)
    func segment(_ range: Range<String.Index>) -> AttributedString? {
        guard let start = AttributedString.Index(range.lowerBound, within: parsed),
              let end = AttributedString.Index(range.upperBound, within: parsed) else { return nil }
        return AttributedString(parsed[start..<end])
    }

    var result: [(AttributedString, String?)] = []
    var cursor = plain.startIndex
    for (_, color) in highlights {
        guard let open = plain.range(of: opening, range: cursor..<plain.endIndex),
              let close = plain.range(of: closing, range: open.upperBound..<plain.endIndex),
              let before = segment(cursor..<open.lowerBound),
              let highlighted = segment(open.upperBound..<close.lowerBound) else { return [(parse(source), nil)] }
        result.append((before, nil))
        result.append((highlighted, color ?? "yellow"))
        cursor = close.upperBound
    }
    if let tail = segment(cursor..<plain.endIndex) { result.append((tail, nil)) }
    return result
}

/// Print markup is built only from parsed text. Raw HTML and resource URLs in notes are never loaded.
private enum NotePrintMarkup {
    private static let backgrounds = [
        "yellow": "#fff0a3", "orange": "#ffd5ae", "pink": "#fbcfe8",
        "red": "#ffc7c7", "green": "#c7ebc0", "blue": "#c7e2ff", "purple": "#e4d1fb",
        "amber": "#fce9ad", "rose": "#ffd5df", "violet": "#e4d8fd", "indigo": "#d4d7fd",
        "sky": "#c5edfc", "cyan": "#bdf1f6", "teal": "#c1f1e9", "lime": "#e0f6b7"
    ]

    static func document(title: String, body: String) -> String {
        let heading = title.isEmpty ? "" : "<h1>\(escape(title))</h1>"
        let contents = NotePreviewBlock.parse(body).map(block).joined(separator: "\n")
        return """
            <!doctype html><html><head><meta charset="utf-8"><style>
            body { font: 12pt -apple-system, Helvetica, sans-serif; color: #111; }
            p { margin: 0 0 6pt; } h1, h2, h3 { margin: 10pt 0 6pt; }
            blockquote { border-left: 2pt solid #999; margin: 4pt 0; padding-left: 9pt; }
            .callout { padding: 7pt 9pt; margin: 8pt 0; border-left: 2pt solid #999; background: #f4f4f4; }
            pre, code { font-family: monospace; } pre { white-space: pre-wrap; }
            table { border-collapse: collapse; margin: 8pt 0; width: 100%; table-layout: fixed; }
            td, th { border: 1px solid #bbb; padding: 4pt 6pt; overflow-wrap: break-word; text-align: left; }
            th { background: #f4f4f4; }
            .center { text-align: center; } .trailing { text-align: right; }
            </style></head><body>\(heading)\(contents)</body></html>
            """
    }

    private static func block(_ block: NotePreviewBlock) -> String {
        switch block {
        case .code(let lines):
            return "<pre>\(escape(lines.joined(separator: "\n")))</pre>"
        case .table(let table):
            let columnWidth = 100.0 / Double(table.alignments.count)
            func row(_ cells: [String], header: Bool) -> String {
                let tag = header ? "th" : "td"
                let scope = header ? " scope=\"col\"" : ""
                let rendered = zip(cells, table.alignments).map { cell, alignment in
                    "<\(tag) class=\"\(alignment)\" style=\"width: \(columnWidth)%\"\(scope)>\(inline(cell))</\(tag)>"
                }
                return "<tr>\(rendered.joined())</tr>"
            }
            let header = row(table.rows[0], header: true)
            let body = table.rows.dropFirst().map { row($0, header: false) }.joined()
            return "<table><thead>\(header)</thead><tbody>\(body)</tbody></table>"
        case .callout(let kind, let title, let body):
            let heading = title.isEmpty ? kind.label : kind.label + " — " + inline(title)
            let contents = body.isEmpty ? "" : NotePreviewBlock.parse(body).map(Self.block).joined()
            return "<div class=\"callout\"><p><strong>\(heading)</strong></p>\(contents)</div>"
        case .line(let line):
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty { return "<br>" }
            if trimmed == "---" || trimmed == "***" { return "<hr>" }
            let headingLevel = trimmed.prefix { $0 == "#" }.count
            if (1...3).contains(headingLevel), trimmed.dropFirst(headingLevel).first == " " {
                return "<h\(headingLevel)>\(inline(String(trimmed.dropFirst(headingLevel + 1))))</h\(headingLevel)>"
            }
            if trimmed.hasPrefix(">") {
                return "<blockquote>\(inline(String(trimmed.dropFirst().trimmingCharacters(in: .whitespaces))))</blockquote>"
            }
            if let item = NotePreviewListItem(line) {
                let margin = 18 + item.indent * 12
                return "<p style=\"margin-left: \(margin)pt; text-indent: -18pt\">\(item.printMarker) \(inline(item.content))</p>"
            }
            return "<p>\(inline(line))</p>"
        }
    }

    private static func inline(_ source: String) -> String {
        notePreviewInline(source).map { text, highlight in
            let rendered = text.runs.map { run in
                var value = escape(String(text[run.range].characters))
                if let intent = run.inlinePresentationIntent {
                    if intent.contains(.code) { value = "<code>\(value)</code>" }
                    if intent.contains(.stronglyEmphasized) { value = "<strong>\(value)</strong>" }
                    if intent.contains(.emphasized) { value = "<em>\(value)</em>" }
                    if intent.contains(.strikethrough) { value = "<s>\(value)</s>" }
                }
                if run.link != nil { value = "<u>\(value)</u>" }
                return value
            }.joined()
            guard let highlight else { return rendered }
            return "<span style=\"background-color: \(backgrounds[highlight] ?? "#fff0a3")\">\(rendered)</span>"
        }.joined()
    }

    private static func escape(_ source: String) -> String {
        source.replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
    }
}

/// Notes attached to a verse (study inspector "Notes" panel).
struct VerseNotesView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let bookId: String, chapter: Int, verse: Int?, textId: String
    var selectedVerses: Set<Int> = []
    var allowsChapterScope = false
    var editInSheet: ((String) -> Void)?
    var showNoteCrossReferences: ((Int?, Set<Int>) -> Void)?
    @State private var notes: [Note] = []
    @State private var loadedScope: String?
    @State private var chapterScope: String?
    @State private var allNotesScope = false
    @State private var hasNoteCrossReferences = false
    @State private var studyQuery = ""
    @AppStorage("studyNotesSort") private var studySort = StudySort.verse

    private enum StudySort: String, CaseIterable {
        case verse, modified, created

        var label: String {
            switch self {
            case .verse: "By Verse"
            case .modified: "Date Edited"
            case .created: "Date Created"
            }
        }
    }

    private var passageLabel: String {
        ResolvedPassage(textId: textId, bookId: bookId, chapter: chapter, verse: scopedSelection.min() ?? scopedVerse,
                        verseGroups: consecutiveVerseRuns(scopedSelection)).label
    }

    private var selectionAttachment: String {
        let prefix = "\(bookId).\(chapter)"
        if selectedVerses.isEmpty { return prefix + (verse.map { ".\($0)" } ?? "") }
        return consecutiveVerseRuns(selectedVerses).map { range in
            let start = "\(prefix).\(range.lowerBound)"
            return range.lowerBound == range.upperBound ? start : "\(start)-\(range.upperBound)"
        }.joined(separator: ",")
    }

    private var scopeKey: String { "\(textId)|\(selectionAttachment)" }
    private var showingChapter: Bool { allowsChapterScope && chapterScope == scopeKey }
    private var scopedVerse: Int? { showingChapter ? nil : verse }
    private var scopedSelection: Set<Int> { showingChapter ? [] : selectedVerses }
    private var attachment: String { showingChapter ? "\(bookId).\(chapter)" : selectionAttachment }
    private var loadKey: String { "\(textId)|\(attachment)|\(allNotesScope)|\(app.notesRevision)" }
    private var searchTerm: String { studyQuery.trimmingCharacters(in: .whitespacesAndNewlines) }

    private var displayedNotes: [Note] {
        guard loadedScope == loadKey else { return [] }
        var visible = allNotesScope ? Array(notes.prefix(500)) : notes
        guard allowsChapterScope else { return visible }
        let query = searchTerm
        if !query.isEmpty {
            visible = visible.filter {
                $0.displayTitle.localizedCaseInsensitiveContains(query) || $0.content.localizedCaseInsensitiveContains(query)
            }
        }
        switch studySort {
        case .modified:
            return visible.sorted { $0.updatedAt > $1.updatedAt }
        case .created:
            return visible.sorted { $0.createdAt > $1.createdAt }
        case .verse:
            return visible.map { note in
                let ref = note.verseRef?.split(separator: ",").first
                    .flatMap { Reference.parseNoteAttachment(String($0)) }
                let order = ref.map { (Reference.bookOrder($0.bookId), $0.chapter, $0.verse ?? 0) }
                    ?? (Int.max, Int.max, Int.max)
                return (note, order)
            }.sorted { $0.1 < $1.1 }.map(\.0)
        }
    }

    private var panelControlSize: CGFloat {
        #if os(macOS)
        28
        #else
        44
        #endif
    }

    var body: some View {
        VStack(spacing: 0) {
            if allowsChapterScope {
                HStack {
                    Text(allNotesScope ? "All Notes" : passageLabel).font(.subheadline.weight(.semibold))
                    Spacer(minLength: 8)
                    if !allNotesScope, verse != nil || !selectedVerses.isEmpty {
                        Button {
                            chapterScope = showingChapter ? nil : scopeKey
                        } label: {
                            Label(showingChapter ? "Show Selected Verse Notes" : "Show Chapter Notes",
                                  systemImage: showingChapter ? "list.number" : "list.bullet")
                                .labelStyle(.iconOnly)
                                .frame(width: panelControlSize, height: panelControlSize)
                                .contentShape(.rect)
                                .optionHover()
                        }
                        .buttonStyle(.interactivePlain)
                        .help(showingChapter ? "Show selected verse notes" : "Show chapter notes")
                    }
                }
                .padding(.horizontal, 12)
                studyNotesSearch
            }
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    StudyPanelSection("Notes") {
                        let results = displayedNotes
                        if allNotesScope, loadedScope == loadKey, notes.count > 500 {
                            Text("Showing the 500 most recently edited notes")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        ForEach(results) { note in
                            Button {
                                if let editInSheet {
                                    editInSheet(note.id)
                                    return
                                }
                                let source = app.activeTab?.id
                                app.openNote(note.id, fromList: source)
                                #if os(iOS)
                                dismiss()
                                #endif
                            } label: {
                                NoteRowView(note: note)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .contentShape(.rect)
                            }
                            .buttonStyle(OptionButtonStyle())
                        }
                        if loadedScope == loadKey, results.isEmpty {
                            Text(searchTerm.isEmpty ? (allNotesScope ? "No notes yet." : "No notes for this passage.") : "No matching notes.")
                                .font(.callout).foregroundStyle(.secondary)
                        }
                        Button(action: createPassageNote) {
                            Label("New Note", systemImage: "square.and.pencil")
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .frame(minHeight: panelControlSize)
                                .contentShape(.rect)
                        }
                        .buttonStyle(OptionButtonStyle())
                        .accessibilityLabel("New Note for \(passageLabel)")
                        .help("New note for \(passageLabel)")
                    }
                    if allowsChapterScope, !allNotesScope {
                        StudyPassageTags(bookId: bookId, chapter: chapter, textId: textId, verse: scopedVerse, selectedVerses: scopedSelection)
                    }
                    if !allNotesScope, loadedScope == loadKey, hasNoteCrossReferences, let showNoteCrossReferences {
                        StudyPanelSection("Connections") {
                            Button {
                                showNoteCrossReferences(scopedVerse, scopedSelection)
                            } label: {
                                Label("Related Passages", systemImage: "arrow.triangle.branch")
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .frame(minHeight: panelControlSize)
                                    .contentShape(.rect)
                            }
                            .buttonStyle(OptionButtonStyle())
                            .accessibilityHint("Show verse connections and mentions from your notes")
                        }
                    }
                }
                .padding(12)
            }
        }
        .onChange(of: scopeKey) { chapterScope = nil }
        .task(id: loadKey) {
            hasNoteCrossReferences = false
            if allNotesScope {
                notes = (try? app.notes?.all(limit: 501)) ?? []
            } else if !scopedSelection.isEmpty {
                notes = (try? app.notes?.coveringVerses(bookId, chapter, scopedSelection, textId: textId)) ?? []
            } else if let verse = scopedVerse {
                notes = (try? app.notes?.coveringVerse(bookId, chapter, verse, textId: textId)) ?? []
            } else {
                notes = (try? app.notes?.attachedNotes(bookId, chapter, textId: textId)) ?? []
            }
            if !allNotesScope, showNoteCrossReferences != nil {
                let selected = scopedSelection.isEmpty ? Set(scopedVerse.map { [$0] } ?? []) : scopedSelection
                let references = try? app.notes?.crossReferences(bookId: bookId, chapter: chapter, textId: textId, selected: selected)
                hasNoteCrossReferences = references?.byVerse.values.contains { !$0.isEmpty } == true || references?.indirect.isEmpty == false
            }
            loadedScope = loadKey
        }
    }

    private func createPassageNote() {
        let source = app.activeTab?.id
        guard let id = app.newNote(verseRef: attachment, textId: textId, title: passageLabel, openEditor: false) else { return }
        if let editInSheet { editInSheet(id); return }
        app.openNote(id, fromList: source)
        #if os(iOS)
        dismiss()
        #endif
    }

    private var studyNotesSearch: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary).accessibilityHidden(true)
            TextField("Search Notes", text: $studyQuery)
                .textFieldStyle(.plain)
                #if os(macOS)
                .onExitCommand { studyQuery = "" }
                #endif
            if !studyQuery.isEmpty {
                Button("Clear Search", systemImage: "xmark.circle.fill") { studyQuery = "" }
                    .labelStyle(.iconOnly)
                    .foregroundStyle(.secondary)
                    .frame(minWidth: 32, minHeight: 32)
                    .contentShape(.rect)
                    .buttonStyle(.interactivePlain)
            }
            studyNotesMenu
        }
        .font(.subheadline)
        .padding(.horizontal, 10)
        .frame(minHeight: 36)
        .background(.quaternary, in: .rect(cornerRadius: 9))
        .padding(.horizontal, 12)
        .padding(.bottom, 6)
    }

    private var studyNotesMenu: some View {
        Menu {
            Picker("Show Notes", selection: $allNotesScope) {
                Text("Current Passage").tag(false)
                Text("All Notes").tag(true)
            }
            .pickerStyle(.inline)
            .labelsHidden()
            Divider()
            Picker("Sort Notes", selection: $studySort) {
                ForEach(StudySort.allCases, id: \.self) { option in Text(option.label).tag(option) }
            }
            .pickerStyle(.inline)
            .labelsHidden()
        } label: {
            Label("Notes Options", systemImage: "line.3.horizontal.decrease")
                .labelStyle(.iconOnly)
                #if os(iOS)
                .frame(width: 44, height: 44)
                #else
                .frame(width: 28, height: 28)
                #endif
                .contentShape(.rect)
        }
        .menuStyle(.borderlessButton)
        .optionHover(active: allNotesScope || studySort != .verse)
        .menuIndicator(.hidden)
        .fixedSize()
        .clickableCursor()
        .help("Notes scope and sort")
    }
}

/// Version history (NoteVersionHistory.tsx): snapshots newest first, preview, restore, save a version now.
struct NoteVersionHistoryView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif
    let noteId: String
    let currentTitle: String
    let currentContent: String
    let onRestore: (String) -> Void
    @State private var versions: [NoteVersion] = []
    @State private var selection: String?
    @State private var confirmRestore = false

    var selected: NoteVersion? { versions.first { $0.id == selection } }

    var body: some View {
        NavigationStack {
            historyContent
            .navigationTitle("Version History")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Restore") { confirmRestore = true }.disabled(selected == nil) }
            }
            .confirmationDialog("Restore this version?", isPresented: $confirmRestore) {
                Button("Restore Version") {
                    restoreSelectedVersion()
                }
            } message: { Text("The current text is saved as a version first, so you can undo this.") }
        }
        #if os(macOS)
        .frame(minWidth: 720, minHeight: 500)
        #endif
        .task { load() }
    }

    private func restoreSelectedVersion() {
        guard let selected else { return }
        guard let notes = app.notes else {
            app.userMessage = "The notes library is unavailable."
            return
        }
        app.attempt("Couldn’t restore the note version") {
            switch try notes.restoreVersion(noteId: noteId, versionId: selected.id) {
            case .restored(let content):
                onRestore(content)
                dismiss()
            case .versionNotFound:
                app.userMessage = "This version is no longer available."
                load()
            case .noteNotFound:
                app.userMessage = "This note is no longer available."
            }
        }
    }

    @ViewBuilder private var historyContent: some View {
        #if os(iOS)
        if horizontalSizeClass == .compact { compactHistory }
        else { splitHistory }
        #else
        splitHistory
        #endif
    }

    private var splitHistory: some View {
        HStack(spacing: 0) {
            List(selection: $selection) {
                if versions.isEmpty { emptyHistoryMessage }
                ForEach(versions) { version in
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: version.kind == "manual" ? "bookmark" : "clock.arrow.circlepath")
                            .foregroundStyle(.secondary)
                            .frame(width: 18)
                            .padding(.top, 2)
                        VStack(alignment: .leading, spacing: 5) {
                            Text(versionDate(version)).font(.subheadline.weight(.medium))
                            Text(Self.kindLabel(version.kind)).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    .padding(.vertical, 6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(.rect)
                    .tag(version.id)
                }
            }
            .frame(minWidth: 220, idealWidth: 240, maxWidth: 280)
            .safeAreaInset(edge: .bottom) { saveVersionButton.padding(10) }
            Divider()
            preview.frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    #if os(iOS)
    private var compactHistory: some View {
        VStack(alignment: .leading, spacing: 0) {
            if versions.isEmpty {
                emptyHistoryMessage.padding(20)
                Spacer()
            } else {
                Picker("Version", selection: $selection) {
                    ForEach(versions) { version in
                        Text("\(versionDate(version)) · \(Self.kindLabel(version.kind))")
                            .tag(Optional(version.id))
                    }
                }
                .pickerStyle(.menu)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                Divider()
                preview
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .safeAreaInset(edge: .bottom) {
            saveVersionButton.padding(12).background(.bar)
        }
    }
    #endif

    private var emptyHistoryMessage: some View {
        Text("No versions yet. Versions are saved while you edit, or with Save Version Now.")
            .foregroundStyle(.secondary)
    }

    @ViewBuilder private var preview: some View {
        if let selected {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(selected.title.isEmpty ? "Untitled" : selected.title)
                            .font(.title2.weight(.semibold))
                            .accessibilityAddTraits(.isHeader)
                        Text(versionDate(selected) + " · " + Self.kindLabel(selected.kind))
                            .font(.subheadline).foregroundStyle(.secondary)
                        if selected.content == currentContent {
                            Label("Matches current note", systemImage: "checkmark.circle")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                    Divider()
                    MarkdownText(selected.content)
                }
                .textSelection(.enabled)
                .frame(maxWidth: 720, alignment: .leading)
                .padding(24)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .id(selected.id)
        } else {
            ContentUnavailableView("Select a version", systemImage: "clock.arrow.circlepath")
        }
    }

    private var saveVersionButton: some View {
        Button {
            app.attempt("Couldn’t save the note version") {
                try app.notes?.createVersion(noteId: noteId, title: currentTitle, content: currentContent, kind: "manual")
            }
            load()
        } label: {
            Label("Save Version Now", systemImage: "plus.circle").frame(maxWidth: .infinity)
        }
        .buttonStyle(.bordered)
    }

    private func versionDate(_ version: NoteVersion) -> String {
        Date(timeIntervalSince1970: Double(version.createdAt) / 1000)
            .formatted(.dateTime.month().day().year().hour().minute())
    }

    func load() { versions = (try? app.notes?.versions(of: noteId)) ?? []; selection = versions.first?.id }

    static func kindLabel(_ kind: String) -> String {
        switch kind { case "manual": "Saved manually"; case "pre-restore": "Before restore"; default: "Autosaved" }
    }
}

