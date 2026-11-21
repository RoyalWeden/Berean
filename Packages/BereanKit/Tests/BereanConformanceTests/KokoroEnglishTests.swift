import Testing
import BereanText

struct KokoroEnglishTests {
    @Test func matchesOriginalEnglishNormalizationAndPunctuationSegments() throws {
        let golden = try Golden.load("kokoro-english")
        for value in golden.arr("cases") {
            let fixture = value.object
            let input = fixture["input"]!.str
            let normalize = fixture["normalize"]?.boolValue == true
            if normalize { #expect(KokoroEnglish.normalize(input) == fixture["normalized"]!.str, "Normalize: \(input)") }
            let parts = KokoroEnglish.parts(input, normalize: normalize)
            let expected = fixture.arr("parts")
            #expect(parts.count == expected.count, "Segments: \(input)")
            for (part, want) in zip(parts, expected) {
                #expect(part.text == want.object["text"]!.str, "Segment: \(input)")
                #expect(part.isPunctuation == (want.object["match"]?.boolValue == true))
            }
            #expect(parts.map(\.text).joined() == fixture["normalized"]!.str)
        }
    }

    @Test func matchesOriginalIPAPostprocessing() throws {
        let golden = try Golden.load("kokoro-english")
        for value in golden.arr("ipa") {
            let fixture = value.object
            #expect(KokoroEnglish.postprocess(fixture["input"]!.str, american: fixture["american"]?.boolValue == true)
                    == fixture["output"]!.str)
        }
    }
}
