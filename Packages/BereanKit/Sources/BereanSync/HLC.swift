import BereanCore

/// Hybrid logical clock — port of src/platform/sync/hlc.ts.
/// Wire form `<wallMs 13 digits>-<counter 4 hex>-<deviceId>`, totally ordered by JavaScript
/// string comparison (UTF-16 code units).
public struct HLC: Equatable, Sendable {
    public var wallMs: Int64
    public var counter: Int
    public var deviceId: String

    public init(wallMs: Int64, counter: Int, deviceId: String) {
        self.wallMs = wallMs; self.counter = counter; self.deviceId = deviceId
    }

    public static let zero = "0000000000000-0000-"
    /// How far ahead of the local wall clock a received timestamp may be before it is ignored.
    public static let maxClockDriftMs: Int64 = 60 * 60 * 1000

    public struct InvalidHLC: Error, Equatable, Sendable { public let value: String }

    /// `formatHlc`.
    public var formatted: String {
        let w = JSNumber.toString(Double(wallMs))
        let c = JSNumber.toString(counter, radix: 16)
        return String(repeating: "0", count: max(0, 13 - w.utf16.count)) + w + "-"
            + String(repeating: "0", count: max(0, 4 - c.utf16.count)) + c + "-" + deviceId
    }

    /// `parseHlc`: `/^(\d{13})-([0-9a-f]{4})-(.*)$/` — `.` excludes LF, CR, U+2028 and U+2029.
    public static func parse(_ s: String) throws(InvalidHLC) -> HLC {
        let u = Array(s.utf16)
        guard u.count >= 19 else { throw InvalidHLC(value: s) }
        var wall: Int64 = 0
        for k in 0..<13 {
            guard (0x30...0x39).contains(u[k]) else { throw InvalidHLC(value: s) }
            wall = wall * 10 + Int64(u[k] - 0x30)
        }
        guard u[13] == 0x2D, u[18] == 0x2D else { throw InvalidHLC(value: s) }
        var counter = 0
        for k in 14..<18 {
            let c = u[k]
            switch c {
            case 0x30...0x39: counter = counter << 4 | Int(c - 0x30)
            case 0x61...0x66: counter = counter << 4 | Int(c - 0x61 + 10)
            default: throw InvalidHLC(value: s)
            }
        }
        let rest = u[19...]
        if rest.contains(where: { $0 == 0x0A || $0 == 0x0D || $0 == 0x2028 || $0 == 0x2029 }) { throw InvalidHLC(value: s) }
        return HLC(wallMs: wall, counter: counter, deviceId: String(decoding: rest, as: UTF16.self))
    }

    /// `compareHlc`.
    public static func compare(_ a: String, _ b: String) -> Int { jsCompare(a, b) }
}

/// `HybridLogicalClock` — a value type; the owner (the sync engine actor) serialises access.
public struct HybridLogicalClock: Sendable {
    public let deviceId: String
    private var wallMs: Int64 = 0
    private var counter = 0
    private let now: @Sendable () -> Int64

    public enum ClockError: Error, Equatable, Sendable { case invalidDeviceId, invalidLast(String) }

    public init(deviceId: String, last: String? = nil, now: @escaping @Sendable () -> Int64) throws(ClockError) {
        guard !deviceId.isEmpty, !deviceId.contains("-") else { throw .invalidDeviceId }
        self.deviceId = deviceId
        self.now = now
        if let last, !last.isEmpty {
            do {
                let p = try HLC.parse(last)
                wallMs = p.wallMs; counter = p.counter
            } catch { throw .invalidLast(last) }
        }
    }

    /// Timestamp for a local event: follows the local wall clock however far it moved.
    public mutating func tick() -> String {
        let wall = now()
        if wall > wallMs {
            wallMs = wall; counter = 0
        } else {
            counter += 1
            if counter > 0xffff { wallMs += 1; counter = 0 }
        }
        return latest()
    }

    /// Advance past a remote timestamp. Returns how far ahead it was when refused for drift.
    @discardableResult
    public mutating func receive(_ remote: String) throws(HLC.InvalidHLC) -> Int64? {
        let r = try HLC.parse(remote)
        let wall = now()
        if r.wallMs > wall + HLC.maxClockDriftMs { return r.wallMs - wall }
        if r.wallMs > wallMs {
            wallMs = r.wallMs; counter = r.counter
        } else if r.wallMs == wallMs && r.counter > counter {
            counter = r.counter
        }
        return nil
    }

    public func latest() -> String { HLC(wallMs: wallMs, counter: counter, deviceId: deviceId).formatted }
}
