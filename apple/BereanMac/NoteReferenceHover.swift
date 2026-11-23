import AppKit
import SwiftUI
import BereanReference

struct NoteReferencePreview {
    let title: String
    let subtitle: String
    let detail: String
}

/// A read-only peek at an existing link. Never edits source or takes keyboard focus.
@MainActor final class NoteReferenceHover: NSObject, NSPopoverDelegate {
    struct Hit: Equatable {
        let url: URL
        let range: NSRange
        let rect: NSRect
    }

    weak var editor: NoteTextView?
    var resolve: @MainActor (URL) async -> NoteReferencePreview? = { _ in nil }
    private var hit: Hit?
    private var pending: Task<Void, Never>?
    private var generation = UUID()
    private var popover: NSPopover?
    private var scrollObserver: NSObjectProtocol?
    private var windowObserver: NSObjectProtocol?
    private var keyWindowObserver: NSObjectProtocol?

    func observeWindow(_ window: NSWindow?) {
        cancel()
        if let keyWindowObserver { NotificationCenter.default.removeObserver(keyWindowObserver) }
        keyWindowObserver = nil
        guard let window else { return }
        keyWindowObserver = NotificationCenter.default.addObserver(forName: NSWindow.didResignKeyNotification,
            object: window, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.cancel() }
            }
    }

    func observe(_ scroll: NSScrollView) {
        scroll.contentView.postsBoundsChangedNotifications = true
        scrollObserver = NotificationCenter.default.addObserver(forName: NSView.boundsDidChangeNotification,
            object: scroll.contentView, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.cancel() }
            }
        windowObserver = NotificationCenter.default.addObserver(forName: NSApplication.didResignActiveNotification,
            object: nil, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.cancel() }
            }
    }

    func stop() {
        cancel()
        if let scrollObserver { NotificationCenter.default.removeObserver(scrollObserver) }
        if let windowObserver { NotificationCenter.default.removeObserver(windowObserver) }
        if let keyWindowObserver { NotificationCenter.default.removeObserver(keyWindowObserver) }
        scrollObserver = nil; windowObserver = nil; keyWindowObserver = nil
    }

    func cancel() {
        generation = UUID()
        pending?.cancel(); pending = nil
        hit = nil
        let panel = popover
        popover = nil
        panel?.close()
    }

    func popoverDidClose(_ notification: Notification) {
        guard let panel = notification.object as? NSPopover, panel === popover else { return }
        cancel()
    }

    func moved(to point: NSPoint) {
        guard let editor, editor.window?.isKeyWindow == true,
              let candidate = Self.hit(at: point, in: editor) else { cancel(); return }
        guard candidate != hit else { return }
        cancel()
        hit = candidate
        let stamp = generation
        pending = Task { [weak self] in
            do { try await Task.sleep(for: .milliseconds(350)) } catch { return }
            guard let self, !Task.isCancelled, self.generation == stamp,
                  let preview = await self.resolve(candidate.url),
                  !Task.isCancelled, self.generation == stamp,
                  let editor = self.editor, editor.window?.isKeyWindow == true,
                  self.hit == candidate else { return }
            let panel = NSPopover()
            panel.delegate = self
            panel.behavior = .transient
            panel.animates = false
            panel.contentViewController = NSHostingController(rootView:
                VStack(alignment: .leading, spacing: 8) {
                    Text(preview.title).font(.headline)
                    if !preview.subtitle.isEmpty { Text(preview.subtitle).foregroundStyle(.secondary) }
                    if !preview.detail.isEmpty { Text(preview.detail).font(.callout).lineLimit(7) }
                }
                .frame(width: 300, alignment: .leading).padding(16)
                .accessibilityElement(children: .combine))
            self.popover = panel
            panel.show(relativeTo: candidate.rect, of: editor, preferredEdge: .maxY)
        }
    }

    /// Reject nearest-glyph hits in blank line space; anchor to just this wrapped link fragment.
    static func hit(at point: NSPoint, in view: NSTextView) -> Hit? {
        guard view.visibleRect.contains(point), let layout = view.layoutManager,
              let container = view.textContainer, let storage = view.textStorage, storage.length > 0 else { return nil }
        let origin = view.textContainerOrigin
        let local = NSPoint(x: point.x - origin.x, y: point.y - origin.y)
        let glyph = layout.glyphIndex(for: local, in: container)
        guard glyph < layout.numberOfGlyphs,
              layout.boundingRect(forGlyphRange: NSRange(location: glyph, length: 1), in: container).contains(local) else { return nil }
        let index = layout.characterIndexForGlyph(at: glyph)
        var range = NSRange()
        guard index < storage.length, let url = storage.attribute(.link, at: index, effectiveRange: &range) as? URL,
              case .lexicon = DeepLink.parse(url.absoluteString) else { return nil }
        var line = NSRange()
        _ = layout.lineFragmentRect(forGlyphAt: glyph, effectiveRange: &line)
        let linkedGlyphs = layout.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
        let fragment = NSIntersectionRange(line, linkedGlyphs)
        let rect = layout.boundingRect(forGlyphRange: fragment, in: container).offsetBy(dx: origin.x, dy: origin.y)
        return Hit(url: url, range: range, rect: rect)
    }
}
