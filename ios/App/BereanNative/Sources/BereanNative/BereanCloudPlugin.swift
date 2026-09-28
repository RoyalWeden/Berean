import Foundation
import UIKit
import Capacitor

/// Capacitor plugin exposing the app's iCloud Drive ubiquity container to the shared sync engine
/// (src/platform/ios/cloudSyncStore.ts; docs/mobile/icloud.md §2). The Mac side reads the same
/// container through plain `fs`, so the on-disk layout is the transport contract; this plugin only
/// does what a plain filesystem cannot on iOS:
///
///   - every read/write goes through `NSFileCoordinator`, so the iCloud daemon never sees a
///     half-written file and never overwrites one we are reading;
///   - a file that iCloud has not downloaded yet (`.<name>.icloud` placeholder) is reported as
///     `downloading` and `startDownloadingUbiquitousItem` is requested for it;
///   - `NSMetadataQuery` turns remote changes into `change` events for JavaScript.
///
/// Paths are relative to `<container>/Documents/sync/v1`; JavaScript never sees absolute
/// paths. `..` segments and absolute paths are rejected.
@objc(BereanCloudPlugin)
public class BereanCloudPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BereanCloudPlugin"
    public let jsName = "BereanCloud"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "mkdir", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startWatching", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopWatching", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pendingUploads", returnType: CAPPluginReturnPromise),
    ]

    static let syncSubpath = "Documents/sync/v1"
    private let queue = DispatchQueue(label: "app.berean.cloud", qos: .utility)
    private var cachedRoot: URL?
    private var rootResolved = false
    private var query: NSMetadataQuery?
    private var observers: [NSObjectProtocol] = []
    private var downloadRequested: [String: Date] = [:]

    enum CloudError: LocalizedError {
        case unavailable(String)
        case badPath(String)
        case notFound(String)
        var errorDescription: String? {
            switch self {
            case .unavailable(let s): return "iCloud unavailable: \(s)"
            case .badPath(let s): return "invalid sync path: \(s)"
            case .notFound(let s): return "not found: \(s)"
            }
        }
    }

    // MARK: container

    /// The configured container id (Info.plist `BereanICloudContainer`, filled from the
    /// BEREAN_ICLOUD_CONTAINER build setting) — `nil` means "first container in the entitlements".
    static var configuredContainerId: String? {
        guard let s = Bundle.main.object(forInfoDictionaryKey: "BereanICloudContainer") as? String,
              !s.isEmpty, !s.hasPrefix("$(") else { return nil }
        return s
    }

    /// `url(forUbiquityContainerIdentifier:)` may block and must not be called on the main
    /// thread; every plugin call already runs on `queue`. Cached after the first resolution
    /// (the container URL does not change while the app runs; account changes relaunch the app's
    /// data anyway and are reported by `status`).
    private func syncRoot() throws -> URL {
        if rootResolved, let r = cachedRoot { return r }
        guard FileManager.default.ubiquityIdentityToken != nil else {
            throw CloudError.unavailable("not signed in to iCloud (or iCloud Drive is off for Berean)")
        }
        guard let container = FileManager.default.url(forUbiquityContainerIdentifier: BereanCloudPlugin.configuredContainerId) else {
            throw CloudError.unavailable("container not available — check the iCloud capability / container id (docs/mobile/ios-build.md §2)")
        }
        let root = container.appendingPathComponent(BereanCloudPlugin.syncSubpath, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        cachedRoot = root
        rootResolved = true
        return root
    }

    private func resolve(_ rel: String) throws -> URL {
        let parts = rel.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
        if rel.hasPrefix("/") || parts.contains("..") || parts.contains(where: { $0.hasPrefix(".") && $0.hasSuffix(".icloud") }) {
            throw CloudError.badPath(rel)
        }
        var url = try syncRoot()
        for p in parts { url.appendPathComponent(p) }
        return url
    }

    private func run(_ call: CAPPluginCall, _ body: @escaping () throws -> [String: Any]) {
        queue.async {
            do { call.resolve(try body()) }
            catch { call.reject(error.localizedDescription, "CLOUD_ERROR", error) }
        }
    }

    // MARK: methods

    @objc func status(_ call: CAPPluginCall) {
        run(call) {
            let signedIn = FileManager.default.ubiquityIdentityToken != nil
            // iOS 16+ returns a generic "iPhone" unless the app has the user-assigned-device-name
            // entitlement; the model name is more useful for the device list on other devices.
            let deviceName = DispatchQueue.main.sync { UIDevice.current.name }
            do {
                let root = try self.syncRoot()
                return ["available": true, "signedIn": signedIn,
                        "containerId": BereanCloudPlugin.configuredContainerId ?? "(entitlements default)",
                        "path": root.path, "deviceName": deviceName]
            } catch {
                return ["available": false, "signedIn": signedIn, "reason": error.localizedDescription,
                        "containerId": BereanCloudPlugin.configuredContainerId ?? "(entitlements default)", "deviceName": deviceName]
            }
        }
    }

    @objc func mkdir(_ call: CAPPluginCall) {
        run(call) {
            let url = try self.resolve(call.getString("path") ?? "")
            try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
            return [:]
        }
    }

    @objc func list(_ call: CAPPluginCall) {
        run(call) {
            let url = try self.resolve(call.getString("path") ?? "")
            guard FileManager.default.fileExists(atPath: url.path) else { return ["entries": []] }
            let keys: [URLResourceKey] = [.isDirectoryKey, .ubiquitousItemDownloadingStatusKey]
            let children = try FileManager.default.contentsOfDirectory(at: url, includingPropertiesForKeys: keys, options: [])
            var entries: [[String: Any]] = []
            for child in children {
                let values = try? child.resourceValues(forKeys: Set(keys))
                var name = child.lastPathComponent
                var downloaded = true
                if name.hasPrefix(".") && name.hasSuffix(".icloud") {
                    // Placeholder for a file iCloud has not materialised here yet.
                    name = String(name.dropFirst().dropLast(".icloud".count))
                    downloaded = false
                } else if let st = values?.ubiquitousItemDownloadingStatus, st != .current {
                    downloaded = false
                }
                if name.hasPrefix(".") { continue }
                entries.append(["name": name, "isDir": values?.isDirectory ?? false, "downloaded": downloaded])
            }
            return ["entries": entries]
        }
    }

    @objc func read(_ call: CAPPluginCall) {
        run(call) {
            let rel = call.getString("path") ?? ""
            let url = try self.resolve(rel)
            let fm = FileManager.default
            if !fm.fileExists(atPath: url.path) {
                let placeholder = url.deletingLastPathComponent().appendingPathComponent(".\(url.lastPathComponent).icloud")
                if fm.fileExists(atPath: placeholder.path) {
                    self.requestDownload(url)
                    return ["exists": true, "downloading": true, "text": NSNull()]
                }
                return ["exists": false, "downloading": false, "text": NSNull()]
            }
            if let st = try? url.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey]).ubiquitousItemDownloadingStatus, st != .current {
                self.requestDownload(url)
                return ["exists": true, "downloading": true, "text": NSNull()]
            }
            var coordError: NSError?
            var readError: Error?
            var text: String?
            NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: url, options: [], error: &coordError) { readURL in
                do { text = try String(contentsOf: readURL, encoding: .utf8) } catch { readError = error }
            }
            if let e = coordError { throw e }
            if let e = readError { throw e }
            return ["exists": true, "downloading": false, "text": text ?? ""]
        }
    }

    @objc func write(_ call: CAPPluginCall) {
        run(call) {
            let url = try self.resolve(call.getString("path") ?? "")
            guard let text = call.getString("text") else { throw CloudError.badPath("missing text") }
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            var coordError: NSError?
            var writeError: Error?
            NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: url, options: .forReplacing, error: &coordError) { writeURL in
                do { try Data(text.utf8).write(to: writeURL, options: .atomic) } catch { writeError = error }
            }
            if let e = coordError { throw e }
            if let e = writeError { throw e }
            return [:]
        }
    }

    @objc func remove(_ call: CAPPluginCall) {
        run(call) {
            let url = try self.resolve(call.getString("path") ?? "")
            guard FileManager.default.fileExists(atPath: url.path) else { return [:] }
            var coordError: NSError?
            var removeError: Error?
            NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: url, options: .forDeleting, error: &coordError) { delURL in
                do { try FileManager.default.removeItem(at: delURL) } catch { removeError = error }
            }
            if let e = coordError { throw e }
            if let e = removeError { throw e }
            return [:]
        }
    }

    /// Ask iCloud to materialise a file. Throttled per file only briefly (a read loop must not
    /// re-request every pass); a NEWER version of the same file is requested again as soon as the
    /// metadata query reports it (see `downloadNonCurrent`).
    private func requestDownload(_ url: URL, force: Bool = false) {
        let key = url.path
        if !force, let last = downloadRequested[key], Date().timeIntervalSince(last) < 10 { return }
        downloadRequested[key] = Date()
        try? FileManager.default.startDownloadingUbiquitousItem(at: url)
    }

    /// DATA-SYNC-008: iOS does not download iCloud Drive files on its own — it only tells us they
    /// changed. Every sync file the metadata query reports as not current is requested at once, so
    /// the next query update (download finished) is what wakes the engine — no read has to
    /// stumble on a placeholder first and no timer has to come round.
    private func downloadNonCurrent(_ items: [NSMetadataItem]) -> Int {
        var requested = 0
        for item in items {
            guard let url = item.value(forAttribute: NSMetadataItemURLKey) as? URL else { continue }
            let status = item.value(forAttribute: NSMetadataUbiquitousItemDownloadingStatusKey) as? String
            if status != nil && status != NSMetadataUbiquitousItemDownloadingStatusCurrent {
                requestDownload(url, force: true)
                requested += 1
            }
        }
        return requested
    }

    /// Our own files iCloud has not uploaded yet (the transport's honest "uploading" signal).
    @objc func pendingUploads(_ call: CAPPluginCall) {
        run(call) {
            let dir = try self.resolve(call.getString("path") ?? "")
            guard FileManager.default.fileExists(atPath: dir.path) else { return ["count": 0] }
            let keys: [URLResourceKey] = [.ubiquitousItemIsUploadedKey, .isDirectoryKey]
            let files = try FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: keys, options: [.skipsHiddenFiles])
            var count = 0
            for f in files {
                let v = try? f.resourceValues(forKeys: Set(keys))
                if v?.isDirectory == true { continue }
                if v?.ubiquitousItemIsUploaded == false { count += 1 }
            }
            return ["count": count]
        }
    }

    // MARK: change notifications

    @objc func startWatching(_ call: CAPPluginCall) {
        queue.async {
            let root: URL
            do { root = try self.syncRoot() } catch { call.reject(error.localizedDescription, "CLOUD_ERROR", error); return }
            DispatchQueue.main.async {
                if self.query != nil { call.resolve(); return }
                let q = NSMetadataQuery()
                q.searchScopes = [NSMetadataQueryUbiquitousDocumentsScope]
                q.predicate = NSPredicate(format: "%K BEGINSWITH %@", NSMetadataItemPathKey, root.path)
                q.notificationBatchingInterval = 1.5
                let center = NotificationCenter.default
                let handler: (Notification) -> Void = { [weak self] note in
                    guard let self = self, let q = self.query else { return }
                    q.disableUpdates()
                    var paths: [String] = []
                    var touched: [NSMetadataItem] = []
                    let isInitial = note.name == .NSMetadataQueryDidFinishGathering
                    if isInitial {
                        for i in 0..<q.resultCount { if let item = q.result(at: i) as? NSMetadataItem { touched.append(item) } }
                    }
                    let keys = [NSMetadataQueryUpdateAddedItemsKey, NSMetadataQueryUpdateChangedItemsKey, NSMetadataQueryUpdateRemovedItemsKey]
                    for k in keys {
                        for item in (note.userInfo?[k] as? [NSMetadataItem]) ?? [] {
                            if k != NSMetadataQueryUpdateRemovedItemsKey { touched.append(item) }
                            if let p = item.value(forAttribute: NSMetadataItemPathKey) as? String, p.hasPrefix(root.path) {
                                paths.append(String(p.dropFirst(root.path.count + 1)))
                            }
                        }
                    }
                    let requested = self.downloadNonCurrent(touched)
                    q.enableUpdates()
                    self.notifyListeners("change", data: ["paths": paths, "initial": isInitial, "downloadsRequested": requested])
                }
                self.observers.append(center.addObserver(forName: .NSMetadataQueryDidFinishGathering, object: q, queue: .main, using: handler))
                self.observers.append(center.addObserver(forName: .NSMetadataQueryDidUpdate, object: q, queue: .main, using: handler))
                self.query = q
                q.start()
                call.resolve()
            }
        }
    }

    @objc func stopWatching(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.query?.stop()
            self.query = nil
            for o in self.observers { NotificationCenter.default.removeObserver(o) }
            self.observers.removeAll()
            call.resolve()
        }
    }
}
