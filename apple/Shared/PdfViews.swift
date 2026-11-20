import SwiftUI
import PDFKit
import CryptoKit
import UniformTypeIdentifiers
import BereanCore
import BereanNotes
#if os(macOS)
import AppKit
#else
import UIKit
#endif

// MARK: - Files

/// PDF bytes live beside the library (`<library>/pdfs/<id>.pdf`, as the original's
/// `userData/pdfs`); only metadata rows are shared, so a synced row may have no file here yet.
enum PdfFiles {
    static var directory: URL { UserLibrary.directory.appendingPathComponent("pdfs", isDirectory: true) }
    static func url(_ pdf: PdfRecord) -> URL { directory.appendingPathComponent(pdf.filename) }
    static func exists(_ pdf: PdfRecord) -> Bool { FileManager.default.fileExists(atPath: url(pdf).path) }

    enum ImportOutcome { case imported(PdfRecord), attached(PdfRecord), failed(String) }

    /// The original `pdf:import`: hash the bytes; when a synced row with the same hash has no file
    /// here, attach the file to that row; otherwise copy to `<id>.pdf` and insert a new row.
    @MainActor static func importFile(_ source: URL, into service: PdfService) -> ImportOutcome {
        let scoped = source.startAccessingSecurityScopedResource()
        defer { if scoped { source.stopAccessingSecurityScopedResource() } }
        guard source.pathExtension.lowercased() == "pdf" else { return .failed("Not a PDF file") }
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let data = try Data(contentsOf: source)
            let hash = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
            if let existing = try service.findByHash(hash), !exists(existing) {
                let name = "\(existing.id).pdf"
                try data.write(to: directory.appendingPathComponent(name), options: .atomic)
                return .attached(try service.attachFile(existing.id, filename: name, fileSize: Int64(data.count), fileHash: hash) ?? existing)
            }
            let id = UUID().uuidString.lowercased()
            let name = "\(id).pdf"
            try data.write(to: directory.appendingPathComponent(name), options: .atomic)
            let title = source.deletingPathExtension().lastPathComponent
            return .imported(try service.insert(id: id, title: title, filename: name, fileSize: Int64(data.count),
                                                importedAt: Int64(Date().timeIntervalSince1970 * 1000), fileHash: hash))
        } catch {
            return .failed(error.localizedDescription)
        }
    }

    @MainActor static func choose(completion: @escaping ([URL]) -> Void) {
        #if os(macOS)
        let panel = NSOpenPanel()
        panel.title = "Import PDF"
        panel.prompt = "Import"
        panel.allowedContentTypes = [.pdf]
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        let finish: (NSApplication.ModalResponse) -> Void = { r in completion(r == .OK ? panel.urls : []) }
        if let window = NSApp.keyWindow ?? NSApp.mainWindow { panel.beginSheetModal(for: window, completionHandler: finish) } else { finish(panel.runModal()) }
        #else
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.pdf], asCopy: true)
        picker.allowsMultipleSelection = true
        let delegate = NoteFileTransfer.PickerDelegate { completion($0) }
        picker.delegate = delegate
        objc_setAssociatedObject(picker, &NoteFileTransfer.PickerDelegate.key, delegate, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
        NoteFileTransfer.topViewController()?.present(picker, animated: true)
        #endif
    }

    static func link(_ id: String, page: Int?) -> String { "berean://pdf/\(id)" + (page.map { "/\($0)" } ?? "") }
}

enum PdfHighlightColor: String, CaseIterable, Identifiable {
    case yellow, green, blue, pink, orange, purple
    var id: String { rawValue }
    var rgb: (Double, Double, Double) {
        switch self {
        case .yellow: (250, 204, 21)
        case .green: (74, 222, 128)
        case .blue: (96, 165, 250)
        case .pink: (244, 114, 182)
        case .orange: (251, 146, 60)
        case .purple: (192, 132, 252)
        }
    }
    var color: Color { Color(red: rgb.0 / 255, green: rgb.1 / 255, blue: rgb.2 / 255) }
    #if os(macOS)
    var platform: NSColor { NSColor(red: rgb.0 / 255, green: rgb.1 / 255, blue: rgb.2 / 255, alpha: 0.45) }
    #else
    var platform: UIColor { UIColor(red: rgb.0 / 255, green: rgb.1 / 255, blue: rgb.2 / 255, alpha: 0.45) }
    #endif
    static func named(_ s: String) -> PdfHighlightColor { PdfHighlightColor(rawValue: s) ?? .yellow }
}

