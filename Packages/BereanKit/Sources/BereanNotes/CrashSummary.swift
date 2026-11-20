import Foundation

/// The "App recovered from a crash" notice (original CrashReport.tsx): a short summary plus the
/// "Copy details" text. Built natively from a MetricKit crash diagnostic.
public struct CrashSummary: Codable, Equatable, Sendable {
    public var message: String          // e.g. "EXC_BREAKPOINT (SIGTRAP)" or a termination reason
    public var label: String?           // where: app version / build
    public var stack: String?           // symbolicated-or-raw frames, one per line
    public var timestamp: Date

    public init(message: String, label: String?, stack: String?, timestamp: Date) {
        self.message = message; self.label = label; self.stack = stack; self.timestamp = timestamp
    }

    /// Same layout as the original's copied details.
    public var details: String {
        var lines = ["Error: \(message)"]
        if let label, !label.isEmpty { lines.append("Source: \(label)") }
        if let stack, !stack.isEmpty { lines.append("\nStack trace:\n\(stack)") }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        lines.append("\nTimestamp: \(iso.string(from: timestamp))")
        return lines.joined(separator: "\n")
    }

    /// Mach exception / signal numbers as names (MetricKit reports numbers).
    public static func describe(exceptionType: Int?, signal: Int?, reason: String?) -> String {
        let exc: [Int: String] = [1: "EXC_BAD_ACCESS", 2: "EXC_BAD_INSTRUCTION", 3: "EXC_ARITHMETIC", 5: "EXC_SOFTWARE",
                                  6: "EXC_BREAKPOINT", 10: "EXC_CRASH", 11: "EXC_RESOURCE", 12: "EXC_GUARD"]
        let sig: [Int: String] = [4: "SIGILL", 5: "SIGTRAP", 6: "SIGABRT", 7: "SIGEMT", 8: "SIGFPE", 9: "SIGKILL",
                                  10: "SIGBUS", 11: "SIGSEGV", 12: "SIGSYS", 13: "SIGPIPE"]
        var parts: [String] = []
        if let e = exceptionType { parts.append(exc[e] ?? "Exception \(e)") }
        if let s = signal { parts.append("(\(sig[s] ?? "signal \(s)"))") }
        var text = parts.joined(separator: " ")
        if let reason, !reason.isEmpty { text += text.isEmpty ? reason : " — \(reason)" }
        return text.isEmpty ? "The app quit unexpectedly" : text
    }
}
