import Foundation

/// Keeps the native selection endpoints on readable text while preserving a continuous drag across verses.
func readerTextSelection(_ range: NSRange, in storage: NSAttributedString, excluding marker: NSAttributedString.Key) -> NSRange {
    guard range.location != NSNotFound, range.length > 0, NSMaxRange(range) <= storage.length else { return range }
    let text = storage.string as NSString
    let ink = CharacterSet.whitespacesAndNewlines.inverted
    var start: Int?
    var end = range.location
    storage.enumerateAttribute(marker, in: range) { skipped, run, _ in
        guard skipped == nil else { return }
        let first = text.rangeOfCharacter(from: ink, range: run)
        guard first.location != NSNotFound else { return }
        let last = text.rangeOfCharacter(from: ink, options: .backwards, range: run)
        if start == nil { start = first.location }
        end = NSMaxRange(last)
    }
    guard let start else { return NSRange(location: range.location, length: 0) }
    return NSRange(location: start, length: end - start)
}

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
    var citationCount = 0
    var citationPreview: String?
    var tags: [(name: String, color: String?, slot: Int?)] = []
    static func == (a: ReaderVerse, b: ReaderVerse) -> Bool {
        a.verse == b.verse && a.title == b.title && a.words == b.words && a.marks == b.marks && a.tint == b.tint && a.noteCount == b.noteCount
            && a.citationCount == b.citationCount && a.citationPreview == b.citationPreview
            && a.tags.elementsEqual(b.tags, by: ==)
    }
    /// The verse as displayed (words joined by spaces), the text copy uses.
    var displayText: String { words.map(\.text).joined(separator: " ") }
}

enum ScriptureTextSize {
    static let standard: Double = 16
    static let range: ClosedRange<Double> = 12...30

    static func clamped(_ size: Double) -> Double {
        min(range.upperBound, max(range.lowerBound, size))
    }
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
