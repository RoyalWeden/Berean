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
        // A whole chapter reads as the reader titles it ("Psalm 3", not "Psalms 3").
        if verse == nil, verseGroups.isEmpty { return Reference.readerChapterLabel(bookId, chapter, textId: textId) }
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

    func resolveLinkedPassage(_ route: DeepLinkRoute?, preferring current: String? = nil) -> ResolvedPassage? {
        guard case .verse(let book, let chapter, let verse, let end, let requestedText, _) = route,
              verse.map({ (0...999).contains($0) }) ?? true,
              end.map({ value in verse.map { value >= $0 && value <= 999 } ?? false }) ?? true else { return nil }

        let text: String
        if let requestedText {
            let normalized = requestedText.lowercased()
            guard normalized == "kjv" || availableTexts.contains(where: { $0.id == normalized }) else { return nil }
            text = normalized
        } else if Reference.isHermasBook(book) {
            text = hermasEdition.rawValue
        } else {
            let preferred = current ?? defaultText
            text = bookCatalog.first { $0.book.id == book && $0.textId == preferred }?.textId
                ?? bookCatalog.first { $0.book.id == book }?.textId
                ?? Reference.translation(forBook: book, hermas: hermasEdition) ?? preferred
        }
        return ResolvedPassage(textId: text, bookId: book, chapter: chapter, verse: verse, endVerse: end)
    }

    private func resolvePastedPassages(_ query: String, preferring current: String?) -> ResolvedPassage? {
        let links = query.split(whereSeparator: \.isWhitespace)
        let passages = links.compactMap {
            resolveLinkedPassage(DeepLink.parse(String($0), hermas: hermasEdition), preferring: current)
        }
        guard passages.count == links.count, var first = passages.first else { return nil }
        guard passages.count > 1 else { return first }
        var selected = Set<Int>()
        for passage in passages {
            guard passage.bookId == first.bookId, passage.chapter == first.chapter, passage.textId == first.textId,
                  let verse = passage.verse, verse > 0 else { return nil }
            selected.formUnion(verse...(passage.endVerse ?? verse))
        }
        let runs = consecutiveVerseRuns(selected)
        guard let range = runs.first else { return nil }
        first.verse = range.lowerBound
        first.endVerse = runs.count == 1 && range.count > 1 ? range.upperBound : nil
        first.verseGroups = runs.count > 1 ? runs : []
        return first
    }

    func resolvePassage(_ raw: String, preferring current: String? = nil) -> ResolvedPassage? {
        var query = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return nil }
        if query.contains("://") { return resolvePastedPassages(query, preferring: current) }
        var prefixedText: String?
        if let separator = query.firstIndex(of: ":") {
            let source = query[..<separator].trimmingCharacters(in: .whitespaces).lowercased()
            if ["lxx", "septuagint", "brenton"].contains(source) {
                prefixedText = "lxx"
            } else if source == "kjv" || availableTexts.contains(where: { $0.id == source }) {
                prefixedText = source
            }
            if prefixedText != nil {
                query = query[query.index(after: separator)...].trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }
        guard !query.isEmpty else { return nil }
        let suffix = query.range(of: #"\s+(kjva|kjv|lxx|\[[^\[\]]+\])$"#, options: [.regularExpression, .caseInsensitive])
        let suffixLabel = suffix.map { query[$0].trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
        let suffixedText: String?
        if let suffixLabel, suffixLabel.hasPrefix("[") {
            let name = String(suffixLabel.dropFirst().dropLast())
            guard let text = availableTexts.first(where: { $0.short.lowercased() == name }) else { return nil }
            suffixedText = text.id
        } else {
            suffixedText = suffixLabel
        }
        if let prefixedText, let suffixedText, prefixedText != suffixedText { return nil }
        let requestedText = prefixedText ?? suffixedText
        let q = suffix.map { String(query[..<$0.lowerBound]) } ?? query
        let pref = current ?? defaultText
        let edition = HermasText(rawValue: requestedText ?? pref) ?? hermasEdition
        let candidates = requestedText == "kjv"
            ? (explicitKJVBooks ?? []).map { CatalogBook(textId: "kjv", book: $0) }
            : bookCatalog
        func textFor(_ bookId: String, forced: String? = nil) -> String {
            if let forced { return forced }
            if Reference.isHermasBook(bookId) { return edition.rawValue }
            if bookCatalog.isEmpty || bookCatalog.contains(where: { $0.textId == pref && $0.book.id == bookId }) { return pref }
            return bookCatalog.first { $0.book.id == bookId }?.textId ?? pref
        }
        let referenceQuery = requestedText == "lxx" ? q + " LXX" : q
        if let ref = Reference.parse(referenceQuery, hermas: edition) {
            if let requestedText {
                guard ref.forcedTranslation == nil || ref.forcedTranslation?.lowercased() == requestedText,
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
