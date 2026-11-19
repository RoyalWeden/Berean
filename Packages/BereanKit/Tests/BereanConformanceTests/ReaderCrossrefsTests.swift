import Foundation
import Testing
import BereanSQLite
@testable import BereanBible

@Suite("Reader cross-reference identities") struct ReaderCrossrefsTests {
    @Test func mapsStoredEditionCoordinatesRatherThanPrintedNumbers() {
        for (book, chapter, verse, targetChapter, targetVerse) in [
            ("PSA", 3, 2, 3, 1), ("PSA", 50, 3, 51, 1),
            ("PSA", 9, 22, 10, 1), ("PSA", 113, 9, 115, 1),
            ("PSA", 114, 1, 116, 1), ("PSA", 115, 6, 116, 15),
            ("PSA", 146, 1, 147, 1), ("PSA", 147, 1, 147, 12),
            ("JON", 2, 1, 1, 17), ("JON", 2, 2, 2, 1),
            ("JOL", 3, 1, 2, 28), ("MAL", 3, 19, 4, 1),
            ("MAL", 3, 24, 4, 4), ("JER", 33, 1, 26, 1)
        ] {
            #expect(CrossrefsService.readerSources(book, chapter, verse, textId: "lxx") == [
                ReaderCrossReferenceSource(bookId: book, chapter: targetChapter, verse: targetVerse)
            ])
        }
        #expect(CrossrefsService.readerSources("PSA", 115, 4, textId: "lxx").map(\.verse) == [13, 14])
        #expect(CrossrefsService.readerSources("psa", 50, 1, textId: "LXX") == [
            ReaderCrossReferenceSource(bookId: "PSA", chapter: 51, verse: 1)
        ], "An old title-row link belongs to the opening body verse")
        #expect(CrossrefsService.readerSources("PSA", 151, 1, textId: "lxx").isEmpty)
        #expect(CrossrefsService.readerSources("PSA", 50, 3, textId: "kjva") == [
            ReaderCrossReferenceSource(bookId: "PSA", chapter: 50, verse: 3)
        ])
    }

    private func fixture() throws -> String {
        let path = FileManager.default.temporaryDirectory.appendingPathComponent("berean-reader-refs-\(UUID()).db").path
        let db = try SQLiteConnection(readWritePath: path, create: true)
        try db.exec("""
            CREATE TABLE refs (from_book TEXT, from_ch INTEGER, from_vs INTEGER,
                to_book TEXT, to_ch INTEGER, to_vs INTEGER, to_vs_end INTEGER, votes INTEGER);
            INSERT INTO refs VALUES ('PSA',116,13,'JHN',3,16,NULL,4);
            INSERT INTO refs VALUES ('PSA',116,13,'ROM',8,1,NULL,10);
            INSERT INTO refs VALUES ('PSA',116,14,'JHN',3,16,NULL,8);
            INSERT INTO refs VALUES ('PSA',116,14,'GEN',1,1,NULL,10);
            CREATE TABLE tske_refs (from_book TEXT, from_ch INTEGER, from_vs INTEGER,
                heading TEXT, is_reciprocal INTEGER, to_book TEXT, to_ch INTEGER,
                to_vs INTEGER, to_vs_end INTEGER, sort_order INTEGER, context TEXT);
            INSERT INTO tske_refs VALUES ('PSA',116,13,'cup',0,'JHN',3,16,NULL,0,'shared');
            INSERT INTO tske_refs VALUES ('PSA',116,14,'cup',0,'JHN',3,16,NULL,0,'shared');
            INSERT INTO tske_refs VALUES ('PSA',116,14,'cup',0,'JHN',3,16,NULL,1,'vows');
            INSERT INTO tske_refs VALUES ('PSA',116,14,'cup',1,'ROM',8,1,NULL,2,'reciprocal');
            """)
        return path
    }

    @Test func combinedRecordMergesBothSourcesWithoutLosingContextsOrVoteOrder() async throws {
        let path = try fixture()
        defer { try? FileManager.default.removeItem(atPath: path) }
        let service = CrossrefsService(dataPath: { [path] id in ["cross_references", "tske_refs"].contains(id) ? path : nil })
        let classic = await service.forReaderVerse("PSA", 115, 4, textId: "lxx")
        #expect(!classic.error)
        #expect(classic.refs.map(\.bookId) == ["ROM", "GEN", "JHN"])
        #expect(classic.refs.map(\.votes) == [10, 10, 8], "Duplicate target keeps its highest vote; source order breaks ties")
        let tske = await service.tskeForReaderVerse("PSA", 115, 4, textId: "lxx")
        #expect(!tske.error && tske.groups.count == 2)
        #expect(tske.groups.first?.heading == "cup")
        #expect(tske.groups.first?.refs.map(\.context) == ["shared", "vows"], "Different source contexts remain available")
        #expect(tske.groups.last?.isReciprocal == true)
        let chapter = await service.forReaderChapter("PSA", 115, verseNumbers: [4, 4, 6], textId: "lxx")
        #expect(!chapter.error && chapter.verseRefs.map(\.verseNum) == [4])
        #expect(chapter.verseRefs.first?.refs == classic.refs)
        let chapterTSKe = await service.tskeForReaderChapter("PSA", 115, verseNumbers: [4, 6], textId: "lxx")
        #expect(!chapterTSKe.error && chapterTSKe.verseRefs.map(\.verseNum) == [4])
        #expect(chapterTSKe.verseRefs.first?.groups == tske.groups)
        let legacy = await service.forVerse("PSA", 116, 13)
        #expect(legacy.refs.map(\.votes) == [10, 4], "The legacy oracle must not acquire reader merge behavior")
    }

    @Test func unavailableSourceAndUnmatchedPsalmAreDifferentOutcomes() async {
        let service = CrossrefsService(dataPath: { _ in nil })
        #expect(await service.forReaderVerse("PSA", 3, 2, textId: "lxx").error)
        #expect(await service.tskeForReaderVerse("PSA", 3, 2, textId: "lxx").error)
        #expect(await service.forReaderChapter("PSA", 3, verseNumbers: [2, 3], textId: "lxx").error)
        #expect(await service.tskeForReaderChapter("PSA", 3, verseNumbers: [2, 3], textId: "lxx").error)
        #expect(await service.forReaderVerse("PSA", 151, 1, textId: "lxx").error == false)
    }
}

