import Foundation
import BereanBible
import BereanReference
import BereanWorkspace

/// Native reference understanding on top of the shared `Reference.parse` (which stays byte-identical to the existing
/// parser and is golden-pinned):
/// - a bare book name ("Obadiah", "Didache", "Recognitions 3") opens that book's first chapter, in whichever text has it;
/// - in a single-chapter book, "Jude 5" / "Obadiah 3" means verse 5 / 3 of its only chapter (the usual convention);
/// - a book not in the current text resolves to the first text that has it.
struct ResolvedPassage: Equatable {
    var textId: String; var bookId: String; var chapter: Int; var verse: Int?

    func isShown(in tab: Tab) -> Bool {
        guard tab.tabType == .bible, tab.state["endChapter"]?.numberValue == nil else { return false }
        let state = BibleState(tab.state)
        return !state.compareMode && state.translation == textId && state.bookId == bookId
            && state.chapter == chapter && state.verse == verse
    }
}

extension AppModel {
    /// Every book of every listed text (loaded once, off the main thread).
    func loadBookCatalog() {
        guard bookCatalog.isEmpty else { return }
        Task { bookCatalog = await catalog() }
    }

    func resolvePassage(_ raw: String, preferring current: String? = nil) -> ResolvedPassage? {
        let q = raw.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return nil }
        let pref = current ?? defaultText
        func textFor(_ bookId: String, forced: String? = nil) -> String {
            if let forced { return forced }
            if bookCatalog.isEmpty || bookCatalog.contains(where: { $0.textId == pref && $0.book.id == bookId }) { return pref }
            return bookCatalog.first { $0.book.id == bookId }?.textId ?? pref
        }
        if let ref = Reference.parse(q) {
            return ResolvedPassage(textId: textFor(ref.bookId, forced: ref.forcedTranslation == "LXX" ? "lxx" : nil), bookId: ref.bookId, chapter: ref.chapter, verse: ref.verse)
        }
        // "<book>" or "<book> N" where the book name matches a catalog entry.
        let lower = q.lowercased()
        var name = lower, number: Int?
        if let r = lower.range(of: #"\s+(\d+)$"#, options: .regularExpression) {
            number = Int(lower[r].trimmingCharacters(in: .whitespaces)); name = String(lower[..<r.lowerBound])
        }
        func matches(_ b: BookRow) -> Bool {
            let n = b.name.lowercased(), s = b.shortName.lowercased()
            return n == name || s == name || b.id.lowercased() == name || n.replacingOccurrences(of: "'", with: "") == name
        }
        let hits = bookCatalog.filter { matches($0.book) }
        guard let hit = hits.first(where: { $0.textId == pref }) ?? hits.first else {
            // A text's own name ("didache", "enoch", "jubilees") opens its first book.
            if number == nil, let t = availableTexts.first(where: { $0.name.lowercased() == name || $0.short.lowercased() == name || $0.id == name }),
               let first = bookCatalog.first(where: { $0.textId == t.id }) {
                return ResolvedPassage(textId: t.id, bookId: first.book.id, chapter: max(1, first.book.chaptersCount > 0 ? 1 : 1), verse: nil)
            }
            return nil
        }
        if hit.book.chaptersCount == 1 { return ResolvedPassage(textId: hit.textId, bookId: hit.book.id, chapter: 1, verse: number) }
        return ResolvedPassage(textId: hit.textId, bookId: hit.book.id, chapter: number ?? 1, verse: nil)
    }
}