// MARK: - Tab host

struct PdfTabView: View {
    @Environment(AppModel.self) private var app
    let tabId: String

    var body: some View {
        if let tab = app.findTab(tabId), let id = tab.state["pdfId"]?.stringValue?.string {
            PdfReaderView(tabId: tabId, pdfId: id).id(tabId + id)
        } else {
            PdfLibraryView(tabId: tabId)
        }
    }
}

// MARK: - Library

struct PdfLibraryView: View {
    @Environment(AppModel.self) private var app
    let tabId: String
    @State private var pdfs: [PdfRecord] = []
    @State private var filter = ""
    @State private var renaming: PdfRecord?
    @State private var newTitle = ""
    @State private var deleting: PdfRecord?

    private var shown: [PdfRecord] {
        filter.isEmpty ? pdfs : pdfs.filter { $0.title.localizedCaseInsensitiveContains(filter) }
    }

    var body: some View {
        VStack(spacing: 0) {
            if !pdfs.isEmpty {
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                    TextField("Filter PDFs", text: $filter).textFieldStyle(.plain)
                }
                .padding(.horizontal, 10).padding(.vertical, 7)
                .background(.quaternary.opacity(0.5), in: .rect(cornerRadius: 9))
                .padding(.horizontal, 16).padding(.vertical, 10)
            }
            List {
                ForEach(shown) { pdf in
                    Button { app.openPdf(pdf.id, title: pdf.title) } label: { row(pdf) }
                        .buttonStyle(.interactivePlain)
                        .contextMenu { menu(pdf) }
                        #if os(iOS)
                        .swipeActions { Button("Delete", role: .destructive) { deleting = pdf } }
                        #endif
                }
            }
            .overlay {
                if pdfs.isEmpty {
                    ContentUnavailableView {
                        Label("No PDFs", systemImage: "doc.richtext")
                    } description: {
                        Text("Import a PDF to read it beside Scripture, highlight passages and bookmark pages.")
                    } actions: {
                        Button("Import PDF…") { importPDFs() }.buttonStyle(.borderedProminent)
                    }
                }
            }
        }
        .navigationTitle("PDFs")
        .toolbar {
            ToolbarItem { Button("Import PDF", systemImage: "plus") { importPDFs() }.help("Import a PDF") }
        }
        .task(id: app.pdfsRevision) { pdfs = (try? app.pdfs?.list()) ?? [] }
        .alert("Rename PDF", isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Title", text: $newTitle)
            Button("Rename") { if let p = renaming { try? app.pdfs?.rename(p.id, newTitle.trimmingCharacters(in: .whitespaces)) }; renaming = nil }
            Button("Cancel", role: .cancel) { renaming = nil }
        }
        .confirmationDialog("Delete “\(deleting?.title ?? "")”?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
                            titleVisibility: .visible) {
            Button("Delete PDF", role: .destructive) { if let p = deleting { delete(p) }; deleting = nil }
        } message: { Text("Its highlights and bookmarks are deleted too.") }
    }

    private func row(_ pdf: PdfRecord) -> some View {
        let present = PdfFiles.exists(pdf)
        return HStack(spacing: 12) {
            Image(systemName: present ? "doc.richtext" : "icloud.and.arrow.down")
                .font(.title3).foregroundStyle(present ? Color.accentColor : .secondary).frame(width: 28)
            VStack(alignment: .leading, spacing: 2) {
                Text(pdf.title).lineLimit(2)
                Text(detail(pdf, present: present)).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(.vertical, 3)
        .contentShape(.rect)
    }

    private func detail(_ pdf: PdfRecord, present: Bool) -> String {
        var parts: [String] = []
        if pdf.pageCount > 0 { parts.append("\(pdf.pageCount) page\(pdf.pageCount == 1 ? "" : "s")") }
        if pdf.fileSize > 0 { parts.append(ByteCountFormatter.string(fromByteCount: pdf.fileSize, countStyle: .file)) }
        parts.append(Date(timeIntervalSince1970: Double(pdf.importedAt) / 1000).formatted(date: .abbreviated, time: .omitted))
        if !present { parts.append("File not on this device") }
        return parts.joined(separator: " · ")
    }

    @ViewBuilder private func menu(_ pdf: PdfRecord) -> some View {
        Button("Open", systemImage: "doc.richtext") { app.openPdf(pdf.id, title: pdf.title) }
        Button("Rename…", systemImage: "pencil") { newTitle = pdf.title; renaming = pdf }
        Button("Copy Link", systemImage: "link") { Clipboard.copy(PdfFiles.link(pdf.id, page: nil)) }
        Divider()
        Button("Delete…", systemImage: "trash", role: .destructive) { deleting = pdf }
    }

    private func delete(_ pdf: PdfRecord) {
        guard let filename = try? app.pdfs?.deleteRow(pdf.id) else { return }
        try? FileManager.default.removeItem(at: PdfFiles.directory.appendingPathComponent(filename))
        for tab in app.session.allTabs where tab.tabType == .pdf && tab.state["pdfId"]?.stringValue?.string == pdf.id {
            app.update(tab.id) { $0.state = JSObject(); $0.title = "PDFs" }
        }
    }

    private func importPDFs() {
        PdfFiles.choose { urls in
            guard let service = app.pdfs else { return }
            var last: PdfRecord?
            for url in urls {
                switch PdfFiles.importFile(url, into: service) {
                case .imported(let p), .attached(let p): last = p
                case .failed(let message): app.userMessage = "Couldn’t import \(url.lastPathComponent): \(message)"
                }
            }
            if urls.count == 1, let last { app.openPdf(last.id, title: last.title) }
        }
    }
}

// MARK: - Reader

struct PdfSelectionInfo: Equatable {
    var page: Int
    var rects: [PdfRect]
    var text: String
}

@MainActor @Observable final class PdfReaderController {
    weak var view: PDFView?
    var pageCount = 0
    var currentPage = 1
    var selection: PdfSelectionInfo?
    var findMatches: [PDFSelection] = []
    var findIndex = 0
    var hitHighlight: String?
    /// True while Find moves the selection to a match, so that selection doesn't offer highlight actions.
    var selectingMatch = false

    func go(to page: Int) {
        guard let view, let doc = view.document, page >= 1, page <= doc.pageCount, let p = doc.page(at: page - 1) else { return }
        view.go(to: p)
    }

    func go(to destination: PDFDestination) { view?.go(to: destination) }

    func find(_ query: String) {
        guard let view, let doc = view.document else { return }
        let q = query.trimmingCharacters(in: .whitespaces)
        findMatches = q.count < 2 ? [] : doc.findString(q, withOptions: [.caseInsensitive, .diacriticInsensitive])
        findIndex = 0
        view.highlightedSelections = findMatches.isEmpty ? nil : findMatches
        showMatch()
    }

    func step(_ delta: Int) {
        guard !findMatches.isEmpty else { return }
        findIndex = (findIndex + delta + findMatches.count) % findMatches.count
        showMatch()
    }

    private func showMatch() {
        guard let view, findMatches.indices.contains(findIndex) else { return }
        let match = findMatches[findIndex]
        selectingMatch = true
        view.setCurrentSelection(match, animate: true)
        view.go(to: match)
        selection = nil
        DispatchQueue.main.async { self.selectingMatch = false }
    }

    func clearFind() {
        findMatches = []
        view?.highlightedSelections = nil
    }

    func clearSelection() { view?.clearSelection(); selection = nil }
}

struct PdfReaderView: View {
    @Environment(AppModel.self) private var app
    let tabId: String
    let pdfId: String
    @State private var record: PdfRecord?
    @State private var loaded = false
    @State private var controller = PdfReaderController()
    @State private var highlights: [PdfHighlight] = []
    @State private var bookmarks: [PdfBookmark] = []
    @State private var showsSidebar = false
    @State private var sidebarMode = "outline"
    @State private var findShown = false
    @State private var findQuery = ""
    @FocusState private var findFocused: Bool
    @State private var noteEditing: PdfHighlight?
    @State private var noteText = ""
    @State private var pageSaveTask: Task<Void, Never>?

    private var initialPage: Int {
        Int(app.findTab(tabId)?.state["page"]?.numberValue ?? 1)
    }

    var body: some View {
        Group {
            if let record, PdfFiles.exists(record) {
                reader(record)
            } else if loaded, let record {
                ContentUnavailableView {
                    Label("PDF Not on This Device", systemImage: "icloud.and.arrow.down")
                } description: {
                    Text("“\(record.title)” was added on another device. Import the same file here to read it with its highlights and bookmarks.")
                } actions: {
                    Button("Import File…") { attach() }.buttonStyle(.borderedProminent)
                }
            } else if loaded {
                ContentUnavailableView("PDF Unavailable", systemImage: "doc.questionmark",
                                       description: Text("This PDF was removed from your library."))
            } else {
                Color.clear   // an empty Group never appears, so its .task would never load the record
            }
        }
        .navigationTitle(record?.title ?? "PDF")
        #if os(iOS)
        .toolbarTitleDisplayMode(.inline)
        #endif
        .task(id: app.pdfsRevision) {
            record = try? app.pdfs?.get(pdfId)
            highlights = (try? app.pdfs?.highlights(pdfId)) ?? []
            bookmarks = (try? app.pdfs?.bookmarks(pdfId)) ?? []
            loaded = true
        }
    }

    @ViewBuilder private func reader(_ record: PdfRecord) -> some View {
        PdfKitView(url: PdfFiles.url(record), initialPage: initialPage, highlights: highlights, controller: controller,
                   onLoaded: { count in if count != record.pageCount { try? app.pdfs?.setPageCount(record.id, count) } },
                   onPage: savePage)
            .ignoresSafeArea(edges: .bottom)
            .overlay(alignment: .top) { if findShown { findBar.padding(.top, 8) } }
            .overlay(alignment: .bottom) {
                Group {
                    if let selection = controller.selection { selectionBar(selection) }
                    else if let id = controller.hitHighlight, let hl = highlights.first(where: { $0.id == id }) { highlightBar(hl) }
                }
                .padding(.bottom, 18)
                .animation(.snappy, value: controller.selection)
            }
            #if os(macOS)
            .inspector(isPresented: $showsSidebar) { sidebar.inspectorColumnWidth(min: 220, ideal: 260, max: 360) }
            #else
            .sheet(isPresented: $showsSidebar) { NavigationStack { sidebar.navigationTitle(record.title).toolbarTitleDisplayMode(.inline) }.presentationDetents([.medium, .large]) }
            #endif
            .toolbar { toolbar(record) }
            .alert("Highlight Note", isPresented: Binding(get: { noteEditing != nil }, set: { if !$0 { noteEditing = nil } })) {
                TextField("Note", text: $noteText)
                Button("Save") { if let h = noteEditing { try? app.pdfs?.setHighlightNote(h.id, noteText) }; noteEditing = nil }
                Button("Cancel", role: .cancel) { noteEditing = nil }
            }
            .onChange(of: findShown) { _, shown in if !shown { controller.clearFind() } }
            .background { Button("Find") { findShown = true }.keyboardShortcut("f", modifiers: .command).hidden() }
    }

    private func savePage(_ page: Int) {
        pageSaveTask?.cancel()
        pageSaveTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled, app.findTab(tabId)?.state["page"]?.numberValue != Double(page) else { return }
            app.update(tabId, recordHistory: false) { $0.state["page"] = .number(Double(page)) }
        }
    }

    @ToolbarContentBuilder private func toolbar(_ record: PdfRecord) -> some ToolbarContent {
        ToolbarItemGroup {
            Text(controller.pageCount > 0 ? "\(controller.currentPage) of \(controller.pageCount)" : "")
                .font(.callout.monospacedDigit()).foregroundStyle(.secondary)
                .fixedSize().padding(.leading, 8)
            Button("Find", systemImage: "magnifyingglass") { findShown.toggle() }.help("Find in PDF (⌘F)")
            Button(isBookmarked ? "Remove Bookmark" : "Bookmark Page", systemImage: isBookmarked ? "bookmark.fill" : "bookmark") { toggleBookmark() }
                .help(isBookmarked ? "Remove this page’s bookmark" : "Bookmark this page")
            Menu("More", systemImage: "ellipsis.circle") {
                Button("Copy Link to Page", systemImage: "link") { Clipboard.copy(PdfFiles.link(record.id, page: controller.currentPage)) }
                Button("PDF Library", systemImage: "books.vertical") { app.openPdfLibrary() }
            }
            .menuIndicator(.hidden)
            Button("Contents", systemImage: "sidebar.right") { showsSidebar.toggle() }.help("Outline, bookmarks and highlights")
        }
    }

    private var isBookmarked: Bool { bookmarks.contains { $0.page == controller.currentPage } }

    private func toggleBookmark() {
        if let b = bookmarks.first(where: { $0.page == controller.currentPage }) { try? app.pdfs?.removeBookmark(b.id) }
        else { try? app.pdfs?.addBookmark(pdfId, page: controller.currentPage, label: "") }
    }

    private func attach() {
        PdfFiles.choose { urls in
            guard let url = urls.first, let service = app.pdfs else { return }
            switch PdfFiles.importFile(url, into: service) {
            case .attached(let p) where p.id == pdfId: break
            case .attached(let p), .imported(let p):
                app.userMessage = "That file is a different PDF — it was added to your library as “\(p.title)”."
            case .failed(let message): app.userMessage = "Couldn’t import: \(message)"
            }
        }
    }

    // MARK: floating bars

    private var findBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
            TextField("Find in PDF", text: $findQuery)
                .textFieldStyle(.plain).frame(width: 200)
                .focused($findFocused)
                .onAppear { findFocused = true }
                .onSubmit { controller.step(1) }
                .onChange(of: findQuery) { _, q in controller.find(q) }
            if !findQuery.isEmpty {
                Text(controller.findMatches.isEmpty ? "No matches" : "\(controller.findIndex + 1) of \(controller.findMatches.count)")
                    .font(.caption.monospacedDigit()).foregroundStyle(.secondary)
            }
            Button("Previous", systemImage: "chevron.up") { controller.step(-1) }.disabled(controller.findMatches.isEmpty)
            Button("Next", systemImage: "chevron.down") { controller.step(1) }.disabled(controller.findMatches.isEmpty)
            Button("Done", systemImage: "xmark") { findShown = false; findQuery = "" }.keyboardShortcut(.cancelAction)
        }
        .labelStyle(.iconOnly).buttonStyle(.interactivePlain)
        .padding(.horizontal, 12).padding(.vertical, 8)
        .modifier(PdfGlass())
    }

    private func selectionBar(_ selection: PdfSelectionInfo) -> some View {
        HStack(spacing: 10) {
            ForEach(PdfHighlightColor.allCases) { c in
                Button { addHighlight(selection, color: c) } label: {
                    Circle().fill(c.color).frame(width: 20, height: 20).overlay(Circle().stroke(.primary.opacity(0.15)))
                }
                .buttonStyle(.interactivePlain)
                .help("Highlight \(c.rawValue)")
                .accessibilityLabel("Highlight \(c.rawValue)")
            }
            Divider().frame(height: 18)
            Button("Copy", systemImage: "doc.on.doc") { Clipboard.copy(selection.text); controller.clearSelection() }
            Button("Search Scripture", systemImage: "text.magnifyingglass") {
                app.openSearch(selection.text, reuseTab: false); controller.clearSelection()
            }
        }
        .labelStyle(.iconOnly).buttonStyle(.interactivePlain)
        .padding(.horizontal, 14).padding(.vertical, 9)
        .modifier(PdfGlass())
        .transition(.move(edge: .bottom).combined(with: .opacity))
    }

    private func highlightBar(_ hl: PdfHighlight) -> some View {
        HStack(spacing: 10) {
            Circle().fill(PdfHighlightColor.named(hl.color).color).frame(width: 14, height: 14)
            Text(hl.note?.isEmpty == false ? hl.note! : hl.text).lineLimit(1).frame(maxWidth: 240, alignment: .leading)
            Button(hl.note?.isEmpty == false ? "Edit Note" : "Add Note", systemImage: "note.text") { noteText = hl.note ?? ""; noteEditing = hl }
            Button("Copy", systemImage: "doc.on.doc") { Clipboard.copy(hl.text) }
            Button("Remove Highlight", systemImage: "trash") { try? app.pdfs?.removeHighlight(hl.id); controller.hitHighlight = nil }
            Button("Close", systemImage: "xmark") { controller.hitHighlight = nil }
        }
        .labelStyle(.iconOnly).buttonStyle(.interactivePlain)
        .padding(.horizontal, 14).padding(.vertical, 9)
        .modifier(PdfGlass())
    }

    private func addHighlight(_ selection: PdfSelectionInfo, color: PdfHighlightColor) {
        do {
            try app.pdfs?.addHighlight(pdfId: pdfId, page: selection.page, rects: selection.rects, color: color.rawValue, text: selection.text)
        } catch {
            app.userMessage = "Couldn’t save the highlight."
        }
        controller.clearSelection()
    }

    // MARK: sidebar

    private var sidebar: some View {
        VStack(spacing: 0) {
            Picker("Show", selection: $sidebarMode) {
                Text("Outline").tag("outline")
                Text("Bookmarks").tag("bookmarks")
                Text("Highlights").tag("highlights")
            }
            .pickerStyle(.segmented).labelsHidden().padding(10)
            List {
                switch sidebarMode {
                case "bookmarks":
                    if bookmarks.isEmpty { Text("No bookmarks yet. Use the bookmark button to mark a page.").foregroundStyle(.secondary) }
                    ForEach(bookmarks) { b in
                        Button { controller.go(to: b.page) } label: {
                            HStack { Text(b.label.isEmpty ? "Page \(b.page)" : b.label); Spacer(); Text("\(b.page)").foregroundStyle(.secondary) }
                                .contentShape(.rect)
                        }
                        .buttonStyle(.interactivePlain)
                        .contextMenu { Button("Remove Bookmark", role: .destructive) { try? app.pdfs?.removeBookmark(b.id) } }
                    }
                case "highlights":
                    if highlights.isEmpty { Text("Select text in the PDF and choose a colour to highlight it.").foregroundStyle(.secondary) }
                    ForEach(highlights) { h in
                        Button { controller.go(to: h.page); controller.hitHighlight = h.id } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                HStack(spacing: 6) {
                                    Circle().fill(PdfHighlightColor.named(h.color).color).frame(width: 9, height: 9)
                                    Text("Page \(h.page)").font(.caption).foregroundStyle(.secondary)
                                }
                                Text(h.text).lineLimit(3)
                                if let note = h.note, !note.isEmpty { Text(note).font(.caption).foregroundStyle(.secondary).lineLimit(2) }
                            }
                            .contentShape(.rect)
                        }
                        .buttonStyle(.interactivePlain)
                        .contextMenu {
                            Button("Edit Note…") { noteText = h.note ?? ""; noteEditing = h }
                            Button("Remove Highlight", role: .destructive) { try? app.pdfs?.removeHighlight(h.id) }
                        }
                    }
                default:
                    if let root = controller.view?.document?.outlineRoot, root.numberOfChildren > 0 {
                        OutlineChildren(item: root, controller: controller)
                    } else {
                        Text("This PDF has no outline.").foregroundStyle(.secondary)
                    }
                }
            }
        }
    }
}

