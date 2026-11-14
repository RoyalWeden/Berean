import Foundation

/// Everything the continuous reader needs to draw one verse.
struct ReaderVerse: Equatable {
    struct Word: Equatable { var text: String; var italic: Bool; var red: Bool; var strongs: [String] }
    struct Mark: Equatable { var start: Int; var end: Int; var color: String }   // display offsets into the joined words
    var verse: Int
    var title: String?
    var words: [Word]
    var marks: [Mark] = []
    var tint: String?          // whole-verse highlight colour
    var noteCount = 0
    var tags: [(name: String, color: String?, slot: Int?)] = []
    static func == (a: ReaderVerse, b: ReaderVerse) -> Bool {
        a.verse == b.verse && a.title == b.title && a.words == b.words && a.marks == b.marks && a.tint == b.tint && a.noteCount == b.noteCount
            && a.tags.elementsEqual(b.tags, by: ==)
    }
    /// The verse as displayed (words joined by spaces), the text copy uses.
    var displayText: String { words.map(\.text).joined(separator: " ") }
}

struct ReaderStyle: Equatable {
    var fontSize: Double
    var lineSpacing: CGFloat
    var family: String
    var showStrongs: Bool
    var showVerseNumbers = true
    var redLetters = true
    var width: ScriptureWidth = .normal
}


enum ScriptureWidth: String, CaseIterable {
    case wide, normal, narrow

    var label: String { rawValue.capitalized }

    var macMaximum: CGFloat {
        switch self {
        case .wide: 920
        case .normal: 760
        case .narrow: 600
        }
    }

    var phoneInset: CGFloat {
        switch self {
        case .wide: 12
        case .normal: 20
        case .narrow: 32
        }
    }
}
