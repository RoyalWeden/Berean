import BereanReference

/// A cross-reference database source uses canonical KJV coordinates, whereas
/// reader selection/annotations use the installed edition's stored identities.
public struct ReaderCrossReferenceSource: Hashable, Sendable {
    public let bookId: String
    public let chapter: Int
    public let verse: Int

    public init(bookId: String, chapter: Int, verse: Int) {
        self.bookId = bookId
        self.chapter = chapter
        self.verse = verse
    }
}

extension CrossrefsService {
    /// Native-only adapter. The original service entry points remain the
    /// legacy conformance oracle; callers must pass stored, not displayed IDs.
    public nonisolated static func readerSources(_ bookId: String, _ chapter: Int, _ verse: Int,
                                                  textId: String) -> [ReaderCrossReferenceSource] {
        let book = bookId.uppercased()
        guard verse > 0 else { return [] }
        guard ChapterMap.isLxx(textId) else {
            return [.init(bookId: book, chapter: chapter, verse: verse)]
        }
        if book == "PSA" {
            if chapter == 151 { return [] }
            if chapter == 115, verse == 4 {
                return [13, 14].map { .init(bookId: book, chapter: 116, verse: $0) }
            }
            // Legacy links may address one of the title rows now folded into
            // the first body verse. They share that verse's canonical source.
            let firstBody = PsalmSuperscription.storedVerseNum(1, bookId: book, chapter: chapter, textId: "lxx")
            let stored = max(verse, firstBody)
            if let counterpart = PsalmSuperscription.verseCounterpart(book, chapter: chapter, verse: stored, from: "lxx", to: "kjva") {
                return [.init(bookId: book, chapter: counterpart.chapter, verse: counterpart.verse)]
            }
        } else if let counterpart = ChapterMap.verseCounterpart(book, chapter: chapter, verse: verse, from: "lxx", to: "kjva") {
            return [.init(bookId: book, chapter: counterpart.chapter, verse: counterpart.verse)]
        }
        // Retain the existing fallback for books with no verified verse map.
        // A structural edition note is not evidence for inventing a new map.
        return [.init(bookId: book, chapter: ChapterMap.mapChapter(book, chapter, from: "lxx", to: "kjva"), verse: verse)]
    }

    public func forReaderVerse(_ bookId: String, _ chapter: Int, _ verse: Int,
                              textId: String = "kjva") -> (refs: [CrossRef], error: Bool) {
        let sources = Self.readerSources(bookId, chapter, verse, textId: textId)
        guard !sources.isEmpty else { return ([], false) }
        let results = sources.map { crossRefs($0.bookId, $0.chapter, $0.verse) }
        if results.count == 1 { return (results[0] ?? [], results[0] == nil) }
        return (Self.mergeReaderRefs(results.compactMap { $0 }.flatMap { $0 }), results.allSatisfy { $0 == nil })
    }

    public func tskeForReaderVerse(_ bookId: String, _ chapter: Int, _ verse: Int,
                                  textId: String = "kjva") -> (groups: [TskeGroup], error: Bool) {
        let sources = Self.readerSources(bookId, chapter, verse, textId: textId)
        guard !sources.isEmpty else { return ([], false) }
        let results = sources.map { tske($0.bookId, $0.chapter, $0.verse) }
        if results.count == 1 { return (results[0] ?? [], results[0] == nil) }
        return (Self.mergeReaderGroups(results.compactMap { $0 }.flatMap { $0 }), results.allSatisfy { $0 == nil })
    }

    /// Fetch each canonical chapter once, then regroup under the actual visible
    /// stored reader rows. This avoids both phantom title groups and N queries
    /// per verse in long chapters such as Psalm119.
    public func forReaderChapter(_ bookId: String, _ chapter: Int, verseNumbers: [Int],
                                textId: String = "kjva") -> (verseRefs: [(verseNum: Int, refs: [CrossRef])], error: Bool) {
        let index = Self.readerSourceIndex(bookId, chapter, verseNumbers: verseNumbers, textId: textId)
        guard !index.chapters.isEmpty else { return ([], false) }
        var byVerse: [Int: [CrossRef]] = [:]
        var errors = 0
        for source in index.chapters {
            let data = forChapter(source.bookId, source.chapter, textId: "kjva")
            if data.error { errors += 1 }
            for group in data.verseRefs {
                let key = ReaderCrossReferenceSource(bookId: source.bookId, chapter: source.chapter, verse: group.verseNum)
                for stored in index.rows[key] ?? [] { byVerse[stored, default: []] += group.refs }
            }
        }
        return (index.verses.compactMap { stored in
            guard let refs = byVerse[stored], !refs.isEmpty else { return nil }
            return (stored, Self.readerSources(bookId, chapter, stored, textId: textId).count > 1 ? Self.mergeReaderRefs(refs) : refs)
        }, errors == index.chapters.count)
    }

