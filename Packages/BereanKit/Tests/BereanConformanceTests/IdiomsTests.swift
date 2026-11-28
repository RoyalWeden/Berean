import Foundation
import Testing
import BereanCore
import BereanSQLite
import BereanStore
import BereanNotes

@Suite("idioms") struct IdiomsTests {
    @Test func variantsMatchOriginal() {
        #expect(Idioms.variants("city") == ["city", "city's", "cities"])
        #expect(Idioms.variants("day") == ["day", "day's", "days"])
        #expect(Idioms.variants("church") == ["church", "church's", "churches"])
        #expect(Idioms.variants(" horn ") == ["horn", "horn's", "horns"])
        #expect(Idioms.variants("") == [])
    }

    @Test func matcherLongestFirstAndBoundaries() {
        let m = Idioms.Matcher([
            Idiom(id: "a", term: "lift up the horn", meaning: "to exalt", aliases: [], autoVariants: false),
            Idiom(id: "b", term: "horn", meaning: "strength", aliases: ["cornet"], autoVariants: true),
        ])
        let text = "He shall lift up the horn of his anointed; horns and the Horn's sound; hornet; cornets"
        let found = m.matches(in: text).map { ((text as NSString).substring(with: $0.range), $0.idiomId) }
        #expect(found.map(\.0) == ["lift up the horn", "horns", "Horn's", "cornets"])
        #expect(found.map(\.1) == ["a", "b", "b", "b"])
        #expect(Idioms.Matcher([]).matches(in: text).isEmpty)
    }

    @Test func listsIdiomNotes() throws {
        let db = try SQLiteConnection(readWritePath: ":memory:", create: true)
        try Migrator.migrate(db)
        let notes = NotesService(db: db)
        _ = try notes.create(.init(type: "idiom", title: "Horn", content: "", idiomTerm: "horn", idiomMeaning: "strength", idiomAliases: ["cornet"], idiomAutoVariants: true))
        _ = try notes.create(.init(type: "idiom", title: "Bowels", content: "", idiomTerm: "bowels", idiomMeaning: "inner affections"))
        _ = try notes.create(.init(type: "general", title: "Not an idiom", content: ""))
        let list = try Idioms.list(db: db)
        #expect(list.map(\.term) == ["bowels", "horn"])
        #expect(list[1].aliases == ["cornet"] && list[1].autoVariants && !list[0].autoVariants)
    }
}
