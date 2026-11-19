import Foundation
import BereanCore
import BereanBible
import BereanReference
import BereanText
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

    static func savedVerses(in state: JSObject, reader: BibleState) -> Set<Int> {
        guard reader.endVerse == nil, let active = reader.verse,
              let saved = state["nativeSelectedVerses"],
              saved["passage"]?.stringValue?.string == "\(reader.translation)|\(reader.bookId)|\(reader.chapter)",
              saved["activeVerse"]?.numberValue == Double(active) else { return [] }
        let verses = Set((saved["verses"]?.arrayValue ?? []).compactMap { $0.numberValue.flatMap(Int.init(exactly:)) }
            .filter { (1...999).contains($0) })
        return verses.contains(active) ? verses : []
    }

    var label: String {
        // A whole chapter reads as the reader titles it ("Psalm 3", not "Psalms 3").
        if verse == nil, verseGroups.isEmpty { return Reference.readerChapterLabel(bookId, chapter, textId: textId) }
        func number(_ stored: Int) -> Int {
            PsalmSuperscription.readerVerseNum(stored, bookId: bookId, chapter: chapter, textId: textId)
        }
        func end(_ stored: Int) -> Int {
            PsalmSuperscription.readerVerseNumbers(stored, bookId: bookId, chapter: chapter, textId: textId).upperBound
        }
        func run(_ first: Int, _ last: Int, full: Bool) -> String {
            let base = full ? Reference.bookChapterVerseLabel(bookId, chapter: chapter, verse: first, hermas: HermasText(textId: textId)) : String(first)
            return last > first ? "\(base)–\(last)" : base
        }
        if !verseGroups.isEmpty {
            let displayed = Set(verseGroups.flatMap { number($0.lowerBound)...end($0.upperBound) })
            return consecutiveVerseRuns(displayed).enumerated().map { index, group in
                run(group.lowerBound, group.upperBound, full: index == 0)
            }.joined(separator: ", ")
        }
        guard let verse else { return Reference.bookChapterVerseLabel(bookId, chapter: chapter, verse: nil, hermas: HermasText(textId: textId)) }
        return run(number(verse), end(endVerse ?? verse), full: true)
    }

    /// Human-entered references use reader numbering; persisted links stay raw.
    var convertingReaderNumbersToStored: Self {
        var result = self
        func stored(_ displayed: Int) -> Int {
            PsalmSuperscription.storedVerseNum(displayed, bookId: bookId, chapter: chapter, textId: textId)
        }
        result.verse = verse.map(stored)
        result.endVerse = endVerse.map(stored)
        result.verseGroups = verseGroups.map { stored($0.lowerBound)...stored($0.upperBound) }
        return result
    }

    /// Ordinary Go reuse excludes Compare. An explicit verse-jump request can
    /// match its anchor location without changing those tab-reuse semantics.
    func isShown(in tab: Tab) -> Bool { isShown(in: tab, allowCompare: false) }

    func isShown(in tab: Tab, allowCompare: Bool) -> Bool {
        guard tab.tabType == .bible, tab.state["endChapter"]?.numberValue == nil else { return false }
        let state = BibleState(tab.state)
        return (!state.compareMode || allowCompare) && state.translation == textId && state.bookId == bookId
            && state.chapter == chapter && state.verse == verse && state.endVerse == endVerse
            && (tab.state["nativeSelectedVerses"] ?? .null) == savedSelection
    }
}

extension ChapterVerseRow {
    func readerReferenceLabel(textId: String) -> String {
        ResolvedPassage(textId: textId, bookId: bookId, chapter: chapter, verse: verseNum).label
    }
}

extension AppModel {
    func strongsExcerpt(_ id: String) async -> String? {
        guard let entry = await lexicon.entry(id) else { return nil }
        let gloss = entry.gloss.isEmpty ? entry.definition : entry.gloss
        let parts = [entry.lemma, entry.transliteration, gloss].filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    func passageExcerpt(_ passage: ResolvedPassage) async -> String? {
        let edition = ChapterEdition(book: passage.bookId, chapter: passage.chapter, text: passage.textId)
        let chapter = await readerChapter(edition)
        // Preview the original database row, never a prepared missing-LXX marker
        // or a superscription moved onto the first verse for the reader.
        let row: ChapterVerseRow?
        if let verse = passage.verse { row = chapter.rawRows.first { $0.verseNum == verse } }
        else { row = chapter.rawRows.first { $0.verseNum > 0 } ?? chapter.rawRows.first }
        let text = row?.text
        let tagged = row?.textTagged
        guard let text, !text.isEmpty else { return nil }
        return VerseDisplay.text(text, tagged: tagged, textId: passage.textId,
                                 replacerEnabled: wordReplacerEnabled, rules: WordReplacer.defaultRules)
    }

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

    func editionQualifiedQuery(_ query: String) -> (text: String, query: String)? {
        guard let separator = query.firstIndex(of: ":") else { return nil }
        let source = query[..<separator].trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let text = ["septuagint", "brenton"].contains(source) ? "lxx" : source
        guard text == "kjv" || availableTexts.contains(where: { $0.id == text }) else { return nil }
        return (text, query[query.index(after: separator)...].trimmingCharacters(in: .whitespacesAndNewlines))
    }

    func resolvePassage(_ raw: String, preferring current: String? = nil) -> ResolvedPassage? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.contains("://") { return resolvePastedPassages(trimmed, preferring: current) }
        let qualified = editionQualifiedQuery(trimmed)
        let prefixedText = qualified?.text
        let query = qualified?.query ?? trimmed
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
                                   endVerse: groups.isEmpty ? ref.endVerse : nil, verseGroups: groups).convertingReaderNumbersToStored
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
