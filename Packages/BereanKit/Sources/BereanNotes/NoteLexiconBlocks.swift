import Foundation
import BereanReference

/// The two-line dictionary format used by the original editor and dictionary Copy.
/// These are presentation ranges only: detection never rewrites a saved note.
public struct NoteLexiconBlock: Equatable, Sendable {
    public let range: NSRange
    public let heading: NSRange
    public let definition: NSRange
    public let number: String

    public static func detect(in text: String, spans: [MarkdownLiveSpans.Span]? = nil) -> [Self] {
        let source = text as NSString
        let spans = spans ?? MarkdownLiveSpans.spans(text)
        var lines: [NSRange] = []
        var offset = 0
        while offset < source.length {
            var next = 0, end = 0
            source.getLineStart(nil, end: &next, contentsEnd: &end, for: NSRange(location: offset, length: 0))
            lines.append(NSRange(location: offset, length: end - offset))
            guard next > offset else { break }
            offset = next
        }
        func eligible(_ line: NSRange) -> Bool {
            !spans.contains { span in
                guard NSIntersectionRange(span.range, line).length > 0 else { return false }
                switch span.kind {
                case .code, .codeBlock, .heading, .quote, .bullet, .task, .tableRow, .tableRule,
                     .tableHeader, .rule, .image, .structure, .link, .wikilink: return true
                default: return false
                }
            }
        }
        var blocks: [Self] = []
        var i = 0
        while i + 1 < lines.count {
            let heading = lines[i], definition = lines[i + 1]
            let line = source.substring(with: heading).trimmingCharacters(in: .whitespaces)
            let body = source.substring(with: definition).trimmingCharacters(in: .whitespaces)
            if eligible(heading), eligible(definition), !body.isEmpty, !body.hasPrefix("#"),
               let match = line.range(of: #"^[HGhg][0-9]{1,5}(?=[ \t]+\S)"#, options: .regularExpression),
               let number = StrongsId.normalize(String(line[match])) {
                blocks.append(Self(range: NSRange(location: heading.location, length: NSMaxRange(definition) - heading.location),
                                   heading: heading, definition: definition, number: number))
                i += 2
            } else { i += 1 }
        }
        return blocks
    }
}