private struct OutlineChildren: View {
    let item: PDFOutline
    let controller: PdfReaderController
    var body: some View {
        ForEach(0..<item.numberOfChildren, id: \.self) { i in
            if let child = item.child(at: i) {
                if child.numberOfChildren > 0 {
                    DisclosureGroup {
                        OutlineChildren(item: child, controller: controller)
                    } label: { entry(child) }
                } else {
                    entry(child)
                }
            }
        }
    }

    private func entry(_ child: PDFOutline) -> some View {
        Button { if let d = child.destination { controller.go(to: d) } } label: {
            Text(child.label ?? "Untitled").lineLimit(2).frame(maxWidth: .infinity, alignment: .leading).contentShape(.rect)
        }
        .buttonStyle(.interactivePlain)
    }
}

/// Floating controls over a bright PDF page: clear glass lets the page text show through and the
/// icons get lost, so these use a solid, high-contrast material with a soft shadow.
private struct PdfGlass: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(.thickMaterial, in: .capsule)
            .overlay(Capsule().strokeBorder(.primary.opacity(0.08)))
            .shadow(color: .black.opacity(0.2), radius: 12, y: 4)
    }
}

// MARK: - PDFKit bridge

#if os(macOS)
private typealias PlatformRepresentable = NSViewRepresentable
typealias PlatformGestureDelegate = NSGestureRecognizerDelegate
#else
private typealias PlatformRepresentable = UIViewRepresentable
typealias PlatformGestureDelegate = UIGestureRecognizerDelegate
#endif

