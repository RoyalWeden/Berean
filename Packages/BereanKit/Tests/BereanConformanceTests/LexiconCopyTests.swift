import Testing
@testable import BereanBible

@Test func lexiconCopyMatchesLegacyDictionaryBlock() {
    let entry = LexiconEntry(strongsNum: "G5485", lemma: "χάρις", transliteration: "cháris", pronunciation: "khar'-ece",
                             gloss: "favour, grace", definition: "graciousness (Deuteronomy 32:38)", derivation: "from 05463",
                             extendedDef: "unused", occurrences: 0)
    #expect(entry.dictionaryCopyText == "G5485 χάρις cháris, khar'-ece;\nfrom G5463; graciousness (Deuteronomy 32:38):—favour, grace")
}

@Test func lexiconCopyCleansExtendedFallbackAndEmptyEntries() {
    var entry = LexiconEntry(strongsNum: "H1319", lemma: "", transliteration: "", pronunciation: "",
                             gloss: "", definition: " ", derivation: "", extendedDef: " [ בָּשַׂר ]  see H01320. ", occurrences: 0)
    #expect(entry.dictionaryCopyText == "H1319;\nsee H1320.")
    entry.extendedDef = ""
    #expect(entry.dictionaryCopyText == "H1319;")
}
