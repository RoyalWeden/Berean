import SwiftUI
import BereanCore
import BereanNotes
import BereanReference
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
            if !note.content.isEmpty { Text(note.content.prefix(200)).font(.callout).foregroundStyle(.secondary).lineLimit(2) }
        }
        .padding(.vertical, 2)
    }
}

func verseLabel(_ ref: String, _ textId: String) -> String { Reference.verseRefDisplay(ref, textId: textId, hermas: HermasText(textId: textId)) }

extension Color {
    static func noteColor(_ name: String) -> Color {
        switch name { case "red": return .red; case "green": return .green; case "yellow": return .yellow; case "purple": return .purple; case "orange": return .orange; case "pink": return .pink; default: return .blue }
    }
}

struct NoteFormatRequest: Equatable {
    let id = UUID()
    enum Action: Equatable {
        case inline(String, String)
        case heading(Int)
        case list(NoteListStyle)
        case insertTable
        case addTableRow
        case addTableColumn
        case deleteTableRow
        case deleteTableColumn
    }

    let action: Action
}

/// TextKit selections and Markdown delimiter positions both use UTF-16 offsets.
func noteFormatEdit(in text: NSString, selection: NSRange, opening: String, closing: String)
    -> (range: NSRange, replacement: String, selection: NSRange)? {
    guard selection.location <= text.length, selection.length <= text.length - selection.location else { return nil }
    let prefixLength = opening.utf16.count
    let suffixLength = closing.utf16.count
    let end = NSMaxRange(selection)
    let inner = text.substring(with: selection)
    if selection.location >= prefixLength, suffixLength <= text.length - end {
        let start = selection.location - prefixLength
        let prefix = text.substring(with: NSRange(location: start, length: prefixLength))
        let suffix = text.substring(with: NSRange(location: end, length: suffixLength))
        if prefix == opening, suffix == closing {
            return (NSRange(location: start, length: prefixLength + selection.length + suffixLength),
                    inner, NSRange(location: start, length: selection.length))
        }
    }
    return (selection, opening + inner + closing,
            NSRange(location: selection.location + prefixLength, length: selection.length))
}

