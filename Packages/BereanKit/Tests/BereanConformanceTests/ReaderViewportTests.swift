import Testing
import BereanCore
import BereanWorkspace

struct ReaderViewportTests {
    @Test func roundTripIsLocalAndPreservesOtherFields() throws {
        var state = JSObject()
        state["bookId"] = .string(JSString("MRK")); state["chapter"] = .number(13)
        state["translation"] = .string(JSString("kjva")); state["scrollPosition"] = .number(77)
        let saved = try #require(ReaderViewport(offset: 1200.5, verse: 30, atEnd: true,
                                              selectedVerses: [30, 31], width: 390, verseOffset: -4.25))
        let updated = ReaderViewports.updating(state, chapter: "kjva|MRK|13", position: saved)
        #expect(ReaderViewports.position(in: updated, chapter: "kjva|MRK|13") == saved)
        #expect(updated["scrollPosition"] == .number(77))
        #expect(updated["bookId"] == state["bookId"])
        let before = TabFields.split(type: .bible, state: state)
        let after = TabFields.split(type: .bible, state: updated)
        #expect(after.sync == before.sync)
        #expect(after.local[ReaderViewports.field] != nil)
        let reloaded = TabFields.merge(type: .bible, sync: after.sync, local: after.local)
        #expect(ReaderViewports.position(in: reloaded, chapter: "kjva|MRK|13") == saved)
    }

    @Test func boundedRecentEditionsAndExplicitJumpRemoval() throws {
        var state = JSObject()
        let position = try #require(ReaderViewport(offset: 80, verse: 3))
        for chapter in 0..<ReaderViewports.capacity {
            state = ReaderViewports.updating(state, chapter: "kjva|PSA|\(chapter)", position: position)
        }
        state = ReaderViewports.updating(state, chapter: "kjva|PSA|0", position: position)
        state = try #require(JSON.parse(JSON.stableJSON(.object(state))).objectValue)
        state = ReaderViewports.updating(state, chapter: "lxx|PSA|3", position: position)
        #expect(state[ReaderViewports.field]?.objectValue?.entries.count == ReaderViewports.capacity)
        #expect(ReaderViewports.position(in: state, chapter: "kjva|PSA|0") == position)
        #expect(ReaderViewports.position(in: state, chapter: "kjva|PSA|1") == nil)
        state = ReaderViewports.updating(state, chapter: "lxx|PSA|3", position: nil)
        #expect(ReaderViewports.position(in: state, chapter: "lxx|PSA|3") == nil)
        #expect(ReaderViewports.position(in: state, chapter: "kjva|PSA|0") == position)
    }

    @Test func invalidGeometryIsRejectedAndFutureMetadataRetained() throws {
        #expect(ReaderViewport(offset: .infinity, verse: 1) == nil)
        #expect(ReaderViewport(offset: -.infinity, verse: 1) == nil)
        #expect(ReaderViewport(offset: -1, verse: 1) == nil)
        #expect(ReaderViewport(offset: 0, verse: 1, width: 0) == nil)
        #expect(ReaderViewport(offset: 0, verse: 1, verseOffset: .nan) == nil)
        let position = try #require(ReaderViewport(offset: 1, verse: 0, selectedVerses: [0, 2]))
        var record = position.json()
        record["future"] = .string(JSString("retained"))
        var entries = JSObject(); entries["edition"] = .object(record)
        var state = JSObject(); state[ReaderViewports.field] = .object(entries)
        let updated = ReaderViewports.updating(state, chapter: "edition", position: position)
        #expect(updated[ReaderViewports.field]?.objectValue?["edition"]?.objectValue?["future"] == record["future"])
        record["verse"] = .number(1.5); #expect(ReaderViewport(json: record) == nil)
        record = position.json(); record["width"] = .string(JSString("wide")); #expect(ReaderViewport(json: record) == nil)
        record = position.json(); record["selectedVerses"] = .string(JSString("1")); #expect(ReaderViewport(json: record) == nil)
    }
}
