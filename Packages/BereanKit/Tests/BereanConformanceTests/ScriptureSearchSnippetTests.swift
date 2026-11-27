@testable import BereanBible
import BereanText
import Testing

@MainActor
struct ScriptureSearchSnippetTests {
    private let psalm = ScriptureHit(
        textId: "kjva", bookId: "PSA", chapter: 23, verseNum: 1,
        text: "The Lord is my shepherd.",
        textTagged: "The{} LORD{H3068} *is{} my{} shepherd.{H7462}"
    )

    @Test func replacementChangesWhenSettingsOrTaggedTextChange() {
        let cache = ScriptureSearchSnippetCache()
        let rules = WordReplacer.defaultRules
        #expect(cache.snippet(for: psalm, replacerEnabled: true, rules: rules).text == "Yehovah is my shepherd.")
        #expect(cache.snippet(for: psalm, replacerEnabled: true, rules: rules).text == "Yehovah is my shepherd.")
        #expect(cache.snippet(for: psalm, replacerEnabled: false, rules: rules).text == "The Lord is my shepherd.")

        let custom = [WordReplacerRule(id: "divine-name", queries: [], replacement: "Jehovah",
                                       wholeWord: true, enabled: true, strongsNum: "H3068")]
        #expect(cache.snippet(for: psalm, replacerEnabled: true, rules: custom).text == "Jehovah is my shepherd.")
        #expect(cache.snippet(for: psalm, replacerEnabled: true, rules: rules).text == "Yehovah is my shepherd.")

        var corrected = psalm
        corrected.textTagged = "The{} Lord{} is{} my{} shepherd.{H7462}"
        #expect(cache.snippet(for: corrected, replacerEnabled: true, rules: custom).text == "The Lord is my shepherd.")
        #expect(cache.snippet(for: psalm, replacerEnabled: true, rules: custom).text == "Jehovah is my shepherd.")
    }

    @Test func sameReferenceCanHaveDifferentTextAndSearchMatches() {
        let cache = ScriptureSearchSnippetCache()
        var hit = psalm
        hit.text = "My shepherd is the Lord."
        #expect(cache.snippet(for: psalm, replacerEnabled: false, rules: []).text == "The Lord is my shepherd.")
        #expect(cache.snippet(for: hit, replacerEnabled: false, rules: []).text == "My shepherd is the Lord.")

        hit = psalm
        hit.matchWordIndices = [1]
        hit.matchedStrongs = ["H3068"]
        let rules = WordReplacer.defaultRules
        #expect(cache.snippet(for: hit, replacerEnabled: true, rules: rules).matchWordIndices == [0])
        hit.matchWordIndices = [4]
        hit.matchedStrongs = ["H7462"]
        #expect(cache.snippet(for: hit, replacerEnabled: true, rules: rules).matchWordIndices == [3])

        hit.matchWordIndices = [0, 2]
        #expect(cache.snippet(for: hit, replacerEnabled: false, rules: rules).matchWordIndices == [0, 2])
        hit.matchWordIndices = [4]
        #expect(cache.snippet(for: hit, replacerEnabled: false, rules: rules).matchWordIndices == [4])
    }

    @Test func longStrongsResultKeepsTheMatchVisibleInTheWindow() {
        let cache = ScriptureSearchSnippetCache()
        let words = (0..<30).map { $0 == 20 ? "mercy" : "unmatched\($0)" }
        let hit = ScriptureHit(textId: "lxx", bookId: "PSA", chapter: 23, verseNum: 1,
                               text: words.joined(separator: " "), textTagged: nil,
                               matchWordIndices: [20], matchedStrongs: ["G1656"])
        let snippet = cache.snippet(for: hit, replacerEnabled: false, rules: [])
        #expect(snippet.text.hasPrefix("… unmatched17"))
        #expect(snippet.matchWordIndices == [4])
        #expect(snippet.text.split(separator: " ")[4] == "mercy")
    }

    @Test func fullVerseRetainsBothEndsAndItsOriginalMatchPositionAcrossModeChanges() {
        let cache = ScriptureSearchSnippetCache()
        let words = (0..<30).map { $0 == 20 ? "mercy" : "unmatched\($0)" }
        let hit = ScriptureHit(textId: "lxx", bookId: "PSA", chapter: 23, verseNum: 1,
                               text: words.joined(separator: " "), textTagged: nil,
                               matchWordIndices: [20], matchedStrongs: ["G1656"])
        let compact = cache.snippet(for: hit, replacerEnabled: false, rules: [])
        let full = cache.snippet(for: hit, replacerEnabled: false, rules: [], windowed: false)
        #expect(full.text == hit.text)
        #expect(full.matchWordIndices == [20])
        #expect(full.text.split(separator: " ")[20] == "mercy")
        #expect(full.text.hasPrefix("unmatched0 "))
        #expect(full.text.hasSuffix(" unmatched29"))
        #expect(cache.snippet(for: hit, replacerEnabled: false, rules: []) == compact)
        #expect(cache.snippet(for: hit, replacerEnabled: false, rules: [], windowed: false) == full)
    }

    @Test func fullVerseKeepsReplacementAdjustedStrongsPositionsWhenSettingsChange() {
        let cache = ScriptureSearchSnippetCache()
        var hit = psalm
        hit.matchWordIndices = [4]
        hit.matchedStrongs = ["H7462"]
        let enabled = cache.snippet(for: hit, replacerEnabled: true, rules: WordReplacer.defaultRules, windowed: false)
        #expect(enabled.text == "Yehovah is my shepherd.")
        #expect(enabled.matchWordIndices == [3])
        let disabled = cache.snippet(for: hit, replacerEnabled: false, rules: WordReplacer.defaultRules, windowed: false)
        #expect(disabled.text == hit.text)
        #expect(disabled.matchWordIndices == [4])
        #expect(cache.snippet(for: hit, replacerEnabled: true, rules: WordReplacer.defaultRules, windowed: false) == enabled)
    }

    @Test func capacitySurvivesRingWrapAndSettingsClearTheCache() {
        let cache = ScriptureSearchSnippetCache()
        let rules = WordReplacer.defaultRules
        func hit(_ index: Int) -> ScriptureHit {
            var verse = psalm
            verse.verseNum = index + 1
            verse.text = "The Lord is my shepherd. \(index)"
            return verse
        }

        for index in 0..<520 {
            let verse = hit(index)
            #expect(cache.snippet(for: verse, replacerEnabled: false, rules: rules).text == verse.text)
            #expect(cache.cachedEntryCount == min(index + 1, 256))
        }

        // Read both retained and evicted verses after the ring has wrapped.
        for index in [519, 264, 0] {
            let verse = hit(index)
            #expect(cache.snippet(for: verse, replacerEnabled: false, rules: rules).text == verse.text)
            #expect(cache.cachedEntryCount == 256)
        }

        #expect(cache.snippet(for: psalm, replacerEnabled: true, rules: rules).text == "Yehovah is my shepherd.")
        #expect(cache.cachedEntryCount == 1)
        _ = cache.snippet(for: hit(1), replacerEnabled: true, rules: rules)
        #expect(cache.cachedEntryCount == 2)
        #expect(cache.snippet(for: psalm, replacerEnabled: true, rules: []).text == psalm.text)
        #expect(cache.cachedEntryCount == 1)
    }
}
