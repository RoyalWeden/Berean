import SwiftUI
import BereanCore
import BereanNotes
import BereanReference

struct NotesFolderScrollContext: Hashable {
    let location: String?
    let sort: String
    let grouping: String
    let type: String
    let status: String
}

func noteSearchPreview(_ note: Note, query: String, mode: NotesWordMode = .all) -> String {
    let plain = noteExcerptText(note.content)
    if !query.isEmpty {
        let words = NotesService.cleanWords(query)
        let terms = mode == .phrase ? [words.joined(separator: " ")] : words
        let match = terms.compactMap { plain.range(of: $0, options: [.caseInsensitive, .diacriticInsensitive]) }
            .min { $0.lowerBound < $1.lowerBound }
        if let match {
            let start = plain.index(match.lowerBound, offsetBy: -30, limitedBy: plain.startIndex) ?? plain.startIndex
            let end = plain.index(match.upperBound, offsetBy: 100, limitedBy: plain.endIndex) ?? plain.endIndex
            let excerpt = plain[start..<end].split(whereSeparator: \.isWhitespace).joined(separator: " ")
            return (start == plain.startIndex ? "" : "…") + excerpt + (end == plain.endIndex ? "" : "…")
        }
    }
    return plain.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.first { !$0.isEmpty && $0 != note.title } ?? ""
}

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
    @State private var browseOptions = BrowseOptions()
    @State private var searchResult: SearchResult?
    @AppStorage("notesHomeSort") private var sort = "modified"        // modified | created | name
    @AppStorage("nativeNotesHomeLayout") private var layout = "list"       // device-local list | gallery
    @AppStorage("nativeNotesCollapsedSections") private var collapsedSectionsData = Data()
    @AppStorage("notesHomeGrouping") private var grouping = "none"    // none | status | folder | type
    @State private var renamingFolder: NoteFolder?
    @State private var newFolderParent: String??                      // .some(nil) = new top-level folder
    @State private var deletingFolder: NoteFolder?
    @State private var folderName = ""
    @State private var confirmEmptyTrash = false
    @State private var pendingTrash: [String] = []
    @State private var searchScroll = ScrollPosition(idType: String.self)
    @State private var restoredSearchPosition: SearchPosition?
    @State private var visibleFolderRow: String?
    @State private var loadedNotes = false
    /// Select mode (original Notes home Edit): tap rows to select, then Pin / Move / Trash them together.
    @State private var selecting = false
    @State private var selectedNotes: Set<String> = []

    struct BrowseOptions: Hashable {
        var query = ""
        var searchMode = NotesWordMode.all
        var searchEverywhere = false
        var typeFilter = NoteTypeFilter.all
        var statusFilter = "all"
    }

    struct SearchPosition: Hashable {
        let folder: String?
        let options: BrowseOptions
        let sort: String
    }

    enum NoteTypeFilter: String, CaseIterable {
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
                else if !request.text.isEmpty || (hasFilters && (location == nil || (hasFolderScope && browseOptions.searchEverywhere))) { searchList }
                else if location == nil { foldersHome }
                else { folderView }
            }
        }
        .navigationTitle(Self.title(location, folders))
        .toolbar {
            #if os(iOS)
            // iPhone: a compact bar (Back · Select · New Note · ⋯) so the title keeps its room.
            if location != nil {
                ToolbarItem(placement: .topBarLeading) {
                    Button { go(parentLocation) } label: { Label("Back", systemImage: "chevron.backward") }
                }
            }
            ToolbarItemGroup(placement: .topBarTrailing) {
                if location != nil, location != "trash" {
                    Button(selecting ? "Done" : "Select") {
                        withAnimation(.snappy) { selecting.toggle(); selectedNotes = [] }
                    }
                }
                Button { newNoteHere() } label: { Label("New Note", systemImage: "square.and.pencil") }
                Menu {
                    Button("Today's Note", systemImage: "sun.max") { app.openTodayDailyNote() }
                    Button("Calendar", systemImage: "calendar") { app.openCalendar(newTab: false) }
                    Button("New Folder", systemImage: "folder.badge.plus") { folderName = ""; newFolderParent = .some(isUserFolder ? location : nil) }
                    Divider()
                    Button("Import Markdown…") { app.importMarkdownFiles() }
                } label: { Label("More", systemImage: "ellipsis") }
            }
            #else
            ToolbarItemGroup {
                if location != nil {
                    Button { go(parentLocation) } label: { Label("Back", systemImage: "chevron.backward") }.help("Back to \(Self.title(parentLocation, folders))")
                }
                // Tap: today's note. Right-click: the calendar — original Notes home "Today".
                Button { app.openTodayDailyNote() } label: { Label("Today's Note", systemImage: "calendar") }
                    .contextMenu { Button("Open Calendar", systemImage: "calendar") { app.openCalendar(newTab: false) } }
                    .help("Today's note (right-click for the calendar)")
                Button { folderName = ""; newFolderParent = .some(isUserFolder ? location : nil) } label: { Label("New Folder", systemImage: "folder.badge.plus") }
                    .help("New folder")
                if location != nil, location != "trash" {
                    Button(selecting ? "Done" : "Select") {
                        withAnimation(.snappy) { selecting.toggle(); selectedNotes = [] }
                    }
                    .help(selecting ? "Finish selecting" : "Select notes to pin, move or delete together")
                }
                Button { newNoteHere() } label: { Label("New Note", systemImage: "square.and.pencil") }
                    .keyboardShortcut("n", modifiers: [.command, .shift]).help("New note (⇧⌘N)")
            }
            #endif
        }
        .onAppear {
            browseOptions = app.notesBrowseOptions[tabId] ?? BrowseOptions()
        }
        .onChange(of: browseOptions) { _, options in
            app.notesBrowseOptions[tabId] = options
        }
        .onChange(of: app.notesSearchSeed) { _, _ in
            if let seeded = app.notesBrowseOptions[tabId] { browseOptions = seeded }
        }
        .task(id: app.notesRevision) { load(); loadedNotes = true }
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
        .alert(pendingTrash.count == 1 ? "Move Note to Trash?" : "Move \(pendingTrash.count) Notes to Trash?",
               isPresented: Binding(get: { !pendingTrash.isEmpty }, set: { if !$0 { pendingTrash = [] } }),
               presenting: pendingTrash) { ids in
            Button("Move to Trash", role: .destructive) { moveToTrash(ids) }
            Button("Cancel", role: .cancel) {}
        } message: { _ in
            Text("You can restore notes from Trash.")
        }
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
        SearchRequest(text: browseOptions.query.trimmingCharacters(in: .whitespacesAndNewlines), mode: browseOptions.searchMode, revision: app.notesRevision)
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

    private var hasFilters: Bool { browseOptions.typeFilter != .all || browseOptions.statusFilter != "all" }
    private var hasFolderScope: Bool { location != nil && location != "all" && location != "trash" }

    private func passesFilters(_ note: Note) -> Bool {
        guard browseOptions.typeFilter.matches(note) else { return false }
        switch browseOptions.statusFilter {
        case "all": return true
        case "no-status": return note.status?.isEmpty ?? true
        default: return note.status == browseOptions.statusFilter
        }
    }

    var searchField: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
            TextField(hasFolderScope && !browseOptions.searchEverywhere ? "Search this folder" : "Search all notes", text: $browseOptions.query)
                .textFieldStyle(.plain)
                .accessibilityIdentifier("notesSearchField")
            if !browseOptions.query.isEmpty {
                Button { browseOptions.query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary) }
                    .buttonStyle(.interactivePlain).accessibilityLabel("Clear search")
            }
            Menu {
                Section("View") { viewOptions }
                Section("Search and Filters") {
                    if hasFolderScope {
                        Picker("Search Scope", selection: $browseOptions.searchEverywhere) {
                            Text("This Folder").tag(false)
                            Text("All Notes").tag(true)
                        }
                    }
                    Picker("Match", selection: $browseOptions.searchMode) {
                        Text("All Words").tag(NotesWordMode.all)
                        Text("Any Word").tag(NotesWordMode.any)
                        Text("Exact Phrase").tag(NotesWordMode.phrase)
                    }
                    Picker("Type", selection: $browseOptions.typeFilter) {
                        ForEach(NoteTypeFilter.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                    }
                    Picker("Status", selection: $browseOptions.statusFilter) {
                        Text("All Statuses").tag("all")
                        Text("No Status").tag("no-status")
                        ForEach(Self.statuses, id: \.id) { Text($0.label).tag($0.id) }
                    }
                    if hasFilters || browseOptions.searchMode != .all || browseOptions.searchEverywhere {
                        Button("Reset Search Options") {
                            browseOptions.typeFilter = .all
                            browseOptions.statusFilter = "all"
                            browseOptions.searchMode = .all
                            browseOptions.searchEverywhere = false
                        }
                    }
                }
                #if os(macOS)
                Button("Import Markdown…") { app.importMarkdownFiles() }
                #endif
            } label: {
                Image(systemName: hasFilters || browseOptions.searchMode != .all || (hasFolderScope && browseOptions.searchEverywhere)
                      ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                    .frame(minWidth: 36, minHeight: 36)
            }
            #if os(macOS)
            .menuStyle(.borderlessButton).clickableCursor()
            #endif
            .menuIndicator(.hidden)
            .accessibilityLabel("Notes Options")
            .help("Sort, group, and filter notes")
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
            let global = !hasFolderScope || browseOptions.searchEverywhere
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
                let position = SearchPosition(folder: location, options: browseOptions, sort: sort)
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        if !matchingFolders.isEmpty {
                            folderSectionHeading("Folders")
                            ForEach(matchingFolders) { folder in
                                folderRow(folder, depth: 0).padding(.vertical, 6)
                            }
                        }
                        if !matching.isEmpty {
                            folderSectionHeading("\(matching.count) note\(matching.count == 1 ? "" : "s")")
                            noteCollection(matching, searchPosition: position)
                        }
                    }
                    .padding(.horizontal, 16)
                    .scrollTargetLayout()
                }
                .scrollPosition($searchScroll)
                .onScrollGeometryChange(for: CGFloat.self) { geometry in
                    max(0, geometry.contentOffset.y + geometry.contentInsets.top)
                } action: { _, offset in
                    guard app.activeTab?.id == tabId, restoredSearchPosition == position else { return }
                    app.notesSearchOffsets[tabId, default: [:]][position] = offset
                }
                .onScrollPhaseChange { old, new in
                    guard old != .idle, new == .idle, old != .animating || searchScroll.isPositionedByUser,
                          app.activeTab?.id == tabId, restoredSearchPosition == position else { return }
                    app.notesSearchReturnRows[tabId]?.removeValue(forKey: position)
                }
                .task(id: app.activeTab?.id == tabId ? position : nil) {
                    restoredSearchPosition = nil
                    await Task.yield()
                    guard !Task.isCancelled, app.activeTab?.id == tabId else { return }
                    let anchor = app.notesSearchReturnRows[tabId]?[position]
                    if let anchor, matching.contains(where: { $0.id == anchor }) {
                        searchScroll.scrollTo(id: anchor, anchor: .center)
                    } else {
                        if anchor != nil { app.notesSearchReturnRows[tabId]?.removeValue(forKey: position) }
                        if let offset = app.notesSearchOffsets[tabId]?[position] {
                            searchScroll.scrollTo(y: offset)
                        } else {
                            searchScroll.scrollTo(edge: .top)
                        }
                    }
                    restoredSearchPosition = position
                }
                .id(position)
            }
        }
    }

    // MARK: folders home

    func count(_ loc: String) -> Int {
        if loc == "all" { return notes.count }
        if loc.hasPrefix("sys:") { let k = String(loc.dropFirst(4)); return notes.filter { $0.folderId == nil && NotesService.systemFolder($0) == k }.count }
        return notes.filter { $0.folderId == loc }.count
    }

    @ViewBuilder var foldersHome: some View {
        #if os(macOS)
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 2) {
                    locationRow("all", "All Notes", "tray.full", count("all"))
                    ForEach(Self.system.filter { count("sys:\($0.key)") > 0 || $0.key == "daily" || $0.key == "verse" }, id: \.key) { s in
                        Divider().padding(.leading, 36)
                        locationRow("sys:\(s.key)", s.name, s.symbol, count("sys:\(s.key)"))
                    }
                }
                .modifier(NotesHomeGlassSurface())

                VStack(alignment: .leading, spacing: 10) {
                    Text("My Folders").font(.headline).accessibilityAddTraits(.isHeader)
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(tree(parent: nil, depth: 0), id: \.0.id) { f, depth in
                            folderRow(f, depth: depth)
                        }
                        if folders.isEmpty {
                            Button { folderName = ""; newFolderParent = .some(nil) } label: {
                                Label("New Folder…", systemImage: "folder.badge.plus")
                                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                                    .padding(.horizontal, 8).contentShape(.rect)
                            }
                            .buttonStyle(NotesHomeRowButtonStyle())
                        }
                    }
                    .modifier(NotesHomeGlassSurface())
                }

                locationRow("trash", "Trash", "trash", trash.count)
                    .modifier(NotesHomeGlassSurface())

                let recent = Array(notes.sorted { $0.updatedAt > $1.updatedAt }.prefix(5))
                if !recent.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Recently Edited").font(.headline).accessibilityAddTraits(.isHeader)
                        if layout == "gallery" {
                            noteCollection(recent)
                        } else {
                            VStack(alignment: .leading, spacing: 2) {
                                ForEach(recent) { noteRow($0) }
                            }
                            .modifier(NotesHomeGlassSurface())
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
        }
        .background(Color(nsColor: .windowBackgroundColor))
        #else
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
                    Button { folderName = ""; newFolderParent = .some(nil) } label: {
                        Label("New Folder…", systemImage: "folder.badge.plus")
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .contentShape(.rect)
                    }.buttonStyle(NotesHomeRowButtonStyle()).foregroundStyle(.secondary)
                }
            } header: { Text("My Folders") }
            Section { locationRow("trash", "Trash", "trash", trash.count) }
            let recent = Array(notes.sorted { $0.updatedAt > $1.updatedAt }.prefix(5))
            if !recent.isEmpty { Section("Recently Edited") { ForEach(recent) { noteRow($0) } } }
        }
        #endif
    }

    func tree(parent: String?, depth: Int) -> [(NoteFolder, Int)] {
        folders.filter { $0.parentId == parent }.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
            .flatMap { [($0, depth)] + tree(parent: $0.id, depth: depth + 1) }
    }

    func locationRow(_ loc: String, _ name: String, _ symbol: String, _ n: Int) -> some View {
        Button { go(loc) } label: {
            HStack(spacing: 12) {
                Image(systemName: symbol).frame(width: 20).foregroundStyle(.tint)
                Text(name).frame(maxWidth: .infinity, alignment: .leading)
                Text("\(n)").foregroundStyle(.secondary).monospacedDigit()
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
            }
            .font(.body).multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .padding(.horizontal, 8)
            .contentShape(.rect)
        }
        .buttonStyle(NotesHomeRowButtonStyle())
        .accessibilityLabel("\(name), \(n) notes")
    }

    func folderRow(_ f: NoteFolder, depth: Int) -> some View {
        Button { browseOptions.query = ""; go(f.id) } label: {
            HStack(spacing: 12) {
                Image(systemName: "folder").frame(width: 20).foregroundStyle(.tint)
                    .padding(.leading, CGFloat(depth) * 16)
                Text(f.name).frame(maxWidth: .infinity, alignment: .leading)
                Text("\(count(f.id))").foregroundStyle(.secondary).monospacedDigit()
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
            }
            .font(.body).multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .padding(.horizontal, 8)
            .contentShape(.rect)
        }
        .buttonStyle(NotesHomeRowButtonStyle())
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

    private var folderScrollContext: NotesFolderScrollContext {
        NotesFolderScrollContext(location: location, sort: sort, grouping: grouping,
                                 type: browseOptions.typeFilter.rawValue, status: browseOptions.statusFilter)
    }

    var folderView: some View {
        let context = folderScrollContext
        let subs = isUserFolder ? folders.filter { $0.parentId == location } : []
        let visibleSections = sections
        let expandedNotes = visibleSections.filter { !isSectionCollapsed("notes:" + $0.id) }.flatMap(\.notes)
        let visibleCount = visibleSections.reduce(0) { $0 + $1.notes.count }
        return ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    Text("\(visibleCount) note\(visibleCount == 1 ? "" : "s")\(subs.isEmpty ? "" : " · \(subs.count) folder\(subs.count == 1 ? "" : "s")")")
                        .font(.callout).foregroundStyle(.secondary)
                        .padding(.vertical, 8)
                    if !subs.isEmpty {
                        collapsibleSectionHeading("Folders", id: "subfolders", count: subs.count)
                        if !isSectionCollapsed("subfolders") {
                            ForEach(subs) { folder in
                                folderRow(folder, depth: 0).padding(.vertical, 6).id("folder:" + folder.id)
                            }
                        }
                    }
                    ForEach(visibleSections) { section in
                        collapsibleSectionHeading(section.title, id: "notes:" + section.id, count: section.notes.count,
                                                  selectedCount: section.notes.filter { selectedNotes.contains($0.id) }.count)
                        if !isSectionCollapsed("notes:" + section.id) { noteCollection(section.notes) }
                    }
                    if loadedNotes && visibleCount == 0 && hasFilters {
                        ContentUnavailableView("No matching notes", systemImage: "line.3.horizontal.decrease.circle")
                    } else if loadedNotes && visibleCount == 0 {
                        ContentUnavailableView {
                            Label("No notes here", systemImage: "note.text")
                        } actions: { Button("New Note") { newNoteHere() } }
                    }
                }
                .padding(.horizontal, 16)
                .scrollTargetLayout()
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if selecting { bulkBar(visibleSections.flatMap(\.notes), selectable: expandedNotes) }
            }
            .scrollPosition(id: $visibleFolderRow, anchor: .top)
            .task(id: loadedNotes ? context : nil) {
                guard loadedNotes, !Task.isCancelled else { return }
                visibleFolderRow = nil
                await Task.yield()
                guard !Task.isCancelled, app.activeTab?.id == tabId else { return }
                if let saved = app.notesFolderPositions[tabId]?[context] {
                    let collapsedSection = visibleSections.first { section in
                        isSectionCollapsed("notes:" + section.id) && section.notes.contains { "note:" + $0.id == saved }
                    }
                    let hiddenFolder = isSectionCollapsed("subfolders") && subs.contains { "folder:" + $0.id == saved }
                    let target = collapsedSection.map { sectionAnchor("notes:" + $0.id) }
                        ?? (hiddenFolder ? sectionAnchor("subfolders") : saved)
                    proxy.scrollTo(target, anchor: .top)
                }
            }
            .onScrollPhaseChange { old, new in
                guard old != .idle, new == .idle, app.activeTab?.id == tabId,
                      let visibleFolderRow else { return }
                app.notesFolderPositions[tabId, default: [:]][context] = visibleFolderRow
            }
        }
        .id(context)
        #if os(macOS)
        .background(Color(nsColor: .windowBackgroundColor))
        #endif
    }

    /// Device-local disclosure state, independent for each folder and grouping. Missing keys are expanded.
    private var collapsedSectionKeys: Set<String> {
        (try? JSONDecoder().decode(Set<String>.self, from: collapsedSectionsData)) ?? []
    }

    private func sectionKey(_ id: String) -> String {
        // Encode components so folder IDs cannot collide with grouping or section IDs.
        let data = (try? JSONEncoder().encode([location ?? "", grouping, id])) ?? Data()
        return data.base64EncodedString()
    }

    private func sectionAnchor(_ id: String) -> String { "section:" + id }

    private func isSectionCollapsed(_ id: String) -> Bool {
        collapsedSectionKeys.contains(sectionKey(id))
    }

    private func collapsibleSectionHeading(_ title: String, id: String, count: Int, selectedCount: Int = 0) -> some View {
        let collapsed = isSectionCollapsed(id)
        return Button {
            var keys = collapsedSectionKeys
            let key = sectionKey(id)
            if collapsed { keys.remove(key) } else { keys.insert(key) }
            if let data = try? JSONEncoder().encode(keys) {
                withAnimation(.snappy) { collapsedSectionsData = data }
            }
        } label: {
            HStack(spacing: 6) {
                Text(title).font(.headline).foregroundStyle(.primary)
                Text("\(count)").monospacedDigit()
                Spacer(minLength: 8)
                if selecting && selectedCount > 0 {
                    Text("\(selectedCount) selected").monospacedDigit()
                }
                Image(systemName: collapsed ? "chevron.right" : "chevron.down")
                    .font(.caption2.weight(.semibold))
            }
            .font(.subheadline).foregroundStyle(.secondary)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.interactivePlain)
        .id(sectionAnchor(id))
        .accessibilityLabel("\(title), \(count)\(selectedCount > 0 ? ", \(selectedCount) selected" : "")")
        .accessibilityValue(collapsed ? "Collapsed" : "Expanded")
        .accessibilityHint(collapsed ? "Expand section" : "Collapse section")
        .accessibilityAddTraits(.isHeader)
    }

    private func folderSectionHeading(_ title: String) -> some View {
        Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
            .padding(.top, 10).padding(.bottom, 4)
            .accessibilityAddTraits(.isHeader)
    }

    // MARK: rows

    func preview(_ n: Note) -> String {
        noteSearchPreview(n, query: searchRequest.text, mode: searchRequest.mode)
    }

    static func dateLabel(_ ms: Int64) -> String {
        let d = Date(timeIntervalSince1970: Double(ms) / 1000)
        let cal = Calendar.current
        let days = cal.dateComponents([.day], from: cal.startOfDay(for: d), to: cal.startOfDay(for: Date())).day ?? 0
        if days <= 0 { return d.formatted(date: .omitted, time: .shortened) }
        if days <= 6 { return d.formatted(.dateTime.weekday(.wide)) }
        return d.formatted(date: .numeric, time: .omitted)
    }

    @ViewBuilder private var viewOptions: some View {
        Picker("Layout", selection: $layout) {
            Label("List", systemImage: "list.bullet").tag("list")
            Label("Gallery", systemImage: "square.grid.2x2").tag("gallery")
        }
        .pickerStyle(.menu)
        Picker("Sort", selection: $sort) { Text("Date Edited").tag("modified"); Text("Date Created").tag("created"); Text("Title").tag("name") }
            .pickerStyle(.menu)
        Picker("Group", selection: $grouping) { Text("By Date").tag("none"); Text("By Status").tag("status"); Text("By Folder").tag("folder"); Text("By Type").tag("type") }
            .pickerStyle(.menu)
    }

    /// A daily note reads as its long date ("Sabbath, November 14, 2026"); others use their title.
    static func rowTitle(_ n: Note) -> String {
        if n.type == "daily" || n.type == "journal", let key = NotesService.dailyDateKey(n.title),
           let long = NotesService.dailyDisplayTitle(key) { return long }
        return n.displayTitle
    }

    private static func noteTitle(_ note: Note) -> some View {
        HStack(spacing: 6) {
            if let icon = note.icon { Text(icon).accessibilityHidden(true) }
            Text(rowTitle(note))
        }
    }

    /// Floating actions for the selected notes.
    func bulkBar(_ visible: [Note], selectable: [Note]? = nil) -> some View {
        let selectableIDs = Set((selectable ?? visible).map(\.id))
        let allSelected = !selectableIDs.isEmpty && selectableIDs.isSubset(of: selectedNotes)
        let ids = visible.map(\.id).filter(selectedNotes.contains)
        let allPinned = !ids.isEmpty && visible.filter { selectedNotes.contains($0.id) }.allSatisfy(\.pinned)
        return HStack(spacing: 14) {
            Button(allSelected || (selectableIDs.isEmpty && !ids.isEmpty) ? "Deselect All"
                   : selectableIDs.count == visible.count ? "Select All" : "Select Visible") {
                if allSelected || (selectableIDs.isEmpty && !ids.isEmpty) { selectedNotes = [] }
                else { selectedNotes.formUnion(selectableIDs) }
            }
            .disabled(selectableIDs.isEmpty && ids.isEmpty)
            Text("\(ids.count) selected").font(.callout).foregroundStyle(.secondary).monospacedDigit()
            Spacer(minLength: 8)
            Button(allPinned ? "Unpin" : "Pin", systemImage: allPinned ? "pin.slash" : "pin") {
                app.attempt("Couldn’t change pins") { for id in ids { try app.notes?.setPinned(id, !allPinned) } }
                selectedNotes = []
            }
            .disabled(ids.isEmpty)
            Menu {
                Button("No Folder") { app.attempt("Couldn’t move the notes") { for id in ids { try app.notes?.setFolder(id, nil) } }; selectedNotes = [] }
                ForEach(tree(parent: nil, depth: 0), id: \.0.id) { f, d in
                    Button(String(repeating: "  ", count: d) + f.name) {
                        app.attempt("Couldn’t move the notes") { for id in ids { try app.notes?.setFolder(id, f.id) } }
                        selectedNotes = []
                    }
                }
            } label: { Label("Move", systemImage: "folder") }
            .disabled(ids.isEmpty)
            let chosen = visible.filter { selectedNotes.contains($0.id) }
            ShareLink(item: chosen.map { "# \(Self.rowTitle($0))\n\n\($0.content)" }.joined(separator: "\n\n---\n\n")) {
                Label("Share", systemImage: "square.and.arrow.up")
            }
            .disabled(ids.isEmpty)
            Button("Move to Trash", systemImage: "trash", role: .destructive) {
                requestTrash(chosen)
            }
            .disabled(ids.isEmpty)
        }
        .labelStyle(.iconOnly)
        .buttonStyle(.interactivePlain)
        .padding(.horizontal, 16).padding(.vertical, 10)
        .glassEffectCompat(interactive: true)
        .padding(.horizontal, 16).padding(.bottom, 10)
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    private var galleryColumns: [GridItem] {
        #if os(macOS)
        [GridItem(.adaptive(minimum: 220), spacing: 14, alignment: .top)]
        #else
        [GridItem(.adaptive(minimum: 150), spacing: 14, alignment: .top)]
        #endif
    }

    @ViewBuilder private func noteCollection(_ notes: [Note], searchPosition: SearchPosition? = nil) -> some View {
        if layout == "gallery" {
            LazyVGrid(columns: galleryColumns, alignment: .leading, spacing: 14) {
                ForEach(notes) { note in
                    noteRow(note, searchPosition: searchPosition, gallery: true)
                        .id(searchPosition == nil ? "note:" + note.id : note.id)
                }
            }
            .scrollTargetLayout()
            .padding(.vertical, 8)
        } else {
            ForEach(notes) { note in
                noteRow(note, searchPosition: searchPosition)
                    .padding(.vertical, 8)
                    .overlay(alignment: .bottom) { Divider() }
                    .id(searchPosition == nil ? "note:" + note.id : note.id)
            }
        }
    }

    private func noteCard(_ n: Note) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 6) {
                Self.noteTitle(n).font(.headline).lineLimit(2)
                Spacer(minLength: 0)
                if selecting {
                    Image(systemName: selectedNotes.contains(n.id) ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(selectedNotes.contains(n.id) ? Color.accentColor : Color.secondary)
                        .accessibilityHidden(true)
                } else if n.pinned {
                    Image(systemName: "pin.fill").font(.caption).foregroundStyle(.orange)
                }
            }
            Text(searchRequest.text.isEmpty ? String(noteExcerptText(n.content).prefix(1200)) : preview(n))
                .font(.subheadline).foregroundStyle(.secondary)
                .lineLimit(4).frame(maxWidth: .infinity, alignment: .topLeading)
            Spacer(minLength: 0)
            if let status = Self.statuses.first(where: { $0.id == n.status }) {
                Text(status.label).font(.caption.weight(.medium)).foregroundStyle(status.color)
            }
            if location == "all" || location == nil || !browseOptions.query.isEmpty,
               let folder = n.folderId.flatMap({ id in folders.first { $0.id == id } }) {
                Label(folder.name, systemImage: "folder").font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
            Text(Self.dateLabel(sort == "created" ? n.createdAt : n.updatedAt))
                .font(.caption).foregroundStyle(.secondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 210, alignment: .topLeading)
        .background(.background, in: .rect(cornerRadius: 12))
        .overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(selecting && selectedNotes.contains(n.id) ? Color.accentColor : Color.secondary.opacity(0.2), lineWidth: 1) }
        .contentShape(.rect(cornerRadius: 12))
    }

    func noteRow(_ n: Note, searchPosition: SearchPosition? = nil, gallery: Bool = false) -> some View {
        Button {
            if selecting {
                withAnimation(.snappy(duration: 0.2)) {
                    if selectedNotes.contains(n.id) { selectedNotes.remove(n.id) } else { selectedNotes.insert(n.id) }
                }
                return
            }
            openNoteFromList(n, searchPosition: searchPosition)
        } label: {
            if gallery {
                noteCard(n)
            } else {
                HStack(spacing: 12) {
                    if selecting {
                        Image(systemName: selectedNotes.contains(n.id) ? "checkmark.circle.fill" : "circle")
                            .font(.title3).foregroundStyle(selectedNotes.contains(n.id) ? Color.accentColor : Color.secondary)
                            .transition(.move(edge: .leading).combined(with: .opacity))
                            .accessibilityHidden(true)
                    }
                    VStack(alignment: .leading, spacing: 5) {
                        HStack(spacing: 6) {
                            if n.pinned { Image(systemName: "pin.fill").font(.caption2).foregroundStyle(.orange) }
                            Self.noteTitle(n).font(.headline).lineLimit(1)
                            Spacer()
                            if let st = Self.statuses.first(where: { $0.id == n.status }) {
                                Text(st.label).font(.caption2.weight(.medium)).foregroundStyle(st.color).padding(.horizontal, 6).padding(.vertical, 1).background(st.color.opacity(0.15), in: .capsule)
                            }
                        }
                        HStack(spacing: 6) {
                            Text(Self.dateLabel(n.updatedAt)).font(.caption).foregroundStyle(.secondary)
                            Text(preview(n)).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                        }
                        if location == "all" || location == nil || !browseOptions.query.isEmpty, let f = n.folderId.flatMap({ id in folders.first { $0.id == id } }) {
                            Label(f.name, systemImage: "folder").font(.caption2).foregroundStyle(.tertiary)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 5)
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .padding(.horizontal, 8)
                .contentShape(.rect)
            }
        }
        .multilineTextAlignment(.leading)
        .buttonStyle(NotesHomeRowButtonStyle())
        .accessibilityAddTraits(selecting && selectedNotes.contains(n.id) ? .isSelected : [])
        #if os(iOS)
        // Long-press peeks at the note (original NotePeek) above the actions.
        .contextMenu { noteMenu(n, searchPosition: searchPosition) } preview: { notePeek(n) }
        #else
        .contextMenu { noteMenu(n, searchPosition: searchPosition) }
        #endif
        #if os(iOS)
        .swipeActions(edge: .leading) { Button(n.pinned ? "Unpin" : "Pin") { try? app.notes?.setPinned(n.id, !n.pinned) }.tint(.orange) }
        .swipeActions(edge: .trailing) { Button("Delete", role: .destructive) { requestTrash([n]) } }
        #endif
    }

    func notePeek(_ n: Note) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Self.noteTitle(n).font(.headline)
            Text(Self.dateLabel(n.updatedAt)).font(.caption).foregroundStyle(.secondary)
            Divider()
            if n.content.isEmpty {
                Text("Empty note")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 0)
            } else {
                ScrollView {
                    MarkdownText(String(n.content.prefix(4_000)))
                        .font(.callout)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .scrollIndicators(.hidden)
            }
        }
        .padding(16)
        .frame(width: 320, height: 360, alignment: .topLeading)
    }

    private func openNoteFromList(_ note: Note, searchPosition: SearchPosition?, newTab: Bool = false) {
        if let searchPosition {
            app.notesSearchReturnRows[tabId, default: [:]][searchPosition] = note.id
        } else if location != nil {
            app.notesFolderPositions[tabId, default: [:]][folderScrollContext] = "note:" + note.id
        }
        app.openNote(note.id, newTab: newTab, fromList: tabId)
    }

    @ViewBuilder func noteMenu(_ n: Note, searchPosition: SearchPosition?) -> some View {
        Button("Open") { openNoteFromList(n, searchPosition: searchPosition) }
        Button("Open in New Tab", systemImage: "plus.square.on.square") {
            openNoteFromList(n, searchPosition: searchPosition, newTab: true)
        }
        ShareLink(item: n.content.isEmpty ? n.displayTitle : "\(n.displayTitle)\n\n\(n.content)", subject: Text(n.displayTitle)) {
            Label("Share…", systemImage: "square.and.arrow.up")
        }
        Button("Print…", systemImage: "printer") { printNote(title: Self.rowTitle(n), body: n.content) }
        Divider()
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
        Button("Move to Trash", role: .destructive) { requestTrash([n]) }
    }

    private func requestTrash(_ chosen: [Note]) {
        guard !chosen.isEmpty else { return }
        let ids = chosen.map(\.id)
        if app.confirmNoteDelete && chosen.contains(where: { !JSText.trim($0.content).isEmpty }) {
            pendingTrash = ids
        } else {
            moveToTrash(ids)
        }
    }

    private func moveToTrash(_ ids: [String]) {
        app.attempt("Couldn’t move the notes to Trash") {
            for id in ids {
                try app.notes?.delete(id)
                selectedNotes.remove(id)
            }
        }
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
                        Self.noteTitle(n).font(.body.weight(.semibold))
                        Text("Deleted \(n.deletedAt.map { Self.dateLabel($0) } ?? "")").font(.caption).foregroundStyle(.secondary)
                    }
                    .contextMenu {
                        Button("Restore") { app.attempt("Couldn’t restore the note") { try app.notes?.restore(n.id) } }
                        Button("Delete Permanently", role: .destructive) { _ = try? app.notes?.purgeTrashItem(n.id) }
                    }
                    #if os(iOS)
                    .swipeActions(edge: .leading) { Button("Restore") { app.attempt("Couldn’t restore the note") { try app.notes?.restore(n.id) } }.tint(.blue) }
                    .swipeActions(edge: .trailing) { Button("Delete", role: .destructive) { _ = try? app.notes?.purgeTrashItem(n.id) } }
                    #endif
                }
            }
        }
    }
}

