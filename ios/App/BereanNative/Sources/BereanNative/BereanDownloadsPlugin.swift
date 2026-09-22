import Foundation
import CryptoKit
import Capacitor

/// Resumable, cancellable file downloads with integrity checks (docs/mobile D-007: transcript
/// packs). Each download is a URLSession download task; progress / done / error arrive as events.
/// `cancel` keeps resume data (in memory and on disk) so `start` with the same id continues where
/// it stopped; `done` carries the file's SHA-256 so JavaScript can compare it with the manifest
/// before merging. Files land in <Application Support>/Berean/downloads/<name>, i.e. the
/// `appsupport:downloads/<name>` path the BereanSQLite plugin can ATTACH.
@objc(BereanDownloadsPlugin)
public class BereanDownloadsPlugin: CAPPlugin, CAPBridgedPlugin, URLSessionDownloadDelegate {
    public let identifier = "BereanDownloadsPlugin"
    public let jsName = "BereanDownloads"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
    ]

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = true
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()
    private var tasks: [String: URLSessionDownloadTask] = [:]
    private var names: [String: String] = [:]
    private var resumeData: [String: Data] = [:]
    private let lock = NSLock()

    private func downloadsDir() throws -> URL {
        let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let dir = support.appendingPathComponent("Berean/downloads", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
    private func resumeFile(_ id: String) throws -> URL { try downloadsDir().appendingPathComponent(".\(id).resume") }

    @objc func start(_ call: CAPPluginCall) {
        guard let id = call.getString("id"), let urlString = call.getString("url"), let url = URL(string: urlString), let name = call.getString("name") else {
            call.reject("missing id/url/name"); return
        }
        guard !name.contains("/") && !name.contains("..") else { call.reject("invalid name"); return }
        lock.lock(); defer { lock.unlock() }
        if tasks[id] != nil { call.resolve(["resumed": false]); return }
        names[id] = name
        var task: URLSessionDownloadTask
        var resumed = false
        if let data = resumeData[id] ?? (try? Data(contentsOf: resumeFile(id))) {
            task = session.downloadTask(withResumeData: data)
            resumed = true
        } else {
            task = session.downloadTask(with: url)
        }
        task.taskDescription = id
        tasks[id] = task
        task.resume()
        call.resolve(["resumed": resumed])
    }

    @objc func cancel(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else { call.reject("missing id"); return }
        lock.lock()
        let task = tasks.removeValue(forKey: id)
        lock.unlock()
        guard let t = task else { call.resolve(); return }
        t.cancel { [weak self] data in
            guard let self = self else { return }
            self.lock.lock()
            if let d = data { self.resumeData[id] = d; try? d.write(to: (try? self.resumeFile(id)) ?? URL(fileURLWithPath: "/dev/null")) }
            self.lock.unlock()
            self.notifyListeners("cancelled", data: ["id": id, "resumable": data != nil])
            call.resolve(["resumable": data != nil])
        }
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let name = call.getString("name"), !name.contains("/"), !name.contains("..") else { call.reject("invalid name"); return }
        if let dir = try? downloadsDir() { try? FileManager.default.removeItem(at: dir.appendingPathComponent(name)) }
        call.resolve()
    }

    @objc func list(_ call: CAPPluginCall) {
        guard let dir = try? downloadsDir(), let items = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.fileSizeKey]) else { call.resolve(["files": []]); return }
        let files = items.filter { !$0.lastPathComponent.hasPrefix(".") }.map { u -> [String: Any] in
            ["name": u.lastPathComponent, "bytes": (try? u.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0]
        }
        call.resolve(["files": files])
    }

    // MARK: URLSessionDownloadDelegate

    public func urlSession(_ s: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        guard let id = downloadTask.taskDescription else { return }
        notifyListeners("progress", data: ["id": id, "received": totalBytesWritten, "total": totalBytesExpectedToWrite])
    }

    public func urlSession(_ s: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        guard let id = downloadTask.taskDescription else { return }
        lock.lock(); let name = names[id]; tasks[id] = nil; resumeData[id] = nil; lock.unlock()
        if let rf = try? resumeFile(id) { try? FileManager.default.removeItem(at: rf) }
        if let http = downloadTask.response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            notifyListeners("error", data: ["id": id, "message": "HTTP \(http.statusCode)"])
            return
        }
        do {
            let dest = try downloadsDir().appendingPathComponent(name ?? "\(id).bin")
            try? FileManager.default.removeItem(at: dest)
            try FileManager.default.moveItem(at: location, to: dest)
            // SHA-256 streamed so a 40 MB pack never sits in memory twice.
            var hasher = SHA256()
            let handle = try FileHandle(forReadingFrom: dest)
            defer { try? handle.close() }
            while let chunk = try handle.read(upToCount: 1 << 20), !chunk.isEmpty { hasher.update(data: chunk) }
            let digest = hasher.finalize().map { String(format: "%02x", $0) }.joined()
            let size = (try? dest.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            notifyListeners("done", data: ["id": id, "name": dest.lastPathComponent, "path": "appsupport:downloads/\(dest.lastPathComponent)", "sha256": digest, "bytes": size])
        } catch {
            notifyListeners("error", data: ["id": id, "message": error.localizedDescription])
        }
    }

    public func urlSession(_ s: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let error = error, let id = task.taskDescription else { return }
        let nsError = error as NSError
        if nsError.code == NSURLErrorCancelled { return }   // handled by cancel()
        lock.lock()
        tasks[id] = nil
        if let data = nsError.userInfo[NSURLSessionDownloadTaskResumeData] as? Data { resumeData[id] = data; try? data.write(to: (try? resumeFile(id)) ?? URL(fileURLWithPath: "/dev/null")) }
        lock.unlock()
        notifyListeners("error", data: ["id": id, "message": error.localizedDescription, "resumable": nsError.userInfo[NSURLSessionDownloadTaskResumeData] != nil])
    }
}
