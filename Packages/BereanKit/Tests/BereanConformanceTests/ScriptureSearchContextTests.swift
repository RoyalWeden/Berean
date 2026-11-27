import Testing
import BereanBible
import BereanText

@Suite("Search context preview", .enabled(if: dataFile("lxx_brenton") != nil && dataFile("kjva") != nil))
struct ScriptureSearchContextTests {
    private let bible = BibleService(resolvePath: { dataFile($0 == "lxx" ? "lxx_brenton" : $0) })

    private func lines(_ raw: [ChapterVerseRow], text: String, chapter: Int, stored: Int,
                       edge: ScriptureSearchContext.Edge, span: Int = 2, enabled: Bool = false,
                       rules: [WordReplacerRule] = []) -> [ScriptureSearchContext.Line] {
        let hit = ScriptureHit(textId: text, bookId: raw.first?.bookId ?? "PSA", chapter: chapter, verseNum: stored, text: "", textTagged: nil)
        return ScriptureSearchContext.lines(in: raw, around: hit, span: span, edge: edge,
                                            replacerEnabled: enabled, rules: rules)
    }

    @Test func brentonTitleAndBodyShareTheSameContext() async throws {
        let raw = await bible.queryChapter("PSA", 3, textId: "lxx")
        #expect(lines(raw, text: "lxx", chapter: 3, stored: 1, edge: .before).isEmpty)
        #expect(lines(raw, text: "lxx", chapter: 3, stored: 2, edge: .before).isEmpty)
        let afterTitle = lines(raw, text: "lxx", chapter: 3, stored: 1, edge: .after)
        #expect(afterTitle == lines(raw, text: "lxx", chapter: 3, stored: 2, edge: .after))
        #expect(afterTitle.map(\.id) == [3, 4])
        #expect(afterTitle.map(\.label) == ["2", "3"])
        let beforeSecond = lines(raw, text: "lxx", chapter: 3, stored: 3, edge: .before)
        #expect(beforeSecond.map(\.label) == ["1"])
        #expect(try #require(beforeSecond.first).text.hasPrefix("O Lord, why are they"))
    }

    @Test func kingJamesContextHonorsCurrentWordReplacementAndChapterBoundaries() async throws {
        let raw = await bible.queryChapter("PSA", 3, textId: "kjva")
        let following = await bible.queryChapter("PSA", 4, textId: "kjva")
        let rule = WordReplacerRule(id: "test", queries: ["LORD"], replacement: "Yehovah", wholeWord: true, enabled: true)
        let plain = lines(raw, text: "kjva", chapter: 3, stored: 2, edge: .before, rules: [rule])
        let replaced = lines(raw, text: "kjva", chapter: 3, stored: 2, edge: .before, enabled: true, rules: [rule])
        #expect(plain.map(\.label) == ["1"])
        #expect(replaced.map(\.label) == plain.map(\.label))
        #expect(try #require(plain.first).text.hasPrefix("Lord, how are they"))
        #expect(try #require(replaced.first).text.hasPrefix("Yehovah, how are they"))
        let last = try #require(raw.last).verseNum
        #expect(lines(raw + following, text: "kjva", chapter: 3, stored: last, edge: .after).isEmpty)
        #expect(lines(raw, text: "kjva", chapter: 3, stored: last + 1, edge: .before).isEmpty)
    }

    @Test func brentonPsalmNineKeepsDisplayedNeighborsAcrossTheKJVSplit() async {
        let raw = await bible.queryChapter("PSA", 9, textId: "lxx")
        #expect(lines(raw, text: "lxx", chapter: 9, stored: 22, edge: .before).map(\.label) == ["19", "20"])
        #expect(lines(raw, text: "lxx", chapter: 9, stored: 22, edge: .after).map(\.label) == ["22", "23"])
    }

    @Test func brentonCombinedRowAppearsOnceAndReportsItsFullRange() async {
        let raw = await bible.queryChapter("PSA", 115, textId: "lxx")
        #expect(lines(raw, text: "lxx", chapter: 115, stored: 6, edge: .before).map(\.label) == ["4–5"])
        #expect(lines(raw, text: "lxx", chapter: 115, stored: 4, edge: .after, span: 1).map(\.label) == ["6"])
    }

    @Test func brentonChroniclesContextKeepsVerseNumberGaps() async {
        let raw = await bible.queryChapter("1CH", 1, textId: "lxx")
        #expect(raw.contains { $0.verseNum == 17 })
        #expect(lines(raw, text: "lxx", chapter: 1, stored: 10, edge: .after).isEmpty)
        #expect(lines(raw, text: "lxx", chapter: 1, stored: 17, edge: .before).isEmpty)
        #expect(lines(raw, text: "lxx", chapter: 1, stored: 17, edge: .after).isEmpty)
    }

    @Test(.enabled(if: dataFile("apoc_abraham") != nil))
    func abrahamContextKeepsVerseNumberGaps() async {
        let raw = await bible.queryChapter("ABR", 5, textId: "apoc_abraham")
        #expect(raw.contains { $0.verseNum == 4 })
        #expect(lines(raw, text: "apoc_abraham", chapter: 5, stored: 1, edge: .after).isEmpty)
        #expect(lines(raw, text: "apoc_abraham", chapter: 5, stored: 4, edge: .before).isEmpty)
        #expect(lines(raw, text: "apoc_abraham", chapter: 5, stored: 4, edge: .after).isEmpty)
    }
}