struct PdfKitView: PlatformRepresentable {
    let url: URL
    let initialPage: Int
    let highlights: [PdfHighlight]
    let controller: PdfReaderController
    let onLoaded: (Int) -> Void
    let onPage: (Int) -> Void

    @MainActor final class Coordinator: NSObject, PlatformGestureDelegate {
        var parent: PdfKitView
        var shown: [String: [PDFAnnotation]] = [:]
        init(_ parent: PdfKitView) { self.parent = parent }

        @objc func pageChanged(_ note: Notification) {
            guard let view = note.object as? PDFView, let page = view.currentPage, let doc = view.document else { return }
            let number = doc.index(for: page) + 1
            parent.controller.currentPage = number
            parent.onPage(number)
        }

        @objc func selectionChanged(_ note: Notification) { updateSelection(note.object as? PDFView) }

        #if os(macOS)
        func gestureRecognizer(_ g: NSGestureRecognizer, shouldRecognizeSimultaneouslyWith other: NSGestureRecognizer) -> Bool { true }
        #else
        func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
        #endif

        @objc func tapped(_ recognizer: Any) {
            #if os(macOS)
            guard let r = recognizer as? NSClickGestureRecognizer, let view = r.view as? PDFView else { return }
            let point = r.location(in: view)
            #else
            guard let r = recognizer as? UITapGestureRecognizer, let view = r.view as? PDFView else { return }
            let point = r.location(in: view)
            #endif
            guard let page = view.page(for: point, nearest: false) else { return }
            let pagePoint = view.convert(point, to: page)
            let hit = page.annotations.last { $0.userName?.hasPrefix("berean:") == true && $0.bounds.contains(pagePoint) }
            if let id = hit?.userName {
                parent.controller.selection = nil
                parent.controller.hitHighlight = String(id.dropFirst("berean:".count))
            } else if parent.controller.hitHighlight != nil {
                parent.controller.hitHighlight = nil
            }
        }

