import Testing
import BereanReference

struct DeepLinkTests {
    @Test(arguments: [
        ("berean://verse/Gen/1/1", DeepLinkRoute.verse(bookId: "GEN", chapter: 1, verse: 1)),
        ("berean://verse/Genesis/1/1-5?text=lxx", .verse(bookId: "GEN", chapter: 1, verse: 1, endVerse: 5, textId: "lxx")),
        ("berean://verse/Exo/20", .verse(bookId: "EXO", chapter: 20)),
        ("berean://open?ref=Rev%2022%3A1-5", .verse(bookId: "REV", chapter: 22, verse: 1, endVerse: 5)),
        ("berean://open?ref=Psa+23&play=1", .verse(bookId: "PSA", chapter: 23, play: true)),
        ("berean://note/abc-123", .note(id: "abc-123")),
        ("berean://note/n%2F1%20%3F", .note(id: "n/1 ?")),
        ("berean://lexicon/h7225", .lexicon(strongsNum: "H7225")),
        ("berean-dev://lexicon/g03056a", .lexicon(strongsNum: "G03056A")),
        ("berean://video/dQw4w9WgXcQ?t=754", .video(id: "dQw4w9WgXcQ", startTime: 754)),
        ("berean://video/v?t=0", .video(id: "v", startTime: 0)),
        ("berean://pdf/p1/7", .pdf(id: "p1", page: 7)),
        ("berean://pdf/p1?page=3", .pdf(id: "p1", page: 3)),
        ("berean-pdf://p1/12", .pdf(id: "p1", page: 12)),
        ("berean-dev-pdf://CaseSensitive%2FID/4", .pdf(id: "CaseSensitive/ID", page: 4)),
        ("berean://search?q=love+%26+mercy+%2B+grace&q=ignored", .search(query: "love & mercy + grace")),
        ("berean://search?q=love%FF%20mercy", .search(query: "love� mercy")),
        ("berean://trail/t1", .trail(id: "t1")),
        ("https://example.com/BEREAN/verse/Gen/1/1", .verse(bookId: "GEN", chapter: 1, verse: 1)),
        ("berean://daily", .daily),
        ("berean://share", .share),
        ("berean://workspace?name=Study%20Mode", .workspace(name: "Study Mode")),
        ("berean://session/s-42", .session(id: "s-42")),
        ("berean-dev://chat/new", .chat(compose: true)),
        ("berean://chat", .chat())
    ] as [(String, DeepLinkRoute)])
    func parsesLegacyRoutes(link: String, expected: DeepLinkRoute) {
        #expect(DeepLink.parse(link) == expected)
    }

    @Test(arguments: [
        "", "https://example.com/note/1", "https:///berean/note/1", "berean://verse/NotABook/1",
        "berean://verse/Gen", "berean://verse/Gen/0", "berean://verse/Gen/1.5", "berean://lexicon/X1",
        "berean://nothing/1", "mailto:a@b", "berean://video/", "berean://search?q=++"
    ])
    func rejectsUnsupportedOrMalformedRoutes(link: String) {
        #expect(DeepLink.parse(link) == nil)
    }
}
