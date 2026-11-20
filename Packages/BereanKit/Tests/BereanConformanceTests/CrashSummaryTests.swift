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
}
