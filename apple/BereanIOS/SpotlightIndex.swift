import CoreSpotlight
import UniformTypeIdentifiers
import BereanReference
import BereanNotes

/// Core Spotlight (original src/platform/ios/spotlight.ts, iPhone only): notes, saved workspaces
/// and the books of the default text — not verses (Spotlight is for jumping; the app searches
/// Scripture). Each item's identifier is a native deep link; tapping a result routes it through
/// the same link router as App Intents and tapped links.
@MainActor enum SpotlightIndex {
    static let domainNotes = "notes", domainBooks = "books", domainWorkspaces = "workspaces", domainSessions = "sessions"
    private static var indexedBooksFor: String?
    private static var pending: Task<Void, Never>?

    static func link(_ route: String) -> String { "\(DeepLink.nativeDevScheme)://\(route)" }

    static func item(_ url: String, title: String, text: String?, keywords: [String], domain: String) -> CSSearchableItem {
        let set = CSSearchableItemAttributeSet(contentType: .text)
        set.title = title
        set.contentDescription = text
        set.keywords = ["Berean"] + keywords
        return CSSearchableItem(uniqueIdentifier: url, domainIdentifier: domain, attributeSet: set)
    }

    /// Debounced full refresh (notes change often; one indexed batch after edits settle).
    static func scheduleRefresh(_ app: AppModel) {
        pending?.cancel()
        pending = Task { @MainActor in
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled else { return }
            refresh(app)
        }
    }

    static func refresh(_ app: AppModel) {
        guard CSSearchableIndex.isIndexingAvailable(), let notes = app.notes else { return }
        let index = CSSearchableIndex.default()
        let all = (try? notes.all(limit: 2000)) ?? []
        let noteItems = all.filter { $0.deletedAt == nil }.map { n in
            item(link("note/\(n.id)"), title: n.title.isEmpty ? "Untitled note" : n.title,
                 text: String(MarkdownLiveSpans.plainText(n.content).split(whereSeparator: \.isWhitespace).joined(separator: " ").prefix(600)),
                 keywords: ["note"] + n.tags + (n.verseRef.map { [$0.replacingOccurrences(of: ".", with: " ")] } ?? []), domain: domainNotes)
        }
        // Replace the whole notes domain so deleted notes disappear too.
        index.deleteSearchableItems(withDomainIdentifiers: [domainNotes]) { _ in
            index.indexSearchableItems(noteItems) { _ in }
        }
        let workspaces = app.savedWorkspaces.map { w in
            item(link("workspace?name=\(w.name.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? w.name)"),
                 title: w.name, text: "Saved workspace", keywords: ["workspace", "layout"], domain: domainWorkspaces)
        }
        index.deleteSearchableItems(withDomainIdentifiers: [domainWorkspaces]) { _ in index.indexSearchableItems(workspaces) { _ in } }
        // Tab sessions (original spotlight.ts indexSessions): name + the titles of its tabs.
        let sessions = app.sessions.map { s -> CSSearchableItem in
            let titles = Array(s.allTabs.map(\.title).filter { !$0.isEmpty }.prefix(12))
            return item(link("session/\(s.id)"), title: s.name.isEmpty ? "Session" : s.name,
                        text: titles.isEmpty ? "Tab session" : "Tabs: " + titles.joined(separator: " · "),
                        keywords: ["Berean", "session", "tabs"] + titles, domain: domainSessions)
        }
        index.deleteSearchableItems(withDomainIdentifiers: [domainSessions]) { _ in index.indexSearchableItems(sessions) { _ in } }
        let text = app.defaultText
        if indexedBooksFor != text {
            indexedBooksFor = text
            let books = app.bookCatalog.filter { $0.textId == text }.map { b in
                item(link("verse/\(b.book.id)/1?text=\(text)"), title: b.book.name,
                     text: "\(b.book.chaptersCount) chapter\(b.book.chaptersCount == 1 ? "" : "s") · \(textInfo(text).name)",
                     keywords: ["Bible", "Scripture", b.book.shortName], domain: domainBooks)
            }
            index.deleteSearchableItems(withDomainIdentifiers: [domainBooks]) { _ in index.indexSearchableItems(books) { _ in } }
        }
    }
}
