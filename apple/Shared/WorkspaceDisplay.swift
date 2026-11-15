import SwiftUI
import BereanWorkspace
import BereanNotes

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


extension BereanWorkspace.Tab {
    var navigationLabel: String {
        let fallback = title.isEmpty ? "Untitled" : title
        // Daily note tabs read as their long date; the stored tab title ("Daily — YYYY-MM-DD") is unchanged.
        if tabType == .note, title.hasPrefix("Daily — ") || title.hasPrefix("Journal — "),
           let key = NotesService.dailyDateKey(title), let long = NotesService.dailyDisplayTitle(key) {
            // Compact for tab rows: "Sabbath, Nov 14, 2026".
            let parts = long.split(separator: " ")   // ["Sabbath,", "November", "14,", "2026"]
            guard parts.count == 4 else { return long }
            return "\(parts[0]) \(parts[1].prefix(3)) \(parts[2]) \(parts[3])"
        }
        guard tabType == .bible else { return fallback }
        let reader = BibleState(state)
        guard let verse = reader.verse else { return fallback }
        let groups = reader.compareMode ? [] : consecutiveVerseRuns(ResolvedPassage.savedVerses(in: self, reader: reader))
        return ResolvedPassage(textId: reader.translation, bookId: reader.bookId,
                               chapter: reader.chapter, verse: verse, endVerse: reader.endVerse, verseGroups: groups).label
    }

    var scriptureEditionLabel: String? {
        guard tabType == .bible else { return nil }
        let reader = BibleState(state)
        return textInfo(reader.translation).short
    }

    var navigationDetail: String {
        guard let edition = scriptureEditionLabel else { return spaceId.title }
        let detail = "\(spaceId.title) · \(edition)"
        return BibleState(state).compareMode ? detail + " · Compare" : detail
    }

    var navigationSearchText: String {
        let edition = tabType == .bible ? textInfo(BibleState(state).translation).name : ""
        return "\(title) \(navigationLabel) \(navigationDetail) \(edition)"
            .replacingOccurrences(of: "–", with: "-")
    }
}
