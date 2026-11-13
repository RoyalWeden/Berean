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

func verseLabel(_ ref: String, _ textId: String) -> String { Reference.verseRefDisplay(ref, textId: textId) }

extension Color {
    static func noteColor(_ name: String) -> Color {
        switch name { case "red": return .red; case "green": return .green; case "yellow": return .yellow; case "purple": return .purple; case "orange": return .orange; case "pink": return .pink; default: return .blue }
    }
}

/// One note with a native rich editor, Markdown source, and read-only preview.
struct NoteDetailView: View {
    @Environment(AppModel.self) private var app
    let noteId: String
    @State private var note: Note?
    @State private var title = ""
    @State private var content = ""
    @State private var showSource = false
    @State private var saveTask: Task<Void, Never>?
    @State private var snapshotTask: Task<Void, Never>?
    /// Content of the last version snapshot (or as opened) — a snapshot is only taken after edits.
    @State private var lastSnapshot: String?
    @State private var loadedId: String?
    @State private var showingHistory = false
    @State private var showingPreview = false
    @FocusState private var focus: Field?
    enum Field { case title, body }

    var body: some View {
        Group {
            if let note {
                VStack(alignment: .leading, spacing: 10) {
                    TextField("Untitled", text: $title).font(.largeTitle.bold()).textFieldStyle(.plain)
                        .focused($focus, equals: .title)
                        .onSubmit { focus = .body }
                        .onChange(of: title) { scheduleSave() }
                    if let ref = note.verseRef {
                        Button(verseLabel(ref, note.textId)) {
                            let p = ref.split(separator: ".").map(String.init)
                            if p.count >= 2, let c = Int(p[1]) { app.openScripture(bookId: p[0], chapter: c, verse: p.count > 2 ? Int(p[2]) : nil, textId: note.textId, reuseTab: true) }
                        }.buttonStyle(.borderless)
                    }
                    if showSource {
                        // Advanced: the Markdown source (View ▸ Show Markdown Source, ⇧⌘M).
                        TextEditor(text: $content).font(.system(.body, design: .monospaced)).scrollContentBackground(.hidden)
                            .focused($focus, equals: .body)
                    } else {
                        #if os(macOS)
                        RichNoteEditor(text: $content, fontSize: 15) { url in openLink(url) }
                            .focused($focus, equals: .body)
                        #else
                        RichNoteEditorIOS(text: $content) { url in openLink(url) }
                            .focused($focus, equals: .body)
                        #endif
                    }
                }
                .onChange(of: content) { scheduleSave(); scheduleSnapshot() }
                .frame(maxWidth: 760, alignment: .leading).padding(.horizontal, 24).padding(.top, 20).frame(maxWidth: .infinity)
            } else {
                ContentUnavailableView("Note not found", systemImage: "note.text")
            }
        }
        .navigationTitle(title.isEmpty ? "Untitled" : title)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
            ToolbarItemGroup {
                Button { saveNow(); app.openNote(nil) } label: { Label("All Notes", systemImage: "chevron.backward") }
                    .help("Back to the notes list")
                Toggle(isOn: $showSource) { Label("Show Markdown Source", systemImage: "chevron.left.forwardslash.chevron.right") }
                    .keyboardShortcut("m", modifiers: [.command, .shift]).help("Show the note's Markdown source (⇧⌘M)")
                if let note {
                    Button("Preview Note", systemImage: "eye") { showingPreview = true }
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
                    Button(role: .destructive) { try? app.notes?.delete(note.id); app.openNote(nil) } label: { Label("Move to Trash", systemImage: "trash") }
                }
            }
        }
        .sheet(isPresented: $showingPreview) {
            NavigationStack {
                ScrollView {
                    MarkdownText(content)
                        .textSelection(.enabled)
                        .padding(24)
                        .frame(maxWidth: 760)
                        .frame(maxWidth: .infinity)
                }
                .navigationTitle(title.isEmpty ? "Untitled" : title)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { showingPreview = false }
                    }
                }
            }
            .environment(\.openURL, OpenURLAction { url in
                showingPreview = false
                openLink(url)
                return .handled
            })
            #if os(macOS)
            .frame(minWidth: 580, minHeight: 400)
            #endif
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
    func openLink(_ url: URL) {
        if url.scheme == "berean-note" {
            let title = String(url.absoluteString.dropFirst("berean-note:".count)).removingPercentEncoding ?? ""
            if let p = app.resolvePassage(title) { app.openScripture(bookId: p.bookId, chapter: p.chapter, verse: p.verse, textId: p.textId, reuseTab: true); return }
            if let n = (try? app.notes?.all(limit: 2000))?.first(where: { $0.title.caseInsensitiveCompare(title) == .orderedSame }) { app.openNote(n.id) }
            return
        }
        if ["berean", "berean-dev"].contains(url.scheme?.lowercased() ?? "") {
            openBereanLink(url)
            return
        }
        #if os(macOS)
        NSWorkspace.shared.open(url)
        #else
        UIApplication.shared.open(url)
        #endif
    }

    private func openBereanLink(_ url: URL) {
        switch DeepLink.parse(url.absoluteString, hermas: app.hermasEdition) {
        case .verse(let book, let chapter, let verse, _, let text, _):
            if let text, !availableTexts.contains(where: { $0.id == text }) {
                app.userMessage = "This Scripture text is unavailable."
                return
            }
            let textId = text ?? app.bookCatalog.first {
                $0.book.id == book && $0.textId == app.defaultText
            }?.textId ?? app.bookCatalog.first { $0.book.id == book }?.textId
            if let edition = HermasText(rawValue: text ?? app.hermasEdition.rawValue), Reference.isHermasBook(book) {
                app.openScripture(bookId: book, chapter: chapter, verse: verse, textId: edition.rawValue, reuseTab: true)
            } else {
                app.openScripture(bookId: book, chapter: chapter, verse: verse, textId: textId, reuseTab: true)
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

    func reload() { note = try? app.notes?.one(noteId); title = note?.title ?? ""; content = note?.content ?? "" }

    func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task { try? await Task.sleep(for: .milliseconds(600)); if !Task.isCancelled { saveNow() } }
    }

    func saveNow() {
        guard let note, title != note.title || content != note.content else { return }
        try? app.notes?.update(note.id, .init(title: title, content: content))
        self.note = try? app.notes?.one(noteId)
        app.update(app.activeTab?.id ?? "") { if $0.tabType == .note { $0.title = title.isEmpty ? "Untitled" : title } }
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
    @ViewBuilder func block(_ line: String) -> some View {
        let t = line.trimmingCharacters(in: .whitespaces)
        if t.hasPrefix("### ") { inline(String(t.dropFirst(4))).font(.title3.bold()) }
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
    let bookId: String, chapter: Int, verse: Int?, textId: String
    @State private var notes: [Note] = []

    var body: some View {
        Group {
            if let verse {
                List {
                    ForEach(notes) { n in Button { app.openNote(n.id) } label: { NoteRowView(note: n) }.buttonStyle(.interactivePlain) }
                    Button { app.newNote(verseRef: "\(bookId).\(chapter).\(verse)", textId: textId) } label: {
                        Label("New Note for \(Reference.bookChapterVerseLabel(bookId, chapter: chapter, verse: verse))", systemImage: "plus")
                    }
                }
                .task(id: "\(bookId)|\(chapter)|\(verse)|\(textId)|\(app.notesRevision)") {
                    notes = (try? app.notes?.byVerse("\(bookId).\(chapter).\(verse)", textId: textId)) ?? []
                }
            } else {
                ContentUnavailableView("Select a verse", systemImage: "hand.tap", description: Text("Click a verse number to see and add its notes.")).frame(maxHeight: .infinity, alignment: .top)
            }
        }
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
                    .buttonStyle(.borderless).padding(10)
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
