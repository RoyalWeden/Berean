import Testing
import BereanCore
import BereanReference

@Suite("reference golden") struct ReferenceConformanceTests {
    static func s(_ x: String?) -> JSValue { x.map { .string(JSString($0)) } ?? .null }

    static func evaluate(_ fn: String, _ a: [JSValue], hermas: HermasText) -> JSValue? {
        func str(_ i: Int) -> String { a[i].str }
        func optStr(_ i: Int) -> String? { i < a.count ? a[i].optionalString : nil }
        func dbl(_ i: Int) -> Double { a[i].numberValue! }
        func optDbl(_ i: Int) -> Double? { i < a.count ? a[i].numberValue : nil }
        switch fn {
        case "resolveBookToken": return s(Reference.resolveBookToken(str(0)))
        case "isExactBookToken": return .bool(Reference.isExactBookToken(str(0)))
        case "parseRef": return Reference.parseJSON(str(0), hermas: hermas)
        case "toCanonical": return s(Reference.toCanonical(str(0)))
        case "toFilename": return s(Reference.toFilename(str(0)))
        case "toUIDisplay": return s(Reference.toUIDisplay(str(0)))
        case "toWikilink": return s(Reference.toWikilink(str(0)))
        case "toRelatedVerse": return s(Reference.toRelatedVerse(str(0)))
        case "parseCanonical":
            guard let p = Reference.parseCanonical(str(0)) else { return .null }
            var o = JSObject(); o["bookId"] = .string(JSString(p.bookId)); o["chapter"] = .number(p.chapter)
            if let v = p.verse { o["verse"] = .number(v) }
            return .object(o)
        case "createCanonical": return s(Reference.createCanonical(str(0), chapter: Int(dbl(1)), verse: optDbl(2).map { Int($0) }))
        case "bookName": return s(Reference.bookName(str(0)))
        case "bookOrder": return .number(Double(Reference.bookOrder(str(0))))
        case "maxChapterFor": return Reference.maxChapter(str(0)).map { .number(Double($0)) } ?? .null
        case "bookChapterVerseLabel": return s(Reference.bookChapterVerseLabel(str(0), chapter: dbl(1), verse: optDbl(2), hermas: hermas))
        case "bookChapterHoverLabel": return s(Reference.bookChapterHoverLabel(str(0), chapter: dbl(1)))
        case "bookChapterLabel": return s(Reference.bookChapterLabel(str(0), chapter: dbl(1)))
        case "getTranslationForBook": return s(Reference.translation(forBook: str(0), hermas: hermas))
        case "normalizeBookName": return s(Reference.normalizeBookName(str(0)))
        case "displayBookName": return s(Reference.displayBookName(str(0), bookId: optStr(1)))
        case "formatDottedVerseRef": return s(Reference.formatDottedVerseRef(str(0), hermas: hermas))
        case "verseRefDisplay": return s(Reference.verseRefDisplay(str(0), textId: optStr(1), hermas: hermas))
        case "isDedicatedTranslation": return .bool(Reference.isDedicatedTranslation(str(0)))
        case "isStrongsRef": return .bool(Reference.isStrongsRef(str(0)))
        case "safeFtsQuery": return s(Reference.safeFtsQuery(str(0)))
        default: return nil
        }
    }

    @Test func everyCallMatchesTypeScript() throws {
        let g = try Golden.load("reference")
        let calls = g.arr("calls")
        #expect(calls.count > 10_000)
        var failures: [String] = []
        for c in calls {
            let fn = c["fn"]!.str
            let hermas = HermasText(textId: c["hermas"]?.optionalString ?? "hermas")
            guard let got = Self.evaluate(fn, c["args"]!.array, hermas: hermas) else { failures.append("unknown fn \(fn)"); continue }
            let want = c["out"] ?? .null
            if got != want {
                failures.append("\(fn)(\(JSON.stringify(c["args"]!).string)) [\(hermas.rawValue)] → \(JSON.stringify(got).string), want \(JSON.stringify(want).string)")
            }
        }
        #expect(failures.isEmpty, Comment(rawValue: "\(failures.count) mismatches:\n" + failures.prefix(40).joined(separator: "\n")))
    }
}
