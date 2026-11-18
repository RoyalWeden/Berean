import Foundation

/// Engine-ready words after the display/Strong's replacement and speech-prep pipeline.
/// Offsets are UTF-16, matching the legacy reader and native TextKit coordinates.
public struct SpokenWord: Equatable, Sendable {
    public var text: String
    public var charStart: Int
    public var charLen: Int
    public var wordIndex: Int

    public init(text: String, charStart: Int, charLen: Int, wordIndex: Int) {
        self.text = text; self.charStart = charStart; self.charLen = charLen; self.wordIndex = wordIndex
    }
}

public struct KokoroChunk: Equatable, Sendable {
    public let text: String
    /// Subtract from a chunk character index to recover verse-local coordinates.
    /// Values can be negative when a chunk begins in the middle of a verse.
    public let verseCharOffsets: [Int: Int]
    public let startVerseIndex: Int
    public let endVerseIndex: Int
}

/// The original neural-backend latency policy, independent of platform voices.
/// Do not substitute Web Speech caps: Kokoro's first chunk is short for startup,
/// subsequent chunks allow longer clauses while audio streams ahead.
public enum KokoroChunks {
    public static func build(_ queue: [[SpokenWord]], startIndex: Int = 0) -> [KokoroChunk] {
        guard queue.indices.contains(startIndex) else { return [] }
        let items = (startIndex..<queue.count).flatMap { index in queue[index].map { (verse: index, word: $0) } }
        var chunks: [KokoroChunk] = []
        var index = 0
        while index < items.count {
            let start = index
            var end = start
            let maxWords = chunks.isEmpty ? 12 : 40
            while end < items.count {
                if ends(items[end].word.text, punctuation: ".!?") { end += 1; break }
                if end - start + 1 >= maxWords {
                    var cut = end
                    if end > start {
                        for candidate in stride(from: end, through: start + 1, by: -1) {
                            if ends(items[candidate].word.text, punctuation: ",;:") { cut = candidate; break }
                        }
                    }
                    end = cut + 1
                    break
                }
                end += 1
            }
            end = max(end, start + 1)
            var parts: [String] = []
            var offsets: [Int: Int] = [:]
            var position = 0
            for item in items[start..<end] {
                if !parts.isEmpty { position += 1 }
                if offsets[item.verse] == nil { offsets[item.verse] = position - item.word.charStart }
                parts.append(item.word.text)
                position += item.word.text.utf16.count
            }
            chunks.append(KokoroChunk(text: parts.joined(separator: " "), verseCharOffsets: offsets,
                                      startVerseIndex: items[start].verse, endVerseIndex: items[end - 1].verse))
            index = end
        }
        return chunks
    }

    private static func ends(_ word: String, punctuation: String) -> Bool {
        var units = Array(word.utf16)
        let closers = Set("'\")]".utf16)
        while let last = units.last, closers.contains(last) { units.removeLast() }
        guard let last = units.last else { return false }
        return punctuation.utf16.contains(last)
    }
}