@Suite("Reader cross-references with bundled corpora", .enabled(if: dataFile("lxx_brenton") != nil && dataFile("cross_references") != nil && dataFile("tske_refs") != nil))
struct ReaderCrossrefsCorpusTests {
    @Test func everyPsalterSourceResolvesToAnExistingCanonicalVerse() async {
        let bible = BibleService(resolvePath: { dataFile($0 == "lxx" ? "lxx_brenton" : $0) })
        var canonical: [String: Set<Int>] = [:]
        var missing: [String] = []
        for chapter in 1...151 {
            let raw = await bible.queryChapter("PSA", chapter, textId: "lxx")
            for row in PsalmSuperscription.apply(raw, textId: "lxx", bookId: "PSA", chapter: chapter) {
                for source in CrossrefsService.readerSources("PSA", chapter, row.verseNum, textId: "lxx") {
                    let key = "\(source.bookId)|\(source.chapter)"
                    if canonical[key] == nil {
                        let rows = await bible.queryChapter(source.bookId, source.chapter, textId: "kjva")
                        canonical[key] = Set(rows.map(\.verseNum))
                    }
                    if canonical[key]?.contains(source.verse) != true {
                        missing.append("LXX\(chapter):\(row.verseNum) → KJV\(source.chapter):\(source.verse)")
                    }
                }
            }
        }
        #expect(missing.isEmpty, "No canonical source may refer to a nonexistent verse: \(missing)")
    }

    @Test func chapterAndSelectionScopesUseTheSameVisibleSourceRows() async {
        let bible = BibleService(resolvePath: { dataFile($0 == "lxx" ? "lxx_brenton" : $0) })
        let service = CrossrefsService(dataPath: { dataFile($0) })
        for chapter in [3, 9, 50, 113, 114, 115, 146, 147] {
            let raw = await bible.queryChapter("PSA", chapter, textId: "lxx")
            let rows = PsalmSuperscription.apply(raw, textId: "lxx", bookId: "PSA", chapter: chapter)
            let visible = rows.map(\.verseNum)
            let classic = await service.forReaderChapter("PSA", chapter, verseNumbers: visible, textId: "lxx")
            let tske = await service.tskeForReaderChapter("PSA", chapter, verseNumbers: visible, textId: "lxx")
            #expect(!classic.error && !tske.error)
            #expect(Set(classic.verseRefs.map(\.verseNum)).isSubset(of: Set(visible)))
            #expect(Set(tske.verseRefs.map(\.verseNum)).isSubset(of: Set(visible)))
            for row in rows {
                let single = await service.forReaderVerse("PSA", chapter, row.verseNum, textId: "lxx")
                let singleTSKe = await service.tskeForReaderVerse("PSA", chapter, row.verseNum, textId: "lxx")
                let allRefs = classic.verseRefs.first { $0.verseNum == row.verseNum }?.refs ?? []
                // Legacy individual Classic lookups cap each source at150;
                // whole-chapter lookups intentionally retain all references.
                if CrossrefsService.readerSources("PSA", chapter, row.verseNum, textId: "lxx").count == 1 {
                    #expect(Array(allRefs.prefix(150)) == single.refs)
                } else { #expect(allRefs == single.refs) }
                #expect((tske.verseRefs.first { $0.verseNum == row.verseNum }?.groups ?? []) == singleTSKe.groups)
            }
        }
    }

    @Test func psalmFiftyVerseOneUsesKJVFiftyOneVerseOneExactly() async {
        let service = CrossrefsService(dataPath: { dataFile($0) })
        let actual = await service.forReaderVerse("PSA", 50, 3, textId: "lxx")
        let expected = await service.forVerse("PSA", 51, 1)
        #expect(!actual.error && actual.refs == expected.refs)
        let actualTSKe = await service.tskeForReaderVerse("PSA", 50, 3, textId: "lxx")
        let expectedTSKe = await service.tskeForVerse("PSA", 51, 1)
        #expect(!actualTSKe.error && actualTSKe.groups == expectedTSKe.groups)
    }
}
