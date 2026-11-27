import Foundation

/// What happens to a note when the user LEAVES it (it is no longer shown in any open tab).
/// Port of the original `finalizeActionFor` (src/lib/notes/finalizeNote.ts):
///   no title + no meaningful body → moved to Trash (a note created and abandoned)
///   no title + body               → named from the creation date ("October 5, 2026")
///   anything else                 → untouched
/// System notes (verse, daily, journal, imports) and idioms are never touched.
public enum NoteFinalize {
    public enum Action: Equatable, Sendable { case none, trash, name(String) }

    public static func isSystemNote(_ note: Note) -> Bool {
        if ["verse", "daily", "journal"].contains(note.type) { return true }
        if note.tags.contains("biblegateway") || note.tags.contains("esword") { return true }
        return note.title.hasPrefix("Daily — ") || note.title.hasPrefix("Journal — ")
    }

    /// Body has real content — not just whitespace, empty Markdown markers or an empty list item.
    public static func hasMeaningfulBody(_ content: String) -> Bool {
        var body = content
        if let fm = body.range(of: #"^---\n[\s\S]*?\n---\s*\n?"#, options: .regularExpression) { body.removeSubrange(fm) }
        body = body.replacingOccurrences(of: #"[\s#>*_`~\-+|\[\]()]"#, with: "", options: .regularExpression)
        body = body.replacingOccurrences(of: #"\d+\."#, with: "", options: .regularExpression)
        return !body.isEmpty
    }

    /// "October 5, 2026" — the original's default ("long") untitled-note name.
    public static func untitledName(_ date: Date, locale: Locale = .current) -> String {
        let f = DateFormatter()
        f.locale = locale
        f.setLocalizedDateFormatFromTemplate("yMMMMd")
        return f.string(from: date)
    }

    public static func action(for note: Note, locale: Locale = .current) -> Action {
        if isSystemNote(note) || note.type == "idiom" { return .none }
        if !note.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return .none }
        if !hasMeaningfulBody(note.content) { return .trash }
        return .name(untitledName(Date(timeIntervalSince1970: Double(note.createdAt) / 1000), locale: locale))
    }
}
