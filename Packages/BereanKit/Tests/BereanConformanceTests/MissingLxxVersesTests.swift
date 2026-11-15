import Testing
import BereanBible

@Suite("missing LXX verse markers") struct MissingLxxVersesTests {
    @Test func gapsBecomeMarkers() {
        #expect(MissingLxxVerses.markers(lxxVerses: [1, 2, 5, 6, 9], kjvVerses: Array(1...10))
                == [5: "— vv.3-4 not in LXX —", 9: "— vv.7-8 not in LXX —"])
        #expect(MissingLxxVerses.markers(lxxVerses: [1, 3], kjvVerses: [1, 2, 3, 4]) == [3: "— v.2 not in LXX —"])
        #expect(MissingLxxVerses.markers(lxxVerses: [1, 2, 3], kjvVerses: [1, 2, 3]) == [:])
        #expect(!MissingLxxVerses.eligible(bookId: "PSA", chapter: 3))
        #expect(!MissingLxxVerses.eligible(bookId: "JER", chapter: 30))
    }
}
