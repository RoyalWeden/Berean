import Testing
import BereanBible

@Suite(.enabled(if: dataFile("kjva") != nil && dataFile("lxx") != nil, "Comparison corpora absent"))
struct ComparisonAvailabilityTests {
    let service = BibleService(resolvePath: { dataFile($0) })

    @Test func excludesUnavailableBooksAndChapters() async {
        #expect(await service.comparisonEditions(forBook: "ROM", chapter: 5, from: "kjva",
                                                 candidates: ["lxx", "kjva", "enoch", "missing"]) == ["kjva"])
        #expect(await service.comparisonEditions(forBook: "PHM", chapter: 1, from: "kjva",
                                                 candidates: ["kjva", "lxx"]) == ["kjva"])
        #expect(await service.comparisonEditions(forBook: "GEN", chapter: 999, from: "kjva",
                                                 candidates: ["kjva", "lxx"]).isEmpty)
        #expect(await service.comparisonEditions(forBook: "GEN", chapter: 0, from: "kjva",
                                                 candidates: ["kjva", "lxx"]).isEmpty)
    }

    @Test func retainsRealMappedEditionsInStableOrder() async {
        #expect(await service.comparisonEditions(forBook: "GEN", chapter: 1, from: "kjva",
                                                 candidates: [" LXX ", "kjva", "lxx", "KJVA"]) == ["lxx", "kjva"])
        #expect(await service.comparisonEditions(forBook: "PSA", chapter: 116, from: "kjva",
                                                 candidates: ["kjva", "lxx"]) == ["kjva", "lxx"])
        #expect(await service.comparisonEditions(forBook: "JON", chapter: 2, from: "lxx",
                                                 candidates: ["lxx", "kjva"]) == ["lxx", "kjva"])
    }
}
