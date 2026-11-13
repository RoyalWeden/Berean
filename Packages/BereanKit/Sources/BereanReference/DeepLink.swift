import Foundation
import BereanCore

/// Decoded destinations shared by native URL entry points. Recognizing a route does not open it.
public enum DeepLinkRoute: Equatable, Sendable {
    case verse(bookId: String, chapter: Int, verse: Int? = nil, endVerse: Int? = nil, textId: String? = nil, play: Bool = false)
    case note(id: String)
    case lexicon(strongsNum: String)
    case video(id: String, startTime: Double? = nil)
    case pdf(id: String, page: Int? = nil)
    case search(query: String)
    case trail(id: String)
    case daily
    case workspace(name: String)
    case session(id: String)
    case share
    case chat(compose: Bool = false)
}

public enum DeepLink {
    private static let routeSchemes: Set<String> = ["berean", "berean-dev"]
    private static let pdfSchemes: Set<String> = ["berean-pdf", "berean-dev-pdf"]
    private static let verseSpec = JSRegex(#"^(\d+)(?:-(\d+))?$"#)
    private static let strongsID = JSRegex(#"^[HG]\d{1,5}[A-Z]?$"#)

    /// Port of src/lib/deepLinks.ts. Transport and destination handling belong to the caller.
    public static func parse(_ href: String, hermas: HermasText = .robertsDonaldson) -> DeepLinkRoute? {
        guard let url = URLComponents(string: JSText.trim(href)), let scheme = url.scheme?.lowercased() else {
            return nil
        }

        let path: String
        if scheme == "https" || scheme == "http" {
            let prefix = "/berean/"
            guard let host = url.host, !host.isEmpty, url.percentEncodedPath.lowercased().hasPrefix(prefix) else {
                return nil
            }
            path = String(url.percentEncodedPath.dropFirst(prefix.count))
        } else {
            guard routeSchemes.contains(scheme) || pdfSchemes.contains(scheme) else { return nil }
            path = (url.percentEncodedHost ?? "") + (url.port.map { ":\($0)" } ?? "") + url.percentEncodedPath
        }

        let segments = path.split(separator: "/").map { segment in
            let encoded = String(segment)
            return encoded.removingPercentEncoding ?? encoded
        }
        guard let head = segments.first else { return nil }
        let parts = Array(segments.dropFirst())
        if pdfSchemes.contains(scheme) {
            return .pdf(id: head, page: positiveInteger(parts.first))
        }

        // URLSearchParams treats + as a space in query values, and returns the first duplicate key.
        let queryItems = url.percentEncodedQueryItems ?? []
        func query(_ name: String) -> String? {
            guard let item = queryItems.first(where: { decodeQuery($0.name) == name }) else { return nil }
            return decodeQuery(item.value ?? "")
        }
        func verseRoute(bookId: String, chapter: Int, verse: Int?, endVerse: Int?, fallbackText: String? = nil) -> DeepLinkRoute {
            let text = query("text")
            return .verse(bookId: bookId, chapter: chapter, verse: verse, endVerse: endVerse,
                          textId: text.flatMap { $0.isEmpty ? nil : $0 } ?? fallbackText, play: query("play") == "1")
        }

        switch head.lowercased() {
        case "verse":
            guard parts.count >= 2, let book = Reference.resolveBookToken(parts[0]),
                  let chapter = positiveInteger(parts[1]) else { return nil }
            let match = parts.dropFirst(2).first.flatMap { verseSpec.match($0) }
            return verseRoute(bookId: book, chapter: chapter,
                              verse: match?[1].flatMap(Int.init), endVerse: match?[2].flatMap(Int.init))
        case "open":
            let edition = query("text").flatMap(HermasText.init(rawValue:)) ?? hermas
            guard let reference = Reference.parse(query("ref") ?? parts.joined(separator: " "), hermas: edition) else {
                return nil
            }
            return verseRoute(bookId: reference.bookId, chapter: reference.chapter,
                              verse: reference.verse, endVerse: reference.endVerse,
                              fallbackText: reference.forcedTranslation?.lowercased())
        case "note":
            return parts.first.map { .note(id: $0) }
        case "lexicon":
            guard let id = parts.first?.uppercased(), strongsID.match(id) != nil else { return nil }
            return .lexicon(strongsNum: id)
        case "video":
            return parts.first.map { .video(id: $0, startTime: nonnegativeNumber(query("t"))) }
        case "pdf":
            return parts.first.map { .pdf(id: $0, page: positiveInteger(parts.dropFirst().first ?? query("page"))) }
        case "search":
            let search = JSText.trim(query("q") ?? parts.joined(separator: " "))
            return search.isEmpty ? nil : .search(query: search)
        case "trail":
            return parts.first.map { .trail(id: $0) }
        case "daily":
            return .daily
        case "workspace":
            let name = JSText.trim(query("name") ?? parts.joined(separator: " "))
            return name.isEmpty ? nil : .workspace(name: name)
        case "session":
            return parts.first.map { .session(id: $0) }
        case "share":
            return .share
        case "chat":
            return .chat(compose: parts.first?.lowercased() == "new")
        default:
            return nil
        }
    }

    private static func decodeQuery(_ encoded: String) -> String {
        let withSpaces = encoded.replacingOccurrences(of: "+", with: " ")
        if let decoded = withSpaces.removingPercentEncoding { return decoded }

        // URLSearchParams percent-decodes bytes before replacing invalid UTF-8.
        let bytes = Array(withSpaces.utf8)
        var decoded: [UInt8] = []
        var index = 0
        while index < bytes.count {
            if bytes[index] == 37, index + 2 < bytes.count,
               let high = hexDigit(bytes[index + 1]), let low = hexDigit(bytes[index + 2]) {
                decoded.append(high * 16 + low)
                index += 3
            } else {
                decoded.append(bytes[index])
                index += 1
            }
        }
        return String(decoding: decoded, as: UTF8.self)
    }

    private static func hexDigit(_ byte: UInt8) -> UInt8? {
        switch byte {
        case 48...57: byte - 48
        case 65...70: byte - 55
        case 97...102: byte - 87
        default: nil
        }
    }

    private static func nonnegativeNumber(_ value: String?) -> Double? {
        guard let value, !value.isEmpty else { return nil }
        let number = JSText.number(value)
        return number.isFinite && number >= 0 ? number : nil
    }

    private static func positiveInteger(_ value: String?) -> Int? {
        guard let number = nonnegativeNumber(value), number > 0 else { return nil }
        return Int(exactly: number)
    }
}
