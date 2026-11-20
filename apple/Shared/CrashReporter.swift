import SwiftUI
import MetricKit
import BereanNotes

/// Native counterpart of the original CrashReport notice: MetricKit delivers crash diagnostics on a
/// later launch; the newest one is kept in this library's local defaults and shown once as
/// "Berean recovered from a crash" with Copy Details / Dismiss. Nothing leaves the device.
@MainActor final class CrashReporter: NSObject, MXMetricManagerSubscriber {
    static let key = "nativeCrashReport"
    private weak var app: AppModel?

    init(app: AppModel) {
        self.app = app
        super.init()
        MXMetricManager.shared.add(self)
        // Payloads delivered while the app was not running.
        store(Self.summarize(MXMetricManager.shared.pastDiagnosticPayloads))
    }

    nonisolated func didReceive(_ payloads: [MXDiagnosticPayload]) {
        let summary = Self.summarize(payloads)   // build the Sendable summary here; payloads stay on this thread
        Task { @MainActor in self.store(summary) }
    }

    nonisolated static func summarize(_ payloads: [MXDiagnosticPayload]) -> CrashSummary? {
        let crashes = payloads.flatMap { p in (p.crashDiagnostics ?? []).map { (p.timeStampEnd, $0) } }
        guard let (time, crash) = crashes.max(by: { $0.0 < $1.0 }) else { return nil }
        let meta = crash.metaData
        let message = CrashSummary.describe(exceptionType: crash.exceptionType?.intValue, signal: crash.signal?.intValue,
                                            reason: crash.terminationReason)
        let stack = String(data: crash.callStackTree.jsonRepresentation(), encoding: .utf8)
        return CrashSummary(message: message, label: "Berean \(meta.applicationBuildVersion) · \(meta.osVersion)",
                            stack: stack.map { String($0.prefix(20_000)) }, timestamp: time)
    }

    private func store(_ summary: CrashSummary?) {
        guard let summary else { return }
        if let data = try? JSONEncoder().encode(summary) { UserLibrary.defaults.set(data, forKey: Self.key) }
        app?.crashReport = summary
    }

    static func stored() -> CrashSummary? {
        UserLibrary.defaults.data(forKey: key).flatMap { try? JSONDecoder().decode(CrashSummary.self, from: $0) }
    }

    static func dismiss(_ app: AppModel) {
        UserLibrary.defaults.removeObject(forKey: key)
        app.crashReport = nil
    }
}

/// The notice itself (original: bottom-right card; same contents).
struct CrashReportBanner: View {
    @Environment(AppModel.self) private var app
    @State private var copied = false

    var body: some View {
        if let crash = app.crashReport {
            VStack(alignment: .leading, spacing: 8) {
                Label("Berean recovered from a crash", systemImage: "exclamationmark.triangle.fill")
                    .font(.callout.weight(.semibold)).foregroundStyle(.red)
                if let label = crash.label { Text(label).font(.caption).foregroundStyle(.secondary) }
                Text(crash.message).font(.caption).foregroundStyle(.secondary).lineLimit(3)
                HStack {
                    Button(copied ? "Copied" : "Copy Details", systemImage: copied ? "checkmark" : "doc.on.doc") {
                        Clipboard.copy(crash.details)
                        copied = true
                    }
                    Button("Dismiss") { CrashReporter.dismiss(app) }
                }
                .controlSize(.small)
            }
            .padding(12)
            .frame(maxWidth: 320, alignment: .leading)
            .background(.regularMaterial, in: .rect(cornerRadius: 14))
            .overlay { RoundedRectangle(cornerRadius: 14).strokeBorder(.red.opacity(0.3)) }
            .padding(16)
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .accessibilityElement(children: .contain)
        }
    }
}
