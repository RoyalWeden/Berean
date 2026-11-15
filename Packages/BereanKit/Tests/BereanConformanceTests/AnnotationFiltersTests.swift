import Testing
import BereanText

@Suite("annotation filters") struct AnnotationFiltersTests {
    @Test func lxxSupplyHidden() {
        #expect(AnnotationFilters.strip("For David, [a Psalm] of Jeremias.", textId: "lxx", hidden: ["lxx_supply"]) == "For David, of Jeremias.")
        #expect(AnnotationFilters.strip("For David, [a Psalm] of Jeremias.", textId: "lxx", hidden: []) == "For David, [a Psalm] of Jeremias.")
        #expect(AnnotationFilters.stripTagged("For{} David,{G1138} [a{} Psalm]{G5568} of{} Jeremias.{}", textId: "lxx", hidden: ["lxx_supply"])
                == "For{} David,{G1138} of{} Jeremias.{}")
    }

    @Test func jubileesMarkers() {
        let t = "And in the first week [1 A.M.] he (the Lord) said (b) unto him <again>."
        #expect(AnnotationFilters.strip(t, textId: "jubilees", hidden: ["jubilees_date", "jubilees_supply", "jubilees_stanza", "jubilees_restored"])
                == "And in the first week he said unto him.")
    }

    @Test func otherTextsUntouched() {
        #expect(AnnotationFilters.strip("In the beginning [x]", textId: "kjva", hidden: ["lxx_supply"]) == "In the beginning [x]")
    }
}

@Test func kjvaSuppliedWordsKeepStrongsAndUntaggedText() {
    let tagged = "God{H430} *was{} good.{H2896}"
    let tokens = VerseDisplay.renderTokens("God was good.", tagged: tagged, textId: "kjva",
                                           replacerEnabled: false, rules: [], hideSuppliedWords: true)
    #expect(tokens.map(\.word) == ["God", "good."])
    #expect(tokens.first?.strongs == .one("H430"))
    #expect(VerseDisplay.text("God was good.", tagged: tagged, textId: "kjva",
                              replacerEnabled: false, rules: [], hideSuppliedWords: true) == "God good.")
    #expect(VerseDisplay.text("All wisdom cometh.", tagged: nil, textId: "kjva",
                              replacerEnabled: false, rules: [], hideSuppliedWords: true) == "All wisdom cometh.")
}
