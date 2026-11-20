import Testing
import BereanSQLite
import BereanStore
@testable import BereanNotes

@Suite struct TranscriptServiceTests {
    func setup() throws -> (SQLiteConnection, TranscriptService) {
        let db = try SQLiteConnection(readWritePath: ":memory:", create: true)
        try Migrator.migrate(db)
        for (id, title) in [("v1", "Feasts"), ("v2", "Sabbath")] {
            try db.run("INSERT INTO youtube_videos (video_id, title, published, channel_name, channel_handle, thumbnail_url, type, fetched_at) VALUES (?, ?, '2026-01-01', 'Matthew', '@m', '', 'video', '2026-01-01')", [.text(id), .text(title)])
            try db.run("INSERT INTO youtube_transcripts (video_id, fetched_at, segment_count) VALUES (?, 0, 3)", [.text(id)])
        }
        let lines: [(String, Int, String)] = [("v1", 0, "the feasts of Yehovah"), ("v1", 5000, "are appointed times"), ("v1", 9000, "Leviticus twenty three"),
                                              ("v2", 0, "remember the sabbath day"), ("v2", 4000, "to keep it holy"), ("v2", 8000, "the feasts again")]
        for (v, t, text) in lines {
            try db.run("INSERT INTO youtube_transcript_segments (video_id, start_ms, dur_ms, text) VALUES (?, ?, 1000, ?)", [.text(v), .integer(Int64(t)), .text(text)])
        }
        return (db, TranscriptService(db: db))
    }

    @Test func readsAndSearches() throws {
        let (_, svc) = try setup()
        #expect(try svc.transcript("v1").map(\.text) == ["the feasts of Yehovah", "are appointed times", "Leviticus twenty three"])
        #expect(try svc.availableVideoIds() == ["v1", "v2"])
        #expect(TranscriptService.ftsTokens("Feasts, of Yehovah!") == ["feasts", "of", "yehovah"])
        let hits = try svc.search("feast")
        #expect(Set(hits.map(\.videoId)) == ["v1", "v2"])
        #expect(hits.first { $0.videoId == "v1" }?.snippet.contains("appointed times") == true) // widened with neighbours
        #expect(try svc.search("sabath").isEmpty)                // no fuzzy beyond LIKE
        #expect(try svc.search("holy")[0].startMs == 4000)
        #expect(try svc.search("feast", videoLimit: 1).count == 1)
        #expect(TranscriptService.clock(754_000) == "12:34" && TranscriptService.clock(3_725_000) == "1:02:05")
    }
}
