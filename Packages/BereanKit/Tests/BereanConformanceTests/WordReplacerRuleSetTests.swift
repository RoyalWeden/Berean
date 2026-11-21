import Testing
import BereanCore
import BereanText

@Suite("word replacer persisted rules") struct WordReplacerRuleSetTests {
    let defaults = [
        WordReplacerRule(id: "s", queries: [], replacement: "Yehovah", wholeWord: false, enabled: true, strongsNum: "H3068"),
        WordReplacerRule(id: "multi", queries: ["jesus christ"], replacement: "Yeshua Messiah", wholeWord: false, enabled: true),
        WordReplacerRule(id: "single", queries: ["jesus"], replacement: "Yeshua", wholeWord: false, enabled: true),
    ]

    @Test func absentUsesDefaults() {
        let set = WordReplacerRuleSet(stored: nil, defaults: defaults)
        #expect(set.rules == defaults)
        #expect(set.raw.count == 3)
    }

    @Test func mergeOrderMatchesOriginalHydration() {
        let stored: JSValue = [["id": "s", "queries": [], "strongsNum": "H3068", "replacement": "Yehovah", "wholeWord": false, "enabled": false]]
        let set = WordReplacerRuleSet(stored: stored, defaults: defaults)
        #expect(set.rules.map(\.id) == ["multi", "s", "single"])
        #expect(set.rules[1].enabled == false)
    }

    @Test func toggleKeepsUnknownFieldsAndMalformedEntries() {
        let stored: JSValue = [
            ["id": "custom", "queries": ["foo"], "replacement": "bar", "wholeWord": true, "enabled": true, "label": "mine"],
            ["junk": 1],
        ]
        var set = WordReplacerRuleSet(stored: stored, defaults: [])
        #expect(set.rules.map(\.id) == ["custom"])
        set.setEnabled("custom", false)
        #expect(set.rules[0].enabled == false)
        #expect(set.raw[0]["label"] == "mine")
        #expect(set.raw[1] == ["junk": 1])
        #expect(set.revisionKey == "")
        set.enableAll(defaults: [])
        #expect(set.revisionKey == "custom")
    }

    @Test func disabledRuleStopsApplying() {
        var set = WordReplacerRuleSet(stored: nil, defaults: defaults)
        #expect(WordReplacer.apply("Jesus wept", rules: set.rules) == "Yeshua wept")
        set.setEnabled("single", false)
        #expect(WordReplacer.apply("Jesus wept", rules: set.rules) == "Jesus wept")
    }

    @Test func encodeRoundTrips() {
        for rule in WordReplacer.defaultRules { #expect(WordReplacerRuleSet.decode(WordReplacerRuleSet.encode(rule)) == rule) }
    }
}
