import Foundation

/// References cited in a note, using the same extraction grammar as the legacy cross-reference inspector.
public struct NoteVerseRef: Equatable, Sendable {
    public let bookId: String
    public let chapter: Int
    public let verse: Int
    public let endVerse: Int?
    public let isChapter: Bool
    public let lxx: Bool
    public let sourceNoteTitle: String
    public let context: String
}

public enum NoteVerseRefs {
    private static let candidates = try! NSRegularExpression(pattern: #"\b((?:[1-3]\s+)?[A-Za-z][a-z]*\d*(?:\s+(?!Book\s+\d)[A-Za-z][a-z]*\d*){0,8}(?:,?\s*Book\s+\d{1,3})?,?\s+(?:Chapter\s+)?\d{1,3}(?::\d{1,3}(?:\s*[-–]\s*\d{1,3}(?:\s*[:.]\s*\d{1,3})?)?(?:\s*,\s*\d{1,3}(?:\s*[-–]\s*\d{1,3})?)*)?(?:[ \t]+LXX\b)?)\b|\[\[([^\]]*\d+[:/][^\]]*)\]\]"#, options: .caseInsensitive)
    private static let ambiguous = Set("is am re her da ho la ro le na ec ne nu mi ac ga rm ru ex pr ep ps hg ml ti nm nb ss mk mt lk jn mr jl ob mn col sir bar wis lam mal hag gad sol mic job jb num nah lev hab heb rev phi sng qoh amo prv pss jam oba deut ecc joe zph hb zch jnh man".split(separator: " "))
    private static let bookSuffix = try! NSRegularExpression(pattern: #"\s*\d[\d:–\-]*$"#)
    private static let lxxSuffix = try! NSRegularExpression(pattern: #"(?:[ \t]+LXX)+\s*$"#, options: .caseInsensitive)

    public static func extract(content: String, title: String, hermas: HermasText = .robertsDonaldson) -> [NoteVerseRef] {
        var seen = Set<String>()
        var references: [NoteVerseRef] = []
        scan(content, hermas: hermas) { hit in
            let isChapter = hit.parsed.verse == nil
            let groups = hit.parsed.verseGroups ?? [.init(verse: hit.parsed.verse ?? 0, endVerse: hit.parsed.endVerse)]
            for group in groups {
                let verse = isChapter ? 0 : group.verse
                let end = isChapter ? nil : group.endVerse
                let key = "\(hit.parsed.bookId)|\(hit.parsed.chapter)|\(verse)|\(end.map(String.init) ?? "")|\(hit.lxx)"
                guard seen.insert(key).inserted else { continue }
                references.append(.init(bookId: hit.parsed.bookId, chapter: hit.parsed.chapter, verse: verse, endVerse: end,
                                        isChapter: isChapter, lxx: hit.lxx, sourceNoteTitle: title, context: hit.context))
            }
        }
        return references
    }

    /// Where each recognised reference sits in `content` (UTF-16 range of the reference text, LXX marker included) and the text
    /// to resolve when it is clicked — used by the note editors to style references as links (original auto-linking).
    public static func linkSpans(content: String, hermas: HermasText = .robertsDonaldson) -> [(range: NSRange, reference: String)] {
        var spans: [(range: NSRange, reference: String)] = []
        scan(content, hermas: hermas) { hit in spans.append((hit.range, hit.reference)) }
        return spans
    }

    struct Hit { let parsed: ParsedRef; let lxx: Bool; let context: String; let range: NSRange; let reference: String }

    static func scan(_ content: String, hermas: HermasText, visit: (Hit) -> Void) {
        let normalized = content.replacingOccurrences(of: #"[    ]"#, with: " ", options: .regularExpression)
        let text = normalized as NSString
        var position = 0
        while position < text.length,
              let match = candidates.firstMatch(in: normalized, options: .withTransparentBounds,
                                                range: NSRange(location: position, length: text.length - position)) {
            position = NSMaxRange(match.range)
            let isWikilink = match.range(at: 2).location != NSNotFound
            let captureRange = match.range(at: isWikilink ? 2 : 1)
            let captured = text.substring(with: captureRange)
            let raw = String(captured.prefix { $0 != "|" }).trimmingCharacters(in: .whitespacesAndNewlines)
            let marker = isWikilink ? nil : lxxSuffix.firstMatch(in: raw, range: NSRange(location: 0, length: raw.utf16.count))
            let bare = marker.map { (raw as NSString).substring(to: $0.range.location) } ?? raw
            let words = bare.split(whereSeparator: \.isWhitespace)
            var candidate = bare
            var parsed = Reference.parse(candidate, hermas: hermas)
            for start in words.indices.dropFirst() where parsed == nil {
                candidate = words[start...].joined(separator: " ")
                parsed = Reference.parse(candidate, hermas: hermas)
            }
            guard let parsed else {
                if let first = words.first {
                    let offset = (text.substring(with: match.range) as NSString).range(of: String(first))
                    let rewind = match.range.location + (offset.location == NSNotFound ? 0 : offset.location) + first.utf16.count
                    if rewind > match.range.location { position = rewind }
                }
                continue
            }
            if !isWikilink && !candidate.contains(":") {
                let book = bookSuffix.stringByReplacingMatches(in: candidate, range: NSRange(location: 0, length: candidate.utf16.count), withTemplate: "")
                    .trimmingCharacters(in: .whitespaces)
                let last = book.split(whereSeparator: \.isWhitespace).last?.lowercased().trimmingCharacters(in: CharacterSet(charactersIn: "."))
                let capitalized = candidate.utf16.first.map { (65...90).contains($0) } ?? false
                if !capitalized && (last.map { ambiguous.contains(Substring($0)) } == true || !Reference.isExactBookToken(book)) { continue }
            }
            let contextStart = max(0, match.range.location - 35)
            let contextEnd = min(text.length, NSMaxRange(match.range) + 35)
            let context = text.substring(with: NSRange(location: contextStart, length: contextEnd - contextStart))
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .replacingOccurrences(of: "[[", with: "")
                .replacingOccurrences(of: "]]", with: "")
            let lxx = marker != nil || parsed.forcedTranslation?.lowercased() == "lxx"
            // Range of the reference text itself (the trailing words that parsed, plus any LXX marker).
            let shown = candidate + (marker.map { (raw as NSString).substring(with: $0.range) } ?? "")
            let inCapture = (captured as NSString).range(of: shown, options: .backwards)
            let range = inCapture.location == NSNotFound ? captureRange
                : NSRange(location: captureRange.location + inCapture.location, length: inCapture.length)
            visit(Hit(parsed: parsed, lxx: lxx, context: context, range: range,
                      reference: candidate + (lxx ? " LXX" : "")))
        }
    }
}
