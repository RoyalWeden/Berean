import Testing
import Foundation
import BereanText

struct SpeechPreparationTests {
    @Test func matchesOriginalSpokenTokenPreparation() throws {
        let golden = try Golden.load("speech-preparation")
        for fixture in golden.arr("numbers") {
            let item = fixture.object
            #expect(SpeechPreparation.numberToWords(Int64(item["input"]!.int), ordinal: item["ordinal"]?.boolValue == true) == item["output"]!.str)
        }
        for fixture in golden.arr("tokens") {
            let item = fixture.object
            let token = item["input"]!.str
            #expect(SpeechPreparation.applyPronunciation(token) == item["pronunciation"]!.str, "Pronunciation: \(token)")
            #expect(SpeechPreparation.expandAbbreviation(token) == item["abbreviation"]!.str, "Abbreviation: \(token)")
            #expect(SpeechPreparation.expandNumbers(token) == item["number"]!.str, "Number: \(token)")
            #expect(SpeechPreparation.normalizePunctuation(token) == item["punctuation"]!.str, "Punctuation: \(token)")
            #expect(SpeechPreparation.prepare(token) == item["prepared"]!.str, "Preparation: \(token)")
        }
    }

    @Test func matchesOriginalVerseWordsAndOffsets() throws {
        let golden = try Golden.load("speech-preparation")
        for fixture in golden.arr("verses") {
            let item = fixture.object
            let rules = item.arr("rules").map { WordReplacerRule(json: $0.object) }
            let actual = SpokenText.prepare(item["text"]!.str, tagged: item["tagged"]?.optionalString, rules: rules)
            let expected = item["output"]!.object
            #expect(actual.spokenText == expected["spokenText"]!.str)
            let words = expected.arr("words")
            #expect(actual.words.count == words.count)
            for (word, value) in zip(actual.words, words) {
                let want = value.object
                #expect(word.text == want["text"]!.str)
                #expect(word.wordIndex == want["wordIndex"]!.int)
                #expect(word.charStart == want["charStart"]!.int)
                #expect(word.charLen == want["charLen"]!.int)
                let source = actual.spokenText as NSString
                let range = NSRange(location: word.charStart, length: word.charLen)
                #expect(NSMaxRange(range) <= source.length)
                if NSMaxRange(range) <= source.length {
                    #expect(source.substring(with: range).utf16.elementsEqual(word.text.utf16))
                }
            }
        }
    }
}
