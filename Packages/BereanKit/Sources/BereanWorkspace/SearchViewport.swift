import BereanCore
import CryptoKit
import Foundation

public enum SearchViewportAlignment: String, Sendable {
    case top, center
}

/// A captured visit may intentionally have no row, such as a search left at its start.
public struct SearchViewportVisit: Equatable, Sendable {
    public let configuration: String
    public let context: String?
    public let row: String?
    public let alignment: SearchViewportAlignment

    public init?(configuration: String, context: String?, row: String?, alignment: SearchViewportAlignment = .top) {
        guard SearchViewports.validKey(configuration), context.map(SearchViewports.validKey) ?? (row == nil),
              row.map(SearchViewports.validRow) ?? true, alignment == .top || row != nil else { return nil }
        self.configuration = configuration
        self.context = context
        self.row = row
        self.alignment = alignment
    }
}

public enum SearchViewports {
    public static let capacity = 16
    private static let namespace = "$nativeSearchViewports"
    private static let configurationFields = [
        "query", "scopeTexts", "wordMode", "bookIds", "testament", "tagFilter", "tagFilterAll",
        "nativeSearchFocusText", "sort", "grouping",
    ]

    public static func fingerprint(_ value: JSValue) -> String {
        SHA256.hash(data: Data(JSON.stableJSON(value).utf8)).map { String(format: "%02x", $0) }.joined()
    }

    public static func configuration(in state: JSObject) -> String {
        fingerprint(.array(configurationFields.map { state[$0] ?? .null }))
    }

    public static func record(in state: JSObject) -> JSObject? {
        state["filters"]?.objectValue?[namespace]?.objectValue
    }

    /// Preserve all legacy filter fields, even if a legacy value is malformed.
    public static func installing(_ record: JSObject, in state: JSObject) -> JSObject {
        let existing = state["filters"]
        guard existing == nil || existing == .null || existing?.objectValue != nil else { return state }
        var filters = existing?.objectValue ?? JSObject()
        filters[namespace] = record.isEmpty ? nil : .object(record)
        if filters == existing?.objectValue { return state }
        var result = state
        result["filters"] = filters.isEmpty ? nil : .object(filters)
        return result
    }

    public static func destination(in record: JSObject, context: String) -> String? {
        guard validKey(context), let entries = record["positions"]?.arrayValue else { return nil }
        guard let row = entries.suffix(capacity).last(where: { $0["context"]?.stringValue?.string == context })?["row"]?.stringValue?.string
        else { return nil }
        return validRow(row) ? row : nil
    }

    public static func active(in record: JSObject) -> SearchViewportVisit? {
        guard let visit = record["active"]?.objectValue,
              let configuration = visit["configuration"]?.stringValue?.string else { return nil }
        if let context = visit["context"], context.stringValue == nil { return nil }
        if let row = visit["row"], row.stringValue == nil { return nil }
        let alignment = visit["alignment"]?.stringValue.flatMap { SearchViewportAlignment(rawValue: $0.string) } ?? .top
        return SearchViewportVisit(configuration: configuration, context: visit["context"]?.stringValue?.string,
                                   row: visit["row"]?.stringValue?.string, alignment: alignment)
    }

    public static func settingActive(_ visit: SearchViewportVisit?, in record: JSObject) -> JSObject {
        var record = record
        if let visit {
            var value = record["active"]?.objectValue ?? JSObject()
            value["configuration"] = .string(JSString(visit.configuration))
            value["context"] = visit.context.map { .string(JSString($0)) }
            value["row"] = visit.row.map { .string(JSString($0)) }
            value["alignment"] = visit.alignment == .top ? nil : .string(JSString(visit.alignment.rawValue))
            record["active"] = .object(value)
        } else {
            record.remove("active")
        }
        return record
    }

    public static func updating(_ record: JSObject, visit: SearchViewportVisit) -> JSObject {
        guard visit.alignment == .top, let context = visit.context else { return record }
        var result = record
        let previous = (record["positions"]?.arrayValue ?? []).suffix(capacity)
        var positions = previous.filter { $0["context"]?.stringValue?.string != context }
        if let row = visit.row {
            var entry = previous.last(where: { $0["context"]?.stringValue?.string == context })?.objectValue ?? JSObject()
            entry["context"] = .string(JSString(context))
            entry["row"] = .string(JSString(row))
            positions = positions.suffix(capacity - 1) + [.object(entry)]
        }
        result["positions"] = positions.isEmpty ? nil : .array(positions)
        if active(in: record)?.configuration == visit.configuration {
            result = settingActive(visit, in: result)
        }
        return result
    }

    /// An active visit for this exact rendering may deliberately return nil.
    public static func restoration(in record: JSObject, configuration: String, context: String) -> SearchViewportVisit? {
        if let visit = active(in: record), visit.configuration == configuration,
           visit.context == nil || visit.context == context {
            return visit.row == nil ? nil : visit
        }
        guard let row = destination(in: record, context: context) else { return nil }
        return SearchViewportVisit(configuration: configuration, context: context, row: row)
    }

    fileprivate static func validKey(_ key: String) -> Bool {
        key.utf8.count == 64 && key.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }

    fileprivate static func validRow(_ row: String) -> Bool {
        (1...512).contains(row.utf8.count) && !row.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) }
    }

}
