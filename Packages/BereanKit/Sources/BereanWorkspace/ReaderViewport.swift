import BereanCore

/// Device presentation only; never part of the Scripture destination/sync hash.
public struct ReaderViewport: Equatable, Sendable {
    public let offset: Double
    public let verse: Int?
    public let atEnd: Bool
    public let selectedVerses: Set<Int>
    public let width: Double?
    public let verseOffset: Double?

    public init?(offset: Double, verse: Int?, atEnd: Bool = false, selectedVerses: Set<Int> = [],
                 width: Double? = nil, verseOffset: Double? = nil) {
        guard offset.isFinite, (0...10_000_000).contains(offset),
              verse.map({ (0...999_999).contains($0) }) ?? true,
              selectedVerses.count <= 1_000, selectedVerses.allSatisfy({ (0...999_999).contains($0) }),
              width.map({ $0.isFinite && $0 > 0 && $0 <= 100_000 }) ?? true,
              verseOffset.map({ $0.isFinite && abs($0) <= 1_000_000 }) ?? true else { return nil }
        self.offset = offset; self.verse = verse; self.atEnd = atEnd
        self.selectedVerses = selectedVerses; self.width = width; self.verseOffset = verseOffset
    }

    public init?(json: JSObject) {
        for key in ["verse", "width", "verseOffset"] {
            if let value = json[key], value != .null, value.numberValue == nil { return nil }
        }
        if let value = json["selectedVerses"], value.arrayValue == nil { return nil }
        if let value = json["atEnd"], value.boolValue == nil { return nil }
        func optionalNumber(_ key: String) -> Double? { json[key]?.numberValue }
        guard let offset = optionalNumber("offset") else { return nil }
        let rawVerse = optionalNumber("verse")
        let verse = rawVerse.flatMap(Int.init(exactly:))
        guard rawVerse == nil || verse != nil else { return nil }
        let rawSelected = json["selectedVerses"]?.arrayValue ?? []
        guard rawSelected.count <= 1_000 else { return nil }
        let selected = rawSelected.compactMap { $0.numberValue.flatMap(Int.init(exactly:)) }
        guard selected.count == rawSelected.count else { return nil }
        self.init(offset: offset, verse: verse, atEnd: json["atEnd"]?.boolValue ?? false,
                  selectedVerses: Set(selected), width: optionalNumber("width"), verseOffset: optionalNumber("verseOffset"))
    }

    public func json(merging original: JSObject = JSObject()) -> JSObject {
        var result = original
        result["offset"] = .number(offset)
        result["verse"] = verse.map { .number(Double($0)) } ?? .null
        result["atEnd"] = .bool(atEnd)
        result["selectedVerses"] = .array(selectedVerses.sorted().map { .number(Double($0)) })
        result["width"] = width.map(JSValue.number) ?? .null
        result["verseOffset"] = verseOffset.map(JSValue.number) ?? .null
        return result
    }
}

public enum ReaderViewports {
    public static let field = "nativeReaderPositions"
    public static let capacity = 24

    public static func position(in state: JSObject, chapter: String) -> ReaderViewport? {
        state[field]?.objectValue?[JSString(chapter)]?.objectValue.flatMap(ReaderViewport.init(json:))
    }

    public static func updating(_ state: JSObject, chapter: String, position: ReaderViewport?) -> JSObject {
        var state = state
        var positions = state[field]?.objectValue ?? JSObject()
        let original = positions[JSString(chapter)]?.objectValue ?? JSObject()
        func order(_ value: JSValue) -> Double {
            guard let number = value.objectValue?["order"]?.numberValue,
                  number.isFinite, number >= 0, number < 1_000_000_000_000 else { return 0 }
            return number
        }
        let nextOrder = (positions.entries.map { order($0.1) }.max() ?? 0) + 1
        positions.remove(JSString(chapter))
        if let position {
            var record = position.json(merging: original)
            record["order"] = .number(nextOrder)
            positions[JSString(chapter)] = .object(record)
        }
        // Local state uses canonical key ordering on disk. Explicit recency must
        // survive that serialization rather than relying on object insertion order.
        while positions.entries.count > capacity,
              let oldest = positions.entries.min(by: { order($0.1) < order($1.1) })?.0 { positions.remove(oldest) }
        if positions.isEmpty { state.remove(JSString(field)) }
        else { state[field] = .object(positions) }
        return state
    }
}
