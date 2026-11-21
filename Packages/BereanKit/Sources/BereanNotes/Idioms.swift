import Foundation
import BereanCore
import BereanSQLite

/// Idioms — notes of type `idiom` with a term, meaning, aliases and optional automatic
/// variants. Port of notesService.listIdioms and VerseRow.tsx's variant/matching rules.
public struct Idiom: Equatable, Sendable, Identifiable {
    public var id: String
    public var term: String
    public var meaning: String
    public var aliases: [String]
    public var autoVariants: Bool
    public init(id: String, term: String, meaning: String, aliases: [String], autoVariants: Bool) {
        self.id = id; self.term = term; self.meaning = meaning; self.aliases = aliases; self.autoVariants = autoVariants
    }
}

public enum Idioms {
    public static func list(db: SQLiteConnection) throws -> [Idiom] {
        try db.query("""
            SELECT id, title, idiom_term, idiom_meaning, idiom_aliases, idiom_auto_variants FROM notes
            WHERE type = 'idiom' AND idiom_term IS NOT NULL AND deleted_at IS NULL ORDER BY idiom_term COLLATE NOCASE ASC
            """).map { r in
            let aliases = (r["idiom_aliases"]?.string).flatMap { try? JSON.parse($0) }?.arrayValue?.compactMap { $0.stringValue?.string } ?? []
            let auto: Bool = { if case .integer(1)? = r["idiom_auto_variants"] { return true }; return false }()
            return Idiom(id: r["id"]?.string ?? "", term: r["idiom_term"]?.string ?? "", meaning: r["idiom_meaning"]?.string ?? "",
                         aliases: aliases, autoVariants: auto)
        }
    }

    /// VerseRow.tsx `variantsFor`: the term, its possessive, and one plural form.
    public static func variants(_ term: String) -> [String] {
        let t = term.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return [] }
        var out = [t, "\(t)'s"]
        let lower = t.lowercased()
        if lower.range(of: "[^aeiou]y$", options: .regularExpression) != nil { out.append(String(t.dropLast()) + "ies") }
        else if lower.range(of: "([sxz]|[cs]h)$", options: .regularExpression) != nil { out.append(t + "es") }
        else { out.append(t + "s") }
        return out
    }

    public struct Match: Equatable, Sendable { public var range: NSRange; public var idiomId: String; public var meaning: String }

    /// A compiled matcher: longest patterns first, case-insensitive, ASCII word boundaries (JS `\b`).
    public struct Matcher: Sendable {
        let regex: NSRegularExpression?
        let byPattern: [String: (id: String, meaning: String)]

        public init(_ idioms: [Idiom]) {
            var entries: [(String, String, String)] = []
            for e in idioms {
                for t in [e.term] + e.aliases where !t.trimmingCharacters(in: .whitespaces).isEmpty {
                    for p in e.autoVariants ? Idioms.variants(t) : [t.trimmingCharacters(in: .whitespacesAndNewlines)] where !p.isEmpty {
                        entries.append((p, e.id, e.meaning))
                    }
                }
            }
            entries.sort { $0.0.utf16.count > $1.0.utf16.count }
            var map: [String: (String, String)] = [:]
            for (p, id, m) in entries where map[p.lowercased()] == nil { map[p.lowercased()] = (id, m) }
            byPattern = map
            regex = entries.isEmpty ? nil : try? NSRegularExpression(
                pattern: "(?<![A-Za-z0-9_])(" + entries.map { NSRegularExpression.escapedPattern(for: $0.0) }.joined(separator: "|") + ")(?![A-Za-z0-9_])",
                options: [.caseInsensitive])
        }

        public var isEmpty: Bool { regex == nil }

        public func matches(in text: String) -> [Match] {
            guard let regex else { return [] }
            let ns = text as NSString
            return regex.matches(in: text, range: NSRange(location: 0, length: ns.length)).compactMap { m in
                byPattern[ns.substring(with: m.range).lowercased()].map { Match(range: m.range, idiomId: $0.id, meaning: $0.meaning) }
            }
        }
    }
}
