import Foundation

/// Live-preview spans for a Markdown note (ADR-0014): the editor keeps the note's Markdown source byte-for-byte in its
/// text storage and only *styles* it — markup characters are hidden (null glyphs), formatted runs get fonts/colours,
/// list markers draw as bullets. Nothing is re-serialized, so every construct of the existing ProseMirror dialect
/// (callouts, columns, threads, Study Trail embeds, tables, images, highlights with colours, wikilinks) survives editing.
/// Ranges are UTF-16 (NSString) ranges.
public enum MarkdownLiveSpans {
    public enum Kind: Equatable, Sendable {
        case hidden
        case bold, italic, strike, underline, code
        case highlight(String?)          // colour name or nil (==text==)
        case link(String)                // URL
        case wikilink(String)            // target note title
        case heading(Int)
        case quote                       // a blockquote / callout line (whole line)
        case calloutLabel(String)        // the "[!type]" marker, drawn as its label
        case bullet                      // list marker drawn as "•"
        case task(Bool)                  // "[ ]" / "[x]" drawn as a box
        case codeBlock                   // fenced code (whole line, fences included)
        case tableRow, tableRule         // "| a | b |" rows; the "|---|" separator row
        case rule                        // horizontal rule line
        case image(String)               // alt text (the image source is hidden)
        case structure                   // berean:* comment lines (columns/threads/trail) — hidden but kept
    }

    public struct Span: Equatable, Sendable {
        public var range: NSRange
        public var kind: Kind
        public init(_ range: NSRange, _ kind: Kind) { self.range = range; self.kind = kind }
    }

    static func rx(_ p: String, _ o: NSRegularExpression.Options = []) -> NSRegularExpression { try! NSRegularExpression(pattern: p, options: o) }
    nonisolated(unsafe) static let heading = rx("^(#{1,6})([ \\t]+)")
    nonisolated(unsafe) static let quote = rx("^((?:> ?)+)")
    nonisolated(unsafe) static let callout = rx("^\\[!([A-Za-z]+)\\][ \\t]?")
    nonisolated(unsafe) static let list = rx("^([ \\t\\u00A0]*)([-*+]|\\d+[.)])([ \\t]+)")
    nonisolated(unsafe) static let task = rx("^\\[([ xX])\\][ \\t]")
    nonisolated(unsafe) static let ruleLine = rx("^[ \\t]*(?:-[ \\t]*){3,}$|^[ \\t]*(?:\\*[ \\t]*){3,}$|^[ \\t]*(?:_[ \\t]*){3,}$")
    nonisolated(unsafe) static let tableRule = rx("^[ \\t]*\\|?[ \\t]*:?-{3,}:?[ \\t]*(?:\\|[ \\t]*:?-{3,}:?[ \\t]*)*\\|?[ \\t]*$")
    nonisolated(unsafe) static let structureLine = rx("^[ \\t]*<!--\\s*/?berean:[^>]*-->[ \\t]*$")
    nonisolated(unsafe) static let fence = rx("^[ \\t]*(```|~~~)")

