import SwiftUI
import BereanCore
import BereanNotes
import BereanReference

/// Notes home (the existing iPhone NotesHomePage, after Apple Notes; also the Mac Notes home):
///   Folders home — All Notes · Berean's system folders (Daily, Verse, e-Sword, BibleGateway) · your folder tree · Trash
///   Folder view  — subfolders · Pinned · Today / Previous 7 Days / Previous 30 Days / months (or by status, folder, type)
/// The location lives in the Notes tab (`listFolderId`: nil = Folders home, "all", "sys:<key>", "trash" or a folder id),
/// so tab history and relaunch restore it. Search combines FTS with the selected folder, type and status.
struct NotesHomeView: View {
    @Environment(AppModel.self) private var app
    let tabId: String
    @State private var notes: [Note] = []
    @State private var folders: [NoteFolder] = []
    @State private var trash: [Note] = []
    @State private var query = ""
    @State private var searchMode = NotesWordMode.all
    @State private var searchEverywhere = false
    @State private var typeFilter = NoteTypeFilter.all
    @State private var statusFilter = "all"
    @State private var searchResult: SearchResult?
    @AppStorage("notesHomeSort") private var sort = "modified"        // modified | created | name
    @AppStorage("notesHomeGrouping") private var grouping = "none"    // none | status | folder | type
    @State private var renamingFolder: NoteFolder?
    @State private var newFolderParent: String??                      // .some(nil) = new top-level folder
    @State private var deletingFolder: NoteFolder?
    @State private var folderName = ""
    @State private var confirmEmptyTrash = false

    private enum NoteTypeFilter: String, CaseIterable {
        case all = "All Types", scripture = "Scripture", topic = "Topic", daily = "Daily"
        case idiom = "Idiom", youtube = "YouTube", esword = "e-Sword", biblegateway = "BibleGateway"

        func matches(_ note: Note) -> Bool {
            let scripture = note.verseRef != nil || note.type == "verse"
            let daily = note.type == "daily" || note.type == "journal"
                || (note.type == "general" && (note.title.hasPrefix("Daily — ") || note.title.hasPrefix("Journal — ")))
            switch self {
            case .all: return true
            case .scripture: return scripture
            case .topic: return !scripture && !daily && note.type != "youtube"
            case .daily: return daily
            case .idiom: return note.type == "idiom"
            case .youtube: return note.type == "youtube"
            case .esword: return note.tags.contains("esword")
            case .biblegateway: return note.tags.contains("biblegateway")
            }
        }
    }

    private struct SearchRequest: Equatable {
        let text: String
        let mode: NotesWordMode
        let revision: Int
    }

    private struct SearchResult {
        let request: SearchRequest
        let ids: Set<String>?
    }

    var location: String? { app.findTab(tabId)?.state["listFolderId"]?.stringValue?.string }
    func go(_ loc: String?) { app.update(tabId) { $0.state["listFolderId"] = loc.map { .string(JSString($0)) } ?? .null; $0.title = Self.title(loc, folders) } }

    static let system: [(key: String, name: String, symbol: String)] = [
        ("daily", "Daily Notes", "calendar"), ("verse", "Verse Notes", "book"), ("esword", "e-Sword", "square.and.arrow.down"), ("biblegateway", "BibleGateway", "square.and.arrow.down"),
    ]
    static let statuses: [(id: String, label: String, color: Color)] = [
        ("started", "Started", .gray), ("in-progress", "In Progress", .blue), ("complete", "Complete", .green), ("make-video", "Make Video", .purple), ("archive", "Archive", .brown),
    ]

    static func title(_ loc: String?, _ folders: [NoteFolder]) -> String {
        switch loc {
        case nil: return "Notes"
        case "all": return "All Notes"
        case "trash": return "Trash"
        case let l? where l.hasPrefix("sys:"): return system.first { "sys:\($0.key)" == l }?.name ?? "Notes"
        case let l?: return folders.first { $0.id == l }?.name ?? "Folder"
        }
    }

