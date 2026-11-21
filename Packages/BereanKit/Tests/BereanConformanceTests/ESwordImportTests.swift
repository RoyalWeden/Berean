import Foundation
import Testing
import BereanCore
import BereanSQLite
import BereanStore
import BereanNotes

@Suite("e-Sword import") struct ESwordImportTests {
    @Test func stripsRtfLikeTheOriginal() {
        let rtf = #"{\rtf1\ansi{\fonttbl{\f0 Times;}}{\colortbl;\red0\green0\blue0;}\f0\fs24 Grace \'93divine influence\'94 \b on\b0  the heart\par See Tit_2:11-14 and {\field{\*\fldinst HYPERLINK "https://example.org"}{\fldrslt {\cf1 Strong's}}}\par Caf\u233?\tab end}"#
        let text = ESwordImport.expandVerseRefs(ESwordImport.stripRtf(rtf))
        // Oracle: the original TypeScript (electron/ipc/eSwordImport.ts) run under node on this input.
        #expect(text == "Grace \u{201C}divine influence\u{201D} on the heart\nSee Titus 2:11-14 and Strong's\nCafé\tend", "\(text.debugDescription)")
        #expect(ESwordImport.stripRtf(#"{\rtf1 Read {\field{\fldinst HYPERLINK "https://x.org/a"}{\fldrslt the article}} now.\par}"#) == "Read the article now.")
        #expect(ESwordImport.stripRtf(#"{\rtf1 A\par\par\par\par B \'85 \~ C\line D}"#) == "A\n\nB \u{2026}   C\nD")
        #expect(ESwordImport.stripRtf("plain text") == "plain text")
        #expect(ESwordImport.expandVerseRefs("Gen_1:1, 2Pe_3:16, Xyz_1:2") == "Genesis 1:1, 2 Peter 3:16, Xyz 1:2")
    }

    @Test func oleDates() {
        var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: "UTC")!
        let d = ESwordImport.oleDate(45_000, calendar: cal)
        #expect(cal.dateComponents([.year, .month, .day], from: d) == DateComponents(year: 2023, month: 3, day: 15))
    }

    @Test func readsClassifiesAndSaves() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let study = try SQLiteConnection(readWritePath: dir.appendingPathComponent("study.notx").path, create: true)
        try study.exec("CREATE TABLE Verses (Book INTEGER, Chapter INTEGER, Verse INTEGER, Notes TEXT)")
        try study.run("INSERT INTO Verses VALUES (43, 3, 16, ?)", [.text(#"{\rtf1 For God so loved\par}"#)])
        try study.run("INSERT INTO Verses VALUES (99, 1, 1, 'bad book')")
        try study.run("INSERT INTO Verses VALUES (1, 1, 1, '')")
        let topics = try SQLiteConnection(readWritePath: dir.appendingPathComponent("topic.topx").path, create: true)
        try topics.exec("CREATE TABLE Topics (Title TEXT, Notes TEXT)")
        try topics.run("INSERT INTO Topics VALUES ('Sabbath', 'Keep it holy, Exo_20:8')")
        let journal = try SQLiteConnection(readWritePath: dir.appendingPathComponent("journal.jnlx").path, create: true)
        try journal.exec("CREATE TABLE Dates (Date REAL, Notes TEXT)")
        try journal.run("INSERT INTO Dates VALUES (45000.5, 'Morning reading')")
        #expect(ESwordImport.availableSources(in: dir) == .all)

        var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: "UTC")!
        let read = try ESwordImport.read(folder: dir, sources: .all, calendar: cal)
        #expect(read.map(\.title) == ["John 3:16", "Sabbath", "Daily — 2023-03-15"])
        #expect(read[0].passage == "JHN.3.16" && read[0].body == "For God so loved" && read[1].body == "Keep it holy, Exodus 20:8")

        let db = try SQLiteConnection(readWritePath: ":memory:", create: true)
        try Migrator.migrate(db)
        let notes = NotesService(db: db)
        var first = try ESwordImport.classify(read, db: db)
        #expect(first.allSatisfy { $0.status == .new })
        #expect(try ESwordImport.save(first, notes: notes, db: db) == (3, 0))
        let row = try db.query("SELECT id, type, verse_ref, tags, color, imported_at, status FROM notes WHERE title = 'John 3:16'").first!
        #expect(row["id"]?.string?.hasPrefix("esw-") == true && row["type"]?.string == "verse" && row["verse_ref"]?.string == "JHN.3.16")
        #expect(row["tags"]?.string == #"["esword"]"# && row["color"]?.string == "blue" && row["status"]?.string == nil)
        #expect(row["imported_at"] != nil && row["imported_at"] != .null)

        var changed = read; changed[1].body = "Keep it holy — updated"
        first = try ESwordImport.classify(changed, db: db)
        #expect(first.map(\.status) == [.duplicate, .updated, .duplicate])
        #expect(try ESwordImport.save(first, notes: notes, db: db) == (0, 1))
        #expect(try db.query("SELECT content FROM notes WHERE title = 'Sabbath'").first?["content"]?.string == "Keep it holy — updated")
        #expect(try db.query("SELECT COUNT(*) AS n FROM notes").first?["n"] == .integer(3))
    }
}
