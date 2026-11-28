import Testing
import BereanText

struct KokoroChunkTests {
    @Test func matchesOriginalLatencyAndUTF16Alignment() throws {
        let golden = try Golden.load("speech-chunks")
        for fixture in golden.arr("cases") {
            let input = fixture.object
            let queue = input.arr("queue").map { verse in
                verse.array.map { value in
                    let word = value.object
                    return SpokenWord(text: word["text"]!.str, charStart: word["charStart"]!.int,
                                      charLen: word["charLen"]!.int, wordIndex: word["wordIndex"]!.int)
                }
            }
            let chunks = KokoroChunks.build(queue, startIndex: input["startIndex"]!.int)
            let expected = input.arr("output")
            #expect(chunks.count == expected.count)
            for (chunk, value) in zip(chunks, expected) {
                let want = value.object
                #expect(chunk.text == want["text"]!.str)
                #expect(chunk.startVerseIndex == want["startVerseIndex"]!.int)
                #expect(chunk.endVerseIndex == want["endVerseIndex"]!.int)
                let offsets = Dictionary(uniqueKeysWithValues: want.arr("verseCharOffsets").map { ($0.array[0].int, $0.array[1].int) })
                #expect(chunk.verseCharOffsets == offsets)
            }
        }
    }

    @Test func rejectsInvalidStartingIndices() {
        let word = SpokenWord(text: "Hello.", charStart: 0, charLen: 6, wordIndex: 0)
        #expect(KokoroChunks.build([[word]], startIndex: -1).isEmpty)
        #expect(KokoroChunks.build([[word]], startIndex: Int.max).isEmpty)
    }
}