    var body: some View {
        let request = searchRequest
        VStack(spacing: 0) {
            if location != "trash" {
                searchField
                Divider()
            }
            Group {
                if location == "trash" { trashList }
                else if !request.text.isEmpty || (hasFilters && (location == nil || (hasFolderScope && searchEverywhere))) { searchList }
                else if location == nil { foldersHome }
                else { folderView }
            }
        }
        .navigationTitle(Self.title(location, folders))
        .toolbar {
            ToolbarItemGroup {
                if location != nil {
                    Button { go(parentLocation) } label: { Label("Back", systemImage: "chevron.backward") }.help("Back to \(Self.title(parentLocation, folders))")
                }
                Menu {
                    Picker("Sort", selection: $sort) { Text("Date Edited").tag("modified"); Text("Date Created").tag("created"); Text("Title").tag("name") }
                    Picker("Group", selection: $grouping) { Text("By Date").tag("none"); Text("By Status").tag("status"); Text("By Folder").tag("folder"); Text("By Type").tag("type") }
                    Divider()
                    Button("Import Markdown…") { app.importMarkdownFiles() }
                } label: { Label("View Options", systemImage: "line.3.horizontal.decrease.circle") }
                .menuIndicator(.hidden).help("Sort, group, import")
                Button { folderName = ""; newFolderParent = .some(isUserFolder ? location : nil) } label: { Label("New Folder", systemImage: "folder.badge.plus") }
                    .help("New folder")
                Button { newNoteHere() } label: { Label("New Note", systemImage: "square.and.pencil") }
                    .keyboardShortcut("n", modifiers: [.command, .shift]).help("New note (⇧⌘N)")
            }
        }
        .task(id: app.notesRevision) { load() }
        .task(id: request) { await runSearch(request) }
        .alert("New Folder", isPresented: Binding(get: { newFolderParent != nil }, set: { if !$0 { newFolderParent = nil } })) {
            TextField("Name", text: $folderName)
            Button("Create") { if let p = newFolderParent, !folderName.trimmingCharacters(in: .whitespaces).isEmpty { _ = try? app.notes?.createFolder(folderName, parentId: p) }; newFolderParent = nil }
            Button("Cancel", role: .cancel) { newFolderParent = nil }
        }
        .alert("Rename Folder", isPresented: Binding(get: { renamingFolder != nil }, set: { if !$0 { renamingFolder = nil } })) {
            TextField("Name", text: $folderName)
            Button("Rename") { if let f = renamingFolder { try? app.notes?.renameFolder(f.id, to: folderName) }; renamingFolder = nil }
            Button("Cancel", role: .cancel) { renamingFolder = nil }
        }
        .confirmationDialog("Delete “\(deletingFolder?.name ?? "")”?", isPresented: Binding(get: { deletingFolder != nil }, set: { if !$0 { deletingFolder = nil } }), titleVisibility: .visible) {
            Button("Delete Folder, Keep Notes") { if let f = deletingFolder { try? app.notes?.deleteFolder(f.id); if location == f.id { go(nil) } }; deletingFolder = nil }
            Button("Delete Folder and Its Notes", role: .destructive) { if let f = deletingFolder { _ = try? app.notes?.deleteFolderDeep(f.id); if location == f.id { go(nil) } }; deletingFolder = nil }
        } message: { Text("Kept notes move to the top level. Deleted notes go to Trash, where you can restore them.") }
        .confirmationDialog("Empty Trash?", isPresented: $confirmEmptyTrash, titleVisibility: .visible) {
            Button("Delete \(trash.count) Notes Permanently", role: .destructive) { _ = try? app.notes?.emptyTrash() }
        } message: { Text("This cannot be undone.") }
    }

    var isUserFolder: Bool { if let l = location { return l != "all" && l != "trash" && !l.hasPrefix("sys:") } else { return false } }
    var parentLocation: String? { isUserFolder ? folders.first { $0.id == location }?.parentId : nil }

    func load() {
        guard let s = app.notes else { return }
        notes = (try? s.all(limit: 100_000)) ?? []
        folders = (try? s.folders()) ?? []
        trash = (try? s.trash()) ?? []
    }

    private var searchRequest: SearchRequest {
        SearchRequest(text: query.trimmingCharacters(in: .whitespacesAndNewlines), mode: searchMode, revision: app.notesRevision)
    }

    private func runSearch(_ request: SearchRequest) async {
        guard !Task.isCancelled else { return }
        guard !request.text.isEmpty else { searchResult = nil; return }
        // Keep the store connection on the main actor, and coalesce keystrokes before issuing SQLite queries.
        do { try await Task.sleep(for: .milliseconds(160)) } catch { return }
        guard !Task.isCancelled, request == searchRequest else { return }
        let ids = try? app.notes?.matchingNoteIDs(request.text, mode: request.mode)
        searchResult = SearchResult(request: request, ids: ids)
    }

