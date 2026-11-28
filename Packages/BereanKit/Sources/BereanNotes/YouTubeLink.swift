import Foundation

/// A YouTube video link with an optional start time — the timestamp links Berean inserts into
/// notes (`[Channel — Title — 12:34](https://youtu.be/ID?t=754)`) and ordinary watch/shorts URLs.
public struct YouTubeLink: Equatable, Sendable {
    public let videoId: String
    public let startMs: Int

    public static func parse(_ string: String) -> YouTubeLink? {
        guard let comps = URLComponents(string: string), let host = comps.host?.lowercased() else { return nil }
        let items = comps.queryItems ?? []
        let path = comps.path.split(separator: "/").map(String.init)
        var id: String?
        if host == "youtu.be" || host.hasSuffix(".youtu.be") { id = path.first }
        else if host == "youtube.com" || host.hasSuffix(".youtube.com") {
            if path.first == "watch" { id = items.first { $0.name == "v" }?.value }
            else if ["shorts", "embed", "live"].contains(path.first ?? ""), path.count > 1 { id = path[1] }
        }
        guard let videoId = id, videoId.count >= 6,
              videoId.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" }) else { return nil }
        let t = items.first { $0.name == "t" || $0.name == "start" }?.value ?? comps.fragment.flatMap { $0.hasPrefix("t=") ? String($0.dropFirst(2)) : nil }
        return YouTubeLink(videoId: videoId, startMs: (t.flatMap(seconds) ?? 0) * 1000)
    }

    /// "754", "754s", "12m34s", "1h2m5s".
    static func seconds(_ raw: String) -> Int? {
        if let n = Int(raw) { return n }
        var total = 0, number = ""
        for ch in raw.lowercased() {
            if ch.isNumber { number.append(ch); continue }
            guard let n = Int(number) else { return nil }
            switch ch { case "h": total += n * 3600; case "m": total += n * 60; case "s": total += n; default: return nil }
            number = ""
        }
        if !number.isEmpty { return nil }
        return total
    }
}
