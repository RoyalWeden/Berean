import UIKit
import UniformTypeIdentifiers

/// "Open in Berean" from the system Share Sheet (docs/mobile Phase 18, R092). Collects the
/// shared items — text (a scripture reference opens the passage, anything else becomes a note),
/// URLs (YouTube links open the video), and PDF files (imported into the library) — into the
/// App Group inbox, then opens the app with `berean://share`. The app's BereanShareInboxPlugin
/// hands the items to the shared deep-link router.
final class ShareViewController: UIViewController {
    private static let appGroup = Bundle.main.object(forInfoDictionaryKey: "BereanAppGroup") as? String ?? "group.com.berean.app"

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        collect { [weak self] items in
            guard let self = self else { return }
            self.write(items)
            self.openApp()
            self.extensionContext?.completeRequest(returningItems: nil)
        }
    }

    private func collect(_ done: @escaping ([[String: Any]]) -> Void) {
        var results: [[String: Any]] = []
        let lock = NSLock()   // completion handlers arrive on arbitrary queues
        func add(_ item: [String: Any]) { lock.lock(); results.append(item); lock.unlock() }
        let group = DispatchGroup()
        let attachments = (extensionContext?.inputItems as? [NSExtensionItem])?.flatMap { $0.attachments ?? [] } ?? []
        for provider in attachments {
            if provider.hasItemConformingToTypeIdentifier(UTType.pdf.identifier) {
                group.enter()
                provider.loadFileRepresentation(forTypeIdentifier: UTType.pdf.identifier) { url, _ in
                    defer { group.leave() }
                    guard let url = url, let dest = self.inboxDir()?.appendingPathComponent("\(UUID().uuidString).pdf") else { return }
                    try? FileManager.default.copyItem(at: url, to: dest)
                    add(["kind": "pdf", "file": dest.lastPathComponent, "name": url.deletingPathExtension().lastPathComponent])
                }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                group.enter()
                provider.loadItem(forTypeIdentifier: UTType.url.identifier) { item, _ in
                    defer { group.leave() }
                    if let url = item as? URL { add(["kind": "url", "url": url.absoluteString]) }
                    else if let data = item as? Data, let s = String(data: data, encoding: .utf8) { add(["kind": "url", "url": s]) }
                }
            } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                group.enter()
                provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) { item, _ in
                    defer { group.leave() }
                    if let s = item as? String { add(["kind": "text", "text": s]) }
                    else if let data = item as? Data, let s = String(data: data, encoding: .utf8) { add(["kind": "text", "text": s]) }
                }
            }
        }
        group.notify(queue: .main) { done(results) }
    }

    private func inboxDir() -> URL? {
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: ShareViewController.appGroup) else { return nil }
        let dir = container.appendingPathComponent("inbox", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    private func write(_ items: [[String: Any]]) {
        guard let dir = inboxDir() else { return }
        let file = dir.appendingPathComponent("pending.json")
        var existing: [[String: Any]] = []
        if let data = try? Data(contentsOf: file), let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] { existing = arr }
        existing.append(contentsOf: items.map { var i = $0; i["receivedAt"] = Date().timeIntervalSince1970 * 1000; return i })
        if let data = try? JSONSerialization.data(withJSONObject: existing) { try? data.write(to: file, options: .atomic) }
    }

    /// Extensions may not reference `UIApplication.shared`, but `UIScene.open(_:options:)` is
    /// public and the extension's own window scene is reachable through the responder chain.
    private func openApp() {
        guard let url = URL(string: "berean://share") else { return }
        var responder: UIResponder? = self
        while let r = responder {
            if let scene = r as? UIScene { scene.open(url, options: nil, completionHandler: nil); return }
            responder = r.next
        }
        if let scene = view.window?.windowScene { scene.open(url, options: nil, completionHandler: nil) }
    }
}
