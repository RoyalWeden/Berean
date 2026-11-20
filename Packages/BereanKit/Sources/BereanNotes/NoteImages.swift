import Foundation
import CoreGraphics

/// Inline note images, as the original editor writes them: `![alt](src)` where a resized image
/// carries its width as an `|wNNN` suffix on the alt text (pm/serializer.ts), and the source is a
/// base64 `data:image/...` URI while vault sync is off (pm/markdownIt.ts GOOD_DATA_RE).
public enum NoteImages {
    public struct Image: Equatable, Sendable {
        /// The whole `![…](…)` markup.
        public var range: NSRange
        /// The visible alt text (without `|w`), drawn as the caption.
        public var captionRange: NSRange
        public var alt: String
        public var width: Int?
        public var source: String
    }

    nonisolated(unsafe) static let pattern = try! NSRegularExpression(pattern: "!\\[([^\\]]*)\\]\\(([^()\\\\]*(?:\\\\.[^()\\\\]*)*)\\)")
    nonisolated(unsafe) static let goodData = try! NSRegularExpression(pattern: "^data:image/(gif|png|jpe?g|webp);base64,", options: [.caseInsensitive])

    public static func find(in text: String) -> [Image] {
        let ns = text as NSString
        return pattern.matches(in: text, range: NSRange(location: 0, length: ns.length)).map { m in
            let rawAlt = ns.substring(with: m.range(at: 1))
            var alt = rawAlt, width: Int?
            if let bar = rawAlt.range(of: "|w", options: .backwards),
               let w = Int(rawAlt[bar.upperBound...]), w > 0, rawAlt[bar.upperBound...].allSatisfy(\.isASCII) {
                alt = String(rawAlt[..<bar.lowerBound]); width = w
            }
            let caption = NSRange(location: m.range(at: 1).location, length: (alt as NSString).length)
            return Image(range: m.range, captionRange: caption, alt: alt, width: width,
                         source: ns.substring(with: m.range(at: 2)).trimmingCharacters(in: .whitespaces))
        }
    }

    /// Bytes of a supported base64 data URI (gif/png/jpeg/webp — SVG is not rendered, as the original refuses it inline).
    public static func dataURIBytes(_ source: String) -> Data? {
        let ns = source as NSString
        guard let m = goodData.firstMatch(in: source, range: NSRange(location: 0, length: min(ns.length, 64))) else { return nil }
        return Data(base64Encoded: ns.substring(from: NSMaxRange(m.range)), options: .ignoreUnknownCharacters)
    }

    /// Display size: the saved width (or the natural width) clamped to the available width, aspect kept.
    public static func displaySize(natural: CGSize, savedWidth: Int?, available: CGFloat, maxHeight: CGFloat = 640) -> CGSize {
        guard natural.width > 0, natural.height > 0, available > 0 else { return .zero }
        var w = min(CGFloat(savedWidth ?? Int(natural.width)), available)
        var h = w * natural.height / natural.width
        if h > maxHeight { h = maxHeight; w = h * natural.width / natural.height }
        return CGSize(width: w.rounded(), height: h.rounded())
    }

    /// The text with every image *source* replaced by spaces of the same UTF-16 length, for the
    /// reference/Strong's scanners: ranges stay valid, but base64 payloads (hundreds of KB, full of
    /// "H1234"-like runs) are neither scanned per keystroke nor turned into false links.
    public static func maskingSources(_ text: String) -> String {
        guard text.contains("](") else { return text }
        let images = find(in: text)
        guard !images.isEmpty else { return text }
        let masked = NSMutableString(string: text)
        for image in images.reversed() {
            let sourceStart = NSMaxRange(image.captionRange)
            let length = NSMaxRange(image.range) - sourceStart
            guard length > 0 else { continue }
            masked.replaceCharacters(in: NSRange(location: sourceStart, length: length),
                                     with: String(repeating: " ", count: length))
        }
        return masked as String
    }

    /// The image MIME type sniffed from the bytes (png/jpeg/gif/webp), or nil for other formats
    /// (which callers re-encode as PNG first, since only these four render inline).
    public static func mimeType(of data: Data) -> String? {
        let b = [UInt8](data.prefix(12))
        if b.starts(with: [0x89, 0x50, 0x4E, 0x47]) { return "image/png" }
        if b.starts(with: [0xFF, 0xD8, 0xFF]) { return "image/jpeg" }
        if b.starts(with: [0x47, 0x49, 0x46, 0x38]) { return "image/gif" }
        if b.count >= 12, b.starts(with: [0x52, 0x49, 0x46, 0x46]), Array(b[8..<12]) == [0x57, 0x45, 0x42, 0x50] { return "image/webp" }
        return nil
    }

    /// `![alt](data:<mime>;base64,…)` exactly as the original inserts an image (pm/imageInsert.ts:
    /// alt = file name without extension; the data URL is stored inline). Nil for unsupported bytes.
    public static func markdown(for data: Data, alt: String) -> String? {
        guard let mime = mimeType(of: data) else { return nil }
        let cleanAlt = alt.replacingOccurrences(of: "]", with: "").replacingOccurrences(of: "[", with: "")
            .components(separatedBy: .newlines).joined(separator: " ")
        return "![\(cleanAlt)](data:\(mime);base64,\(data.base64EncodedString()))"
    }

    /// The alt text the original derives from a file name.
    public static func alt(forFileName name: String) -> String {
        let ns = name as NSString
        return ns.pathExtension.isEmpty ? name : ns.deletingPathExtension
    }

    /// The image whose markup contains (or touches) `location`, if any.
    public static func image(at location: Int, in text: String) -> Image? {
        find(in: text).first { location >= $0.range.location && location <= NSMaxRange($0.range) }
    }

    /// Replaces only the alt text so the image carries `|w<width>` (nil = natural size, the suffix
    /// removed), exactly as the original serializer writes a resized image. Returns the UTF-16
    /// range to replace and its replacement; the source is untouched.
    public static func widthEdit(_ image: Image, in text: String, width: Int?) -> (range: NSRange, replacement: String) {
        let ns = text as NSString
        let altStart = image.captionRange.location
        let closing = ns.range(of: "](", options: [], range: NSRange(location: altStart, length: NSMaxRange(image.range) - altStart))
        let altRange = NSRange(location: altStart, length: (closing.location == NSNotFound ? NSMaxRange(image.captionRange) : closing.location) - altStart)
        return (altRange, image.alt + (width.map { "|w\($0)" } ?? ""))
    }
}
