import Foundation
import Capacitor

/// Reads what the Share Extension left in the App Group inbox (docs/mobile Phase 18, R092).
/// `take()` returns the pending items and clears the list; PDF files are moved into the app's
/// own PDF store path (`appsupport:`-relative) so the shared pdf service can import them.
@objc(BereanShareInboxPlugin)
public class BereanShareInboxPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BereanShareInboxPlugin"
    public let jsName = "BereanShareInbox"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "take", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readFile", returnType: CAPPluginReturnPromise),
    ]
    private var appGroup: String { (Bundle.main.object(forInfoDictionaryKey: "BereanAppGroup") as? String) ?? "group.com.berean.app" }
    private func inboxDir() -> URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?.appendingPathComponent("inbox", isDirectory: true)
    }

    @objc func take(_ call: CAPPluginCall) {
        guard let dir = inboxDir() else { call.resolve(["items": []]); return }
        let file = dir.appendingPathComponent("pending.json")
        guard let data = try? Data(contentsOf: file), let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { call.resolve(["items": []]); return }
        try? FileManager.default.removeItem(at: file)
        call.resolve(["items": arr])
    }

    /// Base64 of an inbox file (a shared PDF), then deletes it.
    @objc func readFile(_ call: CAPPluginCall) {
        guard let name = call.getString("file"), !name.contains("/"), !name.contains(".."), let dir = inboxDir() else { call.reject("invalid file"); return }
        let url = dir.appendingPathComponent(name)
        guard let data = try? Data(contentsOf: url) else { call.reject("not found"); return }
        try? FileManager.default.removeItem(at: url)
        call.resolve(["base64": data.base64EncodedString(), "bytes": data.count])
    }
}