    // Inline patterns, applied in order; earlier matches win (code spans first, so their contents stay literal).
    nonisolated(unsafe) static let inline: [(NSRegularExpression, (NSTextCheckingResult, NSString) -> [Span])] = [
        (rx("(`+)(.+?)\\1"), { m, _ in [Span(m.range(at: 1), .hidden), Span(m.range(at: 2), .code), Span(NSRange(location: NSMaxRange(m.range(at: 2)), length: m.range(at: 1).length), .hidden)] }),
        (rx("!\\[([^\\]]*)\\]\\(((?:[^()\\\\]|\\\\.)*)\\)"), { m, s in
            let rawAlt = s.substring(with: m.range(at: 1)) as NSString
            let w = rawAlt.range(of: "|w", options: .backwards)
            let altLen = w.location == NSNotFound ? rawAlt.length : w.location
            let altRange = NSRange(location: m.range(at: 1).location, length: altLen)
            return [Span(NSRange(location: m.range.location, length: 2), .hidden), Span(altRange, .image(rawAlt.substring(to: altLen))),
                    Span(NSRange(location: NSMaxRange(altRange), length: NSMaxRange(m.range) - NSMaxRange(altRange)), .hidden)]
        }),
        (rx("\\[\\[([^\\]|]+)\\|([^\\]]+)\\]\\]"), { m, s in
            [Span(NSRange(location: m.range.location, length: m.range(at: 2).location - m.range.location), .hidden),
             Span(m.range(at: 2), .wikilink(s.substring(with: m.range(at: 1)))), Span(NSRange(location: NSMaxRange(m.range(at: 2)), length: 2), .hidden)]
        }),
        (rx("\\[\\[([^\\]]+)\\]\\]"), { m, s in
            [Span(NSRange(location: m.range.location, length: 2), .hidden), Span(m.range(at: 1), .wikilink(s.substring(with: m.range(at: 1)))),
             Span(NSRange(location: NSMaxRange(m.range(at: 1)), length: 2), .hidden)]
        }),
        (rx("\\[([^\\]]+)\\]\\(([^)\\s]+)(?:\\s+\"[^\"]*\")?\\)"), { m, s in
            [Span(NSRange(location: m.range.location, length: 1), .hidden), Span(m.range(at: 1), .link(s.substring(with: m.range(at: 2)))),
             Span(NSRange(location: NSMaxRange(m.range(at: 1)), length: NSMaxRange(m.range) - NSMaxRange(m.range(at: 1))), .hidden)]
        }),
        (rx("<mark class=\"hl-([a-z]+)\">(.+?)</mark>"), { m, s in
            [Span(NSRange(location: m.range.location, length: m.range(at: 2).location - m.range.location), .hidden),
             Span(m.range(at: 2), .highlight(s.substring(with: m.range(at: 1)))), Span(NSRange(location: NSMaxRange(m.range(at: 2)), length: 7), .hidden)]
        }),
        (rx("<u>(.+?)</u>"), { m, _ in wrap(m, 3, 4, .underline) }),
        (rx("\\*\\*(?=\\S)(.+?)(?<=\\S)\\*\\*"), { m, _ in wrap(m, 2, 2, .bold) }),
        (rx("__(?=\\S)(.+?)(?<=\\S)__"), { m, _ in wrap(m, 2, 2, .bold) }),
        (rx("~~(?=\\S)(.+?)(?<=\\S)~~"), { m, _ in wrap(m, 2, 2, .strike) }),
        (rx("==(?=\\S)(.+?)(?<=\\S)=="), { m, _ in wrap(m, 2, 2, .highlight(nil)) }),
        (rx("(?<![*\\w])\\*(?=[^\\s*])(.+?)(?<=[^\\s*])\\*(?![*\\w])"), { m, _ in wrap(m, 1, 1, .italic) }),
        (rx("(?<![_\\w])_(?=[^\\s_])(.+?)(?<=[^\\s_])_(?![_\\w])"), { m, _ in wrap(m, 1, 1, .italic) }),
    ]

    static func wrap(_ m: NSTextCheckingResult, _ open: Int, _ close: Int, _ k: Kind) -> [Span] {
        [Span(NSRange(location: m.range.location, length: open), .hidden), Span(m.range(at: 1), k),
         Span(NSRange(location: NSMaxRange(m.range) - close, length: close), .hidden)]
    }

    /// All spans of a document.
    public static func spans(_ text: String) -> [Span] {
        let s = text as NSString
        var out: [Span] = []
        var inFence = false
        var lineStart = 0
        while lineStart <= s.length {
            var end = 0, contentsEnd = 0
            s.getLineStart(nil, end: &end, contentsEnd: &contentsEnd, for: NSRange(location: lineStart, length: 0))
            let lineRange = NSRange(location: lineStart, length: contentsEnd - lineStart)
            out += lineSpans(s, lineRange, inFence: &inFence)
            if end <= lineStart { break }
            lineStart = end
            if lineStart == s.length { break }
        }
        return out
    }

