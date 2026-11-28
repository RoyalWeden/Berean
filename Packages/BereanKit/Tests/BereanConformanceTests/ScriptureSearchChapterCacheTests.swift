import Testing
@testable import BereanBible

struct ScriptureSearchChapterCacheTests {
    private actor Loader {
        let blockedChapter: Int?
        private(set) var calls = 0
        private var loading: CheckedContinuation<Void, Never>?
        private var started: CheckedContinuation<Void, Never>?

        init(blockedChapter: Int? = nil) {
            self.blockedChapter = blockedChapter
        }

        func load(_ textId: String, _ bookId: String, _ chapter: Int) async -> [ChapterVerseRow] {
            calls += 1
            if calls == 1, chapter == blockedChapter {
                await withCheckedContinuation {
                    loading = $0
                    started?.resume()
                    started = nil
                }
            }
            return [.init(bookId: bookId, chapter: chapter, verseNum: 1, text: textId, textTagged: nil, title: nil)]
        }

        func waitForBlockedLoad() async {
            if loading != nil { return }
            await withCheckedContinuation { started = $0 }
        }

        func finishBlockedLoad() {
            loading?.resume()
            loading = nil
        }
    }

    @Test func simultaneousRequestsShareAChapterRead() async throws {
        let loader = Loader(blockedChapter: 3)
        let bible = BibleService(resolvePath: { _ in nil })
        let cache = ScriptureSearchChapterCache(capacity: 2) { _, textId, bookId, chapter in
            await loader.load(textId, bookId, chapter)
        }
        let first = try #require(await cache.chapterTask(in: bible, textId: "lxx", bookId: "PSA", chapter: 3))
        await loader.waitForBlockedLoad()
        let second = try #require(await cache.chapterTask(in: bible, textId: "lxx", bookId: "PSA", chapter: 3))
        await loader.finishBlockedLoad()
        let (before, after) = await (first.value, second.value)
        #expect(before == after)
        #expect(before.first?.chapter == 3)
        #expect(await loader.calls == 1)
    }

    @Test func keysSeparateLibrariesEditionsBooksAndChapters() async {
        let loader = Loader()
        let bible = BibleService(resolvePath: { _ in nil })
        let otherBible = BibleService(resolvePath: { _ in nil })
        let cache = ScriptureSearchChapterCache(capacity: 8) { _, textId, bookId, chapter in
            await loader.load(textId, bookId, chapter)
        }
        _ = await cache.rows(in: bible, textId: "lxx", bookId: "PSA", chapter: 3)
        _ = await cache.rows(in: otherBible, textId: "lxx", bookId: "PSA", chapter: 3)
        _ = await cache.rows(in: bible, textId: "kjva", bookId: "PSA", chapter: 3)
        _ = await cache.rows(in: bible, textId: "lxx", bookId: "GEN", chapter: 3)
        _ = await cache.rows(in: bible, textId: "lxx", bookId: "PSA", chapter: 4)
        _ = await cache.rows(in: bible, textId: "lxx", bookId: "PSA", chapter: 3)
        #expect(await loader.calls == 5)
    }

    @Test func pendingChapterStaysAvailableAtCapacityWhileDistinctMissesWait() async throws {
        let loader = Loader(blockedChapter: 3)
        let bible = BibleService(resolvePath: { _ in nil })
        let cache = ScriptureSearchChapterCache(capacity: 1) { _, textId, bookId, chapter in
            await loader.load(textId, bookId, chapter)
        }
        let first = try #require(await cache.chapterTask(in: bible, textId: "lxx", bookId: "PSA", chapter: 3))
        await loader.waitForBlockedLoad()
        async let next = cache.rows(in: bible, textId: "lxx", bookId: "PSA", chapter: 9)
        async let last = cache.rows(in: bible, textId: "lxx", bookId: "PSA", chapter: 115)
        let revisit = try #require(await cache.chapterTask(in: bible, textId: "lxx", bookId: "PSA", chapter: 3))
        #expect(await loader.calls == 1)
        await loader.finishBlockedLoad()
        #expect(await first.value == revisit.value)
        let (chapterNine, chapter115) = await (next, last)
        #expect(chapterNine.first?.chapter == 9)
        #expect(chapter115.first?.chapter == 115)
        #expect(await loader.calls == 3)
        _ = await cache.rows(in: bible, textId: "lxx", bookId: "PSA", chapter: 3)
        #expect(await loader.calls == 4)
    }

    @Test func aCancelledMissDoesNotStartAnotherLoad() async throws {
        let loader = Loader(blockedChapter: 3)
        let bible = BibleService(resolvePath: { _ in nil })
        let cache = ScriptureSearchChapterCache(capacity: 1) { _, textId, bookId, chapter in
            await loader.load(textId, bookId, chapter)
        }
        let first = try #require(await cache.chapterTask(in: bible, textId: "lxx", bookId: "PSA", chapter: 3))
        await loader.waitForBlockedLoad()
        let cancelled = Task { await cache.rows(in: bible, textId: "lxx", bookId: "PSA", chapter: 9) }
        await Task.yield()
        cancelled.cancel()
        await loader.finishBlockedLoad()
        #expect(await cancelled.value.isEmpty)
        #expect(await first.value.first?.chapter == 3)
        #expect(await loader.calls == 1)
    }
}
