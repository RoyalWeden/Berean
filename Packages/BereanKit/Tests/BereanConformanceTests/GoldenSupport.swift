import Foundation
import BereanCore

enum Golden {
    /// Loads Golden/<name>.json (exported by scripts/golden/corpus.ts) with BereanCore's own
    /// JSON.parse — the parser is independently pinned by core-json.json's `parse` cases.
    static func load(_ name: String) throws -> JSObject {
        guard let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Golden") else {
            throw GoldenError.missing(name)
        }
        let text = String(decoding: try Data(contentsOf: url), as: UTF8.self)
        guard let o = try JSON.parse(text).objectValue else { throw GoldenError.malformed(name) }
        guard o["format"]?.numberValue == 1 else { throw GoldenError.unsupportedFormat(name) }
        return o
    }

    enum GoldenError: Error { case missing(String), malformed(String), unsupportedFormat(String) }
}

extension JSValue {
    var array: [JSValue] { arrayValue ?? [] }
    var object: JSObject { objectValue ?? JSObject() }
    var str: String { stringValue?.string ?? "" }
    var jsstr: JSString { stringValue ?? JSString("") }
    var int: Int { Int(numberValue ?? 0) }
    var units: [UInt16] { array.map { UInt16($0.int) } }
    var optionalString: String? { stringValue?.string }
}

extension JSObject {
    func arr(_ k: String) -> [JSValue] { self[k]?.arrayValue ?? [] }
}
