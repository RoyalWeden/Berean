import BereanCore

public struct PreparedSpeech: Equatable, Sendable {
    public let words: [SpokenWord]
    public let spokenText: String
}

/// Original buildSpokenWords pipeline. The slot/index belongs to the reader's
/// token, even if replacement expands it to several words or blanks its text.
public enum SpokenText {
    public static func prepare(_ text: String, tagged: String? = nil,
                               rules: [WordReplacerRule] = []) -> PreparedSpeech {
        if let tagged, !tagged.isEmpty {
            let tokens = TaggedText.parse(tagged).filter { !$0.hasNoPlainText }
            let active = rules.filter { $0.enabled && !($0.strongsNum ?? "").isEmpty }
            var replaced = tokens.map { token in
                SpeechPreparation.prepare(WordReplacer.applyStrongs(WordReplacer.apply(token.word, rules: rules),
                                                                     strongs: token.strongs, rules: rules))
            }
            for (index, token) in tokens.enumerated() where index > 0 {
                let ids = VerseDisplay.nums(token.strongs)
                if active.contains(where: { ids.contains($0.strongsNum!) }),
                   JSText.lower(VerseDisplay.stripTrailingPunct(replaced[index - 1])) == "the" {
                    replaced[index - 1] = ""
                }
            }
            var position = 0
            let words = replaced.enumerated().map { index, word in
                defer { position += word.utf16.count + 1 }
                return SpokenWord(text: word, charStart: position, charLen: word.utf16.count, wordIndex: index)
            }
            return PreparedSpeech(words: words, spokenText: replaced.joined(separator: " "))
        }
        let raw = text.split(separator: " ", omittingEmptySubsequences: false).map(String.init)
        var words: [SpokenWord] = []
        var parts: [String] = []
        var position = 0
        for (index, word) in raw.enumerated() {
            guard !word.isEmpty else { parts.append(""); position += 1; continue }
            let spoken = SpeechPreparation.prepare(WordReplacer.apply(word, rules: rules))
            words.append(SpokenWord(text: spoken, charStart: position, charLen: spoken.utf16.count, wordIndex: index))
            parts.append(spoken)
            position += spoken.utf16.count + 1
        }
        return PreparedSpeech(words: words, spokenText: parts.joined(separator: " "))
    }
}
