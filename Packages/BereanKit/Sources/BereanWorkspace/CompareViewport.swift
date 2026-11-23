import BereanCore
import Foundation

/// The effective edition and chapter displayed in Compare.
public struct CompareBookmarkDestination: Hashable, Sendable {
    public let textID: String
    public let bookID: String
    public let chapter: Int

    public init?(textID: String, bookID: String, chapter: Int) {
        guard (1...128).contains(textID.utf8.count), (1...128).contains(bookID.utf8.count),
              (0...999_999).contains(chapter) else { return nil }
        self.textID = textID
        self.bookID = bookID
        self.chapter = chapter
    }

    fileprivate var key: JSValue {
        [.string(JSString(textID)), .string(JSString(bookID)), .number(Double(chapter))]
    }
}

public struct CompareBookmarkColumn: Hashable, Sendable {
    public let id: UUID
    public let destination: CompareBookmarkDestination

    public init(id: UUID, destination: CompareBookmarkDestination) {
        self.id = id
        self.destination = destination
    }

    fileprivate var key: JSValue { [.string(JSString(id.uuidString)), destination.key] }
}

public enum CompareBookmarkScope: Hashable, Sendable {
    case independent(CompareBookmarkColumn)
    case aligned(source: CompareBookmarkDestination, columns: [CompareBookmarkColumn])
    case stacked(source: CompareBookmarkDestination, columns: [CompareBookmarkColumn])

    fileprivate var key: JSString? {
        switch self {
        case .independent(let column):
            return JSString(JSON.stableJSON(["independent", column.key]))
        case .aligned(let source, let columns):
            return Self.sharedKey("aligned", source: source, columns: columns)
        case .stacked(let source, let columns):
            return Self.sharedKey("stacked", source: source, columns: columns)
        }
    }

    private static func sharedKey(_ layout: JSValue, source: CompareBookmarkDestination,
                                  columns: [CompareBookmarkColumn]) -> JSString? {
        guard (1...32).contains(columns.count), Set(columns.map(\.id)).count == columns.count else { return nil }
        return JSString(JSON.stableJSON([layout, source.key, .array(columns.map(\.key))]))
    }

    public func accepts(_ anchor: CompareBookmarkAnchor) -> Bool {
        switch self {
        case .independent:
            return anchor.columnID == nil
        case .aligned:
            return anchor.columnID == nil && anchor.precision == nil
        case .stacked(_, let columns):
            return anchor.precision == nil && columns.contains { $0.id == anchor.columnID }
        }
    }
}

/// The viewport's top edge relative to a raw row. A small negative crop
/// represents leading padding or the gap immediately before the row.
public struct CompareBookmarkPrecision: Equatable, Sendable {
    public let crop: Double
    public let rowHeight: Double
    public let layout: String

    public init?(crop: Double, rowHeight: Double, layout: String) {
        guard (1...100_000).contains(rowHeight), (-32...rowHeight).contains(crop),
              layout.utf8.count == 64, layout.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else {
            return nil
        }
        self.crop = crop
        self.rowHeight = rowHeight
        self.layout = layout
    }

    public func correction(layout: String, rowHeight: Double, currentCrop: Double) -> Double? {
        guard self.layout == layout, abs(self.rowHeight - rowHeight) <= 0.5,
              currentCrop.isFinite else { return nil }
        return crop - currentCrop
    }

    fileprivate init?(json: JSObject) {
        guard let crop = json["crop"]?.numberValue, let rowHeight = json["rowHeight"]?.numberValue,
              let layout = json["layout"]?.stringValue?.string else { return nil }
        self.init(crop: crop, rowHeight: rowHeight, layout: layout)
    }

    fileprivate var json: JSValue {
        ["crop": .number(crop), "rowHeight": .number(rowHeight), "layout": .string(JSString(layout))]
    }
}

/// Raw verse for independent and stacked layouts, or source-grid verse for aligned layout.
/// Stacked positions carry the stable column ID whose raw verse is being stored.
public struct CompareBookmarkAnchor: Equatable, Sendable {
    public let verse: Int
    public let columnID: UUID?

    public let precision: CompareBookmarkPrecision?

    public init?(verse: Int, columnID: UUID? = nil, precision: CompareBookmarkPrecision? = nil) {
        guard (0...999_999).contains(verse) else { return nil }
        self.verse = verse
        self.columnID = columnID
        self.precision = precision
    }

    fileprivate init?(json: JSObject) {
        guard let verse = json["verse"]?.numberValue.flatMap(Int.init(exactly:)) else { return nil }
        if let value = json["columnID"] {
            guard let id = CompareViewports.parseColumnID(value) else { return nil }
            self.init(verse: verse, columnID: id)
        } else {
            self.init(verse: verse, precision: json["precision"]?.objectValue.flatMap(CompareBookmarkPrecision.init(json:)))
        }
    }
}

public enum CompareViewports {
    public static let field = "nativeComparePositions"
    public static let columnIDField = "nativeColumnID"
    public static let capacity = 24
    private static let maxOrder: Double = 1_000_000_000_000