func noteHeadingEdit(in text: NSString, selection: NSRange, level: Int)
    -> (range: NSRange, replacement: String, selection: NSRange)? {
    guard (0...3).contains(level), selection.location <= text.length,
          selection.length <= text.length - selection.location else { return nil }
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
    guard selection.location <= text.length, selection.length <= text.length - selection.location else { return nil }
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
    guard selection.location <= text.length, selection.length <= text.length - selection.location else { return nil }
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

private func noteTableContext(in text: NSString, selection: NSRange)
    -> (block: [MarkdownLiveSpans.Span], row: Int)? {
    guard selection.location <= text.length, selection.length <= text.length - selection.location else { return nil }
    let selectedLine = text.lineRange(for: selection)
    guard selectedLine.length > 0, text.character(at: selectedLine.location) == 124 else { return nil }
    let spans = MarkdownLiveSpans.spans(text as String).filter {
        $0.kind == .tableRow || $0.kind == .tableRule
    }
    var block: [MarkdownLiveSpans.Span] = []
    for span in spans {
        if let last = block.last, text.lineRange(for: last.range).upperBound != span.range.location {
            if block.contains(where: { $0.range.location == selectedLine.location }) { break }
            block.removeAll(keepingCapacity: true)
        }
        block.append(span)
    }
    guard block.count >= 2, block[0].kind == .tableRow, block[1].kind == .tableRule,
          let row = block.firstIndex(where: { $0.kind == .tableRow && $0.range.location == selectedLine.location }) else {
        return nil
    }
    guard selection.upperBound <= block[row].range.upperBound else { return nil }
    return (block, row)
}

private func noteTableCells(in text: NSString, range: NSRange) -> [NSRange] {
    var pipes: [Int] = []
    var escaped = false
    for offset in range.location..<range.upperBound {
        let character = text.character(at: offset)
        if character == 124, !escaped { pipes.append(offset) }
        escaped = character == 92 && !escaped
    }
    guard pipes.first == range.location, pipes.last == range.upperBound - 1 else { return [] }
    return zip(pipes, pipes.dropFirst()).map { start, end in
        NSRange(location: start + 1, length: end - start - 1)
    }
}

func noteTableRowInsertion(in text: NSString, selection: NSRange)
    -> (range: NSRange, replacement: String, selection: NSRange)? {
    guard let (block, row) = noteTableContext(in: text, selection: selection) else { return nil }
    let columns = noteTableCells(in: text, range: block[0].range).count
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
    let rows = block.map { noteTableCells(in: text, range: $0.range) }
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

func noteTableDeletion(in text: NSString, selection: NSRange, columnOnly: Bool)
    -> (range: NSRange, replacement: String, selection: NSRange)? {
    guard let (block, row) = noteTableContext(in: text, selection: selection),
          let first = block.first, let last = block.last else { return nil }
    let rows = block.map { noteTableCells(in: text, range: $0.range) }
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
    let current = noteTableCells(in: text, range: block[row].range)
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
        let nextCells = noteTableCells(in: text, range: block[nextRow].range)
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

/// Return continues a list at the end of an item and exits it on an empty item.
func noteListReturnEdit(in text: NSString, selection: NSRange)
    -> (range: NSRange, replacement: String, selection: NSRange)? {
    guard selection.length == 0, selection.location <= text.length else { return nil }
    var start = 0, end = 0, contentEnd = 0
    text.getLineStart(&start, end: &end, contentsEnd: &contentEnd, for: selection)
    guard selection.location == contentEnd else { return nil }
    let line = text.substring(with: NSRange(location: start, length: contentEnd - start))
    let indent = String(line.prefix { $0 == " " || $0 == "\t" })
    let body = String(line.dropFirst(indent.count))
    let pattern = #"^(?:[-+*] \[[ xX]\] |[-+*] |[0-9]+[.)] )"#
    guard let markerRange = body.range(of: pattern, options: .regularExpression) else { return nil }
    let marker = String(body[markerRange])
    let remainder = body[markerRange.upperBound...]
    if remainder.allSatisfy(\.isWhitespace) {
        return (NSRange(location: start, length: contentEnd - start), "", NSRange(location: start, length: 0))
    }
    let next: String
    if marker.contains("[") {
        next = String(marker.prefix(2)) + "[ ] "
    } else if let number = Int(String(marker.dropLast(2))), number < Int.max {
        next = String(number + 1) + marker.suffix(2)
    } else {
        next = marker
    }
    let replacement = "\n" + indent + next
    return (selection, replacement, NSRange(location: contentEnd + replacement.utf16.count, length: 0))
}

/// One note with a native rich editor and version history.
struct NoteDetailView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let noteId: String
    var performDestination: ((@escaping () -> Void) -> Void)?
    @State private var note: Note?
    @State private var title = ""
    @State private var formatRequest: NoteFormatRequest?
    @State private var content = ""
    @State private var saveTask: Task<Void, Never>?
    @State private var snapshotTask: Task<Void, Never>?
    /// Content of the last version snapshot (or as opened) — a snapshot is only taken after edits.
    @State private var lastSnapshot: String?
    @State private var loadedId: String?
    @State private var showingHistory = false
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
                    if let daily = dailyHeader(note) {
                        // A daily note's stored title ("Daily — 2026-11-14") is its calendar key; show the date
                        // instead and keep it read-only so renaming can't detach the note from its day.
                        Text(daily).font(.largeTitle.bold()).textSelection(.enabled)
                            .accessibilityAddTraits(.isHeader)
                    } else {
                        TextField("Untitled", text: $title).font(.largeTitle.bold()).textFieldStyle(.plain)
                            .focused($focus, equals: .title)
                            .onSubmit { focus = .body }
                            .onChange(of: title) { scheduleSave() }
                    }
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
                    #if os(macOS)
                    RichNoteEditor(text: $content, fontSize: 15, formatRequest: formatRequest) { url in openLink(url) }
                        .focused($focus, equals: .body)
                    #else
                    RichNoteEditorIOS(text: $content, formatRequest: formatRequest) { url in openLink(url) }
                        .focused($focus, equals: .body)
                    #endif
                }
                .onChange(of: content) { scheduleSave(); scheduleSnapshot() }
                .frame(maxWidth: 760, alignment: .leading).padding(.horizontal, 24).padding(.top, 20).frame(maxWidth: .infinity)
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
                    Button { saveNow(); app.returnToNotesList() } label: { Label("All Notes", systemImage: "chevron.backward") }
                        .help("Back to the notes list")
                }
                if let note {
                    Menu {
                        Section("Paragraph") {
                            Button("Body") { formatRequest = NoteFormatRequest(action: .heading(0)) }
                            ForEach(1...3, id: \.self) { level in
                                Button("Heading \(level)") { formatRequest = NoteFormatRequest(action: .heading(level)) }
                            }
                        }
                        Section("Lists") {
                            ForEach(NoteListStyle.allCases, id: \.self) { style in
                                Button(style.title, systemImage: style.symbol) {
                                    formatRequest = NoteFormatRequest(action: .list(style))
                                }
                            }
                        }
                        Menu("Table", systemImage: "tablecells") {
                            Button("Insert Table", systemImage: "tablecells") {
                                formatRequest = NoteFormatRequest(action: .insertTable)
                            }
                            Button("Add Row Below", systemImage: "rectangle.split.1x2") {
                                formatRequest = NoteFormatRequest(action: .addTableRow)
                            }
                            Button("Add Column After", systemImage: "rectangle.split.2x1") {
                                formatRequest = NoteFormatRequest(action: .addTableColumn)
                            }
                            Button("Delete Row", systemImage: "minus.rectangle") {
                                formatRequest = NoteFormatRequest(action: .deleteTableRow)
                            }
                            Button("Delete Column", systemImage: "minus.rectangle.portrait") {
                                formatRequest = NoteFormatRequest(action: .deleteTableColumn)
                            }
                        }
                        formatButton("Bold", symbol: "bold", prefix: "**", suffix: "**")
                        formatButton("Italic", symbol: "italic", prefix: "*", suffix: "*")
                        formatButton("Underline", symbol: "underline", prefix: "<u>", suffix: "</u>")
                        formatButton("Strikethrough", symbol: "strikethrough", prefix: "~~", suffix: "~~")
                        formatButton("Highlight", symbol: "highlighter", prefix: "==", suffix: "==")
                    } label: {
                        Label("Format", systemImage: "textformat")
                    }
                    .menuIndicator(.hidden)
                    .help("Format selected note text")
                    Button { saveNow(); showingHistory = true } label: { Label("Version History", systemImage: "clock.arrow.circlepath") }
                    Menu {
                        Button("Export as Markdown File…") { saveNow(); app.exportNote(noteId) }
                        Button("Copy as Markdown") { copyMarkdown() }
                        ShareLink(item: NoteMarkdownFile.markdown(for: note)) { Text("Share…") }
                    } label: { Label("Share", systemImage: "square.and.arrow.up") }
                    .menuIndicator(.hidden)
                    .accessibilityLabel("Share note")
                    .help("Export, copy or share this note as Markdown")
                    Button { try? app.notes?.setPinned(note.id, !note.pinned); reload() } label: { Label(note.pinned ? "Unpin" : "Pin", systemImage: note.pinned ? "pin.slash" : "pin") }
                    Button(role: .destructive) {
                        saveNow()
                        app.attempt("Couldn’t move the note to Trash") {
                            try app.notes?.delete(note.id)
                            if performDestination != nil { dismiss() } else { app.openNote(nil) }
                        }
                    } label: { Label("Move to Trash", systemImage: "trash") }
                }
            }
        }
        .sheet(isPresented: $showingHistory) {
            NoteVersionHistoryView(noteId: noteId, currentTitle: title, currentContent: content) { restored in
                content = restored; lastSnapshot = restored; reload()
            }
        }
        .task(id: noteId) {
            if loadedId != nil, loadedId != noteId { saveNow(); snapshot() }   // leaving a note: consolidate its version
            reload()
            loadedId = noteId; lastSnapshot = content
            let isNew = (note?.content.isEmpty ?? false)
            if isNew { try? await Task.sleep(for: .milliseconds(150)); focus = (note?.title.isEmpty ?? true) ? .title : .body }
        }
        // Reflect changes made elsewhere (import, version restore, another window) unless this view has unsaved edits.
        .onChange(of: app.notesRevision) {
            guard let fresh = try? app.notes?.one(noteId), let note, fresh.updatedAt != note.updatedAt,
                  title == note.title, content == note.content else { return }
            reload(); lastSnapshot = content
        }
        .onDisappear {
            saveNow()
            if !JSText.trim(content).isEmpty { snapshot() }
        }
    }

    /// Wikilinks open the note with that title; verse references and web links open where they belong.
    private func followAttachment(_ passage: ResolvedPassage) {
        saveNow()
        routeFromEditor { app.visitScripture(passage) }
    }

    private func routeFromEditor(_ action: @escaping () -> Void) {
        if let performDestination { performDestination(action) } else { action() }
    }

    func openLink(_ url: URL) {
        if url.scheme == "berean-note" {
            saveNow()
            let title = String(url.absoluteString.dropFirst("berean-note:".count)).removingPercentEncoding ?? ""
            if let passage = app.resolvePassage(title) {
                routeFromEditor { app.visitScripture(passage) }
                return
            }
            if let n = (try? app.notes?.all(limit: 2000))?.first(where: { $0.title.caseInsensitiveCompare(title) == .orderedSame }) {
                routeFromEditor { app.openNote(n.id) }
            }
            return
        }
        let route = DeepLink.parse(url.absoluteString, hermas: app.hermasEdition)
        let internalSchemes = ["berean", "berean-dev", "berean-pdf", "berean-dev-pdf"]
        if route != nil || internalSchemes.contains(url.scheme?.lowercased() ?? "") {
            saveNow()
            routeFromEditor { openBereanLink(route) }
            return
        }
        #if os(macOS)
        NSWorkspace.shared.open(url)
        #else
        UIApplication.shared.open(url)
        #endif
    }

    private func openBereanLink(_ route: DeepLinkRoute?) {
        switch route {
        case .verse(let book, let chapter, let verse, let endVerse, let text, _):
            if let text, !availableTexts.contains(where: { $0.id == text }) {
                app.userMessage = "This Scripture text is unavailable."
                return
            }
            let textId = text ?? app.bookCatalog.first {
                $0.book.id == book && $0.textId == app.defaultText
            }?.textId ?? app.bookCatalog.first { $0.book.id == book }?.textId
                ?? Reference.translation(forBook: book, hermas: app.hermasEdition)
            if let edition = HermasText(rawValue: text ?? app.hermasEdition.rawValue), Reference.isHermasBook(book) {
                app.openScripture(bookId: book, chapter: chapter, verse: verse, endVerse: endVerse, textId: edition.rawValue, reuseTab: true)
            } else {
                app.openScripture(bookId: book, chapter: chapter, verse: verse, endVerse: endVerse, textId: textId, reuseTab: true)
            }
        case .note(let id):
            guard (try? app.notes?.one(id)) != nil else {
                app.userMessage = "This note is unavailable."
                return
            }
            app.openNote(id)
        case .lexicon(let id):
            app.openLexicon(id, reuseTab: true)
        case .search(let query):
            app.openSearch(query, reuseTab: true)
        case .daily:
            app.openTodayDailyNote()
        default:
            app.userMessage = "This Berean link can’t be opened here."
        }
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
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
        Text((try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(s))
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
            .pointerStyle(.link)
            #endif
            .accessibilityLabel("Open \(passage.label) in Scripture")
        } else if t.hasPrefix("### ") { inline(String(t.dropFirst(4))).font(.title3.bold()) }
        else if t.hasPrefix("## ") { inline(String(t.dropFirst(3))).font(.title2.bold()) }
        else if t.hasPrefix("# ") { inline(String(t.dropFirst(2))).font(.title.bold()) }
        else if t.hasPrefix(">") { HStack(spacing: 8) { RoundedRectangle(cornerRadius: 1).fill(.secondary).frame(width: 3); inline(String(t.drop { $0 == ">" || $0 == " " })).foregroundStyle(.secondary) } }
        else if t.hasPrefix("- ") || t.hasPrefix("* ") { HStack(alignment: .firstTextBaseline) { Text("•"); inline(String(t.dropFirst(2))) } }
        else if t == "---" || t == "***" { Divider() }
        else if t.isEmpty { Spacer().frame(height: 2) }
        else { inline(line) }
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

    /// Reads the pipe-delimited rows emitted by the legacy editor. Markdown escapes stay
    /// intact for inline rendering and an escaped pipe never starts a new cell.
    static func cells(_ line: String) -> [String]? {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.hasPrefix("|"), trimmed.hasSuffix("|"), trimmed.count >= 2 else { return nil }

        var cells: [String] = []
        var cell = ""
        var escaped = false
        for character in trimmed.dropFirst() {
            if character == "|" && !escaped {
                cells.append(cell.trimmingCharacters(in: .whitespaces))
                cell = ""
            } else {
                cell.append(character)
            }
            escaped = character == "\\" && !escaped
        }
        return cell.isEmpty && !cells.isEmpty ? cells : nil
    }

    static func alignment(_ separator: String) -> Alignment? {
        guard separator.range(of: #"^:?-{3,}:?$"#, options: .regularExpression) != nil else { return nil }
        if separator.hasSuffix(":") { return separator.hasPrefix(":") ? .center : .trailing }
        return .leading
    }
}

private enum NotePreviewBlock {
    case line(String)
    case code([String])
    case table(NotePreviewTable)

    static func parse(_ source: String) -> [Self] {
        let lines = source.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        var blocks: [Self] = []
        var index = 0
        while index < lines.count {
            let line = lines[index]
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if let mark = trimmed.first, mark == "`" || mark == "~" {
                let length = trimmed.prefix { $0 == mark }.count
                if length >= 3 {
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
            if index + 1 < lines.count,
               let header = NotePreviewTable.cells(line),
               let separator = NotePreviewTable.cells(lines[index + 1]),
               header.count == separator.count {
                let alignments = separator.compactMap(NotePreviewTable.alignment)
                if alignments.count == header.count {
                    var table = NotePreviewTable(rows: [header], alignments: alignments)
                    index += 2
                    while index < lines.count, let row = NotePreviewTable.cells(lines[index]), row.count == header.count {
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

/// Notes attached to a verse (study inspector "Notes" panel).
struct VerseNotesView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let bookId: String, chapter: Int, verse: Int?, textId: String
    var selectedVerses: Set<Int> = []
    var allowsChapterScope = false
    var editInSheet: ((String) -> Void)?
    @State private var notes: [Note] = []
    @State private var loadedScope: String?
    @State private var chapterScope: String?
    @State private var allNotesScope = false
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
                                .frame(width: 44, height: 44)
                                .contentShape(.rect)
                        }
                        .buttonStyle(.interactivePlain)
                        .help(showingChapter ? "Show selected verse notes" : "Show chapter notes")
                    }
                    studyNotesMenu
                }
                .padding(.horizontal, 12)
                studyNotesSearch
            }
            List {
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
                        #if os(iOS)
                        dismiss()
                        #endif
                        app.openNote(note.id)
                    } label: {
                        NoteRowView(note: note)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(.rect)
                    }
                    .buttonStyle(.interactivePlain)
                }
                if loadedScope == loadKey, results.isEmpty, !searchTerm.isEmpty {
                    ContentUnavailableView.search(text: searchTerm)
                } else if loadedScope == loadKey, notes.isEmpty, allNotesScope || (scopedVerse == nil && scopedSelection.isEmpty) {
                    ContentUnavailableView(allNotesScope ? "No notes" : "No chapter notes", systemImage: "note.text")
                }
                Button {
                    let ref = attachment
                    if let editInSheet {
                        if let id = app.newNote(verseRef: ref, textId: textId, title: passageLabel, openEditor: false) {
                            editInSheet(id)
                        }
                        return
                    }
                    if app.newNote(verseRef: ref, textId: textId, title: passageLabel) != nil {
                        #if os(iOS)
                        dismiss()
                        #endif
                    }
                } label: {
                    Label("New Note for \(passageLabel)", systemImage: "plus")
                }
            }
        }
        .onChange(of: scopeKey) { chapterScope = nil }
        .task(id: loadKey) {
            if allNotesScope {
                notes = (try? app.notes?.all(limit: 501)) ?? []
            } else if !scopedSelection.isEmpty {
                notes = (try? app.notes?.coveringVerses(bookId, chapter, scopedSelection, textId: textId)) ?? []
            } else if let verse = scopedVerse {
                notes = (try? app.notes?.coveringVerse(bookId, chapter, verse, textId: textId)) ?? []
            } else {
                notes = (try? app.notes?.attachedNotes(bookId, chapter, textId: textId)) ?? []
            }
            loadedScope = loadKey
        }
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
            Section("Scope") {
                Picker("Scope", selection: $allNotesScope) {
                    Text("Current Passage").tag(false)
                    Text("All Notes").tag(true)
                }
            }
            Section("Sort") {
                Picker("Sort", selection: $studySort) {
                    ForEach(StudySort.allCases, id: \.self) { option in Text(option.label).tag(option) }
                }
            }
        } label: {
            Label("Notes Options", systemImage: "line.3.horizontal.decrease")
                .labelStyle(.iconOnly)
                .frame(width: 44, height: 44)
                .contentShape(.rect)
        }
        .menuStyle(.borderlessButton)
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
            HStack(spacing: 0) {
                List(selection: $selection) {
                    if versions.isEmpty { Text("No versions yet. Versions are saved while you edit, or with Save Version Now.").foregroundStyle(.secondary) }
                    ForEach(versions) { v in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(Date(timeIntervalSince1970: Double(v.createdAt) / 1000), format: .dateTime.month().day().year().hour().minute())
                            Text(Self.kindLabel(v.kind)).font(.caption).foregroundStyle(.secondary)
                        }.tag(v.id)
                    }
                }
                .frame(minWidth: 220, idealWidth: 240, maxWidth: 280)
                .safeAreaInset(edge: .bottom) {
                    Button { try? app.notes?.createVersion(noteId: noteId, title: currentTitle, content: currentContent, kind: "manual"); load() } label: {
                        Label("Save Version Now", systemImage: "plus.circle").frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderless).padding(10).clickableCursor()
                }
                Divider()
                Group {
                    if let v = selected {
                        ScrollView { MarkdownText(v.content).textSelection(.enabled).padding(20) }
                    } else {
                        ContentUnavailableView("Select a version", systemImage: "clock.arrow.circlepath")
                    }
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .navigationTitle("Version History")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Restore") { confirmRestore = true }.disabled(selected == nil) }
            }
            .confirmationDialog("Restore this version?", isPresented: $confirmRestore) {
                Button("Restore Version") {
                    if let v = selected, case .restored(let c)? = try? app.notes?.restoreVersion(noteId: noteId, versionId: v.id) { onRestore(c); dismiss() }
                }
            } message: { Text("The current text is saved as a version first, so you can undo this.") }
        }
        .frame(minWidth: 640, minHeight: 440)
        .task { load() }
    }

    func load() { versions = (try? app.notes?.versions(of: noteId)) ?? []; selection = versions.first?.id }

    static func kindLabel(_ kind: String) -> String {
        switch kind { case "manual": "Saved manually"; case "pre-restore": "Before restore"; default: "Autosaved" }
    }
}