/// Rectangular glass belongs to a group, while rows retain one consistent hover target.
private struct NotesHomeGlassSurface: ViewModifier {
    @ViewBuilder func body(content: Content) -> some View {
        #if os(macOS)
        if #available(macOS 26.0, *) {
            content.padding(10)
                .glassEffect(.regular, in: .rect(cornerRadius: 16))
        } else {
            content.padding(10)
                .background(.regularMaterial, in: .rect(cornerRadius: 16))
        }
        #else
        content
        #endif
    }
}

private struct NotesHomeRowButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        Row(configuration: configuration)
    }

    private struct Row: View {
        let configuration: ButtonStyleConfiguration
        @Environment(\.isEnabled) private var isEnabled
        @State private var hovering = false

        var body: some View {
            configuration.label
                .frame(maxWidth: .infinity, alignment: .leading)
                .background {
                    #if os(macOS)
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Color.primary.opacity(configuration.isPressed ? 0.10 : hovering ? 0.055 : 0))
                    #else
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Color.primary.opacity(configuration.isPressed ? 0.08 : 0))
                    #endif
                }
                #if os(macOS)
                .onHover { hovering = $0 }
                .clickableCursor()
                #else
                .hoverEffect(.highlight, isEnabled: isEnabled)
                #endif
                .opacity(isEnabled ? 1 : 0.45)
                .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
                .animation(.easeOut(duration: 0.12), value: hovering)
        }
    }
}