    public func tskeForReaderChapter(_ bookId: String, _ chapter: Int, verseNumbers: [Int],
                                    textId: String = "kjva") -> (verseRefs: [(verseNum: Int, groups: [TskeGroup])], error: Bool) {
        let index = Self.readerSourceIndex(bookId, chapter, verseNumbers: verseNumbers, textId: textId)
        guard !index.chapters.isEmpty else { return ([], false) }
        var byVerse: [Int: [TskeGroup]] = [:]
        var errors = 0
        for source in index.chapters {
            let data = tskeForChapter(source.bookId, source.chapter, textId: "kjva")
            if data.error { errors += 1 }
            for group in data.verseRefs {
                let key = ReaderCrossReferenceSource(bookId: source.bookId, chapter: source.chapter, verse: group.verseNum)
                for stored in index.rows[key] ?? [] { byVerse[stored, default: []] += group.groups }
            }
        }
        return (index.verses.compactMap { stored in
            guard let groups = byVerse[stored], !groups.isEmpty else { return nil }
            return (stored, Self.readerSources(bookId, chapter, stored, textId: textId).count > 1 ? Self.mergeReaderGroups(groups) : groups)
        }, errors == index.chapters.count)
    }

    private nonisolated static func readerSourceIndex(_ book: String, _ chapter: Int, verseNumbers: [Int], textId: String)
        -> (verses: [Int], chapters: [ReaderCrossReferenceSource], rows: [ReaderCrossReferenceSource: [Int]]) {
        var seenVerses = Set<Int>(), seenChapters = Set<ReaderCrossReferenceSource>()
        let verses = verseNumbers.filter { $0 > 0 && seenVerses.insert($0).inserted }
        var chapters: [ReaderCrossReferenceSource] = [], rows: [ReaderCrossReferenceSource: [Int]] = [:]
        for verse in verses {
            for source in readerSources(book, chapter, verse, textId: textId) {
                rows[source, default: []].append(verse)
                let chapterKey = ReaderCrossReferenceSource(bookId: source.bookId, chapter: source.chapter, verse: 0)
                if seenChapters.insert(chapterKey).inserted { chapters.append(chapterKey) }
            }
        }
        return (verses, chapters, rows)
    }

    private nonisolated static func mergeReaderRefs(_ refs: [CrossRef]) -> [CrossRef] {
        var order: [ReaderRefKey] = [], unique: [ReaderRefKey: CrossRef] = [:]
        for ref in refs {
            let key = ReaderRefKey(book: ref.bookId, chapter: ref.chapter, verse: ref.verse, end: ref.endVerse)
            if let previous = unique[key] {
                if ref.votes > previous.votes { unique[key] = ref }
            } else { order.append(key); unique[key] = ref }
        }
        // Deterministic first-source order breaks vote ties without relying on
        // dictionary iteration or the stability of the platform sort.
        return order.enumerated().sorted {
            let a = unique[$0.element]!.votes, b = unique[$1.element]!.votes
            return a == b ? $0.offset < $1.offset : a > b
        }.map { unique[$0.element]! }
    }

    private nonisolated static func mergeReaderGroups(_ groups: [TskeGroup]) -> [TskeGroup] {
        var order: [ReaderGroupKey] = [], merged: [ReaderGroupKey: TskeGroup] = [:]
        var seen: [ReaderGroupKey: Set<ReaderTskeKey>] = [:]
        for group in groups {
            let key = ReaderGroupKey(heading: group.heading, reciprocal: group.isReciprocal)
            if merged[key] == nil {
                order.append(key)
                merged[key] = TskeGroup(heading: group.heading, isReciprocal: group.isReciprocal, refs: [])
            }
            for ref in group.refs {
                let identity = ReaderTskeKey(target: .init(book: ref.bookId, chapter: ref.chapter, verse: ref.verse, end: ref.endVerse), context: ref.context)
                if seen[key, default: []].insert(identity).inserted { merged[key]!.refs.append(ref) }
            }
        }
        return order.map { merged[$0]! }
    }
}

private struct ReaderRefKey: Hashable { let book: String; let chapter: Int; let verse: Int; let end: Int? }
private struct ReaderGroupKey: Hashable { let heading: String?; let reciprocal: Bool }
private struct ReaderTskeKey: Hashable { let target: ReaderRefKey; let context: String? }
