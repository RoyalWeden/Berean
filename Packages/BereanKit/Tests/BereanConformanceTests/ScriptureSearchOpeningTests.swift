import Testing
import BereanBible
import BereanText

@Suite("Search Psalm opening", .enabled(if: dataFile("lxx_brenton") != nil))
struct ScriptureSearchOpeningTests {
    private let bible = BibleService(resolvePath: { dataFile($0 == "lxx" ? "lxx_brenton" : $0) })

    private func hit(_ row: ChapterVerseRow, textId: String = "lxx",
                     indices: [Int] = [], strongs: Set<String> = []) -> ScriptureHit {
        ScriptureHit(textId: textId, bookId: row.bookId, chapter: row.chapter, verseNum: row.verseNum,
                     text: row.text, textTagged: row.textTagged, matchWordIndices: indices, matchedStrongs: strongs)
    }

    @MainActor @Test func titleAndBodyHitsPreserveTheirOwnStrongOffsets() async throws {
        let rows = await bible.queryChapter("PSA", 50, textId: "lxx")
        let title = hit(try #require(rows.first), indices: [4], strongs: ["G5568"])
        let middle = hit(try #require(rows.dropFirst().first))
        let body = hit(try #require(rows.dropFirst(2).first), indices: [1], strongs: ["G1653"])
        let titleMatch = try #require(ScriptureSearchOpening.segments(in: rows, around: title))
        let bodyMatch = try #require(ScriptureSearchOpening.segments(in: rows, around: body))
        #expect(titleMatch.map(\.id) == [1, 2, 3])
        #expect(titleMatch.map(\.isTitle) == [true, true, false])
        #expect(titleMatch.map(\.hit) == [title, middle, hit(rows[2])])
        #expect(bodyMatch.map(\.hit) == [hit(rows[0]), middle, body])

        let cache = ScriptureSearchSnippetCache()
        for enabled in [false, true] {
            for (segments, expected) in [(titleMatch, ["Psalm"]), (bodyMatch, ["mercy"])] {
                let matchedWords = segments.flatMap { segment in
                    let snippet = cache.snippet(for: segment.hit, replacerEnabled: enabled,
                                                rules: WordReplacer.defaultRules, windowed: false)
                    let words = snippet.text.split(separator: " ")
                    return snippet.matchWordIndices.compactMap { words.indices.contains($0) ? String(words[$0]) : nil }
                }
                #expect(matchedWords == expected)
            }
        }
    }

    @Test func psalmThreeTitleAndBodyBothIncludeTheReaderOpening() async throws {
        let rows = await bible.queryChapter("PSA", 3, textId: "lxx")
        let title = hit(try #require(rows.first))
        let body = hit(try #require(rows.dropFirst().first))
        let opening = try #require(ScriptureSearchOpening.segments(in: rows, around: title))
        #expect(opening == ScriptureSearchOpening.segments(in: rows, around: body))
        #expect(opening.map(\.id) == [1, 2])
        #expect(opening.map(\.isTitle) == [true, false])
        #expect(opening.last?.hit.text.hasPrefix("O Lord, why are they") == true)
    }

    @Test func allPartsOfTheTwoRowPsalmFiftyTitleShareTheOpening() async throws {
        let rows = await bible.queryChapter("PSA", 50, textId: "lxx")
        for row in rows.prefix(3) {
            let segments = try #require(ScriptureSearchOpening.segments(in: rows, around: hit(row)))
            #expect(segments.map(\.id) == [1, 2, 3])
            #expect(segments.map(\.isTitle) == [true, true, false])
            #expect(segments.map(\.hit.text) == rows.prefix(3).map(\.text))
        }
        #expect(!ScriptureSearchOpening.requiresChapter(for: hit(rows[3])))
    }

    @Test func incompleteOrMismatchedOpeningsUseTheRawHit() async throws {
        let rows = await bible.queryChapter("PSA", 50, textId: "lxx")
        let title = hit(try #require(rows.first))
        let missingSecondTitle = rows.filter { $0.verseNum != 2 }
        let missingFirstBody = rows.filter { $0.verseNum != 3 }
        var differentText = title
        differentText.text = "Edited search hit"
        var wrongChapter = rows[1]
        wrongChapter.chapter += 1
        #expect(ScriptureSearchOpening.segments(in: missingSecondTitle, around: title) == nil)
        #expect(ScriptureSearchOpening.segments(in: missingFirstBody, around: title) == nil)
        #expect(ScriptureSearchOpening.segments(in: missingSecondTitle + [wrongChapter], around: title) == nil)
        #expect(ScriptureSearchOpening.segments(in: rows, around: differentText) == nil)
    }

    @Test func inlinePrefixAndOtherEditionsDoNotRequestChapter() async throws {
        let rows = await bible.queryChapter("PSA", 10, textId: "lxx")
        let inline = hit(try #require(rows.first))
        #expect(!ScriptureSearchOpening.requiresChapter(for: inline))
        #expect(ScriptureSearchOpening.segments(in: rows, around: inline) == nil)
        let other = hit(rows[0], textId: "kjva")
        #expect(!ScriptureSearchOpening.requiresChapter(for: other))
    }

    @Test func everySeparateTitlePsalmRetainsRawOpeningOrderAndText() async throws {
        var separateOpenings = 0
        for chapter in 1...151 {
            let firstBody = PsalmSuperscription.storedVerseNum(1, bookId: "PSA", chapter: chapter, textId: "lxx")
            guard firstBody > 1 else { continue }
            separateOpenings += 1
            let raw = await bible.queryChapter("PSA", chapter, textId: "lxx")
            let first = try #require(raw.first)
            let opening = try #require(ScriptureSearchOpening.segments(in: raw, around: hit(first)), "Psalm \(chapter)")
            #expect(opening.map(\.id) == Array(1...firstBody))
            #expect(opening.map(\.hit.text) == raw.prefix(firstBody).map(\.text))
            #expect(opening.map(\.isTitle) == Array(repeating: true, count: firstBody - 1) + [false])
        }
        #expect(separateOpenings > 1)
    }
}
