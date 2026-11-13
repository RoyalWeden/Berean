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
    var endVerse: Int? = nil

    var label: String {
        let start = Reference.bookChapterVerseLabel(bookId, chapter: chapter, verse: verse, hermas: HermasText(textId: textId))
        guard let verse, let endVerse, endVerse > verse else { return start }
        return "\(start)–\(endVerse)"
    }

    func isShown(in tab: Tab) -> Bool {
        guard tab.tabType == .bible, tab.state["endChapter"]?.numberValue == nil else { return false }
        let state = BibleState(tab.state)
        return !state.compareMode && state.translation == textId && state.bookId == bookId
            && state.chapter == chapter && state.verse == verse && state.endVerse == endVerse
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
        let edition = HermasText(rawValue: pref) ?? hermasEdition
        func textFor(_ bookId: String, forced: String? = nil) -> String {
            if Reference.isHermasBook(bookId) { return edition.rawValue }
            if let forced { return forced }
            if bookCatalog.isEmpty || bookCatalog.contains(where: { $0.textId == pref && $0.book.id == bookId }) { return pref }
            return bookCatalog.first { $0.book.id == bookId }?.textId ?? pref
        }
        if let ref = Reference.parse(q, hermas: edition) {
            return ResolvedPassage(textId: textFor(ref.bookId, forced: ref.forcedTranslation == "LXX" ? "lxx" : nil), bookId: ref.bookId, chapter: ref.chapter, verse: ref.verse, endVerse: ref.endVerse)
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
        let preferredHit = hits.first {
            $0.textId == (Reference.isHermasBook($0.book.id) ? edition.rawValue : pref)
        }
        guard let hit = preferredHit ?? hits.first else {
            // A text's own name ("didache", "enoch", "jubilees") opens its first book.
            if number == nil, let t = availableTexts.first(where: { $0.name.lowercased() == name || $0.short.lowercased() == name || $0.id == name }) {
                let textId = t.id == HermasText.robertsDonaldson.rawValue ? edition.rawValue : t.id
                if let first = bookCatalog.first(where: { $0.textId == textId }) {
                    return ResolvedPassage(textId: textId, bookId: first.book.id, chapter: 1, verse: nil)
                }
            }
            return nil
        }
        if hit.book.chaptersCount == 1 { return ResolvedPassage(textId: hit.textId, bookId: hit.book.id, chapter: 1, verse: number) }
        return ResolvedPassage(textId: hit.textId, bookId: hit.book.id, chapter: number ?? 1, verse: nil)
    }
}
