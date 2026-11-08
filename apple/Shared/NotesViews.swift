import SwiftUI
import BereanCore
import BereanNotes
import BereanReference
import UniformTypeIdentifiers

/// The Notes space home: search, type filters, folders and the note list (`NotesPanel` home view).
struct NotesHomeView: View {
    @Environment(AppModel.self) private var app
    @State private var query = ""
    @State private var filter = "all"
    @State private var folderId: String?
    @State private var notes: [Note] = []
    @State private var folders: [NoteFolder] = []

    static let filters: [(String, String, String)] = [("all", "All", "tray.full"), ("scripture", "Scripture", "book"), ("topic", "Topic", "text.alignleft"),
                                                     ("daily", "Daily", "calendar"), ("pinned", "Pinned", "pin"), ("trash", "Trash", "trash")]

    var body: some View {
        List {
            Section {
                Picker("Show", selection: $filter) { ForEach(Self.filters, id: \.0) { Label($0.1, systemImage: $0.2).tag($0.0) } }
                    .pickerStyle(.menu)
                if !folders.isEmpty {
                    Picker("Folder", selection: $folderId) {
                        Text("All folders").tag(String?.none)
                        ForEach(folders) { Text($0.name).tag(Optional($0.id)) }
                    }.pickerStyle(.menu)
                }
            }
            Section("\(notes.count) notes") {
                ForEach(notes) { n in
                    Button { app.openNote(n.id) } label: { NoteRowView(note: n) }
                        .buttonStyle(.plain)
                        .contextMenu {
                            if filter == "trash" { Button("Restore") { try? app.notes?.restore(n.id) } }
                            else {
                                Button(n.pinned ? "Unpin" : "Pin") { try? app.notes?.setPinned(n.id, !n.pinned) }
                                Button("Move to Trash", role: .destructive) { try? app.notes?.delete(n.id) }
                            }
                        }
                }
            }
        }
        .searchable(text: $query, prompt: "Search notes")
        .navigationTitle("Notes")
        .toolbar {
            ToolbarItem { Button { app.newNote() } label: { Label("New Note", systemImage: "square.and.pencil") }.keyboardShortcut("n", modifiers: [.command, .shift]) }
            ToolbarItem { Button { app.importMarkdownFiles() } label: { Label("Import Markdown…", systemImage: "square.and.arrow.down") }.help("Import Markdown (.md) files as notes") }
        }
        .overlay { if notes.isEmpty { ContentUnavailableView(query.isEmpty ? "No notes yet" : "No matches", systemImage: "note.text", description: Text(query.isEmpty ? "Create one with ⇧⌘N or from a verse." : "Try other words.")) } }
        .task(id: "\(query)|\(filter)|\(folderId ?? "")|\(app.notesRevision)") { load() }
    }

    func load() {
        guard let svc = app.notes else { return }
        folders = (try? svc.folders()) ?? []
        var list: [Note]
        if filter == "trash" { list = (try? svc.trash()) ?? [] }
        else if !query.trimmingCharacters(in: .whitespaces).isEmpty { list = (try? svc.search(query, limit: 200)) ?? [] }
        else { list = (try? svc.all(limit: 1000)) ?? [] }
        if filter != "trash" {
            list = list.filter { n in
                switch filter {
                case "scripture": return n.verseRef != nil
                case "topic": return n.verseRef == nil && n.type != "daily" && NotesService.dailyDateKey(n.title) == nil
                case "daily": return n.type == "daily" || NotesService.dailyDateKey(n.title) != nil
                case "pinned": return n.pinned
                default: return true
                }
            }
            if let folderId { list = list.filter { $0.folderId == folderId } }
            list = list.enumerated().sorted { ($0.element.pinned ? 0 : 1, $0.offset) < ($1.element.pinned ? 0 : 1, $1.offset) }.map(\.element)
        }
        notes = list
    }
}

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

/// One note: rendered Markdown, or (Edit) the Markdown source with autosave. The native rich editor
/// (TextKit, ProseMirror-compatible Markdown) replaces the source mode in M7.
struct NoteDetailView: View {
    @Environment(AppModel.self) private var app
    let noteId: String
    @State private var note: Note?
    @State private var title = ""
    @State private var content = ""
    @State private var editing = false
    @State private var saveTask: Task<Void, Never>?
    @State private var snapshotTask: Task<Void, Never>?
    /// Content of the last version snapshot (or as opened) — a snapshot is only taken after edits.
    @State private var lastSnapshot: String?
    @State private var loadedId: String?
    @State private var showingHistory = false
    @FocusState private var focus: Field?
    enum Field { case title, body }

    var body: some View {
        Group {
            if let note {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        TextField("Untitled", text: $title).font(.largeTitle.bold()).textFieldStyle(.plain)
                            .focused($focus, equals: .title)
                            .onSubmit { editing = true; focus = .body }
                            .onChange(of: title) { scheduleSave() }
                        if let ref = note.verseRef {
                            Button(verseLabel(ref, note.textId)) {
                                let p = ref.split(separator: ".").map(String.init)
                                if p.count >= 2, let c = Int(p[1]) { app.openScripture(bookId: p[0], chapter: c, verse: p.count > 2 ? Int(p[2]) : nil, textId: note.textId) }
                            }.buttonStyle(.borderless)
                        }
                        if editing {
                            TextEditor(text: $content).font(.system(.body, design: .monospaced)).frame(minHeight: 400).scrollContentBackground(.hidden)
                                .focused($focus, equals: .body)
                                .onChange(of: content) { scheduleSave(); scheduleSnapshot() }
                        } else {
                            MarkdownText(content).textSelection(.enabled)
                        }
                    }
                    .frame(maxWidth: 760, alignment: .leading).padding(24).frame(maxWidth: .infinity)
                }
            } else {
                ContentUnavailableView("Note not found", systemImage: "note.text")
            }
        }
        .navigationTitle(title.isEmpty ? "Untitled" : title)
        .toolbar {
            ToolbarItemGroup {
                Toggle(isOn: $editing) { Label("Edit Markdown", systemImage: "pencil") }.keyboardShortcut("m", modifiers: [.command, .shift])
                if let note {
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
            editing = isNew
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
            ForEach(Array(source.components(separatedBy: "\n").enumerated()), id: \.offset) { _, line in block(line) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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

/// Notes attached to a verse (study inspector "Notes" panel).
struct VerseNotesView: View {
    @Environment(AppModel.self) private var app
    let bookId: String, chapter: Int, verse: Int?, textId: String
    @State private var notes: [Note] = []

    var body: some View {
        Group {
            if let verse {
                List {
                    ForEach(notes) { n in Button { app.openNote(n.id) } label: { NoteRowView(note: n) }.buttonStyle(.plain) }
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