    public enum IndependentVisit: Equatable, Sendable {
        case ordinary
        case history(CompareBookmarkAnchor?)
    }

    /// Explicit requests are handled by the live pane and supersede this
    /// destination choice. A historical visit may deliberately have no anchor.
    public static func independentPosition(visit: IndependentVisit, arrival: CompareBookmarkAnchor?,
                                           durable: CompareBookmarkAnchor?, fallback: CompareBookmarkAnchor?) -> CompareBookmarkAnchor? {
        switch visit {
        case .history(let anchor): return anchor
        case .ordinary: return arrival ?? durable ?? fallback
        }
    }

    public static func columnID(in record: JSObject) -> UUID? {
        record[columnIDField].flatMap(parseColumnID)
    }

    fileprivate static func parseColumnID(_ value: JSValue) -> UUID? {
        guard let string = value.stringValue, string.units.count == 36 else { return nil }
        return UUID(uuidString: string.string)
    }

    /// Assign fresh IDs when a legacy client discarded metadata or a configuration contains duplicates.
    /// All copies of an ambiguous ID are replaced so no old bookmark attaches to either column.
    public static func repairColumnIDs(in columns: [JSObject]) -> [JSObject] {
        let ids = columns.map(columnID(in:))
        let counts = Dictionary(ids.compactMap { $0 }.map { ($0, 1) }, uniquingKeysWith: +)
        var reserved = Set(counts.keys)
        return zip(columns, ids).map { column, id in
            if let id, counts[id] == 1 { return column }
            var fresh = UUID()
            while !reserved.insert(fresh).inserted { fresh = UUID() }
            var column = column
            column[columnIDField] = .string(JSString(fresh.uuidString))
            return column
        }
    }

    public static func repairColumnIDs(in state: JSObject) -> JSObject {
        guard let columns = state["compareColumns"]?.arrayValue else { return state }
        var repaired = repairColumnIDs(in: columns.compactMap(\.objectValue)).makeIterator()
        var state = state
        state["compareColumns"] = .array(columns.map { value in
            guard value.objectValue != nil, let column = repaired.next() else { return value }
            return .object(column)
        })
        return state
    }

    public static func position(in state: JSObject, scope: CompareBookmarkScope) -> CompareBookmarkAnchor? {
        guard let key = scope.key, let record = state[field]?.objectValue?[key]?.objectValue,
              let anchor = CompareBookmarkAnchor(json: record), scope.accepts(anchor) else { return nil }
        return anchor
    }

    public static func updating(_ state: JSObject, scope: CompareBookmarkScope,
                                position: CompareBookmarkAnchor?) -> JSObject {
        guard let key = scope.key, position.map(scope.accepts) ?? true else { return state }
        var positions = state[field]?.objectValue ?? JSObject()
        var record = positions[key]?.objectValue ?? JSObject()
        positions.remove(key)
        let limit = position == nil ? capacity : capacity - 1
        let recent = orderedEntries(in: positions).suffix(limit)
        positions = JSObject(recent.map { ($0.key, $0.value) })

        if let position {
            var nextOrder = recent.last.map { order($0.value) + 1 } ?? 1
            if nextOrder >= maxOrder {
                for (index, entry) in recent.enumerated() {
                    guard var previous = entry.value.objectValue else { continue }
                    previous["order"] = .number(Double(index + 1))
                    positions[entry.key] = .object(previous)
                }
                nextOrder = Double(recent.count + 1)
            }
            record["order"] = .number(nextOrder)
            record["verse"] = .number(Double(position.verse))
            record["precision"] = position.precision?.json
            record["columnID"] = position.columnID.map { .string(JSString($0.uuidString)) }
            positions[key] = .object(record)
        }

        var state = state
        state[field] = positions.isEmpty ? nil : .object(positions)
        return state
    }

    /// History keeps its exact visit separately. The current tab owns the destination bookmarks,
    /// including evictions, so a historical tab state must never replace or resurrect them.
    public static func merging(current: JSObject, into restored: JSObject) -> JSObject {
        var restored = restored
        let positions = current[field]?.objectValue ?? JSObject()
        let bounded = orderedEntries(in: positions).suffix(capacity)
        restored[field] = bounded.isEmpty ? nil : .object(JSObject(bounded.map { ($0.key, $0.value) }))
        return restored
    }

    private static func order(_ value: JSValue) -> Double {
        guard let order = value.objectValue?["order"]?.numberValue,
              order.isFinite, order.rounded() == order, (0..<maxOrder).contains(order) else { return 0 }
        return order
    }

    private static func orderedEntries(in positions: JSObject) -> [(key: JSString, value: JSValue)] {
        positions.entries.filter { $0.value.objectValue != nil }.sorted {
            let lhs = order($0.value)
            let rhs = order($1.value)
            return lhs == rhs ? $0.key.units.lexicographicallyPrecedes($1.key.units) : lhs < rhs
        }
    }
}
