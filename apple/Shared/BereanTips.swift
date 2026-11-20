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
