import Foundation
import BereanSQLite

/// Read-only YouTube transcripts (original youtubeService.ts getTranscript / getTranscriptStatus /
/// searchTranscripts). Segments arrive by data packs or desktop fetch — the client never fetches
/// (in the original, fetching is dev-only); this service never writes.
public struct TranscriptService: Sendable {
    public struct Segment: Equatable, Sendable { public let startMs: Int; public let durMs: Int; public let text: String }
    public struct SearchHit: Equatable, Sendable {
        public let videoId: String
        public var snippet: String
        public let startMs: Int
        public var matchCount: Int
        public let title: String
        public let channelName: String
        public let rank: Double
    }

    let db: SQLiteConnection
    public init(db: SQLiteConnection) { self.db = db }

    public func transcript(_ videoId: String) throws -> [Segment] {
        try db.query("SELECT start_ms, dur_ms, text FROM youtube_transcript_segments WHERE video_id = ? ORDER BY start_ms ASC", [.text(videoId)])
            .map { Segment(startMs: $0["start_ms"]?.int ?? 0, durMs: $0["dur_ms"]?.int ?? 0, text: $0["text"]?.string ?? "") }
    }

    /// Videos whose segments are present locally (checks segments, not metadata — original D-007).
    public func availableVideoIds() throws -> Set<String> {
        Set(try db.query("""
            SELECT t.video_id FROM youtube_transcripts t
            WHERE t.segment_count > 0 AND EXISTS (SELECT 1 FROM youtube_transcript_segments s WHERE s.video_id = t.video_id)
            """).compactMap { $0["video_id"]?.string })
    }

    /// The original's FTS tokenization: letters/numbers, each prefix-matched.
    public static func ftsTokens(_ query: String) -> [String] {
        var tokens: [String] = [], current = ""
        for scalar in query.lowercased().unicodeScalars {
            if CharacterSet.letters.contains(scalar) || CharacterSet.decimalDigits.contains(scalar) { current.unicodeScalars.append(scalar) }
            else if !current.isEmpty { tokens.append(current); current = "" }
        }
        if !current.isEmpty { tokens.append(current) }
        return tokens
    }

    public func search(_ query: String, videoLimit: Int = 5, perVideoLimit: Int = 1) throws -> [SearchHit] {
        let tokens = Self.ftsTokens(query)
        guard !tokens.isEmpty else { return [] }
        let match = tokens.map { "\($0)*" }.joined(separator: " ")
        func hits(_ rows: [SQLiteRow]) -> [SearchHit] {
            rows.map { r in
                let rank: Double = { if case .real(let d)? = r["rank"] { return d }; return Double(r["rank"]?.int ?? 0) }()
                return SearchHit(videoId: r["videoId"]?.string ?? "", snippet: r["snippet"]?.string ?? "", startMs: r["startMs"]?.int ?? 0,
                                 matchCount: 1, title: r["title"]?.string ?? "", channelName: r["channelName"]?.string ?? "", rank: rank)
            }
        }
        var rows: [SearchHit] = (try? hits(db.query("""
            WITH cand AS (
              SELECT rowid, bm25(youtube_transcripts_fts) AS rank FROM youtube_transcripts_fts
              WHERE youtube_transcripts_fts MATCH ? LIMIT 200000
            )
            SELECT s.video_id AS videoId, s.text AS snippet, s.start_ms AS startMs,
                   v.title AS title, v.channel_name AS channelName, cand.rank AS rank
            FROM cand
            JOIN youtube_transcript_segments s ON s.id = cand.rowid
            JOIN youtube_videos v ON v.video_id = s.video_id
            ORDER BY cand.rank, cand.rowid
            """, [.text(match)]))) ?? []
        if rows.isEmpty {
            // Original fuzzy fallback: every token as a LIKE.
            let conditions = tokens.map { _ in "LOWER(s.text) LIKE ?" }.joined(separator: " AND ")
            rows = (try? hits(db.query("""
                SELECT s.video_id AS videoId, s.text AS snippet, s.start_ms AS startMs,
                       v.title AS title, v.channel_name AS channelName, 0 AS rank
                FROM youtube_transcript_segments s JOIN youtube_videos v ON v.video_id = s.video_id
                WHERE \(conditions) ORDER BY s.start_ms LIMIT \(videoLimit * perVideoLimit * 10)
                """, tokens.map { .text("%\($0)%") }))) ?? []
        }
        // Up to perVideoLimit segments per video, at most videoLimit videos; first row's matchCount counts all.
        var results: [SearchHit] = []
        var firstIndex: [String: Int] = [:], perVideo: [String: Int] = [:]
        for hit in rows {
            if let i = firstIndex[hit.videoId] {
                results[i].matchCount += 1
                if perVideoLimit > 1, perVideo[hit.videoId, default: 1] < perVideoLimit {
                    perVideo[hit.videoId, default: 1] += 1
                    results.append(hit)
                }
            } else {
                guard firstIndex.count < videoLimit else { continue }
                firstIndex[hit.videoId] = results.count
                perVideo[hit.videoId] = 1
                results.append(hit)
            }
        }
        // Widen the top snippets with neighbouring lines (±12 s, 400 chars), as the original.
        for i in results.indices.prefix(100) {
            let r = results[i]
            if let lines = try? db.query("SELECT text FROM youtube_transcript_segments WHERE video_id = ? AND start_ms BETWEEN ? AND ? ORDER BY start_ms",
                                         [.text(r.videoId), .integer(Int64(max(0, r.startMs - 12000))), .integer(Int64(r.startMs + 12000))]) {
                let joined = lines.compactMap { $0["text"]?.string }.joined(separator: " ")
                    .split(whereSeparator: \.isWhitespace).joined(separator: " ")
                if joined.count > r.snippet.count { results[i].snippet = String(joined.prefix(400)) }
            }
        }
        return results
    }

    /// m:ss / h:mm:ss, as the original's timestamp labels.
    public static func clock(_ ms: Int) -> String {
        let s = ms / 1000, h = s / 3600, m = (s % 3600) / 60, sec = s % 60
        return h > 0 ? String(format: "%d:%02d:%02d", h, m, sec) : String(format: "%d:%02d", m, sec)
    }
}

/// Transcript search off the main thread: its own read-only connection (connections are opened
/// NOMUTEX, so never shared across threads), serialised by the actor. WAL lets it read while the
/// main connection writes.
public actor TranscriptSearcher {
    private let service: TranscriptService
    public init(databasePath: String) throws {
        service = TranscriptService(db: try SQLiteConnection(readOnlyPath: databasePath))
    }
    public func search(_ query: String, videoLimit: Int = 4) -> [TranscriptService.SearchHit] {
        (try? service.search(query, videoLimit: videoLimit)) ?? []
    }
}
