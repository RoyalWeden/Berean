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
        case tableHeader
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
    nonisolated(unsafe) static let fence = rx("^[ \\t]*(?:`{3,}[^`]*$|~{3,})")

    // Inline patterns, applied in order; earlier matches win (code spans first, so their contents stay literal).
    nonisolated(unsafe) static let inline: [(NSRegularExpression, (NSTextCheckingResult, NSString) -> [Span])] = [
        (rx("(?<!`)(`+)(?!`)(.+?)(?<!`)\\1(?!`)"), { m, _ in [Span(m.range(at: 1), .hidden), Span(m.range(at: 2), .code), Span(NSRange(location: NSMaxRange(m.range(at: 2)), length: m.range(at: 1).length), .hidden)] }),
        (rx("!\\[([^\\]]*)\\]\\(([^()\\\\]*(?:\\\\.[^()\\\\]*)*)\\)"), { m, s in
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
        var activeTableColumns = 0
        var previousTableRow: (range: NSRange, spanIndex: Int)?
        while lineStart <= s.length {
            var end = 0, contentsEnd = 0
            s.getLineStart(nil, end: &end, contentsEnd: &contentsEnd, for: NSRange(location: lineStart, length: 0))
            let lineRange = NSRange(location: lineStart, length: contentsEnd - lineStart)
            var line = lineSpans(s, lineRange, inFence: &inFence)
            let isRow = line.first?.kind == .tableRow
            if let previousTableRow, line.first?.kind == .tableRule || (isRow && activeTableColumns == 0) {
                let columns = tableCells(in: s, range: previousTableRow.range).count
                let isRule = line.first?.kind == .tableRule || iPhoneTableRule(in: s, range: lineRange, nextLine: end, columns: columns)
                if isRule, columns > 0, columns == tableCells(in: s, range: lineRange).count {
                    var insertion = [Span(previousTableRow.range, .tableHeader)]
                    if activeTableColumns == 0 {
                        insertion += tableEscapeSpans(in: s, range: previousTableRow.range)
                    }
                    out.insert(contentsOf: insertion, at: previousTableRow.spanIndex + 1)
                    line = [Span(lineRange, .tableRule)]
                    activeTableColumns = columns
                }
            }
            if line.first?.kind != .tableRule,
               !isRow || tableCells(in: s, range: lineRange).count != activeTableColumns {
                activeTableColumns = 0
            }
            previousTableRow = line.first?.kind == .tableRow ? (lineRange, out.count) : nil
            if isRow, activeTableColumns > 0, line.first?.kind == .tableRow {
                line += tableEscapeSpans(in: s, range: lineRange)
            }
            out += line
            if end <= lineStart { break }
            lineStart = end
            if lineStart == s.length { break }
        }
        return out
    }

    /// An escaped pipe is literal in a table cell, including inside inline code.
    private static func tableEscapeSpans(in text: NSString, range: NSRange) -> [Span] {
        var spans: [Span] = []
        var escaped = false
        for offset in range.location..<range.upperBound {
            let character = text.character(at: offset)
            if character == 124, escaped {
                spans.append(Span(NSRange(location: offset - 1, length: 1), .hidden))
            }
            escaped = character == 92 && !escaped
        }
        return spans
    }

    /// An older iPhone insert command substituted em dashes into the separator.
    /// Only recover that shape between equally sized rows and outside another table.
    private static func iPhoneTableRule(in text: NSString, range: NSRange, nextLine: Int, columns: Int) -> Bool {
        guard columns > 0, nextLine < text.length,
              text.substring(with: range).contains("—") else { return false }
        let cells = tableCells(in: text, range: range)
        guard cells.count == columns, cells.allSatisfy({
            text.substring(with: $0).trimmingCharacters(in: .whitespaces) == "—"
        }) else { return false }
        var bodyEnd = 0
        text.getLineStart(nil, end: nil, contentsEnd: &bodyEnd, for: NSRange(location: nextLine, length: 0))
        return tableCells(in: text, range: NSRange(location: nextLine, length: bodyEnd - nextLine)).count == columns
    }

    /// UTF-16 cell ranges for the outer-pipe format written by both Berean editors.
    public static func tableCells(in text: NSString, range: NSRange) -> [NSRange] {
        guard range.location <= text.length, range.length <= text.length - range.location else { return [] }
        var pipes: [Int] = []
        var escaped = false
        for offset in range.location..<range.upperBound {
            let character = text.character(at: offset)
            if character == 124, !escaped { pipes.append(offset) }
            escaped = character == 92 && !escaped
        }
        guard pipes.first == range.location, pipes.last == range.upperBound - 1 else { return [] }
        return zip(pipes, pipes.dropFirst()).map { start, end in
            NSRange(location: start + 1, length: end - start - 1)
        }
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

    /// Common emphasis comes from Foundation's Markdown source positions, so
    /// delimiter runs can combine styles without changing text-storage indices.
    /// Berean's extended marks remain source-preserving overlays.
    static func inlineSpans(_ line: NSString, _ range: NSRange) -> [Span] {
        let common = commonEmphasis(line, range)
        var claimed = IndexSet()
        var accepted: [NSRange] = []
        var out: [Span] = []
        for (re, make) in inline {
            for m in re.matches(in: line as String, range: range) {
                let mr = m.range
                let made = make(m, line)
                if let common, made.contains(where: { $0.kind == .bold || $0.kind == .italic }) {
                    // Preserve the native editor's existing punctuation-only
                    // marks (e.g. A**\\|**B), which CommonMark leaves literal.
                    // Parsed delimiter runs and literal code still take priority.
                    if made.filter({ $0.kind == .hidden }).contains(where: { marker in
                        common.hidden.contains { NSIntersectionRange($0.range, marker.range).length > 0 }
                    }) || common.code.contains(where: { NSIntersectionRange($0, mr).length > 0 }) { continue }
                }
                let isCode = made.contains { $0.kind == .code }
                if isCode {
                    if let common, let body = made.first(where: { $0.kind == .code })?.range,
                       !common.code.contains(where: { NSIntersectionRange($0, body).length > 0 }) { continue }
                    guard !claimed.intersects(integersIn: mr.location..<mr.upperBound) else { continue }
                } else {
                    // An outer mark may enclose an already parsed code/link or
                    // another style; only reusing its delimiters is forbidden.
                    guard !made.filter({ $0.kind == .hidden }).contains(where: {
                        claimed.intersects(integersIn: $0.range.location..<$0.range.upperBound)
                    }) else { continue }
                    guard accepted.allSatisfy({ old in
                        NSIntersectionRange(old, mr).length == 0 || NSIntersectionRange(old, mr) == old || NSIntersectionRange(old, mr) == mr
                    }) else { continue }
                }
                if isCode { claimed.insert(integersIn: mr.location..<mr.upperBound) }
                else {
                    for sp in made where sp.kind == .hidden { claimed.insert(integersIn: sp.range.location..<sp.range.upperBound) }
                }
                accepted.append(mr)
                out += made
            }
        }
        if let common { out += common.styles + common.hidden }
        return out
    }

    private struct CommonEmphasis {
        let styles: [Span]
        let hidden: [Span]
        let code: [NSRange]
    }

    /// Bounded, process-local memoization keeps unchanged note lines out of
    /// Foundation's parser during typing. Values use local UTF-16 offsets.
    private final class CommonEmphasisCache: @unchecked Sendable {
        private let lock = NSLock()
        private var values: [String: CommonEmphasis] = [:]
        private var order: [String] = []
        private var units = 0

        func value(for source: String) -> CommonEmphasis? {
            lock.lock(); defer { lock.unlock() }
            return values[source]
        }

        func insert(_ value: CommonEmphasis, for source: String) {
            let size = source.utf16.count
            guard size <= 4_096 else { return }
            lock.lock(); defer { lock.unlock() }
            guard values[source] == nil else { return }
            while order.count >= 512 || units + size > 65_536 {
                let oldest = order.removeFirst()
                units -= oldest.utf16.count
                values.removeValue(forKey: oldest)
            }
            values[source] = value
            order.append(source)
            units += size
        }
    }

    private static let commonEmphasisCache = CommonEmphasisCache()

    private static func commonEmphasis(_ line: NSString, _ range: NSRange) -> CommonEmphasis? {
        let source = line.substring(with: range)
        guard source.contains("*") || source.contains("_") || source.contains("`") else { return nil }
        let local: CommonEmphasis
        if let cached = commonEmphasisCache.value(for: source) { local = cached }
        else {
            guard let parsed = parseCommonEmphasis(source) else { return nil }
            commonEmphasisCache.insert(parsed, for: source)
            local = parsed
        }
        func shifted(_ value: NSRange) -> NSRange { NSRange(location: range.location + value.location, length: value.length) }
        return CommonEmphasis(styles: local.styles.map { Span(shifted($0.range), $0.kind) },
                              hidden: local.hidden.map { Span(shifted($0.range), .hidden) },
                              code: local.code.map(shifted))
    }

    private static func parseCommonEmphasis(_ source: String) -> CommonEmphasis? {
        guard let parsed = try? AttributedString(markdown: source, options: .init(
            interpretedSyntax: .inlineOnlyPreservingWhitespace, appliesSourcePositionAttributes: true)) else { return nil }
        let line = source as NSString
        let range = NSRange(location: 0, length: line.length)
        var represented = IndexSet(), styles: [Span] = [], code: [NSRange] = []
        for run in parsed.runs {
            guard let position = run.markdownSourcePosition,
                  let indices = Range(position, in: source) else { continue }
            let local = NSRange(indices, in: source)
            guard local.location >= 0, local.upperBound <= (source as NSString).length else { continue }
            represented.insert(integersIn: local.location..<local.upperBound)
            let absolute = NSRange(location: range.location + local.location, length: local.length)
            if let intent = run.inlinePresentationIntent {
                if intent.contains(.code) { code.append(absolute) }
                if intent.contains(.stronglyEmphasized) { styles.append(Span(absolute, .bold)) }
                if intent.contains(.emphasized) { styles.append(Span(absolute, .italic)) }
            }
        }
        // Don't treat emphasis-like characters inside URLs/wiki destinations as
        // visible syntax. Those fields keep the existing Berean link identities.
        var metadata = IndexSet()
        for (regex, make) in inline.dropFirst().prefix(4) {
            for match in regex.matches(in: line as String, range: range) {
                for span in make(match, line) where span.kind == .hidden {
                    metadata.insert(integersIn: span.range.location..<span.range.upperBound)
                }
            }
        }
        var hidden = IndexSet()
        for (offset, character) in source.utf16.enumerated() where character == 42 || character == 95 {
            let absolute = range.location + offset
            if !represented.contains(offset), !metadata.contains(absolute) { hidden.insert(absolute) }
        }
        return CommonEmphasis(styles: styles, hidden: hidden.rangeView.map { Span(NSRange($0), .hidden) }, code: code)
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
        var cursor = r.location
        var visibleStart = cursor
        while cursor < r.upperBound {
            let substitution = replace[cursor]
            if substitution != nil || hidden.contains(cursor) {
                if cursor > visibleStart {
                    out += s.substring(with: NSRange(visibleStart..<cursor))
                }
                if let (length, replacement) = substitution {
                    out += replacement
                    cursor += length
                } else {
                    cursor += 1
                }
                visibleStart = cursor
            } else {
                cursor += 1
            }
        }
        if visibleStart < r.upperBound {
            out += s.substring(with: NSRange(visibleStart..<r.upperBound))
        }
        // Lines that were entirely hidden leave empty lines; collapse runs of 3+ newlines.
        while out.contains("\n\n\n") { out = out.replacingOccurrences(of: "\n\n\n", with: "\n\n") }
        return out
    }
}
