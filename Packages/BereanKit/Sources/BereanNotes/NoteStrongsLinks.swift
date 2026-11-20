import Foundation
import BereanReference

/// Explicit Strong's references in note source, including repeated references and UTF-16 offsets.
public enum NoteStrongsLinks {
    private static let exclusions: [NSRegularExpression] = [
        #"<!--[\s\S]*?(?:-->|$)"#,
        #"\[\[[^\r\n]*?(?:\]\]|(?=[\r\n])|$)"#,
        #"!?\[(?:\\.|[^\]\\])*\]\((?:\\.|[^()\\]|\([^()]*\))*\)"#,
        #"!?\[(?:\\.|[^\]\\])*\]\[(?:\\.|[^\]\\])*\]"#,
        #"(?m)^[ \t]{0,3}\[[^\]\r\n]+\]:[^\r\n]*"#,
        #"<a\b[^>]*>[\s\S]*?</a>"#,
        #"(?:[A-Za-z][A-Za-z0-9+.-]*://|www\.)[^\s<>\[\]]+"#,
        #"[A-Za-z0-9.+_-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"#,
        #"[A-Za-z0-9.-]+\.[A-Za-z]{2,}/[^\s<>\[\]]*"#,
        #"<[^>\r\n]+>"#,
    ].map { try! NSRegularExpression(pattern: $0, options: .caseInsensitive) }
    private static let definitions = try! NSRegularExpression(pattern: #"(?m)^[ \t]{0,3}\[([^\]\r\n]+)\]:"#)
    private static let labels = try! NSRegularExpression(pattern: #"!?\[([^\]\r\n]+)\]"#)
    private static let candidates = try! NSRegularExpression(pattern: #"(?<![\p{L}\p{N}_])[HhGg][ \t\u00a0]?[-‐-–]?[ \t\u00a0]?0*[0-9]{1,5}(?:[a-z])?(?![\p{L}\p{N}_])"#)

    public static func spans(in text: String, markdownSpans: [MarkdownLiveSpans.Span]? = nil) -> [(range: NSRange, number: String)] {
        let source = text as NSString
        let full = NSRange(location: 0, length: source.length)
        var excluded = (markdownSpans ?? MarkdownLiveSpans.spans(text)).compactMap { span -> NSRange? in
            switch span.kind {
            case .code, .codeBlock, .structure, .wikilink, .link, .image: return span.range
            default: return nil
            }
        }
        // Include delimiters and destinations, not just the rendered label ranges in live-preview spans.
        for regex in exclusions {
            excluded += regex.matches(in: text, range: full).map(\.range)
        }
        // Shortcut reference links use a definition elsewhere in the document.
        func referenceKey(_ label: String) -> String { label.split(whereSeparator: \.isWhitespace).joined(separator: " ").lowercased() }
        let keys = Set(definitions.matches(in: text, range: full).map { referenceKey(source.substring(with: $0.range(at: 1))) })
        if !keys.isEmpty {
                excluded += labels.matches(in: text, range: full).filter {
                keys.contains(referenceKey(source.substring(with: $0.range(at: 1))))
            }.map(\.range)
        }
        // An unfinished inline-code span must stay literal while it is being typed.
        var offset = 0
        while offset < source.length {
            guard source.character(at: offset) == 96, !isEscaped(at: offset, in: source) else { offset += 1; continue }
            let start = offset
            while offset < source.length, source.character(at: offset) == 96 { offset += 1 }
            let delimiter = source.substring(with: NSRange(location: start, length: offset - start))
            var lineEnd = 0
            source.getLineStart(nil, end: nil, contentsEnd: &lineEnd, for: NSRange(location: start, length: 0))
            var search = offset
            var close: NSRange?
            while search < lineEnd {
                let candidate = source.range(of: delimiter, range: NSRange(location: search, length: lineEnd - search))
                guard candidate.location != NSNotFound else { break }
                let beforeTick = candidate.location > 0 && source.character(at: candidate.location - 1) == 96
                let afterTick = candidate.upperBound < source.length && source.character(at: candidate.upperBound) == 96
                if !beforeTick, !afterTick, !isEscaped(at: candidate.location, in: source) { close = candidate; break }
                search = candidate.upperBound
            }
            let end = close?.upperBound ?? lineEnd
            excluded.append(NSRange(location: start, length: end - start))
            offset = max(offset, end)
        }

        return candidates.matches(in: text, range: full).compactMap { match in
            guard !isEscaped(at: match.range.location, in: source),
                  !excluded.contains(where: { NSIntersectionRange($0, match.range).length > 0 }),
                  let number = StrongsId.parse(source.substring(with: match.range)).first?.id else { return nil }
            return (match.range, number)
        }
    }

    /// Lexicon identities cited by a note, independent of automatic link styling settings.
    /// Wiki links retain their note-title identity; code and unrelated URLs never create backlinks.
    public static func references(in text: String) -> Set<String> {
        let markdown = MarkdownLiveSpans.spans(text)
        var numbers = Set(spans(in: text, markdownSpans: markdown).map(\.number))
        let source = text as NSString
        let comments = exclusions[0].matches(in: text, range: NSRange(location: 0, length: source.length)).map(\.range)
        for span in markdown {
            guard case .link(let href) = span.kind,
                  !comments.contains(where: { NSIntersectionRange($0, span.range).length > 0 }) else { continue }
            if case .lexicon(let number) = DeepLink.parse(href), let id = StrongsId.normalize(number) {
                numbers.insert(id)
            } else if href.hasPrefix("berean-lexicon:"),
                      let id = StrongsId.normalize(String(href.dropFirst("berean-lexicon:".count))) {
                numbers.insert(id)
            }
        }
        return numbers
    }

    private static func isEscaped(at offset: Int, in source: NSString) -> Bool {
        var preceding = offset
        while preceding > 0, source.character(at: preceding - 1) == 92 { preceding -= 1 }
        return (offset - preceding) % 2 == 1
    }
}