    static func lineSpans(_ s: NSString, _ r: NSRange, inFence: inout Bool) -> [Span] {
        let line = s.substring(with: r) as NSString
        let full = NSRange(location: 0, length: line.length)
        func abs(_ x: NSRange) -> NSRange { NSRange(location: r.location + x.location, length: x.length) }
        if fence.firstMatch(in: line as String, range: full) != nil { inFence.toggle(); return [Span(r, .codeBlock), Span(r, .hidden)] }
        if inFence { return [Span(r, .codeBlock)] }
        if structureLine.firstMatch(in: line as String, range: full) != nil { return [Span(r, .structure), Span(r, .hidden)] }
        if ruleLine.firstMatch(in: line as String, range: full) != nil, r.length > 0 { return [Span(r, .rule)] }
        if tableRule.firstMatch(in: line as String, range: full) != nil, line.contains("|") { return [Span(r, .tableRule)] }
        var spans: [Span] = []
        var bodyStart = 0
        if let m = heading.firstMatch(in: line as String, range: full) {
            spans += [Span(r, .heading(m.range(at: 1).length)), Span(abs(m.range), .hidden)]
            bodyStart = NSMaxRange(m.range)
        } else if let m = quote.firstMatch(in: line as String, range: full) {
            spans += [Span(r, .quote), Span(abs(m.range), .hidden)]
            bodyStart = NSMaxRange(m.range)
            let rest = NSRange(location: bodyStart, length: line.length - bodyStart)
            if let c = callout.firstMatch(in: line as String, range: rest) {
                spans.append(Span(abs(c.range), .calloutLabel(line.substring(with: c.range(at: 1)).lowercased())))
                bodyStart = NSMaxRange(c.range)
            }
        }
        if line.hasPrefix("|") || (line.hasSuffix("|") && line.components(separatedBy: "|").count > 2) {
            spans.append(Span(r, .tableRow))
        }
        let rest = NSRange(location: bodyStart, length: line.length - bodyStart)
        if let m = list.firstMatch(in: line as String, range: rest), m.range.location == bodyStart {
            let marker = m.range(at: 2)
            if (line.substring(with: marker)).first.map({ "-*+".contains($0) }) == true { spans.append(Span(abs(marker), .bullet)) }
            bodyStart = NSMaxRange(m.range)
            let after = NSRange(location: bodyStart, length: line.length - bodyStart)
            if let t = task.firstMatch(in: line as String, range: after), t.range.location == bodyStart {
                spans.append(Span(abs(NSRange(location: t.range.location, length: 3)), .task(line.substring(with: t.range(at: 1)) != " ")))
                bodyStart = NSMaxRange(t.range)
            }
        }
        spans += inlineSpans(line, NSRange(location: bodyStart, length: line.length - bodyStart)).map { Span(abs($0.range), $0.kind) }
        return spans
    }

    /// Inline spans of one line, earlier patterns taking precedence over overlapping later ones.
    static func inlineSpans(_ line: NSString, _ range: NSRange) -> [Span] {
        var claimed = IndexSet()
        var out: [Span] = []
        for (re, make) in inline {
            for m in re.matches(in: line as String, range: range) {
                let mr = m.range
                guard !claimed.intersects(integersIn: mr.location..<NSMaxRange(mr)) else { continue }
                let made = make(m, line)
                // A code span claims its whole range; other patterns claim only their markup so nesting works (**bold *it***).
                if case .code = made[1].kind { claimed.insert(integersIn: mr.location..<NSMaxRange(mr)) }
                else { for sp in made where sp.kind == .hidden { claimed.insert(integersIn: sp.range.location..<NSMaxRange(sp.range)) } }
                out += made
            }
        }
        return out
    }

    /// The text a reader sees: hidden markup removed, bullets as "•", task boxes as ☐/☑, callout markers as their label.
    public static func plainText(_ text: String, range: NSRange? = nil) -> String {
        let s = text as NSString
        let r = range ?? NSRange(location: 0, length: s.length)
        var hidden = IndexSet(), replace: [Int: (Int, String)] = [:]
        for sp in spans(text) {
            switch sp.kind {
            case .hidden: hidden.insert(integersIn: sp.range.location..<NSMaxRange(sp.range))
            case .bullet: replace[sp.range.location] = (sp.range.length, "•")
            case .task(let on): replace[sp.range.location] = (sp.range.length, on ? "☑" : "□")
            case .calloutLabel(let t): replace[sp.range.location] = (sp.range.length, t.capitalized + ": ")
            default: break
            }
        }
        var out = ""
        var i = r.location
        while i < NSMaxRange(r) {
            if let (len, rep) = replace[i] { out += rep; i += len; continue }
            if hidden.contains(i) {
                // Keep the newline that ends a hidden structure line out of the result only if the whole line was hidden.
                i += 1; continue
            }
            out += s.substring(with: NSRange(location: i, length: 1))
            i += 1
        }
        // Lines that were entirely hidden leave empty lines; collapse runs of 3+ newlines.
        while out.contains("\n\n\n") { out = out.replacingOccurrences(of: "\n\n\n", with: "\n\n") }
        return out
    }
}
