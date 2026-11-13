import SwiftUI
import BereanWorkspace

/// Display names, symbols and colours for Spaces and tab types (shared by the Mac and iPhone shells).
extension SpaceId {
    var title: String { ["scripture": "Scripture", "notes": "Notes", "lexicon": "Lexicon", "youtube": "YouTube", "search": "Search"][rawValue]! }
    var symbol: String { ["scripture": "book", "notes": "note.text", "lexicon": "character.book.closed", "youtube": "play.rectangle", "search": "magnifyingglass"][rawValue]! }
}

extension BereanWorkspace.Tab {
    var symbol: String {
        switch tabType {
        case .bible: return "book"
        case .note: return "note.text"
        case .lexicon: return "character.book.closed"
        case .youtube: return "play.rectangle"
        case .search: return "magnifyingglass"
        case .pdf: return "doc.richtext"
        case .tags: return "tag"
        case .history: return "clock"
        case .settings: return "gearshape"
        case .calendar: return "calendar"
        case .none: return "questionmark.square"
        }
    }
}

extension BereanWorkspace.Tab {
    /// Type colours from the existing sidebar (Scripture blue, notes orange, lexicon green, YouTube red).
    var tint: Color {
        switch tabType {
        case .bible: return .blue
        case .note: return .orange
        case .lexicon: return .green
        case .youtube: return .red
        case .search: return .indigo
        default: return .secondary
        }
    }
}
