import Foundation
import UIKit
import Capacitor
import OnnxRuntimeBindings

/// Read Aloud on iPhone: one-tap download of the Berean (Kokoro) voice pack — the same files the
/// Mac downloads (electron/ipc/ttsModel.ts). The file list comes from JavaScript
/// (src/platform/ios/voicePack.ts, built from electron/ttsModelManifest.ts) so both apps agree.
///
/// Files are fetched one at a time into `<Application Support>/Berean/tts-models/.download-tmp/<model>`
/// and only moved into `tts-models/<model>` once every file has arrived, with a `.manifest.json`
/// written last — a failed or cancelled download never leaves a half-written pack that reports
/// ready. The WebView reads the files through Capacitor's `_capacitor_file_` URLs
/// (`Capacitor.convertFileSrc(root)`), which the Kokoro worker uses as its model path.
@objc(BereanVoicePackPlugin)
public class BereanVoicePackPlugin: CAPPlugin, CAPBridgedPlugin, URLSessionDownloadDelegate {
    public let identifier = "BereanVoicePackPlugin"
    public let jsName = "BereanVoicePack"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "download", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "synthesize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unload", returnType: CAPPluginReturnPromise),
    ]

    private struct Job {
        let call: CAPPluginCall
        let modelId: String
        let files: [(path: String, url: URL)]
        let estimatedTotal: Int64
        var index = 0
        var completedBytes: Int64 = 0
        var task: URLSessionDownloadTask?
        var cancelled = false
        var background: UIBackgroundTaskIdentifier = .invalid
    }

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = true
        config.timeoutIntervalForResource = 60 * 60
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()
    private var job: Job?
    private let lock = NSLock()
    private var memoryObserver: NSObjectProtocol?

    override public func load() {
        // The model holds ~330 MB; give it back under memory pressure (it reloads in about a
        // second on the next sentence).
        memoryObserver = NotificationCenter.default.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: nil) { [weak self] _ in
            self?.inferenceQueue.async { self?.ortSession = nil; self?.sessionModelId = nil }
        }
    }

    deinit {
        if let o = memoryObserver { NotificationCenter.default.removeObserver(o) }
    }

    private func root() throws -> URL {
        let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        let dir = support.appendingPathComponent("Berean/tts-models", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        // Re-downloadable and ~360 MB: never in the device backup.
        var values = URLResourceValues(); values.isExcludedFromBackup = true
        var mutable = dir; try? mutable.setResourceValues(values)
        return dir
    }

    /// `modelId` is a Hugging Face id ("org/name"): two plain path components, nothing else.
    private func validModelId(_ id: String) -> Bool {
        let parts = id.split(separator: "/", omittingEmptySubsequences: false)
        return parts.count == 2 && parts.allSatisfy { !$0.isEmpty && $0 != "." && $0 != ".." }
    }
    private func validRelPath(_ p: String) -> Bool {
        !p.isEmpty && !p.hasPrefix("/") && !p.split(separator: "/", omittingEmptySubsequences: false).contains { $0.isEmpty || $0 == "." || $0 == ".." }
    }

    @objc func status(_ call: CAPPluginCall) {
        guard let modelId = call.getString("modelId"), validModelId(modelId) else { call.reject("invalid modelId"); return }
        do {
            let base = try root()
            let manifestURL = base.appendingPathComponent(modelId).appendingPathComponent(".manifest.json")
            var manifest: Any? = nil
            if let data = try? Data(contentsOf: manifestURL) { manifest = try? JSONSerialization.jsonObject(with: data) }
            lock.lock(); let downloading = job != nil; lock.unlock()
            call.resolve(["root": base.path, "manifest": manifest ?? NSNull(), "downloading": downloading])
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func download(_ call: CAPPluginCall) {
        guard let modelId = call.getString("modelId"), validModelId(modelId),
              let raw = call.getArray("files") as? [[String: Any]] else { call.reject("missing modelId/files"); return }
        var files: [(path: String, url: URL)] = []
        for f in raw {
            guard let p = f["path"] as? String, validRelPath(p), let s = f["url"] as? String, let u = URL(string: s), u.scheme == "https" else {
                call.reject("invalid file entry"); return
            }
            files.append((p, u))
        }
        guard !files.isEmpty else { call.reject("no files"); return }
        let estimated = Int64(call.getDouble("estimatedBytes") ?? 0)
        lock.lock()
        if job != nil { lock.unlock(); call.resolve(["success": false, "error": "A download is already running"]); return }
        call.keepAlive = true
        job = Job(call: call, modelId: modelId, files: files, estimatedTotal: estimated)
        lock.unlock()
        do {
            try? FileManager.default.removeItem(at: try tmpDir(modelId))
            try FileManager.default.createDirectory(at: try tmpDir(modelId), withIntermediateDirectories: true)
        } catch {
            finish(error: error.localizedDescription); return
        }
        DispatchQueue.main.async {
            // A little grace if the user switches apps mid-download; the session resumes it on return.
            let id = UIApplication.shared.beginBackgroundTask(withName: "BereanVoicePack") { }
            self.lock.lock(); self.job?.background = id; self.lock.unlock()
        }
        startNext()
    }

    @objc func cancel(_ call: CAPPluginCall) {
        lock.lock()
        let task = job?.task
        job?.cancelled = true
        lock.unlock()
        task?.cancel()
        if task == nil { finish(error: "Cancelled") }
        call.resolve(["cancelled": task != nil])
    }

    @objc func clear(_ call: CAPPluginCall) {
        guard let modelId = call.getString("modelId"), validModelId(modelId) else { call.reject("invalid modelId"); return }
        inferenceQueue.sync { ortSession = nil; sessionModelId = nil }
        do {
            try? FileManager.default.removeItem(at: try root().appendingPathComponent(modelId))
            try? FileManager.default.removeItem(at: try tmpDir(modelId))
            call.resolve(["success": true])
        } catch {
            call.resolve(["success": false, "error": error.localizedDescription])
        }
    }

    // MARK: Synthesis
    //
    // The WebView's Kokoro worker still turns text into phoneme token ids and picks the voice's
    // style vector (kokoro-js, exactly as on the Mac); only the model itself runs here, on ONNX
    // Runtime's native multi-threaded CPU engine — the WebView can only run it single-threaded
    // WASM, which is slower than real time on a phone.

    private let inferenceQueue = DispatchQueue(label: "berean.voicepack.inference", qos: .userInitiated)
    private var ortEnv: ORTEnv?
    private var ortSession: ORTSession?
    private var sessionModelId: String?

    private func session(for modelId: String) throws -> ORTSession {
        if let s = ortSession, sessionModelId == modelId { return s }
        ortSession = nil
        let env = try ortEnv ?? ORTEnv(loggingLevel: .warning)
        ortEnv = env
        let options = try ORTSessionOptions()
        try options.setIntraOpNumThreads(Int32(max(1, min(4, ProcessInfo.processInfo.activeProcessorCount - 2))))
        try options.setGraphOptimizationLevel(.all)
        let path = try root().appendingPathComponent(modelId).appendingPathComponent("onnx/model.onnx").path
        guard FileManager.default.fileExists(atPath: path) else { throw NSError(domain: "BereanVoicePack", code: 2, userInfo: [NSLocalizedDescriptionKey: "Voice pack not downloaded"]) }
        let s = try ORTSession(env: env, modelPath: path, sessionOptions: options)
        ortSession = s
        sessionModelId = modelId
        return s
    }

    /// `ids`: token ids (with the leading/trailing 0 pad), `style`: base64 Float32[256],
    /// `speed`: 1 = natural. Resolves `{ pcm: base64 Int16 LE mono, samplingRate: 24000 }`.
    @objc func synthesize(_ call: CAPPluginCall) {
        guard let modelId = call.getString("modelId"), validModelId(modelId),
              let ids = call.getArray("ids") as? [NSNumber], !ids.isEmpty,
              let styleB64 = call.getString("style"), let styleData = Data(base64Encoded: styleB64), styleData.count == 256 * 4 else {
            call.reject("invalid synthesize input"); return
        }
        let speed = Float(call.getDouble("speed") ?? 1)
        inferenceQueue.async {
            do {
                let s = try self.session(for: modelId)
                var idValues = ids.map { $0.int64Value }
                let idData = NSMutableData(bytes: &idValues, length: idValues.count * MemoryLayout<Int64>.size)
                let inputIds = try ORTValue(tensorData: idData, elementType: .int64, shape: [1, NSNumber(value: idValues.count)])
                let style = try ORTValue(tensorData: NSMutableData(data: styleData), elementType: .float, shape: [1, 256])
                var speedValue = speed
                let speedT = try ORTValue(tensorData: NSMutableData(bytes: &speedValue, length: 4), elementType: .float, shape: [1])
                let out = try s.run(withInputs: ["input_ids": inputIds, "style": style, "speed": speedT], outputNames: ["waveform"], runOptions: nil)
                guard let wave = out["waveform"] else { throw NSError(domain: "BereanVoicePack", code: 3, userInfo: [NSLocalizedDescriptionKey: "no waveform"]) }
                let data = try wave.tensorData() as Data
                let count = data.count / 4
                var pcm = Data(count: count * 2)
                data.withUnsafeBytes { (src: UnsafeRawBufferPointer) in
                    pcm.withUnsafeMutableBytes { (dst: UnsafeMutableRawBufferPointer) in
                        let f = src.bindMemory(to: Float.self)
                        let o = dst.bindMemory(to: Int16.self)
                        for i in 0..<count {
                            let v = max(-1, min(1, f[i]))
                            o[i] = Int16(littleEndian: Int16(v < 0 ? v * 32768 : v * 32767))
                        }
                    }
                }
                call.resolve(["pcm": pcm.base64EncodedString(), "samplingRate": 24000])
            } catch {
                call.reject("synthesis failed: \(error.localizedDescription)")
            }
        }
    }

    /// Frees the model (~330 MB) — after the voice pack is removed, or on memory pressure.
    @objc func unload(_ call: CAPPluginCall) {
        inferenceQueue.async { self.ortSession = nil; self.sessionModelId = nil; call.resolve() }
    }

    // MARK: Download sequence

    private func tmpDir(_ modelId: String) throws -> URL {
        try root().appendingPathComponent(".download-tmp").appendingPathComponent(modelId)
    }

    private func startNext() {
        lock.lock()
        guard var j = job else { lock.unlock(); return }
        if j.cancelled { lock.unlock(); finish(error: "Cancelled"); return }
        if j.index >= j.files.count { lock.unlock(); install(); return }
        let task = session.downloadTask(with: j.files[j.index].url)
        task.taskDescription = j.files[j.index].path
        j.task = task
        job = j
        lock.unlock()
        task.resume()
    }

    private func install() {
        lock.lock(); guard let j = job else { lock.unlock(); return }; lock.unlock()
        notifyListeners("verifying", data: [:])
        do {
            let tmp = try tmpDir(j.modelId)
            for f in j.files {
                let size = (try? tmp.appendingPathComponent(f.path).resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
                if size <= 0 { throw NSError(domain: "BereanVoicePack", code: 1, userInfo: [NSLocalizedDescriptionKey: "\(f.path) is missing or empty"]) }
            }
            let manifest: [String: Any] = [
                "modelId": j.modelId,
                "files": j.files.map { $0.path },
                "downloadedAt": ISO8601DateFormatter().string(from: Date()),
            ]
            try JSONSerialization.data(withJSONObject: manifest, options: [.prettyPrinted]).write(to: tmp.appendingPathComponent(".manifest.json"))
            let dest = try root().appendingPathComponent(j.modelId)
            try FileManager.default.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? FileManager.default.removeItem(at: dest)
            try FileManager.default.moveItem(at: tmp, to: dest)
            finish(error: nil)
        } catch {
            finish(error: error.localizedDescription)
        }
    }

    private func finish(error: String?) {
        lock.lock()
        guard let j = job else { lock.unlock(); return }
        job = nil
        lock.unlock()
        if error != nil, let tmp = try? tmpDir(j.modelId) { try? FileManager.default.removeItem(at: tmp) }
        if let e = error { j.call.resolve(["success": false, "error": e]) } else { j.call.resolve(["success": true]) }
        bridge?.releaseCall(j.call)
        let bg = j.background
        if bg != .invalid { DispatchQueue.main.async { UIApplication.shared.endBackgroundTask(bg) } }
    }

    // MARK: URLSessionDownloadDelegate

    public func urlSession(_ s: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        lock.lock(); guard let j = job else { lock.unlock(); return }; lock.unlock()
        let received = j.completedBytes + totalBytesWritten
        notifyListeners("progress", data: ["receivedBytes": received, "totalBytes": max(j.estimatedTotal, received)])
    }

    public func urlSession(_ s: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        lock.lock(); guard var j = job, let rel = downloadTask.taskDescription else { lock.unlock(); return }; lock.unlock()
        if let http = downloadTask.response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
            finish(error: "Download failed (\(http.statusCode)) for \(rel)"); return
        }
        do {
            let dest = try tmpDir(j.modelId).appendingPathComponent(rel)
            try FileManager.default.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? FileManager.default.removeItem(at: dest)
            try FileManager.default.moveItem(at: location, to: dest)
            let size = Int64((try? dest.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
            lock.lock()
            j = job ?? j
            j.completedBytes += size
            j.index += 1
            j.task = nil
            job = j
            lock.unlock()
        } catch {
            finish(error: error.localizedDescription)
        }
    }

    public func urlSession(_ s: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error = error {
            lock.lock(); let cancelled = job?.cancelled ?? false; lock.unlock()
            finish(error: cancelled || (error as NSError).code == NSURLErrorCancelled ? "Cancelled" : error.localizedDescription)
            return
        }
        // didFinishDownloadingTo already recorded the file (or finished the job on failure).
        lock.lock(); let alive = job != nil; lock.unlock()
        if alive { startNext() }
    }
}
