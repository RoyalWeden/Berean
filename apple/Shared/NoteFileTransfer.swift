import SwiftUI
import UniformTypeIdentifiers
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// Native Markdown export / import panels.
///
/// SwiftUI's `.fileExporter` attached to the note view did not present from the note toolbar on macOS
/// (2026-11-08: clicking Share did nothing, no panel, no log), so export and import drive the platform
/// panels directly: `NSSavePanel` / `NSOpenPanel` as window sheets on the Mac, `UIDocumentPickerViewController`
/// on iPhone. Every outcome is reported back (saved / cancelled / failed) so the UI can surface errors.
enum NoteFileTransfer {
    enum Outcome: Equatable { case saved(URL), cancelled, failed(String) }

    static var markdownType: UTType { UTType(filenameExtension: "md", conformingTo: .plainText) ?? .plainText }
    static var importTypes: [UTType] { [markdownType, UTType(filenameExtension: "markdown", conformingTo: .plainText) ?? .plainText, .plainText] }

    /// Writes `text` to `url` (atomic, UTF-8). Separate so tests can exercise the write path.
    static func write(_ text: String, to url: URL) throws { try Data(text.utf8).write(to: url, options: .atomic) }

    @MainActor
    static func exportMarkdown(_ text: String, suggestedName: String, completion: @escaping (Outcome) -> Void) {
        export(text, suggestedName: suggestedName, title: "Export Note as Markdown", type: markdownType, completion: completion)
    }

    @MainActor
    static func export(_ text: String, suggestedName: String, title: String, type: UTType, completion: @escaping (Outcome) -> Void) {
        #if os(macOS)
        let panel = NSSavePanel()
        panel.title = title
        panel.prompt = "Export"
        panel.nameFieldStringValue = suggestedName
        panel.allowedContentTypes = [type]
        panel.canCreateDirectories = true
        panel.isExtensionHidden = false
        let finish: (NSApplication.ModalResponse) -> Void = { response in
            guard response == .OK, let url = panel.url else { completion(.cancelled); return }
            do { try write(text, to: url); completion(.saved(url)) } catch { completion(.failed(error.localizedDescription)) }
        }
        if let window = NSApp.keyWindow ?? NSApp.mainWindow { panel.beginSheetModal(for: window, completionHandler: finish) } else { finish(panel.runModal()) }
        #else
        guard let top = topViewController() else { completion(.failed("No window to present from.")); return }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let url = directory.appendingPathComponent(suggestedName)
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try write(text, to: url)
        } catch {
            try? FileManager.default.removeItem(at: directory)
            completion(.failed(error.localizedDescription))
            return
        }
        let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
        let delegate = PickerDelegate { urls in
            try? FileManager.default.removeItem(at: directory)
            completion(urls.first.map { .saved($0) } ?? .cancelled)
        }
        picker.delegate = delegate
        objc_setAssociatedObject(picker, &PickerDelegate.key, delegate, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
        top.present(picker, animated: true)
        #endif
    }

    /// Lets the user pick one or more Markdown/text files; returns their contents with file names.
    @MainActor
    static func chooseMarkdownFiles(completion: @escaping ([(name: String, text: String)]) -> Void) {
        func read(_ urls: [URL]) -> [(name: String, text: String)] {
            urls.compactMap { url in
                let scoped = url.startAccessingSecurityScopedResource()
                defer { if scoped { url.stopAccessingSecurityScopedResource() } }
                return (try? Data(contentsOf: url)).map { (url.lastPathComponent, String(decoding: $0, as: UTF8.self)) }
            }
        }
        #if os(macOS)
        let panel = NSOpenPanel()
        panel.title = "Import Markdown Notes"
        panel.prompt = "Import"
        panel.allowedContentTypes = importTypes
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        let finish: (NSApplication.ModalResponse) -> Void = { r in completion(r == .OK ? read(panel.urls) : []) }
        if let window = NSApp.keyWindow ?? NSApp.mainWindow { panel.beginSheetModal(for: window, completionHandler: finish) } else { finish(panel.runModal()) }
        #else
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: importTypes, asCopy: true)
        picker.allowsMultipleSelection = true
        let delegate = PickerDelegate { urls in completion(read(urls)) }
        picker.delegate = delegate
        objc_setAssociatedObject(picker, &PickerDelegate.key, delegate, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
        topViewController()?.present(picker, animated: true)
        #endif
    }

    #if os(iOS)
    final class PickerDelegate: NSObject, UIDocumentPickerDelegate {
        nonisolated(unsafe) static var key: UInt8 = 0
        let done: ([URL]) -> Void
        init(_ done: @escaping ([URL]) -> Void) { self.done = done }
        func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) { done(urls) }
        func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { done([]) }
    }

    @MainActor static func topViewController() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first { $0.activationState == .foregroundActive }
            ?? UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        var top = scene?.keyWindow?.rootViewController
        while let next = top?.presentedViewController { top = next }
        return top
    }
    #endif
}
