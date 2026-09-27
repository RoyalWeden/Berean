import Foundation
import Capacitor

/// Reads what the Share Extension left in the App Group inbox (docs/mobile Phase 18, R092;
/// crash-safe since DATA-SHARE-001). The inbox is two-phase:
///   `take()`     lists pending items WITHOUT removing anything (each carries a stable `id`);
///   `readFile()` returns a shared file's bytes (a PDF) — still without removing it;
///   `ack(ids)`   removes the items (and their files) once the app has handled them.
/// So an app kill or a failure while routing an item leaves it in the inbox for the next drain.
/// Items are one file each (`item-<id>.json`); the older single `pending.json` list is still read
/// (its entries get ids `legacy-<index>-<receivedAt>`) and removed once all of them are acked.
@objc(BereanShareInboxPlugin)
public class BereanShareInboxPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BereanShareInboxPlugin"
    public let jsName = "BereanShareInbox"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "take", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ack", returnType: CAPPluginReturnPromise),
    ]
    private var appGroup: String { (Bundle.main.object(forInfoDictionaryKey: "BereanAppGroup") as? String) ?? "group.com.berean.app" }
    private func inboxDir() -> URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?.appendingPathComponent("inbox", isDirectory: true)
    }
    private func legacyItems(_ dir: URL) -> [[String: Any]] {
        let file = dir.appendingPathComponent("pending.json")
        guard let data = try? Data(contentsOf: file), let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return [] }
        return arr.enumerated().map { (i, item) in
            var it = item
            let at = (item["receivedAt"] as? Double).map { String(Int($0)) } ?? "0"
            it["id"] = "legacy-\(i)-\(at)"
            return it
        }
    }

    @objc func take(_ call: CAPPluginCall) {
        guard let dir = inboxDir() else { call.resolve(["items": []]); return }
        var items = legacyItems(dir)
        let names = (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
        for name in names.sorted() where name.hasPrefix("item-") && name.hasSuffix(".json") {
            guard let data = try? Data(contentsOf: dir.appendingPathComponent(name)),
                  var it = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
            if it["id"] == nil { it["id"] = String(name.dropFirst(5).dropLast(5)) }
            items.append(it)
        }
        items.sort { (($0["receivedAt"] as? Double) ?? 0) < (($1["receivedAt"] as? Double) ?? 0) }
        call.resolve(["items": items])
    }

    /// Base64 of an inbox file (a shared PDF). Removed by `ack`, not here.
    @objc func readFile(_ call: CAPPluginCall) {
        guard let name = call.getString("file"), !name.contains("/"), !name.contains(".."), let dir = inboxDir() else { call.reject("invalid file"); return }
        guard let data = try? Data(contentsOf: dir.appendingPathComponent(name)) else { call.reject("not found"); return }
        call.resolve(["base64": data.base64EncodedString(), "bytes": data.count])
    }

    /// Remove handled items (and their files). Unknown ids are ignored — ack is idempotent.
    @objc func ack(_ call: CAPPluginCall) {
        guard let dir = inboxDir() else { call.resolve(); return }
        let ids = (call.getArray("ids") as? [String]) ?? []
        let files = (call.getArray("files") as? [String]) ?? []
        let fm = FileManager.default
        for id in ids where !id.hasPrefix("legacy-") && !id.contains("/") && !id.contains("..") {
            try? fm.removeItem(at: dir.appendingPathComponent("item-\(id).json"))
        }
        for f in files where !f.contains("/") && !f.contains("..") { try? fm.removeItem(at: dir.appendingPathComponent(f)) }
        let legacy = legacyItems(dir).compactMap { $0["id"] as? String }
        if !legacy.isEmpty && legacy.allSatisfy({ ids.contains($0) }) { try? fm.removeItem(at: dir.appendingPathComponent("pending.json")) }
        call.resolve()
    }
}
