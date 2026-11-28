/// A search view shares immutable chapter reads across its context previews.
public actor ScriptureSearchChapterCache {
    private struct Key: Hashable {
        let bible: BibleService
        let textId: String
        let bookId: String
        let chapter: Int

        static func == (lhs: Self, rhs: Self) -> Bool {
            lhs.bible === rhs.bible && lhs.textId == rhs.textId && lhs.bookId == rhs.bookId && lhs.chapter == rhs.chapter
        }

        func hash(into hasher: inout Hasher) {
            hasher.combine(ObjectIdentifier(bible))
            hasher.combine(textId)
            hasher.combine(bookId)
            hasher.combine(chapter)
        }
    }

    typealias Loader = @Sendable (BibleService, String, String, Int) async -> [ChapterVerseRow]
    private final class Entry {
        let task: Task<[ChapterVerseRow], Never>
        init(_ task: Task<[ChapterVerseRow], Never>) { self.task = task }
    }

    private let load: Loader
    private let capacity: Int
    private var entries: [Key: Entry] = [:]
    private var order: [Key] = []

    public init() {
        capacity = 16
        load = { bible, textId, bookId, chapter in
            await bible.queryChapter(bookId, chapter, textId: textId)
        }
    }

    init(capacity: Int, load: @escaping Loader) {
        precondition(capacity > 0)
        self.capacity = capacity
        self.load = load
    }

    public func rows(in bible: BibleService, textId: String, bookId: String, chapter: Int) async -> [ChapterVerseRow] {
        guard let task = await chapterTask(in: bible, textId: textId, bookId: bookId, chapter: chapter) else { return [] }
        return await task.value
    }

    func chapterTask(in bible: BibleService, textId: String, bookId: String, chapter: Int) async -> Task<[ChapterVerseRow], Never>? {
        let key = Key(bible: bible, textId: textId, bookId: bookId, chapter: chapter)
        while !Task.isCancelled {
            if let existing = entries[key] { return existing.task }
            if order.count < capacity {
                let load = self.load
                let task = Task { await load(bible, textId, bookId, chapter) }
                entries[key] = Entry(task)
                order.append(key)
                return task
            }
            let oldest = order[0]
            let candidate = entries[oldest]!
            // Keep pending reads discoverable by other callers and cap queued reads.
            // Only evict this exact entry after completion; another waiter may have raced us.
            _ = await candidate.task.value
            if !Task.isCancelled, entries[key] == nil, order.first == oldest, entries[oldest] === candidate {
                entries.removeValue(forKey: order.removeFirst())
            }
        }
        return nil
    }
}
