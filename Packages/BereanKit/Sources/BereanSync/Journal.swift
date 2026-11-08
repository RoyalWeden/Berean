import BereanCore

/// Journal file encoding — port of src/platform/sync/journal.ts. One JSON object per line;
/// a file holds a contiguous seq range of ONE device; names sort lexically in seq order.
/// Sizes are JavaScript `.length` values (UTF-16 code units), not UTF-8 bytes, because that is
/// what the TypeScript writer measures and records in manifests.
public enum Journal {
    public static let maxOps = 500
    public static let maxBytes = 256 * 1024
    public static let compactAfterOps = 5000
    public static let compactAfterBytes = 5 * 1024 * 1024
    public static let compactSilentMs: Int64 = 90 * 24 * 60 * 60 * 1000

    public struct FileInfo: Equatable, Sendable {
        public var name: String
        public var seqFrom: Int
        public var seqTo: Int
        public var bytes: Int?
    }

    public struct Decoded: Equatable, Sendable {
        public var ops: [JSObject]
        public var unreadable: Int
        public var truncated: Bool
    }

    static func pad9(_ n: Int) -> String {
        let s = JSNumber.toString(Double(n))
        return String(repeating: "0", count: max(0, 9 - s.utf16.count)) + s
    }

    public static func snapshotFileName(seq: Int) -> String { "snapshot-\(pad9(seq)).json" }
    public static func journalFileName(seqFrom: Int, seqTo: Int) -> String { "journal-\(pad9(seqFrom))-\(pad9(seqTo)).jsonl" }

    /// `/^journal-(\d{9})-(\d{9})\.jsonl$/`.
    public static func parseJournalFileName(_ name: String) -> FileInfo? {
        let u = Array(name.utf16)
        let prefix = Array("journal-".utf16), suffix = Array(".jsonl".utf16)
        guard u.count == prefix.count + 9 + 1 + 9 + suffix.count,
              Array(u[0..<8]) == prefix, u[17] == 0x2D, Array(u[27...]) == suffix else { return nil }
        func num(_ r: Range<Int>) -> Int? {
            var v = 0
            for k in r { guard (0x30...0x39).contains(u[k]) else { return nil }; v = v * 10 + Int(u[k] - 0x30) }
            return v
        }
        guard let a = num(8..<17), let b = num(18..<27) else { return nil }
        return FileInfo(name: name, seqFrom: a, seqTo: b, bytes: nil)
    }

    public static func encode(_ ops: [JSObject]) -> JSString {
        var out: [UInt16] = []
        for (n, op) in ops.enumerated() {
            if n > 0 { out.append(0x0A) }
            JSON.write(.object(op), into: &out)
        }
        out.append(0x0A)
        return JSString(units: out)
    }

    public static func decode(_ text: JSString) -> Decoded {
        let u = text.units
        var ops: [JSObject] = []
        var unreadable = 0
        let truncated = !u.isEmpty && u.last != 0x0A
        let lines = u.split(separator: 0x0A, omittingEmptySubsequences: false)
        let last = lines.count - 1
        for (i, line) in lines.enumerated() {
            if JSWhitespace.trim(line).isEmpty { continue }
            if i == last && truncated { continue }
            if let v = try? JSON.parse(units: line), isValidOp(v), let o = v.objectValue { ops.append(o) } else { unreadable += 1 }
        }
        return Decoded(ops: ops, unreadable: unreadable, truncated: truncated)
    }

    public static func decode(_ text: String) -> Decoded { decode(JSString(text)) }

    /// `isValidOp`. Absent and `null` differ, exactly as `!== undefined` does in TypeScript.
    public static func isValidOp(_ x: JSValue) -> Bool {
        guard case .object(let o) = x else { return false }
        guard o["id"]?.stringValue != nil else { return false }
        guard let seq = o["seq"]?.numberValue, JSNumber.isInteger(seq), seq >= 1 else { return false }
        guard let hlc = o["hlc"]?.stringValue, isWireHlc(hlc.units) else { return false }
        guard let device = o["device"]?.stringValue, !device.isEmpty,
              let entity = o["entity"]?.stringValue, !entity.isEmpty else { return false }
        guard let key = o["key"]?.stringValue, !key.isEmpty else { return false }
        guard let op = o["op"]?.stringValue, op == "upsert" || op == "delete" else { return false }
        if op == "upsert" { guard o["fields"]?.objectValue != nil else { return false } }
        if let base = o["base"], base.stringValue == nil { return false }
        guard o["schema"]?.numberValue != nil else { return false }
        if let fh = o["fh"] {
            guard let fo = fh.objectValue, fo.values.allSatisfy({ $0.stringValue != nil }) else { return false }
        }
        if let lin = o["lin"] {
            guard let la = lin.arrayValue, la.allSatisfy({ $0.stringValue != nil }) else { return false }
        }
        return true
    }

    /// `/^\d{13}-[0-9a-f]{4}-[^-\s]+$/` (no `u` flag: `\s` is the ECMAScript whitespace set).
    static func isWireHlc(_ u: [UInt16]) -> Bool {
        guard u.count >= 20 else { return false }
        for k in 0..<13 where !(0x30...0x39).contains(u[k]) { return false }
        guard u[13] == 0x2D, u[18] == 0x2D else { return false }
        for k in 14..<18 where !((0x30...0x39).contains(u[k]) || (0x61...0x66).contains(u[k])) { return false }
        for k in 19..<u.count where u[k] == 0x2D || JSWhitespace.isWhitespace(u[k]) { return false }
        return true
    }

    public struct Chunk: Equatable, Sendable {
        public var info: FileInfo
        public var content: JSString
    }

    /// `chunkForFiles`: split ops (already in seq order) into files within the caps.
    public static func chunkForFiles(_ ops: [JSObject]) -> [Chunk] {
        var out: [Chunk] = []
        var batch: [JSObject] = []
        var bytes = 0
        func seqOf(_ o: JSObject) -> Int { Int(o["seq"]?.numberValue ?? 0) }
        func flush() {
            guard !batch.isEmpty else { return }
            let content = encode(batch)
            let from = seqOf(batch[0]), to = seqOf(batch[batch.count - 1])
            out.append(Chunk(info: FileInfo(name: journalFileName(seqFrom: from, seqTo: to), seqFrom: from, seqTo: to, bytes: content.length), content: content))
            batch = []
            bytes = 0
        }
        for op in ops {
            let line = JSON.stringify(.object(op)).length + 1
            if !batch.isEmpty && (batch.count >= maxOps || bytes + line > maxBytes) { flush() }
            batch.append(op)
            bytes += line
        }
        flush()
        return out
    }
}
