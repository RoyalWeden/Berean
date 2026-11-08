import BereanCore

/// Content hashes written into sync journals and compared across devices. Ports of
/// `hashFields` (src/platform/sync/engine.ts) and `fieldHashes` / `shortHash`
/// (src/platform/sync/merge.ts). Both are FNV-1a over the UTF-16 code units of a
/// `JSON.stringify` result; they differ in key ordering and in the length suffix.
public enum SyncHash {
    /// `hashFields(fields)`: keys of every plain object (root included, arrays excluded) sorted
    /// with the default `Array.prototype.sort` (UTF-16 order) and re-inserted — so array-index
    /// keys still come first, as they would in the rebuilt JavaScript object. Suffix: JSON length
    /// in lowercase hex.
    public static func recordHash(_ fields: JSObject) -> String {
        let json = JSON.stringify(sortedDeep(.object(fields))).units
        return FNV1a32.hex8(FNV1a32.hash(json)) + JSNumber.toString(json.count, radix: 16)
    }

    /// `fieldHashes(fields)`: one `shortHash(JSON.stringify(v ?? null))` per own key, in
    /// property order. Nested keys are NOT sorted here.
    public static func fieldHashes(_ fields: JSObject) -> JSObject {
        var out = JSObject()
        for (k, v) in fields.entries { out[k] = .string(JSString(shortHash(JSON.stringify(v).units))) }
        return out
    }

    /// `shortHash(s)`: FNV-1a hex8 + length in base 36.
    public static func shortHash(_ units: [UInt16]) -> String {
        FNV1a32.hex8(FNV1a32.hash(units)) + JSNumber.toString(units.count, radix: 36)
    }

    static func sortedDeep(_ v: JSValue) -> JSValue {
        switch v {
        case .array(let a): return .array(a.map(sortedDeep))
        case .object(let o):
            var out = JSObject()
            for k in o.keys.sorted() { out[k] = sortedDeep(o[k]!) }
            return .object(out)
        default: return v
        }
    }
}
