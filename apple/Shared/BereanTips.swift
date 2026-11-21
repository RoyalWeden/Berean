import SwiftUI
import TipKit

/// First-use hints (original §16 "Hints system" — tooltip on first use, Dismiss / don't show
/// again, reset in About), with TipKit: shown once, dismissible, state kept by the system.
struct GoTip: Tip {
    var title: Text { Text("Search Berean") }
    var message: Text? { Text("Type a passage (John 3:16), a Strong's number (H7225), a note, or a command.") }
    var image: Image? { Image(systemName: "magnifyingglass") }
}

struct PiPTip: Tip {
    var title: Text { Text("Picture in Picture") }
    var message: Text? { Text("Keep the video playing in a small window while you read or take notes.") }
    var image: Image? { Image(systemName: "pip.enter") }
}

struct AskFollowUpTip: Tip {
    var title: Text { Text("Ask a follow-up") }
    var message: Text? { Text("Try “now only Greek”, “five more”, “compare the first two” or “any in Proverbs?”.") }
    var image: Image? { Image(systemName: "arrow.turn.down.right") }
}

struct StrongsTip: Tip {
    var title: Text { Text("Strong's numbers") }
    var message: Text? { Text("Show the Hebrew and Greek word numbers. Click one to open its lexicon entry.") }
    var image: Image? { Image(systemName: "number") }
}

struct NoteFormatTip: Tip {
    var title: Text { Text("Format your note") }
    var message: Text? { Text("Headings, highlights, callouts and lists. Notes stay plain Markdown, so they open anywhere.") }
    var image: Image? { Image(systemName: "textformat") }
}

/// Original hint "first verse number click" → natively, the floating verse action bar.
struct VerseActionsTip: Tip {
    var title: Text { Text("Verse actions") }
    var message: Text? { Text("Copy with the reference, highlight, tag, add a note or compare. Select more verses to act on them together.") }
    var image: Image? { Image(systemName: "text.badge.checkmark") }
}

/// Original hint "first highlight selection". Waits for a second selection so it never
/// competes with VerseActionsTip.
struct HighlightTip: Tip {
    static let verseSelected = Tips.Event(id: "verseSelected")
    var title: Text { Text("Highlight") }
    #if os(macOS)
    var message: Text? { Text("Five colours for whole verses. To mark just a few words, select them and Control-click → Highlight Selection.") }
    #else
    var message: Text? { Text("Five colours for whole verses. To mark just a few words, touch and hold them, then choose Highlight Selection.") }
    #endif
    var image: Image? { Image(systemName: "highlighter") }
    var rules: [Rule] { #Rule(Self.verseSelected) { $0.donations.count >= 2 } }
}

/// Original hint "first compare view open".
struct CompareTip: Tip {
    var title: Text { Text("Compare texts") }
    var message: Text? { Text("Columns stay together while they show the same chapter. Use Add Another Passage… or a column's Choose Passage to compare different places.") }
    var image: Image? { Image(systemName: "rectangle.split.2x1") }
}

@MainActor enum BereanTips {
    static let resetKey = "resetHintsOnLaunch"
    static func configure() {
        // TipKit can only reset before it is configured, so Reset Hints takes effect at launch.
        if UserLibrary.defaults.bool(forKey: resetKey) {
            try? Tips.resetDatastore()
            UserLibrary.defaults.removeObject(forKey: resetKey)
        }
        try? Tips.configure([.displayFrequency(.immediate)])
    }
    /// Settings → About → Reset Hints.
    static func reset() {
        UserLibrary.defaults.set(true, forKey: resetKey)
    }
}