    func newNoteHere() {
        let id = app.newNote()
        if let id, isUserFolder, let f = location { try? app.notes?.setFolder(id, f) }
    }

    // MARK: search

    private var hasFilters: Bool { typeFilter != .all || statusFilter != "all" }
    private var hasFolderScope: Bool { location != nil && location != "all" && location != "trash" }

    private func passesFilters(_ note: Note) -> Bool {
        guard typeFilter.matches(note) else { return false }
        switch statusFilter {
        case "all": return true
        case "no-status": return note.status?.isEmpty ?? true
        default: return note.status == statusFilter
        }
    }

    var searchField: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
            TextField(hasFolderScope && !searchEverywhere ? "Search this folder" : "Search all notes", text: $query)
                .textFieldStyle(.plain)
                .accessibilityIdentifier("notesSearchField")
            if !query.isEmpty {
                Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary) }
                    .buttonStyle(.plain).accessibilityLabel("Clear search")
            }
            Menu {
                if hasFolderScope {
                    Picker("Search Scope", selection: $searchEverywhere) {
                        Text("This Folder").tag(false)
                        Text("All Notes").tag(true)
                    }
                }
                Picker("Match", selection: $searchMode) {
                    Text("All Words").tag(NotesWordMode.all)
                    Text("Any Word").tag(NotesWordMode.any)
                    Text("Exact Phrase").tag(NotesWordMode.phrase)
                }
                Picker("Type", selection: $typeFilter) {
                    ForEach(NoteTypeFilter.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
                Picker("Status", selection: $statusFilter) {
                    Text("All Statuses").tag("all")
                    Text("No Status").tag("no-status")
                    ForEach(Self.statuses, id: \.id) { Text($0.label).tag($0.id) }
                }
                if hasFilters || searchMode != .all || searchEverywhere {
                    Button("Reset Search Options") {
                        typeFilter = .all
                        statusFilter = "all"
                        searchMode = .all
                        searchEverywhere = false
                    }
                }
            } label: {
                Image(systemName: hasFilters || searchMode != .all || (hasFolderScope && searchEverywhere)
                      ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                    .frame(minWidth: 28, minHeight: 28)
            }
            #if os(macOS)
            .menuStyle(.borderlessButton)
            #endif
            .menuIndicator(.hidden)
            .accessibilityLabel("Notes Search Options")
        }
        .padding(.horizontal, 10).padding(.vertical, 7)
        .background(.quaternary.opacity(0.5), in: .rect(cornerRadius: 9))
        .padding(.horizontal, 16).padding(.vertical, 10)
    }

    @ViewBuilder var searchList: some View {
        let request = searchRequest
        if !request.text.isEmpty, searchResult?.request != request {
            ProgressView("Searching notes…").frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if !request.text.isEmpty, searchResult?.ids == nil {
            ContentUnavailableView("Couldn’t search notes", systemImage: "magnifyingglass")
        } else {
            let global = !hasFolderScope || searchEverywhere
            let candidates = global ? notes : here
            let hits = searchResult?.ids ?? []
            let matching = sorted(candidates.filter { passesFilters($0) && (request.text.isEmpty || hits.contains($0.id)) })
            let matchingFolders = request.text.isEmpty || hasFilters ? [] : folders.filter { folder in
                (global || (isUserFolder && folder.parentId == location))
                    && folder.name.localizedCaseInsensitiveContains(request.text)
            }
            if matching.isEmpty && matchingFolders.isEmpty {
                ContentUnavailableView("No matching notes", systemImage: "magnifyingglass")
            } else {
                List {
                    if !matchingFolders.isEmpty {
                        Section("Folders") { ForEach(matchingFolders) { f in folderRow(f, depth: 0) } }
                    }
                    if !matching.isEmpty {
                        Section("\(matching.count) note\(matching.count == 1 ? "" : "s")") {
                            ForEach(matching) { noteRow($0) }
                        }
                    }
                }
            }
        }
    }

    // MARK: folders home

    func count(_ loc: String) -> Int {
        if loc == "all" { return notes.count }
        if loc.hasPrefix("sys:") { let k = String(loc.dropFirst(4)); return notes.filter { $0.folderId == nil && NotesService.systemFolder($0) == k }.count }
        return notes.filter { $0.folderId == loc }.count
    }

    var foldersHome: some View {
        List {
            Section {
                locationRow("all", "All Notes", "tray.full", count("all"))
                ForEach(Self.system.filter { count("sys:\($0.key)") > 0 || $0.key == "daily" || $0.key == "verse" }, id: \.key) { s in
                    locationRow("sys:\(s.key)", s.name, s.symbol, count("sys:\(s.key)"))
                }
            }
            Section {
                ForEach(tree(parent: nil, depth: 0), id: \.0.id) { f, depth in folderRow(f, depth: depth) }
                if folders.isEmpty {
                    Button { folderName = ""; newFolderParent = .some(nil) } label: { Label("New Folder…", systemImage: "folder.badge.plus") }.buttonStyle(.plain).foregroundStyle(.secondary)
                }
            } header: { Text("My Folders") }
            Section { locationRow("trash", "Trash", "trash", trash.count) }
            let recent = Array(notes.sorted { $0.updatedAt > $1.updatedAt }.prefix(5))
            if !recent.isEmpty { Section("Recently Edited") { ForEach(recent) { noteRow($0) } } }
        }
    }

    func tree(parent: String?, depth: Int) -> [(NoteFolder, Int)] {
        folders.filter { $0.parentId == parent }.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            .flatMap { [($0, depth)] + tree(parent: $0.id, depth: depth + 1) }
    }

    func locationRow(_ loc: String, _ name: String, _ symbol: String, _ n: Int) -> some View {
        Button { go(loc) } label: {
            HStack { Label(name, systemImage: symbol); Spacer(); Text("\(n)").foregroundStyle(.secondary).monospacedDigit(); Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary) }
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(name), \(n) notes")
    }

    func folderRow(_ f: NoteFolder, depth: Int) -> some View {
        Button { query = ""; go(f.id) } label: {
            HStack {
                Label(f.name, systemImage: "folder").padding(.leading, CGFloat(depth) * 16)
                Spacer()
                Text("\(count(f.id))").foregroundStyle(.secondary).monospacedDigit()
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
            }.contentShape(.rect)
        }
        .buttonStyle(.plain)
        .contextMenu {
            Button("New Note Here") { if let id = app.newNote() { try? app.notes?.setFolder(id, f.id) } }
            Button("New Subfolder…") { folderName = ""; newFolderParent = .some(f.id) }
            Button("Rename…") { folderName = f.name; renamingFolder = f }
            Menu("Move to") {
                Button("Top Level") { _ = try? app.notes?.setFolderParent(f.id, nil) }
                ForEach(folders.filter { $0.id != f.id }) { o in Button(o.name) { _ = try? app.notes?.setFolderParent(f.id, o.id) } }
            }
            Divider()
            Button("Delete…", role: .destructive) { deletingFolder = f }
        }
    }

    // MARK: folder view

    var here: [Note] {
        switch location {
        case "all": return notes
        case let l? where l.hasPrefix("sys:"): let k = String(l.dropFirst(4)); return notes.filter { $0.folderId == nil && NotesService.systemFolder($0) == k }
        case let l?: return notes.filter { $0.folderId == l }
        default: return []
        }
    }

    func sorted(_ ns: [Note]) -> [Note] {
        switch sort {
        case "name": return ns.sorted { $0.displayTitle.localizedCaseInsensitiveCompare($1.displayTitle) == .orderedAscending }
        case "created": return ns.sorted { $0.createdAt > $1.createdAt }
        default: return ns.sorted { $0.updatedAt > $1.updatedAt }
        }
    }

    struct NoteSection: Identifiable { var id: String; var title: String; var notes: [Note] }

    var sections: [NoteSection] {
        let ns = here.filter(passesFilters)
        var out: [NoteSection] = []
        let pinned = sorted(ns.filter(\.pinned))
        if !pinned.isEmpty { out.append(NoteSection(id: "pinned", title: "Pinned", notes: pinned)) }
        let rest = ns.filter { !$0.pinned }
        func bucket(_ key: (Note) -> (String, String)) {
            var order: [String] = [], map: [String: (String, [Note])] = [:]
            for n in sorted(rest) { let (id, t) = key(n); if map[id] == nil { order.append(id); map[id] = (t, []) }; map[id]!.1.append(n) }
            out += order.map { NoteSection(id: $0, title: map[$0]!.0, notes: map[$0]!.1) }
        }
        switch grouping {
        case "status": bucket { n in Self.statuses.first { $0.id == n.status }.map { ($0.id, $0.label) } ?? ("none", "No Status") }
        case "folder": bucket { n in n.folderId.flatMap { id in folders.first { $0.id == id } }.map { ($0.id, $0.name) } ?? ("none", "No Folder") }
        case "type": bucket { n in NotesService.systemFolder(n) == "daily" ? ("daily", "Daily") : n.verseRef != nil ? ("verse", "Scripture") : ("topic", "Topic") }
        default:
            if sort == "name" { if !rest.isEmpty { out.append(NoteSection(id: "notes", title: "Notes", notes: sorted(rest))) } }
            else { bucket { n in Self.recency(sort == "created" ? n.createdAt : n.updatedAt) } }
        }
        return out
    }

    /// noteRecency.ts `recencySectionOf`.
    static func recency(_ ms: Int64) -> (String, String) {
        let cal = Calendar.current
        let d = Date(timeIntervalSince1970: Double(ms) / 1000)
        let days = cal.dateComponents([.day], from: cal.startOfDay(for: d), to: cal.startOfDay(for: Date())).day ?? 0
        if days <= 0 { return ("today", "Today") }
        if days <= 7 { return ("prev7", "Previous 7 Days") }
        if days <= 30 { return ("prev30", "Previous 30 Days") }
        let sameYear = cal.component(.year, from: d) == cal.component(.year, from: Date())
        let f = DateFormatter(); f.setLocalizedDateFormatFromTemplate(sameYear ? "MMMM" : "MMMM yyyy")
        let c = cal.dateComponents([.year, .month], from: d)
        return (String(format: "m-%04d-%02d", c.year ?? 0, c.month ?? 0), f.string(from: d))
    }

    var folderView: some View {
        List {
            let subs = isUserFolder ? folders.filter { $0.parentId == location } : []
            let visibleSections = sections
            let visibleCount = visibleSections.reduce(0) { $0 + $1.notes.count }
            Section {
                Text("\(visibleCount) note\(visibleCount == 1 ? "" : "s")\(subs.isEmpty ? "" : " · \(subs.count) folder\(subs.count == 1 ? "" : "s")")").font(.callout).foregroundStyle(.secondary)
            }
            if !subs.isEmpty { Section("Folders") { ForEach(subs) { folderRow($0, depth: 0) } } }
            ForEach(visibleSections) { s in Section(s.title) { ForEach(s.notes) { noteRow($0) } } }
            if visibleCount == 0 && hasFilters {
                ContentUnavailableView("No matching notes", systemImage: "line.3.horizontal.decrease.circle")
            } else if visibleCount == 0 {
                ContentUnavailableView {
                    Label("No notes here", systemImage: "note.text")
                } actions: { Button("New Note") { newNoteHere() } }
            }
        }
    }

    // MARK: rows

    func preview(_ n: Note) -> String {
        let plain = MarkdownLiveSpans.plainText(n.content)
        let request = searchRequest
        if !request.text.isEmpty {
            let words = NotesService.cleanWords(request.text)
            let terms = request.mode == .phrase ? [words.joined(separator: " ")] : words
            let match = terms.compactMap { plain.range(of: $0, options: [.caseInsensitive, .diacriticInsensitive]) }
                .min { $0.lowerBound < $1.lowerBound }
            if let match {
                let start = plain.index(match.lowerBound, offsetBy: -30, limitedBy: plain.startIndex) ?? plain.startIndex
                let end = plain.index(match.upperBound, offsetBy: 100, limitedBy: plain.endIndex) ?? plain.endIndex
                let excerpt = plain[start..<end].split(whereSeparator: \.isWhitespace).joined(separator: " ")
                return (start == plain.startIndex ? "" : "…") + excerpt + (end == plain.endIndex ? "" : "…")
            }
        }
        return plain.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.first { !$0.isEmpty && $0 != n.title } ?? ""
    }

    static func dateLabel(_ ms: Int64) -> String {
        let d = Date(timeIntervalSince1970: Double(ms) / 1000)
        let cal = Calendar.current
        let days = cal.dateComponents([.day], from: cal.startOfDay(for: d), to: cal.startOfDay(for: Date())).day ?? 0
        if days <= 0 { return d.formatted(date: .omitted, time: .shortened) }
        if days <= 6 { return d.formatted(.dateTime.weekday(.wide)) }
        return d.formatted(date: .numeric, time: .omitted)
    }

    func noteRow(_ n: Note) -> some View {
        Button { app.openNote(n.id) } label: {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    if n.pinned { Image(systemName: "pin.fill").font(.caption2).foregroundStyle(.orange) }
                    Text(n.displayTitle).font(.body.weight(.semibold)).lineLimit(1)
                    Spacer()
                    if let st = Self.statuses.first(where: { $0.id == n.status }) {
                        Text(st.label).font(.caption2.weight(.medium)).foregroundStyle(st.color).padding(.horizontal, 6).padding(.vertical, 1).background(st.color.opacity(0.15), in: .capsule)
                    }
                }
                HStack(spacing: 6) {
                    Text(Self.dateLabel(n.updatedAt)).font(.caption).foregroundStyle(.secondary)
                    Text(preview(n)).font(.caption).foregroundStyle(.secondary).lineLimit(searchRequest.text.isEmpty ? 1 : 2)
                }
                if location == "all" || location == nil || !query.isEmpty, let f = n.folderId.flatMap({ id in folders.first { $0.id == id } }) {
                    Label(f.name, systemImage: "folder").font(.caption2).foregroundStyle(.tertiary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .contextMenu { noteMenu(n) }
        #if os(iOS)
        .swipeActions(edge: .leading) { Button(n.pinned ? "Unpin" : "Pin") { try? app.notes?.setPinned(n.id, !n.pinned) }.tint(.orange) }
        .swipeActions(edge: .trailing) { Button("Delete", role: .destructive) { try? app.notes?.delete(n.id) } }
        #endif
    }

    @ViewBuilder func noteMenu(_ n: Note) -> some View {
        Button("Open") { app.openNote(n.id) }
        Button(n.pinned ? "Unpin" : "Pin") { try? app.notes?.setPinned(n.id, !n.pinned) }
        if NotesService.systemFolder(n) == nil || n.folderId != nil {
            Menu("Move to Folder") {
                Button("No Folder") { try? app.notes?.setFolder(n.id, nil) }
                ForEach(tree(parent: nil, depth: 0), id: \.0.id) { f, d in Button(String(repeating: "  ", count: d) + f.name) { try? app.notes?.setFolder(n.id, f.id) } }
            }
        }
        Menu("Status") {
            Button("None") { _ = try? app.notes?.update(n.id, .init(status: .some(""))) }
            ForEach(Self.statuses, id: \.id) { s in Button(s.label) { _ = try? app.notes?.update(n.id, .init(status: .some(s.id))) } }
        }
        Button("Duplicate") { _ = try? app.notes?.create(.init(type: n.type, title: n.title + " copy", content: n.content, verseRef: n.verseRef, color: n.color, tags: n.tags, folderId: n.folderId)) }
        Button("Export as Markdown…") { app.exportNote(n.id) }
        Divider()
        Button("Move to Trash", role: .destructive) { try? app.notes?.delete(n.id) }
    }

    // MARK: trash

    var trashList: some View {
        List {
            if trash.isEmpty { ContentUnavailableView("Trash is empty", systemImage: "trash") }
            else {
                Section {
                    Button("Empty Trash…", role: .destructive) { confirmEmptyTrash = true }
                } footer: { Text("Restored notes go back to their folder, or to the top level if the folder is gone.") }
                ForEach(trash) { n in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(n.displayTitle).font(.body.weight(.semibold))
                        Text("Deleted \(n.deletedAt.map { Self.dateLabel($0) } ?? "")").font(.caption).foregroundStyle(.secondary)
                    }
                    .contextMenu {
                        Button("Restore") { try? app.notes?.restore(n.id) }
                        Button("Delete Permanently", role: .destructive) { _ = try? app.notes?.purgeTrashItem(n.id) }
                    }
                    #if os(iOS)
                    .swipeActions(edge: .leading) { Button("Restore") { try? app.notes?.restore(n.id) }.tint(.blue) }
                    .swipeActions(edge: .trailing) { Button("Delete", role: .destructive) { _ = try? app.notes?.purgeTrashItem(n.id) } }
                    #endif
                }
            }
        }
    }
}
