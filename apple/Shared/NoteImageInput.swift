import SwiftUI
import UniformTypeIdentifiers
import BereanNotes
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// Turns pasted or chosen pictures into the original's inline image Markdown
/// (`![name](data:image/…;base64,…)`, pm/imageInsert.ts). Formats that do not render inline
/// (TIFF, HEIC, …) are re-encoded as PNG first.
enum NoteImageInput {
    static func markdown(data: Data, alt: String) -> String? {
        if let md = NoteImages.markdown(for: data, alt: alt) { return md }
        #if os(macOS)
        guard let rep = NSBitmapImageRep(data: data), let png = rep.representation(using: .png, properties: [:]) else { return nil }
        #else
        guard let png = UIImage(data: data)?.pngData() else { return nil }
        #endif
        return NoteImages.markdown(for: png, alt: alt)
    }

    /// The image on the clipboard as Markdown, or nil when it holds no picture.
    @MainActor static func pastedImageMarkdown() -> String? {
        #if os(macOS)
        let pb = NSPasteboard.general
        if let urls = pb.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL],
           let url = urls.first(where: { UTType(filenameExtension: $0.pathExtension)?.conforms(to: .image) == true }),
           let data = try? Data(contentsOf: url) {
            return markdown(data: data, alt: NoteImages.alt(forFileName: url.lastPathComponent))
        }
        for type in [NSPasteboard.PasteboardType.png, NSPasteboard.PasteboardType("public.jpeg"), .tiff] {
            if let data = pb.data(forType: type) { return markdown(data: data, alt: "image") }
        }
        return nil
        #else
        let pb = UIPasteboard.general
        guard pb.hasImages else { return nil }
        for type in [UTType.png, .jpeg, .gif, .webP] {
            if let data = pb.data(forPasteboardType: type.identifier) { return markdown(data: data, alt: "image") }
        }
        return pb.image?.pngData().flatMap { NoteImages.markdown(for: $0, alt: "image") }
        #endif
    }

    /// Lets the user choose a picture file; hands back its Markdown.
    @MainActor static func chooseImage(completion: @escaping (String?) -> Void) {
        func read(_ url: URL) -> String? {
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            return (try? Data(contentsOf: url)).flatMap { markdown(data: $0, alt: NoteImages.alt(forFileName: url.lastPathComponent)) }
        }
        #if os(macOS)
        let panel = NSOpenPanel()
        panel.title = "Insert Image"
        panel.prompt = "Insert"
        panel.allowedContentTypes = [.image]
        panel.allowsMultipleSelection = false
        let finish: (NSApplication.ModalResponse) -> Void = { r in completion(r == .OK ? panel.url.flatMap(read) : nil) }
        if let window = NSApp.keyWindow ?? NSApp.mainWindow { panel.beginSheetModal(for: window, completionHandler: finish) } else { finish(panel.runModal()) }
        #else
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.image], asCopy: true)
        let delegate = NoteFileTransfer.PickerDelegate { urls in completion(urls.first.flatMap(read)) }
        picker.delegate = delegate
        objc_setAssociatedObject(picker, &NoteFileTransfer.PickerDelegate.key, delegate, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
        NoteFileTransfer.topViewController()?.present(picker, animated: true)
        #endif
    }

    /// Where an image block goes for a caret at `location`: never inside another image's markup
    /// (the caret can rest among its hidden characters) — then after that image's line instead.
    static func insertionPoint(in text: NSString, at location: Int) -> Int {
        for image in NoteImages.find(in: text as String) where location > image.range.location && location < NSMaxRange(image.range) {
            let line = text.lineRange(for: NSRange(location: NSMaxRange(image.range) - 1, length: 0))
            return NSMaxRange(line)
        }
        return location
    }

    /// Image Markdown placed on its own line at `location` in `text`.
    static func block(_ markdown: String, in text: NSString, at location: Int) -> String {
        let before = location > 0 && text.character(at: location - 1) != 10 ? "\n" : ""
        let after = location < text.length && text.character(at: location) != 10 ? "\n" : ""
        return before + markdown + "\n" + after
    }

    /// Size presets for the Image Size menu: (title, width or nil for natural), clamped to the image.
    static func sizePresets(for image: NoteImages.Image) -> [(title: String, width: Int?)] {
        let natural = NoteTableLayout.decodedImage(image.source).map { Int(NoteTableLayout.pixelSize($0).width) } ?? 1000
        var out: [(String, Int?)] = []
        for (title, w) in [("Small", 200), ("Medium", 360), ("Large", 560)] where w < natural { out.append((title, w)) }
        out.append(("Original Size", nil))
        return out
    }
}
