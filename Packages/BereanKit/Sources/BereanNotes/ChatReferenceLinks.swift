import Foundation
import BereanReference

/// Ephemeral presentation links for Chat. The saved message is never rewritten
/// and Chat messages do not become entries in the personal-note citation index.
public enum ChatReferenceLinks {
    public struct Link: Equatable, Sendable {
        public let range: NSRange
        public let url: URL
    }

    public static func links(in source: String, hermas: HermasText = .robertsDonaldson) -> [Link] {
        let spans = MarkdownLiveSpans.spans(source)
        let protected = NoteStrongsLinks.protectedRanges(in: source, markdownSpans: spans)
        var links = NoteVerseRefs.linkSpans(content: NoteImages.maskingSources(source), hermas: hermas).compactMap { hit -> Link? in
            guard !protected.contains(where: { NSIntersectionRange($0, hit.range).length > 0 }) else { return nil }
            var components = URLComponents()
            components.scheme = DeepLink.nativeDevScheme
            components.host = "open"
            components.queryItems = [URLQueryItem(name: "ref", value: hit.reference)]
            guard let url = components.url else { return nil }
            return Link(range: hit.range, url: url)
        }
        links += NoteStrongsLinks.spans(in: source, markdownSpans: spans).compactMap { hit in
            URL(string: DeepLink.nativeDevScheme + "://lexicon/" + hit.number).map { Link(range: hit.range, url: $0) }
        }
        var end = 0
        return links.sorted { $0.range.location < $1.range.location }.filter { link in
            guard link.range.location >= end, link.range.length > 0,
                  NSMaxRange(link.range) <= source.utf16.count else { return false }
            end = NSMaxRange(link.range)
            return true
        }
    }

    public static func markdown(_ source: String, hermas: HermasText = .robertsDonaldson) -> String {
        let rendered = NSMutableString(string: source)
        let original = source as NSString
        for link in links(in: source, hermas: hermas).reversed() {
            let label = original.substring(with: link.range)
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "[", with: "\\[")
                .replacingOccurrences(of: "]", with: "\\]")
            let destination = link.url.absoluteString
                .replacingOccurrences(of: "(", with: "%28")
                .replacingOccurrences(of: ")", with: "%29")
            rendered.replaceCharacters(in: link.range, with: "[\(label)](\(destination))")
        }
        return rendered as String
    }
}