        @objc func annotationHit(_ note: Notification) {
            guard let annotation = note.userInfo?["PDFAnnotationHit"] as? PDFAnnotation,
                  let id = annotation.userName, id.hasPrefix("berean:") else { return }
            parent.controller.selection = nil
            parent.controller.hitHighlight = String(id.dropFirst("berean:".count))
        }
    }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    private func make(context: Context) -> PDFView {
        let view = PDFView()
        view.autoScales = true
        view.displayMode = .singlePageContinuous
        view.displayDirection = .vertical
        #if os(iOS)
        view.usePageViewController(false)
        view.pageShadowsEnabled = true
        #endif
        if let doc = PDFDocument(url: url) {
            view.document = doc
            controller.view = view
            controller.pageCount = doc.pageCount
            onLoaded(doc.pageCount)
            if initialPage > 1, let page = doc.page(at: min(doc.pageCount, initialPage) - 1) {
                DispatchQueue.main.async { view.go(to: page) }
            }
            controller.currentPage = max(1, min(doc.pageCount, initialPage))
        }
        let center = NotificationCenter.default
        let coordinator = context.coordinator
        center.addObserver(coordinator, selector: #selector(Coordinator.pageChanged(_:)), name: .PDFViewPageChanged, object: view)
        center.addObserver(coordinator, selector: #selector(Coordinator.selectionChanged(_:)), name: .PDFViewSelectionChanged, object: view)
        center.addObserver(coordinator, selector: #selector(Coordinator.annotationHit(_:)), name: .PDFViewAnnotationHit, object: view)
        // PDFKit only reports hits on link/widget annotations, so markup highlights get their own tap.
        #if os(macOS)
        let tap = NSClickGestureRecognizer(target: coordinator, action: #selector(Coordinator.tapped(_:)))
        tap.delaysPrimaryMouseButtonEvents = false
        #else
        let tap = UITapGestureRecognizer(target: coordinator, action: #selector(Coordinator.tapped(_:)))
        tap.cancelsTouchesInView = false
        #endif
        tap.delegate = coordinator
        view.addGestureRecognizer(tap)
        apply(highlights, to: view, coordinator: coordinator)
        return view
    }

    private func update(_ view: PDFView, context: Context) {
        context.coordinator.parent = self
        apply(highlights, to: view, coordinator: context.coordinator)
    }

    #if os(macOS)
    func makeNSView(context: Context) -> PDFView { make(context: context) }
    func updateNSView(_ view: PDFView, context: Context) { update(view, context: context) }
    #else
    func makeUIView(context: Context) -> PDFView { make(context: context) }
    func updateUIView(_ view: PDFView, context: Context) { update(view, context: context) }
    #endif

    /// Highlights are drawn as non-saving PDFKit annotations; the PDF file itself is never modified.
    private func apply(_ highlights: [PdfHighlight], to view: PDFView, coordinator: Coordinator) {
        guard let doc = view.document else { return }
        let wanted = Dictionary(highlights.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        for (id, annotations) in coordinator.shown where wanted[id] == nil {
            annotations.forEach { $0.page?.removeAnnotation($0) }
            coordinator.shown[id] = nil
        }
        for h in highlights where coordinator.shown[h.id] == nil {
            guard h.page >= 1, h.page <= doc.pageCount, let page = doc.page(at: h.page - 1) else { continue }
            let crop = page.bounds(for: .cropBox)
            let box = PdfGeometry.Box(x: crop.minX, y: crop.minY, width: crop.width, height: crop.height)
            let made: [PDFAnnotation] = h.rects.map { r in
                let b = PdfGeometry.pageRect(r, crop: box, rotation: page.rotation)
                let a = PDFAnnotation(bounds: CGRect(x: b.x, y: b.y, width: b.width, height: b.height), forType: .highlight, withProperties: nil)
                a.color = PdfHighlightColor.named(h.color).platform
                a.userName = "berean:\(h.id)"
                if let note = h.note, !note.isEmpty { a.contents = note }
                page.addAnnotation(a)
                return a
            }
            coordinator.shown[h.id] = made
        }
    }
}

extension PdfKitView.Coordinator {
    func updateSelection(_ view: PDFView?) {
        if parent.controller.selectingMatch { parent.controller.selection = nil; return }
        guard let view, let doc = view.document, let selection = view.currentSelection,
              let text = selection.string?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty,
              let page = selection.pages.first else {
            parent.controller.selection = nil
            return
        }
        // As the original: only the rects that fall on the selection's first page are kept.
        let crop = page.bounds(for: .cropBox)
        let box = PdfGeometry.Box(x: crop.minX, y: crop.minY, width: crop.width, height: crop.height)
        let rects = selection.selectionsByLine().compactMap { line -> PdfRect? in
            guard line.pages.first == page else { return nil }
            let b = line.bounds(for: page)
            guard b.width > 0, b.height > 0 else { return nil }
            return PdfGeometry.normalizedRect(.init(x: b.minX, y: b.minY, width: b.width, height: b.height), crop: box, rotation: page.rotation)
        }
        guard !rects.isEmpty else { parent.controller.selection = nil; return }
        parent.controller.hitHighlight = nil
        parent.controller.selection = PdfSelectionInfo(page: doc.index(for: page) + 1, rects: rects, text: text)
    }
}
