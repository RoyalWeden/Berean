import Testing
@testable import BereanNotes

@Suite struct YouTubeLinkTests {
    @Test func parsesTimestampLinks() {
        #expect(YouTubeLink.parse("https://youtu.be/7PZjoIgdows?t=754") == YouTubeLink(videoId: "7PZjoIgdows", startMs: 754_000))
        #expect(YouTubeLink.parse("https://youtu.be/7PZjoIgdows") == YouTubeLink(videoId: "7PZjoIgdows", startMs: 0))
        #expect(YouTubeLink.parse("https://www.youtube.com/watch?v=7PZjoIgdows&t=1m2s") == YouTubeLink(videoId: "7PZjoIgdows", startMs: 62_000))
        #expect(YouTubeLink.parse("https://m.youtube.com/watch?v=7PZjoIgdows&t=8s&pp=x") == YouTubeLink(videoId: "7PZjoIgdows", startMs: 8_000))
        #expect(YouTubeLink.parse("https://www.youtube.com/shorts/abcDEF123_-") == YouTubeLink(videoId: "abcDEF123_-", startMs: 0))
        #expect(YouTubeLink.parse("https://www.youtube.com/watch?v=7PZjoIgdows&start=3605")?.startMs == 3_605_000)
        #expect(YouTubeLink.parse("https://www.youtube.com/@matthewforyeshua/videos") == nil)
        #expect(YouTubeLink.parse("https://example.com/watch?v=7PZjoIgdows") == nil)
        #expect(YouTubeLink.parse("https://notyoutube.com/watch?v=7PZjoIgdows") == nil)
        #expect(YouTubeLink.seconds("1h2m5s") == 3725 && YouTubeLink.seconds("12x") == nil)
    }
}
