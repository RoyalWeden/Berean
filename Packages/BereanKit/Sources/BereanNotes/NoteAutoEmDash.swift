import Foundation

/// Auto em dash (original note editor): convert a second hyphen in prose while preserving Markdown syntax.
/// Setting `berean.notes.autoEmDash` (default on, like the original `autoEmDash`).
public enum NoteAutoEmDash {
    public static var enabled: Bool { UserDefaults.standard.object(forKey: "berean.notes.autoEmDash") as? Bool ?? true }

    /// The range to replace with "—" when `replacement` is typed at `range` in `text`, or nil.
    public static func dashRange(in text: NSString, range: NSRange, replacement: String) -> NSRange? {
        guard enabled, replacement == "-", range.length == 0, range.location > 0, range.location <= text.length,
              text.character(at: range.location - 1) == 0x2D else { return nil }   // previous char is "-"
        // Don’t fire inside inline code (odd number of backticks earlier on the line).
        let line = text.lineRange(for: NSRange(location: range.location - 1, length: 0))
        let before = text.substring(with: NSRange(location: line.location, length: range.location - line.location))
        if before.filter({ $0 == "`" }).count % 2 == 1 { return nil }
        // Preserve partial divider and table separator rows while they are being typed.
        if before.allSatisfy({ $0 == "-" || $0 == "|" || $0 == ":" || $0 == " " || $0 == "\t" }) { return nil }
        return NSRange(location: range.location - 1, length: 1)
    }
}
