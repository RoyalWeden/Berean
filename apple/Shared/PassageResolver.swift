import Foundation
import BereanCore
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
    var verseGroups: [ClosedRange<Int>] = []

    var savedSelection: JSValue {
        guard !verseGroups.isEmpty, let verse else { return .null }
        var object = JSObject()
        object["passage"] = .string(JSString("\(textId)|\(bookId)|\(chapter)"))
        object["activeVerse"] = .number(Double(verse))
        object["verses"] = .array(Set(verseGroups.flatMap { $0 }).sorted().map { .number(Double($0)) })
        return .object(object)
    }

    static func savedVerses(in tab: Tab, reader: BibleState) -> Set<Int> {
        guard reader.endVerse == nil, let active = reader.verse,
              let saved = tab.state["nativeSelectedVerses"],
              saved["passage"]?.stringValue?.string == "\(reader.translation)|\(reader.bookId)|\(reader.chapter)",
              saved["activeVerse"]?.numberValue == Double(active) else { return [] }
        let verses = Set((saved["verses"]?.arrayValue ?? []).compactMap { $0.numberValue.flatMap(Int.init(exactly:)) }
            .filter { (1...999).contains($0) })
        return verses.contains(active) ? verses : []
    }

    var label: String {
        let start = Reference.bookChapterVerseLabel(bookId, chapter: chapter, verse: verse, hermas: HermasText(textId: textId))
        if let first = verseGroups.first {
            let base = Reference.bookChapterVerseLabel(bookId, chapter: chapter, verse: first.lowerBound, hermas: HermasText(textId: textId))
            let suffix = first.lowerBound == first.upperBound ? "" : "–\(first.upperBound)"
            return ([base + suffix] + verseGroups.dropFirst().map {
                $0.lowerBound == $0.upperBound ? String($0.lowerBound) : "\($0.lowerBound)–\($0.upperBound)"
            }).joined(separator: ", ")
        }
        guard let verse, let endVerse, endVerse > verse else { return start }
        return "\(start)–\(endVerse)"
    }

    func isShown(in tab: Tab) -> Bool {
        guard tab.tabType == .bible, tab.state["endChapter"]?.numberValue == nil else { return false }
        let state = BibleState(tab.state)
        return !state.compareMode && state.translation == textId && state.bookId == bookId
            && state.chapter == chapter && state.verse == verse && state.endVerse == endVerse
            && (tab.state["nativeSelectedVerses"] ?? .null) == savedSelection
    }
}

extension AppModel {
    /// Every book of every listed text (loaded once, off the main thread).
    func loadBookCatalog() {
        guard bookCatalog.isEmpty else { return }
        Task {
            explicitKJVBooks = await books(for: "kjv")
            bookCatalog = await catalog()
        }
    }

    func resolvePassage(_ raw: String, preferring current: String? = nil) -> ResolvedPassage? {
        let query = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return nil }
        let suffix = query.range(of: #"\s+(kjva|kjv)$"#, options: [.regularExpression, .caseInsensitive])
        let requestedText = suffix.map { query[$0].trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        let q = suffix.map { String(query[..<$0.lowerBound]) } ?? query
        let pref = current ?? defaultText
        let edition = HermasText(rawValue: pref) ?? hermasEdition
        let candidates = requestedText == "kjv"
            ? (explicitKJVBooks ?? []).map { CatalogBook(textId: "kjv", book: $0) }
            : bookCatalog
        func textFor(_ bookId: String, forced: String? = nil) -> String {
            if Reference.isHermasBook(bookId) { return edition.rawValue }
            if let forced { return forced }
            if bookCatalog.isEmpty || bookCatalog.contains(where: { $0.textId == pref && $0.book.id == bookId }) { return pref }
            return bookCatalog.first { $0.book.id == bookId }?.textId ?? pref
        }
        if let ref = Reference.parse(q, hermas: edition) {
            if let requestedText {
                guard ref.forcedTranslation == nil, !Reference.isHermasBook(ref.bookId),
                      candidates.contains(where: { $0.textId == requestedText && $0.book.id == ref.bookId })
                else { return nil }
            }
            let groups = (ref.verseGroups ?? []).compactMap { group -> ClosedRange<Int>? in
                let end = group.endVerse ?? group.verse
                guard group.verse > 0, end >= group.verse, end <= 999 else { return nil }
                return group.verse...end
            }
            return ResolvedPassage(textId: textFor(ref.bookId, forced: requestedText ?? (ref.forcedTranslation == "LXX" ? "lxx" : nil)),
                                   bookId: ref.bookId, chapter: ref.chapter, verse: groups.first?.lowerBound ?? ref.verse,
                                   endVerse: groups.isEmpty ? ref.endVerse : nil, verseGroups: groups)
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
        let hits = candidates.filter { (requestedText == nil || $0.textId == requestedText) && matches($0.book) }
        let preferredHit = hits.first {
            $0.textId == (Reference.isHermasBook($0.book.id) ? edition.rawValue : pref)
        }
        guard let hit = preferredHit ?? hits.first else {
            guard requestedText == nil else { return nil }
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
