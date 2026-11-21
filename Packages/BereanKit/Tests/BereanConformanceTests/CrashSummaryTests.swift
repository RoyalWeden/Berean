import Foundation
import Testing
@testable import BereanNotes

@Suite struct CrashSummaryTests {
    @Test func detailsMatchOriginalLayout() throws {
        let s = CrashSummary(message: CrashSummary.describe(exceptionType: 6, signal: 5, reason: nil),
                             label: "Berean 0.8.2 (12)", stack: "0 BereanIOS 0x1\n1 SwiftUI 0x2",
                             timestamp: Date(timeIntervalSince1970: 1_795_000_000))
        #expect(s.message == "EXC_BREAKPOINT (SIGTRAP)")
        #expect(s.details == "Error: EXC_BREAKPOINT (SIGTRAP)\nSource: Berean 0.8.2 (12)\n\nStack trace:\n0 BereanIOS 0x1\n1 SwiftUI 0x2\n\nTimestamp: 2026-11-18T11:06:40.000Z")
        #expect(CrashSummary.describe(exceptionType: nil, signal: nil, reason: nil) == "The app quit unexpectedly")
        #expect(CrashSummary.describe(exceptionType: 10, signal: 6, reason: "Namespace SIGNAL") == "EXC_CRASH (SIGABRT) — Namespace SIGNAL")
        let round = try JSONDecoder().decode(CrashSummary.self, from: JSONEncoder().encode(s))
        #expect(round == s)
    }

    @Test func fingerprintIgnoresJSONKeyOrderButPreservesFrameOrder() {
        let original = CrashSummary(message: "EXC_CRASH (SIGKILL)", label: "Berean 1",
                                    stack: #"{"frames":[{"image":"Berean","offset":1},{"offset":2}]}"#,
                                    timestamp: Date(timeIntervalSince1970: 1_795_000_000))
        var reordered = original
        reordered.stack = #" { "frames": [ { "offset": 1, "image": "Berean" }, { "offset": 2 } ] } "#
        #expect(original.fingerprint == reordered.fingerprint)
        #expect(original.stack != reordered.stack)

        reordered.stack = #"{"frames":[{"offset":2},{"offset":1,"image":"Berean"}]}"#
        #expect(original.fingerprint != reordered.fingerprint)
    }

    @Test func fingerprintDistinguishesDiagnosticFieldsAndHandlesInvalidUnicodeText() {
        let original = CrashSummary(message: "EXC_CRASH (SIGKILL) — 0x8BADF00D", label: "Berean 1",
                                    stack: #"{"frames":["⚠️ λ ־あ" "#,
                                    timestamp: Date(timeIntervalSince1970: 1_795_000_000))
        let copy = original
        #expect(copy.fingerprint == original.fingerprint)
        #expect(original.fingerprint.count == 64)

        var changed = original
        changed.timestamp.addTimeInterval(0.001)
        #expect(original.fingerprint != changed.fingerprint)
        changed = original
        changed.message = "EXC_CRASH (SIGKILL) — 0xDEAD10CC"
        #expect(original.fingerprint != changed.fingerprint)
        changed = original
        changed.label = "Berean 2"
        #expect(original.fingerprint != changed.fingerprint)
        changed = original
        changed.stack = #"{"frames":["⚠️ λ ־い" "#
        #expect(original.fingerprint != changed.fingerprint)
    }

    @Test func completeLargeStackSurvivesStorageAndCopy() throws {
        let frames = String(repeating: #"{"symbol":"Berean λ","offset":12345},"#, count: 900)
        let stack = #"{"frames":["# + frames + #"{"symbol":"Final frame","offset":98765}]}"#
        let summary = CrashSummary(message: "Watchdog", label: nil, stack: stack,
                                   timestamp: Date(timeIntervalSince1970: 1_795_000_000))
        let restored = try JSONDecoder().decode(CrashSummary.self, from: JSONEncoder().encode(summary))
        #expect(stack.count > 20_000)
        #expect(restored.stack == stack)
        #expect(restored.details.contains(stack))
        #expect(restored.fingerprint == summary.fingerprint)
    }
}
